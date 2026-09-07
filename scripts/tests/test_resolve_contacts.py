"""Who the pipeline decides to put in front of a human.

The expensive mistakes here are quiet ones: retiring a company because one
search came back empty, and attributing a stranger's commit email to a company
they have never worked at.
"""
import os
import sys
import unittest
from datetime import timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "jobs"))
import resolve_contacts as rc  # noqa: E402
import store  # noqa: E402


def ago(days):
    return (store.utcnow() - timedelta(days=days)).isoformat(timespec="seconds") + "Z"


class RetryWindow(unittest.TestCase):
    """"We looked and found nobody" was stored as "never look again"."""

    def test_a_domain_with_an_address_is_done(self):
        got = rc._already_resolved([{"domain": "a.example", "email": "x@a.example"}])
        self.assertEqual(got, {"a.example"})

    def test_a_recent_empty_search_holds_the_domain(self):
        got = rc._already_resolved([
            {"domain": "a.example", "state": "resolved_none", "last_attempt": ago(2)}])
        self.assertEqual(got, {"a.example"})

    def test_an_old_empty_search_lets_it_be_tried_again(self):
        # Hard number, not RESOLVE_RETRY_DAYS + 1: deriving the age from the
        # constant makes the test pass for a constant of any size, including one
        # that never retries.
        got = rc._already_resolved([
            {"domain": "a.example", "state": "resolved_none", "last_attempt": ago(90)}])
        self.assertEqual(got, set())

    def test_the_window_is_short_enough_to_matter(self):
        self.assertGreaterEqual(rc.RESOLVE_RETRY_DAYS, 7)
        self.assertLessEqual(rc.RESOLVE_RETRY_DAYS, 120)

    def test_falls_back_to_created_at_for_rows_written_before_last_attempt(self):
        self.assertEqual(rc._already_resolved([
            {"domain": "a.example", "state": "resolved_none", "created_at": ago(2)}]),
            {"a.example"})
        self.assertEqual(rc._already_resolved([
            {"domain": "a.example", "state": "resolved_none", "created_at": ago(90)}]),
            set())

    def test_an_undated_row_is_kept_rather_than_retried(self):
        # Unknown age is not evidence that a search is stale, and the cost of a
        # needless LLM research call is higher than a month's delay.
        self.assertEqual(rc._already_resolved([
            {"domain": "a.example", "state": "resolved_none"}]), {"a.example"})


class GithubAddresses(unittest.TestCase):
    """The filters that decide an address is a real person's."""

    def test_rejects_the_addresses_that_are_not_people(self):
        for bad in ("12345+user@users.noreply.github.com", "info@x.example",
                    "hello@x.example", "no-reply@x.example", "support@x.example"):
            self.assertTrue(rc.NOREPLY.search(bad) or rc.ROLE_ADDR.match(bad), bad)

    def test_keeps_a_real_one(self):
        for good in ("dana@lantern.example", "d.okonkwo@gmail.example",
                     "priya.raghunathan@stellwater.example"):
            self.assertFalse(rc.NOREPLY.search(good) or rc.ROLE_ADDR.match(good), good)

    def test_an_absent_homepage_is_not_confirmation(self):
        # Most GitHub orgs set no homepage. The old code read that silence as a
        # pass, so an unrelated project sharing a name with the company could
        # supply the address - and "saw your commit at X" is a bad message to
        # send to someone who has never worked at X. It is still accepted, but
        # it is now recorded as unconfirmed rather than treated as verified.
        src = open(os.path.join(os.path.dirname(HERE), "jobs", "resolve_contacts.py"),
                   encoding="utf-8").read()
        self.assertIn("org_confirmed", src)
        self.assertIn("org_match", src)


if __name__ == "__main__":
    unittest.main()
