import { describe, expect, it } from "vitest";
import { fmtDeadline, groupApplications } from "../../ledger/rules";
import type { AppEvent, Application } from "../../ledger/types";
import {
  filterApps, fmtWhen, historyNewestFirst, newApplication, safeUrl, splitHeld, statusOptions, whenLabel,
  type AppFilter,
} from "./Applications";
import { todayLocal } from "./common";

// Sunday 4 Oct 2026, 9pm local.
const NOW = new Date(2026, 9, 4, 21, 0);

function app(over: Partial<Application> = {}): Application {
  return {
    id: "1", company: "Acme", title: "AI Intern", status: "applied", via: "SCOPE", term: "W27",
    deadline: null, submitted: "2026-10-01", link: null, where: null, referral: "none",
    referrer: null, hold: null, note: null, events: [], ...over,
  };
}
const F: AppFilter = { q: "", term: "all", showClosed: false };
const ids = (xs: Application[]) => xs.map((a) => a.id);

describe("filterApps", () => {
  const all = [
    app({ id: "a" }),
    app({ id: "r", status: "rejected" }),
    app({ id: "w", status: "withdrawn" }),
    app({ id: "c", status: "closed" }),
    app({ id: "s", status: "saved", term: "S27", hold: "referral", note: "Ask Priya" }),
    app({ id: "n", status: "interview", term: null, company: "Northwind", title: "Forward deployed" }),
    app({ id: "f", term: "F27", where: "careers.acme.example" }),
  ];

  it("hides rejected, withdrawn and closed until asked", () => {
    expect(ids(filterApps(all, F))).toEqual(["a", "s", "n", "f"]);
    expect(ids(filterApps(all, { ...F, showClosed: true }))).toEqual(ids(all));
  });

  it("filters by term, with null and unknown terms under other", () => {
    expect(ids(filterApps(all, { ...F, term: "W27" }))).toEqual(["a"]);
    expect(ids(filterApps(all, { ...F, term: "S27" }))).toEqual(["s"]);
    expect(ids(filterApps(all, { ...F, term: "other" }))).toEqual(["n", "f"]);
  });

  it("searches company, title and note, case-insensitively, and nothing else", () => {
    expect(ids(filterApps(all, { ...F, q: "north" }))).toEqual(["n"]);
    expect(ids(filterApps(all, { ...F, q: "FORWARD" }))).toEqual(["n"]);
    expect(ids(filterApps(all, { ...F, q: "priya" }))).toEqual(["s"]);
    expect(filterApps(all, { ...F, q: "careers.acme" })).toEqual([]);
  });
});

describe("splitHeld", () => {
  it("splits the saved group into to-apply and held, in place, and leaves the rest alone", () => {
    const groups = groupApplications([
      app({ id: "a" }),
      app({ id: "h1", status: "saved", hold: "referral", company: "IBM" }),
      app({ id: "s1", status: "saved", company: "Later" }),
      app({ id: "r", status: "rejected" }),
      app({ id: "h2", status: "saved", hold: "referral", company: "Tesla" }),
    ]);
    const out = splitHeld(groups);
    expect(out.map((g) => [g.key, g.label, ids(g.apps)])).toEqual([
      ["applied", "Applied", ["a"]],
      ["saved", "To apply", ["s1"]],
      ["held", "Held for referral", ["h1", "h2"]],
      ["closed", "Closed", ["r"]],
    ]);
  });

  it("leaves out an empty half", () => {
    const only = splitHeld(groupApplications([app({ id: "h", status: "saved", hold: "referral" })]));
    expect(only.map((g) => g.key)).toEqual(["held"]);
  });
});

describe("whenLabel", () => {
  it("shows the deadline while saved, the sent date after, and flags a passed one", () => {
    expect(whenLabel(app({ status: "saved", deadline: "2026-10-05 09:00 PT" }), NOW)).toEqual({ text: "Due Mon Oct 5 9 AM", late: false });
    expect(whenLabel(app({ status: "saved", deadline: "2026-10-02" }), NOW)).toEqual({ text: "Passed Fri Oct 2", late: true });
    expect(whenLabel(app({ status: "saved" }), NOW)).toEqual({ text: "Rolling", late: false });
    expect(whenLabel(app({ submitted: "2026-10-01" }), NOW)).toEqual({ text: "Sent Thu Oct 1", late: false });
    expect(whenLabel(app({ submitted: null }), NOW)).toEqual({ text: "", late: false });
  });
});

describe("statusOptions", () => {
  it("offers saved only while the application is saved", () => {
    expect(statusOptions("saved")).toContain("saved");
    expect(statusOptions("applied")).not.toContain("saved");
    expect(statusOptions("applied")).toContain("applied");
    expect(statusOptions("rejected")).toHaveLength(6);
  });
});

describe("historyNewestFirst", () => {
  const ev = (at: string, note: string): AppEvent => ({ at, status: "note", note });

  it("orders newest first, same-time ties later-added first, unparseable last", () => {
    const xs = [
      ev("2026-10-01T10:00:00Z", "first"),
      ev("junk", "bad"),
      ev("2026-10-03T10:00:00Z", "third"),
      ev("2026-10-02T10:00:00Z", "second-a"),
      ev("2026-10-02T10:00:00Z", "second-b"),
    ];
    expect(historyNewestFirst(xs).map((e) => e.note)).toEqual(["third", "second-b", "second-a", "first", "bad"]);
    expect(xs[0]?.note).toBe("first");
  });
});

describe("fmtWhen", () => {
  it("shows a UTC stamp as the local day it fell on", () => {
    const at = "2026-10-05T04:00:00.000Z";
    expect(fmtWhen(at)).toBe(fmtDeadline({ deadline: todayLocal(new Date(at)) }));
  });

  it("never shifts a bare date, and passes junk through", () => {
    expect(fmtWhen("2026-10-01")).toBe("Thu Oct 1");
    expect(fmtWhen("2026-10-01 09:00 PT")).toBe("Thu Oct 1");
    expect(fmtWhen("sometime")).toBe("sometime");
  });
});

describe("safeUrl", () => {
  it("keeps http(s), adds https to a bare domain, refuses the rest", () => {
    expect(safeUrl("https://jobs.acme.example/1")).toBe("https://jobs.acme.example/1");
    expect(safeUrl("jobs.acme.example/role/1")).toBe("https://jobs.acme.example/role/1");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("careers page, job 5151")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe("newApplication", () => {
  it("is a saved posting with everything not entered null", () => {
    const a = newApplication("app-x", { company: "Acme", title: null, link: null, deadline: "2026-10-09" });
    expect(a).toEqual({
      id: "app-x", company: "Acme", title: "", status: "saved", via: null, term: null,
      deadline: "2026-10-09", submitted: null, link: null, where: null, referral: "none",
      referrer: null, hold: null, note: null, events: [],
    });
  });
});
