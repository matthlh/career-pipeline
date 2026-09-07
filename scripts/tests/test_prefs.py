"""The ranking is the only place where a stated preference becomes behaviour,
so it is the only part of the pipeline where a silent regression is expensive:
nothing crashes, the wrong person just quietly sinks to the bottom of the queue.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import prefs  # noqa: E402


def co(**kw):
    base = {"location": "", "posted_role": "", "raw_posting": "",
            "remote_policy": "", "stage": None, "sources": []}
    base.update(kw)
    return base


class Location(unittest.TestCase):
    def test_stated_order_sf_ny_us_vancouver_canada(self):
        ranks = [prefs.location_rank(co(location=l)) for l in
                 ("San Francisco, CA", "New York, NY", "Austin, TX",
                  "Vancouver, BC", "Toronto, ON", "Berlin")]
        self.assertEqual(ranks, sorted(ranks), "preference order is not monotonic")
        self.assertEqual(ranks[0], prefs.LOC_SF)
        self.assertEqual(ranks[-1], prefs.LOC_ELSE)

    def test_reads_the_raw_posting_when_the_header_misparsed(self):
        # The HN header regex misaligns on maybe a fifth of postings, which is
        # why the haystack includes the raw text.
        self.assertEqual(
            prefs.location_rank(co(location="Full-Time", raw_posting="... | Menlo Park | ...")),
            prefs.LOC_SF)

    def test_bare_remote_is_workable_from_here(self):
        self.assertEqual(prefs.location_rank(co(remote_policy="remote")), prefs.LOC_US)

    def test_a_remote_region_you_are_not_in_is_not(self):
        # Regression: "Remote (EU)" used to fall through to the bare-remote rule
        # and rank above Vancouver.
        for loc in ("Remote (EU)", "Remote (Europe)", "Remote (APAC)"):
            self.assertEqual(prefs.location_rank(co(location=loc, remote_policy="remote")),
                             prefs.LOC_ELSE, loc)

    def test_remote_us_still_counts_as_us(self):
        self.assertEqual(
            prefs.location_rank(co(location="Remote (US)", remote_policy="remote")),
            prefs.LOC_US)


class Role(unittest.TestCase):
    def test_stated_order_ai_frontend_gtm_fde(self):
        ranks = [prefs.role_rank(co(posted_role=r)) for r in
                 ("AI engineer - LLM retrieval", "Front-end engineer, React",
                  "Growth engineer - GTM", "Forward-deployed engineer",
                  "Site reliability engineer")]
        self.assertEqual(ranks, sorted(ranks))
        self.assertEqual(ranks[0], prefs.ROLE_AI)
        self.assertEqual(ranks[-1], prefs.ROLE_OTHER)

    def test_ai_wins_when_a_posting_mentions_several(self):
        self.assertEqual(
            prefs.role_rank(co(posted_role="Front-end engineer working on LLM evals")),
            prefs.ROLE_AI)

    def test_explicit_role_types_are_honoured(self):
        self.assertEqual(prefs.role_rank(co(role_types=["forward_deployed"])), prefs.ROLE_FDE)


class Stage(unittest.TestCase):
    def test_startups_rank_above_later_stage(self):
        self.assertLess(prefs.stage_rank(co(stage="seed")), prefs.stage_rank(co(stage="series-a")))
        self.assertLess(prefs.stage_rank(co(stage="series-a")), prefs.stage_rank(co(stage="later")))

    def test_unknown_does_not_crash_or_win(self):
        self.assertEqual(prefs.stage_rank(co(stage=None)), prefs.STAGE_RANK["unknown"])
        self.assertEqual(prefs.stage_rank(co(stage="wat")), prefs.STAGE_RANK["unknown"])


class Source(unittest.TestCase):
    def test_next_play_beats_hn(self):
        np = co(sources=[{"source": "next_play"}])
        hn = co(sources=[{"source": "hn_whoishiring"}])
        self.assertLess(prefs.source_rank(np), prefs.source_rank(hn))

    def test_best_source_wins_when_a_company_came_from_both(self):
        both = co(sources=[{"source": "hn_whoishiring"}, {"source": "next_play"}])
        self.assertEqual(prefs.source_rank(both), 0)

    def test_no_sources_does_not_crash(self):
        self.assertEqual(prefs.source_rank(co()), 2)


if __name__ == "__main__":
    unittest.main()
