"""Everything that has to be true before a commit, in one command.

`python3 scripts/run.py check`

The leak check is the one that matters: the repo is public, the contact store is
not, and the deploy runs the same script. The rest is the pipeline's ranking
rules and the app's action engine, both of which fail silently when they break -
nothing crashes, the wrong person just quietly sinks to the bottom of the queue.

The app half is skipped when node is missing, so the pipeline stays usable on a
machine that has never installed it.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, "app")


def _run(label, argv, cwd=ROOT):
    print("--- %s" % label, flush=True)
    return subprocess.call(argv, cwd=cwd)


def run(argv=None):
    failed = []

    if _run("leak check", [os.path.join(ROOT, "scripts", "leakcheck.sh")]):
        failed.append("leak check")

    if _run("pipeline tests", [sys.executable, "-m", "unittest", "discover",
                               "-s", os.path.join(ROOT, "scripts", "tests")]):
        failed.append("pipeline tests")

    npm = _which("npm")
    if not npm:
        print("--- app tests skipped (no npm on this machine)")
    elif not os.path.isdir(os.path.join(APP, "node_modules")):
        print("--- app tests skipped (run `npm install` in app/ first)")
    else:
        if _run("app types", [npm, "run", "typecheck"], cwd=APP):
            failed.append("app types")
        if _run("app tests", [npm, "test"], cwd=APP):
            failed.append("app tests")

    if failed:
        raise RuntimeError("failed: " + ", ".join(failed))
    return "all checks passed"


def _which(name):
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = os.path.join(d, name)
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None
