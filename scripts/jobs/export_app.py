"""Flatten the store into app/data.js for the React app.

The app is static and must work from file:// as well as GitHub Pages, so the
data ships as a <script src> that assigns a global. fetch() would fail on
file:// and there is no server in either target.

Person state (status, channel, dates) lives in localStorage keyed by id, so
re-running this adds new people without touching anything already tracked.
"""
import datetime
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import prefs
import store

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# app/ is a Vite project now: public/ is copied to the build output verbatim,
# so writing here means both `npm run dev` and `npm run build` pick the real
# data up with no extra step. It is gitignored, and the Pages deploy runs from
# a clean checkout where it does not exist, which is what makes the published
# copy fall back to the invented people.
OUT = os.path.join(ROOT, "app", "public", "data.js")

PROFILE = os.path.join(ROOT, "inputs", "profile.md")


def _from_address():
    """The address outreach is sent from.

    Read out of the gitignored profile rather than written here: this file is
    tracked and the repo is public, so a literal address would be scraped off
    GitHub within a day. Falls back to a placeholder so a clone still runs.
    """
    env = os.environ.get("CAREER_FROM")
    if env:
        return env.strip()
    if os.path.exists(PROFILE):
        with io.open(PROFILE, encoding="utf-8") as fh:
            m = re.search(r"^FROM:\s*(\S+@\S+)\s*$", fh.read(), re.M)
        if m:
            return m.group(1)
    return "you@example.com"


FROM = _from_address()

ROLE_LOCALS = ("jobs", "career", "hiring", "recruit", "talent", "hello", "info",
               "team", "contact", "people", "apply", "join", "work", "hr")


def _read(name):
    path = os.path.join(ROOT, "data", name)
    if not os.path.exists(path):
        return []
    out = []
    with io.open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def _is_role_inbox(email):
    local = email.split("@")[0].lower()
    return any(w in local for w in ROLE_LOCALS)


def _first_name(name, email):
    if name:
        return name.split()[0]
    local = email.split("@")[0]
    if _is_role_inbox(email) or not local.isalpha():
        return ""
    return local.capitalize()


def _apply_url(posting):
    """The application link out of the raw posting, if the posting stated one."""
    if not posting:
        return None
    m = re.search(r'(?:Apply|apply)(?:\s+here)?:?\s*(https?://\S+)', posting)
    if not m:
        return None
    return m.group(1).rstrip('.,)')


# Weights for everything below the source. Named rather than inlined so
# SOURCE_BONUS can be derived from their sum instead of guessed: add a new signal
# below and the source bonus grows with it, so Next Play cannot quietly stop
# leading the list the way it did when the bonus was a flat 40.
FACT_WEIGHT = 100
LOC_WEIGHT = (35, 28, 20, 12, 6, 0)
ROLE_WEIGHT = (30, 22, 16, 12, 0)
STAGE_WEIGHT = (14, 8, 4, 0)
FLAG_WEIGHTS = {"name": 30, "github": 20, "not_role_inbox": 15,
                "intern": 12, "apply": 6, "remote": 4}

MAX_TIEBREAK = (FACT_WEIGHT + LOC_WEIGHT[0] + ROLE_WEIGHT[0] + STAGE_WEIGHT[0]
                + sum(FLAG_WEIGHTS.values()))

# One more than a perfect score on everything else, so the source sorts first
# outright rather than merely heavily - which is what queue_daily.rank has always
# done, source_rank being the first element of its tuple.
SOURCE_BONUS = MAX_TIEBREAK + 1


def _tiebreak(person):
    """Everything the ranking considers *after* the source."""
    s = 0
    # A researched fact outweighs every remaining signal combined, because the
    # fact is what makes the message not-spam.
    if person["fact"]:
        s += FACT_WEIGHT
    # Stated preferences, Sept 6 2026: SF > NY > US > Vancouver, and AI-app >
    # front-end > GTM > forward-deployed. Below the fact, because a perfectly
    # located company with nothing specific to say is still a spam email.
    s += LOC_WEIGHT[person["locRank"]]
    s += ROLE_WEIGHT[person["roleRank"]]
    # Startups first: the founder reads their own email and there is no req
    # number to be filtered by. queue_daily.rank has always sorted on this;
    # leaving it out here made the app's order disagree with the queue's.
    s += STAGE_WEIGHT[person["stageRank"]]
    if person["name"]:
        s += FLAG_WEIGHTS["name"]
    if person["method"] == "github_commits":
        s += FLAG_WEIGHTS["github"]
    if not person["roleInbox"]:
        s += FLAG_WEIGHTS["not_role_inbox"]
    if person["mentionsIntern"]:
        s += FLAG_WEIGHTS["intern"]
    if person["applyUrl"]:
        s += FLAG_WEIGHTS["apply"]
    if person["remote"] in ("remote", "hybrid"):
        s += FLAG_WEIGHTS["remote"]
    return s


def _score(person):
    """Rank the queue. Source first and on its own - Next Play is curated, small,
    and skews toward the roles Matt actually wants, so all four of those come
    before the 184 HN contacts even when an HN contact is better on every other
    axis. Everything else breaks ties inside a source."""
    bonus = SOURCE_BONUS if person["source"] == "next_play" else 0
    return bonus + _tiebreak(person)


def order_key(p):
    """The order the app reads people in. It never sorts - Today slices the list
    as it arrives - so this is the ranking, and data.example.js has to be stored
    in it too or the published demo shows an order the rules do not produce."""
    return (-p["score"], p["company"].lower())


def person(contact, company, research):
    """One row of the app's data, from one contact.

    Split out of run() so the field set has a single definition that a test can
    call with no store on disk - app/public/data.example.js has to carry exactly
    these keys or a clone exercises different code paths than the real thing.
    """
    c, co, r = contact, company, research
    posting = co.get("raw_posting") or ""
    title = c.get("title") or ""
    repo = title[len("commits to "):] if title.startswith("commits to ") else None
    p = {
        "id": c["email"].lower(),
        "email": c["email"],
        "name": c.get("name"),
        "first": _first_name(c.get("name"), c["email"]),
        # Cleaned here as well as at ingest, so the 40-odd records already
        # carrying "Adyen (  )" come out right without rewriting the store.
        "company": store.clean_company_name(c.get("company_name")) or c["domain"],
        "domain": c["domain"],
        "repo": repo,
        "method": c.get("method"),
        "github": c.get("github"),
        "evidenceUrl": c.get("evidence_url"),
        "roleInbox": _is_role_inbox(c["email"]),
        "tier": co.get("tier") or "unknown",
        "what": co.get("what_they_build"),
        "location": co.get("location"),
        "remote": co.get("remote_policy"),
        "stage": co.get("stage"),
        "mentionsIntern": bool(co.get("mentions_intern")),
        "stageRank": prefs.stage_rank(co),
        "source": ((co.get("sources") or [{}])[0].get("source")
                   if prefs.source_rank(co) else "next_play"),
        "locRank": prefs.location_rank(co),
        "loc": prefs.LOC_LABEL[prefs.location_rank(co)],
        "roleRank": prefs.role_rank(co),
        "roleFit": prefs.ROLE_LABEL[prefs.role_rank(co)],
        "postingUrl": (co.get("sources") or [{}])[0].get("url"),
        "applyUrl": _apply_url(posting),
        "fact": r.get("fact"),
        "ask": r.get("ask"),
        "cite": r.get("cite"),
        "citeUrl": r.get("cite_url"),
    }
    p["score"] = _score(p)
    return p


# --------------------------------------------------------------------- ledger
#
# SEED.ledger. app/src/ledger/types.ts is the contract, and its field names are
# the wire format: camelCase here even though every jsonl file read is
# snake_case. Everything below the loader is pure, so the tests can feed it rows
# without a store on disk.

try:
    from zoneinfo import ZoneInfo
    PACIFIC = ZoneInfo("America/Vancouver")
except Exception:  # no tz database: astimezone(None) is the machine, which is Pacific
    PACIFIC = None

PERSON_STATES = ("new", "queued", "contacted", "awaiting_reply", "replied", "dead",
                 "bounced", "met", "friend")

# mark.py stamps "<outcome>_at" on every outcome. These are the ones where a
# message actually went one way or the other. queued_at is a draft nobody sent,
# dead_at is a decision, and created_at is when the pipeline found them.
TOUCHES = ("sent_at", "replied_at", "positive_at", "negative_at", "bounced_at")

HOW = {"github_commits": "GitHub commits", "hn_posting": "Hacker News posting",
       "research": "web research", "manual_add": "manual add"}

# A field *holding* a LinkedIn URL, not free text mentioning one: a draft or a
# note can carry his own profile link in the signature.
LINKEDIN = re.compile(r"^https?://([\w-]+\.)?linkedin\.com/\S+$", re.I)

TERM = re.compile(r"^([WSF]\d{2})\b")

PERSON_DEFAULTS = {"name": None, "company": None, "title": None, "email": None,
                   "linkedin": None, "how": None, "state": "new", "last": None,
                   "canRefer": False, "note": None}
COMPANY_DEFAULTS = {"domain": None, "why": None, "star": False, "note": None}
OSS_DEFAULTS = {"project": "", "repo": None, "link": None, "status": "exploring",
                "company": None, "note": None, "added": ""}
LEARN_DEFAULTS = {"topic": "", "why": None, "link": None, "status": "todo",
                  "note": None, "added": ""}
OUTREACH_DEFAULTS = {"name": "", "company": None, "channel": "email", "what": "",
                     "sent": "", "followedUp": None, "status": "sent", "note": None}
CHAT_DEFAULTS = {"type": "coffee", "company": "", "who": None, "when": None, "where": None,
                 "status": "upcoming", "prep": None, "notes": None, "added": ""}


def company_id(name):
    """Company.id. Mirrors companyId() in app/src/ledger/types.ts exactly - the
    app derives the same id from a name typed into it, and the two have to meet."""
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")


def local_day(ts):
    """The Pacific calendar day a stored UTC timestamp fell on. A bare date is
    already a local day and passes through: read as UTC midnight it would land
    on the day before."""
    if not ts:
        return None
    s = str(ts).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    try:
        dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(PACIFIC).strftime("%Y-%m-%d")


def _term(row):
    if row.get("term"):
        return row["term"]
    m = TERM.match(row.get("title") or "")
    return m.group(1) if m else None


def application(row, saved=False):
    """One Application from an applications.jsonl row, or from an
    open_postings.jsonl row when saved=True."""
    referral = row.get("referral") or ("want" if row.get("hold") == "referral" else "none")
    return {
        "id": str(row.get("job_id")),
        "company": row.get("company") or "",
        "title": row.get("title") or "",
        "status": "saved" if saved else (row.get("status") or "applied"),
        "via": row.get("via"),
        "term": _term(row),
        "deadline": row.get("deadline"),
        "submitted": None if saved else local_day(row.get("submitted_at")),
        "link": row.get("link"),
        "where": row.get("where"),
        "referral": referral,
        "referrer": row.get("referrer"),
        "hold": row.get("hold"),
        "note": row.get("note"),
        "events": [{"at": e.get("at"), "status": e.get("status"), "note": e.get("note") or ""}
                   for e in row.get("events") or []],
    }


def ledger_applications(applied, postings):
    """Submitted applications, then the postings still to apply to.

    A posting sharing its id with a submitted application is the other half of
    one job (Planview: SCOPE half in, careers-portal half still open). Only the
    application is emitted, and it borrows where to find the posting - from any
    posting with that id, applied ones included, since settle_posting does not
    copy `where` or `term` across when it moves a posting in.
    """
    apps = [application(r) for r in applied]
    by_id = dict((a["id"], a) for a in apps)
    for p in postings:
        pid = str(p.get("job_id"))
        if pid in by_id:
            a = by_id[pid]
            for k in ("where", "link", "term"):
                if not a[k] and p.get(k):
                    a[k] = p[k]
            continue
        if (p.get("status") or "open") in ("applied", "skipped"):
            continue
        a = application(p, saved=True)
        by_id[pid] = a
        apps.append(a)
    return apps


def _linkedin(contact):
    for k in ["linkedin"] + sorted(contact):
        v = contact.get(k)
        if isinstance(v, str) and LINKEDIN.match(v.strip()):
            return v.strip()
    return None


def _how(contact, company):
    m = contact.get("method")
    # An address out of posting text is "hn_posting" whichever feed the posting
    # came in on; source_rank 0 is Next Play.
    if m == "hn_posting" and company.get("sources") and prefs.source_rank(company) == 0:
        return "Next Play newsletter"
    return HOW.get(m) or (m.replace("_", " ") if m else None)


def ledger_person(contact, company):
    """One LedgerPerson from a contacts.jsonl row and its companies.jsonl record."""
    c = contact
    name = store.clean_company_name(c.get("company_name")) or c.get("domain")
    email = c.get("email") or None
    days = [d for d in (local_day(c.get(k)) for k in TOUCHES) if d]
    return {
        "id": email.lower() if email else "p-%s-%s" % (company_id(c.get("name")), company_id(name)),
        "name": c.get("name"),
        "company": name,
        "title": c.get("title"),
        "email": email,
        "linkedin": _linkedin(c),
        "how": _how(c, company or {}),
        "state": c.get("state") if c.get("state") in PERSON_STATES else "new",
        "last": max(days) if days else None,
        "canRefer": False,
        "note": None,
    }


def _fold(rows):
    """data/ledger.jsonl folded per (kind, id), later rows merged over earlier."""
    out = {}
    for r in rows:
        if not r.get("kind") or r.get("id") is None:
            continue
        key = (r["kind"], str(r["id"]))
        out[key] = dict(out.get(key, {}), **r)
    return out


def _fields(row):
    return dict((k, v) for k, v in row.items() if k not in ("kind", "id", "deleted"))


def build_ledger(applied, postings, contacts, companies, rows, applied_edits=()):
    """LedgerSeed from the store's rows. Pure."""
    folded = _fold(rows)
    gone = set(k for k, r in folded.items() if r.get("deleted"))

    by_domain = dict((c["domain"], c) for c in companies if c.get("domain"))
    by_cid = {}
    for c in companies:
        k = company_id(store.clean_company_name(c.get("name")))
        if k and (k not in by_cid or (c.get("what_they_build")
                                      and not by_cid[k].get("what_they_build"))):
            by_cid[k] = c

    apps = [a for a in ledger_applications(applied, postings)
            if ("application", a["id"]) not in gone]

    people, domains = {}, {}
    for c in contacts:
        # resolve-contacts' record of a lookup that found nobody: an attempt,
        # not a person. Email-less manual adds (LinkedIn founders) are people.
        if c.get("state") == "resolved_none":
            continue
        p = ledger_person(c, by_domain.get(c.get("domain")))
        if p["id"] not in people:
            people[p["id"]] = p
            domains[p["id"]] = (company_id(p["company"]), c.get("domain"))

    def overlay(kind, into, defaults):
        for (k, eid), row in folded.items():
            if k != kind:
                continue
            if row.get("deleted"):
                into.pop(eid, None)
                continue
            base = into.get(eid) or dict({"id": eid}, **defaults)
            into[eid] = dict(base, **_fields(row))
        return into

    overlay("person", people, PERSON_DEFAULTS)

    comps = {}

    def derive(name, domain=None):
        cid = company_id(name)
        if not cid:
            return
        rec = (by_domain.get(domain) if domain else None) or by_cid.get(cid) or {}
        c = comps.setdefault(cid, dict({"id": cid, "name": name}, **COMPANY_DEFAULTS))
        c["domain"] = c["domain"] or rec.get("domain") or domain
        c["why"] = c["why"] or rec.get("what_they_build")

    for a in apps:
        derive(a["company"])
    for p in people.values():
        hint = domains.get(p["id"])
        derive(p["company"], hint[1] if hint and hint[0] == company_id(p["company"]) else None)
    # A company added in the app: still filled from companies.jsonl when known.
    for (k, eid), row in folded.items():
        if k == "company" and not row.get("deleted") and eid not in comps:
            name = row.get("name") or eid
            rec = by_cid.get(eid) or by_cid.get(company_id(name)) or {}
            comps[eid] = dict({"id": eid, "name": name}, **COMPANY_DEFAULTS)
            comps[eid].update(domain=rec.get("domain"), why=rec.get("what_they_build"))
    overlay("company", comps, dict({"name": None}, **COMPANY_DEFAULTS))

    return {
        "applications": apps,
        "people": list(people.values()),
        "companies": list(comps.values()),
        "opensource": list(overlay("opensource", {}, OSS_DEFAULTS).values()),
        "learning": list(overlay("learning", {}, LEARN_DEFAULTS).values()),
        "outreach": list(overlay("outreach", {}, OUTREACH_DEFAULTS).values()),
        "chats": list(overlay("chat", {}, CHAT_DEFAULTS).values()),
        "appliedEdits": [str(e) for e in applied_edits],
    }


def _applied_edits():
    if not os.path.exists(store.LEDGER_IMPORTED):
        return []
    with io.open(store.LEDGER_IMPORTED, encoding="utf-8") as fh:
        text = fh.read()
    return (json.loads(text).get("applied") or []) if text.strip() else []


def load_ledger():
    """SEED.ledger from the files named in store. A missing file reads as empty."""
    return build_ledger(store.read(store.APPLICATIONS), store.read(store.OPEN_POSTINGS),
                        store.read(store.CONTACTS), store.read(store.COMPANIES),
                        store.read(store.LEDGER), _applied_edits())


def run(argv=None):
    companies = dict((c["domain"], c) for c in _read("companies.jsonl"))
    research = dict((r["email"], r) for r in _read("research.jsonl"))
    contacts = _read("contacts.jsonl")

    # resolve-contacts writes an email-less row for a domain it looked at and
    # found nothing on, so the retry window has something to move. That is a
    # record of an attempt, not a person, and it has no id to key state by.
    contacts = [c for c in contacts if c.get("email")]

    people = [person(c, companies.get(c["domain"], {}), research.get(c["email"], {}))
              for c in contacts]

    people.sort(key=order_key)

    payload = {
        "generated": datetime.date.today().strftime("%Y-%m-%d"),
        "from": FROM,
        "counts": {
            "people": len(people),
            "researched": len([p for p in people if p["fact"]]),
            "named": len([p for p in people if p["name"]]),
            "companies": len(companies),
            "unworked": len([d for d, co in companies.items()
                             if co.get("state") == "enriched"
                             and d not in set(c["domain"] for c in contacts)]),
        },
        "people": people,
        # The ledger views read this; the views above still read `people` until
        # they are replaced, so both ship side by side for now.
        "ledger": load_ledger(),
    }

    body = ("/* generated by scripts/jobs/export_app.py - do not edit */\n"
            "window.SEED = " + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n")

    written = [OUT]
    with io.open(OUT, "w", encoding="utf-8") as fh:
        fh.write(body)

    # And into an existing build, if there is one. `npm run dev` reads public/
    # live, but a built copy opened straight off disk would otherwise show
    # whatever the data looked like at the last `npm run build` - and this runs
    # from cron at 7:45am, when nobody is around to rebuild. Only ever writes
    # into a directory that already exists, so it never creates a stale dist.
    dist = os.path.join(ROOT, "app", "dist")
    if os.path.isdir(dist):
        dist_out = os.path.join(dist, "data.js")
        with io.open(dist_out, "w", encoding="utf-8") as fh:
            fh.write(body)
        written.append(dist_out)

    print("wrote %s" % ", ".join(written))
    ledger = payload["ledger"]
    saved = len([a for a in ledger["applications"] if a["status"] == "saved"])
    return ("%(people)d people, %(researched)d with a researched fact, "
            "%(named)d named, %(unworked)d companies still without a contact"
            % payload["counts"]
            + "; ledger: %d applications (%d saved), %d people, %d companies"
            % (len(ledger["applications"]), saved, len(ledger["people"]),
               len(ledger["companies"])))
