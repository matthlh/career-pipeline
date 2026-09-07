"""Record store. JSONL files on disk, keyed by domain (companies) or email (contacts).

Whole-file atomic rewrite on every save. At our scale (low thousands of records)
this is fast, and it means a killed job never leaves a half-written file.
"""
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

COMPANIES = os.path.join(DATA, "companies.jsonl")
CONTACTS = os.path.join(DATA, "contacts.jsonl")
OUTREACH = os.path.join(DATA, "outreach.jsonl")
APPLICATIONS = os.path.join(DATA, "applications.jsonl")

ENRICH_TTL_DAYS = 60

# How long a written-but-unsent draft keeps its contact out of the queue.
#
# `queued` used to block forever, which made it a terminal state for anyone who
# was drafted and not sent - and since the whole difficulty here is that drafts
# do not get sent, the daily queue would have quietly eaten the contact pool at
# two people a day while the send count stayed at zero. A fortnight-old draft is
# stale anyway; letting it lapse costs one model call and keeps the pool honest.
QUEUE_TTL_DAYS = 14


def now():
    # Naive UTC with a Z suffix, matching every timestamp already in the store.
    # utcnow() itself is deprecated in 3.12; this is the same string without it.
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z"


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def parse_ts(s):
    """None rather than an exception on anything unparseable.

    Callers use this to decide whether a record is stale, and one malformed
    timestamp should not take down a whole job over a record it could simply
    treat as undated.
    """
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", ""))
    except (TypeError, ValueError):
        return None


def read(path):
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise ValueError("%s line %d is not valid JSON: %s" % (path, line_no, e))
    return out


def write(path, records):
    """Atomic whole-file replace. Write to temp in the same dir, then rename."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def append(path, record):
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def normalize_domain(raw):
    """Strip protocol, www, path, port. Lowercase. This is the dedupe key."""
    if not raw:
        return None
    d = raw.strip().lower()
    for prefix in ("https://", "http://"):
        if d.startswith(prefix):
            d = d[len(prefix):]
    if d.startswith("www."):
        d = d[4:]
    d = d.split("/")[0].split("?")[0].split(":")[0].strip()
    if "." not in d or " " in d:
        return None
    return d


def upsert_company(record):
    """Insert by domain, or merge into the existing record. Returns (record, is_new)."""
    domain = normalize_domain(record.get("domain"))
    if not domain:
        raise ValueError("company record has no usable domain: %r" % record.get("domain"))
    record["domain"] = domain

    companies = read(COMPANIES)
    by_domain = {c["domain"]: c for c in companies}

    if domain in by_domain:
        existing = by_domain[domain]
        sources = existing.get("sources", [])
        for s in record.get("sources", []):
            if s not in sources:
                sources.append(s)
        existing["sources"] = sources
        existing["last_seen"] = now()
        write(COMPANIES, companies)
        return existing, False

    record.setdefault("state", "new")
    record.setdefault("sources", [])
    record.setdefault("first_seen", now())
    record["last_seen"] = now()
    companies.append(record)
    write(COMPANIES, companies)
    return record, True


def save_companies(records):
    write(COMPANIES, records)


def companies_in_state(*states):
    return [c for c in read(COMPANIES) if c.get("state") in states]


def stale_companies():
    """Enriched records past their TTL go back in the queue."""
    cutoff = utcnow() - timedelta(days=ENRICH_TTL_DAYS)
    out = []
    for c in read(COMPANIES):
        if c.get("state") != "enriched":
            continue
        ts = parse_ts(c.get("enriched_at"))
        if ts and ts < cutoff:
            out.append(c)
    return out


def contacts_for(domain):
    return [c for c in read(CONTACTS) if c.get("domain") == domain]


def upsert_contact(record):
    """Dedupe on email when we have one, otherwise on domain+name."""
    contacts = read(CONTACTS)
    email = (record.get("email") or "").strip().lower()
    if email:
        record["email"] = email
        for i, c in enumerate(contacts):
            if (c.get("email") or "").lower() == email:
                return c, False
    else:
        for c in contacts:
            if c.get("domain") == record.get("domain") and c.get("name") == record.get("name"):
                return c, False

    record.setdefault("state", "new")
    record.setdefault("created_at", now())
    contacts.append(record)
    write(CONTACTS, contacts)
    return record, True


def save_contacts(records):
    write(CONTACTS, records)


# Reaching any of these means the person has actually heard from you, or never
# should. They never come back.
TERMINAL_STATES = ("contacted", "awaiting_reply", "replied", "dead", "bounced")


def already_touched_emails():
    """Addresses the queue must not pick.

    Terminal states are permanent. `queued` is not a terminal state - it means a
    draft exists, not that anyone received anything - so it only holds for
    QUEUE_TTL_DAYS and then the contact is eligible again.
    """
    blocked = set()
    cutoff = utcnow() - timedelta(days=QUEUE_TTL_DAYS)
    for c in read(CONTACTS):
        state = c.get("state")
        if state in TERMINAL_STATES:
            pass
        elif state == "queued":
            ts = parse_ts(c.get("queued_at"))
            if ts is not None and ts < cutoff:
                continue          # draft went stale unsent; put them back in play
        else:
            continue
        email = (c.get("email") or "").lower()
        if email:
            blocked.add(email)
    return blocked


def suppressed_domains():
    path = os.path.join(ROOT, "inputs", "suppress.txt")
    if not os.path.exists(path):
        return set()
    out = set()
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                d = normalize_domain(line) or line.lower()
                out.add(d)
    return out


def upsert_companies(records):
    """Batch version of upsert_company. One read, one write. Returns (new, merged)."""
    companies = read(COMPANIES)
    by_domain = {c["domain"]: c for c in companies}
    new_count = 0
    merged_count = 0

    for record in records:
        domain = normalize_domain(record.get("domain"))
        if not domain:
            continue
        record["domain"] = domain

        if domain in by_domain:
            existing = by_domain[domain]
            sources = existing.get("sources", [])
            for s in record.get("sources", []):
                if s not in sources:
                    sources.append(s)
            existing["sources"] = sources
            existing["last_seen"] = now()
            if record.get("direct_email") and not existing.get("direct_email"):
                existing["direct_email"] = record["direct_email"]
            if record.get("mentions_intern"):
                existing["mentions_intern"] = True
            merged_count += 1
        else:
            record.setdefault("state", "new")
            record.setdefault("sources", [])
            record.setdefault("first_seen", now())
            record["last_seen"] = now()
            companies.append(record)
            by_domain[domain] = record
            new_count += 1

    write(COMPANIES, companies)
    return new_count, merged_count


class JobLock(object):
    """Only one job writes the store at a time.

    Every job touches companies.jsonl, and whole-file writes mean a concurrent
    job silently discards the other's work. Cron fires these on overlapping
    schedules, so this is not hypothetical.
    """

    def __init__(self, name):
        self.path = os.path.join(ROOT, "state", "%s.lock" % name)
        self.fh = None

    def __enter__(self):
        import fcntl
        self.fh = open(self.path, "w")
        try:
            fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except IOError:
            self.fh.close()
            raise RuntimeError(
                "another job holds the store lock (%s). It is safe to just try again later."
                % os.path.basename(self.path))
        self.fh.write(str(os.getpid()))
        self.fh.flush()
        return self

    def __exit__(self, *exc):
        import fcntl
        fcntl.flock(self.fh, fcntl.LOCK_UN)
        self.fh.close()
