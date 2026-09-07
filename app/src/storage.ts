import { DAY, RANK, today } from "./rules";
import { SEED } from "./seed";
import type { AppState, PersonState } from "./types";

const KEY = "career.outreach.v1";

/** Private windows throw on localStorage rather than returning null, and a
 *  silent failure here means a whole day of marking work evaporates. */
export const storage = { ok: true };

const empty = (): AppState => ({ p: {}, ropes: {}, log: [], target: 2 });

/* The example data carries a little progress. A published copy with every
   counter at zero and an empty funnel reads as broken rather than as a system
   nobody has run yet, and the funnel is the part worth looking at. Offsets
   rather than dates, so the demo cannot rot into "sent 400 days ago". It only
   ever applies when this browser has nothing saved. */
function seedDemo(): AppState {
  const out = empty();
  const demo = SEED.demo;
  if (!demo) return out;
  const back = (n: number) => today(new Date(Date.now() - n * DAY));
  for (const [id, raw] of Object.entries(demo.p)) {
    const { ago, firstAgo, ...rest } = raw;
    const d: PersonState = { ...rest, last: back(ago ?? 0), first: back(firstAgo ?? ago ?? 0) };
    if (d.peak == null && d.status) d.peak = Math.max(RANK[d.status], 0);
    out.p[id] = d;
  }
  for (const i of demo.ropes) out.ropes[i] = true;
  out.log = demo.log.map((n) => ({ at: new Date(Date.now() - n * DAY).toISOString(), ch: "email" }));
  return out;
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch {
    storage.ok = false;
  }
  return SEED.demo ? seedDemo() : empty();
}

export function saveState(s: AppState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); }
  catch { storage.ok = false; }
}

/* Theme lives in its own key so it does not travel in the outreach export - the
   machine you import onto has its own eyes. "auto" follows the OS. */
export type Theme = "auto" | "dark" | "light";
const THEME_KEY = "career.theme";

export function loadTheme(): Theme {
  try { return (localStorage.getItem(THEME_KEY) as Theme) || "auto"; }
  catch { return "auto"; }
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private window */ }
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#14181a" : "#dfe9f2");
}
