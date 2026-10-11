import { describe, expect, it } from "vitest";
import type { Chat } from "../../ledger/types";
import {
  CHAT_STATUS_ORDER, PREP, chatLanes, daysAway, filterChats, fmtSlot, isOverdue, newChat, parseWhen,
  relativeDay,
} from "./Chats";

const chat = (over: Partial<Chat> & Pick<Chat, "id" | "company">): Chat => ({
  type: "coffee", who: null, when: null, where: null, status: "upcoming", prep: null, notes: null,
  added: "2026-10-01", ...over,
});

/* Sunday Oct 11 2026, 9:00 local. */
const now = new Date(2026, 9, 11, 9, 0);

describe("parseWhen", () => {
  it("reads a space or a T between date and time, and a bare date as midnight", () => {
    expect(parseWhen("2026-10-12 11:00")).toEqual(new Date(2026, 9, 12, 11, 0));
    expect(parseWhen("2026-10-12T11:00")).toEqual(new Date(2026, 9, 12, 11, 0));
    expect(parseWhen("2026-10-15")).toEqual(new Date(2026, 9, 15));
  });

  it("is null for empty or free text", () => {
    expect(parseWhen(null)).toBeNull();
    expect(parseWhen("")).toBeNull();
    expect(parseWhen("next Friday")).toBeNull();
  });
});

describe("fmtSlot", () => {
  it("shows weekday, date and a 12-hour time", () => {
    expect(fmtSlot("2026-10-12 11:00")).toBe("Mon Oct 12, 11:00am");
    expect(fmtSlot("2026-10-15 18:00")).toBe("Thu Oct 15, 6:00pm");
    expect(fmtSlot("2026-10-16 12:05")).toBe("Fri Oct 16, 12:05pm");
    expect(fmtSlot("2026-10-16 00:30")).toBe("Fri Oct 16, 12:30am");
  });

  it("drops the time for a bare date, and keeps text it cannot read", () => {
    expect(fmtSlot("2026-10-15")).toBe("Thu Oct 15");
    expect(fmtSlot("after midterms")).toBe("after midterms");
    expect(fmtSlot(null)).toBe("Not booked yet");
  });
});

describe("relativeDay", () => {
  it("counts calendar days, not 24-hour blocks", () => {
    expect(daysAway(new Date(2026, 9, 12, 0, 5), now)).toBe(1);
    expect(relativeDay(new Date(2026, 9, 11, 23, 0), now)).toBe("today");
    expect(relativeDay(new Date(2026, 9, 12, 11, 0), now)).toBe("tomorrow");
    expect(relativeDay(new Date(2026, 9, 15, 18, 0), now)).toBe("in 4 days");
    expect(relativeDay(new Date(2026, 9, 10, 18, 0), now)).toBe("yesterday");
    expect(relativeDay(new Date(2026, 9, 7, 18, 0), now)).toBe("4 days ago");
  });
});

describe("isOverdue", () => {
  it("is an upcoming chat whose start has passed", () => {
    expect(isOverdue(chat({ id: "a", company: "A", when: "2026-10-11 08:30" }), now)).toBe(true);
    expect(isOverdue(chat({ id: "b", company: "B", when: "2026-10-11 09:30" }), now)).toBe(false);
  });

  it("gives a bare date the whole day", () => {
    expect(isOverdue(chat({ id: "a", company: "A", when: "2026-10-11" }), now)).toBe(false);
    expect(isOverdue(chat({ id: "b", company: "B", when: "2026-10-10" }), now)).toBe(true);
  });

  it("never flags a done, cancelled or unbooked chat", () => {
    expect(isOverdue(chat({ id: "a", company: "A", when: "2026-10-01 10:00", status: "done" }), now)).toBe(false);
    expect(isOverdue(chat({ id: "b", company: "B", when: "2026-10-01 10:00", status: "cancelled" }), now)).toBe(false);
    expect(isOverdue(chat({ id: "c", company: "C" }), now)).toBe(false);
  });
});

const items: Chat[] = [
  chat({ id: "late", company: "Zeta", when: "2026-10-16 12:00", type: "interview" }),
  chat({ id: "soon", company: "Acme", when: "2026-10-12 11:00", who: "Ada" }),
  chat({ id: "unbooked", company: "Beta" }),
  chat({ id: "same-a", company: "Gamma", when: "2026-10-15 18:00" }),
  chat({ id: "same-b", company: "Delta", when: "2026-10-15 18:00" }),
  chat({ id: "old", company: "Eta", when: "2026-10-02 10:00", status: "done", notes: "asked about evals" }),
  chat({ id: "older", company: "Theta", when: "2026-09-20 10:00", status: "done" }),
  chat({ id: "off", company: "Iota", when: "2026-10-05 10:00", status: "cancelled" }),
];

describe("chatLanes", () => {
  it("shows only Upcoming by default, soonest first, unbooked last, ties by company", () => {
    const lanes = chatLanes(items, false);
    expect(lanes.map((l) => l.status)).toEqual(["upcoming"]);
    expect(lanes[0]!.items.map((c) => c.id)).toEqual(["soon", "same-b", "same-a", "late", "unbooked"]);
  });

  it("adds Done and Cancelled, most recent first, when asked", () => {
    const lanes = chatLanes(items, true);
    expect(lanes.map((l) => l.status)).toEqual([...CHAT_STATUS_ORDER]);
    expect(lanes[1]!.items.map((c) => c.id)).toEqual(["old", "older"]);
    expect(lanes[2]!.items.map((c) => c.id)).toEqual(["off"]);
  });

  it("puts every chat in exactly one lane", () => {
    const ids = chatLanes(items, true).flatMap((l) => l.items.map((c) => c.id));
    expect(ids.sort()).toEqual(items.map((c) => c.id).sort());
  });

  it("files an unknown status under Upcoming instead of dropping it", () => {
    const odd = chat({ id: "z", company: "Odd", status: "maybe" as Chat["status"] });
    expect(chatLanes([odd], false)[0]!.items.map((c) => c.id)).toEqual(["z"]);
  });
});

describe("filterChats", () => {
  it("matches company, who, prep and notes, case-insensitively", () => {
    expect(filterChats(items, "acme").map((c) => c.id)).toEqual(["soon"]);
    expect(filterChats(items, "ADA").map((c) => c.id)).toEqual(["soon"]);
    expect(filterChats(items, "evals").map((c) => c.id)).toEqual(["old"]);
    expect(filterChats(items, "  ")).toHaveLength(items.length);
  });
});

describe("newChat", () => {
  it("starts upcoming, with the prep checklist for its type and today's date", () => {
    const c = newChat({ company: " Acme ", who: "Ada", when: "2026-10-12T11:00", where: null }, "coffee", "chat-1", now);
    expect(c).toEqual({
      id: "chat-1", type: "coffee", company: "Acme", who: "Ada", when: "2026-10-12 11:00", where: null,
      status: "upcoming", prep: PREP.coffee, notes: null, added: "2026-10-11",
    });
    expect(newChat({ company: "Zeta", when: null }, "interview", "chat-2", now).prep).toBe(PREP.interview);
  });

  it("leaves an empty time unbooked", () => {
    expect(newChat({ company: "Acme", when: "" }, "coffee", "chat-1", now).when).toBeNull();
  });

  it("keeps the two checklists different and non-empty", () => {
    expect(PREP.coffee).toContain("Questions");
    expect(PREP.interview).toContain("Stories");
    expect(PREP.coffee).not.toBe(PREP.interview);
  });
});
