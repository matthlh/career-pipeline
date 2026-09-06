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

`app/data.js` is gitignored. It holds real people's addresses, and GitHub Pages
on a free account is public only. A published copy therefore runs on the example
data, which is what you want for showing the project to anyone.

1. Push the repo.
2. Settings, Pages, Source: main branch, `/docs` folder, having renamed `app` to
   `docs`. Or push `app/` to a `gh-pages` branch.

To use the published copy with your own data: open the local copy, hit **Export
progress** (the file carries people, counts and progress together), then
**Import** it on the published one. Nothing sensitive goes through the repo.

The catch worth knowing before relying on it: `localStorage` is per browser and
per device. Marking someone sent on your phone will not show up on your laptop.
Export and import when you switch. If that gets annoying, that is the point at
which a real backend earns its keep, and not before.
