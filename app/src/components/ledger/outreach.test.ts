import { describe, expect, it } from "vitest";
import { FOLLOWUP_DAYS, today } from "../../rules";
import type { Outreach } from "../../ledger/types";
import {
  CHANNELS, filterOutreach, newOutreach, nextText, orderOpen, outreachCounts, outreachGroups, summaryLine,
} from "./Outreach";

// Friday 9 Oct 2026, 9pm local.
const NOW = new Date(2026, 9, 9, 21, 0);
const daysAgo = (n: number) => today(new Date(2026, 9, 9 - n, 12));

const thread = (id: string, over: Partial<Outreach> = {}): Outreach => ({
  id, name: id, company: "Acme", channel: "email", what: "your eval harness", sent: daysAgo(3),
  followedUp: null, status: "sent", note: null, ...over,
});

const rows: Outreach[] = [
  thread("fresh", { sent: daysAgo(2) }),                                       // wait, due in 5
  thread("due", { sent: daysAgo(9), company: "Beta" }),                        // follow up
  thread("dueOlder", { sent: daysAgo(12) }),                                   // follow up, longer
  thread("theirs", { sent: daysAgo(10), followedUp: daysAgo(4) }),            // followed up, wait
  thread("gone", { sent: daysAgo(30), followedUp: daysAgo(FOLLOWUP_DAYS) }),  // two touches, nothing
  thread("yes", { status: "replied", sent: daysAgo(20), note: "call Tuesday" }),
  thread("yes2", { status: "replied", sent: daysAgo(5), channel: "linkedin", what: "good to meet you" }),
  thread("no", { status: "no_reply", sent: daysAgo(40), followedUp: daysAgo(33) }),
];
const ids = (xs: Outreach[]) => xs.map((o) => o.id);

describe("filterOutreach", () => {
  it("matches name, company, subject and note, case-insensitively", () => {
    expect(ids(filterOutreach(rows, "beta"))).toEqual(["due"]);
    expect(ids(filterOutreach(rows, "GOOD TO"))).toEqual(["yes2"]);
    expect(ids(filterOutreach(rows, "tuesday"))).toEqual(["yes"]);
    expect(ids(filterOutreach(rows, "  "))).toEqual(ids(rows));
    expect(filterOutreach(rows, "linkedin")).toEqual([]);     // the channel is not text
  });
});

describe("orderOpen", () => {
  it("follow-ups due first (longest first), then two-touch threads, then the rest by last touch", () => {
    const open = rows.filter((o) => o.status === "sent");
    expect(ids(orderOpen(open, NOW))).toEqual(["dueOlder", "due", "gone", "theirs", "fresh"]);
  });
  it("does not mutate its input", () => {
    const xs = [thread("b", { sent: daysAgo(9) }), thread("a", { sent: daysAgo(9) })];
    orderOpen(xs, NOW);
    expect(ids(xs)).toEqual(["b", "a"]);
  });
});

describe("outreachGroups", () => {
  it("is sent, replied, then no reply only when asked; replied newest first", () => {
    const g = outreachGroups(rows, NOW, false);
    expect(g.map((x) => [x.status, x.label, x.rows.length])).toEqual([["sent", "Sent", 5], ["replied", "Replied", 2]]);
    expect(ids(g[1]!.rows)).toEqual(["yes2", "yes"]);
    expect(outreachGroups(rows, NOW, true).map((x) => x.status)).toEqual(["sent", "replied", "no_reply"]);
  });
  it("leaves out empty groups", () => {
    expect(outreachGroups([thread("x", { status: "replied" })], NOW, true).map((x) => x.status)).toEqual(["replied"]);
    expect(outreachGroups([], NOW, true)).toEqual([]);
  });
});

describe("outreachCounts / summaryLine", () => {
  it("counts every thread, this week's first messages, replies and follow-ups due", () => {
    const c = outreachCounts(rows, NOW);
    expect(c).toEqual({ total: 8, week: 2, replied: 2, due: 2 });    // this week: fresh, yes2
    expect(summaryLine(c)).toBe("8 sent, 2 this week. 2 replied.");
    expect(summaryLine({ total: 2, week: 0, replied: 0, due: 0 })).toBe("2 sent. 0 replied.");
    expect(summaryLine({ total: 0, week: 0, replied: 0, due: 0 })).toBe("0 sent.");
  });
});

describe("newOutreach", () => {
  it("fills the whole entity, trims the name, and a blank date means today", () => {
    const o = newOutreach({ name: "  Ada ", company: null, channel: "linkedin", what: "hi", sent: null }, "out-1", NOW);
    expect(o).toEqual({
      id: "out-1", name: "Ada", company: null, channel: "linkedin", what: "hi", sent: "2026-10-09",
      followedUp: null, status: "sent", note: null,
    });
  });
  it("keeps a given date and reads anything but linkedin as email", () => {
    const o = newOutreach({ name: "Ada", company: "Acme", channel: "carrier pigeon", what: null, sent: "2026-10-01" }, "out-2", NOW);
    expect(o).toMatchObject({ company: "Acme", channel: "email", what: "", sent: "2026-10-01" });
    expect(CHANNELS).toEqual(["email", "linkedin"]);
  });
});

describe("nextText", () => {
  it("names the follow-up day while it is ahead", () => {
    expect(nextText(thread("x", { sent: "2026-10-07" }), NOW)).toEqual({ text: "Follow up Wed Oct 14", why: null, due: false });
  });
  it("says follow up on day 7, and mark dead after the follow-up goes unanswered", () => {
    const due = nextText(thread("x", { sent: daysAgo(FOLLOWUP_DAYS) }), NOW);
    expect(due).toMatchObject({ text: "Follow up", due: true });
    expect(due?.why).toMatch(/once/);
    const theirs = nextText(thread("x", { sent: daysAgo(10), followedUp: daysAgo(2) }), NOW);
    expect(theirs).toMatchObject({ text: "Sent 2d ago", due: false });
    expect(theirs?.why).toMatch(/their move/);
    expect(nextText(thread("x", { sent: daysAgo(20), followedUp: daysAgo(8) }), NOW)).toMatchObject({ text: "Mark dead", due: true });
  });
  it("says nothing about an answered or closed thread", () => {
    expect(nextText(thread("x", { status: "replied" }), NOW)).toBeNull();
    expect(nextText(thread("x", { status: "no_reply" }), NOW)).toBeNull();
  });
});
