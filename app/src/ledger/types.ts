/* The ledger contract. Every ledger module, Python and TypeScript, codes against
   this file; change it here first and the rest follows.

   What the ledger is: one place to see every company, person, application,
   open-source thread, thing-to-learn and chat in the job search, and to change their
   state. It replaces the outreach queue as the app's main view.

   ---------------------------------------------------------------------------
   Data flow (no server; the built app must keep working from file://)
   ---------------------------------------------------------------------------

     data/*.jsonl ──export-app──▶ app/public/data.js  (window.SEED.ledger: LedgerSeed)
          ▲                                  │
          │                                  ▼
     ledger-import ◀── app/public/ledger-edits.json ◀── the app (edit log)

   1. `scripts/jobs/export_app.py` builds `SEED.ledger` (shape: LedgerSeed) from
        data/applications.jsonl   submitted applications       -> Application, status from row
        data/open_postings.jsonl  still-to-apply postings      -> Application, status "saved"
                                   (rows whose status is "applied"/"skipped" are left out:
                                    the applied ones are already in applications.jsonl)
        data/contacts.jsonl       pipeline contacts            -> LedgerPerson
        data/ledger.jsonl         everything added or changed in the app, one JSON object
                                   per line: {"kind": Kind, "id": string, ...fields}.
                                   A "person" or "company" row here is an overlay merged
                                   over the pipeline record with the same id (or a new one).
                                   "opensource", "learning", "outreach" and "chat" rows exist only here.
        state/ledger_imported.json {"applied": [edit ids]} -> LedgerSeed.appliedEdits
      Companies are derived: every company named by an application or a person, plus every
      "company" row in data/ledger.jsonl. Company.id = companyId(name).

   2. The app shows applyEdits(SEED.ledger, localEdits) and records every change as an
      Edit in localStorage (key "career.ledger.edits.v1"). When a folder has been granted
      (folder.ts, Chromium), it also writes the whole local log, as EditsFile, to
      `ledger-edits.json` in that folder (app/public/), on every change.

   3. `scripts/jobs/ledger_import.py` (run by `run.py ledger-import`, and first thing in
      `run.py applications` and `run.py export-app`) reads app/public/ledger-edits.json,
      skips ids already in state/ledger_imported.json, and folds the rest into the files:
        application  "event"            -> jobs/mark_app.apply_status on applications.jsonl
                                           (status "applied" on a saved posting ->
                                            mark_app.settle_posting(..., "applied"))
                     "set"              -> those fields on the matching row in
                                           applications.jsonl or open_postings.jsonl
                     "add"              -> new row in open_postings.jsonl (status "saved")
                                           or applications.jsonl (any other status)
                     "delete"           -> a saved posting becomes status "skipped" in
                                           open_postings.jsonl; a submitted application is
                                           never deleted (reported, then marked imported)
        person/company/opensource/learning/outreach/chat
                     "add" | "set"      -> upsert the row in data/ledger.jsonl
                                   "delete" -> the row becomes a tombstone
                                           {"kind", "id", "deleted": true}; export leaves the
                                           entity out even if the pipeline still has it
      An edit whose target does not exist is reported and still marked imported, so one
      bad edit cannot be retried forever.
      then appends the ids to state/ledger_imported.json.

   4. The app drops every local edit whose id is in SEED.ledger.appliedEdits, because the
      seed now carries its effect. That is what keeps "event" edits from doubling.

   Field names below are the wire format in data.js and ledger-edits.json. Python writes
   them exactly as spelled here (camelCase), even though the jsonl files are snake_case.
*/

export type Kind = "application" | "person" | "company" | "opensource" | "learning" | "outreach" | "chat";

/* ---------------------------------------------------------------- applications */

/** "saved" = a posting he means to apply to and has not yet. The rest match
 *  scripts/jobs/applications.py STATUSES. */
export type AppStatus =
  | "saved" | "applied" | "interview" | "offer" | "rejected" | "withdrawn" | "closed";

/** Referral state for one application. "want" = would like one, nobody asked yet. */
export type Referral = "none" | "want" | "asked" | "referred";

export interface AppEvent { at: string; status: string; note: string }

export interface Application {
  /** job_id from the jsonl (SCOPE id like "184771", or a slug like "mechanize-2026-10-02").
   *  New ones made in the app: "app-<base36 time>". */
  id: string;
  company: string;
  title: string;
  status: AppStatus;
  /** "SCOPE" | "employer site" | free text. */
  via: string | null;
  /** "W27" | "S27" | null. */
  term: string | null;
  /** "2026-10-05 09:00 PT" or a bare "2026-10-05", Pacific. null = undated. */
  deadline: string | null;
  /** Local YYYY-MM-DD the application went in. null while saved. */
  submitted: string | null;
  /** Where to apply or the posting. */
  link: string | null;
  /** Free-text "where" when there is no link ("careers.planview.com, job 5151"). */
  where: string | null;
  referral: Referral;
  /** Who referred or was asked: a LedgerPerson id, or free text. */
  referrer: string | null;
  /** "referral" = deliberately held until a referral comes through. */
  hold: string | null;
  note: string | null;
  events: AppEvent[];
}

/* ---------------------------------------------------------------- people */

/** Pipeline contact state, from data/contacts.jsonl, plus the ones the app adds. */
export type PersonState =
  | "new" | "queued" | "contacted" | "awaiting_reply" | "replied" | "dead" | "bounced"
  | "met" | "friend";

export interface LedgerPerson {
  /** Lower-cased email when there is one, else "p-<slug of name>-<slug of company>". */
  id: string;
  name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  /** How he found or knows them: "GitHub commits", "Next Play newsletter", "classmate". */
  how: string | null;
  state: PersonState;
  /** Last touch, local YYYY-MM-DD. */
  last: string | null;
  /** Could refer him, or has offered to. */
  canRefer: boolean;
  note: string | null;
}

/* ---------------------------------------------------------------- companies */

export interface Company {
  /** companyId(name). */
  id: string;
  name: string;
  domain: string | null;
  /** One line: what they do / why they are on the list. */
  why: string | null;
  star: boolean;
  note: string | null;
}

/* ---------------------------------------------------------------- open source */

export type OssStatus = "exploring" | "working" | "pr open" | "merged" | "dropped";

export interface OpenSource {
  /** "oss-<base36 time>" when made in the app. */
  id: string;
  /** Project name, e.g. "vitest". */
  project: string;
  /** Repo URL. */
  repo: string | null;
  /** The issue or PR he is on. */
  link: string | null;
  status: OssStatus;
  /** Company this helps with, if any (Company.id). */
  company: string | null;
  note: string | null;
  /** Local YYYY-MM-DD it was added. */
  added: string;
}

/* ---------------------------------------------------------------- learning */

export type LearnStatus = "todo" | "learning" | "done" | "dropped";

export interface Learning {
  /** "learn-<base36 time>" when made in the app. */
  id: string;
  /** Tool, topic or skill, e.g. "Kubernetes basics". */
  topic: string;
  /** Why: which posting or company asks for it. */
  why: string | null;
  /** Course, docs or video. */
  link: string | null;
  status: LearnStatus;
  note: string | null;
  added: string;
}

/* ---------------------------------------------------------------- outreach */

/** Where a message went. The app drafts nothing: he sends from his mail client
 *  or LinkedIn and logs it here. */
export type OutreachChannel = "email" | "linkedin";

/** "sent" = waiting on them. "no_reply" = closed after the one follow-up went
 *  unanswered, or sooner by hand. One thread never has two follow-ups. */
export type OutreachStatus = "sent" | "replied" | "no_reply";

export interface Outreach {
  /** "out-<base36 time>" when made in the app. */
  id: string;
  /** Who it went to, as typed. Not a LedgerPerson link: a row has to stand on
   *  its own, since most people he writes to are not pipeline contacts. */
  name: string;
  company: string | null;
  channel: OutreachChannel;
  /** The subject line, or the first line of a LinkedIn note. */
  what: string;
  /** Local YYYY-MM-DD the message went. */
  sent: string;
  /** Local YYYY-MM-DD the one follow-up went, or null. Never a second. */
  followedUp: string | null;
  status: OutreachStatus;
  note: string | null;
}

/* ---------------------------------------------------------------- chats */

/** A coffee chat (someone he reached out to) or an interview (a company's process). */
export type ChatType = "coffee" | "interview";

export type ChatStatus = "upcoming" | "done" | "cancelled";

export interface Chat {
  /** "chat-<base36 time>" when made in the app. */
  id: string;
  /** Not "kind": every ledger.jsonl row already uses that key for the entity kind. */
  type: ChatType;
  /** Company display name. */
  company: string;
  /** Who it is with: a name, or "two engineers on the platform team". */
  who: string | null;
  /** "2026-10-12 11:00", local Pacific. null = not booked yet. */
  when: string | null;
  /** Meet or Teams link, or a place. */
  where: string | null;
  status: ChatStatus;
  /** Before: research, questions to ask, stories to tell. Starts as a checklist. */
  prep: string | null;
  /** After: what he learned, what to follow up on. */
  notes: string | null;
  /** Local YYYY-MM-DD it was added. */
  added: string;
}

/* ---------------------------------------------------------------- seed + edits */

export interface LedgerSeed {
  applications: Application[];
  people: LedgerPerson[];
  companies: Company[];
  opensource: OpenSource[];
  learning: Learning[];
  outreach: Outreach[];
  chats: Chat[];
  /** Edit ids already folded into the files above. */
  appliedEdits: string[];
}

export type EditOp = "add" | "set" | "event" | "delete";

export interface Edit {
  /** "e-<base36 time>-<4 random base36>", unique per edit. */
  id: string;
  /** ISO timestamp, UTC. */
  at: string;
  kind: Kind;
  /** Entity id the edit applies to. For "add", the new entity's id. */
  target: string;
  op: EditOp;
  /** "add": the full new entity. "set": the changed fields only. */
  fields?: Record<string, unknown>;
  /** "event" (applications only): appended to events; status also becomes
   *  event.status unless event.status is "note". */
  event?: { status: string; note: string };
}

export interface EditsFile { version: 1; edits: Edit[] }

/** What the views read: the seed with every pending local edit applied. */
export type Ledger = Omit<LedgerSeed, "appliedEdits">;

/** The hook every view uses (implemented in ledger/useLedger.ts). */
export interface LedgerApi {
  ledger: Ledger;
  /** Record an edit: id and at are filled in. Applies immediately. */
  edit(e: Omit<Edit, "id" | "at">): void;
  /** Pending edits not yet folded into the files by ledger-import. */
  pending: number;
  /** "folder" = also written to ledger-edits.json; "local" = this browser only. */
  savedTo: "folder" | "local";
}

/** Company.id from a display name: lower-case, non-alphanumerics to "-", trimmed.
 *  Python mirrors this exactly (export_app.company_id). */
export function companyId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
