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
    "export-app": ("jobs.export_app", "Regenerate app/data.js for the React app"),
    "status": ("jobs.status", "Rewrite STATUS.md"),
    "mark": ("jobs.mark", "Record an outcome: mark <email> sent|replied|bounced|dead"),
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
    try:
        if job in ("status",):
            result = module.run(**kwargs)
        else:
            with store.JobLock("store"):
                result = module.run(**kwargs)
    except Exception:
        traceback.print_exc()
        _log_error(job)
        return 1

    if job not in ("status",):
        import jobs.status as status_job
        status_job.run()
    print("=== %s done: %s ===" % (job, result))
    return 0


def _log_error(job):
    import json
    from datetime import datetime
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, "state", "errors.jsonl")
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "job": job,
            "at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "error": traceback.format_exc()[-1000:],
        }) + "\n")


if __name__ == "__main__":
    sys.exit(main())
