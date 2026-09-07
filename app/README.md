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
npm run build      # dist/ - what Pages publishes, and openable from file://
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

## Publishing to GitHub Pages

Automatic. `.github/workflows/pages.yml` deploys on every push to `main`, to
<https://matthlh.github.io/career-pipeline/>. Nothing to click.

Tests and typecheck run first; the deploy only runs if they pass. The workflow
then builds `app/dist` and, before uploading anything, runs `scripts/leakcheck.sh`
over the output — it fails the deploy on any address whose domain is not RFC 2606
reserved. A real address can only reach the public site by getting past a red build.

`public/data.js` is gitignored and so is never in a CI checkout, which is what
makes the published copy safe by construction: it falls back to the example
people automatically. The leak check is the belt to that braces.

To use the published copy with your own data: open the local copy, hit **Export
progress** (the file carries people, counts and progress together), then
**Import** it on the published one. Nothing sensitive goes through the repo.

The catch worth knowing before relying on it: `localStorage` is per browser and
per device. Marking someone sent on your phone will not show up on your laptop.
Export and import when you switch. If that gets annoying, that is the point at
which a real backend earns its keep, and not before.
