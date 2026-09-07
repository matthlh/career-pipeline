# The outreach app

Static React. No build step, no server, no npm. Open `index.html` and it works.

```
index.html        the whole app
data.js           real data, gitignored - window.SEED = {people: [...]}
data.example.js   twelve invented people, committed, loads only if data.js is absent
```

Regenerate the real data after a pipeline run:

```bash
python3 scripts/run.py export-app
```

`data.js` sets `window.SEED`. `data.example.js` sets `window.SEED = window.SEED || {...}`,
so it fills in on a clone where the real file 404s and never overrides it where it exists.

Person state (status, channel, dates, notes) lives in `localStorage` keyed by
email address, merged over the seed rather than replacing it. Re-running
`export-app` adds new people without touching anything already tracked. Theme is
a separate key, so it does not travel in an export.

## Publishing to GitHub Pages

Automatic. `.github/workflows/pages.yml` deploys on every push to `main`, to
<https://matthlh.github.io/career-pipeline/>. Nothing to click.

The workflow publishes `app/dist` when `app/package.json` exists and plain `app/`
otherwise, so it keeps working across the migration to a build step. Before it
uploads anything it greps the output for email addresses and fails the deploy on
any domain that is not RFC 2606 reserved — a real address can only reach the
public site by getting past a red build.

`data.js` is gitignored and so is never in the artifact, which is what makes the
published copy safe: it falls back to the example people automatically.

To use the published copy with your own data: open the local copy, hit **Export
progress** (the file carries people, counts and progress together), then
**Import** it on the published one. Nothing sensitive goes through the repo.

The catch worth knowing before relying on it: `localStorage` is per browser and
per device. Marking someone sent on your phone will not show up on your laptop.
Export and import when you switch. If that gets annoying, that is the point at
which a real backend earns its keep, and not before.
