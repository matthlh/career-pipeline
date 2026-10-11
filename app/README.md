# The outreach app

React 18 and TypeScript, built with Vite. The build is an IIFE with a classic
`<script>` tag rather than a module, which is deliberate: a `type="module"`
script is blocked by CORS on `file://`, and opening the file directly is how
this gets used on a bad day.

```
index.html          Vite entry. Loads data.js then data.example.js, then the app.
src/rules.ts        every date rule and nextAction(). No React, no DOM. Tested.
src/templates.ts    the seven messages and the decision tree over them
src/seed.ts         window.SEED, and the DEMO flag the published copy keys off
src/storage.ts      localStorage, plus the demo progress the example data carries
src/ui.tsx          toast, copy, pills, and the length meter
src/components/     App, Today, People, Process, Templates, PersonCard
public/data.js      real data, gitignored - window.SEED = {people: [...]}
public/data.example.js   twelve invented people, committed, loads only if data.js is absent
```

```bash
npm install
npm run dev        # localhost, reads public/data.js live - no rebuild after a cron refresh
npm run build      # dist/ - what Vercel publishes, and openable from file://
npm test           # the rules engine
npm run typecheck
```

Or from the repo root, all of it plus the pipeline tests and the leak check:

```bash
python3 scripts/run.py check
```

## One function decides everything

`nextAction(person, state)` in `src/rules.ts`. The Today buckets, the follow-up
flag, the People filters and the funnel all read from it, so there is exactly one
place where the rules live. Change a rule there, not in a component. It is a pure
function of `(person, state, now)`, which is why `rules.test.ts` can pin every
status to exactly one next action without rendering anything.

## Data

Regenerate after a pipeline run:

```bash
python3 scripts/run.py export-app
```

`data.js` sets `window.SEED`. `data.example.js` sets `window.SEED = window.SEED || {...}`,
so it fills in on a clone where the real file 404s and never overrides it where it
exists. Both live in `public/`, which Vite copies to the build output verbatim -
so `npm run dev` and `npm run build` both pick up real data with no extra step,
and a clean CI checkout has neither the file nor the addresses in it.

Person state (status, channel, dates, notes) lives in `localStorage` keyed by
email address, merged over the seed rather than replacing it. Re-running
`export-app` adds new people without touching anything already tracked. Theme is
a separate key, so it does not travel in an export.

## Publishing on Vercel

Automatic. Vercel is connected to the GitHub repo and deploys every push to
`main` to production; other branches get a preview URL. Nothing to click.

`vercel.json` at the repo root is the whole build: install in `app/`, run the app
tests, build (`tsc -b` typechecks first), then run `scripts/leakcheck.sh` over
`app/dist`. It fails the build on any address whose domain is not RFC 2606
reserved, so a real address can only reach the public site by getting past a red
build. GitHub Actions (`.github/workflows/test.yml`) runs the pipeline tests too.

`public/data.js` is gitignored and so is never in the clone Vercel builds from,
which is what makes the published copy safe by construction: it falls back to the
example people automatically. The leak check is the belt to that braces.

Deploy through the Git connection only. `.vercelignore` allows only `app/` and the
leak check through, because the `vercel` CLI uploads a folder's files whether or
not git ignores them, and from a laptop that would include the real data.

To use the published copy with your own data: open the local copy, hit **Export
progress** (the file carries people, counts and progress together), then
**Import** it on the published one. Nothing sensitive goes through the repo.

The catch worth knowing before relying on it: `localStorage` is per browser and
per device. Marking someone sent on your phone will not show up on your laptop.
Export and import when you switch. If that gets annoying, that is the point at
which a real backend earns its keep, and not before.
