import { describe, expect, it } from "vitest";
import {
  FOLLOWUP_DAYS, RANK, STALE_DAYS, ago, daysSince, isUntouched, nextAction, nextPeak,
  peakOf, sendWindow, today, weakSendDay, words,
} from "./rules";
import type { Person, PersonState, Status } from "./types";

const NOW = new Date(2026, 8, 7, 21, 0, 0); // 7 Sept 2026, 9pm local

function person(over: Partial<Person> = {}): Person {
  return {
    id: "a@b.example", email: "a@b.example", name: "Ada", first: "Ada",
    company: "B", domain: "b.example", repo: null, method: "github_commits",
    github: null, evidenceUrl: null, roleInbox: false, tier: "unknown",
    what: null, location: null, remote: null, stage: null, mentionsIntern: false,
    stageRank: 2, source: "hn_whoishiring", locRank: 5, loc: "elsewhere",
    roleRank: 4, roleFit: "other", postingUrl: null, applyUrl: null,
    fact: null, ask: null, cite: null, citeUrl: null, score: 0, ...over,
  };
}
const daysAgo = (n: number) => today(new Date(NOW.getTime() - n * 86_400_000));
const st = (o: PersonState): PersonState => o;

describe("dates are local, not UTC", () => {
  it("does not roll over to tomorrow in the evening", () => {
    // toISOString() on this instant is already 8 Sept in UTC.
    expect(today(NOW)).toBe("2026-09-07");
  });
  it("counts whole days back", () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3);
    expect(daysSince(undefined, NOW)).toBeNull();
  });
  it("says today and yesterday in words", () => {
    expect(ago(daysAgo(0), NOW)).toBe("today");
    expect(ago(daysAgo(1), NOW)).toBe("yesterday");
    expect(ago(daysAgo(9), NOW)).toBe("9d ago");
  });
});

describe("the funnel high-water mark", () => {
  it("never goes down", () => {
    expect(nextPeak(st({ peak: 4 }), "messaged")).toBe(4);
  });
  it("is not lowered by closing a thread out", () => {
    expect(RANK.dead).toBe(-1);
    expect(nextPeak(st({ peak: 3 }), "dead")).toBe(3);
  });
  it("falls back to the status for state written before peak existed", () => {
    expect(peakOf(st({ status: "call booked" }))).toBe(4);
    expect(peakOf(st({ status: "dead" }))).toBe(0);
    expect(peakOf(undefined)).toBe(0);
  });
});

describe("nextAction", () => {
  it("asks for advice when there is no posted role", () => {
    const a = nextAction(person(), undefined, NOW);
    expect(a).toMatchObject({ kind: "send", tmpl: "3" });
  });
  it("makes you apply first when there is one", () => {
    const a = nextAction(person({ applyUrl: "https://x.example/apply" }), undefined, NOW);
    expect(a).toMatchObject({ kind: "send", tmpl: "2", apply: true });
  });

  it("waits, then asks for one follow-up on day 7", () => {
    const before = nextAction(person(), st({ status: "messaged", last: daysAgo(FOLLOWUP_DAYS - 1) }), NOW);
    expect(before.kind).toBe("wait");
    const due = nextAction(person(), st({ status: "messaged", last: daysAgo(FOLLOWUP_DAYS) }), NOW);
    expect(due).toMatchObject({ kind: "followup", tmpl: "4" });
  });

  it("does not offer a second follow-up the moment the first is sent", () => {
    // The regression this guards: marking a follow-up sent sets last to today
    // and ups to 1, and a naive ups check would declare the thread dead at once.
    const a = nextAction(person(), st({ status: "messaged", last: daysAgo(0), ups: 1 }), NOW);
    expect(a.kind).toBe("wait");
    expect(a.dead).toBeFalsy();
  });

  it("closes out after two unanswered touches", () => {
    const a = nextAction(person(), st({ status: "messaged", last: daysAgo(FOLLOWUP_DAYS), ups: 1 }), NOW);
    expect(a.dead).toBe(true);
  });

  it("flags a live thread nobody has moved", () => {
    const fresh = nextAction(person(), st({ status: "replied", last: daysAgo(STALE_DAYS - 1) }), NOW);
    expect(fresh.stale).toBeFalsy();
    const stale = nextAction(person(), st({ status: "replied", last: daysAgo(STALE_DAYS) }), NOW);
    expect(stale.stale).toBe(true);
  });

  it("walks the post-call loop", () => {
    const p = person();
    expect(nextAction(p, st({ status: "call done", last: daysAgo(0) }), NOW)).toMatchObject({ tmpl: "5" });
    expect(nextAction(p, st({ status: "call done", last: daysAgo(3) }), NOW).kind).toBe("build");
    expect(nextAction(p, st({ status: "call done", last: daysAgo(20) }), NOW).label).toMatch(/Overdue/);
    expect(nextAction(p, st({ status: "built it", last: daysAgo(1) }), NOW)).toMatchObject({ kind: "return", tmpl: "6" });
  });

  it("has nothing to say about a dead thread", () => {
    expect(nextAction(person(), st({ status: "dead", last: daysAgo(1) }), NOW).kind).toBe("none");
  });

  it("gives every status exactly one next action", () => {
    const all: Status[] = ["not contacted", "applied", "messaged", "replied",
      "call booked", "call done", "built it", "dead"];
    for (const status of all) {
      const a = nextAction(person(), st({ status, last: daysAgo(2) }), NOW);
      expect(a.label, status).toBeTruthy();
      expect(a.why, status).toBeTruthy();
    }
  });
});

describe("the send window", () => {
  it("leaves you alone when they are in your timezone", () => {
    expect(sendWindow({ location: "San Francisco, CA" }).off).toBe(0);
  });
  it("shifts east coast into the small hours, which is what scheduling is for", () => {
    const w = sendWindow({ location: "New York, NY" });
    expect(w).toMatchObject({ off: 3, name: "Eastern", yours: "3am-6am" });
  });
  it("does not wrap past midnight into a nonsense range", () => {
    expect(sendWindow({ location: "London" }).yours).toBe("10pm-1am");
  });
  it("ignores the company name, which is not a timezone", () => {
    // "Boston Dynamics" in San Francisco was being told to send at 3am.
    expect(sendWindow({ location: "San Francisco, CA" }).name).toBe("Pacific");
    expect(sendWindow({ location: null }).name).toBe("Pacific");
  });
});

describe("send days", () => {
  it("names the weak ones and stays quiet on the good ones", () => {
    expect(weakSendDay(new Date(2026, 8, 8))).toBeNull();   // Tuesday
    expect(weakSendDay(new Date(2026, 8, 11))).toBe("Friday");
  });
});

describe("words", () => {
  it("counts what a reader counts", () => {
    expect(words("  one   two\nthree ")).toBe(3);
    expect(words("")).toBe(0);
    expect(words(null)).toBe(0);
  });
});

describe("a stored state that records nothing", () => {
  it("is treated as no state at all", () => {
    // The app saves on first render, so an empty object in localStorage means
    // "someone opened the page once", not "someone has a search in progress".
    expect(isUntouched(undefined)).toBe(true);
    expect(isUntouched({ p: {}, ropes: {}, log: [], target: 2 })).toBe(true);
  });
  it("but anything actually done is kept", () => {
    expect(isUntouched({ p: { "a@b.example": { status: "messaged" } }, ropes: {}, log: [], target: 2 })).toBe(false);
    expect(isUntouched({ p: {}, ropes: { 0: true }, log: [], target: 2 })).toBe(false);
    expect(isUntouched({ p: {}, ropes: {}, log: [{ at: "x" }], target: 2 })).toBe(false);
    expect(isUntouched({ p: {}, ropes: {}, log: [], target: 2, people: [person()] })).toBe(false);
  });
});
