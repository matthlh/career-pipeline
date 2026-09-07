# Career pipeline

**[Open the live app →](https://matthlh.github.io/career-pipeline/)**

A job-search system that does the parts a computer is good at and refuses to do
the part it isn't.

The live copy runs on twelve invented people with progress pre-seeded, so it has
something to show. No real contact data is ever published — see
[Your data stays yours](#your-data-stays-yours).

It reads hiring threads, works out what each company actually does, finds a real
human at that company from public commit history, and drafts a message. Then it
stops, because the last step is a person writing to another person and there is
no version of automating that which works.

## The two halves

**A pipeline** (Python, no dependencies) that keeps a JSONL store of companies
and contacts, and **an app** (one HTML file, no build step) that decides what to
do each morning and hands you the message to send.

```
sources  →  enrich  →  find a human  →  research a fact  →  you send it
[auto]      [auto]      [auto]           [you]              [you]
```

The split is the whole design. Everything left of "research a fact" is cheap and
scales, so it runs on cron. Everything right of it is the part that decides
whether a message gets a reply, so it stays manual and deliberately slow: one
message a day, two maximum.

## The pipeline

```bash
python3 scripts/run.py <job>
```

| Job | Cadence | What it does |
|---|---|---|
| `ingest-hn` | monthly | Pulls companies from HN "Who is Hiring" via the Algolia API |
| `ingest-nextplay` | weekly | Same, from a newsletter's public Substack archive |
| `enrich` | weekly | Reads each posting: what they build, stage, location, work-auth tier |
| `resolve-contacts` | daily | Finds a real address: posting text, then GitHub commit authorship |
| `queue` | daily | Ranks, picks the day's contacts, writes drafts |
| `export-app` | daily | Regenerates `app/public/data.js` for the app |
| `check` | before a commit | Leak check, pipeline tests, app types and app tests |
| `mark` | as needed | `mark <email> sent\|replied\|bounced\|dead` |

Judgment steps shell out to the `claude` CLI, so it runs off a Claude
subscription and needs no API key. A usage limit raises `LLMUnavailable`, halts
the job, and leaves the backlog intact rather than marking 600 records failed.

Enrichment parses the posting header with a regex first and only falls back to a
model, batched 40 at a time across 5 workers. That took a run of 592 companies
from roughly three hours to five and a half minutes.

## The app

React 18 and TypeScript, built with Vite. `npm run dev` in `app/`, or open
`app/dist/index.html` directly — the bundle is an IIFE behind a classic script
tag, so `file://` still works.

- **Today** — decides for you. Follow-ups due, then live threads, then new sends.
  Each card fills the right template with the person's name and the researched
  fact, tells you whether to use email or LinkedIn, and gives you one button.
- **People** — every contact, their status, and which channel you used, so a
  follow-up knows where to go.
- **Process** — what the pipeline is doing and why the order is what it is.
- **Templates** — a decision tree over seven messages. Three of its paths refuse
  to give you a template, which is the point.

State lives in `localStorage` keyed by email and is merged over the generated
data, so refreshing the dataset never wipes what you have tracked.

Message length is not left to taste. A cold email under 100 words replies at
about 11.9% and one of 100-200 words at 1.9%, so every message shows its word
count and its subject length against those bands as you edit it. The meter never
blocks sending: a long message sent beats a short one polished instead.

## Rules the code enforces

- **Never sends email.** Drafts are files and prefilled compose windows. A human
  presses send, every time.
- **Never invents an address.** `verified` means it appeared in a job posting or
  in a git commit. Unverifiable is `null`.
- **No draft without a real specific fact.** Thin context logs
  `insufficient_context` and skips rather than generating filler.
- **A follow-up needs no account access.** The seven-day flag is date arithmetic
  on the last touch. Only "did they reply" needs a human, and that is one click.
- **Two unanswered touches means dead.** The app surfaces those to be closed.

## Tests

```bash
python3 scripts/run.py check
```

Runs the leak check, the pipeline tests and the app's. Both suites cover the
same kind of thing: rules that fail *silently*. Nothing crashes when the ranking
regresses — the right person just quietly sinks to the bottom of the queue, and
you find out weeks later by not having sent them anything.

- `scripts/tests/` — the preference ordering, and the invariant that the app's
  score and the queue's sort agree on every dimension. They did not, once: the
  queue ranked on funding stage and the exporter ignored it, so the top card and
  the top draft were different people.
- `app/src/rules.test.ts` — every status maps to exactly one next action, dates
  are local rather than UTC, and the funnel's high-water mark never falls when
  you close a thread out.
- `scripts/tests/test_store.py` and `test_resolve_contacts.py` — the store and
  the resolver are where a bug destroys data rather than annoying someone.
  Mostly: state that is easy to enter and impossible to leave. `queued` was one
  of those, and so was "we looked once and found nobody".
- `scripts/leakcheck.sh` — nothing git tracks contains an address outside the
  RFC 2606 reserved domains. The deploy runs the same script over the built
  artifact.
- `scripts/cronhealth.py` — whether the schedule is actually running. Reported by
  `check` and written into `STATUS.md`, never fatal.

## Data

Plain JSONL, atomic whole-file writes, an flock job lock so overlapping cron
runs cannot silently discard each other's work. Safe to kill any job mid-run.

The real store is gitignored. `app/public/data.example.js` holds twelve invented people
at invented companies on the RFC 2606 `.example` TLD, so a fresh clone runs with
demo data and nobody's actual inbox ends up in a public repository.

## Your data stays yours

Worth being precise about, because the repo is public and the data is not.

**Nothing you track is ever uploaded.** GitHub Pages is static hosting — HTML, CSS
and JavaScript, no server and no database. There is no endpoint for the app to send
anything to, and it does not have one to try.

| Where your data lives | Who can read it |
|---|---|
| `data/*.jsonl` and `app/public/data.js` | Your machine only. Both gitignored, never pushed. |
| Progress you click in the app | `localStorage`, in the one browser you clicked it in. |
| The public repo and the live site | Twelve invented people on the `.example` TLD. That is all. |

`localStorage` is scoped to a single origin in a single browser profile. Another
visitor to the live site gets the example data and cannot see anything you
imported; their browser and yours share nothing.

So the published URL is usable as your real tool: open it, **Import** an export
from your machine, and it becomes your copy. Three caveats worth knowing first:

- The origin `matthlh.github.io` is shared by every project published under that
  account, so another Pages site *of your own* could read that storage. Nobody
  else's can.
- It is stored unencrypted. Anyone with your unlocked browser can read it.
- It does not sync. Marking someone sent on your phone will not appear on your
  laptop — export and import when you switch. That is the point at which a real
  backend earns its keep, and not before.

**Showing it to someone:** open the live URL in a private window. No import has
happened there, so it loads the invented people with their progress pre-seeded and
your real pipeline stays invisible.
