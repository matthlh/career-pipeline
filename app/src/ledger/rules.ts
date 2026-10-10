import { FOLLOWUP_DAYS, daysSince } from "../rules";
import { withDerivedCompanies } from "./apply";
import {
  companyId,
  type AppStatus, type Application, type Company, type Ledger, type LedgerPerson, type OpenSource,
} from "./types";

/* ====================== the ledger rules ================================

   Mirrors scripts/jobs/applications.py wherever the two overlap, so the app
   and the morning brief never disagree about what closes soon or what has gone
   quiet. Pure: no React, no storage, no DOM. Every date is local time, like
   app/src/rules.ts and like the deadlines in the files.
   ---------------------------------------------------------------------- */

/** Days after submitting with no event before one nudge is worth sending
 *  (applications.QUIET_DAYS). */
export const QUIET_DAYS = 14;

/** closingSoon's window (applications.SOON_DAYS). */
export const SOON_DAYS = 3;

/** applications.STATUSES with "saved" after "applied": an offer is first
 *  because the day there is one, the rest of the list stops mattering. */
export const STATUS_ORDER: readonly AppStatus[] = [
  "offer", "interview", "applied", "saved", "rejected", "withdrawn", "closed",
];

export const STATUS_LABEL: Record<AppStatus, string> = {
  offer: "Offer",
  interview: "Interview",
  applied: "Applied",
  saved: "To apply",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

export const DEAD: readonly AppStatus[] = ["rejected", "withdrawn", "closed"];

const rank = (s: AppStatus) => {
  const i = STATUS_ORDER.indexOf(s);
  return i < 0 ? STATUS_ORDER.length : i;
};

/* ------------------------------------------------------------ deadlines -- */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-05 09:00 PT" is that local minute; a bare "2026-10-05" is 23:59
 *  that day; null when there is no usable date (applications.deadline_of). */
export function deadlineOf(app: Pick<Application, "deadline">): Date | null {
  const s = (app.deadline ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const day = new Date(y, mo, d, 23, 59);
  if (day.getFullYear() !== y || day.getMonth() !== mo || day.getDate() !== d) return null;
  const t = /^(\d{1,2}):(\d{2})/.exec(s.slice(11));
  if (t) {
    const hh = Number(t[1]), mm = Number(t[2]);
    if (hh < 24 && mm < 60) day.setHours(hh, mm);
  }
  return day;
}

/** "Mon Oct 5 9 AM", "Fri Oct 2 11:59 PM", "Mon Oct 5" when no time was given
 *  (never invent one), "no date" (applications.fmt_deadline). */
export function fmtDeadline(app: Pick<Application, "deadline">): string {
  const d = deadlineOf(app);
  if (!d) return "no date";
  const day = `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
  if ((app.deadline ?? "").trim().length <= 10) return day;
  const h = d.getHours();
  const min = d.getMinutes() === 0 ? "" : ":" + String(d.getMinutes()).padStart(2, "0");
  return `${day} ${h % 12 || 12}${min} ${h < 12 ? "AM" : "PM"}`;
}

/** Saved applications whose deadline falls between now and the end of the day
 *  `days` from now, soonest first. A deadline earlier than now has passed, to
 *  the minute; an undated one never closes soon (applications.closing_soon). */
export function closingSoon(apps: readonly Application[], now: Date, days: number = SOON_DAYS): Application[] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 23, 59, 59, 999);
  return apps
    .filter((a) => a.status === "saved")
    .map((a) => ({ a, d: deadlineOf(a) }))
    .filter((x): x is { a: Application; d: Date } => x.d !== null && x.d >= now && x.d <= end)
    .sort((x, y) => x.d.getTime() - y.d.getTime() || x.a.company.localeCompare(y.a.company))
    .map((x) => x.a);
}

/* ---------------------------------------------------------- the state -- */

/** Applied, nothing heard since, submitted 14+ local days ago (applications.quiet). */
export function isQuiet(app: Application, now: Date): boolean {
  if (app.status !== "applied" || (app.events?.length ?? 0) > 0 || !app.submitted) return false;
  const d = daysSince(app.submitted.slice(0, 10), now);
  return d !== null && d >= QUIET_DAYS;
}

/** The one thing to do about an application, or null when there is nothing. */
export function nextStep(app: Application, now: Date): string | null {
  if (DEAD.includes(app.status)) return null;
  /* A posting held for a referral is held on purpose: the referral is the next
     step even before the deadline (Matt, Oct 1: big tech waits for referrals). */
  if (app.status === "saved" && app.hold === "referral" && app.referral !== "referred") {
    const d = deadlineOf(app);
    if (d && d < now) return "Deadline passed";
    return app.referral === "asked" ? "Chase the referral" : "Ask for a referral";
  }
  if (app.status === "saved") {
    const d = deadlineOf(app);
    if (!d) return "Apply";
    return d < now ? "Deadline passed" : `Apply by ${fmtDeadline(app)}`;
  }
  if (app.hold === "referral" || app.referral === "want") return "Ask for a referral";
  if (app.referral === "asked") return "Chase the referral";
  if (isQuiet(app, now)) return "One nudge";
  if (app.status === "interview") return "Prep for the interview";
  if (app.status === "offer") return "Decide";
  return null;
}

/** Contacted, no reply, last touch 7+ days ago: send the one follow-up.
 *  Exactly one, at day 7 (see FOLLOWUP_DAYS in ../rules). */
export function personFollowUp(person: Pick<LedgerPerson, "state" | "last">, now: Date): boolean {
  if (person.state !== "contacted" && person.state !== "awaiting_reply") return false;
  const d = daysSince(person.last?.slice(0, 10) || undefined, now);
  return d !== null && d >= FOLLOWUP_DAYS;
}

/* ------------------------------------------------------------- grouping -- */

export type GroupKey = "offer" | "interview" | "applied" | "saved" | "closed";

export interface AppGroup { key: GroupKey; label: string; apps: Application[] }

const GROUPS: GroupKey[] = ["offer", "interview", "applied", "saved", "closed"];
const GROUP_LABEL: Record<GroupKey, string> = { ...STATUS_LABEL, closed: "Closed" };

const groupOf = (s: AppStatus): GroupKey => (DEAD.includes(s) ? "closed" : (s as GroupKey));

/** Submitted ones newest first (an undated one counts as today, as in the
 *  Python ledger); saved ones by deadline, undated last. */
function within(a: Application, b: Application): number {
  if (a.status === "saved" && b.status === "saved") {
    const da = deadlineOf(a)?.getTime() ?? Infinity, db = deadlineOf(b)?.getTime() ?? Infinity;
    if (da !== db) return da < db ? -1 : 1;
    return a.company.localeCompare(b.company);
  }
  const sa = a.submitted ?? "9999-12-31", sb = b.submitted ?? "9999-12-31";
  return rank(a.status) - rank(b.status) || sb.localeCompare(sa) || a.company.localeCompare(b.company);
}

/** Non-empty groups in order: offer, interview, applied, saved, then one
 *  "closed" group holding rejected, withdrawn and closed. */
export function groupApplications(apps: readonly Application[]): AppGroup[] {
  const by = new Map<GroupKey, Application[]>();
  for (const a of apps) {
    const k = groupOf(a.status);
    by.set(k, [...(by.get(k) ?? []), a]);
  }
  return GROUPS.filter((k) => by.has(k)).map((key) => ({
    key, label: GROUP_LABEL[key], apps: [...(by.get(key) ?? [])].sort(within),
  }));
}

/* ------------------------------------------------------------ a company -- */

export interface CompanyView {
  /** null only when nothing in the ledger names this id. */
  company: Company | null;
  applications: Application[];
  people: LedgerPerson[];
  opensource: OpenSource[];
}

/** Everything about one company. People and applications match on
 *  companyId(name); open source on its `company` field, which holds an id
 *  (a free-text name there matches too, since companyId(id) === id). */
export function companyView(ledger: Ledger, id: string): CompanyView {
  const company = ledger.companies.find((c) => c.id === id)
    ?? withDerivedCompanies(ledger).companies.find((c) => c.id === id)
    ?? null;
  return {
    company,
    applications: ledger.applications
      .filter((a) => companyId(a.company ?? "") === id)
      .sort((a, b) => rank(a.status) - rank(b.status)),
    people: ledger.people.filter((p) => p.company != null && companyId(p.company) === id),
    opensource: ledger.opensource.filter((o) => o.company != null && companyId(o.company) === id),
  };
}
