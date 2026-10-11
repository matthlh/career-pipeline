import { describe, expect, it } from "vitest";
import { FOLLOWUP_DAYS, STALE_DAYS, today } from "../rules";
import {
  OUTREACH_LABEL, OUTREACH_STATUSES, QUIET_DAYS, STATUS_LABEL, STATUS_ORDER, closingSoon, companyView,
  deadlineOf, fmtDeadline, followUpDue, groupApplications, isQuiet, lastTouch, nextStep, outreachAction,
  personFollowUp,
} from "./rules";
import type { AppStatus, Application, Company, Ledger, LedgerPerson, OpenSource, Outreach } from "./types";

// Sunday 4 Oct 2026, 9pm local: already Monday in UTC, which is the point.
const NOW = new Date(2026, 9, 4, 21, 0);
const at = (d: number, h = 0, m = 0) => new Date(2026, 9, d, h, m);
const daysAgo = (n: number) => today(new Date(2026, 9, 4 - n, 12));

function app(over: Partial<Application> = {}): Application {
  return {
    id: "1", company: "Acme", title: "AI Intern", status: "applied", via: "SCOPE", term: "W27",
    deadline: null, submitted: daysAgo(3), link: null, where: null, referral: "none",
    referrer: null, hold: null, note: null, events: [], ...over,
  };
}
const saved = (deadline: string | null, over: Partial<Application> = {}) =>
  app({ status: "saved", submitted: null, deadline, ...over });

function person(over: Partial<LedgerPerson> = {}): LedgerPerson {
  return {
    id: "ada@acme.example", name: "Ada", company: "Acme", title: null, email: "ada@acme.example",
    linkedin: null, how: null, state: "contacted", last: daysAgo(7), canRefer: false, note: null, ...over,
  };
}

describe("status order and labels", () => {
  it("lists every status once, offer first, saved after applied", () => {
    const all: AppStatus[] = ["saved", "applied", "interview", "offer", "rejected", "withdrawn", "closed"];
    expect([...STATUS_ORDER].sort()).toEqual([...all].sort());
    expect(STATUS_ORDER.slice(0, 4)).toEqual(["offer", "interview", "applied", "saved"]);
    for (const s of all) expect(STATUS_LABEL[s]).toBeTruthy();
  });
});

describe("groupApplications", () => {
  it("orders groups offer, interview, applied, saved, closed and folds the dead into one", () => {
    const g = groupApplications([
      app({ id: "r", status: "rejected" }), saved(null, { id: "s" }), app({ id: "w", status: "withdrawn" }),
      app({ id: "a" }), app({ id: "o", status: "offer" }), app({ id: "c", status: "closed" }),
      app({ id: "i", status: "interview" }),
    ]);
    expect(g.map((x) => x.key)).toEqual(["offer", "interview", "applied", "saved", "closed"]);
    expect(g[4]!.apps.map((a) => a.id)).toEqual(["r", "w", "c"]);
    expect(g.every((x) => x.label)).toBe(true);
  });

  it("leaves out empty groups", () => {
    expect(groupApplications([app()]).map((x) => x.key)).toEqual(["applied"]);
    expect(groupApplications([])).toEqual([]);
  });

  it("sorts submitted ones newest first and saved ones by deadline, undated last", () => {
    const g = groupApplications([
      app({ id: "old", submitted: daysAgo(10) }), app({ id: "new", submitted: daysAgo(1) }),
      saved(null, { id: "undated" }), saved("2026-10-09", { id: "later" }), saved("2026-10-05 09:00 PT", { id: "soon" }),
    ]);
    expect(g[0]!.apps.map((a) => a.id)).toEqual(["new", "old"]);
    expect(g[1]!.apps.map((a) => a.id)).toEqual(["soon", "later", "undated"]);
  });
});

describe("deadlines", () => {
  it("reads a timed deadline as that local minute", () => {
    expect(deadlineOf(saved("2026-10-05 09:00 PT"))).toEqual(at(5, 9, 0));
  });
  it("reads a bare date as 23:59 that day", () => {
    expect(deadlineOf(saved("2026-10-05"))).toEqual(at(5, 23, 59));
  });
  it("is null with no usable date", () => {
    expect(deadlineOf(saved(null))).toBeNull();
    expect(deadlineOf(saved(""))).toBeNull();
    expect(deadlineOf(saved("rolling"))).toBeNull();
    expect(deadlineOf(saved("2026-02-30"))).toBeNull();
  });
  it("falls back to end of day on a time it cannot read", () => {
    expect(deadlineOf(saved("2026-10-05 noon"))).toEqual(at(5, 23, 59));
    expect(deadlineOf(saved("2026-10-05 25:00"))).toEqual(at(5, 23, 59));
  });

  it("formats exactly like applications.fmt_deadline", () => {
    expect(fmtDeadline(saved("2026-10-05 09:00 PT"))).toBe("Mon Oct 5 9 AM");
    expect(fmtDeadline(saved("2026-10-02 23:59 PT"))).toBe("Fri Oct 2 11:59 PM");
    expect(fmtDeadline(saved("2026-10-05 09:30 PT"))).toBe("Mon Oct 5 9:30 AM");
    expect(fmtDeadline(saved("2026-10-05 12:00 PT"))).toBe("Mon Oct 5 12 PM");
    expect(fmtDeadline(saved("2026-10-05 00:00 PT"))).toBe("Mon Oct 5 12 AM");
    expect(fmtDeadline(saved("2026-10-05"))).toBe("Mon Oct 5");
    expect(fmtDeadline(saved(null))).toBe("no date");
  });
});

describe("closingSoon", () => {
  it("keeps a deadline until its minute has passed", () => {
    const a = [saved("2026-10-05 09:00 PT")];
    expect(closingSoon(a, at(5, 8, 59))).toHaveLength(1);
    expect(closingSoon(a, at(5, 9, 0))).toHaveLength(1);
    expect(closingSoon(a, at(5, 9, 1))).toHaveLength(0);
  });

  it("runs to the end of the day `days` from now", () => {
    const a = [saved("2026-10-07", { id: "in" }), saved("2026-10-08 00:00 PT", { id: "out" })];
    expect(closingSoon(a, NOW).map((x) => x.id)).toEqual(["in"]);
    expect(closingSoon(a, NOW, 4).map((x) => x.id)).toEqual(["in", "out"]);
  });

  it("only saved, only dated, soonest first then by company", () => {
    const a = [
      saved("2026-10-06", { id: "b", company: "Beta" }),
      saved("2026-10-05 09:00 PT", { id: "first" }),
      saved("2026-10-06", { id: "a", company: "Alpha" }),
      saved(null, { id: "undated" }),
      app({ id: "applied", deadline: "2026-10-05" }),
      saved("2026-10-04 12:00 PT", { id: "passed" }),
    ];
    expect(closingSoon(a, NOW).map((x) => x.id)).toEqual(["first", "a", "b"]);
  });
});

describe("isQuiet", () => {
  it(`turns on at ${QUIET_DAYS} days, not 13`, () => {
    expect(isQuiet(app({ submitted: daysAgo(13) }), NOW)).toBe(false);
    expect(isQuiet(app({ submitted: daysAgo(14) }), NOW)).toBe(true);
  });
  it("needs status applied, no events, and a submitted date", () => {
    expect(isQuiet(app({ submitted: daysAgo(30), events: [{ at: "x", status: "applied", note: "ack" }] }), NOW)).toBe(false);
    expect(isQuiet(app({ submitted: daysAgo(30), status: "interview" }), NOW)).toBe(false);
    expect(isQuiet(app({ submitted: null }), NOW)).toBe(false);
  });
  it("counts local days, so a late evening does not add one", () => {
    expect(isQuiet(app({ submitted: daysAgo(13) }), new Date(2026, 9, 4, 23, 59))).toBe(false);
  });
});

describe("nextStep", () => {
  it("saved with a deadline: apply by it", () => {
    expect(nextStep(saved("2026-10-05 09:00 PT"), NOW)).toBe("Apply by Mon Oct 5 9 AM");
  });
  it("saved without one: apply", () => {
    expect(nextStep(saved(null), NOW)).toBe("Apply");
  });
  it("saved with a passed deadline says so rather than naming a past day", () => {
    expect(nextStep(saved("2026-10-02"), NOW)).toBe("Deadline passed");
  });
  it("held for a referral, or wanting one: ask", () => {
    expect(nextStep(app({ hold: "referral" }), NOW)).toBe("Ask for a referral");
    expect(nextStep(app({ referral: "want" }), NOW)).toBe("Ask for a referral");
  });
  it("referral asked: chase it", () => {
    expect(nextStep(app({ referral: "asked" }), NOW)).toBe("Chase the referral");
  });
  it("quiet: one nudge", () => {
    expect(nextStep(app({ submitted: daysAgo(14) }), NOW)).toBe("One nudge");
  });
  it("interview: prep", () => {
    expect(nextStep(app({ status: "interview" }), NOW)).toBe("Prep for the interview");
  });
  it("offer: decide", () => {
    expect(nextStep(app({ status: "offer" }), NOW)).toBe("Decide");
  });
  it("nothing to do: a fresh application, or a dead one", () => {
    expect(nextStep(app(), NOW)).toBeNull();
    for (const status of ["rejected", "withdrawn", "closed"] as AppStatus[]) {
      expect(nextStep(app({ status, referral: "want", submitted: daysAgo(30) }), NOW)).toBeNull();
    }
  });
  it("takes the first rule that applies, in order", () => {
    expect(nextStep(saved("2026-10-05", { hold: "referral" }), NOW)).toBe("Ask for a referral");
    expect(nextStep(saved("2026-10-05", { hold: "referral", referral: "asked" }), NOW)).toBe("Chase the referral");
    expect(nextStep(saved("2026-10-05", { hold: "referral", referral: "referred" }), NOW)).toBe("Apply by Mon Oct 5");
    expect(nextStep(app({ referral: "want", submitted: daysAgo(30) }), NOW)).toBe("Ask for a referral");
    expect(nextStep(app({ status: "interview", referral: "asked" }), NOW)).toBe("Chase the referral");
    expect(nextStep(app({ referral: "referred", submitted: daysAgo(30) }), NOW)).toBe("One nudge");
  });
});

describe("personFollowUp", () => {
  it("is due on day 7, not day 6", () => {
    expect(personFollowUp(person({ last: daysAgo(6) }), NOW)).toBe(false);
    expect(personFollowUp(person({ last: daysAgo(7) }), NOW)).toBe(true);
    expect(personFollowUp(person({ state: "awaiting_reply", last: daysAgo(7) }), NOW)).toBe(true);
  });
  it("only while waiting on them, and only with a last touch", () => {
    for (const state of ["new", "queued", "replied", "dead", "bounced", "met", "friend"] as const) {
      expect(personFollowUp(person({ state, last: daysAgo(30) }), NOW)).toBe(false);
    }
    expect(personFollowUp(person({ last: null }), NOW)).toBe(false);
  });
});

describe("outreach", () => {
  const thread = (over: Partial<Outreach> = {}): Outreach => ({
    id: "out-1", name: "Ada", company: "Acme", channel: "email", what: "your eval harness",
    sent: daysAgo(3), followedUp: null, status: "sent", note: null, ...over,
  });

  it("lists every status once, with a label", () => {
    expect(OUTREACH_STATUSES).toEqual(["sent", "replied", "no_reply"]);
    for (const s of OUTREACH_STATUSES) expect(OUTREACH_LABEL[s]).toBeTruthy();
  });

  it("the last touch is the follow-up when there was one", () => {
    expect(lastTouch(thread())).toBe(daysAgo(3));
    expect(lastTouch(thread({ followedUp: daysAgo(1) }))).toBe(daysAgo(1));
  });

  it(`puts the follow-up ${FOLLOWUP_DAYS} days after the message, as a local day`, () => {
    expect(followUpDue(thread({ sent: "2026-09-28" }))).toBe("2026-10-05");
    expect(followUpDue(thread({ sent: "2026-12-29" }))).toBe("2027-01-05");
  });

  it("has no due day once the follow-up went, once they answered, once it is closed, or without a real date", () => {
    expect(followUpDue(thread({ followedUp: daysAgo(0) }))).toBeNull();
    expect(followUpDue(thread({ status: "replied" }))).toBeNull();
    expect(followUpDue(thread({ status: "no_reply" }))).toBeNull();
    expect(followUpDue(thread({ sent: "last Tuesday" }))).toBeNull();
  });

  it("is nextAction: wait until day 7, then one follow-up, then it is their move, then mark it dead", () => {
    expect(outreachAction(thread({ sent: daysAgo(FOLLOWUP_DAYS - 1) }), NOW).kind).toBe("wait");
    const due = outreachAction(thread({ sent: daysAgo(FOLLOWUP_DAYS) }), NOW);
    expect(due).toMatchObject({ kind: "followup", tmpl: "4" });
    // Followed up yesterday: nothing to send, their move.
    const theirs = outreachAction(thread({ sent: daysAgo(10), followedUp: daysAgo(1) }), NOW);
    expect(theirs.kind).toBe("wait");
    expect(theirs.why).toMatch(/their move/);
    // Followed up a week ago: two unanswered touches.
    const gone = outreachAction(thread({ sent: daysAgo(20), followedUp: daysAgo(FOLLOWUP_DAYS) }), NOW);
    expect(gone).toMatchObject({ kind: "none", dead: true });
    // Follow-up counts from the follow-up, not the first message.
    expect(outreachAction(thread({ sent: daysAgo(40), followedUp: daysAgo(2) }), NOW).kind).toBe("wait");
  });

  it("a reply is theirs to be answered, and goes stale like any other", () => {
    expect(outreachAction(thread({ status: "replied" }), NOW).kind).toBe("reply");
    expect(outreachAction(thread({ status: "replied", sent: daysAgo(STALE_DAYS) }), NOW)).toMatchObject({ kind: "reply", stale: true });
    expect(outreachAction(thread({ status: "no_reply", sent: daysAgo(1) }), NOW).kind).toBe("none");
  });
});

describe("companyView", () => {
  const acme: Company = { id: "acme-ai", name: "Acme AI", domain: null, why: null, star: true, note: null };
  const os = (id: string, company: string | null): OpenSource => ({
    id, project: "p", repo: null, link: null, status: "working", company, note: null, added: "2026-10-01",
  });
  const ledger: Ledger = {
    applications: [
      app({ id: "a1", company: "Acme AI" }), app({ id: "a2", company: "acme ai", status: "offer" }),
      app({ id: "b1", company: "Beta" }),
    ],
    people: [person({ company: "Acme  AI" }), person({ id: "x", company: null }), person({ id: "y", company: "Beta" })],
    companies: [acme],
    outreach: [],
    opensource: [os("o1", "acme-ai"), os("o2", "Acme AI"), os("o3", null), os("o4", "beta")],
    learning: [],
    chats: [],
  };

  it("collects everything that names the company", () => {
    const v = companyView(ledger, "acme-ai");
    expect(v.company).toBe(acme);
    expect(v.applications.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(v.people.map((p) => p.id)).toEqual(["ada@acme.example"]);
    expect(v.opensource.map((o) => o.id)).toEqual(["o1", "o2"]);
  });

  it("derives the company when it has no entry, and is null when nothing names it", () => {
    expect(companyView(ledger, "beta").company).toEqual(
      { id: "beta", name: "Beta", domain: null, why: null, star: false, note: null });
    expect(companyView(ledger, "nobody")).toEqual({ company: null, applications: [], people: [], opensource: [] });
  });
});
