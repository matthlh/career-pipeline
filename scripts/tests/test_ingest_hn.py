"""What the HN parser decides a company *is*.

The domain it picks becomes the dedupe key for the whole store, so these pin
current behaviour rather than assert it is ideal - see the note on
test_the_first_link_wins_even_when_the_address_disagrees.
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "jobs"))
import ingest_hn as hn  # noqa: E402


def parse(text):
    return hn.parse_comment(text, "Who is hiring", "1", "2")


class Skips(unittest.TestCase):
    def test_aggregators_and_big_co_are_not_targets(self):
        for d in ("greenhouse.io", "lever.co", "linkedin.com", "google.com"):
            self.assertTrue(hn.is_skipped(d), d)

    def test_matches_subdomains_of_them(self):
        # jobs.ashbyhq.com is the same aggregator wearing a hat.
        self.assertTrue(hn.is_skipped("jobs.ashbyhq.com"))
        self.assertTrue(hn.is_skipped("boards.greenhouse.io"))

    def test_does_not_match_a_company_that_merely_ends_similarly(self):
        # "notgoogle.com" ends with "google.com" as a *string* but not as a
        # domain suffix, which is why the check anchors on the dot.
        self.assertFalse(hn.is_skipped("notgoogle.com"))
        self.assertFalse(hn.is_skipped("lantern.example"))


class ParseComment(unittest.TestCase):
    def test_pulls_the_pipe_convention_apart(self):
        rec = parse("Lantern | Senior Engineer | Remote (US) | https://lantern.example")
        self.assertEqual(rec["name"], "Lantern")
        self.assertEqual(rec["domain"], "lantern.example")

    def test_a_posting_with_no_link_is_not_a_company(self):
        self.assertIsNone(parse("We are hiring! Email us."))
        self.assertIsNone(parse(""))
        self.assertIsNone(parse(None))

    def test_ignores_a_link_that_is_only_an_ats(self):
        rec = parse("Lantern | Eng | https://boards.greenhouse.io/lantern "
                    "and https://lantern.example")
        self.assertEqual(rec["domain"], "lantern.example")

    def test_prefers_the_link_that_echoes_the_company_name(self):
        rec = parse("Stellwater | Eng | https://blog.example https://stellwater.example")
        self.assertEqual(rec["domain"], "stellwater.example")

    def test_falls_back_to_the_domain_only_when_the_name_is_empty_or_huge(self):
        # Pinning what it does, which is not what you would guess: with no pipe
        # to split on, any leading text under 60 characters becomes the company
        # name. "Senior Python Backend Engineer" is a real company name in the
        # store for exactly this reason. Fixing it means guessing which part of
        # a free-form posting is the company, so it stays a known limitation.
        self.assertEqual(parse("https://lantern.example we are hiring")["name"],
                         "we are hiring")
        long_prose = "x" * 70
        self.assertEqual(parse("%s https://lantern.example" % long_prose)["name"],
                         "lantern.example")

    def test_does_not_keep_the_brackets_a_stripped_url_sat_in(self):
        # "Cerity Partners (  )" and "VLM Run ( )" are both in the store.
        self.assertEqual(parse("VLM Run ( https://vlm.example ) | Eng")["name"], "VLM Run")
        self.assertEqual(parse("Acme [https://acme.example] | Eng")["name"], "Acme")

    def test_notices_an_internship(self):
        self.assertTrue(parse("Lantern | Intern | https://lantern.example")["mentionsIntern"
                              if False else "mentions_intern"])
        self.assertFalse(parse("Lantern | Staff Eng | https://lantern.example")["mentions_intern"])

    def test_takes_an_address_the_posting_printed(self):
        rec = parse("Lantern | Eng | https://lantern.example - email dana@lantern.example")
        self.assertEqual(rec["direct_email"], "dana@lantern.example")

    def test_the_first_link_wins_even_when_the_address_disagrees(self):
        # Pinning, not endorsing. In the real store 21 of 108 posting-sourced
        # contacts sit on a different domain than their company record, and the
        # address is usually the more trustworthy of the two - somebody printed
        # it in order to be written to. Changing which one wins would move the
        # dedupe key for existing records, so it is a decision, not a cleanup.
        rec = parse("Acme | Eng | https://acme-jobs.example - write to founder@acme.example")
        self.assertEqual(rec["domain"], "acme-jobs.example")
        self.assertEqual(rec["direct_email"], "founder@acme.example")


if __name__ == "__main__":
    unittest.main()
