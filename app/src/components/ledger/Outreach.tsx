/* The Outreach view: the log of messages he has actually sent, one row per
   thread. The app drafts nothing and sends nothing - the email or LinkedIn
   note is written on his machine and he presses Send - so what is here is a
   record and a clock: who, where, what, when, and whether the one follow-up
   is due. The clock is nextAction in ../../rules, reached through
   outreachAction; nothing in this file counts days. Every change is one
   api.edit. */
import { useMemo, useState } from "react";
import { newId } from "../../ledger/apply";
import {
  OUTREACH_LABEL, OUTREACH_STATUSES, fmtDeadline, followUpDue, lastTouch, outreachAction,
} from "../../ledger/rules";
import type { LedgerApi, Outreach as Row, OutreachChannel, OutreachStatus } from "../../ledger/types";
import { daysSince } from "../../rules";
import {
  AddForm, Chip, Choice, Danger, InlineText, Section, Toolbar, fmtWhen, matches, todayLocal, type Tone,
} from "./common";
import "./outreach.css";

/* ------------------------------------------------------------ pure helpers */

export const CHANNELS: readonly OutreachChannel[] = ["email", "linkedin"];
export const CHANNEL_LABEL: Record<OutreachChannel, string> = { email: "Email", linkedin: "LinkedIn" };

/** Search covers who, where, what was sent, and the note. */
export function filterOutreach(rows: readonly Row[], q: string): Row[] {
  return rows.filter((o) => matches(q, o.name, o.company, o.what, o.note));
}

/** Open threads in the order to work them: follow-up due first, then the
 *  ones two touches in with nothing back, then the ones still inside the
 *  window. Inside each, the longest since his last message first. */
export function orderOpen(rows: readonly Row[], now: Date): Row[] {
  const rank = (o: Row) => {
    const a = outreachAction(o, now);
    return a.kind === "followup" ? 0 : a.dead ? 1 : 2;
  };
  return [...rows].sort((a, b) =>
    rank(a) - rank(b) || lastTouch(a).localeCompare(lastTouch(b)) || a.name.localeCompare(b.name));
}

export interface Group { status: OutreachStatus; label: string; rows: Row[] }

/** Sent, replied, no reply, in that order; empty groups left out, and no
 *  reply left out unless asked for. Replied and closed ones newest first. */
export function outreachGroups(rows: readonly Row[], now: Date, showClosed: boolean): Group[] {
  const by = new Map<OutreachStatus, Row[]>(OUTREACH_STATUSES.map((s) => [s, []]));
  for (const o of rows) (by.get(o.status) ?? by.get("sent"))?.push(o);
  const newest = (xs: Row[]) => [...xs].sort((a, b) => lastTouch(b).localeCompare(lastTouch(a)) || a.name.localeCompare(b.name));
  return OUTREACH_STATUSES
    .filter((s) => showClosed || s !== "no_reply")
    .map((s) => ({ status: s, label: OUTREACH_LABEL[s], rows: s === "sent" ? orderOpen(by.get(s) ?? [], now) : newest(by.get(s) ?? []) }))
    .filter((g) => g.rows.length > 0);
}

export interface Counts {
  /** Threads opened, whatever happened since. */
  total: number;
  /** First messages in the last seven local days, today included. */
  week: number;
  replied: number;
  /** Follow-ups due now. */
  due: number;
}

export function outreachCounts(rows: readonly Row[], now: Date): Counts {
  const c: Counts = { total: 0, week: 0, replied: 0, due: 0 };
  for (const o of rows) {
    c.total++;
    const d = daysSince(o.sent, now);
    if (d !== null && d >= 0 && d < 7) c.week++;
    if (o.status === "replied") c.replied++;
    if (outreachAction(o, now).kind === "followup") c.due++;
  }
  return c;
}

/** "7 sent, 2 this week. 3 replied." The reply count is the one that says
 *  whether the messages are any good. */
export function summaryLine(c: Counts): string {
  const sent = `${c.total} sent${c.week ? `, ${c.week} this week` : ""}.`;
  return c.total ? `${sent} ${c.replied} replied.` : sent;
}

/** The full entity "Log a message" adds. No date means it went today. */
export function newOutreach(values: Record<string, string | null>, id: string, now: Date): Row {
  return {
    id, name: (values.name ?? "").trim(), company: values.company ?? null,
    channel: values.channel === "linkedin" ? "linkedin" : "email",
    what: values.what ?? "", sent: values.sent ?? todayLocal(now), followedUp: null, status: "sent", note: null,
  };
}

/** The clock column for one open thread: the day the follow-up falls due
 *  while there is one ahead, else what nextAction says (follow up; sent, their
 *  move; mark dead). Nothing for a closed or answered thread. */
export function nextText(o: Row, now: Date): { text: string; why: string | null; due: boolean } | null {
  if (o.status !== "sent") return null;
  const a = outreachAction(o, now);
  const day = followUpDue(o);
  if (a.kind === "wait" && day) return { text: `Follow up ${fmtDeadline({ deadline: day })}`, why: null, due: false };
  return { text: a.label, why: a.why, due: a.kind === "followup" || !!a.dead };
}

/* ------------------------------------------------------------- the view */

const STATUS_TONE: Record<OutreachStatus, Tone> = { sent: "p2", replied: "go", no_reply: "dim" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Outreach({ api, now }: { api: LedgerApi; now: Date }) {
  const all = api.ledger.outreach;
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const counts = useMemo(() => outreachCounts(all, now), [all, now]);
  const groups = useMemo(() => outreachGroups(filterOutreach(all, q), now, showClosed), [all, q, now, showClosed]);
  const closed = all.filter((o) => o.status === "no_reply").length;

  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const add = (values: Record<string, string | null>) => {
    const row = newOutreach(values, newId("out", now), now);
    if (!row.name) return;
    api.edit({ kind: "outreach", target: row.id, op: "add", fields: { ...row } });
  };

  return (
    <div className="ou">
      <Toolbar query={q} onQuery={setQ} placeholder="Search people, companies, subjects">
        <label className="ou-toggle">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show no reply{closed ? ` (${closed})` : ""}
        </label>
      </Toolbar>

      {all.length > 0 && <p className="lg-card-sub ou-summary">{summaryLine(counts)}</p>}

      <div className="ou-add">
        <AddForm label="Log a message you sent" onAdd={add} fields={[
          { name: "name", placeholder: "Who" },
          { name: "company", placeholder: "Company" },
          { name: "channel", placeholder: "Channel", options: CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })) },
          { name: "what", placeholder: "Subject, or the first line" },
          { name: "sent", placeholder: "Sent on (blank = today)", type: "date" },
        ]} />
      </div>

      {all.length === 0 ? (
        <p className="lg-empty">
          Nothing logged. When a message goes out - email or LinkedIn - log it here, and this
          page tells you the day the one follow-up is due.
        </p>
      ) : groups.length === 0 ? (
        <p className="lg-empty">Nothing matches{q.trim() ? ` "${q.trim()}"` : ""}{showClosed ? "" : " among open and answered threads"}.</p>
      ) : groups.map((g) => (
        <Section key={g.status} title={g.label} count={g.rows.length}
          aside={g.status === "sent" && counts.due > 0 ? <span className="sm ou-due-n">{plural(counts.due, "follow-up", "follow-ups")} due</span> : undefined}>
          <ColumnHeads />
          <ul className="ou-rows">
            {g.rows.map((o) => (
              <ThreadRow key={o.id} o={o} api={api} now={now} open={open.has(o.id)} toggle={() => toggle(o.id)} />
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

/** Column names, shown only where the rows are wide enough to have columns. */
function ColumnHeads() {
  return (
    <div className="ou-cols" aria-hidden="true">
      <span>Who</span><span>What went</span><span>Sent</span><span>Next</span><span />
    </div>
  );
}

function ThreadRow({ o, api, now, open, toggle }: {
  o: Row; api: LedgerApi; now: Date; open: boolean; toggle: () => void;
}) {
  const set = (fields: Partial<Row>) => api.edit({ kind: "outreach", target: o.id, op: "set", fields });
  const next = nextText(o, now);
  const action = outreachAction(o, now);
  const who = o.name || "this thread";
  return (
    <li className={`ou-row${open ? " ou-row-open" : ""}${next?.due ? " ou-due" : ""}`}>
      <button type="button" className="ou-row-main" aria-expanded={open} onClick={toggle}>
        <span className="ou-who">
          <span className="ou-name">{o.name || "No name"}</span>
          {o.company && <span className="ou-co"> · {o.company}</span>}
        </span>
        <span className="ou-what">
          <span className="ou-ch">{CHANNEL_LABEL[o.channel]}</span>{o.what && <> · {o.what}</>}
        </span>
        <span className="ou-sent">
          Sent {fmtWhen(o.sent)}{o.followedUp && <>, followed up {fmtWhen(o.followedUp)}</>}
        </span>
        <span className="ou-next" title={next?.why ?? undefined}>{next?.text ?? ""}</span>
        <Chip tone={STATUS_TONE[o.status]}>{OUTREACH_LABEL[o.status]}</Chip>
      </button>
      {o.status === "sent" && (
        <div className="ou-acts">
          {!o.followedUp && (
            <button type="button" className={`lg-btn lg-act${action.kind === "followup" ? "" : " lg-btn-quiet"}`}
              aria-label={`Followed up with ${who}`} onClick={() => set({ followedUp: todayLocal(now) })}>
              Followed up
            </button>
          )}
          <button type="button" className="lg-btn lg-btn-quiet lg-act" aria-label={`${who} replied`}
            onClick={() => set({ status: "replied" })}>Replied</button>
          <button type="button" className={`lg-btn lg-act${action.dead ? "" : " lg-btn-quiet"}`}
            aria-label={`No reply from ${who}`} onClick={() => set({ status: "no_reply" })}>No reply</button>
        </div>
      )}
      {open && (
        <div className="ou-detail">
          {next?.why && <p className="ou-why sm dim">{next.why}</p>}
          <div className="ou-controls">
            <label className="ou-field">Status
              <Choice value={o.status} options={OUTREACH_STATUSES} labels={OUTREACH_LABEL}
                label={`Status, ${who}`} onChange={(s) => set({ status: s })} />
            </label>
            <label className="ou-field">Channel
              <Choice value={o.channel} options={CHANNELS} labels={CHANNEL_LABEL}
                label={`Channel, ${who}`} onChange={(c) => set({ channel: c })} />
            </label>
            {o.followedUp && (
              <span className="ou-field">Followed up {fmtWhen(o.followedUp)}
                <button type="button" className="lg-btn lg-btn-quiet lg-act" aria-label={`Undo the follow-up on ${who}`}
                  onClick={() => set({ followedUp: null })}>Undo</button>
              </span>
            )}
          </div>
          <div className="ou-text">
            <InlineText value={o.what || null} placeholder="Subject, or the first line" label={`What went to ${who}`}
              onSave={(v) => set({ what: v ?? "" })} />
          </div>
          <div className="ou-note">
            <InlineText value={o.note} placeholder="Add a note" multiline label={`Note, ${who}`}
              onSave={(v) => set({ note: v })} />
          </div>
          <div className="ou-detail-acts">
            <Danger label="Remove" aria={`Remove the thread with ${who}`}
              onConfirm={() => api.edit({ kind: "outreach", target: o.id, op: "delete" })} />
          </div>
        </div>
      )}
    </li>
  );
}
