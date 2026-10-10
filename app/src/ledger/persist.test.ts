import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Status } from "../types";
import {
  EDITS_KEY, MIGRATED_KEY, OLD_KEY, STATUS_MAP, dropApplied, ledgerStorage, loadEdits,
  migrateOldOutreach, saveEdits, startEdits,
} from "./persist";
import type { Edit } from "./types";

/* localStorage is the only record of an edit until ledger-import runs, and
   every way it fails is silent: nothing crashes, a day of marking just is not
   there tomorrow. */

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

const throwing = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("SecurityError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  store = fakeStorage();
  vi.stubGlobal("localStorage", store);
  ledgerStorage.ok = true;
});

afterEach(() => { vi.unstubAllGlobals(); });

const NOW = new Date("2026-10-04T17:00:00Z");

function ed(id: string, extra: Partial<Edit> = {}): Edit {
  return { id, at: "2026-10-04T00:00:00.000Z", kind: "person", target: "a@b.example",
           op: "set", fields: { state: "replied" }, ...extra };
}

function oldState(p: AppState["p"]): string {
  return JSON.stringify({ p, ropes: {}, log: [], target: 2 } satisfies AppState);
}

describe("the edit log in localStorage", () => {
  it("round-trips through save and load", () => {
    const edits = [ed("e-1-aaaa"), ed("e-2-bbbb", { kind: "application", op: "event",
                    target: "184771", event: { status: "interview", note: "phone screen" } })];
    saveEdits(edits);
    expect(loadEdits()).toEqual(edits);
    expect(ledgerStorage.ok).toBe(true);
  });

  it("starts empty", () => {
    expect(loadEdits()).toEqual([]);
  });

  it("drops entries that are not edits instead of handing them to applyEdits", () => {
    store.setItem(EDITS_KEY, JSON.stringify([ed("e-1-aaaa"), { id: 3 }, null, { ...ed("x"), op: "nuke" }]));
    expect(loadEdits().map((e) => e.id)).toEqual(["e-1-aaaa"]);
  });

  it("reads a pasted ledger-edits.json as well as a bare list", () => {
    store.setItem(EDITS_KEY, JSON.stringify({ version: 1, edits: [ed("e-1-aaaa")] }));
    expect(loadEdits()).toHaveLength(1);
  });

  it("survives a corrupt value", () => {
    store.setItem(EDITS_KEY, "{not json");
    expect(loadEdits()).toEqual([]);
  });

  it("survives a private window that throws on every access, and says so", () => {
    vi.stubGlobal("localStorage", throwing);
    expect(loadEdits()).toEqual([]);
    expect(ledgerStorage.ok).toBe(false);
    ledgerStorage.ok = true;
    expect(() => saveEdits([ed("e-1-aaaa")])).not.toThrow();
    expect(ledgerStorage.ok).toBe(false);
    ledgerStorage.ok = true;
    expect(migrateOldOutreach(NOW)).toEqual([]);
    expect(ledgerStorage.ok).toBe(false);
    expect(startEdits([], NOW)).toEqual([]);
  });
});

describe("dropApplied", () => {
  const edits = [ed("e-1-aaaa"), ed("e-2-bbbb"), ed("e-3-cccc")];

  it("removes exactly the edits the seed already carries, in order", () => {
    expect(dropApplied(edits, ["e-2-bbbb", "e-9-zzzz"]).map((e) => e.id))
      .toEqual(["e-1-aaaa", "e-3-cccc"]);
  });

  it("keeps everything when nothing is applied, and empties when all are", () => {
    expect(dropApplied(edits, [])).toEqual(edits);
    expect(dropApplied(edits, edits.map((e) => e.id))).toEqual([]);
  });
});

describe("migrating the old outreach state", () => {
  it("maps every old status onto a contact state", () => {
    const all: Record<Status, string> = {
      "not contacted": "new", applied: "contacted", messaged: "contacted", replied: "replied",
      "call booked": "met", "call done": "met", "built it": "met", dead: "dead",
    };
    expect(STATUS_MAP).toEqual(all);

    const p: AppState["p"] = {};
    for (const s of Object.keys(all) as Status[]) p[`${s.replace(/ /g, "-")}@x.example`] = { status: s };
    store.setItem(OLD_KEY, oldState(p));

    const out = migrateOldOutreach(NOW);
    expect(out).toHaveLength(8);
    for (const e of out) {
      const status = e.target.split("@")[0]!.replace(/-/g, " ") as Status;
      expect(e).toMatchObject({ kind: "person", op: "set", fields: { state: all[status] } });
    }
  });

  it("carries last and notes, and leaves out what was never set", () => {
    store.setItem(OLD_KEY, oldState({
      "a@x.example": { status: "replied", last: "2026-09-30", notes: "wants a demo", channel: "email" },
      "b@x.example": { notes: "met at the career fair" },
      "c@x.example": { alum: true },
      "d@x.example": { status: "messaged", notes: "   " },
    }));
    const out = migrateOldOutreach(NOW);
    expect(out.map((e) => [e.target, e.fields])).toEqual([
      ["a@x.example", { state: "replied", last: "2026-09-30", note: "wants a demo" }],
      ["b@x.example", { note: "met at the career fair" }],
      ["d@x.example", { state: "contacted" }],
    ]);
  });

  it("gives every edit a distinct, well-formed id stamped now", () => {
    const p: AppState["p"] = {};
    for (let i = 0; i < 300; i++) p[`p${i}@x.example`] = { status: "messaged" };
    store.setItem(OLD_KEY, oldState(p));
    const out = migrateOldOutreach(NOW);
    expect(new Set(out.map((e) => e.id)).size).toBe(300);
    for (const e of out) {
      expect(e.id).toMatch(/^e-[0-9a-z]+-[0-9a-z]{4}$/);
      expect(e.at).toBe(NOW.toISOString());
    }
  });

  it("runs once, even when there was nothing to migrate the first time", () => {
    store.setItem(OLD_KEY, oldState({ "a@x.example": { status: "replied" } }));
    expect(migrateOldOutreach(NOW)).toHaveLength(1);
    expect(store.getItem(MIGRATED_KEY)).toBeTruthy();
    expect(migrateOldOutreach(NOW)).toEqual([]);

    store.clear();
    expect(migrateOldOutreach(NOW)).toEqual([]);
    store.setItem(OLD_KEY, oldState({ "a@x.example": { status: "replied" } }));
    expect(migrateOldOutreach(NOW)).toEqual([]);
  });

  it("never rewrites or removes the old key", () => {
    const raw = oldState({ "a@x.example": { status: "call done", last: "2026-09-01", notes: "x" } });
    store.setItem(OLD_KEY, raw);
    migrateOldOutreach(NOW);
    startEdits([], NOW);
    expect(store.getItem(OLD_KEY)).toBe(raw);
  });

  it("marks a corrupt old value done rather than retrying it forever", () => {
    store.setItem(OLD_KEY, "{oops");
    expect(migrateOldOutreach(NOW)).toEqual([]);
    expect(store.getItem(MIGRATED_KEY)).toBeTruthy();
    expect(store.getItem(OLD_KEY)).toBe("{oops");
  });
});

describe("startEdits, what the hook mounts with", () => {
  it("puts migrated edits ahead of the stored log, drops applied ones, and saves", () => {
    store.setItem(OLD_KEY, oldState({ "a@x.example": { status: "replied" } }));
    saveEdits([ed("e-1-aaaa"), ed("e-2-bbbb")]);
    const out = startEdits(["e-1-aaaa"], NOW);
    expect(out.map((e) => e.target)).toEqual(["a@x.example", "a@b.example"]);
    expect(out[0]!.fields).toEqual({ state: "replied" });
    expect(out[1]!.id).toBe("e-2-bbbb");
    expect(loadEdits()).toEqual(out);
  });

  it("returns the same log when called twice, as StrictMode does", () => {
    store.setItem(OLD_KEY, oldState({ "a@x.example": { status: "replied" } }));
    const first = startEdits([], NOW);
    expect(first).toHaveLength(1);
    expect(startEdits([], NOW)).toEqual(first);
  });

  it("does not rewrite the stored log when nothing changed", () => {
    store.setItem(MIGRATED_KEY, "done");
    store.setItem(EDITS_KEY, JSON.stringify([ed("e-1-aaaa")]) + " ");
    startEdits([], NOW);
    expect(store.getItem(EDITS_KEY)!.endsWith(" ")).toBe(true);
  });
});
