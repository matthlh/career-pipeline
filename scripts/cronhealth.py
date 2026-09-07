"""Is the schedule actually running?

The failure this exists for: on macOS, cron needs Full Disk Access granted to
/usr/sbin/cron before it can enter a folder under ~/Documents. Without it every
line in the crontab fails at the `cd`, the `&&` short-circuits, and *nothing is
written* - no log, no error, no mail. The pipeline looks installed and does
nothing, and the only visible symptom is an absence: records that never change.

An absence is exactly what nobody notices, so this turns it into a sentence.
"""
import io
import os
import re
import subprocess
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, "state", "cron.log")


def _crontab_lines():
    try:
        out = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return []
    if out.returncode != 0:
        return []
    return [l for l in out.stdout.splitlines()
            if ROOT in l and not l.strip().startswith("#")]


def check():
    """Returns (ok, message). ok is False only when something is actually wrong."""
    scheduled = _crontab_lines()
    if not scheduled:
        return True, "no cron entries for this repo - nothing to check"

    jobs = sorted(set(re.findall(r"run\.py\s+([a-z-]+)", " ".join(scheduled))))

    if not os.path.exists(LOG):
        return False, (
            "%d cron entries are installed (%s) but state/cron.log does not exist, "
            "so not one of them has ever produced a line of output. On macOS this is "
            "almost always Full Disk Access: System Settings > Privacy & Security > "
            "Full Disk Access, add /usr/sbin/cron. Without it every entry fails at the "
            "`cd` into ~/Documents and writes nothing at all."
            % (len(scheduled), ", ".join(jobs)))

    age = datetime.now() - datetime.fromtimestamp(os.path.getmtime(LOG))
    if age > timedelta(days=2):
        return False, ("state/cron.log has not been written in %d days, but %d entries "
                       "are installed. The schedule has stopped running."
                       % (age.days, len(scheduled)))

    with io.open(LOG, encoding="utf-8", errors="replace") as fh:
        tail = fh.read()[-4000:]
    failures = [l for l in tail.splitlines() if "Traceback" in l or "another job holds" in l]
    if failures:
        return False, ("cron ran %.1f hours ago but the log tail contains %d failure(s). "
                       "Read state/cron.log." % (age.total_seconds() / 3600, len(failures)))

    return True, "cron last wrote %.1f hours ago, no failures in the tail" % (age.total_seconds() / 3600)


if __name__ == "__main__":
    ok, msg = check()
    print(("ok: " if ok else "PROBLEM: ") + msg)
    raise SystemExit(0 if ok else 1)
