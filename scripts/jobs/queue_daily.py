"""Build today's outreach list and write drafts.

20 contacts a day, initial sends plus follow-ups combined. Fewer if there are
fewer good ones. We never pad.
"""
import io
import os
import sys
from datetime import datetime

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store
import llm
import prefs

DAILY_TARGET = 20
MAX_PATTERN_GUESS = 5

_DRAFT_TEMPLATE = """Write a cold email to a founder. Match the sender's voice exactly.

__PROFILE__

THE COMPANY:
name: %s
what they build: %s
the specific fact we found: %s
source: %s
person: %s (%s)

EXACT SHAPE TO FOLLOW:

Hi [First]!

My name is Matt, I'm a third-year CS student at UBC. [One sentence referencing the specific
fact.] [One more sentence showing you understand what they actually build and why that
specific fact matters to it.]

[One sentence connecting his relevant experience to THAT problem, concretely.] Looking for a
summer 2027 internship and would love 15 minutes to hear what you're working on.

Thanks!
Matt | [github.com/matthlh](https://github.com/matthlh)

FORMATTING RULES:
- Exactly one blank line between paragraphs. Never a blank line inside a paragraph.
- Do NOT hard-wrap lines. Each paragraph is one continuous line of text.
- Links must be markdown: [visible text](url). Never paste a bare URL.
- If the specific fact is null, generic, or something you could have guessed about any
  company in this space, output exactly INSUFFICIENT_CONTEXT and nothing else.
- Output the email body only. No subject line, no preamble, no commentary.
"""


PROFILE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "inputs", "profile.md")


def _profile():
    """Voice samples and CV bullets live outside the repo. They are personal data
    and this repo is public. See inputs/profile.example.md for the shape."""
    if not os.path.exists(PROFILE_PATH):
        raise RuntimeError(
            "missing inputs/profile.md - copy inputs/profile.example.md and fill it in")
    with io.open(PROFILE_PATH, encoding="utf-8") as fh:
        text = fh.read().strip()
    if not text:
        raise RuntimeError("inputs/profile.md is empty - a draft without a voice is filler")
    return text


DRAFT_PROMPT = _DRAFT_TEMPLATE.replace("__PROFILE__", _profile())


def rank(company, contact):
    """Sept 6 2026 ordering. Source first, because Next Play is curated and small;
    then geography and role, which are the two things Matt actually stated a
    preference about.

    Work-auth tier no longer sorts. It used to push US-onsite down, which is the
    exact opposite of wanting SF. Onsite still needs a J-1 or co-op arrangement -
    that lives in the RUNBOOK paragraph, not in the ranking.
    """
    return (
        prefs.source_rank(company),
        prefs.location_rank(company),
        prefs.role_rank(company),
        0 if contact.get("confidence") == "verified" else 1,
        0 if company.get("specific_fact") else 1,
        prefs.stage_rank(company),
        0 if company.get("mentions_intern") else 1,
    )


def run(target=DAILY_TARGET, dry=0):
    companies = {c["domain"]: c for c in store.read(store.COMPANIES)}
    contacts = store.read(store.CONTACTS)
    blocked = store.already_touched_emails()
    suppressed = store.suppressed_domains()

    voice_dir = os.path.join(store.ROOT, "inputs", "voice")
    if not os.path.isdir(voice_dir) or not os.listdir(voice_dir):
        raise RuntimeError("inputs/voice is empty. Refusing to write drafts in a generic voice.")

    eligible = []
    for k in contacts:
        if k.get("state") != "new" or not k.get("email"):
            continue
        if k["email"].lower() in blocked or k.get("domain") in suppressed:
            continue
        company = companies.get(k.get("domain"))
        if not company or company.get("state") != "enriched":
            continue
        eligible.append((rank(company, k), company, k))

    eligible.sort(key=lambda t: t[0])

    picked = []
    guesses = 0
    for _, company, contact in eligible:
        if len(picked) >= int(target):
            break
        if contact.get("confidence") == "pattern_guess":
            if guesses >= MAX_PATTERN_GUESS:
                continue
            guesses += 1
        picked.append((company, contact))

    print("%d eligible, picked %d (%d pattern_guess)" % (len(eligible), len(picked), guesses))
    if dry:
        for company, contact in picked:
            print("  %-24s %-30s %s" % (company["domain"][:24], contact["email"][:30],
                                        prefs.describe(company)))
        return {"picked": len(picked), "dry": True}

    day = datetime.utcnow().strftime("%Y-%m-%d")
    out_dir = os.path.join(store.ROOT, "drafts", day)
    os.makedirs(out_dir, exist_ok=True)

    written = 0
    skipped = 0
    for company, contact in picked:
        fact = company.get("specific_fact")
        if not fact:
            print("  %-24s insufficient_context" % company["domain"][:24])
            skipped += 1
            continue

        body = llm.ask(DRAFT_PROMPT % (
            company.get("name"), company.get("what_they_build"), fact,
            company.get("specific_fact_url"), contact.get("name") or "there",
            contact.get("title") or "founder"), allow_web=False).strip()

        if "INSUFFICIENT_CONTEXT" in body:
            print("  %-24s insufficient_context (model)" % company["domain"][:24])
            skipped += 1
            continue

        first = (contact.get("name") or "").split(" ")[0] or "there"
        header = (
            "TO: %s <%s>\nCONFIDENCE: %s\nCOMPANY: %s\nTIER: %s\nTOUCH: initial\n"
            "SPECIFIC LINE: %s\nSOURCE: %s\n---\n" % (
                contact.get("name") or "(name unknown)", contact["email"],
                contact.get("confidence"), company.get("name"),
                company.get("work_auth_tier"), fact, company.get("specific_fact_url")))

        path = os.path.join(out_dir, "%s.md" % company["domain"].replace(".", "_"))
        with open(path, "w", encoding="utf-8") as f:
            f.write(header + body + "\n")

        for k in contacts:
            if k.get("email") == contact["email"]:
                k["state"] = "queued"
                k["queued_at"] = store.now()
                k["draft_path"] = os.path.relpath(path, store.ROOT)
        written += 1
        print("  %-24s drafted -> %s" % (company["domain"][:24], os.path.basename(path)))

    store.save_contacts(contacts)
    print("\n%d drafts in drafts/%s (%d skipped for thin context)" % (written, day, skipped))
    return {"drafted": written, "skipped": skipped}
