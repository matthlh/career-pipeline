"""The exporter decides the order the app shows people in. queue_daily decides
the order drafts get written in. They are supposed to agree, and for a while
they did not: the queue sorted on funding stage and the exporter ignored it, so
the top card and the top draft were different people.
"""
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "jobs"))
import export_app  # noqa: E402
import prefs  # noqa: E402


def person(**kw):
    base = {"fact": None, "source": "hn_whoishiring", "locRank": prefs.LOC_ELSE,
            "roleRank": prefs.ROLE_OTHER, "stageRank": prefs.STAGE_RANK["unknown"],
            "name": None, "method": "posting_text", "roleInbox": False,
            "mentionsIntern": False, "applyUrl": None, "remote": "onsite"}
    base.update(kw)
    return base


class Score(unittest.TestCase):
    def assert_prefers(self, better, worse, why):
        self.assertGreater(export_app._score(person(**better)),
                           export_app._score(person(**worse)), why)

    def test_a_researched_fact_outweighs_any_single_other_signal(self):
        self.assert_prefers({"fact": "they wrote X"},
                            {"source": "next_play", "locRank": prefs.LOC_SF},
                            "the fact is what makes a message not spam")

    def test_every_dimension_the_queue_sorts_on_also_moves_the_score(self):
        # If the queue ranks on it, the app has to rank on it too, or the top
        # card and the top draft drift apart.
        self.assert_prefers({"source": "next_play"}, {}, "source")
        self.assert_prefers({"locRank": prefs.LOC_SF}, {"locRank": prefs.LOC_NY}, "location")
        self.assert_prefers({"roleRank": prefs.ROLE_AI}, {"roleRank": prefs.ROLE_FE}, "role")
        self.assert_prefers({"stageRank": prefs.STAGE_RANK["seed"]},
                            {"stageRank": prefs.STAGE_RANK["later"]}, "funding stage")
        self.assert_prefers({"mentionsIntern": True}, {}, "mentions an internship")

    def test_a_named_human_beats_a_role_inbox(self):
        self.assert_prefers({"name": "Dana Okonkwo", "method": "github_commits"},
                            {"roleInbox": True}, "jobs@ is not a conversation")

    def test_location_preference_is_monotonic(self):
        scores = [export_app._score(person(locRank=r)) for r in
                  (prefs.LOC_SF, prefs.LOC_NY, prefs.LOC_US, prefs.LOC_VAN,
                   prefs.LOC_CA, prefs.LOC_ELSE)]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_every_rank_has_a_weight(self):
        # An IndexError here means prefs grew a rank the scorer does not know
        # about, which would take the whole export down at 7:45am.
        for r in range(len(prefs.LOC_LABEL)):
            export_app._score(person(locRank=r))
        for r in range(len(prefs.ROLE_LABEL)):
            export_app._score(person(roleRank=r))
        for r in sorted(set(prefs.STAGE_RANK.values())):
            export_app._score(person(stageRank=r))


class Addresses(unittest.TestCase):
    def test_role_inboxes_are_recognised(self):
        for a in ("jobs@x.example", "careers@x.example", "hiring@x.example", "hello@x.example"):
            self.assertTrue(export_app._is_role_inbox(a), a)
        for a in ("dana@x.example", "priya.r@x.example"):
            self.assertFalse(export_app._is_role_inbox(a), a)

    def test_a_role_inbox_never_gets_a_first_name(self):
        # "Hi Jobs," is worse than no greeting at all.
        self.assertEqual(export_app._first_name(None, "jobs@x.example"), "")
        self.assertEqual(export_app._first_name(None, "dana@x.example"), "Dana")
        self.assertEqual(export_app._first_name(None, "d4na99@x.example"), "")
        self.assertEqual(export_app._first_name("Dana Okonkwo", "jobs@x.example"), "Dana")

    def test_nothing_git_tracks_contains_a_real_address(self):
        # The repo is public and the contact store is not. Runs the same guard
        # the deploy runs, so the test and the gate cannot disagree.
        root = os.path.dirname(os.path.dirname(HERE))
        guard = os.path.join(root, "scripts", "leakcheck.sh")
        if not os.path.exists(os.path.join(root, ".git")):
            self.skipTest("not a git checkout")
        r = subprocess.run([guard], cwd=root, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_the_from_address_falls_back_for_a_fresh_clone(self):
        self.assertIn("@", export_app._from_address())


class ApplyUrl(unittest.TestCase):
    def test_pulls_the_link_the_posting_printed(self):
        self.assertEqual(
            export_app._apply_url("We are hiring. Apply: https://x.example/jobs/1 today"),
            "https://x.example/jobs/1")

    def test_strips_trailing_punctuation(self):
        self.assertEqual(export_app._apply_url("apply here https://x.example/j)."),
                         "https://x.example/j")

    def test_no_link_is_none_rather_than_a_guess(self):
        self.assertIsNone(export_app._apply_url("Email us to apply."))
        self.assertIsNone(export_app._apply_url(""))
        self.assertIsNone(export_app._apply_url(None))


if __name__ == "__main__":
    unittest.main()
