"""The exporter decides the order the app shows people in. queue_daily decides
the order drafts get written in. They are supposed to agree, and for a while
they did not: the queue sorted on funding stage and the exporter ignored it, so
the top card and the top draft were different people.
"""
import contextlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "jobs"))
import export_app  # noqa: E402
import prefs  # noqa: E402
import store  # noqa: E402


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


class EmailLessContacts(unittest.TestCase):
    """resolve-contacts records a failed lookup as a contact row with no email,
    so the retry window has a timestamp to move. Those are attempts, not people:
    the exporter keys every row on the address, and one of them took export-app
    down with an AttributeError rather than skipping the row.
    """

    def test_a_row_with_no_email_is_not_a_person(self):
        contacts = [{"domain": "a.example", "email": "real@a.example"},
                    {"domain": "b.example", "email": None, "state": "resolved_none"}]
        kept = [c for c in contacts if c.get("email")]
        self.assertEqual([c["domain"] for c in kept], ["a.example"])

    def test_the_exporter_drops_them_rather_than_raising(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "data"))
            rows = {"companies.jsonl": [{"domain": "b.example", "name": "B"}],
                    "research.jsonl": [],
                    "contacts.jsonl": [{"domain": "b.example", "email": None,
                                        "state": "resolved_none"}]}
            for name, records in rows.items():
                with open(os.path.join(tmp, "data", name), "w", encoding="utf-8") as fh:
                    for r in records:
                        fh.write(json.dumps(r) + "\n")
            real = export_app.ROOT
            try:
                export_app.ROOT = tmp
                kept = [c for c in export_app._read("contacts.jsonl") if c.get("email")]
                people = [export_app.person(c, {}, {}) for c in kept]
            finally:
                export_app.ROOT = real
        self.assertEqual(people, [])


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

    def test_scores_are_what_the_scorer_would_produce(self):
        # The scores here are stored, not recomputed at load time, so a change
        # to _score leaves them behind and the published demo ranks people by a
        # rule that no longer exists. That is exactly what happened to the
        # source weighting on Sept 7 2026.
        for p in self._example()["people"]:
            self.assertEqual(p["score"], export_app._score(p), p.get("company"))

    def test_is_stored_in_the_order_the_app_reads_it_in(self):
        people = self._example()["people"]
        self.assertEqual([p["id"] for p in people],
                         [p["id"] for p in sorted(people, key=export_app.order_key)],
                         "the demo is not in ranked order")

    def test_no_person_carries_a_real_address(self):
        for p in self._example()["people"]:
            self.assertTrue(p["email"].endswith(".example"), p["email"])

    def test_ledger_emails_are_all_on_the_example_tld(self):
        # The published copy runs on this file, so one real address in the
        # ledger half is a leak exactly like one in the people half.
        ledger = self._example()["ledger"]
        emails = [p["email"] for p in ledger["people"] if p["email"]]
        self.assertTrue(emails)
        for e in emails:
            self.assertTrue(e.endswith(".example"), e)
        for e in re.findall(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", json.dumps(ledger)):
            self.assertTrue(e.endswith(".example"), e)

    def test_ledger_carries_exactly_the_fields_the_exporter_emits(self):
        ledger = self._example()["ledger"]
        self.assertEqual(set(ledger), LEDGER_KEYS)
        shapes = {
            "applications": set(export_app.application({})),
            "people": set(export_app.ledger_person({}, {})),
            "companies": {"id", "name"} | set(export_app.COMPANY_DEFAULTS),
            "opensource": {"id"} | set(export_app.OSS_DEFAULTS),
            "learning": {"id"} | set(export_app.LEARN_DEFAULTS),
            "outreach": {"id"} | set(export_app.OUTREACH_DEFAULTS),
            "chats": {"id"} | set(export_app.CHAT_DEFAULTS),
        }
        for key, fields in shapes.items():
            self.assertTrue(ledger[key], key)
            for item in ledger[key]:
                self.assertEqual(set(item), fields, "%s %s" % (key, item.get("id")))

    def test_ledger_shows_every_application_status(self):
        statuses = set(a["status"] for a in self._example()["ledger"]["applications"])
        self.assertEqual(statuses, {"saved", "applied", "interview", "offer", "rejected",
                                    "withdrawn", "closed"})


LEDGER_KEYS = {"applications", "people", "companies", "opensource", "learning",
               "outreach", "chats", "appliedEdits"}

STORE_PATHS = {"APPLICATIONS": "data/applications.jsonl",
               "OPEN_POSTINGS": "data/open_postings.jsonl",
               "CONTACTS": "data/contacts.jsonl", "COMPANIES": "data/companies.jsonl",
               "LEDGER": "data/ledger.jsonl", "LEDGER_IMPORTED": "state/ledger_imported.json"}


@contextlib.contextmanager
def isolated_store(files=None):
    """Point store's paths, and the exporter's root and output, at a temp dir.
    `files` maps a STORE_PATHS name to a list of rows, or to a dict for the
    one JSON (not jsonl) file."""
    saved = dict((k, getattr(store, k)) for k in STORE_PATHS)
    root, out = export_app.ROOT, export_app.OUT
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "data"))
        os.makedirs(os.path.join(tmp, "state"))
        try:
            for k, rel in STORE_PATHS.items():
                setattr(store, k, os.path.join(tmp, rel))
            export_app.ROOT, export_app.OUT = tmp, os.path.join(tmp, "data.js")
            for k, rows in (files or {}).items():
                with open(getattr(store, k), "w", encoding="utf-8") as fh:
                    if isinstance(rows, dict):
                        json.dump(rows, fh)
                    else:
                        for r in rows:
                            fh.write(json.dumps(r) + "\n")
            yield tmp
        finally:
            for k, v in saved.items():
                setattr(store, k, v)
            export_app.ROOT, export_app.OUT = root, out


def build(applied=(), postings=(), contacts=(), companies=(), rows=(), edits=()):
    return export_app.build_ledger(list(applied), list(postings), list(contacts),
                                   list(companies), list(rows), list(edits))


class LedgerSeed(unittest.TestCase):
    """SEED.ledger, against the contract in app/src/ledger/types.ts. The app
    reads these field names verbatim, so a key that drifts here does not crash
    anything - a column just goes blank."""

    def test_an_empty_store_still_has_every_key(self):
        with isolated_store():
            ledger = export_app.load_ledger()
        self.assertEqual(set(ledger), LEDGER_KEYS)
        self.assertTrue(all(v == [] for v in ledger.values()))

    def test_data_js_carries_the_ledger_beside_everything_it_had(self):
        with isolated_store({"APPLICATIONS": [{"job_id": "1", "company": "Acme",
                                               "title": "W27 Intern",
                                               "submitted_at": "2026-10-01T18:00:00Z"}],
                             "LEDGER_IMPORTED": {"applied": ["e-1-abcd"]}}):
            with open(os.devnull, "w") as null, contextlib.redirect_stdout(null):
                export_app.run()
            with open(export_app.OUT, encoding="utf-8") as fh:
                src = fh.read()
        seed = json.loads(src[src.index("window.SEED = ") + 14:].rstrip()[:-1])
        for key in ("generated", "from", "counts", "people", "ledger"):
            self.assertIn(key, seed)
        self.assertEqual(set(seed["ledger"]), LEDGER_KEYS)
        self.assertEqual([a["id"] for a in seed["ledger"]["applications"]], ["1"])
        self.assertEqual(seed["ledger"]["appliedEdits"], ["e-1-abcd"])

    def test_submitted_is_applied_and_a_posting_is_saved(self):
        ledger = build(
            applied=[{"job_id": 184771, "company": "Acme", "title": "W27 Software Intern",
                      "via": "SCOPE", "deadline": "2026-10-05 09:00 PT",
                      "submitted_at": "2026-10-01T05:30:00Z"}],
            postings=[{"job_id": "184593", "company": "Globex", "title": "SWE Intern",
                       "term": "S27", "deadline": "2026-10-20", "link": "https://x.example/j",
                       "where": None, "status": "open", "hold": "referral"},
                      {"job_id": "g-2", "company": "Globex", "title": "Data Intern"}])
        applied, saved, unstated = ledger["applications"]
        self.assertEqual(applied["id"], "184771")
        self.assertEqual(applied["status"], "applied")
        self.assertEqual(applied["term"], "W27")
        # 05:30 UTC on the 1st is still the evening of the 30th in Vancouver.
        self.assertEqual(applied["submitted"], "2026-09-30")
        self.assertEqual((applied["referral"], applied["events"]), ("none", []))
        self.assertEqual((saved["status"], saved["submitted"]), ("saved", None))
        self.assertEqual((saved["term"], saved["deadline"]), ("S27", "2026-10-20"))
        self.assertEqual((saved["referral"], saved["hold"]), ("want", "referral"))
        self.assertEqual(unstated["status"], "saved")
        self.assertEqual((unstated["term"], unstated["via"], unstated["note"]),
                         (None, None, None))

    def test_applied_and_skipped_postings_are_left_out(self):
        ledger = build(postings=[
            {"job_id": "a", "company": "Acme", "title": "x", "status": "applied"},
            {"job_id": "b", "company": "Acme", "title": "x", "status": "skipped"},
            {"job_id": "c", "company": "Acme", "title": "x", "status": "open"}])
        self.assertEqual([a["id"] for a in ledger["applications"]], ["c"])

    def test_a_shared_id_keeps_the_application_and_borrows_where(self):
        # Planview: the SCOPE half went in, the careers-portal half is still open.
        ledger = build(
            applied=[{"job_id": "184830", "company": "Planview", "title": "W27 Co-op",
                      "via": "SCOPE", "submitted_at": "2026-10-01T11:50:10Z"},
                     {"job_id": "184831", "company": "Planview", "title": "W27 Co-op",
                      "where": "already here", "submitted_at": "2026-10-01T11:50:10Z"}],
            postings=[{"job_id": "184830", "company": "Planview", "title": "Co-op",
                       "where": "careers.planview.example, job 5151",
                       "link": "https://x.example/5151", "status": "open"},
                      {"job_id": "184831", "company": "Planview", "title": "Co-op",
                       "where": "somewhere else", "status": "open"}])
        apps = ledger["applications"]
        self.assertEqual([a["id"] for a in apps], ["184830", "184831"])
        self.assertEqual(apps[0]["status"], "applied")
        self.assertEqual(apps[0]["where"], "careers.planview.example, job 5151")
        self.assertEqual(apps[0]["link"], "https://x.example/5151")
        self.assertEqual(apps[1]["where"], "already here", "borrows only into an empty field")

    def test_company_id_mirrors_the_typescript(self):
        self.assertEqual(export_app.company_id("Fidelity Canada"), "fidelity-canada")
        self.assertEqual(
            export_app.company_id("NRC - National Research Council Canada (ACRD)"),
            "nrc-national-research-council-canada-acrd")
        self.assertEqual(export_app.company_id("  --Acme, Inc.--  "), "acme-inc")

    def test_a_contact_becomes_a_person(self):
        companies = [{"domain": "np.example", "name": "NP Co", "what_they_build": "Widgets.",
                      "sources": [{"source": "next_play"}]}]
        ledger = build(companies=companies, contacts=[
            {"domain": "np.example", "company_name": "NP Co", "email": "Jobs@NP.example",
             "method": "hn_posting", "state": "awaiting_reply",
             "sent_at": "2026-10-01T00:22:41Z", "queued_at": "2026-10-03T00:00:00Z"},
            {"domain": "li.example", "company_name": "Li Co", "email": None, "name": "Dana O",
             "method": "manual_add", "state": "queued",
             "linkedin": "https://www.linkedin.com/in/dana-o-example/"},
            {"domain": "gone.example", "email": None, "state": "resolved_none",
             "method": "research"},
            {"domain": "odd.example", "email": "x@odd.example", "state": "weird",
             "method": "github_commits"}])
        np_, li, odd = ledger["people"]
        self.assertEqual(np_["id"], "jobs@np.example")
        self.assertEqual(np_["how"], "Next Play newsletter")
        self.assertEqual(np_["last"], "2026-09-30", "sent, not queued, and in Pacific time")
        self.assertEqual(li["id"], "p-dana-o-li-co")
        self.assertEqual(li["linkedin"], "https://www.linkedin.com/in/dana-o-example/")
        self.assertEqual((li["how"], li["state"], li["last"]), ("manual add", "queued", None))
        self.assertEqual((odd["state"], odd["how"], odd["company"]),
                         ("new", "GitHub commits", "odd.example"))
        self.assertEqual([c["id"] for c in ledger["companies"]], ["np-co", "li-co", "odd-example"])
        self.assertEqual(ledger["companies"][0]["why"], "Widgets.")

    def test_ledger_rows_overlay_add_and_tombstone(self):
        contacts = [{"domain": "acme.example", "company_name": "Acme", "state": "new",
                     "email": "a@acme.example", "name": "Ana", "method": "github_commits"},
                    {"domain": "acme.example", "company_name": "Acme", "state": "new",
                     "email": "b@acme.example", "name": "Ben", "method": "github_commits"}]
        rows = [
            {"kind": "person", "id": "a@acme.example", "state": "met", "canRefer": True},
            {"kind": "person", "id": "p-jo-lee-initech", "name": "Jo Lee",
             "company": "Initech", "how": "classmate", "state": "friend"},
            # The pipeline still has Ben; the tombstone wins anyway.
            {"kind": "person", "id": "b@acme.example", "deleted": True},
            {"kind": "company", "id": "acme", "star": True, "note": "top pick"},
            {"kind": "company", "id": "globex", "deleted": True},
            {"kind": "company", "id": "hooli", "name": "Hooli"},
            {"kind": "opensource", "id": "oss-1", "project": "vitest", "status": "working"},
            {"kind": "opensource", "id": "oss-2", "project": "dropped one"},
            {"kind": "opensource", "id": "oss-2", "deleted": True},
            {"kind": "learning", "id": "learn-1", "topic": "Kubernetes basics"},
            {"kind": "chat", "id": "chat-1", "type": "interview", "company": "Acme",
             "when": "2026-10-16 12:00"},
            {"kind": "chat", "id": "chat-2", "company": "Initech"},
            {"kind": "chat", "id": "chat-2", "deleted": True},
        ]
        ledger = build(contacts=contacts, rows=rows,
                       applied=[{"job_id": "9", "company": "Globex", "title": "Intern"}])
        people = dict((p["id"], p) for p in ledger["people"])
        self.assertEqual(list(people), ["a@acme.example", "p-jo-lee-initech"])
        self.assertEqual((people["a@acme.example"]["state"],
                          people["a@acme.example"]["canRefer"],
                          people["a@acme.example"]["email"]), ("met", True, "a@acme.example"))
        self.assertEqual(set(people["p-jo-lee-initech"]),
                         set(export_app.ledger_person({}, {})), "an added person gets every field")
        companies = dict((c["id"], c) for c in ledger["companies"])
        self.assertEqual(sorted(companies), ["acme", "hooli", "initech"])
        self.assertEqual((companies["acme"]["star"], companies["acme"]["note"]),
                         (True, "top pick"))
        self.assertEqual([o["id"] for o in ledger["opensource"]], ["oss-1"])
        self.assertEqual(ledger["opensource"][0]["status"], "working")
        self.assertEqual(ledger["learning"][0]["status"], "todo")
        self.assertEqual(set(ledger["learning"][0]), {"id"} | set(export_app.LEARN_DEFAULTS))
        self.assertEqual([c["id"] for c in ledger["chats"]], ["chat-1"])
        self.assertEqual((ledger["chats"][0]["type"], ledger["chats"][0]["status"],
                          ledger["chats"][0]["when"]), ("interview", "upcoming", "2026-10-16 12:00"))
        self.assertEqual(set(ledger["chats"][0]), {"id"} | set(export_app.CHAT_DEFAULTS))


if __name__ == "__main__":
    unittest.main()
