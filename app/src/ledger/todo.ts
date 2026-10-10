import { daysSince } from "../rules";
import { DEAD, deadlineOf, isQuiet, outreachAction } from "./rules";
import type { Application, Outreach } from "./types";

/* ======================= what to do next ================================

   The top half of the Applications screen: the funnel counts, the honest
   "how many have I sent" line, and the to-do list. Pure, like rules.ts, so
   every lane and count is pinned by todo.test.ts. Nothing here knows about
   React or the DOM.
   ---------------------------------------------------------------------- */

/** How far ahead "Do next" looks. The morning brief uses SOON_DAYS (3); a
 *  screen opened when there is time to act can afford a week. */
export const TODO_DAYS = 7;

/** A posting deliberately parked until a referral comes through. Big tech is
 *  referral-only for him (Oct 4), so these never count as "to apply". */
export const isHeld = (a: Pick<Application, "status" | "hold">) =>
  a.status === "saved" && a.hold === "referral";

/* ------------------------------------------------------------- funnel -- */

/** One tile per stage. "saved" is what he still has to apply to himself;
 *  "held" is what waits on a referral, kept apart because 400 held big-tech
 *  postings would otherwise bury the 30 he can act on. */
export type Tile = "interview" | "offer" | "applied" | "saved" | "held" | "closed";

export const TILES: readonly Tile[] = ["applied", "interview", "offer", "saved", "held", "closed"];

export const TILE_LABEL: Record<Tile, string> = {
  applied: "Applied",
  interview: "Interviews",
  offer: "Offers",
  saved: "To apply",
  held: "Held for referral",
  closed: "Closed",
};

export function tileOf(a: Application): Tile {
  if (DEAD.includes(a.status)) return "closed";
  if (a.status === "saved") return isHeld(a) ? "held" : "saved";
  return a.status === "interview" ? "interview" : a.status === "offer" ? "offer" : "applied";
}

export function funnel(apps: readonly Application[]): Record<Tile, number> {
  const c: Record<Tile, number> = { applied: 0, interview: 0, offer: 0, saved: 0, held: 0, closed: 0 };
  for (const a of apps) c[tileOf(a)]++;
  return c;
}

/* ------------------------------------------------------------- sent -- */

export interface Sent {
  /** Everything that has gone in, whatever happened to it since. */
  total: number;
  /** Submitted in the last seven local days, today included. */
  week: number;
  /** The latest submitted date, local YYYY-MM-DD, or null. */
  last: string | null;
}

/** "82 sent, 48 this week." The number that matters, so it is counted the
 *  honest way: a rejection was still an application sent. */
export function sentCounts(apps: readonly Application[], now: Date): Sent {
  let total = 0, week = 0, last: string | null = null;
  for (const a of apps) {
    if (a.status === "saved") continue;
    total++;
    const sub = a.submitted?.slice(0, 10);
    if (!sub) continue;
    const d = daysSince(sub, now);
    if (d !== null && d >= 0 && d < 7) week++;
    if (!last || sub > last) last = sub;
  }
  return { total, week, last };
}

/* ------------------------------------------------------------- to-do -- */

export type TodoKind = "offer" | "interview" | "apply" | "referral" | "rolling" | "nudge" | "expired";

export interface TodoItem {
  kind: TodoKind;
  company: string;
  /** One application, or every held posting at one company for "referral"
   *  and "expired": one ask covers all of them. */
  apps: Application[];
  due: Date | null;
  /** The latest event's note (an interview time, an offer's terms), or null. */
  note: string | null;
}

export interface Todo {
  /** Offers, interviews, then whatever closes within TODO_DAYS, soonest first. */
  now: TodoItem[];
  /** Postings with no deadline. Rolling, so never urgent and never gone. */
  rolling: TodoItem[];
  /** Applied, nothing heard for QUIET_DAYS. One nudge each, never two. */
  nudge: TodoItem[];
  /** Still "to apply" with the deadline behind it. Close them or let them go. */
  expired: TodoItem[];
  /** Dated postings and held roles that close after the window. */
  later: number;
}

const KIND_RANK: Record<TodoKind, number> = {
  offer: 0, interview: 1, apply: 2, referral: 3, rolling: 4, nudge: 5, expired: 6,
};

/** Newest event by `at`; an unparseable stamp sorts first, so it never wins. */
export function latestNote(a: Application): string | null {
  let best: { t: number; note: string } | null = null;
  for (const e of a.events ?? []) {
    const t = Date.parse(e.at);
    const note = (e.note ?? "").trim();
    if (!note) continue;
    const k = Number.isNaN(t) ? -Infinity : t;
    if (!best || k >= best.t) best = { t: k, note };
  }
  return best?.note ?? null;
}

const byCompany = (a: TodoItem, b: TodoItem) =>
  a.company.localeCompare(b.company, undefined, { numeric: true });

/** Offers, then interviews, then everything else by deadline. An offer is
 *  first because the day there is one, the rest of the list stops mattering. */
const byDue = (a: TodoItem, b: TodoItem) => {
  const pa = KIND_RANK[a.kind] <= 1, pb = KIND_RANK[b.kind] <= 1;
  if (pa || pb) return pa && pb ? KIND_RANK[a.kind] - KIND_RANK[b.kind] || byCompany(a, b) : pa ? -1 : 1;
  return (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity)
    || KIND_RANK[a.kind] - KIND_RANK[b.kind]
    || byCompany(a, b);
};

/** The to-do lanes. Held postings are grouped per company, because the ask
 *  is per connection, not per req number. */
export function todoLanes(apps: readonly Application[], now: Date): Todo {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + TODO_DAYS, 23, 59, 59, 999);
  const one = (kind: TodoKind, a: Application, due: Date | null = null): TodoItem =>
    ({ kind, company: a.company || "", apps: [a], due, note: latestNote(a) });

  const now_: TodoItem[] = [], rolling: TodoItem[] = [], nudge: TodoItem[] = [], expired: TodoItem[] = [];
  const referral = new Map<string, TodoItem>();
  const heldExpired = new Map<string, TodoItem>();
  let later = 0;

  for (const a of apps) {
    if (a.status === "offer") { now_.push(one("offer", a)); continue; }
    if (a.status === "interview") { now_.push(one("interview", a)); continue; }
    if (a.status !== "saved") {
      if (isQuiet(a, now)) nudge.push(one("nudge", a));
      continue;
    }
    const d = deadlineOf(a);
    if (isHeld(a)) {
      if (!d) continue;                              // undated held: nothing to chase
      if (d < now) {
        const g = heldExpired.get(a.company);
        if (g) { g.apps.push(a); if (d > (g.due as Date)) g.due = d; }
        else heldExpired.set(a.company, { kind: "expired", company: a.company, apps: [a], due: d, note: null });
      } else if (d <= end) {
        const g = referral.get(a.company);
        if (g) { g.apps.push(a); if (d < (g.due as Date)) g.due = d; }
        else referral.set(a.company, { kind: "referral", company: a.company, apps: [a], due: d, note: null });
      } else later++;
      continue;
    }
    if (!d) rolling.push(one("rolling", a));
    else if (d < now) expired.push(one("expired", a, d));
    else if (d <= end) now_.push(one("apply", a, d));
    else later++;
  }

  const sortApps = (xs: Application[]) =>
    xs.sort((x, y) => (deadlineOf(x)?.getTime() ?? Infinity) - (deadlineOf(y)?.getTime() ?? Infinity)
      || x.title.localeCompare(y.title));
  for (const g of referral.values()) sortApps(g.apps);
  for (const g of heldExpired.values()) sortApps(g.apps);

  now_.push(...referral.values());
  now_.sort(byDue);
  rolling.sort(byCompany);
  // Newest first: a nudge at day 15 can still land, one at day 150 is a formality.
  nudge.sort((a, b) => (b.apps[0]?.submitted ?? "").localeCompare(a.apps[0]?.submitted ?? "") || byCompany(a, b));
  expired.sort((a, b) => (b.due?.getTime() ?? 0) - (a.due?.getTime() ?? 0) || byCompany(a, b));
  expired.push(...[...heldExpired.values()].sort((a, b) => b.apps.length - a.apps.length || byCompany(a, b)));

  return { now: now_, rolling, nudge, expired, later };
}

/* ---------------------------------------------------------- follow-ups -- */

/** The threads whose one follow-up is due: outreachAction says "followup",
 *  which is day FOLLOWUP_DAYS with no reply and no follow-up yet. A thread
 *  already followed up, answered or closed is never here, so the lane empties
 *  itself. Longest waiting first; the name breaks ties. */
export function followUps(rows: readonly Outreach[], now: Date): Outreach[] {
  return rows
    .filter((o) => outreachAction(o, now).kind === "followup")
    .sort((a, b) => a.sent.localeCompare(b.sent) || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------ held postings -- */

export interface HeldGroup {
  company: string;
  /** Open deadlines soonest first, then undated, then passed. */
  apps: Application[];
  /** The soonest deadline still ahead, or null. */
  soonest: Date | null;
  /** How many of these already closed. */
  passed: number;
}

/** Saved postings in the order to work them: open deadlines soonest first, then
 *  undated ones (rolling), then ones already past. Company breaks ties. */
export function sortSaved(apps: readonly Application[], now: Date): Application[] {
  const key = (a: Application): [number, number] => {
    const d = deadlineOf(a);
    if (!d) return [1, 0];
    return [d < now ? 2 : 0, d.getTime()];
  };
  return apps
    .map((a) => ({ a, k: key(a) }))
    .sort((x, y) => x.k[0] - y.k[0] || x.k[1] - y.k[1] || x.a.company.localeCompare(y.a.company, undefined, { numeric: true }))
    .map((x) => x.a);
}

/** Held postings by company: soonest open deadline first, undated companies
 *  last, more roles before fewer. 450 rows become 25 lines. */
export function heldByCompany(apps: readonly Application[], now: Date): HeldGroup[] {
  const by = new Map<string, Application[]>();
  for (const a of apps) {
    if (!isHeld(a)) continue;
    by.set(a.company, [...(by.get(a.company) ?? []), a]);
  }
  const groups: HeldGroup[] = [];
  for (const [company, xs] of by) {
    const sorted = sortSaved(xs, now);
    let soonest: Date | null = null, passed = 0;
    for (const a of sorted) {
      const d = deadlineOf(a);
      if (!d) continue;
      if (d < now) passed++;
      else if (!soonest || d < soonest) soonest = d;
    }
    groups.push({ company, apps: sorted, soonest, passed });
  }
  return groups.sort((a, b) =>
    (a.soonest?.getTime() ?? Infinity) - (b.soonest?.getTime() ?? Infinity)
    || b.apps.length - a.apps.length
    || a.company.localeCompare(b.company, undefined, { numeric: true }));
}
