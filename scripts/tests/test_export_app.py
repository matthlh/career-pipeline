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
        # Within one source. Source itself sits above the fact - see below.
        self.assert_prefers({"fact": "they wrote X"},
                            {"locRank": prefs.LOC_SF, "roleRank": prefs.ROLE_AI},
                            "the fact is what makes a message not spam")

    def test_next_play_leads_outright_not_merely_heavily(self):
        # Sept 7 2026: the source is the first element of queue_daily.rank's
        # tuple, so it decides the order on its own there. The app scored it as
        # a flat +40 and let a good HN contact outrank a Next Play one, which is
        # the app and the queue disagreeing about who is at the top of the list.
        best_hn = person(fact="they wrote X", locRank=prefs.LOC_SF,
                         roleRank=prefs.ROLE_AI, stageRank=prefs.STAGE_RANK["seed"],
                         name="Dana Okonkwo", method="github_commits",
                         mentionsIntern=True, applyUrl="https://x.example/apply",
                         remote="remote")
        worst_next_play = person(source="next_play", roleInbox=True)
        self.assertGreater(export_app._score(worst_next_play),
                           export_app._score(best_hn),
                           "Next Play has to lead even at its worst against HN at its best")

    def test_the_source_bonus_tracks_the_weights_below_it(self):
        # The bonus is derived, not typed. If someone adds a signal to
        # _tiebreak and forgets to widen the bonus, this catches it rather than
        # the list quietly re-sorting one morning.
        best = person(fact="x", locRank=prefs.LOC_SF, roleRank=prefs.ROLE_AI,
                      stageRank=prefs.STAGE_RANK["seed"], name="Dana",
                      method="github_commits", mentionsIntern=True,
                      applyUrl="https://x.example/apply", remote="remote")
        self.assertEqual(export_app._tiebreak(best), export_app.MAX_TIEBREAK,
                         "MAX_TIEBREAK is no longer the maximum _tiebreak can return")
        self.assertGreater(export_app.SOURCE_BONUS, export_app.MAX_TIEBREAK)

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


class ExampleData(unittest.TestCase):
    """The invented dataset is what a clone runs on, and what the published copy
    runs on. It is only worth having if it exercises the same code paths as the
    real store, and it stops doing that the moment the two shapes drift - which
    they had, silently, by five fields.
    """

    @staticmethod
    def _example():
        import json
        path = os.path.join(os.path.dirname(os.path.dirname(HERE)),
                            "app", "public", "data.example.js")
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        head = "window.SEED = window.SEED || "
        return json.loads(src[src.index(head) + len(head):].rstrip()[:-1])

    def test_carries_exactly_the_fields_the_exporter_emits(self):
        expected = set(export_app.person(
            {"email": "a@b.example", "domain": "b.example"}, {}, {}))
        for p in self._example()["people"]:
            self.assertEqual(set(p), expected, p.get("company"))

    def test_only_assigns_when_the_real_data_is_absent(self):
        # `window.SEED = window.SEED || {...}` is the whole safety mechanism:
        # a plain assignment would clobber the real data.js on a local machine.
        path = os.path.join(os.path.dirname(os.path.dirname(HERE)),
                            "app", "public", "data.example.js")
        with open(path, encoding="utf-8") as fh:
            self.assertIn("window.SEED = window.SEED || ", fh.read())

    def test_is_stamped_as_the_demo(self):
        # app/src/seed.ts keys DEMO off this exact value rather than the
        # hostname, so one build behaves the same from file://, dev and Pages.
        self.assertEqual(self._example()["generated"], "example")

    def test_demo_progress_points_at_people_that_exist(self):
        seed = self._example()
        ids = set(p["id"] for p in seed["people"])
        for pid in seed.get("demo", {}).get("p", {}):
            self.assertIn(pid, ids, "demo progress references a person who is not in the set")

    def test_demo_progress_is_relative_so_it_cannot_go_stale(self):
        # Absolute dates here would read as "sent 400 days ago" a year from now.
        for pid, st in self._example().get("demo", {}).get("p", {}).items():
            self.assertIn("ago", st, pid)
            self.assertNotIn("last", st, pid)

    def test_no_person_carries_a_real_address(self):
        for p in self._example()["people"]:
            self.assertTrue(p["email"].endswith(".example"), p["email"])
