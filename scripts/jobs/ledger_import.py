"""Fold the app's edit log into the data files. `run.py ledger-import`

The app records every change as an Edit and, when a folder has been granted,
writes the whole log to app/public/ledger-edits.json. This reads that file,
skips the edit ids already in state/ledger_imported.json, and applies the rest
in `at` order. app/src/ledger/types.ts, section 3, is the contract.

Status changes go through jobs/mark_app, the same two functions `mark-app`
uses, so an application changed in the app and one changed from the terminal
end up with the same history. Precedence follows `mark-app` too: "applied" and
"delete" act on a still-open posting when there is one (so the Planview case,
one id in both files, gets its event on the application row rather than a
second row), and everything else goes to applications.jsonl first.

An edit that cannot be applied is reported and still marked imported. The
alternative is an edit that fails on every run forever and drowns out the ones
that matter.

    run.py ledger-import        apply what is new, print one line
"""
import copy
import json
import os
import sys
import tempfile
from datetime import timezone

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store
from jobs import mark_app
from jobs.applications import STATUSES, status_of

KINDS = ("application", "person", "company", "opensource", "learning", "outreach")
OPS = ("add", "set", "event", "delete")

# Wire name (types.ts, camelCase) -> jsonl name, where they differ.
APP_FIELD_MAP = {"submitted": "submitted_at", "id": "job_id"}
# What a "set" may write onto an application or posting row. `id` and `events`
# are not here on purpose: the target names the row, and events only ever come
# from an "event" edit, so a set cannot rename a row or rewrite its history.
APP_SETTABLE = ("company", "title", "via", "term", "deadline", "submitted", "link",
                "where", "referral", "referrer", "hold", "note")
# Posting statuses an event can close a still-open posting with.
POSTING_SKIP = ("withdrawn", "closed", "rejected")


class Problem(Exception):
    """An edit that cannot be applied. Reported, then marked imported."""


def _ts(at):
    """The edit's own time, in the store's format, so events read in the order
    he made them rather than the order the import happened to run."""
    t = store.parse_ts(at)
    if t is None:
        return store.now()
    if t.tzinfo is not None:
        t = t.astimezone(timezone.utc).replace(tzinfo=None)
    return t.isoformat(timespec="seconds") + "Z"


def load_edits(path=None):
    """The pending log, or [] when there is none. Raises on a malformed file
    before anything has been touched."""
    path = path or store.LEDGER_EDITS
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    if not text.strip():
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError("%s is not valid JSON (%s); nothing imported"
                         % (os.path.relpath(path, store.ROOT), e))
    if not isinstance(data, dict) or not isinstance(data.get("edits"), list):
        raise ValueError("%s is not an EditsFile ({\"version\": 1, \"edits\": [...]}); nothing imported"
                         % os.path.relpath(path, store.ROOT))
    if data.get("version") != 1:
        raise ValueError("%s has version %r, this reads version 1; nothing imported"
                         % (os.path.relpath(path, store.ROOT), data.get("version")))
    return data["edits"]


def load_imported(path=None):
    path = path or store.LEDGER_IMPORTED
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    if not text.strip():
        return []
    try:
        ids = json.loads(text).get("applied", [])
    except (json.JSONDecodeError, AttributeError) as e:
        raise ValueError("%s is not {\"applied\": [...]} (%s); nothing imported"
                         % (os.path.relpath(path, store.ROOT), e))
    return [str(i) for i in ids]


def save_imported(ids, path=None):
    """Atomic, like store.write: a killed run never leaves half a list."""
    path = path or store.LEDGER_IMPORTED
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"applied": ids}, f, indent=1)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ------------------------------------------------------------- applications

def _app_row(rows, job_id):
    for r in rows:
        if str(r.get("job_id")) == str(job_id):
            return r
    return None


def _status_change(rows, postings, target, status, note, at):
    """One status change on an application or a still-open posting. Shared by
    "event" and by a `status` inside "set". Returns what happened, for tests."""
    posting = mark_app.open_posting(postings, target)
    row = _app_row(rows, target)

    # Same precedence as `mark-app`: applied on a still-open posting settles the
    # posting, and settle_posting puts the event on the application row when
    # the id is already there (Planview), so the count stays honest.
    if status == "applied" and posting is not None:
        return mark_app.settle_posting(rows, postings, target, "applied", note, at=at)

    if row is not None:
        if status == "saved":
            raise Problem("%s is submitted and cannot go back to saved" % target)
        try:
            mark_app.apply_status(rows, target, status, note, at=at)
        except ValueError as e:
            raise Problem("%s: %s" % (target, e))
        return status

    if posting is None:
        raise Problem("unknown target %s" % target)

    if status == "saved":
        return "already saved"
    if status == "note":
        if not note:
            raise Problem("%s: a note needs text" % target)
        posting["note"] = "; ".join(x for x in (posting.get("note"), note) if x)
        return "note"
    if status in POSTING_SKIP:
        return mark_app.settle_posting(rows, postings, target, "skip", note or status, at=at)
    if status in ("interview", "offer"):
        # Straight from saved to an interview: it went in, then it moved.
        mark_app.settle_posting(rows, postings, target, "applied", "", at=at)
        mark_app.apply_status(rows, target, status, note, at=at)
        return status
    raise Problem("%s: unknown status %r" % (target, status))


def _set_app(rows, postings, target, fields, at):
    row = _app_row(rows, target)
    holder = row if row is not None else mark_app.open_posting(postings, target)
    if holder is None:
        raise Problem("unknown target %s" % target)
    for k in APP_SETTABLE:
        if k in fields:
            holder[APP_FIELD_MAP.get(k, k)] = fields[k]
    status = fields.get("status")
    if status:
        current = status_of(row) if row is not None else "saved"
        # A set carries the whole field when the app re-sends it; an unchanged
        # status is not an event, and logging one would read as a second
        # "applied" in the history.
        if status != current:
            _status_change(rows, postings, target, status, "", at)


def _add_app(rows, postings, target, fields):
    if _app_row(rows, target) is not None or mark_app.open_posting(postings, target):
        return "set"
    f = fields
    status = f.get("status") or "saved"
    if status == "saved":
        postings.append({
            "job_id": target, "company": f.get("company"), "title": f.get("title"),
            "deadline": f.get("deadline"), "link": f.get("link"), "where": f.get("where"),
            "note": f.get("note"), "term": f.get("term"), "hold": f.get("hold"),
            "referral": f.get("referral"), "referrer": f.get("referrer"),
            "status": "open", "added_at": store.now(), "match": f.get("company"),
        })
        return "posting"
    if status not in STATUSES:
        raise Problem("%s: unknown status %r" % (target, status))
    rows.append({
        "job_id": target, "company": f.get("company"), "title": f.get("title"),
        "via": f.get("via"), "deadline": f.get("deadline"), "link": f.get("link"),
        "where": f.get("where"), "note": f.get("note"), "term": f.get("term"),
        "referral": f.get("referral"), "referrer": f.get("referrer"), "status": status,
        # The app fills `submitted` when he marks it sent; the import time is
        # only the fallback, and can be a day late.
        "submitted_at": f.get("submitted") or store.now(), "match": f.get("company"),
    })
    return "application"


def _delete_app(rows, postings, target, at):
    if mark_app.open_posting(postings, target) is not None:
        return mark_app.settle_posting(rows, postings, target, "skip", "deleted in the app", at=at)
    if _app_row(rows, target) is not None:
        raise Problem("%s was submitted; a submitted application is never deleted" % target)
    raise Problem("unknown target %s" % target)


def _apply_app(edit, rows, postings):
    op, target, at = edit["op"], edit["target"], _ts(edit.get("at"))
    fields = edit.get("fields") or {}
    if op == "event":
        ev = edit.get("event") or {}
        _status_change(rows, postings, target, str(ev.get("status") or ""),
                       str(ev.get("note") or ""), at)
    elif op == "set":
        _set_app(rows, postings, target, fields, at)
    elif op == "add":
        if _add_app(rows, postings, target, fields) == "set":
            _set_app(rows, postings, target, fields, at)
    elif op == "delete":
        _delete_app(rows, postings, target, at)


# ------------------------------------------------------------- everything else

def _apply_ledger(edit, ledger):
    """person / company / opensource / learning / outreach: one row each in ledger.jsonl."""
    kind, op, target = edit["kind"], edit["op"], edit["target"]
    if op == "event":
        raise Problem("%s %s: only applications take events" % (kind, target))
    fields = {k: v for k, v in (edit.get("fields") or {}).items() if k not in ("kind", "id")}
    idx = next((i for i, r in enumerate(ledger)
                if r.get("kind") == kind and str(r.get("id")) == str(target)), None)
    if op == "delete":
        # A tombstone even when there was no row: a pipeline person has none,
        # and the export needs the marker to leave them out.
        row = {"kind": kind, "id": target, "deleted": True}
    elif op == "set" and idx is not None:
        row = ledger[idx]
        row.update(fields)
    else:
        # "add" replaces whole, which is also what brings back a deleted entity;
        # a "set" with no row yet is an overlay on a pipeline record.
        row = dict({"kind": kind, "id": target}, **fields)
    if idx is None:
        ledger.append(row)
    else:
        ledger[idx] = row


# ------------------------------------------------------------- the job

def _check(edit):
    if not isinstance(edit, dict) or not edit.get("id"):
        raise Problem("an edit with no id")
    if edit.get("kind") not in KINDS:
        raise Problem("%s: unknown kind %r" % (edit["id"], edit.get("kind")))
    if edit.get("op") not in OPS:
        raise Problem("%s: unknown op %r" % (edit["id"], edit.get("op")))
    if not edit.get("target"):
        raise Problem("%s: no target" % edit["id"])
    if not isinstance(edit.get("fields") or {}, dict) or not isinstance(edit.get("event") or {}, dict):
        raise Problem("%s: fields and event must be objects" % edit["id"])


def pending_edits(edits, imported):
    """The edits not yet folded in, oldest first."""
    seen = set(imported)
    pending = []
    for e in edits:
        key = str(e.get("id")) if isinstance(e, dict) and e.get("id") else None
        if key is not None:
            if key in seen:
                continue
            seen.add(key)           # the same id twice in one file applies once
        pending.append(e)
    # Stable, so two edits in the same millisecond keep the order the app wrote them.
    pending.sort(key=lambda e: str(e.get("at") or "") if isinstance(e, dict) else "")
    return pending


def run(**kwargs):
    """`quiet=1` (the pre-step in `applications` and `export-app`) prints
    nothing when there was nothing to import, so the morning brief stays clean."""
    edits = load_edits()
    imported = load_imported()
    pending = pending_edits(edits, imported)
    if not pending:
        if not kwargs.get("quiet"):
            print("ledger-import: nothing new")
        return {"applied": 0, "skipped": 0, "problems": []}

    rows = store.read(store.APPLICATIONS)
    postings = store.read(store.OPEN_POSTINGS)
    ledger = store.read(store.LEDGER)
    before = [json.dumps(x, sort_keys=True) for x in (rows, postings, ledger)]

    applied, skipped, problems, done = 0, 0, [], []
    for edit in pending:
        # Each edit is all or nothing: a set whose status cannot apply leaves
        # its other fields unwritten too, so "skipped" always means untouched.
        snapshot = copy.deepcopy((rows, postings, ledger))
        try:
            _check(edit)
            if edit["kind"] == "application":
                _apply_app(edit, rows, postings)
            else:
                _apply_ledger(edit, ledger)
            applied += 1
        except (Problem, KeyError, ValueError) as e:
            rows[:], postings[:], ledger[:] = snapshot
            skipped += 1
            problems.append(str(e).strip("'\""))
        if isinstance(edit, dict) and edit.get("id"):
            done.append(str(edit["id"]))

    # Data first, then the ids. A crash in between re-applies these edits next
    # run (a doubled event, visible and fixable) rather than losing them.
    after = [json.dumps(x, sort_keys=True) for x in (rows, postings, ledger)]
    for path, data, b, a in zip((store.APPLICATIONS, store.OPEN_POSTINGS, store.LEDGER),
                                (rows, postings, ledger), before, after):
        if a != b:
            store.write(path, data)
    if done:
        save_imported(imported + [i for i in done if i not in imported])

    line = "ledger-import: %d applied, %d skipped" % (applied, skipped)
    if problems:
        line += " (%s)" % "; ".join(problems)
    print(line)
    return {"applied": applied, "skipped": skipped, "problems": problems}
