"""The applications ledger. `run.py applications` rewrites data/APPLICATIONS.md.

Two files feed it. `data/applications.jsonl` is what has actually gone out, one
line per confirmed submission. `data/open_postings.jsonl` is what he still means
to send on an employer's own site, where only he can press submit. The ledger is
read on a bad day, so its first screen answers four questions: how many are
out, which ones moved, what closes in the next three days, and which have gone
quiet long enough that one nudge is worth sending.

    run.py applications            rewrite the file, print the brief
    run.py applications brief=1    print the brief only (the morning check pastes it)
    run.py applications query=1    print the Gmail search for replies
"""
import os
import sys
from collections import Counter, OrderedDict
from datetime import datetime, timedelta

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store

LEDGER_MD = os.path.join(store.DATA, "APPLICATIONS.md")

# Listing order. "offer" is first because the day it is non-empty is the day
# the rest of the table stops mattering.
STATUSES = ("offer", "interview", "applied", "rejected", "withdrawn", "closed")
DEAD = ("rejected", "withdrawn", "closed")

# Days after submitting with no event at all before the ledger suggests a nudge.
# Co-op employers mostly screen within two weeks of the posting closing.
QUIET_DAYS = 14

# The brief shows what closes within this many days, at most BRIEF_ROWS
# companies of it. The morning brief has a hard line cap, and four rows keep
# this whole block to eight lines so it never pushes the school half off screen.
SOON_DAYS = 3
BRIEF_ROWS = 4

# Words an application reply tends to carry when the company name is not in it,
# as with a Greenhouse or Ashby no-reply.
REPLY_WORDS = ('"your application"', "interview", "HackerRank", "CodeSignal")


def status_of(row):
    return row.get("status") or "applied"


def submitted_date(row):
    ts = store.parse_ts(row.get("submitted_at"))
    return ts.date() if ts else None


def last_event(row):
    events = row.get("events") or []
    return events[-1] if events else None


def deadline_of(row):
    """'2026-10-05 09:00 PT' is that minute; a bare '2026-10-05' is the end of
    that day. None when there is no usable date. Pacific, like the machine."""
    s = (row.get("deadline") or "").strip()
    try:
        day = datetime.strptime(s[:10], "%Y-%m-%d")
    except ValueError:
        return None
    try:
        hh, mm = s[11:16].split(":")
        return day.replace(hour=int(hh), minute=int(mm))
    except ValueError:
        return day.replace(hour=23, minute=59)


def fmt_deadline(row):
    d = deadline_of(row)
    if d is None:
        return "no date"
    day = "%s %s %d" % (d.strftime("%a"), d.strftime("%b"), d.day)
    if len((row.get("deadline") or "").strip()) <= 10:
        return day                      # no time was given; do not invent one
    hour = d.strftime("%I").lstrip("0")
    minute = "" if d.minute == 0 else d.strftime(":%M")
    return "%s %s%s %s" % (day, hour, minute, d.strftime("%p"))


def quiet(rows, today):
    """Applied, nothing since, and old enough that silence means something."""
    out = []
    for r in rows:
        if status_of(r) != "applied" or r.get("events"):
            continue
        sub = submitted_date(r)
        if sub and (today - sub).days >= QUIET_DAYS:
            out.append(r)
    return out


def still_open(postings, now):
    """Not applied to, not skipped, deadline not yet passed. Undated ones stay."""
    out = []
    for p in postings:
        if (p.get("status") or "open") != "open":
            continue
        d = deadline_of(p)
        if d is not None and d < now:
            continue
        out.append(p)
    return out


def closing_soon(postings, now, days=SOON_DAYS):
    end = (now + timedelta(days=days)).replace(hour=23, minute=59)
    soon = [p for p in still_open(postings, now) if deadline_of(p) and deadline_of(p) <= end]
    return sorted(soon, key=lambda p: (deadline_of(p), p.get("company", "")))


def counts(rows):
    c = Counter(status_of(r) for r in rows)
    return OrderedDict((s, c.get(s, 0)) for s in STATUSES)


def _by_company(postings):
    """One row per company, at its earliest deadline: "Lyft, 3 roles" reads in a
    glance where three Lyft rows do not."""
    groups = OrderedDict()
    for p in postings:
        groups.setdefault(p.get("company", "?"), []).append(p)
    out = []
    for company, ps in groups.items():
        first = ps[0]
        what = first.get("title", "?") if len(ps) == 1 else "%d roles" % len(ps)
        note = "referral" if any(p.get("hold") == "referral" for p in ps) else ""
        out.append((first, company, what, note))
    return out


def brief(rows, postings, now):
    """The career block of the morning brief. Pasted verbatim, so it already
    follows that brief's rules: tables for dated rows, one fact per line."""
    c = counts(rows)
    live = c["applied"] + c["interview"] + c["offer"]
    head = "**Career: %d sent, %d still live, %d interviews, %d offers" % (
        len(rows), live, c["interview"], c["offer"])
    if c["rejected"]:
        head += ", %d rejected" % c["rejected"]
    lines = [head + "**"]

    for r in sorted((r for r in rows if status_of(r) in ("offer", "interview")),
                    key=lambda r: (status_of(r) != "offer", r.get("company", ""))):
        ev = last_event(r)
        lines.append("- %s: %s, %s%s" % (
            status_of(r).upper(), r.get("company", "?"), (r.get("title") or "?")[:50],
            (". " + ev["note"]) if ev and ev.get("note") else ""))

    soon = closing_soon(postings, now)
    grouped = _by_company(soon)
    if grouped:
        lines += ["| Closes | Still to apply | Note |", "|---|---|---|"]
        for first, company, what, note in grouped[:BRIEF_ROWS]:
            lines.append("| %s | %s · %s | %s |" % (
                fmt_deadline(first), company, what.replace("|", "/"), note))
    rest = len(grouped) - BRIEF_ROWS
    later = len(still_open(postings, now)) - len(soon)
    tail = []
    if rest > 0:
        tail.append("%d more companies close by %s" % (rest, fmt_deadline(soon[-1])))
    if later > 0:
        tail.append("%d postings close later" % later)
    if tail:
        text = "; ".join(tail)
        lines.append("- %s%s. Full list: data/APPLICATIONS.md" % (text[0].upper(), text[1:]))

    q = quiet(rows, now.date())
    if q:
        lines.append("- Quiet %d+ days, worth one nudge: %s" % (
            QUIET_DAYS, ", ".join("%s %s" % (r.get("company", "?"), r.get("job_id", "?"))
                                  for r in q[:6])))
    return lines


def _match_term(row):
    t = row.get("match") or (row.get("company") or "").split(" (")[0].strip()
    if not t or t.startswith("from:") or " " not in t:
        return t
    return '"%s"' % t


def watchlist(rows):
    """Company names to watch for. Names, not addresses: a reply comes from a
    recruiter whose address nobody has yet."""
    seen = OrderedDict()
    for r in rows:
        if status_of(r) in DEAD:
            continue
        seen.setdefault((r.get("company") or "").split(" (")[0].strip(), True)
    return [k for k in seen if k]


def gmail_query(rows):
    """One search that finds a reply to anything still live. Unread inbox only:
    the morning check's rule is that a read message he has already handled."""
    terms = []
    for r in rows:
        if status_of(r) in DEAD:
            continue
        t = _match_term(r)
        if t and t not in terms:
            terms.append(t)
    return "in:inbox is:unread newer_than:2d -from:linkedin.com (%s)" % " OR ".join(
        terms + list(REPLY_WORDS))


def render(rows, postings, now):
    today = now.date()
    c = counts(rows)
    lines = [
        "# Applications",
        "",
        "Updated: %s. Change a status with `python3 scripts/run.py mark-app <job_id> <status> [note]`;"
        " after applying on an employer site, `mark-app <job_id> applied`." % store.now(),
        "",
        "**%d submitted** | " % len(rows) + " | ".join("%s %d" % (s, n) for s, n in c.items()),
        "",
    ]
    q = quiet(rows, today)
    if q:
        lines += ["> Quiet for %d+ days with no word: %s. One nudge each, then let it go." % (
            QUIET_DAYS, ", ".join("%s %s" % (r.get("company", "?"), r.get("job_id", "?"))
                                  for r in q)), ""]

    lines += ["## Submitted", "",
              "| Submitted | Company | Role | Via | Status | Last event |",
              "|---|---|---|---|---|---|"]
    order = {s: i for i, s in enumerate(STATUSES)}
    for r in sorted(rows, key=lambda r: (order.get(status_of(r), 99),
                                         -(submitted_date(r) or today).toordinal(),
                                         r.get("company", ""))):
        ev = last_event(r)
        last = ("%s %s" % (ev.get("at", "")[:10], ev.get("note", ""))).strip() if ev else ""
        lines.append("| %s | %s | %s | %s | %s | %s |" % (
            (r.get("submitted_at") or "")[:10], r.get("company", "?"),
            (r.get("title") or "?").replace("|", "/"), r.get("via", "?"),
            status_of(r), last.replace("|", "/")))

    live = still_open(postings, now)
    if live:
        lines += ["", "## Still to apply on the employer's site (%d)" % len(live), "",
                  "| Closes | Company | Role | Where | Note | ID |", "|---|---|---|---|---|---|"]
        for p in sorted(live, key=lambda p: (deadline_of(p) or datetime.max, p.get("company", ""))):
            where = "[open](%s)" % p["link"] if p.get("link") else (p.get("where") or "")
            extra = p.get("where") if p.get("link") else ""   # e.g. "(Klue: one application per 60 days)"
            note = " ".join(x for x in ("held for a referral." if p.get("hold") == "referral" else "",
                                        p.get("note") or "", extra or "") if x)
            lines.append("| %s | %s | %s | %s | %s | %s |" % (
                fmt_deadline(p), p.get("company", "?"), (p.get("title") or "?").replace("|", "/"),
                where.replace("|", "/"), note.strip().replace("|", "/"), p.get("job_id", "?")))

    lines += ["", "## Watch for replies from", "",
              ", ".join(watchlist(rows)) or "(none)", ""]
    return "\n".join(lines) + "\n"


def run(**kwargs):
    rows = store.read(store.APPLICATIONS)
    postings = store.read(store.OPEN_POSTINGS)
    now = datetime.now()                # local, like every deadline in the files
    if kwargs.get("query"):
        print(gmail_query(rows))
        return {"query": True}
    short = brief(rows, postings, now)
    if kwargs.get("brief"):
        print("\n".join(short))
        return {"applications": len(rows), "brief": True}

    with open(LEDGER_MD, "w", encoding="utf-8") as f:
        f.write(render(rows, postings, now))
    print("\n".join(short))
    print("wrote %s" % os.path.relpath(LEDGER_MD, store.ROOT))
    return {"applications": len(rows), "open": len(still_open(postings, now)),
            "quiet": len(quiet(rows, now.date()))}
