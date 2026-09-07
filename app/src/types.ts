/* The shapes scripts/jobs/export_app.py writes into data.js, plus the state the
   app keeps on top of them. Person is generated and read-only; PersonState is
   everything you do about a person and is the only thing localStorage holds. */

export type Status =
  | "not contacted" | "applied" | "messaged" | "replied"
  | "call booked" | "call done" | "built it" | "dead";

export type Channel = "email" | "linkedin" | "form";

export type Tier = "tier_1_canada" | "tier_2_remote" | "tier_3_us_onsite" | "unknown";

export type TemplateKey = "1" | "1a" | "2" | "3" | "4" | "5" | "6" | "7";

export interface Person {
  id: string;
  email: string;
  name: string | null;
  first: string;
  company: string;
  domain: string;
  repo: string | null;
  method: string | null;
  github: string | null;
  evidenceUrl: string | null;
  roleInbox: boolean;
  tier: Tier;
  what: string | null;
  location: string | null;
  remote: string | null;
  stage: string | null;
  mentionsIntern: boolean;
  stageRank: number;
  source: string;
  locRank: number;
  loc: string;
  roleRank: number;
  roleFit: string;
  postingUrl: string | null;
  applyUrl: string | null;
  fact: string | null;
  ask: string | null;
  cite: string | null;
  citeUrl: string | null;
  score: number;
}

export interface PersonState {
  status?: Status;
  channel?: Channel;
  alum?: boolean;
  /** Last touch, local YYYY-MM-DD. Every date rule reads this. */
  last?: string;
  /** First touch, kept so the funnel can measure time-to-reply later. */
  first?: string;
  /** Follow-ups sent. One is the rule; two is the definition of dead. */
  ups?: number;
  /** Furthest rung reached. See RANK - closing a thread must not lower it. */
  peak?: number;
  notes?: string;
  /** What they said on the call, verbatim. Template 5 and 6 both need it. */
  said?: string;
  link?: string;
  /** The one new thing that makes a follow-up not a reminder. */
  newthing?: string;
}

export interface Counts {
  people: number;
  researched: number;
  named: number;
  companies: number;
  unworked: number;
}

export interface LogEntry { at: string; id?: string; ch?: string }

export interface AppState {
  p: Record<string, PersonState>;
  ropes: Record<number, boolean>;
  log: LogEntry[];
  target: number;
  /** Present only in an imported file: the export carries people with progress. */
  people?: Person[];
  counts?: Counts;
  generated?: string;
}

/** Demo progress, stored as day offsets so a published copy cannot age badly. */
export interface DemoSeed {
  p: Record<string, PersonState & { ago?: number; firstAgo?: number }>;
  ropes: number[];
  log: number[];
}

export interface Seed {
  generated: string;
  from: string;
  counts: Counts;
  people: Person[];
  demo?: DemoSeed;
}

export type ActionKind =
  | "send" | "followup" | "thanks" | "build" | "return" | "wait" | "reply" | "none";

export interface Action {
  kind: ActionKind;
  label: string;
  why: string;
  /** Which template this action wants. Absent when there is nothing to send. */
  tmpl?: TemplateKey;
  /** Apply to the posted role before sending. */
  apply?: boolean;
  /** Two unanswered touches. Offer to close it out. */
  dead?: boolean;
  /** A live thread nobody has moved in STALE_DAYS. */
  stale?: boolean;
}
