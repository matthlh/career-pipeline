"""Pull companies out of Hacker News 'Who is Hiring' threads via the Algolia API.

Public, documented, no key. This is the most reliable source we have, which is
why the bootstrap starts here.
"""
import json
import re
import sys
import time
import urllib.request

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store

ALGOLIA = "https://hn.algolia.com/api/v1"
INTERN_PAT = re.compile(r"\bintern(ship)?s?\b", re.I)
URL_PAT = re.compile(r"https?://([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})")
EMAIL_PAT = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

# Big-co and aggregator domains that are never the target.
SKIP = {
    "news.ycombinator.com", "ycombinator.com", "github.com", "linkedin.com",
    "twitter.com", "x.com", "google.com", "docs.google.com", "notion.so",
    "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "bamboohr.com",
    "youtube.com", "medium.com", "gmail.com", "wellfound.com", "angel.co",
    "amazon.com", "microsoft.com", "apple.com", "meta.com", "netflix.com",
    "forms.gle", "bit.ly", "substack.com", "deel.com", "hacker-job.com",
    "breezy.hr", "recruitee.com", "jobvite.com", "smartrecruiters.com",
    "workatastartup.com", "rippling.com", "hire.withgoogle.com", "typeform.com",
    "calendly.com", "loom.com", "imgur.com", "reddit.com", "discord.com",
    "discord.gg", "slack.com", "t.me", "wikipedia.org", "arxiv.org",
}


def is_skipped(domain):
    """Suffix match, so jobs.ashbyhq.com is caught by ashbyhq.com."""
    for bad in SKIP:
        if domain == bad or domain.endswith("." + bad):
            return True
    return False


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "career-pipeline/1.0"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == 4:
                raise
            wait = 2 ** attempt
            print("  retry in %ds (%s)" % (wait, e))
            time.sleep(wait)


def find_threads(months):
    """Whoishiring posts the monthly thread. Grab the most recent `months` of them."""
    data = fetch("%s/search_by_date?tags=story,author_whoishiring&hitsPerPage=40" % ALGOLIA)
    threads = []
    for hit in data.get("hits", []):
        title = hit.get("title") or ""
        if "who is hiring" in title.lower():
            threads.append({"id": hit["objectID"], "title": title, "date": hit.get("created_at")})
    return threads[:months]


def parse_comment(text, thread_title, thread_id, comment_id):
    """A top-level comment is one company's posting. Pull out domain and signals."""
    if not text:
        return None

    import html as _html
    plain = re.sub(r"<[^>]+>", " ", text)
    plain = _html.unescape(_html.unescape(plain))
    plain = re.sub(r"\s+", " ", plain).strip()

    domains = []
    for m in URL_PAT.finditer(text.replace("&#x2F;", "/")):
        d = store.normalize_domain(m.group(1))
        if d and not is_skipped(d) and d not in domains:
            domains.append(d)
    if not domains:
        return None

    emails = [e for e in EMAIL_PAT.findall(plain)
              if not is_skipped(store.normalize_domain(e.split("@")[1]) or "")]

    # The first line is conventionally "Company | Role | Location | ..."
    first_line = plain[:200]
    name = first_line.split("|")[0].strip()
    name = re.sub(r"https?://\S+", "", name).strip(" -|:,\u2013")
    if len(name) > 60 or not name:
        name = domains[0]

    # If one of the linked domains echoes the company name, that is the real one.
    slug = re.sub(r"[^a-z0-9]", "", name.lower())
    if slug:
        for d in domains:
            if slug and slug in re.sub(r"[^a-z0-9]", "", d):
                domains = [d] + [x for x in domains if x != d]
                break

    return {
        "domain": domains[0],
        "name": name,
        "state": "new",
        "raw_posting": plain[:2000],
        "direct_email": emails[0] if emails else None,
        "mentions_intern": bool(INTERN_PAT.search(plain)),
        "sources": [{
            "source": "hn_whoishiring",
            "thread": thread_title,
            "url": "https://news.ycombinator.com/item?id=%s" % comment_id,
            "seen_at": store.now(),
        }],
    }


def run(months=6):
    threads = find_threads(months)
    if not threads:
        raise RuntimeError("Algolia returned no whoishiring threads. Source may have changed.")

    print("Found %d threads" % len(threads))
    new_count = 0
    seen_count = 0

    for t in threads:
        print("\n%s (%s)" % (t["title"], t["date"][:10]))
        data = fetch("%s/items/%s" % (ALGOLIA, t["id"]))
        children = data.get("children") or []
        print("  %d top-level comments" % len(children))

        batch = []
        for child in children:
            if child.get("type") != "comment":
                continue
            rec = parse_comment(child.get("text"), t["title"], t["id"], child.get("id"))
            if rec:
                batch.append(rec)

        n, m = store.upsert_companies(batch)
        new_count += n
        seen_count += m
        print("  parsed %d postings, %d new" % (len(batch), n))

    print("\nnew: %d, already known: %d" % (new_count, seen_count))
    return {"new": new_count, "seen": seen_count, "threads": len(threads)}
