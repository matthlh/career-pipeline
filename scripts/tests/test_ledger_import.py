"""ledger-import is the one place the app writes back into the data files.

What fails silently here: an edit applied twice (an event doubled in the
history), an edit applied out of order (yesterday's note over today's), a bad
edit retried on every run forever, and a malformed log that half-applies. None
of them crash; the ledger just tells a slightly wrong story every morning.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import store  # noqa: E402
from jobs import ledger_import  # noqa: E402

PATHS = ("LEDGER_EDITS", "LEDGER_IMPORTED", "LEDGER", "APPLICATIONS", "OPEN_POSTINGS")
OTHER_KINDS = ("person", "company", "opensource", "learning", "outreach", "chat")


def app_row(**kw):
    base = {"job_id": "184771", "company": "Acme", "title": "W27 Dev", "via": "SCOPE",
            "deadline": "2026-10-05 09:00 PT", "submitted_at": "2026-10-01T11:50:10Z"}
    base.update(kw)
    return base


def posting(**kw):
    base = {"job_id": "900", "company": "Lyft", "title": "SWE Intern", "term": "S27",
            "deadline": "2026-10-20 09:00 PT", "link": None, "where": None, "note": "CL optional",
            "status": "open", "added_at": "2026-10-02T20:42:28Z", "match": "Lyft"}
    base.update(kw)
    return base


_n = [0]


def edit(kind, op, target, at=None, **kw):
    _n[0] += 1
    # Default times climb with every edit made, so file order and `at` order agree
    # unless a test says otherwise.
    default = (datetime(2026, 10, 4, 12) + timedelta(seconds=_n[0])).isoformat() + ".000Z"
    e = {"id": "e-%d" % _n[0], "at": at or default,
         "kind": kind, "target": target, "op": op}
    e.update(kw)
    return e


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self._real = {p: getattr(store, p) for p in PATHS}
        names = {"LEDGER_EDITS": "public/ledger-edits.json",
                 "LEDGER_IMPORTED": "state/ledger_imported.json",
                 "LEDGER": "data/ledger.jsonl", "APPLICATIONS": "data/applications.jsonl",
                 "OPEN_POSTINGS": "data/open_postings.jsonl"}
        for p, rel in names.items():
            path = os.path.join(self.dir, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            setattr(store, p, path)

    def tearDown(self):
        for p, v in self._real.items():
            setattr(store, p, v)
        shutil.rmtree(self.dir)

    def seed(self, rows=(), postings=(), ledger=()):
        store.write(store.APPLICATIONS, list(rows))
        store.write(store.OPEN_POSTINGS, list(postings))
        store.write(store.LEDGER, list(ledger))

    def log(self, *edits):
        with open(store.LEDGER_EDITS, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "edits": list(edits)}, f)

    def run_import(self, **kw):
        out = io.StringIO()
        with redirect_stdout(out):
            result = ledger_import.run(**kw)
        self.printed = out.getvalue()
        return result

    def rows(self):
        return store.read(store.APPLICATIONS)

    def postings(self):
        return store.read(store.OPEN_POSTINGS)

    def ledger(self):
        return store.read(store.LEDGER)

    def imported(self):
        with open(store.LEDGER_IMPORTED, encoding="utf-8") as f:
            return json.load(f)["applied"]

    def snapshot(self):
        out = {}
        for p in PATHS:
            path = getattr(store, p)
            out[p] = None
            if os.path.exists(path):
                with open(path, "rb") as f:
                    out[p] = f.read()
        return out


class ApplicationEvents(Base):
    def test_an_event_changes_status_and_keeps_the_history(self):
        self.seed(rows=[app_row()])
        e = edit("application", "event", "184771", at="2026-10-04T15:30:00.123Z",
                 event={"status": "interview", "note": "phone screen Oct 9"})
        self.log(e)
        self.run_import()
        row = self.rows()[0]
        self.assertEqual(row["status"], "interview")
        self.assertEqual(row["events"], [{"at": "2026-10-04T15:30:00Z", "status": "interview",
                                          "note": "phone screen Oct 9"}])
        self.assertEqual(self.imported(), [e["id"]])

    def test_a_note_event_logs_without_changing_status(self):
        self.seed(rows=[app_row(status="interview")])
        self.log(edit("application", "event", "184771",
                      event={"status": "note", "note": "recruiter emailed"}))
        self.run_import()
        row = self.rows()[0]
        self.assertEqual(row["status"], "interview")
        self.assertEqual(row["events"][-1]["note"], "recruiter emailed")

    def test_saved_on_a_submitted_application_is_reported_and_skipped(self):
        self.seed(rows=[app_row()])
        e = edit("application", "event", "184771", event={"status": "saved", "note": ""})
        self.log(e)
        result = self.run_import()
        self.assertEqual(result["skipped"], 1)
        self.assertNotIn("events", self.rows()[0])
        self.assertEqual(self.imported(), [e["id"]])

    def test_applied_on_a_posting_moves_it_into_applications(self):
        self.seed(postings=[posting()])
        self.log(edit("application", "event", "900", event={"status": "applied", "note": ""}))
        self.run_import()
        self.assertEqual(self.postings()[0]["status"], "applied")
        self.assertEqual([r["job_id"] for r in self.rows()], ["900"])
        self.assertEqual(self.rows()[0]["via"], "employer site")

    def test_rejected_on_a_posting_skips_it(self):
        self.seed(postings=[posting()])
        self.log(edit("application", "event", "900", event={"status": "rejected", "note": ""}))
        self.run_import()
        self.assertEqual(self.postings()[0]["status"], "skipped")
        self.assertEqual(self.rows(), [])

    def test_a_note_on_a_posting_is_appended_to_its_note(self):
        self.seed(postings=[posting()])
        self.log(edit("application", "event", "900",
                      event={"status": "note", "note": "Workday account made"}))
        self.run_import()
        p = self.postings()[0]
        self.assertEqual(p["status"], "open")
        self.assertEqual(p["note"], "CL optional; Workday account made")

    def test_planview_applied_goes_to_the_application_row_not_a_second_row(self):
        # SCOPE half submitted, the careers-portal half still an open posting.
        self.seed(rows=[app_row(job_id="184830", company="Planview", status="interview")],
                  postings=[posting(job_id="184830", company="Planview")])
        self.log(edit("application", "event", "184830", event={"status": "applied", "note": ""}))
        self.run_import()
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["status"], "interview", "the employer half must not walk it back")
        self.assertEqual(len(rows[0]["events"]), 1)
        self.assertEqual(self.postings()[0]["status"], "applied")


class ApplicationSetAddDelete(Base):
    def test_set_maps_wire_names_and_routes_status_through_an_event(self):
        self.seed(rows=[app_row()])
        self.log(edit("application", "set", "184771",
                      fields={"note": "ask Bill", "referral": "asked", "submitted": "2026-09-30",
                              "status": "withdrawn", "id": "renamed", "events": []}))
        self.run_import()
        row = self.rows()[0]
        self.assertEqual(row["job_id"], "184771", "a set never renames a row")
        self.assertEqual(row["note"], "ask Bill")
        self.assertEqual(row["referral"], "asked")
        self.assertEqual(row["submitted_at"], "2026-09-30")
        self.assertNotIn("submitted", row)
        self.assertEqual(row["status"], "withdrawn")
        self.assertEqual(row["events"][-1]["note"], "")

    def test_set_with_an_unchanged_status_adds_no_event(self):
        self.seed(rows=[app_row()])
        self.log(edit("application", "set", "184771", fields={"status": "applied", "note": "x"}))
        self.run_import()
        self.assertNotIn("events", self.rows()[0])

    def test_set_on_a_posting(self):
        self.seed(postings=[posting()])
        self.log(edit("application", "set", "900", fields={"deadline": "2026-10-25", "hold": "referral"}))
        self.run_import()
        p = self.postings()[0]
        self.assertEqual((p["deadline"], p["hold"], p["status"]), ("2026-10-25", "referral", "open"))

    def test_a_set_whose_status_fails_writes_nothing(self):
        self.seed(rows=[app_row()])
        self.log(edit("application", "set", "184771", fields={"note": "x", "status": "saved"}))
        result = self.run_import()
        self.assertEqual(result["skipped"], 1)
        self.assertNotIn("note", self.rows()[0])

    def test_add_saved_is_an_open_posting(self):
        self.seed()
        self.log(edit("application", "add", "app-k3x", fields={
            "id": "app-k3x", "company": "Mechanize", "title": "Intern", "status": "saved",
            "via": None, "term": "S27", "deadline": "2026-11-01", "submitted": None,
            "link": "https://jobs.example/1", "where": None, "referral": "want",
            "referrer": None, "hold": None, "note": None, "events": []}))
        self.run_import()
        self.assertEqual(self.rows(), [])
        p = self.postings()[0]
        self.assertEqual(set(p), {"job_id", "company", "title", "deadline", "link", "where", "note",
                                  "term", "hold", "referral", "referrer", "status", "added_at",
                                  "match"})
        self.assertEqual((p["job_id"], p["status"], p["match"], p["referral"]),
                         ("app-k3x", "open", "Mechanize", "want"))

    def test_add_with_no_status_is_saved_too(self):
        self.seed()
        self.log(edit("application", "add", "app-1", fields={"company": "Acme"}))
        self.run_import()
        self.assertEqual(self.postings()[0]["status"], "open")

    def test_add_applied_is_an_application(self):
        self.seed()
        self.log(edit("application", "add", "app-k3y", fields={
            "company": "Mechanize", "title": "Intern", "status": "applied", "via": "employer site",
            "submitted": "2026-10-03", "referral": "none"}))
        self.run_import()
        self.assertEqual(self.postings(), [])
        r = self.rows()[0]
        self.assertEqual(set(r), {"job_id", "company", "title", "via", "deadline", "link", "where",
                                  "note", "term", "referral", "referrer", "status",
                                  "submitted_at", "match"})
        self.assertEqual((r["job_id"], r["status"], r["submitted_at"], r["match"]),
                         ("app-k3y", "applied", "2026-10-03", "Mechanize"))

    def test_add_of_an_existing_id_acts_as_a_set(self):
        self.seed(rows=[app_row()])
        self.log(edit("application", "add", "184771",
                      fields={"company": "Acme", "status": "applied", "note": "again"}))
        self.run_import()
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["note"], "again")
        self.assertNotIn("events", rows[0])

    def test_delete_a_posting_skips_it(self):
        self.seed(postings=[posting()])
        self.log(edit("application", "delete", "900"))
        self.run_import()
        p = self.postings()[0]
        self.assertEqual((p["status"], p["why"]), ("skipped", "deleted in the app"))

    def test_a_submitted_application_is_never_deleted(self):
        self.seed(rows=[app_row()])
        before = self.snapshot()["APPLICATIONS"]
        e = edit("application", "delete", "184771")
        self.log(e)
        result = self.run_import()
        self.assertEqual(result["skipped"], 1)
        self.assertIn("never deleted", self.printed)
        self.assertEqual(self.snapshot()["APPLICATIONS"], before)
        self.assertEqual(self.imported(), [e["id"]])


class OtherKinds(Base):
    def test_add_set_and_delete_for_every_kind(self):
        for kind in OTHER_KINDS:
            with self.subTest(kind=kind):
                self.seed()
                if os.path.exists(store.LEDGER_IMPORTED):
                    os.unlink(store.LEDGER_IMPORTED)
                self.log(edit(kind, "add", "x-1", fields={"id": "x-1", "note": "first", "star": False}))
                self.run_import()
                self.assertEqual(self.ledger(), [{"kind": kind, "id": "x-1", "note": "first",
                                                  "star": False}])

                self.log(edit(kind, "set", "x-1", fields={"note": "second"}))
                self.run_import()
                self.assertEqual(self.ledger(), [{"kind": kind, "id": "x-1", "note": "second",
                                                  "star": False}])

                self.log(edit(kind, "delete", "x-1"))
                self.run_import()
                self.assertEqual(self.ledger(), [{"kind": kind, "id": "x-1", "deleted": True}])

    def test_set_on_a_pipeline_person_creates_the_overlay(self):
        self.seed(ledger=[{"kind": "company", "id": "ada@acme.example", "note": "a company"}])
        self.log(edit("person", "set", "ada@acme.example", fields={"canRefer": True, "state": "met"}))
        self.run_import()
        self.assertEqual(self.ledger()[1], {"kind": "person", "id": "ada@acme.example",
                                            "canRefer": True, "state": "met"})
        self.assertEqual(self.ledger()[0]["note"], "a company", "same id, other kind: untouched")

    def test_delete_with_no_row_still_leaves_a_tombstone(self):
        self.seed()
        self.log(edit("person", "delete", "ada@acme.example"))
        self.run_import()
        self.assertEqual(self.ledger(), [{"kind": "person", "id": "ada@acme.example", "deleted": True}])

    def test_add_brings_back_a_deleted_entity(self):
        self.seed(ledger=[{"kind": "learning", "id": "learn-1", "deleted": True}])
        self.log(edit("learning", "add", "learn-1", fields={"topic": "Kubernetes", "status": "todo"}))
        self.run_import()
        self.assertEqual(self.ledger(), [{"kind": "learning", "id": "learn-1",
                                          "topic": "Kubernetes", "status": "todo"}])

    def test_an_event_on_a_person_is_reported(self):
        self.seed()
        e = edit("person", "event", "ada@acme.example", event={"status": "met", "note": ""})
        self.log(e)
        result = self.run_import()
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(self.ledger(), [])
        self.assertEqual(self.imported(), [e["id"]])


class Bookkeeping(Base):
    def test_edits_apply_in_at_order_not_file_order(self):
        self.seed(rows=[app_row()])
        late = edit("application", "event", "184771", at="2026-10-04T18:00:00.000Z",
                    event={"status": "rejected", "note": "email"})
        early = edit("application", "event", "184771", at="2026-10-04T09:00:00.000Z",
                     event={"status": "interview", "note": "screen"})
        late_note = edit("opensource", "set", "oss-1", at="2026-10-04T18:00:00.000Z",
                         fields={"note": "late"})
        early_note = edit("opensource", "set", "oss-1", at="2026-10-04T09:00:00.000Z",
                          fields={"note": "early"})
        self.log(late, late_note, early, early_note)
        self.run_import()
        row = self.rows()[0]
        self.assertEqual(row["status"], "rejected")
        self.assertEqual([e["status"] for e in row["events"]], ["interview", "rejected"])
        self.assertEqual(self.ledger()[0]["note"], "late")

    def test_a_second_run_changes_nothing(self):
        self.seed(rows=[app_row()], postings=[posting()])
        self.log(edit("application", "event", "184771", event={"status": "interview", "note": "x"}),
                 edit("application", "event", "900", event={"status": "applied", "note": ""}),
                 edit("application", "delete", "nope"),
                 edit("person", "set", "ada@acme.example", fields={"state": "met"}))
        first = self.run_import()
        self.assertEqual((first["applied"], first["skipped"]), (3, 1))
        once = self.snapshot()
        second = self.run_import()
        self.assertEqual((second["applied"], second["skipped"]), (0, 0))
        self.assertEqual(self.snapshot(), once)
        self.assertEqual(self.printed.strip(), "ledger-import: nothing new")

    def test_an_unknown_target_is_reported_once_and_never_retried(self):
        self.seed(rows=[app_row()])
        bad = edit("application", "event", "app-gone", event={"status": "offer", "note": ""})
        self.log(bad)
        result = self.run_import()
        self.assertEqual(result["skipped"], 1)
        self.assertIn("unknown target app-gone", self.printed)
        self.assertEqual(self.imported(), [bad["id"]])
        self.assertEqual(self.run_import()["skipped"], 0)

    def test_already_imported_ids_are_skipped_and_kept(self):
        self.seed(rows=[app_row()])
        old = edit("application", "event", "184771", event={"status": "interview", "note": ""})
        new = edit("application", "event", "184771", event={"status": "offer", "note": ""})
        ledger_import.save_imported([old["id"]])
        self.log(old, new)
        self.run_import()
        self.assertEqual([e["status"] for e in self.rows()[0]["events"]], ["offer"])
        self.assertEqual(self.imported(), [old["id"], new["id"]])

    def test_a_missing_or_empty_log_is_a_no_op(self):
        self.seed(rows=[app_row()])
        before = self.snapshot()
        self.assertEqual(self.run_import(quiet=1)["applied"], 0)
        self.assertEqual(self.printed, "", "quiet keeps the morning brief clean")
        with open(store.LEDGER_EDITS, "w") as f:
            f.write("  \n")
        self.run_import()
        after = self.snapshot()
        after["LEDGER_EDITS"] = None
        self.assertEqual(after, before)

    def test_malformed_json_raises_and_changes_nothing(self):
        self.seed(rows=[app_row()], postings=[posting()])
        with open(store.LEDGER_EDITS, "w") as f:
            f.write('{"version": 1, "edits": [{"id": "e-1",')
        before = self.snapshot()
        with self.assertRaises(ValueError) as ctx:
            self.run_import()
        self.assertIn("not valid JSON", str(ctx.exception))
        self.assertEqual(self.snapshot(), before)

    def test_the_wrong_shape_or_version_raises_too(self):
        self.seed()
        for text in ('[]', '{"version": 2, "edits": []}', '{"version": 1}'):
            with self.subTest(text=text):
                with open(store.LEDGER_EDITS, "w") as f:
                    f.write(text)
                with self.assertRaises(ValueError):
                    self.run_import()
                self.assertFalse(os.path.exists(store.LEDGER_IMPORTED))


class Wiring(Base):
    def test_the_pre_step_never_takes_the_requested_job_down(self):
        import run
        with open(store.LEDGER_EDITS, "w") as f:
            f.write("not json")
        out = io.StringIO()
        with redirect_stdout(out):
            run._import_ledger_edits()
        self.assertTrue(out.getvalue().startswith("ledger-import skipped: "), out.getvalue())
        self.assertEqual(out.getvalue().count("\n"), 1)
        self.assertIn("ledger-import", run.JOBS)


if __name__ == "__main__":
    unittest.main()
