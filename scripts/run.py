#!/usr/bin/env python3
"""Single entrypoint. `python3 scripts/run.py <job>`

Jobs are independent, resumable and idempotent. Killing one mid-run loses at
most the current batch. Re-running is always safe.
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

JOBS = {
    "ingest-nextplay": ("jobs.ingest_nextplay", "Pull companies from the next play newsletter"),
    "ingest-hn": ("jobs.ingest_hn", "Pull companies from HN Who is Hiring threads"),
    "enrich": ("jobs.enrich", "Fill in what a company does, stage, size, work auth tier"),
    "resolve-contacts": ("jobs.resolve_contacts", "Find founder / eng lead emails"),
    "queue": ("jobs.queue_daily", "Build today's contact list and write drafts"),
    "export-app": ("jobs.export_app", "Regenerate app/public/data.js for the app"),
    "status": ("jobs.status", "Rewrite STATUS.md"),
    "mark": ("jobs.mark", "Record an outcome: mark <email> sent|replied|bounced|dead"),
    "applications": ("jobs.applications", "Rewrite data/APPLICATIONS.md, the ledger of what is out (brief=1 for the short block)"),
    "mark-app": ("jobs.mark_app", "Record what happened: mark-app <job_id> interview|offer|rejected|withdrawn|closed [note]"),
    "ledger-import": ("jobs.ledger_import", "Fold the app's edit log (app/public/ledger-edits.json) into data/"),
    "check": ("jobs.check", "Run the leak check, the pipeline tests and the app tests"),
    "app": ("jobs.app", "Open the app from disk - no server, no terminal after this"),
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print("usage: run.py <job> [args]\n")
        for name, (_, desc) in JOBS.items():
            print("  %-18s %s" % (name, desc))
        return 0

    job = sys.argv[1]
    if job not in JOBS:
        print("unknown job: %s" % job, file=sys.stderr)
        print("known jobs: %s" % ", ".join(JOBS), file=sys.stderr)
        return 2

    module_name = JOBS[job][0]
    module = __import__(module_name, fromlist=["run"])

    kwargs = {}
    for arg in sys.argv[2:]:
        if "=" in arg:
            k, v = arg.split("=", 1)
            kwargs[k.lstrip("-").replace("-", "_")] = int(v) if v.isdigit() else v

    print("=== %s ===" % job)
    import store
    if job in ("applications", "export-app"):
        _import_ledger_edits()
    try:
        if job in ("status", "check", "app", "applications", "ledger-import"):
            # `applications` only reads the store, and `ledger-import` runs ahead
            # of it; a morning brief must never fail because a cron job happened
            # to hold the lock.
            result = module.run(**kwargs)
        else:
            with store.JobLock("store"):
                result = module.run(**kwargs)
    except Exception:
        traceback.print_exc()
        _log_error(job)
        return 1

    if job not in ("status", "check", "app"):
        import jobs.status as status_job
        status_job.run()
    print("=== %s done: %s ===" % (job, result))
    return 0


def _import_ledger_edits():
    """Fold in what was changed in the app before reading or exporting the files,
    so neither shows a state the app has already moved past. Never fatal: a bad
    edit log costs one line, not the morning brief."""
    try:
        import jobs.ledger_import as ledger_import
        ledger_import.run(quiet=1)
    except Exception as e:
        print("ledger-import skipped: %s" % e)


def _log_error(job):
    import json
    from datetime import datetime, timezone
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, "state", "errors.jsonl")
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "job": job,
            "at": datetime.now(timezone.utc).replace(tzinfo=None)
                          .isoformat(timespec="seconds") + "Z",
            "error": traceback.format_exc()[-1000:],
        }) + "\n")


if __name__ == "__main__":
    sys.exit(main())
