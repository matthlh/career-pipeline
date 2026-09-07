"""A schedule that is not running has exactly one symptom: nothing changes.

That is the symptom nobody notices, which is the whole reason this check exists,
so it is worth making sure the check itself works.
"""
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cronhealth  # noqa: E402

ENTRY = "0 6 * * * cd %s && /usr/bin/python3 scripts/run.py queue >> state/cron.log 2>&1"


class Check(unittest.TestCase):
    def setUp(self):
        self._orig_lines = cronhealth._crontab_lines
        self._orig_log = cronhealth.LOG
        self.dir = tempfile.mkdtemp()
        cronhealth.LOG = os.path.join(self.dir, "cron.log")

    def tearDown(self):
        cronhealth._crontab_lines = self._orig_lines
        cronhealth.LOG = self._orig_log

    def _entries(self, *lines):
        cronhealth._crontab_lines = lambda: list(lines)

    def _write_log(self, text, age_days=0):
        with open(cronhealth.LOG, "w", encoding="utf-8") as fh:
            fh.write(text)
        if age_days:
            old = time.time() - age_days * 86400
            os.utime(cronhealth.LOG, (old, old))

    def test_no_entries_is_not_a_problem(self):
        self._entries()
        ok, _ = cronhealth.check()
        self.assertTrue(ok)

    def test_entries_installed_but_no_log_at_all(self):
        # The macOS Full Disk Access failure: every entry dies at the `cd` and
        # writes nothing, so the absence of the log *is* the evidence.
        self._entries(ENTRY % cronhealth.ROOT)
        ok, msg = cronhealth.check()
        self.assertFalse(ok)
        self.assertIn("Full Disk Access", msg)
        self.assertIn("queue", msg)

    def test_a_log_that_stopped_being_written(self):
        self._entries(ENTRY % cronhealth.ROOT)
        self._write_log("=== queue done ===\n", age_days=9)
        ok, msg = cronhealth.check()
        self.assertFalse(ok)
        self.assertIn("9 days", msg)

    def test_a_recent_clean_log_is_fine(self):
        self._entries(ENTRY % cronhealth.ROOT)
        self._write_log("=== queue ===\n=== queue done: {} ===\n")
        ok, msg = cronhealth.check()
        self.assertTrue(ok, msg)

    def test_a_recent_log_full_of_tracebacks_is_not(self):
        self._entries(ENTRY % cronhealth.ROOT)
        self._write_log("=== queue ===\n=== queue done: {} ===\n"
                        "Traceback (most recent call last):\nRuntimeError: boom\n")
        ok, msg = cronhealth.check()
        self.assertFalse(ok)
        self.assertIn("failure", msg)

    def test_a_log_with_output_but_no_job_that_finished(self):
        # The near-miss that shipped: Full Disk Access granted to /usr/sbin/cron
        # but not to the python binary it launches. cron writes, every job dies
        # before it starts, and grepping for "Traceback" finds nothing - so the
        # check reported ok while the pipeline did precisely nothing.
        self._entries(ENTRY % cronhealth.ROOT)
        self._write_log("/usr/bin/python3: can't open file 'scripts/run.py': "
                        "[Errno 1] Operation not permitted\n" * 2)
        ok, msg = cronhealth.check()
        self.assertFalse(ok)
        self.assertIn("no completed job", msg)
        self.assertIn("Full Disk Access", msg)

    def test_it_needs_a_finished_job_not_merely_a_started_one(self):
        self._entries(ENTRY % cronhealth.ROOT)
        self._write_log("=== queue ===\n")     # started, never finished
        ok, _ = cronhealth.check()
        self.assertFalse(ok)

    def test_a_missing_crontab_binary_does_not_take_the_job_down(self):
        cronhealth._crontab_lines = self._orig_lines   # the real one
        ok, msg = cronhealth.check()
        self.assertIsInstance(ok, bool)
        self.assertTrue(msg)


if __name__ == "__main__":
    unittest.main()
