"""Turn the crontab entries into launchd LaunchAgents. Prints; never installs.

    python3 scripts/gen_launchagents.py                 # read them
    python3 scripts/gen_launchagents.py --out ~/Library/LaunchAgents

Why bother: cron on macOS runs outside your login session, so it needs Full Disk
Access granted to every binary in the chain before it can read a repo under
~/Documents. A LaunchAgent runs *inside* the session and inherits what you
already have. See docs/scheduling.md.

Schedules are read from the existing crontab so the two cannot drift.
"""
import argparse
import os
import plistlib
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABEL = "com.matthlh.career-pipeline"

# minute hour dom month dow, then the command
CRON = re.compile(r"^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$")


def _field(value, key, out):
    """cron's '*' means every, and launchd expresses that by omitting the key."""
    if value != "*":
        out[key] = int(value)


def entries():
    out = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit("no crontab to read")
    found = []
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ROOT not in line:
            continue
        m = CRON.match(line)
        if not m:
            continue
        minute, hour, dom, month, dow, cmd = m.groups()
        args = re.search(r"run\.py\s+(.+?)(?:\s*>>|$)", cmd)
        if not args:
            continue
        argv = args.group(1).split()
        cal = {}
        _field(minute, "Minute", cal)
        _field(hour, "Hour", cal)
        _field(dom, "Day", cal)
        _field(month, "Month", cal)
        # cron's day-of-week is 0-6 with 0=Sunday, and so is launchd's Weekday.
        _field(dow, "Weekday", cal)
        found.append((argv, cal))
    return found


def plist_for(argv, cal):
    return {
        "Label": "%s.%s" % (LABEL, argv[0]),
        # The interpreter is resolved now rather than left to a PATH that a
        # LaunchAgent does not inherit.
        "ProgramArguments": [sys.executable, os.path.join(ROOT, "scripts", "run.py")] + argv,
        "WorkingDirectory": ROOT,
        "StartCalendarInterval": cal,
        "StandardOutPath": os.path.join(ROOT, "state", "cron.log"),
        "StandardErrorPath": os.path.join(ROOT, "state", "cron.log"),
        "RunAtLoad": False,
        "ProcessType": "Background",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="directory to write into. Omit to print.")
    args = ap.parse_args()

    found = entries()
    if not found:
        raise SystemExit("no career-pipeline entries in the crontab")

    out_dir = os.path.expanduser(args.out) if args.out else None
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    for argv, cal in found:
        data = plist_for(argv, cal)
        blob = plistlib.dumps(data)
        if out_dir:
            path = os.path.join(out_dir, data["Label"] + ".plist")
            with open(path, "wb") as fh:
                fh.write(blob)
            print("wrote %s   (%s)" % (path, cal))
        else:
            print("--- %s.plist   %s" % (data["Label"], cal))
            print(blob.decode("utf-8"))

    if not out_dir:
        print("Nothing was installed. Re-run with --out ~/Library/LaunchAgents,")
        print("then `launchctl load` each file. See docs/scheduling.md.")


if __name__ == "__main__":
    main()
