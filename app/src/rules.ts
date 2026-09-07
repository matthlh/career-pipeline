import type { Action, Person, PersonState, Status } from "./types";

/* ============================ the rules =================================

   Every date and every decision the app makes lives here, and nothing in this
   file touches React or the DOM - which is what makes it the part with tests.
   ---------------------------------------------------------------------- */

export const DAY = 86_400_000;

/** Follow up on day 7. Once. A single follow-up lifts replies from about 4.1%
 *  to 6.6%; a second one takes it to 6.9%, which is not worth the second ask. */
export const FOLLOWUP_DAYS = 7;

/** A live thread with no activity for this long is the earliest warning a
 *  pipeline gives you, and the only one that needs no judgement to read. */
export const STALE_DAYS = 21;

/** Measured reply and open rates. Under 100 words replies at 11.9%, 100-200 at
 *  1.9%, 200-300 at 0.3%. Subjects under 30 characters open at 83.7%, over 70
 *  at 69.5%. The app shows where a message sits and never blocks sending one:
 *  a long message sent beats a short one polished instead. */
export const WORDS_GOOD = 100;
export const WORDS_BAD = 200;
export const SUBJ_GOOD = 30;
export const SUBJ_BAD = 70;

export const STATUSES: Status[] = [
  "not contacted", "applied", "messaged", "replied",
  "call booked", "call done", "built it", "dead",
];

export const CHANNELS = { email: "Email", linkedin: "LinkedIn", form: "Form / ATS" } as const;

/** How far down the funnel a status sits. "dead" is -1 so closing a thread out
 *  cannot raise the high-water mark - otherwise the reply rate would climb
 *  every time the list was tidied. */
export const RANK: Record<Status, number> = {
  "not contacted": 0, applied: 1, messaged: 2, replied: 3,
  "call booked": 4, "call done": 5, "built it": 6, dead: -1,
};

/* ---------------------------------------------------------------- dates ---
   Local dates, never UTC. toISOString() rolls over at 5pm Pacific, which would
   label a message sent tonight as sent yesterday. */

export function today(d: Date = new Date()): string {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

export function daysSince(iso: string | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.floor((Date.parse(today(now)) - Date.parse(iso)) / DAY);
}

export function ago(iso: string | undefined, now: Date = new Date()): string {
  const d = daysSince(iso, now);
  if (d === null) return "";
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return d + "d ago";
}

export function words(str: string | undefined | null): number {
  return (str || "").trim().split(/\s+/).filter(Boolean).length;
}

/** Furthest rung this person ever reached, falling back to their current status
 *  for state written before `peak` existed. */
export function peakOf(st: PersonState | undefined): number {
  if (!st) return 0;
  if (st.peak != null) return st.peak;
  return st.status ? Math.max(RANK[st.status], 0) : 0;
}

/** The new high-water mark after a status change. Never goes down. */
export function nextPeak(was: PersonState | undefined, status?: Status): number {
  return Math.max(peakOf(was), status ? Math.max(RANK[status], 0) : 0);
}

/* ------------------------------------------------------- the send window ---
   Best measured window is 6-9am in the recipient's timezone, Tuesday to
   Thursday. Offsets are hours ahead of Pacific, because that is where you are.
   Anything east of here lands before you are awake, which is what Gmail's
   Schedule send is for. */

const TZ: [RegExp, number, string][] = [
  [/new york|\bnyc\b|brooklyn|manhattan|boston|atlanta|miami|philadelphia|washington|\bd\.?c\.?\b|toronto|montr|ottawa|waterloo/i, 3, "Eastern"],
  [/chicago|austin|dallas|houston|denver|minneapolis|calgary|edmonton|salt lake/i, 2, "Central"],
  [/london|\buk\b|england|berlin|paris|amsterdam|dublin|z.rich|stockholm|lisbon|madrid/i, 8, "Europe"],
];

export interface SendWindow { off: number; name: string; theirs: string; yours: string }

export function sendWindow(p: Pick<Person, "location" | "company">): SendWindow {
  const hay = (p.location || "") + " " + (p.company || "");
  const hit = TZ.find(([re]) => re.test(hay));
  const off = hit ? hit[1] : 0;
  const name = hit ? hit[2] : "Pacific";
  const local = (h: number) => (((h - off) % 24) + 24) % 24;
  const fmt = (h: number) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? "am" : "pm");
  return { off, name, theirs: `6-9am ${name}`, yours: `${fmt(local(6))}-${fmt(local(9))}` };
}

/** Thursday through Sunday are the weaker send days: Tuesday and Wednesday open
 *  at 78-79%, Thursday and Friday at 69%. Returns the day's name, or null on a
 *  day with nothing to say about it. */
export function weakSendDay(now: Date = new Date()): string | null {
  const names: Record<number, string> = { 0: "Sunday", 4: "Thursday", 5: "Friday", 6: "Saturday" };
  return names[now.getDay()] ?? null;
}

/* ====================== the action engine ===============================

   One function decides what to do about a person. The Today buckets, the
   follow-up flag in People and the badge counts all read from this, so there
   is exactly one place where the rules live. Change a rule here, never in a
   component.
   ---------------------------------------------------------------------- */

export function nextAction(p: Person, st: PersonState | undefined, now: Date = new Date()): Action {
  const s: Status = st?.status ?? "not contacted";
  const d = daysSince(st?.last, now);

  if (s === "dead") {
    return { kind: "none", label: "Dead", why: "Two unanswered touches. Move on." };
  }
  if (s === "built it") {
    return { kind: "return", tmpl: "6", label: "Send the return visit", why: "You built it. Now show them." };
  }

  if (s === "call done") {
    if (d === 0) return { kind: "thanks", tmpl: "5", label: "Send the thank-you", why: "Within 24 hours. This is the message that converts." };
    if (d !== null && d < 14) return { kind: "build", label: "Build the thing", why: `Day ${d} of 14. Template 6 unlocks when you mark it built.` };
    return { kind: "build", label: "Overdue: build the thing", why: `It's been ${d} days. The return visit only works if the thing exists.` };
  }

  if (s === "call booked") {
    if (d !== null && d >= STALE_DAYS) {
      return { kind: "wait", stale: true, label: "Did that call happen?",
        why: `Booked ${d} days ago and nothing has moved since. Mark it done or mark it dead.` };
    }
    return { kind: "wait", label: "Call booked", why: "Nothing to send until after it." };
  }

  if (s === "replied") {
    if (d !== null && d >= STALE_DAYS) {
      return { kind: "reply", stale: true, label: `They replied ${d} days ago`,
        why: "An answered message you never answered back is the most expensive thing in this list." };
    }
    return { kind: "reply", label: "They replied - answer it", why: "Reply in your inbox, then mark the call booked." };
  }

  if (s === "messaged") {
    const ups = st?.ups ?? 0;
    if (d !== null && d < FOLLOWUP_DAYS) {
      return { kind: "wait", label: "Sent " + ago(st?.last, now),
        why: ups === 0
          ? `Follow up on day ${FOLLOWUP_DAYS}, not before.`
          : "Follow-up already sent. Nothing left to send - it is their move." };
    }
    if (ups === 0) {
      return { kind: "followup", tmpl: "4", label: "Follow up", why: `${d} days, no reply. Send template 4 once.` };
    }
    return { kind: "none", label: "Mark dead", why: "Two unanswered touches. That's the rule.", dead: true };
  }

  if (s === "applied") {
    return { kind: "send", tmpl: "2", label: "Message a human there", why: "You applied. Now make it a conversation." };
  }

  /* not contacted */
  if (p.applyUrl) {
    return { kind: "send", tmpl: "2", apply: true, label: "Apply, then message", why: "Apply first. It makes the ask small." };
  }
  return { kind: "send", tmpl: "3", label: "First message", why: "No posted role. Ask for fifteen minutes of advice." };
}
