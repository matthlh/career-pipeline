import { describe, expect, it } from "vitest";
import { applyEdits, newEdit, newId, withDerivedCompanies } from "./apply";
import type {
  Application, Chat, Company, Edit, Kind, Learning, Ledger, LedgerPerson, LedgerSeed, OpenSource,
} from "./types";

function app(over: Partial<Application> = {}): Application {
  return {
    id: "184771", company: "Acme", title: "AI Intern", status: "applied", via: "SCOPE",
    term: "W27", deadline: null, submitted: "2026-09-20", link: null, where: null,
    referral: "none", referrer: null, hold: null, note: null, events: [], ...over,
  };
}
function person(over: Partial<LedgerPerson> = {}): LedgerPerson {
  return {
    id: "ada@acme.example", name: "Ada", company: "Acme", title: "Engineer",
    email: "ada@acme.example", linkedin: null, how: "GitHub commits", state: "new",
    last: null, canRefer: false, note: null, ...over,
  };
}
function company(over: Partial<Company> = {}): Company {
  return { id: "acme", name: "Acme", domain: "acme.example", why: "evals", star: false, note: null, ...over };
}
function oss(over: Partial<OpenSource> = {}): OpenSource {
  return {
    id: "oss-1", project: "vitest", repo: null, link: null, status: "exploring",
    company: null, note: null, added: "2026-10-01", ...over,
  };
}
function learn(over: Partial<Learning> = {}): Learning {
  return { id: "learn-1", topic: "Kubernetes", why: null, link: null, status: "todo", note: null, added: "2026-10-01", ...over };
}
function chat(over: Partial<Chat> = {}): Chat {
  return {
    id: "chat-1", type: "coffee", company: "Acme", who: "Ada", when: "2026-10-12 11:00", where: null,
    status: "upcoming", prep: null, notes: null, added: "2026-10-01", ...over,
  };
}
function seed(over: Partial<LedgerSeed> = {}): LedgerSeed {
  return {
    applications: [app()], people: [person()], companies: [company(), company({ id: "orphan", name: "Orphan" })],
    opensource: [oss()], learning: [learn()], outreach: [], chats: [chat()], appliedEdits: [], ...over,
  };
}

let n = 0;
function edit(over: Partial<Edit> & Pick<Edit, "kind" | "target" | "op">): Edit {
  n += 1;
  return { id: `e-test-${n}`, at: "2026-10-04T16:00:00.000Z", ...over };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const COLL: Record<Kind, keyof Ledger> = {
  application: "applications", person: "people", company: "companies",
  opensource: "opensource", learning: "learning", outreach: "outreach", chat: "chats",
};
const ids = (l: Ledger, k: Kind) => (l[COLL[k]] as { id: string }[]).map((x) => x.id);
const find = (l: Ledger, k: Kind, id: string) =>
  (l[COLL[k]] as unknown as Record<string, unknown>[]).find((x) => x.id === id);

/* ------------------------------------------------------------------------ */

describe("applyEdits basics", () => {
  it("with no edits returns the seed's entities and drops appliedEdits", () => {
    const s = seed({ appliedEdits: ["e-old"] });
    const l = applyEdits(s, []);
    expect(l).not.toHaveProperty("appliedEdits");
    expect(l.applications).toEqual(s.applications);
    expect(l.people).toEqual(s.people);
    expect(l.companies).toEqual(s.companies);
    expect(l.opensource).toEqual(s.opensource);
    expect(l.learning).toEqual(s.learning);
    expect(l.chats).toEqual(s.chats);
  });

  it("skips an edit the seed already carries", () => {
    const e = edit({ kind: "application", target: "184771", op: "event", event: { status: "interview", note: "" } });
    const l = applyEdits(seed({ appliedEdits: [e.id] }), [e]);
    expect(l.applications[0]!.status).toBe("applied");
    expect(l.applications[0]!.events).toHaveLength(0);
  });

  it("does not double an event once the import has folded it in", () => {
    const e = edit({ kind: "application", target: "184771", op: "event", event: { status: "interview", note: "screen" } });
    const imported = seed({
      applications: [app({ status: "interview", events: [{ at: e.at, status: "interview", note: "screen" }] })],
      appliedEdits: [e.id],
    });
    expect(applyEdits(imported, [e]).applications[0]!.events).toHaveLength(1);
  });

  it("applies in `at` order, not array order", () => {
    const late = edit({ kind: "application", target: "184771", op: "set", fields: { title: "late" }, at: "2026-10-04T17:00:00.000Z" });
    const early = edit({ kind: "application", target: "184771", op: "set", fields: { title: "early" }, at: "2026-10-04T15:00:00.000Z" });
    expect(applyEdits(seed(), [late, early]).applications[0]!.title).toBe("late");
  });

  it("compares times, not strings, when the formats differ", () => {
    const python = edit({ kind: "application", target: "184771", op: "set", fields: { title: "python" }, at: "2026-10-04T16:00:01Z" });
    const app_ = edit({ kind: "application", target: "184771", op: "set", fields: { title: "app" }, at: "2026-10-04T16:00:00.500Z" });
    expect(applyEdits(seed(), [python, app_]).applications[0]!.title).toBe("python");
  });

  it("keeps array order for equal `at` (stable)", () => {
    const at = "2026-10-04T16:00:00.000Z";
    const es = ["a", "b", "c", "d", "e"].map((t) =>
      edit({ kind: "application", target: "184771", op: "set", fields: { title: t }, at }));
    expect(applyEdits(seed(), es).applications[0]!.title).toBe("e");
    expect(applyEdits(seed(), [...es].reverse()).applications[0]!.title).toBe("a");
  });

  it("never mutates the seed or the edits", () => {
    const s = deepFreeze(seed({
      applications: [app(), app({ id: "saved-1", status: "saved", submitted: null })],
    }));
    const before = JSON.stringify(s);
    const es = deepFreeze([
      edit({ kind: "application", target: "new-app", op: "add", fields: { company: "Beta", title: "x", status: "saved" } }),
      edit({ kind: "application", target: "184771", op: "set", fields: { status: "interview", note: "hi" } }),
      edit({ kind: "application", target: "184771", op: "event", event: { status: "offer", note: "!" } }),
      edit({ kind: "application", target: "saved-1", op: "event", event: { status: "applied", note: "" } }),
      edit({ kind: "person", target: "ada@acme.example", op: "set", fields: { state: "contacted" } }),
      edit({ kind: "company", target: "acme", op: "delete" }),
      edit({ kind: "opensource", target: "oss-2", op: "add", fields: { project: "vite" } }),
      edit({ kind: "learning", target: "learn-1", op: "delete" }),
    ]);
    const editsBefore = JSON.stringify(es);
    expect(() => applyEdits(s, es)).not.toThrow();
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.stringify(es)).toBe(editsBefore);
  });

  it("ignores unknown kinds and ops", () => {
    const s = seed();
    const l = applyEdits(s, [
      edit({ kind: "widget" as Kind, target: "x", op: "add", fields: { id: "x" } }),
      edit({ kind: "person", target: "ada@acme.example", op: "explode" as Edit["op"] }),
    ]);
    expect(l.people).toEqual(s.people);
  });
});

describe("ops on every kind", () => {
  const cases: [Kind, string, Record<string, unknown>][] = [
    ["application", "184771", { title: "Changed" }],
    ["person", "ada@acme.example", { note: "met at a meetup" }],
    ["company", "orphan", { star: true }],
    ["opensource", "oss-1", { status: "pr open" }],
    ["learning", "learn-1", { status: "learning" }],
    ["chat", "chat-1", { status: "done", notes: "asked about the stack" }],
  ];

  it.each(cases)("%s: add creates a new entity with id = target", (kind) => {
    const l = applyEdits(seed(), [edit({ kind, target: "fresh", op: "add", fields: { note: "new one" } })]);
    expect(ids(l, kind)).toContain("fresh");
    expect(find(l, kind, "fresh")).toMatchObject({ id: "fresh", note: "new one" });
  });

  it.each(cases)("%s: set shallow-merges into the existing entity", (kind, id, fields) => {
    const s = seed();
    const l = applyEdits(s, [edit({ kind, target: id, op: "set", fields })]);
    const before = find(applyEdits(s, []), kind, id)!;
    expect(find(l, kind, id)).toEqual({ ...before, ...fields });
  });

  it.each(cases)("%s: add on an existing id acts as set", (kind, id, fields) => {
    const l = applyEdits(seed(), [edit({ kind, target: id, op: "add", fields })]);
    expect(ids(l, kind).filter((x) => x === id)).toHaveLength(1);
    expect(find(l, kind, id)).toMatchObject(fields);
  });

  it.each(cases)("%s: delete removes it", (kind, id) => {
    const l = applyEdits(seed(), [edit({ kind, target: id, op: "delete" })]);
    expect(ids(l, kind)).not.toContain(id);
  });

  it.each(cases)("%s: set and delete on an unknown target are ignored", (kind) => {
    const s = seed();
    const l = applyEdits(s, [
      edit({ kind, target: "nobody", op: "set", fields: { note: "x" } }),
      edit({ kind, target: "nobody", op: "delete" }),
    ]);
    expect(l).toEqual(applyEdits(s, []));
  });

  it.each(cases.filter(([k]) => k !== "application"))("%s: event is ignored (applications only)", (kind, id) => {
    const s = seed();
    const l = applyEdits(s, [edit({ kind, target: id, op: "event", event: { status: "interview", note: "" } })]);
    expect(l).toEqual(applyEdits(s, []));
  });

  it("set never changes the id", () => {
    const l = applyEdits(seed(), [edit({ kind: "person", target: "ada@acme.example", op: "set", fields: { id: "evil" } })]);
    expect(ids(l, "person")).toEqual(["ada@acme.example"]);
  });

  it("add fills defaults so a half-filled form still makes a whole entity", () => {
    const l = applyEdits(seed(), [
      edit({ kind: "application", target: "app-x", op: "add", fields: { company: "Beta", title: "SWE" } }),
      edit({ kind: "person", target: "p-bo-beta", op: "add", fields: { name: "Bo", company: "Beta" } }),
      edit({ kind: "learning", target: "learn-x", op: "add", fields: { topic: "Rust" }, at: new Date(2026, 9, 4, 12).toISOString() }),
      edit({ kind: "chat", target: "chat-x", op: "add", fields: { company: "Beta" }, at: new Date(2026, 9, 4, 12).toISOString() }),
    ]);
    expect(find(l, "application", "app-x")).toMatchObject({ status: "saved", referral: "none", events: [], deadline: null });
    expect(find(l, "person", "p-bo-beta")).toMatchObject({ state: "new", canRefer: false, email: null });
    expect(find(l, "learning", "learn-x")).toMatchObject({ status: "todo", added: "2026-10-04" });
    expect(find(l, "chat", "chat-x")).toMatchObject({ type: "coffee", status: "upcoming", when: null, added: "2026-10-04" });
  });
});

describe("application status changes", () => {
  const ev = (status: string, note = "", at = "2026-10-04T16:00:00.000Z"): Edit =>
    edit({ kind: "application", target: "184771", op: "event", event: { status, note }, at });

  it("event appends {at, status, note} and moves the status", () => {
    const l = applyEdits(seed(), [ev("interview", "phone screen Oct 9")]);
    expect(l.applications[0]!.status).toBe("interview");
    expect(l.applications[0]!.events).toEqual([
      { at: "2026-10-04T16:00:00.000Z", status: "interview", note: "phone screen Oct 9" },
    ]);
  });

  it("a note event keeps the status and records it, like mark_app.apply_status", () => {
    const l = applyEdits(seed(), [ev("note", "recruiter emailed")]);
    expect(l.applications[0]!.status).toBe("applied");
    expect(l.applications[0]!.events).toEqual([
      { at: "2026-10-04T16:00:00.000Z", status: "applied", note: "recruiter emailed" },
    ]);
  });

  it("events accumulate in time order", () => {
    const l = applyEdits(seed(), [
      ev("offer", "", "2026-10-20T16:00:00.000Z"),
      ev("interview", "", "2026-10-10T16:00:00.000Z"),
    ]);
    expect(l.applications[0]!.events.map((e) => e.status)).toEqual(["interview", "offer"]);
    expect(l.applications[0]!.status).toBe("offer");
  });

  it("ignores an event mark_app would refuse: unknown status, or an empty note", () => {
    const s = seed();
    const l = applyEdits(s, [ev("bogus"), ev("saved"), ev("note", "")]);
    expect(l.applications).toEqual(s.applications);
  });

  it("ignores an event with no event payload or an unknown target", () => {
    const s = seed();
    const l = applyEdits(s, [
      edit({ kind: "application", target: "184771", op: "event" }),
      edit({ kind: "application", target: "nope", op: "event", event: { status: "offer", note: "" } }),
    ]);
    expect(l.applications).toEqual(s.applications);
  });

  it("applied on a saved posting settles it like settle_posting: submitted date, no event", () => {
    const s = seed({ applications: [app({ id: "lyft-1", status: "saved", submitted: null, via: null, note: "held" })] });
    const l = applyEdits(s, [edit({
      kind: "application", target: "lyft-1", op: "event", event: { status: "applied", note: "" },
      at: new Date(2026, 9, 4, 21, 30).toISOString(),       // 9:30pm local: already tomorrow in UTC
    })]);
    expect(l.applications[0]).toMatchObject({
      status: "applied", submitted: "2026-10-04", via: "employer site", events: [], note: "held",
    });
  });

  it("set with a new status also appends an event with an empty note", () => {
    const l = applyEdits(seed(), [edit({ kind: "application", target: "184771", op: "set", fields: { status: "rejected" } })]);
    expect(l.applications[0]!.status).toBe("rejected");
    expect(l.applications[0]!.events).toEqual([{ at: "2026-10-04T16:00:00.000Z", status: "rejected", note: "" }]);
  });

  it("set with the same status, or without one, appends nothing", () => {
    const l = applyEdits(seed(), [
      edit({ kind: "application", target: "184771", op: "set", fields: { status: "applied", note: "x" } }),
      edit({ kind: "application", target: "184771", op: "set", fields: { referral: "want" } }),
    ]);
    expect(l.applications[0]!.events).toEqual([]);
    expect(l.applications[0]!.referral).toBe("want");
  });

  it("add on an existing application with a new status appends an event, as set does", () => {
    const l = applyEdits(seed(), [edit({ kind: "application", target: "184771", op: "add", fields: { status: "interview" } })]);
    expect(l.applications[0]!.events).toHaveLength(1);
  });

  it("a brand-new add records no event, even with a submitted status", () => {
    const l = applyEdits(seed(), [edit({ kind: "application", target: "app-n", op: "add", fields: { company: "Beta", status: "applied" } })]);
    expect(find(l, "application", "app-n")).toMatchObject({ status: "applied", events: [] });
  });
});

describe("derived companies", () => {
  it("gives every named company without an entry a bare one, after the real ones", () => {
    const s = seed({
      companies: [company()],
      applications: [app(), app({ id: "2", company: "Beta Labs" }), app({ id: "3", company: "beta labs" })],
      people: [person(), person({ id: "c@x", company: "Gamma" }), person({ id: "d@x", company: null })],
    });
    const l = applyEdits(s, []);
    expect(l.companies).toEqual([
      company(),
      { id: "beta-labs", name: "Beta Labs", domain: null, why: null, star: false, note: null },
      { id: "gamma", name: "Gamma", domain: null, why: null, star: false, note: null },
    ]);
  });

  it("derives from companies that edits introduce", () => {
    const l = applyEdits(seed(), [edit({ kind: "application", target: "app-z", op: "add", fields: { company: "Zeta AI" } })]);
    expect(l.companies.map((c) => c.id)).toEqual(["acme", "orphan", "zeta-ai"]);
  });

  it("a deleted company still named by an application comes back bare", () => {
    const l = applyEdits(seed(), [edit({ kind: "company", target: "acme", op: "delete" })]);
    expect(l.companies.find((c) => c.id === "acme")).toEqual(
      { id: "acme", name: "Acme", domain: null, why: null, star: false, note: null });
  });

  it("a set on a derived company makes it, so a star or note survives until import", () => {
    const s = seed({
      companies: [company()],
      applications: [app(), app({ id: "2", company: "  Beta Labs " })],
      people: [person(), person({ id: "c@x", company: "Gamma" })],
    });
    const l = applyEdits(s, [
      edit({ kind: "company", target: "beta-labs", op: "set", fields: { star: true } }),
      edit({ kind: "company", target: "gamma", op: "set", fields: { note: "met their CTO" } }),
      edit({ kind: "company", target: "delta", op: "set", fields: { name: "Delta AI", why: "evals" } }),
      edit({ kind: "company", target: "nobody-names-me", op: "set", fields: { star: true } }),
    ]);
    const bare = { domain: null, why: null, star: false, note: null };
    expect(l.companies).toEqual([
      company(),
      { ...bare, id: "beta-labs", name: "Beta Labs", star: true },
      { ...bare, id: "gamma", name: "Gamma", note: "met their CTO" },
      { ...bare, id: "delta", name: "Delta AI", why: "evals" },
      { ...bare, id: "nobody-names-me", name: "nobody-names-me", star: true },
    ]);
  });

  it("a later set on a company made that way merges, and the star can be undone", () => {
    const s = seed({ companies: [], applications: [app({ company: "Beta" })], people: [] });
    const l = applyEdits(s, [
      edit({ kind: "company", target: "beta", op: "set", fields: { star: true }, at: "2026-10-04T16:00:00.000Z" }),
      edit({ kind: "company", target: "beta", op: "set", fields: { note: "x" }, at: "2026-10-04T16:01:00.000Z" }),
      edit({ kind: "company", target: "beta", op: "set", fields: { star: false }, at: "2026-10-04T16:02:00.000Z" }),
    ]);
    expect(l.companies).toEqual([{ id: "beta", name: "Beta", domain: null, why: null, star: false, note: "x" }]);
  });

  it("a set on an unknown person, application, open-source, learning or chat id is still ignored", () => {
    const s = seed();
    const l = applyEdits(s, (["application", "person", "opensource", "learning", "chat"] as Kind[]).map((kind) =>
      edit({ kind, target: "nobody", op: "set", fields: { note: "x" } })));
    expect(l).toEqual(applyEdits(s, []));
  });

  it("withDerivedCompanies is pure and a no-op when nothing is missing", () => {
    const l = deepFreeze({ applications: [app()], people: [], companies: [company()], opensource: [], learning: [], outreach: [], chats: [] });
    expect(withDerivedCompanies(l)).toBe(l);
    const bare = deepFreeze({ ...l, companies: [] as Company[] });
    expect(withDerivedCompanies(bare).companies.map((c) => c.id)).toEqual(["acme"]);
    expect(bare.companies).toEqual([]);
  });
});

describe("ids", () => {
  const NOW = new Date(Date.UTC(2026, 9, 4, 16, 0, 0));

  it("newEdit stamps an id and a UTC ISO time", () => {
    const e = newEdit({ kind: "person", target: "a@b", op: "set", fields: { note: "x" } }, NOW);
    expect(e.id).toMatch(/^e-[0-9a-z]+-[0-9a-z]{4}$/);
    expect(e.id.split("-")[1]).toBe(NOW.getTime().toString(36));
    expect(e.at).toBe("2026-10-04T16:00:00.000Z");
    expect(e).toMatchObject({ kind: "person", target: "a@b", op: "set", fields: { note: "x" } });
  });

  it("newEdit ids differ within the same millisecond", () => {
    const seen = new Set(Array.from({ length: 50 }, () => newEdit({ kind: "person", target: "x", op: "delete" }, NOW).id));
    expect(seen.size).toBeGreaterThan(45);
  });

  it("newId is <prefix>-<base36 ms>", () => {
    const t = NOW.getTime().toString(36);
    expect(newId("app", NOW)).toBe(`app-${t}`);
    expect(newId("oss", NOW)).toBe(`oss-${t}`);
    expect(newId("learn", NOW)).toBe(`learn-${t}`);
    expect(newId("p", NOW)).toBe(`p-${t}`);
  });

  it("newId for a person slugs the name and company", () => {
    expect(newId("p", "Ada Lovelace", "Acme, Inc.")).toBe("p-ada-lovelace-acme-inc");
    expect(newId("p", "Ada", null)).toBe("p-ada");
    expect(newId("p", "  ", "Acme")).toMatch(/^p-[0-9a-z]+$/);
  });
});
