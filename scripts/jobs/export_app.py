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


def run(argv=None):
    companies = dict((c["domain"], c) for c in _read("companies.jsonl"))
    research = dict((r["email"], r) for r in _read("research.jsonl"))
    contacts = _read("contacts.jsonl")

    people = [person(c, companies.get(c["domain"], {}), research.get(c["email"], {}))
              for c in contacts]

    people.sort(key=lambda p: (-p["score"], p["company"].lower()))

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
    return ("%(people)d people, %(researched)d with a researched fact, "
            "%(named)d named, %(unworked)d companies still without a contact"
            % payload["counts"])
