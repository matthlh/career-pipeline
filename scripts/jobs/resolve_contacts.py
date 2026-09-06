"""Find a founder or engineering-lead email for an enriched company.

Order matters. We try the free, deterministic, high-confidence sources first and
only fall back to research. We never invent an address.

1. direct_email straight from the HN posting          -> verified
2. GitHub commit authorship on the company's org      -> verified
3. LLM research over the company's own site and press -> verified or pattern_guess
"""
import json
import re
import sys
import time
import urllib.request

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store
import llm

GH_API = "https://api.github.com"


def _gh_token():
    """Unauthenticated GitHub is 60 requests/hour, which is nothing. The gh CLI
    is already logged in, so borrow its token for 5000/hour."""
    import subprocess
    try:
        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or None
    except Exception:
        return None


GH_TOKEN = _gh_token()
NOREPLY = re.compile(r"users\.noreply\.github\.com$", re.I)
ROLE_ADDR = re.compile(r"^(info|hello|contact|support|sales|admin|team|help|noreply|no-reply)@", re.I)


def _gh(path):
    headers = {
        "User-Agent": "career-pipeline/1.0",
        "Accept": "application/vnd.github+json",
    }
    if GH_TOKEN:
        headers["Authorization"] = "Bearer %s" % GH_TOKEN
    req = urllib.request.Request(GH_API + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8")), r.headers
    except urllib.error.HTTPError as e:
        if e.code == 403:
            raise RuntimeError("github rate limited")
        return None, None
    except Exception:
        return None, None


def github_emails(domain, company_name):
    """Find the company's GitHub org and read commit author emails.

    Founders of small startups push code, and git config leaves a real address in
    the commit object. This is the single highest-yield free source we have.
    """
    slug = re.sub(r"[^a-z0-9]", "", (company_name or "").lower())
    candidates = [domain.split(".")[0], slug]
    seen = set()

    for org in candidates:
        if not org or org in seen or len(org) < 3:
            continue
        seen.add(org)

        data, _ = _gh("/orgs/%s/repos?sort=pushed&per_page=5" % org)
        if not data or not isinstance(data, list):
            continue

        # Only trust the org if it actually points back at the company domain.
        org_info, _ = _gh("/orgs/%s" % org)
        if org_info:
            blog = store.normalize_domain(org_info.get("blog") or "")
            if blog and blog != domain and not domain.endswith(blog) and not blog.endswith(domain):
                continue

        found = []
        for repo in data[:3]:
            commits, _ = _gh("/repos/%s/%s/commits?per_page=30" % (org, repo["name"]))
            if not commits or not isinstance(commits, list):
                continue
            for commit in commits:
                author = (commit.get("commit") or {}).get("author") or {}
                email = (author.get("email") or "").strip().lower()
                name = author.get("name")
                if not email or NOREPLY.search(email) or ROLE_ADDR.match(email):
                    continue
                login = ((commit.get("author") or {}) or {}).get("login")
                found.append({"email": email, "name": name, "github": login,
                              "repo": "%s/%s" % (org, repo["name"])})
    
        if found:
            # Prefer an address on the company domain over a personal gmail.
            found.sort(key=lambda f: (0 if f["email"].endswith("@" + domain) else 1))
            return found, "https://github.com/%s" % org
    return [], None


RESEARCH_PROMPT = """Find the founder or engineering lead email for this company.

Company: %s (%s)
What they do: %s

Search their own website (about, team, contact pages), their blog author bylines, press
coverage, and public filings. Do NOT use LinkedIn.

Return ONLY JSON:
{"name": "person's full name or null", "title": "their role or null",
 "email": "the address, or null if you could not find one",
 "confidence": "verified" if you saw the address published somewhere, "pattern_guess" if you
   inferred it from a known name plus the company's address format, "none" if you have nothing,
 "evidence_url": "the URL where you saw the name or address, or null",
 "specific_fact": "one concrete, verifiable sentence about this company or person that a
   stranger could not have guessed. Something from their blog, changelog, product, or the
   founder's background. Null if you found nothing specific.",
 "specific_fact_url": "the URL that fact came from, or null"}

Never invent an address. If you cannot find a real person, return nulls with confidence "none".
"""


def run(limit=25, no_llm=0):
    companies = store.read(store.COMPANIES)
    existing = set(c.get("domain") for c in store.read(store.CONTACTS))
    suppressed = store.suppressed_domains()

    pending = [c for c in companies
               if c.get("state") == "enriched"
               and c["domain"] not in existing
               and c["domain"] not in suppressed]
    pending = pending[:int(limit)]

    if not pending:
        print("nothing to resolve")
        return {"resolved": 0}

    print("%d companies to resolve" % len(pending))
    stats = {"verified": 0, "pattern_guess": 0, "none": 0, "failed": 0}

    for c in pending:
        domain = c["domain"]
        record = {"domain": domain, "company_name": c.get("name"), "state": "new"}

        # 1. the posting handed us an address
        if c.get("direct_email"):
            record.update({
                "email": c["direct_email"], "confidence": "verified",
                "name": None, "title": "from job posting",
                "evidence_url": (c.get("sources") or [{}])[0].get("url"),
                "method": "hn_posting",
            })
            store.upsert_contact(record)
            stats["verified"] += 1
            print("  %-26s posting -> %s" % (domain[:26], record["email"]))
            continue

        # 2. github commit authorship
        try:
            gh_found, org_url = github_emails(domain, c.get("name"))
        except RuntimeError as e:
            print("  github: %s, skipping github for this pass" % e)
            gh_found, org_url = [], None

        if gh_found:
            top = gh_found[0]
            record.update({
                "email": top["email"], "name": top["name"], "title": "commits to %s" % top["repo"],
                "confidence": "verified", "evidence_url": org_url,
                "github": top.get("github"), "method": "github_commits",
            })
            store.upsert_contact(record)
            stats["verified"] += 1
            print("  %-26s github  -> %s (%s)" % (domain[:26], top["email"], top["name"]))
            continue

        # 3. research
        if int(no_llm):
            print("  %-26s no github, skipped (no_llm)" % domain[:26])
            stats["none"] += 1
            continue
        try:
            r = llm.ask_json(RESEARCH_PROMPT % (
                c.get("name"), domain, c.get("what_they_build") or "unknown"), allow_web=True)
        except Exception as e:
            print("  %-26s FAILED: %s" % (domain[:26], str(e)[:60]))
            stats["failed"] += 1
            continue

        conf = r.get("confidence") or "none"
        if not r.get("email") or conf == "none":
            record.update({"email": None, "confidence": "none", "name": r.get("name"),
                           "state": "resolved_none", "method": "research"})
            stats["none"] += 1
            print("  %-26s research-> none" % domain[:26])
        else:
            record.update({
                "email": r["email"], "name": r.get("name"), "title": r.get("title"),
                "confidence": conf, "evidence_url": r.get("evidence_url"),
                "method": "research",
            })
            stats[conf] = stats.get(conf, 0) + 1
            print("  %-26s research-> %s (%s)" % (domain[:26], r["email"], conf))

        # the specific line for the draft lives on the company, not the contact
        if r.get("specific_fact"):
            fresh = store.read(store.COMPANIES)
            for fc in fresh:
                if fc["domain"] == domain:
                    fc["specific_fact"] = r["specific_fact"]
                    fc["specific_fact_url"] = r.get("specific_fact_url")
                    break
            store.save_companies(fresh)

        store.upsert_contact(record)

    print("\n%s" % stats)
    return stats
