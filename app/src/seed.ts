import type { LedgerSeed } from "./ledger/types";
import type { Seed } from "./types";

/* data.js (real, gitignored) and data.example.js (invented, committed) are both
   plain scripts that assign window.SEED, loaded from index.html before this
   module runs. A script rather than fetch() because the built copy has to work
   from file:// as well as from Pages, and fetch() fails on the first. */

declare global {
  interface Window { SEED?: Seed }
}

const EMPTY: Seed = {
  generated: "-", from: "you@example.com",
  counts: { people: 0, researched: 0, named: 0, companies: 0, unworked: 0 },
  people: [],
};

export const SEED: Seed = window.SEED ?? EMPTY;

/** A seed's ledger with every list present. An older data.js has no ledger at
 *  all, and a list the exporter left out should read as empty, not crash a view.
 *  Takes the seed so a data.js read off the connected folder goes through it too. */
export function ledgerSeed(seed: Seed): LedgerSeed {
  const l: Partial<LedgerSeed> = seed.ledger ?? {};
  return {
    applications: l.applications ?? [],
    people: l.people ?? [],
    companies: l.companies ?? [],
    opensource: l.opensource ?? [],
    learning: l.learning ?? [],
    outreach: l.outreach ?? [],
    appliedEdits: l.appliedEdits ?? [],
  };
}

export const LEDGER_SEED: LedgerSeed = ledgerSeed(SEED);

/** The address outreach is sent from. Never written into the source: this repo
 *  is public and a literal address would be scraped off GitHub within a day. */
export const FROM = SEED.from || "you@example.com";

export const SIG = "\n\nMatt\ngithub.com/matthlh";

/** The published copy runs on data.example.js, which stamps this. Nothing keys
 *  off the hostname - one build has to behave the same from file://, a dev
 *  server and Pages. */
export const DEMO = SEED.generated === "example";

export const REPO_URL = "https://github.com/matthlh/groundwork";

/* Whether this copy is being served from a public URL rather than off disk or a
   dev server. Used only to warn: real data loaded here is visible to nobody
   else, but it *is* visible to whoever is looking at the screen. */
export const PUBLIC_ORIGIN =
  typeof location !== "undefined" &&
  (location.protocol === "https:" || location.protocol === "http:") &&
  !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

/* Session-scoped, not localStorage: "I am showing someone my screen" lasts as
   long as the sitting does. It resets on the next launch so you cannot leave
   yourself staring at invented people and wondering where your list went. */
const SHOW_DEMO = "career.showDemo";

export function showingDemo(): boolean {
  try { return sessionStorage.getItem(SHOW_DEMO) === "1"; } catch { return false; }
}

export function setShowingDemo(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(SHOW_DEMO, "1");
    else sessionStorage.removeItem(SHOW_DEMO);
  } catch { /* private window */ }
}
