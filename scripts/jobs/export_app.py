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


def _score(person):
    """Rank the queue. A researched fact is worth more than everything else
    combined, because the fact is what makes the message not-spam."""
    s = 0
    if person["fact"]:
        s += 100
    # Stated preferences, Sept 6 2026: Next Play over HN, SF > NY > US > Vancouver,
    # AI-app > front-end > GTM > forward-deployed. Weighted below the fact, because a
    # perfectly-located company with nothing specific to say is still a spam email.
    s += 40 if person["source"] == "next_play" else 0
    s += (35, 28, 20, 12, 6, 0)[person["locRank"]]
    s += (30, 22, 16, 12, 0)[person["roleRank"]]
    # Startups first: the founder reads their own email and there is no req
    # number to be filtered by. queue_daily.rank has always sorted on this;
    # leaving it out here made the app's order disagree with the queue's.
    s += (14, 8, 4, 0)[person["stageRank"]]
    if person["name"]:
        s += 30
    if person["method"] == "github_commits":
        s += 20
    if not person["roleInbox"]:
        s += 15
    if person["mentionsIntern"]:
        s += 12
    if person["applyUrl"]:
        s += 6
    if person["remote"] in ("remote", "hybrid"):
        s += 4
    return s


def run(argv=None):
    companies = dict((c["domain"], c) for c in _read("companies.jsonl"))
    research = dict((r["email"], r) for r in _read("research.jsonl"))
    contacts = _read("contacts.jsonl")

    people = []
    for c in contacts:
        co = companies.get(c["domain"], {})
        r = research.get(c["email"], {})
        posting = co.get("raw_posting") or ""
        title = c.get("title") or ""
        repo = title[len("commits to "):] if title.startswith("commits to ") else None
        p = {
            "id": c["email"].lower(),
            "email": c["email"],
            "name": c.get("name"),
            "first": _first_name(c.get("name"), c["email"]),
            "company": c.get("company_name") or c["domain"],
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
        people.append(p)

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

    with io.open(OUT, "w", encoding="utf-8") as fh:
        fh.write("/* generated by scripts/jobs/export_app.py - do not edit */\n")
        fh.write("window.SEED = ")
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write(";\n")

    print("wrote %s" % OUT)
    return ("%(people)d people, %(researched)d with a researched fact, "
            "%(named)d named, %(unworked)d companies still without a contact"
            % payload["counts"])
