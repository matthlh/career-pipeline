"""The store is the part where a bug destroys data rather than annoying someone.

It has done it once already: a whole-run enrich outage marked 682 records
permanently failed instead of halting. These cover the quieter version of the
same shape - state that is easy to enter and impossible to leave.
"""
import os
import sys
import tempfile
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import store  # noqa: E402


class QueuedIsNotTerminal(unittest.TestCase):
    """`queued` means a draft exists, not that anyone received anything.

    It used to block a contact from the queue forever. Since the entire
    difficulty in this project is that drafts do not get sent, the daily queue
    would have eaten the contact pool at two people a day while the send count
    stayed at zero - and the only symptom would have been the queue quietly
    running out of people.
    """

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False)
        self.tmp.close()
        self._real = store.CONTACTS
        store.CONTACTS = self.tmp.name

    def tearDown(self):
        store.CONTACTS = self._real
        os.unlink(self.tmp.name)

    def _write(self, *contacts):
        store.write(store.CONTACTS, list(contacts))

    @staticmethod
    def _ago(days):
        return (store.utcnow() - timedelta(days=days)).isoformat(timespec="seconds") + "Z"

    def test_a_fresh_draft_holds_the_contact_out_of_the_queue(self):
        self._write({"email": "a@x.example", "state": "queued", "queued_at": self._ago(1)})
        self.assertIn("a@x.example", store.already_touched_emails())

    def test_a_stale_unsent_draft_puts_them_back_in_play(self):
        # A hard number, not QUEUE_TTL_DAYS + 1. Deriving the age from the
        # constant makes the test pass for any constant, including the one that
        # blocks forever - which is the behaviour this is here to catch.
        self._write({"email": "a@x.example", "state": "queued", "queued_at": self._ago(60)})
        self.assertNotIn("a@x.example", store.already_touched_emails())

    def test_the_window_is_short_enough_to_matter(self):
        # 188 contacts and a queue that takes two a day: anything past a couple
        # of months is indistinguishable from blocking forever.
        self.assertGreaterEqual(store.QUEUE_TTL_DAYS, 3)
        self.assertLessEqual(store.QUEUE_TTL_DAYS, 45)

    def test_anyone_who_actually_heard_from_you_never_comes_back(self):
        self._write(*[{"email": "%s@x.example" % s, "state": s,
                       "queued_at": self._ago(999)} for s in store.TERMINAL_STATES])
        blocked = store.already_touched_emails()
        for s in store.TERMINAL_STATES:
            self.assertIn("%s@x.example" % s, blocked, s)

    def test_a_new_contact_is_never_blocked(self):
        self._write({"email": "a@x.example", "state": "new"})
        self.assertEqual(store.already_touched_emails(), set())

    def test_a_queued_contact_with_no_timestamp_stays_blocked(self):
        # Unknown age is not evidence of staleness, and re-drafting someone who
        # may have just been drafted is the more expensive mistake.
        self._write({"email": "a@x.example", "state": "queued"})
        self.assertIn("a@x.example", store.already_touched_emails())


class Timestamps(unittest.TestCase):
    def test_now_keeps_the_format_already_on_disk(self):
        s = store.now()
        self.assertTrue(s.endswith("Z"), s)
        self.assertEqual(len(s), len("2026-09-07T12:00:00Z"), s)
        self.assertIsNotNone(store.parse_ts(s))

    def test_a_malformed_timestamp_is_undated_rather_than_fatal(self):
        # stale_companies() reads these across the whole store. One bad value
        # should not take down a job over a record it can treat as undated.
        for bad in ("", None, "not a date", "2026-13-45T99:99:99Z", 12345):
            self.assertIsNone(store.parse_ts(bad), repr(bad))

    def test_a_real_timestamp_still_parses(self):
        self.assertIsNotNone(store.parse_ts("2026-09-05T22:34:00Z"))


class Domains(unittest.TestCase):
    def test_strips_everything_that_is_not_the_domain(self):
        for raw in ("https://www.Example.com/careers?x=1", "http://example.com:8080",
                    "  Example.com  ", "www.example.com/"):
            self.assertEqual(store.normalize_domain(raw), "example.com", raw)

    def test_refuses_what_is_not_a_domain(self):
        for raw in ("", None, "not a domain", "localhost"):
            self.assertIsNone(store.normalize_domain(raw), repr(raw))


if __name__ == "__main__":
    unittest.main()
