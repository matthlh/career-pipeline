"""Pull companies out of the next play newsletter (nextplayso.substack.com).

Better signal than HN. These are curated startup roles, and the publication
covers GTM engineering and forward-deployed roles specifically, which is the
half of Matt's target that HN barely surfaces.

Substack exposes a public JSON archive and full post bodies with no auth.
"""
import html
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store
import llm

PUB = "https://nextplayso.substack.com"
UA = {"User-Agent": "Mozilla/5.0 (compatible; career-pipeline/1.0)"}
WORKERS = 5

SKIP = {
    "substack.com", "nextplayso.substack.com", "linkedin.com", "twitter.com", "x.com",
    "docs.google.com", "google.com", "youtube.com", "notion.so", "airtable.com",
    "greenhouse.io", "lever.co", "ashbyhq.com", "typeform.com", "calendly.com",
    "slack.com", "medium.com", "github.com", "forms.gle", "bit.ly", "open.spotify.com",
}


def is_skipped(d):
    return any(d == s or d.endswith("." + s) for s in SKIP)


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def archive(limit):
    """Walk the archive newest-first, 50 at a time."""
    posts = []
    offset = 0
    while len(posts) < limit:
        page = fetch("%s/api/v1/archive?sort=new&limit=50&offset=%d" % (PUB, offset))
        if not page:
            break
        posts.extend(page)
        offset += 50
        if len(page) < 50:
            break
    return posts[:limit]


EXTRACT = """This is an issue of a startup jobs newsletter. Pull out every COMPANY that is
described as hiring, or profiled as a place worth joining.

Return ONLY JSON: {"companies": [{"name": "...", "domain": "the company's own website
domain, lowercase, no protocol or path", "what_they_build": "one plain sentence",
"roles_mentioned": "the roles this issue says they are hiring, or null",
"stage": "pre-seed|seed|series-a|series-b|later|unknown",
"location": "city or remote as stated, or null"}]}

The complete text of the issue is included below. You have everything you need.
Do NOT use any tools. Do NOT search the web. Answer only from the text below.

Rules:
- Only companies that are actually hiring or being profiled. Skip ones mentioned in passing
  as examples, competitors, or a founder's previous employer.
- The domain must be the company's own site. Never a job board, a Substack, or a social link.
- If you cannot determine a real domain for a company, leave it out entirely.
- Do not invent anything. Use only what this text says.

ISSUE: %s

%s
"""


def parse_post(post):
    slug = post.get("slug")
    try:
        full = fetch("%s/api/v1/posts/%s" % (PUB, slug))
    except Exception as e:
        print("  %-46s fetch failed: %s" % (slug[:46], str(e)[:40]))
        return []

    body = full.get("body_html") or ""
    if not body:
        return []

    text = html.unescape(re.sub(r"<[^>]+>", " ", body))
    text = re.sub(r"\s+", " ", text).strip()

    # domains actually linked in the issue, used to sanity check the model
    linked = set()
    for m in re.finditer(r'href="(https?://[^"]+)"', body):
        d = store.normalize_domain(m.group(1))
        if d and not is_skipped(d):
            linked.add(d)

    try:
        payload = llm.ask_json(EXTRACT % (post.get("title", ""), text[:14000]), allow_web=False)
    except llm.LLMUnavailable:
        raise
    except Exception as e:
        print("  %-46s extract failed: %s" % (slug[:46], str(e)[:40]))
        return []

    url = post.get("canonical_url") or "%s/p/%s" % (PUB, slug)
    out = []
    for c in payload.get("companies", []):
        d = store.normalize_domain(c.get("domain"))
        if not d or is_skipped(d):
            continue
        out.append({
            "domain": d,
            # Same cleaner as the HN path. \S+ would otherwise eat the bracket
            # a URL sits inside and leave the opener behind.
            "name": store.clean_company_name(
                re.sub(r"https?://[^\s)\]}]+", "", c.get("name") or d)) or d,
            "state": "new",
            "what_they_build": c.get("what_they_build"),
            "stage": c.get("stage") or "unknown",
            "location": c.get("location"),
            "posted_role": c.get("roles_mentioned"),
            "raw_posting": "%s | %s | %s" % (
                c.get("name"), c.get("roles_mentioned") or "", c.get("what_they_build") or ""),
            "linked_in_issue": d in linked,
            "sources": [{
                "source": "next_play",
                "issue": post.get("title"),
                "url": url,
                "seen_at": store.now(),
            }],
        })
    print("  %-46s %2d companies" % ((post.get("title") or slug)[:46], len(out)))
    return out


def run(issues=40, workers=WORKERS):
    posts = archive(int(issues))
    if not posts:
        raise RuntimeError("Substack archive returned nothing. Source may have changed.")
    print("%d issues to parse\n" % len(posts))

    found = []
    with ThreadPoolExecutor(max_workers=int(workers)) as pool:
        for batch in [posts[i:i + int(workers)] for i in range(0, len(posts), int(workers))]:
            futures = [pool.submit(parse_post, p) for p in batch]
            for f in futures:
                try:
                    found.extend(f.result())
                except llm.LLMUnavailable as e:
                    print("\nSTOPPING: %s" % e)
                    new, merged = store.upsert_companies(found)
                    return {"new": new, "merged": merged, "stopped": True}

    new, merged = store.upsert_companies(found)
    print("\n%d extracted, %d new, %d already known" % (len(found), new, merged))
    return {"extracted": len(found), "new": new, "merged": merged}
