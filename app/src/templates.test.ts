// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SUBJ_GOOD, WORDS_GOOD, words } from "./rules";
import { T, buildMsg } from "./templates";
import type { Person, TemplateKey } from "./types";

/* A researched fact runs 30-40 words. Every length assertion below uses one,
   because a template measured with the placeholder still in it tells you
   nothing about the message you would actually send. */
const FACT = "you moved the trace merge off the request path and into a background "
  + "reducer, which reads like the kind of change you only make after an incident "
  + "taught you to do it that way";

const person = (over: Partial<Person> = {}): Partial<Person> => ({
  first: "Dana", company: "Lantern", fact: FACT,
  ask: "how you decide what belongs on the hot path",
  repo: "lantern/lantern-core", mentionsIntern: true, tier: "unknown", ...over,
});

describe("the LinkedIn notes", () => {
  const keys: TemplateKey[] = ["1", "1a"];

  it("do not silently truncate themselves", () => {
    // They used to end in .slice(0, 300), which cut a real fact mid-sentence and
    // - because the slice ran before the meter measured it - reported a
    // reassuring number under the limit. The app was doing the exact thing its
    // own note warns LinkedIn does.
    for (const k of keys) {
      const msg = buildMsg(k, person());
      expect(msg.text.endsWith("..."), k).toBe(false);
      expect(msg.text, k).toContain("incident taught you to do it that way");
    }
  });

  it("still declare the limit, so the meter can flag them", () => {
    for (const k of keys) {
      expect(T[k]().limit, k).toBe(300);
    }
  });

  it("carry little enough scaffolding that trimming the fact is enough", () => {
    // A 200-character researched fact will not fit a 300-character note beside
    // an intro and an ask, and no amount of rewriting changes that - which
    // clause of the fact to drop is the user's call. What the template owes
    // them is not spending the budget on itself: this was 421 characters.
    for (const k of keys) {
      const over = buildMsg(k, person()).text.length - 300;
      expect(over, `${k} is ${over} characters over`).toBeLessThan(40);
    }
  });
});

describe("the cold emails", () => {
  it("leave room for a real fact under 100 words", () => {
    // Under 100 words replies at 11.9%; 100-200 at 1.9%. The fixed text has to
    // be short enough that a fact still fits inside the good band.
    for (const k of ["2", "3"] as TemplateKey[]) {
      const w = words(buildMsg(k, person()).text);
      expect(w, `template ${k} is ${w} words with a real fact`).toBeLessThanOrEqual(WORDS_GOOD);
    }
  });

  it("stay under 100 words even when the visa line is appended", () => {
    // tier_3_us_onsite is San Francisco and New York - the companies that rank
    // highest. The long visa paragraph used to push template 2 to 116 words on
    // exactly those.
    for (const k of ["2", "3"] as TemplateKey[]) {
      const w = words(buildMsg(k, person({ tier: "tier_3_us_onsite" })).text);
      expect(w, `template ${k} is ${w} words for a US-onsite company`).toBeLessThanOrEqual(WORDS_GOOD);
    }
  });

  it("have subject lines in the band that opens best", () => {
    for (const k of ["2", "3", "4", "5", "6"] as TemplateKey[]) {
      const s = buildMsg(k, person()).subject;
      if (!s) continue;
      expect(s.length, `template ${k} subject: "${s}"`).toBeLessThanOrEqual(SUBJ_GOOD);
    }
  });

  it("never say the role twice", () => {
    // Rendered "I applied for the internship internship yesterday."
    expect(buildMsg("2", person()).text).not.toMatch(/internship internship/);
  });

  it("only raise work authorisation where it does not argue with the email", () => {
    const us = { tier: "tier_3_us_onsite" } as Partial<Person>;
    // Template 2 followed an application, so it is a live question.
    expect(buildMsg("2", person(us)).text).toMatch(/Canadian/);
    // Template 3 opens by saying it is not about a role. Both cannot be true.
    expect(buildMsg("3", person(us)).text).not.toMatch(/Canadian/);
  });
});

describe("the follow-up", () => {
  it("refuses to be a reminder", () => {
    // "just checking in" and "circling back" are the worst-performing openers
    // there are, and a reminder-only follow-up tanks engagement. Without a new
    // thing typed in, the template shows a bracket rather than a message.
    const empty = buildMsg("4", person());
    expect(empty.text).toContain("[One new thing");

    const filled = buildMsg("4", person(), { newthing: "I read your reducer patch." });
    expect(filled.text).toContain("I read your reducer patch.");
    expect(filled.text).not.toContain("[One new thing");
    // The placeholder names these phrases in order to forbid them, so only the
    // filled message can be checked for them.
    expect(filled.text).not.toMatch(/bumping|checking in|circling back/i);
  });
});
