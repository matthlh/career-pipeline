"""Open the app. `python3 scripts/run.py app`

There is no server in this. The bundle is an IIFE behind a classic <script>
rather than a module precisely so that opening the file works, and cron writes
data.js straight into app/dist, so the copy on disk is as fresh as the pipeline
is. Build once, then this is a double-click for the rest of the year.

Rebuilds only when the sources are newer than the bundle, so the common case
costs nothing.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, "app")
DIST = os.path.join(APP, "dist")
INDEX = os.path.join(DIST, "index.html")

WATCH = ("src", "index.html", "package.json", "vite.config.ts")


def _newest(path):
    if os.path.isfile(path):
        return os.path.getmtime(path)
    newest = 0.0
    for root, _, files in os.walk(path):
        for f in files:
            newest = max(newest, os.path.getmtime(os.path.join(root, f)))
    return newest


def _stale():
    if not os.path.exists(INDEX):
        return "no build yet"
    built = os.path.getmtime(INDEX)
    for name in WATCH:
        p = os.path.join(APP, name)
        if os.path.exists(p) and _newest(p) > built:
            return "%s changed since the last build" % name
    return None


def run(build=None, **kwargs):
    if not os.path.isdir(os.path.join(APP, "node_modules")):
        raise RuntimeError("run `npm install` in app/ once, then try again")

    why = _stale()
    if why or build:
        print("building (%s)" % (why or "asked to"))
        if subprocess.call(["npm", "run", "build"], cwd=APP):
            raise RuntimeError("the build failed - fix it above, nothing was opened")

    # data.js is gitignored and lives in public/, which the build copies. If the
    # pipeline has run since the last build, refresh just that file rather than
    # rebuilding the whole bundle for a data change.
    src = os.path.join(APP, "public", "data.js")
    dst = os.path.join(DIST, "data.js")
    if os.path.exists(src) and (not os.path.exists(dst)
                                or os.path.getmtime(src) > os.path.getmtime(dst)):
        with open(src, "rb") as a, open(dst, "wb") as b:
            b.write(a.read())
        print("refreshed dist/data.js from the pipeline")

    if not os.path.exists(src):
        print("note: no app/public/data.js, so this opens on the example people.")
        print("      run `python3 scripts/run.py export-app` first.")

    subprocess.call(["open", INDEX])
    print("opened %s" % INDEX)
    print("Bookmark that path - it needs no server and no terminal.")
    return {"opened": INDEX}
