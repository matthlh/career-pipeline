import type { AppState, Status } from "../types";
import type { Edit, EditOp, Kind, PersonState } from "./types";

/* The ledger's edit log in localStorage. The seed is read-only; everything he
   changes in the app is an Edit appended here until ledger-import folds it into
   the files and the next seed lists its id in appliedEdits. */

export const EDITS_KEY = "career.ledger.edits.v1";
export const OLD_KEY = "career.outreach.v1";
export const MIGRATED_KEY = "career.ledger.migrated.v1";

/** Private windows throw on localStorage rather than returning null. Same flag
 *  as storage.ts, separate object: a view can warn that edits are not sticking. */
export const ledgerStorage = { ok: true };

const KINDS = new Set<Kind>(["application", "person", "company", "opensource", "learning"]);
const OPS = new Set<EditOp>(["add", "set", "event", "delete"]);

/* One malformed entry should not take the whole log - or applyEdits - down with it. */
function isEdit(x: unknown): x is Edit {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return typeof e.id === "string" && typeof e.at === "string" && typeof e.target === "string"
    && KINDS.has(e.kind as Kind) && OPS.has(e.op as EditOp);
}

export function loadEdits(): Edit[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(EDITS_KEY);
  } catch {
    ledgerStorage.ok = false;
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    // Accept the on-disk EditsFile shape too, so a pasted ledger-edits.json loads.
    const list = Array.isArray(parsed) ? parsed : (parsed as { edits?: unknown })?.edits;
    return Array.isArray(list) ? list.filter(isEdit) : [];
  } catch {
    return [];
  }
}

export function saveEdits(edits: Edit[]): void {
  try { localStorage.setItem(EDITS_KEY, JSON.stringify(edits)); }
  catch { ledgerStorage.ok = false; }
}

/** Edits whose effect the seed already carries. Keeping them would apply an
 *  "event" twice. */
export function dropApplied(edits: Edit[], appliedEdits: readonly string[]): Edit[] {
  if (!appliedEdits.length) return edits;
  const done = new Set(appliedEdits);
  return edits.filter((e) => !done.has(e.id));
}

/* The outreach view's status ladder onto the pipeline's contact states. */
export const STATUS_MAP: Record<Status, PersonState> = {
  "not contacted": "new",
  applied: "contacted",
  messaged: "contacted",
  replied: "replied",
  "call booked": "met",
  "call done": "met",
  "built it": "met",
  dead: "dead",
};

/** One time only: every person the old outreach state knows about becomes one
 *  person "set" edit. Reads career.outreach.v1 and never writes or removes it -
 *  the old views still use it, and it is the backup if this goes wrong.
 *
 *  Ids are made here rather than by newEdit: a couple of hundred edits in the
 *  same millisecond with four random characters each would collide about one
 *  run in a hundred, and a collision means ledger-import skips one as done. */
export function migrateOldOutreach(now: Date = new Date()): Edit[] {
  let raw: string | null;
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return [];
    raw = localStorage.getItem(OLD_KEY);
    localStorage.setItem(MIGRATED_KEY, now.toISOString());
  } catch {
    ledgerStorage.ok = false;
    return [];
  }
  if (!raw) return [];

  let old: Partial<AppState>;
  try { old = JSON.parse(raw) as Partial<AppState>; } catch { return []; }

  const at = now.toISOString();
  const stamp = now.getTime().toString(36);
  const out: Edit[] = [];
  for (const [id, ps] of Object.entries(old?.p ?? {})) {
    if (!ps || typeof ps !== "object") continue;
    const fields: Record<string, unknown> = {};
    const state = ps.status ? STATUS_MAP[ps.status] : undefined;
    if (state) fields.state = state;
    if (typeof ps.last === "string" && ps.last) fields.last = ps.last;
    if (typeof ps.notes === "string" && ps.notes.trim()) fields.note = ps.notes;
    if (!Object.keys(fields).length) continue;
    out.push({
      id: `e-${stamp}-${out.length.toString(36).padStart(4, "0")}`,
      at, kind: "person", target: id, op: "set", fields,
    });
  }
  return out;
}

/** What the hook starts from: the migration (first run only), then the stored
 *  log, minus whatever the seed already carries - saved back before returning,
 *  so a second call (React StrictMode runs initialisers twice) reads the same
 *  log instead of finding the migration already marked done and losing it. */
export function startEdits(appliedEdits: readonly string[], now: Date = new Date()): Edit[] {
  const migrated = migrateOldOutreach(now);
  const loaded = loadEdits();
  const kept = dropApplied([...migrated, ...loaded], appliedEdits);
  if (migrated.length || kept.length !== loaded.length) saveEdits(kept);
  return kept;
}
