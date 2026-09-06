"""Rewrite STATUS.md. Under 20 lines. This is Matt's interface to the pipeline."""
import json
import os
import sys
from collections import Counter

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store

ROOT = store.ROOT


def _recent_errors(n=3):
    path = os.path.join(ROOT, "state", "errors.jsonl")
    if not os.path.exists(path):
        return []
    lines = [l for l in open(path, encoding="utf-8").read().splitlines() if l.strip()]
    out = []
    for line in lines[-n:]:
        rec = json.loads(line)
        first = rec["error"].strip().splitlines()[-1][:90]
        out.append("%s %s: %s" % (rec["at"][:16], rec["job"], first))
    return out


def run():
    companies = store.read(store.COMPANIES)
    contacts = store.read(store.CONTACTS)
    outreach = store.read(store.OUTREACH)

    cstates = Counter(c.get("state", "?") for c in companies)
    kstates = Counter(c.get("state", "?") for c in contacts)
    confidence = Counter(c.get("confidence", "?") for c in contacts if c.get("email"))

    sent = [o for o in outreach if o.get("status") in ("sent", "bounced", "replied")]
    bounced = [o for o in outreach if o.get("status") == "bounced"]
    bounce_rate = (100.0 * len(bounced) / len(sent)) if sent else 0.0

    needs = os.path.join(ROOT, "NEEDS_YOU.md")
    needs_lines = 0
    if os.path.exists(needs):
        needs_lines = len([l for l in open(needs, encoding="utf-8") if l.strip().startswith("- [ ]")])

    voice_dir = os.path.join(ROOT, "inputs", "voice")
    has_voice = os.path.exists(voice_dir) and any(
        f.endswith(".md") for f in os.listdir(voice_dir))

    lines = [
        "# STATUS",
        "",
        "Updated: %s" % store.now(),
        "",
        "**Companies** %d total | new %d | enriched %d | dead %d | failed %d" % (
            len(companies), cstates.get("new", 0), cstates.get("enriched", 0),
            cstates.get("dead", 0), cstates.get("enrich_failed", 0)),
        "**Contacts** %d total | resolved %d (verified %d, guess %d) | queued %d | contacted %d" % (
            len(contacts),
            sum(1 for c in contacts if c.get("email")),
            confidence.get("verified", 0), confidence.get("pattern_guess", 0),
            kstates.get("queued", 0), kstates.get("contacted", 0)),
        "**Outreach** sent %d | awaiting reply %d | replied %d | bounced %d (%.1f%%)" % (
            len(sent), kstates.get("awaiting_reply", 0), kstates.get("replied", 0),
            len(bounced), bounce_rate),
        "",
        "**Backlog** enrich %d | resolve %d" % (
            cstates.get("new", 0) + len(store.stale_companies()),
            sum(1 for c in companies if c.get("state") == "enriched"
                and not store.contacts_for(c["domain"])),
        ),
    ]

    if bounce_rate > 5.0 and len(sent) >= 20:
        lines += ["", "> **WARNING** bounce rate %.1f%% is over 5%%. pattern_guess queuing is OFF." % bounce_rate]
    if not has_voice:
        lines += ["", "> No voice samples in inputs/voice. Drafts are disabled."]
    if needs_lines:
        lines += ["", "> NEEDS_YOU.md has %d open item(s)." % needs_lines]

    errors = _recent_errors()
    if errors:
        lines += ["", "Last errors:"] + ["- `%s`" % e for e in errors]

    with open(os.path.join(ROOT, "STATUS.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return {"companies": len(companies), "contacts": len(contacts)}
