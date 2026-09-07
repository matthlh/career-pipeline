"""Fill in what a company is.

Three cost tiers, cheapest first:

1. Regex over the posting header. 75% of HN postings follow
   `Company | Role | Location | Type | Salary | URL`, so location, seniority,
   remote policy and salary are free and instant.
2. One batched LLM call per 40 companies, asking only what regex cannot answer:
   is this a real target, and what do they build in one sentence.
3. Deep web research, only for companies that survive ranking (job: enrich deep=1).

Each `claude -p` costs ~9s in process startup alone, so batches are large and
run concurrently. Doing this per-company would take an hour; this takes minutes.
"""
import re
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0] + "/scripts")
import store
import llm

BATCH = 40
WORKERS = 5

REMOTE_PAT = re.compile(r"\bremote\b", re.I)
ONSITE_PAT = re.compile(r"\bon-?site\b", re.I)
HYBRID_PAT = re.compile(r"\bhybrid\b", re.I)
INTERN_PAT = re.compile(r"\bintern(ship)?s?\b", re.I)
VISA_PAT = re.compile(r"\b(visa|sponsor\w*|h-?1b|relocat\w+)\b", re.I)
SALARY_PAT = re.compile(r"[$€£]\s?\d{2,3}\s?[kK]?\s?[-–—to]+\s?[$€£]?\s?\d{2,3}\s?[kK]?")
CA_PAT = re.compile(r"\b(canada|vancouver|toronto|montreal|waterloo|ottawa|calgary|"
                    r"british columbia|ontario|quebec|remote \(canada\))\b", re.I)
US_PAT = re.compile(r"\b(usa|u\.s\.|united states|san francisco|new york|nyc|seattle|"
                    r"austin|boston|los angeles|palo alto|sf bay|chicago|denver)\b", re.I)


def parse_header(posting):
    """The pipe convention gives us most structured fields for free."""
    head = (posting or "").split("http")[0][:260]
    parts = [p.strip() for p in head.split("|") if p.strip()]
    out = {"posted_role": None, "location": None, "salary": None, "remote_policy": None}
    if len(parts) >= 2:
        out["posted_role"] = parts[1][:120]
    if len(parts) >= 3:
        out["location"] = parts[2][:80]

    blob = (posting or "")[:1500]
    m = SALARY_PAT.search(blob)
    if m:
        out["salary"] = m.group(0)
    if REMOTE_PAT.search(head):
        out["remote_policy"] = "remote"
    elif HYBRID_PAT.search(head):
        out["remote_policy"] = "hybrid"
    elif ONSITE_PAT.search(head):
        out["remote_policy"] = "onsite"
    out["mentions_visa"] = bool(VISA_PAT.search(blob))
    out["mentions_intern"] = bool(INTERN_PAT.search(blob))
    return out


def guess_tier(header, posting):
    """Cheap first pass. The LLM only overrides this when it has better evidence."""
    blob = (header.get("location") or "") + " " + (posting or "")[:600]
    if CA_PAT.search(blob):
        return "tier_1_canada", "location text mentions a Canadian city or region"
    if header.get("remote_policy") == "remote":
        return "tier_2_remote", "posting says remote, so likely contractable with no immigration process"
    if US_PAT.search(blob):
        return "tier_3_us_onsite", "US location with no remote signal, would need J-1"
    return "unknown", "posting does not say where the work happens"


PROMPT = """For each company below, decide two things only.

Return ONLY JSON: {"results": [{"domain": "...", "is_target": true/false,
"reject_reason": "short reason or null", "what_they_build": "one plain sentence",
"role_types": ["swe"|"gtm"|"forward_deployed"|"other"]}]}

is_target is FALSE for: consultancies, dev shops, digital/product studios, agencies,
recruiters, staffing and outsourcing firms, companies clearly over ~200 people, and
anything with no in-house engineering.
is_target is TRUE for product startups roughly 5-200 people.

Judge only from the text given. Do not search. Be terse.

%s
"""


def _call(chunk):
    blob = []
    for c in chunk:
        blob.append("---\ndomain: %s\nname: %s\n%s" % (
            c["domain"], c.get("name", ""), (c.get("raw_posting") or "")[:600]))
    payload = llm.ask_json(PROMPT % "\n".join(blob), allow_web=False)
    return {r["domain"]: r for r in payload.get("results", [])}


def run(limit=700, batch=BATCH, workers=WORKERS):
    companies = store.read(store.COMPANIES)
    by_domain = {c["domain"]: c for c in companies}

    pending = [c for c in companies if c.get("state") == "new"] + store.stale_companies()
    pending = pending[:int(limit)]
    if not pending:
        print("nothing to enrich")
        return {"enriched": 0}

    # free pass first, so even if every LLM call fails we still gained structure
    for c in pending:
        header = parse_header(c.get("raw_posting"))
        tier, note = guess_tier(header, c.get("raw_posting"))
        rec = by_domain[c["domain"]]
        # Only ever add. header defaults its four parsed fields to None, and a
        # stale record re-parsing worse the second time would otherwise erase
        # what the first pass got right.
        rec.update({k: v for k, v in header.items() if v is not None})
        rec["work_auth_tier"] = tier
        rec["work_auth_note"] = note
        rec["fact_source"] = (rec.get("sources") or [{}])[0].get("url")
    store.save_companies(companies)
    print("%d companies: header parsed for free" % len(pending))

    chunks = [pending[i:i + int(batch)] for i in range(0, len(pending), int(batch))]
    print("%d LLM calls, %d at a time" % (len(chunks), workers))

    enriched = dead = failed = 0
    stopped = False

    with ThreadPoolExecutor(max_workers=int(workers)) as pool:
        for group_start in range(0, len(chunks), int(workers)):
            if stopped:
                break
            group = chunks[group_start:group_start + int(workers)]
            futures = [(chunk, pool.submit(_call, chunk)) for chunk in group]

            for chunk, fut in futures:
                try:
                    results = fut.result()
                except llm.LLMUnavailable as e:
                    print("  STOPPING: %s" % e)
                    stopped = True
                    continue
                except Exception as e:
                    print("  batch failed: %s" % str(e)[:120])
                    failed += len(chunk)
                    continue

                for c in chunk:
                    rec = by_domain[c["domain"]]
                    r = results.get(c["domain"])
                    if not r:
                        failed += 1
                        continue
                    rec["what_they_build"] = r.get("what_they_build")
                    rec["role_types"] = r.get("role_types") or []
                    rec["enriched_at"] = store.now()
                    if r.get("is_target"):
                        rec["state"] = "enriched"
                        enriched += 1
                    else:
                        rec["state"] = "dead"
                        rec["dead_reason"] = r.get("reject_reason") or "not a target"
                        dead += 1

            store.save_companies(companies)
            print("  %d enriched, %d dead, %d failed" % (enriched, dead, failed))

    if stopped:
        print("  backlog left intact for the next run")
    return {"enriched": enriched, "dead": dead, "failed": failed}
