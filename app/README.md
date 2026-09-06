# The outreach app

Static React. No build step, no server, no npm. Open `index.html` and it works.

```
index.html   the whole app
data.js      generated - window.SEED = {people: [...]}
```

Regenerate the data after any pipeline run:

```
python3 scripts/run.py export-app
```

Person state (status, channel, dates, notes) lives in `localStorage` keyed by
email address, and is merged over the seed rather than replacing it. Re-running
`export-app` adds new people without touching anything already tracked.

## Publishing to GitHub Pages

**Do not commit `data.js`.** It contains 188 real people's email addresses,
harvested from public commit metadata and job postings for your own use.
Republishing them as a public directory on a URL anyone can find is a different
act than keeping them in a local file, and GitHub Pages on a free account is
public only - a private repo needs Pro.

The app is built to be published empty:

1. `git init` a repo containing only `app/index.html` and this README.
2. Settings, Pages, Source: main branch, `/docs` folder (rename `app` to `docs`),
   or push the folder to a `gh-pages` branch.
3. Open the published URL. It says "No data loaded".
4. On this machine, open the local copy and hit **Export progress**. The file
   carries the people, the counts and your progress together.
5. On the published copy, hit **Import** and pick that file.

Nothing sensitive ever reaches the public URL - the data goes browser to browser
through a file you carry.

The catch worth knowing before you rely on it: `localStorage` is per browser and
per device. Marking someone sent on your phone does not show up on your laptop.
Export and import when you switch. If that gets annoying, that is the point at
which a real backend earns its keep, and not before.
