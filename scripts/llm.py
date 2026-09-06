"""Judgment calls go through the Claude Code CLI in print mode.

This runs headless off Matt's existing Claude subscription, so no separate API
key and no per-token billing. Jobs stay plain Python and cron-able.
"""
import json
import subprocess

CLAUDE = "claude"
TIMEOUT = 300


class LLMError(RuntimeError):
    pass


class LLMUnavailable(LLMError):
    """Usage limit, auth failure, or the CLI being down.

    Distinct from LLMError because it is about the whole run, not this record.
    A job that sees this must stop, not mark every remaining record failed.
    """
    pass


LIMIT_MARKERS = ("usage limit", "rate limit", "quota", "429", "overloaded",
                 "not logged in", "authentication", "credit balance")


def ask(prompt, allow_web=True):
    """Run one prompt, return the text response. Raises on failure.

    The prompt goes in on stdin, not argv. Long prompts are the normal case here
    and argv is the wrong channel for them.

    allow_web=False must pass an explicit empty tool list. Omitting the flag
    means the CLI falls back to its default toolset, and the model then stalls
    asking for WebSearch instead of reading the text you gave it.
    """
    cmd = [CLAUDE, "-p", "--output-format", "json",
           "--allowed-tools", "WebSearch,WebFetch" if allow_web else ""]

    proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=TIMEOUT)
    if proc.returncode != 0:
        blob = (proc.stderr + proc.stdout).lower()
        detail = (proc.stderr.strip() or proc.stdout.strip())[:300]
        if any(m in blob for m in LIMIT_MARKERS) or not detail:
            # An empty stderr with a non-zero exit is what a usage limit looks like.
            raise LLMUnavailable("claude unavailable (exit %d): %s"
                                 % (proc.returncode, detail or "no output, likely usage limit"))
        raise LLMError("claude exited %d: %s" % (proc.returncode, detail))

    payload = json.loads(proc.stdout)
    if payload.get("is_error"):
        raise LLMError("claude reported an error: %s" % payload.get("result", "")[:500])
    return payload["result"]


def ask_json(prompt, allow_web=True):
    """Same, but the prompt must ask for JSON and we parse it."""
    text = ask(prompt, allow_web=allow_web)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise LLMError("no JSON object in response: %s" % text[:300])
    return json.loads(text[start:end + 1])
