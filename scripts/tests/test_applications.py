"""The ledger is read on bad days, so it has to be right without being checked.

What fails silently here: a status change that drops the history, a "quiet"
rule that fires at the wrong people, a deadline shown after it has passed, and
a submitted posting counted twice. None of them crash; the ledger just tells a
wrong story, and he acts on it.
"""
import os
import sys
import unittest
from datetime import date, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from jobs import applications, mark_app  # noqa: E402


def app(**kw):
    base = {"job_id": "1", "company": "Acme", "title": "W27 Dev", "via": "SCOPE",
            "submitted_at": "2026-10-01T10:00:00Z", "deadline": "2026-10-05 09:00 PT"}
    base.update(kw)
    return base


def posting(**kw):
    base = {"job_id": "900", "company": "Lyft", "title": "SWE Intern, Backend",
            "deadline": "2026-10-05 09:00 PT", "status": "open"}
    base.update(kw)
    return base


class StatusChanges(unittest.TestCase):
    def test_keeps_history_and_defaults_to_applied(self):
        rows = [app()]
        prev, row = mark_app.apply_status(rows, "1", "interview", "phone screen Oct 9",
                                          at="2026-10-08T00:00:00Z")
        self.assertEqual(prev, "applied")
        self.assertEqual(row["status"], "interview")
        prev, row = mark_app.apply_status(rows, "1", "rejected", "", at="2026-10-20T00:00:00Z")
        self.assertEqual(prev, "interview")
        self.assertEqual([e["status"] for e in row["events"]], ["interview", "rejected"])
        self.assertEqual(row["events"][0]["note"], "phone screen Oct 9")

    def test_rejects_unknown_status_and_unknown_id(self):
        rows = [app()]
        with self.assertRaises(ValueError):
            mark_app.apply_status(rows, "1", "ghosted")
        with self.assertRaises(KeyError):
            mark_app.apply_status(rows, "999", "interview")
        self.assertNotIn("events", rows[0], "a failed change must not leave a partial event")

    def test_a_note_logs_an_email_without_guessing_a_status(self):
        rows = [app()]
        prev, row = mark_app.apply_status(rows, "1", "note", "recruiter: next steps",
                                          at="2026-10-03T00:00:00Z")
        self.assertEqual(row["status"], "applied")
        self.assertEqual(row["events"][-1]["note"], "recruiter: next steps")
        with self.assertRaises(ValueError):
            mark_app.apply_status(rows, "1", "note", "")

    def test_job_id_matches_as_string_or_int(self):
        rows = [app(job_id=184771)]
        prev, row = mark_app.apply_status(rows, "184771", "offer", at="2026-11-01T00:00:00Z")
        self.assertEqual(row["status"], "offer")


class OpenPostings(unittest.TestCase):
    def test_applied_moves_a_posting_into_the_ledger_once(self):
        rows, postings = [app()], [posting(match="Lyft")]
        mark_app.settle_posting(rows, postings, "900", "applied", at="2026-10-03T00:00:00Z")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]["via"], "employer site")
        self.assertEqual(rows[1]["match"], "Lyft")
        self.assertEqual(postings[0]["status"], "applied")
        with self.assertRaises(KeyError):          # not open any more
            mark_app.settle_posting(rows, postings, "900", "applied")

    def test_second_half_of_a_two_part_application_is_not_a_second_row(self):
        # Planview: SCOPE half in the ledger, careers-portal half still open.
        rows, postings = [app(job_id="184830")], [posting(job_id="184830", deadline=None)]
        mark_app.settle_posting(rows, postings, "184830", "applied", at="2026-10-03T00:00:00Z")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["events"][-1]["note"], "employer site half submitted")

    def test_skip_drops_it_from_the_open_list(self):
        postings = [posting()]
        mark_app.settle_posting([], postings, "900", "skip", "Workday account")
        self.assertEqual(applications.still_open(postings, datetime(2026, 10, 2, 7)), [])


class Deadlines(unittest.TestCase):
    def test_passed_deadlines_vanish_by_the_minute(self):
        p = posting(deadline="2026-10-02 09:00 PT")
        self.assertEqual(len(applications.still_open([p], datetime(2026, 10, 2, 8, 59))), 1)
        self.assertEqual(applications.still_open([p], datetime(2026, 10, 2, 9, 1)), [])

    def test_a_bare_date_lasts_the_whole_day_and_shows_no_invented_time(self):
        p = posting(deadline="2026-10-05")
        self.assertEqual(len(applications.still_open([p], datetime(2026, 10, 5, 22))), 1)
        self.assertEqual(applications.fmt_deadline(p), "Mon Oct 5")
        self.assertEqual(applications.fmt_deadline(posting(deadline="2026-10-02 23:59 PT")),
                         "Fri Oct 2 11:59 PM")

    def test_closing_soon_is_a_window_not_everything(self):
        now = datetime(2026, 10, 2, 7)
        ps = [posting(job_id="a", deadline="2026-10-05 09:00 PT"),
              posting(job_id="b", deadline="2026-10-16 09:00 PT"),
              posting(job_id="c", deadline=None)]
        self.assertEqual([p["job_id"] for p in applications.closing_soon(ps, now)], ["a"])

    def test_undated_posting_stays_open(self):
        self.assertEqual(len(applications.still_open([posting(deadline=None)], datetime(2027, 1, 1))), 1)


class QuietRule(unittest.TestCase):
    def test_only_old_applied_rows_with_no_events(self):
        today = date(2026, 10, 20)
        fresh = app(job_id="a", submitted_at="2026-10-15T00:00:00Z")
        old = app(job_id="b", submitted_at="2026-10-01T00:00:00Z")
        old_but_moving = app(job_id="c", submitted_at="2026-10-01T00:00:00Z", status="applied",
                             events=[{"at": "2026-10-10T00:00:00Z", "status": "applied",
                                      "note": "recruiter emailed"}])
        old_rejected = app(job_id="d", submitted_at="2026-09-01T00:00:00Z", status="rejected")
        q = applications.quiet([fresh, old, old_but_moving, old_rejected], today)
        self.assertEqual([r["job_id"] for r in q], ["b"])

    def test_undated_row_is_never_quiet(self):
        self.assertEqual(applications.quiet([app(submitted_at=None)], date(2027, 1, 1)), [])


class Brief(unittest.TestCase):
    def test_groups_by_company_and_caps_the_table(self):
        now = datetime(2026, 10, 2, 7)
        ps = [posting(job_id=str(i), company="Co%d" % i) for i in range(8)]
        ps += [posting(job_id="L1", company="Lyft", hold="referral"),
               posting(job_id="L2", company="Lyft", hold="referral")]
        lines = applications.brief([app()], ps, now)
        rows = [l for l in lines if l.startswith("| ") and "Closes" not in l]
        self.assertEqual(len(rows), applications.BRIEF_ROWS)
        tail = [l for l in lines if "more companies close" in l]
        self.assertEqual(len(tail), 1)
        self.assertIn("Mon Oct 5", tail[0], "the date keeps its capitals")
        everything = applications.brief([app()], ps[-2:], now)
        lyft = [l for l in everything if "Lyft" in l][0]
        self.assertIn("2 roles", lyft)
        self.assertIn("referral", lyft)

    def test_brief_names_live_ones_and_stays_short(self):
        now = datetime(2026, 10, 2, 7)
        rows = [app(job_id=str(i)) for i in range(30)]
        rows[0]["status"] = "interview"
        rows[0]["events"] = [{"at": "2026-10-01T00:00:00Z", "status": "interview",
                              "note": "Oct 9 phone screen"}]
        lines = applications.brief(rows, [], now)
        self.assertLessEqual(len(lines), 10)
        self.assertIn("30 sent, 30 still live, 1 interviews", lines[0])
        self.assertTrue(any("INTERVIEW" in l and "Oct 9 phone screen" in l for l in lines))


class Rendering(unittest.TestCase):
    def test_offers_first_then_interviews_then_applied(self):
        now = datetime(2026, 10, 2, 7)
        rows = [app(job_id="1", company="Zed"),
                app(job_id="2", company="Yam", status="interview"),
                app(job_id="3", company="Xi", status="offer"),
                app(job_id="4", company="Won", status="rejected")]
        md = applications.render(rows, [], now)
        order = [md.index("| Xi |"), md.index("| Yam |"), md.index("| Zed |"), md.index("| Won |")]
        self.assertEqual(order, sorted(order))
        self.assertIn("**4 submitted**", md)

    def test_pipe_in_title_does_not_break_the_table(self):
        md = applications.render([app(title="Dev | Platform")], [], datetime(2026, 10, 2, 7))
        row = [l for l in md.splitlines() if l.startswith("| 2026-10-01")][0]
        self.assertEqual(row.count("|"), 7)


class Replies(unittest.TestCase):
    def test_watch_and_query_drop_dead_ones_and_dedupe(self):
        rows = [app(company="Planview"), app(job_id="2", company="Planview"),
                app(job_id="3", company="Gone Inc", status="rejected"),
                app(job_id="4", company="Robert Bosch GmbH", match="Bosch"),
                app(job_id="5", company="Acuity Insights")]
        self.assertEqual(applications.watchlist(rows), ["Planview", "Robert Bosch GmbH", "Acuity Insights"])
        q = applications.gmail_query(rows)
        self.assertEqual(q.count("Planview"), 1)
        self.assertNotIn("Gone", q)
        self.assertIn("Bosch OR", q)
        self.assertIn('"Acuity Insights"', q)
        self.assertTrue(q.startswith("in:inbox is:unread"))


if __name__ == "__main__":
    unittest.main()
