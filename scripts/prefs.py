"""Matt's stated preferences, in one place, so ranking is not scattered across jobs.

Set Sept 6 2026. Objective: an internship, startups preferred because the door is
cheaper to open. Everything here is a *sort* preference, never a filter - nothing is
dropped for scoring badly, it just sinks.

Role and location are read out of `raw_posting` rather than the parsed fields, because
the header regex misaligns on maybe a fifth of HN postings (location lands in
posted_role, "Full-Time" lands in location). The raw text is always intact.
"""
import re

# --- sources -------------------------------------------------------------

# Ben Lang's Next Play archive first. It is curated, the roles skew toward the ones
# Matt actually wants, and it is a much smaller pool than the HN thread.
SOURCE_RANK = {"next_play": 0, "hn_whoishiring": 1}


def source_rank(company):
    return min([SOURCE_RANK.get(s.get("source"), 2)
                for s in company.get("sources") or []] or [2])


# --- location ------------------------------------------------------------

# SF, then NY, then anywhere in the US, then Vancouver, then the rest of Canada,
# then everywhere else.
_SF = (r"san francisco|\bsf\b|bay area|silicon valley|palo alto|mountain view|"
       r"menlo park|sunnyvale|berkeley|oakland|redwood city|santa clara|"
       r"san jose|cupertino|south bay|peninsula")
_NY = r"new york|\bnyc\b|brooklyn|manhattan|\bny\b"
_US = (r"united states|\bu\.?s\.?a?\b|seattle|austin|boston|chicago|denver|"
       r"los angeles|\bla\b|san diego|miami|atlanta|portland|philadelphia|"
       r"washington|\bdc\b|remote \(us|us remote|us-based|anywhere in the us")
_VAN = r"vancouver"
_CA = r"\bcanada\b|toronto|montr|waterloo|ottawa|calgary|edmonton|\bbc\b"

LOC_SF, LOC_NY, LOC_US, LOC_VAN, LOC_CA, LOC_ELSE = range(6)

LOC_LABEL = {LOC_SF: "SF", LOC_NY: "NY", LOC_US: "US", LOC_VAN: "Vancouver",
             LOC_CA: "Canada", LOC_ELSE: "elsewhere"}


def _haystack(company):
    return " ".join(str(company.get(k) or "") for k in
                    ("location", "posted_role", "raw_posting")).lower()


def location_rank(company):
    h = _haystack(company)
    for pattern, rank in ((_SF, LOC_SF), (_NY, LOC_NY), (_US, LOC_US),
                          (_VAN, LOC_VAN), (_CA, LOC_CA)):
        if re.search(pattern, h):
            return rank
    # A fully remote company with *no* geography stated is still workable from
    # here. One that states a region you are not in is not: "Remote (EU)" was
    # falling through to this line and ranking above Vancouver.
    if re.search(r"remote\s*\((?!us|usa|united states|canada|ca\b|north america)", h):
        return LOC_ELSE
    if (company.get("remote_policy") or "") == "remote":
        return LOC_US
    return LOC_ELSE


# --- role ----------------------------------------------------------------

# AI application engineering, then front-end, then GTM, then forward-deployed,
# then anything else technical.
_AI = (r"\bllm\b|\bgenai\b|generative ai|\bai engineer|ai application|"
       r"\brag\b|retrieval[- ]augmented|\bagent(s|ic)?\b|prompt|fine[- ]tun|"
       r"\bevals?\b|vector (db|database|search)|embedding|inference|"
       r"applied ai|ai product|foundation model")
_FE = (r"front[- ]?end|\breact\b|typescript|next\.js|\bui engineer|web engineer|"
       r"design engineer|tailwind|svelte|\bvue\b")
_GTM = (r"go[- ]to[- ]market|\bgtm\b|growth engineer|sales engineer|"
        r"solutions engineer|revenue|founding (sales|account)")
_FDE = r"forward[- ]deployed|\bfde\b|solutions architect|customer engineer"

ROLE_AI, ROLE_FE, ROLE_GTM, ROLE_FDE, ROLE_OTHER = range(5)

ROLE_LABEL = {ROLE_AI: "ai-app", ROLE_FE: "frontend", ROLE_GTM: "gtm",
              ROLE_FDE: "forward-deployed", ROLE_OTHER: "other"}


def role_rank(company):
    h = _haystack(company)
    types = company.get("role_types") or []
    if re.search(_AI, h):
        return ROLE_AI
    if re.search(_FE, h):
        return ROLE_FE
    if "gtm" in types or re.search(_GTM, h):
        return ROLE_GTM
    if "forward_deployed" in types or re.search(_FDE, h):
        return ROLE_FDE
    return ROLE_OTHER


# --- stage ---------------------------------------------------------------

# Startups are easier to reach than large companies: the founder reads their own
# email and there is no req number to be filtered by.
STAGE_RANK = {"pre-seed": 0, "seed": 0, "series-a": 1, "series-b": 1,
              "unknown": 2, "later": 3}


def stage_rank(company):
    return STAGE_RANK.get(company.get("stage") or "unknown", 2)


def describe(company):
    """One-line explanation of why something ranked where it did."""
    return "%s/%s/%s" % (
        "next-play" if source_rank(company) == 0 else "hn",
        LOC_LABEL[location_rank(company)],
        ROLE_LABEL[role_rank(company)])
