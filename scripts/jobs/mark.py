"""Record what happened after a send. This is the only way outcome data enters the store.

    run.py mark <email> sent|replied|positive|negative|bounced|dead

Without this the ranking never learns and follow-up fires at people who already
replied, so it matters more than its size suggests.
"""
import sys

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store

TRANSITIONS = {
    "sent": "awaiting_reply",
    "replied": "replied",
    "positive": "replied",
    "negative": "dead",
    "bounced": "bounced",
    "dead": "dead",
}


def run(**kwargs):
    args = [a for a in sys.argv[2:] if "=" not in a]
    if len(args) != 2:
        raise SystemExit("usage: run.py mark <email> %s" % "|".join(TRANSITIONS))

    email, outcome = args[0].lower(), args[1].lower()
    if outcome not in TRANSITIONS:
        raise SystemExit("unknown outcome %r, expected one of: %s" % (outcome, ", ".join(TRANSITIONS)))

    contacts = store.read(store.CONTACTS)
    match = [c for c in contacts if (c.get("email") or "").lower() == email]
    if not match:
        raise SystemExit("no contact with email %s" % email)

    contact = match[0]
    previous = contact.get("state")
    contact["state"] = TRANSITIONS[outcome]
    contact["%s_at" % outcome] = store.now()

    if outcome == "bounced":
        # The address is dead, the company is not. Clear it so resolve can try again.
        contact["address_dead"] = True

    store.save_contacts(contacts)
    store.append(store.OUTREACH, {
        "email": email,
        "domain": contact.get("domain"),
        "outcome": outcome,
        "status": "bounced" if outcome == "bounced" else ("replied" if outcome in ("replied", "positive", "negative") else "sent"),
        "positive": outcome == "positive",
        "at": store.now(),
    })

    print("%s: %s -> %s" % (email, previous, contact["state"]))
    if outcome == "bounced":
        print("  address marked dead. re-run resolve-contacts to find someone else at %s"
              % contact.get("domain"))
    return {"email": email, "outcome": outcome}
