import { today } from "../rules";
import {
  companyId,
  type Application, type Company, type Edit, type Kind, type Ledger, type LedgerSeed,
} from "./types";

/* ======================= folding the edit log ===========================

   The app never changes the seed. It keeps a log of edits and shows the seed
   with that log applied, so the view after `ledger-import` folds the log into
   the files is the same view as before it. That only holds while these rules
   match the Python importer, which is why the two odd cases below copy
   jobs/mark_app.py rather than doing the obvious thing:

   - a "note" event records the status the application already had, because
     mark_app.apply_status does, and
   - "applied" on a saved posting moves it in the way settle_posting does: it
     gets a submitted date and no event.
   ---------------------------------------------------------------------- */

type Row = { id: string; [field: string]: unknown };
type Tables = Record<Kind, Row[]>;

const COLLECTION = {
  application: "applications",
  person: "people",
  company: "companies",
  opensource: "opensource",
  learning: "learning",
  outreach: "outreach",
} as const satisfies Record<Kind, keyof Ledger>;

const KINDS = Object.keys(COLLECTION) as Kind[];

/** Statuses an "event" may carry: mark_app.apply_status refuses anything else,
 *  so the importer would drop it, and the app must not show it either. */
const EVENT_STATUSES = new Set(["applied", "interview", "offer", "rejected", "withdrawn", "closed", "note"]);

/** What an "add" fills in for a field it does not set, so a half-filled form
 *  cannot put an application with no `events` array in front of a view. */
function defaults(kind: Kind, id: string, at: string): Record<string, unknown> {
  const added = today(new Date(at));
  switch (kind) {
    case "application":
      return { company: "", title: "", status: "saved", via: null, term: null, deadline: null,
        submitted: null, link: null, where: null, referral: "none", referrer: null, hold: null,
        note: null, events: [] };
    case "person":
      return { name: null, company: null, title: null, email: null, linkedin: null, how: null,
        state: "new", last: null, canRefer: false, note: null };
    case "company":
      return { name: id, domain: null, why: null, star: false, note: null };
    case "opensource":
      return { project: "", repo: null, link: null, status: "exploring", company: null, note: null, added };
    case "learning":
      return { topic: "", why: null, link: null, status: "todo", note: null, added };
    case "outreach":
      return { name: "", company: null, channel: "email", what: "", sent: added, followedUp: null,
        status: "sent", note: null };
  }
}

function eventsOf(row: Row): Application["events"] {
  return Array.isArray(row.events) ? (row.events as Application["events"]) : [];
}

function setRow(kind: Kind, row: Row, e: Edit): Row {
  const fields = e.fields ?? {};
  const next: Row = { ...row, ...fields, id: row.id };
  if (kind === "application" && typeof fields.status === "string" && fields.status !== row.status) {
    next.events = [...eventsOf(next), { at: e.at, status: fields.status, note: "" }];
  }
  return next;
}

function eventRow(row: Row, e: Edit): Row {
  const ev = e.event;
  if (!ev || !EVENT_STATUSES.has(ev.status)) return row;
  const note = ev.note ?? "";
  if (ev.status === "note" && !note) return row;          // apply_status refuses an empty note
  if (row.status === "saved" && ev.status === "applied") {
    return {
      ...row, status: "applied", via: "employer site",
      submitted: row.submitted ?? today(new Date(e.at)),
      note: note || row.note || null,
    };
  }
  const status = ev.status === "note" ? row.status : ev.status;
  return { ...row, status, events: [...eventsOf(row), { at: e.at, status: String(status), note }] };
}

/* Companies are derived only after every edit is applied, so one named just by
   an application or a person is not in the table when he stars it or writes a
   note on it. A "set" there makes the company - the importer upserts the same
   row - named as the derived one would have been. */
function companyFromSet(t: Tables, e: Edit): Row {
  const fields = e.fields ?? {};
  const given = typeof fields.name === "string" ? fields.name.trim() : "";
  const named = [...t.application, ...t.person]
    .map((r) => (typeof r.company === "string" ? r.company.trim() : ""))
    .find((n) => n && companyId(n) === e.target);
  const name = given || named || e.target;
  return { ...defaults("company", e.target, e.at), ...fields, name, id: e.target };
}

function applyOne(t: Tables, e: Edit): void {
  const rows = t[e.kind] as Row[] | undefined;
  if (!rows) return;                                        // unknown kind
  const hit = rows.some((r) => r.id === e.target);
  switch (e.op) {
    case "add": {
      if (hit) {
        t[e.kind] = rows.map((r) => (r.id === e.target ? setRow(e.kind, r, e) : r));
        return;
      }
      const fields = e.fields ?? {};
      const row: Row = { ...defaults(e.kind, e.target, e.at), ...fields, id: e.target };
      if (e.kind === "application") row.events = Array.isArray(fields.events) ? [...fields.events] : [];
      t[e.kind] = [...rows, row];
      return;
    }
    case "set":
      if (hit) t[e.kind] = rows.map((r) => (r.id === e.target ? setRow(e.kind, r, e) : r));
      else if (e.kind === "company" && e.target) t.company = [...rows, companyFromSet(t, e)];
      return;
    case "event":
      if (hit && e.kind === "application") {
        t[e.kind] = rows.map((r) => (r.id === e.target ? eventRow(r, e) : r));
      }
      return;
    case "delete":
      if (hit) t[e.kind] = rows.filter((r) => r.id !== e.target);
      return;
  }
}

function atKey(at: string): number {
  const n = Date.parse(at);
  return Number.isNaN(n) ? Number.MAX_VALUE : n;
}

/** The seed with every edit not already in `seed.appliedEdits` applied, oldest
 *  `at` first (stable for equal `at`), companies derived. Never mutates either
 *  argument. */
export function applyEdits(seed: LedgerSeed, edits: readonly Edit[]): Ledger {
  const done = new Set(seed.appliedEdits);
  const pending = edits
    .filter((e) => !done.has(e.id))
    .map((e, i) => ({ e, i, at: atKey(e.at) }))
    .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? -1 : 1));

  const t = {} as Tables;
  for (const kind of KINDS) t[kind] = [...(seed[COLLECTION[kind]] ?? [])] as unknown as Row[];
  for (const { e } of pending) applyOne(t, e);

  return withDerivedCompanies({
    applications: t.application as unknown as Ledger["applications"],
    people: t.person as unknown as Ledger["people"],
    companies: t.company as unknown as Ledger["companies"],
    opensource: t.opensource as unknown as Ledger["opensource"],
    learning: t.learning as unknown as Ledger["learning"],
    outreach: t.outreach as unknown as Ledger["outreach"],
  });
}

/** Every company named by an application or a person that has no Company entry
 *  gets a bare one, after the existing entries, in order of first mention. */
export function withDerivedCompanies<T extends Ledger>(ledger: T): T {
  const seen = new Set(ledger.companies.map((c) => c.id));
  const extra: Company[] = [];
  const mention = (name: string | null | undefined) => {
    const n = (name ?? "").trim();
    const id = companyId(n);
    if (!id || seen.has(id)) return;
    seen.add(id);
    extra.push({ id, name: n, domain: null, why: null, star: false, note: null });
  };
  for (const a of ledger.applications) mention(a.company);
  for (const p of ledger.people) mention(p.company);
  return extra.length ? { ...ledger, companies: [...ledger.companies, ...extra] } : ledger;
}

/* ------------------------------------------------------------- ids ---- */

const base36 = (now: Date) => now.getTime().toString(36);

function random36(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

/** A complete Edit: "e-<base36 ms>-<4 random base36>", stamped now (UTC ISO). */
export function newEdit(e: Omit<Edit, "id" | "at">, now: Date = new Date()): Edit {
  return { ...e, id: `e-${base36(now)}-${random36(4)}`, at: now.toISOString() };
}

/** "app-<base36 ms>", "oss-…", "learn-…", "out-…". A person made by hand gets
 *  "p-<slug of name>-<slug of company>" (types.ts), falling back to time. */
export function newId(prefix: "app" | "oss" | "learn" | "out" | "p", now?: Date): string;
export function newId(prefix: "p", name: string, company?: string | null): string;
export function newId(prefix: "app" | "oss" | "learn" | "out" | "p", a?: Date | string, company?: string | null): string {
  if (prefix === "p" && typeof a === "string" && companyId(a)) {
    return ["p", companyId(a), companyId(company ?? "")].filter(Boolean).join("-");
  }
  return `${prefix}-${base36(a instanceof Date ? a : new Date())}`;
}
