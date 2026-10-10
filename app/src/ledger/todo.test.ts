import { describe, expect, it } from "vitest";
import {
  TILES, funnel, heldByCompany, latestNote, sentCounts, sortSaved, tileOf, todoLanes,
} from "./todo";
import type { AppEvent, Application } from "./types";

// Friday 9 Oct 2026, 9pm local. The window closes Fri Oct 16 23:59.
const NOW = new Date(2026, 9, 9, 21, 0);

function app(over: Partial<Application> = {}): Application {
  return {
    id: over.id ?? over.company?.toLowerCase() ?? "x", company: "Acme", title: "AI Intern", status: "applied",
    via: "employer site", term: null, deadline: null, submitted: "2026-10-08", link: null, where: null,
    referral: "none", referrer: null, hold: null, note: null, events: [], ...over,
  };
}
const saved = (id: string, company: string, deadline: string | null, hold: string | null = null) =>
  app({ id, company, status: "saved", submitted: null, deadline, hold });
const ev = (at: string, status: string, note: string): AppEvent => ({ at, status, note });
const ids = (xs: { apps: Application[] }[]) => xs.map((x) => x.apps.map((a) => a.id).join("+"));

describe("tileOf / funnel", () => {
  it("files every status into exactly one tile, held apart from to-apply", () => {
    const xs = [
      app({ id: "a" }), app({ id: "i", status: "interview" }), app({ id: "o", status: "offer" }),
      saved("s", "Later", "2026-10-12"), saved("h", "IBM", null, "referral"),
      app({ id: "r", status: "rejected" }), app({ id: "w", status: "withdrawn" }), app({ id: "c", status: "closed" }),
    ];
    expect(xs.map(tileOf)).toEqual(["applied", "interview", "offer", "saved", "held", "closed", "closed", "closed"]);
    expect(funnel(xs)).toEqual({ applied: 1, interview: 1, offer: 1, saved: 1, held: 1, closed: 3 });
    expect(TILES).toHaveLength(6);
  });

  it("does not treat a held posting that already went in as held", () => {
    expect(tileOf(app({ hold: "referral" }))).toBe("applied");
  });
});

describe("sentCounts", () => {
  it("counts everything submitted, the last seven local days, and the latest date", () => {
    const xs = [
      app({ id: "1", submitted: "2026-10-09" }),      // today
      app({ id: "2", submitted: "2026-10-03" }),      // six days ago: in
      app({ id: "3", submitted: "2026-10-02" }),      // seven days ago: out
      app({ id: "4", submitted: "2026-09-02", status: "rejected" }),   // still sent
      app({ id: "5", submitted: null }),              // sent, undated
      saved("6", "Later", "2026-10-12"),              // not sent
    ];
    expect(sentCounts(xs, NOW)).toEqual({ total: 5, week: 2, last: "2026-10-09" });
    expect(sentCounts([], NOW)).toEqual({ total: 0, week: 0, last: null });
  });
});

describe("latestNote", () => {
  it("takes the newest non-empty note, ties to the later-added, junk stamps never win", () => {
    const a = app({ events: [
      ev("2026-10-09T19:30:27Z", "interview", "slot offered"),
      ev("junk", "note", "bad stamp"),
      ev("2026-10-10T01:09:54Z", "interview", "booked Fri 12pm"),
      ev("2026-10-10T02:00:00Z", "note", "   "),
    ] });
    expect(latestNote(a)).toBe("booked Fri 12pm");
    expect(latestNote(app())).toBeNull();
  });
});

describe("todoLanes", () => {
  const xs: Application[] = [
    app({ id: "closed", status: "rejected" }),
    app({ id: "fresh", company: "Notion", submitted: "2026-10-08" }),
    app({ id: "quiet2", company: "Simular", submitted: "2026-05-07" }),
    saved("exp", "Aritzia", "2026-10-07 09:00 PT"),
    saved("roll", "Ramp", null),
    saved("hu", "Meta", null, "referral"),
    saved("hx1", "Tesla", "2026-10-05", "referral"),
    saved("hx2", "Tesla", "2026-10-01", "referral"),
    saved("r4", "IBM", "2026-10-30", "referral"),
    saved("r2", "Cisco", "2026-10-21", "referral"),
    saved("r3", "Cisco", "2026-10-14", "referral"),
    saved("r1", "Cisco", "2026-10-12", "referral"),
    saved("ap3", "Port", "2026-10-21 23:59 PT"),
    saved("ap2", "Clio", "2026-10-15 09:00 PT"),
    saved("ap1", "Later", "2026-10-12 09:00 PT"),
    app({ id: "quiet", company: "Whatnot", submitted: "2026-09-02" }),
    app({ id: "int", company: "Bellwether", status: "interview", events: [
      ev("2026-10-09T19:30:27Z", "interview", "slot offered"), ev("2026-10-10T01:09:54Z", "note", "Booked Fri 12pm"),
    ] }),
    app({ id: "off", company: "Stellwater", status: "offer", events: [ev("2026-10-01T10:00:00Z", "offer", "$30/hr")] }),
  ];
  const t = todoLanes(xs, NOW);

  it("puts the offer first, the interview second, then the week by deadline", () => {
    expect(ids(t.now)).toEqual(["off", "int", "ap1", "r1+r3", "ap2"]);
    expect(t.now.map((i) => i.kind)).toEqual(["offer", "interview", "apply", "referral", "apply"]);
  });

  it("carries the newest event note for an interview or offer", () => {
    expect(t.now[0]?.note).toBe("$30/hr");
    expect(t.now[1]?.note).toBe("Booked Fri 12pm");
  });

  it("groups held postings per company with the soonest deadline, and counts the rest as later", () => {
    const cisco = t.now[3]!;
    expect(cisco.company).toBe("Cisco");
    expect(cisco.due).toEqual(new Date(2026, 9, 12, 23, 59));
    expect(t.later).toBe(3);                            // ap3, r2, r4
  });

  it("keeps undated postings in their own lane, held undated ones nowhere", () => {
    expect(ids(t.rolling)).toEqual(["roll"]);
    expect(JSON.stringify(t)).not.toContain('"hu"');
  });

  it("nudges quiet applications newest first, and nothing fresh or closed", () => {
    expect(ids(t.nudge)).toEqual(["quiet", "quiet2"]);
  });

  it("lists passed deadlines, his own first, then held ones grouped (earliest deadline first inside)", () => {
    expect(ids(t.expired)).toEqual(["exp", "hx2+hx1"]);
    expect(t.expired[0]?.due).toEqual(new Date(2026, 9, 7, 9, 0));
    expect(t.expired[1]?.kind).toBe("expired");
  });

  it("is empty on an empty ledger", () => {
    expect(todoLanes([], NOW)).toEqual({ now: [], rolling: [], nudge: [], expired: [], later: 0 });
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(xs);
    todoLanes(xs, NOW);
    expect(JSON.stringify(xs)).toBe(before);
  });
});

describe("sortSaved", () => {
  it("puts open deadlines soonest first, then undated, then passed", () => {
    const xs = [
      saved("past", "Acme", "2026-10-02"),
      saved("none", "Acme", null),
      saved("later", "Acme", "2026-10-20"),
      saved("tonight", "Acme", "2026-10-09"),
      saved("tomorrow", "Acme", "2026-10-10 09:00 PT"),
      saved("earlier-today", "Acme", "2026-10-09 09:00 PT"),
    ];
    expect(sortSaved(xs, NOW).map((a) => a.id)).toEqual(["tonight", "tomorrow", "later", "none", "past", "earlier-today"]);
  });

  it("breaks ties by company and does not mutate its input", () => {
    const xs = [saved("z", "Zeta", "2026-10-16"), saved("b", "Beta", "2026-10-16"), saved("u", "Umbra", null), saved("a", "Alpha", null)];
    const before = xs.map((a) => a.id);
    expect(sortSaved(xs, NOW).map((a) => a.id)).toEqual(["b", "z", "a", "u"]);
    expect(xs.map((a) => a.id)).toEqual(before);
  });
});

describe("heldByCompany", () => {
  it("one line per company, soonest open deadline first, undated last, more roles before fewer", () => {
    const xs = [
      saved("i1", "IBM", "2026-10-15", "referral"), saved("i2", "IBM", "2026-10-01", "referral"), saved("i3", "IBM", null, "referral"),
      saved("t1", "Tesla", "2026-10-12", "referral"),
      saved("m1", "Meta", null, "referral"), saved("m2", "Meta", null, "referral"),
      saved("a1", "Apple", null, "referral"),
      saved("mine", "Later", "2026-10-10"),              // not held
      app({ id: "sent", company: "IBM", hold: "referral" }),   // went in: not held either
    ];
    const g = heldByCompany(xs, NOW);
    expect(g.map((x) => x.company)).toEqual(["Tesla", "IBM", "Meta", "Apple"]);
    expect(g[1]).toMatchObject({ passed: 1, soonest: new Date(2026, 9, 15, 23, 59) });
    expect(g[1]?.apps.map((a) => a.id)).toEqual(["i1", "i3", "i2"]);
    expect(g[2]?.soonest).toBeNull();
  });
});
