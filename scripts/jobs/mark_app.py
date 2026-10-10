"""Record what happened to an application. The only way a status changes.

    run.py mark-app <job_id> interview|offer|rejected|withdrawn|closed|applied [note...]
    run.py mark-app <job_id> note <text...>      log an email without changing the status
    run.py mark-app <job_id> applied             an open posting: you submitted it, move it in
    run.py mark-app <job_id> skip [why]          an open posting: not applying, drop it

Every change is kept as an event, so the ledger can show "interview, phone
screen Oct 9" rather than a bare word, and so a status can be walked back
without losing what happened before it.
"""
import sys

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store
from jobs.applications import STATUSES, status_of

VERBS = STATUSES + ("note", "skip")


def apply_status(rows, job_id, status, note="", at=None):
    """Pure. Returns (previous_status, updated_row). Raises on a bad id or status."""
    if status not in STATUSES + ("note",):
        raise ValueError("unknown status %r, expected one of: %s" % (status, ", ".join(VERBS)))
    if status == "note" and not note:
        raise ValueError("a note needs text: mark-app <job_id> note <what happened>")
    match = [r for r in rows if str(r.get("job_id")) == str(job_id)]
    if not match:
        raise KeyError("no application with job_id %s" % job_id)
    row = match[0]
    previous = status_of(row)
    new = previous if status == "note" else status
    row["status"] = new
    row.setdefault("events", []).append({"at": at or store.now(), "status": new, "note": note or ""})
    return previous, row


def open_posting(postings, job_id):
    for p in postings:
        if str(p.get("job_id")) == str(job_id) and (p.get("status") or "open") == "open":
            return p
    return None


def settle_posting(rows, postings, job_id, verb, note="", at=None):
    """Pure. `applied` moves an open posting into the ledger; `skip` drops it.

    A posting whose SCOPE half is already in the ledger (Planview asks for both)
    gets an event on that row instead of a second row, so the count stays honest.
    """
    p = open_posting(postings, job_id)
    if p is None:
        raise KeyError("no open posting with job_id %s" % job_id)
    at = at or store.now()
    p["closed_at"] = at
    if verb == "skip":
        p["status"] = "skipped"
        if note:
            p["why"] = note
        return "skipped"
    if verb != "applied":
        raise ValueError("an open posting takes applied or skip, not %r" % verb)
    p["status"] = "applied"
    existing = [r for r in rows if str(r.get("job_id")) == str(job_id)]
    if existing:
        r = existing[0]
        r.setdefault("events", []).append({"at": at, "status": status_of(r),
                                           "note": note or "employer site half submitted"})
        return "employer half added to the existing application"
    row = {"job_id": p["job_id"], "company": p.get("company"), "title": p.get("title"),
           "via": "employer site", "deadline": p.get("deadline"), "submitted_at": at}
    for k in ("link", "match"):
        if p.get(k):
            row[k] = p[k]
    if note:
        row["note"] = note
    rows.append(row)
    return "applied"


def run(**kwargs):
    args = [a for a in sys.argv[2:] if "=" not in a]
    if len(args) >= 2:
        job_id, verb, note = args[0], args[1].lower(), " ".join(args[2:])
    else:
        job_id = kwargs.get("job")
        verb = str(kwargs.get("status") or "").lower()
        note = str(kwargs.get("note") or "")
    if not job_id or not verb:
        raise SystemExit("usage: run.py mark-app <job_id> %s [note]" % "|".join(VERBS))

    rows = store.read(store.APPLICATIONS)
    postings = store.read(store.OPEN_POSTINGS)
    try:
        if verb in ("applied", "skip") and open_posting(postings, job_id):
            what = settle_posting(rows, postings, job_id, verb, note)
            store.write(store.APPLICATIONS, rows)
            store.write(store.OPEN_POSTINGS, postings)
            print("%s: %s" % (job_id, what))
        else:
            previous, row = apply_status(rows, job_id, verb, note)
            store.write(store.APPLICATIONS, rows)
            print("%s %s: %s -> %s%s" % (row.get("company"), job_id, previous, row["status"],
                                          (" (%s)" % note) if note else ""))
    except (KeyError, ValueError) as e:
        raise SystemExit(str(e).strip("'\""))

    import jobs.applications as ledger
    ledger.run()
    return {"job_id": job_id, "verb": verb}
