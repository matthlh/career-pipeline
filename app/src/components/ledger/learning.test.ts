import { describe, expect, it } from "vitest";
import type { Learning } from "../../ledger/types";
import { hrefOf } from "./common";
import {
  LEARN_ORDER, fmtAdded, filterLearning, learnCounts, learnLanes, newLearning, quickMove,
  summaryLine,
} from "./Learning";

const item = (over: Partial<Learning> & Pick<Learning, "id" | "topic">): Learning => ({
  why: null, link: null, status: "todo", note: null, added: "2026-10-01", ...over,
});

const items: Learning[] = [
  item({ id: "a", topic: "Kubernetes basics", why: "3 postings ask for it", added: "2026-09-20" }),
  item({ id: "b", topic: "pgvector", status: "learning", note: "chapter 2" }),
  item({ id: "c", topic: "Terraform", added: "2026-10-03" }),
  item({ id: "d", topic: "Rust", status: "done" }),
  item({ id: "e", topic: "Elixir", status: "dropped", why: "one posting, not worth it" }),
  item({ id: "f", topic: "Airflow", added: "2026-10-03" }),
];

describe("learnLanes", () => {
  it("hides done and dropped by default, in lane order", () => {
    const lanes = learnLanes(items, false);
    expect(lanes.map((l) => l.status)).toEqual(["learning", "todo"]);
    expect(lanes.map((l) => l.label)).toEqual(["Learning now", "To learn"]);
  });

  it("shows all four lanes in order when asked", () => {
    const lanes = learnLanes(items, true);
    expect(lanes.map((l) => l.status)).toEqual([...LEARN_ORDER]);
    expect(lanes.map((l) => l.items.map((i) => i.id))).toEqual([["b"], ["f", "c", "a"], ["d"], ["e"]]);
  });

  it("puts each item in exactly one lane", () => {
    const ids = learnLanes(items, true).flatMap((l) => l.items.map((i) => i.id));
    expect(ids.sort()).toEqual(items.map((i) => i.id).sort());
  });

  it("sorts newest first, ties by topic", () => {
    const todo = learnLanes(items, false)[1]!;
    expect(todo.items.map((i) => i.topic)).toEqual(["Airflow", "Terraform", "Kubernetes basics"]);
  });

  it("keeps empty lanes so the layout does not jump", () => {
    const lanes = learnLanes([item({ id: "x", topic: "Go" })], false);
    expect(lanes.map((l) => l.items.length)).toEqual([0, 1]);
  });

  it("files an unknown status under To learn instead of dropping it", () => {
    const odd = item({ id: "z", topic: "Odd", status: "someday" as Learning["status"] });
    expect(learnLanes([odd], false)[1]!.items.map((i) => i.id)).toEqual(["z"]);
  });
});

describe("filterLearning", () => {
  it("matches topic, why and note, case-insensitively", () => {
    expect(filterLearning(items, "kubernetes").map((i) => i.id)).toEqual(["a"]);
    expect(filterLearning(items, "POSTING").map((i) => i.id)).toEqual(["a", "e"]);
    expect(filterLearning(items, "chapter").map((i) => i.id)).toEqual(["b"]);
  });

  it("returns everything for a blank query", () => {
    expect(filterLearning(items, "  ")).toHaveLength(items.length);
  });
});

describe("counts", () => {
  it("counts each status", () => {
    expect(learnCounts(items)).toEqual({ learning: 1, todo: 3, done: 1, dropped: 1 });
    expect(learnCounts([])).toEqual({ learning: 0, todo: 0, done: 0, dropped: 0 });
  });

  it("reads as one plain line", () => {
    expect(summaryLine(learnCounts(items))).toBe("1 learning now, 3 to learn");
  });
});

describe("quickMove", () => {
  it("offers Start on a queued item and Done on one in progress, nothing else", () => {
    expect(quickMove("todo")).toEqual({ label: "Start", to: "learning" });
    expect(quickMove("learning")).toEqual({ label: "Done", to: "done" });
    expect(quickMove("done")).toBeNull();
    expect(quickMove("dropped")).toBeNull();
  });
});

describe("hrefOf", () => {
  it("keeps http(s), adds https to a bare host, refuses other schemes", () => {
    expect(hrefOf("https://kubernetes.io/docs/")).toBe("https://kubernetes.io/docs/");
    expect(hrefOf("http://x.dev")).toBe("http://x.dev");
    expect(hrefOf("docs.rs/tokio")).toBe("https://docs.rs/tokio");
    expect(hrefOf("javascript:alert(1)")).toBeNull();
    expect(hrefOf("data:text/html,hi")).toBeNull();
    expect(hrefOf(null)).toBeNull();
    expect(hrefOf("  ")).toBeNull();
  });
});

describe("fmtAdded", () => {
  const now = new Date(2026, 9, 4);
  it("drops the year for this year and keeps it otherwise", () => {
    expect(fmtAdded("2026-10-04", now)).toBe("Oct 4");
    expect(fmtAdded("2025-12-31", now)).toBe("Dec 31, 2025");
  });
  it("shows anything that is not a date as it is", () => {
    expect(fmtAdded("sometime", now)).toBe("sometime");
  });
});

describe("newLearning", () => {
  it("builds a full todo entity stamped with the local date", () => {
    const now = new Date(2026, 9, 4, 23, 30);
    expect(newLearning({ topic: " Kubernetes ", why: "3 postings ask for Kubernetes", link: null }, "learn-x", now))
      .toEqual({
        id: "learn-x", topic: "Kubernetes", why: "3 postings ask for Kubernetes", link: null,
        status: "todo", note: null, added: "2026-10-04",
      });
  });
});
