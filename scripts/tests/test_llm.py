"""Which failures halt a run, and which only lose one record.

This distinction has already cost a backlog once: a whole-run usage limit was
treated as a per-record failure, and 682 companies were marked permanently
enrich_failed instead of the job stopping and leaving them alone. Every branch
below is that decision, so all of them are worth pinning.

Nothing here runs the CLI. subprocess.run is replaced.
"""
import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import llm  # noqa: E402


class Fake(object):
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


class Base(unittest.TestCase):
    def setUp(self):
        self._real = llm.subprocess.run

    def tearDown(self):
        llm.subprocess.run = self._real

    def returns(self, **kw):
        llm.subprocess.run = lambda *a, **k: Fake(**kw)

    def raises(self, exc):
        def boom(*a, **k):
            raise exc
        llm.subprocess.run = boom

    @staticmethod
    def envelope(result):
        return json.dumps({"type": "result", "is_error": False, "result": result})


class HaltsTheWholeRun(Base):
    """LLMUnavailable. The caller must stop and leave the backlog untouched."""

    def test_every_usage_limit_phrasing(self):
        for marker in llm.LIMIT_MARKERS:
            self.returns(returncode=1, stderr="Error: %s reached" % marker)
            with self.assertRaises(llm.LLMUnavailable, msg=marker):
                llm.ask("hi")

    def test_a_non_zero_exit_with_no_output_at_all(self):
        # This is what a usage limit actually looks like from the CLI, and
        # reading it as a per-record failure is the bug that cost 682 records.
        self.returns(returncode=1, stderr="", stdout="")
        with self.assertRaises(llm.LLMUnavailable):
            llm.ask("hi")

    def test_the_binary_is_not_there(self):
        self.raises(OSError("No such file or directory: 'claude'"))
        with self.assertRaises(llm.LLMUnavailable):
            llm.ask("hi")


class LosesOneRecord(Base):
    """LLMError. The caller skips this record and keeps going."""

    def test_an_ordinary_non_zero_exit(self):
        self.returns(returncode=2, stderr="bad flag --nope")
        with self.assertRaises(llm.LLMError):
            llm.ask("hi")
        self.returns(returncode=2, stderr="bad flag --nope")
        with self.assertRaises(llm.LLMError) as cm:
            llm.ask("hi")
        self.assertNotIsInstance(cm.exception, llm.LLMUnavailable)

    def test_a_timeout_is_one_slow_prompt_not_a_dead_cli(self):
        self.raises(subprocess.TimeoutExpired("claude", llm.TIMEOUT))
        with self.assertRaises(llm.LLMError) as cm:
            llm.ask("hi")
        self.assertNotIsInstance(cm.exception, llm.LLMUnavailable)

    def test_stdout_that_is_not_json(self):
        self.returns(returncode=0, stdout="I'm afraid I can't do that")
        with self.assertRaises(llm.LLMError):
            llm.ask("hi")

    def test_an_envelope_of_the_wrong_shape(self):
        for body in ("[]", '"a string"', '{"no_result_key": 1}'):
            self.returns(returncode=0, stdout=body)
            with self.assertRaises(llm.LLMError, msg=body):
                llm.ask("hi")

    def test_the_cli_reporting_its_own_error(self):
        self.returns(returncode=0, stdout=json.dumps({"is_error": True, "result": "nope"}))
        with self.assertRaises(llm.LLMError):
            llm.ask("hi")


class Succeeds(Base):
    def test_returns_the_result_field(self):
        self.returns(returncode=0, stdout=self.envelope("the answer"))
        self.assertEqual(llm.ask("hi"), "the answer")

    def test_ask_json_digs_the_object_out_of_prose(self):
        self.returns(returncode=0, stdout=self.envelope('Sure!\n{"a": 1}\nHope that helps'))
        self.assertEqual(llm.ask_json("hi"), {"a": 1})

    def test_ask_json_on_prose_with_no_object(self):
        self.returns(returncode=0, stdout=self.envelope("no json here"))
        with self.assertRaises(llm.LLMError):
            llm.ask_json("hi")

    def test_ask_json_on_a_broken_object(self):
        self.returns(returncode=0, stdout=self.envelope('{"a": }'))
        with self.assertRaises(llm.LLMError):
            llm.ask_json("hi")


class Tools(unittest.TestCase):
    def test_disabling_the_web_passes_an_explicit_empty_list(self):
        # Omitting --allowed-tools does not disable tools, it falls back to the
        # default set, and the model then stalls asking for WebSearch instead of
        # reading the text in the prompt.
        seen = {}

        def capture(cmd, **kw):
            seen["cmd"] = cmd
            return Fake(returncode=0, stdout=json.dumps({"result": "ok"}))

        real = llm.subprocess.run
        llm.subprocess.run = capture
        try:
            llm.ask("hi", allow_web=False)
            self.assertIn("--allowed-tools", seen["cmd"])
            self.assertEqual(seen["cmd"][seen["cmd"].index("--allowed-tools") + 1], "")
            llm.ask("hi", allow_web=True)
            self.assertEqual(seen["cmd"][seen["cmd"].index("--allowed-tools") + 1],
                             "WebSearch,WebFetch")
        finally:
            llm.subprocess.run = real

    def test_the_prompt_goes_in_on_stdin_not_argv(self):
        seen = {}

        def capture(cmd, **kw):
            seen.update(kw)
            seen["cmd"] = cmd
            return Fake(returncode=0, stdout=json.dumps({"result": "ok"}))

        real = llm.subprocess.run
        llm.subprocess.run = capture
        try:
            llm.ask("a very long prompt")
            self.assertEqual(seen.get("input"), "a very long prompt")
            self.assertNotIn("a very long prompt", seen["cmd"])
        finally:
            llm.subprocess.run = real


if __name__ == "__main__":
    unittest.main()
