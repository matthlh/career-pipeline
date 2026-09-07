import { FROM, SIG } from "./seed";
import type { Person, PersonState, TemplateKey } from "./types";

/* ============================ the messages ==============================

   Seven of them, and the decision tree in Templates.tsx has three paths that
   refuse to give you one at all. Lengths are deliberate: a cold email under 100
   words replies at about 11.9% and the 100-200 band at 1.9%, so the fixed text
   is kept short enough that a 30-40 word researched fact still fits under the
   line. MsgMeter shows you where each one landed.
   ---------------------------------------------------------------------- */

/* Two lengths on purpose. Cold email gets the short one: the long paragraph is
   32 words that push template 2 over the line on exactly the US-onsite
   companies that rank highest, and the detail belongs in the reply rather than
   in the ask. The long one goes to a recruiter, who is already talking to you
   and is the person who actually has to file the form. */
const JVISA = "I'm Canadian - UBC co-op sponsors the J-1, at no cost to you.";
const JVISA_LONG = "I'm a Canadian citizen. UBC Science Co-op sponsors the J-1 through Cultural Vistas - the company files a DS-7002 and the visa is issued at the border. No lottery, no sponsorship cost.";

export interface Ctx {
  first?: string; company?: string; fact?: string; topic?: string; team?: string;
  role?: string; visa?: boolean; said?: string; link?: string; newthing?: string;
  eng?: string; dates?: string; what?: string;
}

export interface Msg {
  n: string; name: string; note: string; text: string;
  subject?: string; limit?: number;
}

export const T: Record<TemplateKey, (c?: Ctx) => Msg> = {
  "1": (c = {}) => ({
    n: "1", name: "LinkedIn note", limit: 300,
    note: "300 character limit, and LinkedIn truncates past it without telling you. The counter below is the real length - trim the fact rather than letting the send do it for you.",
    text: `Hi ${c.first || "[Name]"} - third-year CS at UBC, building LLM retrieval systems. Saw ${c.fact || "[specific thing]"}. Any chance of 15 minutes on ${c.topic || "[topic]"}?`,
  }),

  "1a": (c = {}) => ({
    n: "1 alum", name: "LinkedIn note - alum", limit: 300,
    note: "300 char limit, enforced by LinkedIn rather than by this app - watch the counter. Use this whenever they went to UBC: it is the highest reply rate you have.",
    text: `Hi ${c.first || "[Name]"} - fellow UBC grad, third-year CS, building LLM retrieval systems. Saw ${c.fact || "[specific thing]"}. Would love 15 minutes on how you got from UBC into ${c.company || "[Company]"}.`,
  }),

  "2": (c = {}) => ({
    n: "2", name: "Cold email - you applied", subject: "Applied - one question",
    note: "Apply FIRST, same day. The application is what makes this ask small. Everything fixed here is trimmed to leave room for the fact: a researched fact runs 30-40 words, the visa line another 12, and the reply rate falls off a cliff past 100.",
    text: `Hi ${c.first || "there"},

I applied for the ${c.role || "[role]"} yesterday - third-year CS at UBC.

I noticed ${c.fact || "[specific fact - the blog post, the repo, the changelog item]"}

Closest thing I've built: a semantic-retrieval ticket assistant, benchmarked against a cost budget and shipped to production users.

Any chance of 15 minutes on what your team looks for in interns?${c.visa ? "\n\n" + JVISA : ""}${SIG}`,
  }),

  "3": (c = {}) => ({
    n: "3", name: "Cold email - no posted role", subject: "15 minutes - UBC CS student",
    note: "Ask for advice, never a job - it is the only thing a stranger can say yes to. No visa line here on purpose: the message opens by saying it is not about a role, so raising work authorisation argues against its own frame. It belongs in template 2, where you did apply.",
    text: `Hi ${c.first || "there"},

Third-year CS at UBC. ${c.fact || "[one real specific fact about their work]"}

I build LLM retrieval and eval systems - the last one shipped to production on a measured token budget.

Not asking about a role. Fifteen minutes on ${c.topic || "[the specific technical thing]"}, and what you'd want to see from someone doing this well.${SIG}`,
  }),

  "4": (c = {}) => ({
    n: "4", name: "Follow-up", subject: `One more thing - ${c.company || "[Company]"}`,
    note: 'Send once, never twice. But a reminder-only follow-up is the worst-performing message there is - "just checking in" and "circling back" measurably tank engagement. Put one new thing in it or do not send it.',
    text: `Hi ${c.first || "there"},

${c.newthing || '[One new thing since you wrote: something else you read in their code, a question the first message didn\'t ask, or something you built. Anything except "just checking in".]'}

Same ask as before - 15 minutes whenever suits, and genuinely no problem if the timing is bad.${SIG}`,
  }),

  "5": (c = {}) => ({
    n: "5", name: "After the call", subject: "Thanks - and the thing",
    note: "Within 24 hours. This is the message that converts. Do not skip it.",
    text: `Hi ${c.first || "there"},

Thanks for the time. To make sure I got it: you said the thing that would matter most is ${c.said || "[exactly what they said]"}.

I'm going to build that over the next two weeks and I'll send it your way when it's done.${SIG}`,
  }),

  "6": (c = {}) => ({
    n: "6", name: "The return visit", subject: "Built the thing you mentioned",
    note: "Two weeks later. Almost nobody sends this. Do NOT ask for the referral here.",
    text: `Hi ${c.first || "there"},

You said ${c.said || "[the thing]"}. I built it: ${c.link || "[link]"}.

${c.what || "[One sentence on what it does and one on what you measured.]"}

Two questions - does this look like what you meant, and is there anything you'd change before I put it in front of anyone else?${SIG}`,
  }),

  "7": (c = {}) => ({
    n: "7", name: "Recruiter - warm only",
    subject: `Referred by ${c.eng || "[engineer]"} - ${c.role || "internship"}`,
    note: "Never cold. Only once you have an engineer's name to drop.",
    text: `Hi ${c.first || "there"},

${c.eng || "[Engineer's name]"} on the ${c.team || "[team]"} suggested I reach out. I'm a third-year CS student at UBC applying for ${c.role || "[role]"}, available ${c.dates || "[dates]"}.

Background: LLM application engineering, retrieval and evals. I've already applied through the portal under ${FROM}.

Work authorization: ${JVISA_LONG}

Is there anything else useful from my side?${SIG}`,
  }),
};

/** Fill a template from what the store already knows about this person. */
export function buildMsg(key: TemplateKey, p: Partial<Person>, st?: PersonState): Msg {
  return T[key]({
    first: p.first ?? undefined,
    company: p.company,
    fact: p.fact ?? undefined,
    topic: p.ask ?? undefined,
    /* The bare repo name reads better than "org/repo" in "you're on X at Y". */
    team: p.repo?.split("/").pop() ?? (p.what ? "the product" : ""),
    role: p.mentionsIntern ? "internship" : "role you have open",
    visa: p.tier === "tier_3_us_onsite",
    said: st?.said ?? "",
    link: st?.link ?? "",
    newthing: st?.newthing ?? "",
  });
}

/* ============================ the decision tree ========================= */

export interface TreeNode { q: string; a: [string, string][] }

export const TREE: Record<string, TreeNode> = {
  start: { q: "Where are you with this person?", a: [
    ["Haven't contacted them yet", "who"],
    ["Sent a message, no reply after 7+ days", "t4"],
    ["We had a call", "postcall"],
  ]},
  who: { q: "Who are they?", a: [["An engineer or founder", "alum"], ["A recruiter", "recwarm"]] },
  recwarm: { q: "Do you have an engineer's name to drop?", a: [
    ["Yes, I've spoken to someone there", "t7"], ["No", "stopRec"]] },
  alum: { q: "Did they go to UBC?", a: [["Yes, UBC alum", "chanAlum"], ["No / couldn't tell", "role"]] },
  chanAlum: { q: "How are you reaching them?", a: [["LinkedIn", "t1a"], ["Email", "role"]] },
  role: { q: "Is there a posted role you can apply to?", a: [
    ["Yes, and I've applied", "t2"], ["Yes, but I haven't applied yet", "applyFirst"], ["No posted role", "chan3"]] },
  chan3: { q: "How are you reaching them?", a: [["Email", "t3"], ["LinkedIn", "t1"]] },
  postcall: { q: "How long ago?", a: [
    ["Today or yesterday", "t5"],
    ["About two weeks, and I built the thing", "t6"],
    ["Two weeks, I didn't build it", "stopBuild"]] },
};

export const LEAF: Record<string, TemplateKey> = {
  t1: "1", t1a: "1a", t2: "2", t3: "3", t4: "4", t5: "5", t6: "6", t7: "7",
};

export const STOP: Record<string, { h: string; p: string }> = {
  stopRec: { h: "Don't message this recruiter yet.", p: "Cold recruiters are hammered daily and a student message reads as noise. Get an engineer to talk to you first, then come back and use template 7 with their name in the first line." },
  applyFirst: { h: "Apply first. Same day.", p: "Three minutes, and it puts you in the system. It also makes the ask small: \"I applied for X, would value fifteen minutes.\" Message first and they will just say \"apply on our site\" and you've spent the contact." },
  stopBuild: { h: "Build it first.", p: "The return visit only works because you did the thing they told you to do. Without it you're just checking in, which is the message everyone ignores. Block 60 minutes this weekend, then come back." },
};
