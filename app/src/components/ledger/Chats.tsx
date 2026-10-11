/* The Chats view: coffee chats and interviews, each with its prep. Upcoming
   ones first, soonest at the top; done and cancelled stay hidden until asked
   for. A new chat starts with a prep checklist for its type, so the questions
   to ask and the stories to tell are written down before the call, not
   remembered during it. Every change is one api.edit. */
import { useMemo, useState } from "react";
import type { Chat, ChatStatus, ChatType, LedgerApi } from "../../ledger/types";
import { newId } from "../../ledger/apply";
import { AddForm, Chip, Choice, InlineText, Section, Toolbar, fmtWhen, hrefOf, matches, todayLocal } from "./common";
import "./chats.css";

/* ------------------------------------------------------------ pure helpers */

export const CHAT_TYPE_LABEL: Record<ChatType, string> = { coffee: "Coffee chat", interview: "Interview" };

export const CHAT_STATUS_ORDER: readonly ChatStatus[] = ["upcoming", "done", "cancelled"];

export const CHAT_STATUS_LABEL: Record<ChatStatus, string> = {
  upcoming: "Upcoming", done: "Done", cancelled: "Cancelled",
};

/** The checklist a new chat starts with. Edited per chat afterwards. */
export const PREP: Record<ChatType, string> = {
  coffee: [
    "Before",
    "- Read what they work on (GitHub, blog, a talk) and pick one specific thing to mention",
    "- 30-second intro: year and program, last internship, one project that fits their team",
    "Questions (pick 2 or 3)",
    "- What kind of projects do interns usually get to work on?",
    "- What does a strong intern do in their first month?",
    "- Any suggestions on what to brush up on before the interview?",
    "- How did you end up on this team?",
    "Close",
    "- Is there anyone else you'd suggest I talk to?",
    "After",
    "- Thank-you note within 24 hours that mentions one thing they said",
  ].join("\n"),
  interview: [
    "Logistics",
    "- Link or room, who is interviewing, how long. Test audio and camera 10 minutes before",
    "The role",
    "- What the team builds, the stack in the posting, why you want it in one sentence",
    "Stories (situation, what you did, result)",
    "- A bug you chased down",
    "- A project you shipped end to end",
    "- A disagreement and how it resolved",
    "- A mistake and what you changed after",
    "Technical",
    "- Refresh the stack the posting names; one practice problem a day until then",
    "Questions to ask them",
    "- What would my first project be?",
    "- How do you tell a great intern from a good one at the end of the term?",
    "After",
    "- Thank-you note the same day",
  ].join("\n"),
};

/** "2026-10-12 11:00", "2026-10-12T11:00" or a bare "2026-10-12" as a local
 *  Date. A bare date is midnight. Anything else is null. */
export function parseWhen(when: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec((when ?? "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

const hasTime = (when: string | null) => /[ T]\d{1,2}:\d{2}$/.test((when ?? "").trim());

/** Calendar days from now's date to d's date: 0 today, 1 tomorrow, -1 yesterday. */
export function daysAway(d: Date, now: Date): number {
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

/** "today", "tomorrow", "in 3 days", "yesterday", "4 days ago". */
export function relativeDay(d: Date, now: Date): string {
  const n = daysAway(d, now);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "Mon Oct 12, 11:00am", or "Mon Oct 12" with no time. The raw text if it
 *  does not parse, "Not booked yet" when empty. */
export function fmtSlot(when: string | null): string {
  if (!(when ?? "").trim()) return "Not booked yet";
  const d = parseWhen(when);
  if (!d) return when ?? "";
  const day = fmtWhen(todayLocal(d));
  if (!hasTime(when)) return day;
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
  return `${day}, ${h % 12 || 12}:${m}${h < 12 ? "am" : "pm"}`;
}

/** An upcoming chat whose start has gone by: it needs marking done (or
 *  cancelled) and its notes written. A bare date counts once the day is over. */
export function isOverdue(c: Chat, now: Date): boolean {
  if (c.status !== "upcoming") return false;
  const d = parseWhen(c.when);
  if (!d) return false;
  return hasTime(c.when) ? d.getTime() < now.getTime() : daysAway(d, now) < 0;
}

/** Chats whose company, who, prep or notes contain the query (all when blank). */
export function filterChats(items: readonly Chat[], q: string): Chat[] {
  return items.filter((c) => matches(q, c.company, c.who, c.prep, c.notes));
}

export interface Lane { status: ChatStatus; label: string; items: Chat[] }

const whenKey = (c: Chat) => parseWhen(c.when)?.getTime() ?? Number.MAX_SAFE_INTEGER;

/** Upcoming soonest first with unbooked ones last; done and cancelled most
 *  recent first, and left out unless showPast. An unknown status is filed
 *  under Upcoming rather than vanishing. */
export function chatLanes(items: readonly Chat[], showPast: boolean): Lane[] {
  const by = new Map<ChatStatus, Chat[]>(CHAT_STATUS_ORDER.map((s) => [s, []]));
  for (const c of items) (by.get(c.status) ?? by.get("upcoming"))?.push(c);
  return CHAT_STATUS_ORDER
    .filter((s) => showPast || s === "upcoming")
    .map((s) => {
      const lane = [...(by.get(s) ?? [])];
      lane.sort((a, b) => {
        const d = s === "upcoming" ? whenKey(a) - whenKey(b) : whenKey(b) - whenKey(a);
        return d || a.company.localeCompare(b.company);
      });
      return { status: s, label: CHAT_STATUS_LABEL[s], items: lane };
    });
}

/** The full entity an "add" carries. A datetime-local "T" becomes a space,
 *  and prep starts as the checklist for the type. */
export function newChat(values: Record<string, string | null>, type: ChatType, id: string, now: Date): Chat {
  const when = (values.when ?? "").trim().replace("T", " ");
  return {
    id, type, company: (values.company ?? "").trim(), who: values.who ?? null, when: when || null,
    where: values.where ?? null, status: "upcoming", prep: PREP[type], notes: null, added: todayLocal(now),
  };
}

/* ------------------------------------------------------------- the view */

export function Chats({ api, now }: { api: LedgerApi; now: Date }) {
  const [q, setQ] = useState("");
  const [showPast, setShowPast] = useState(false);
  const all = api.ledger.chats;

  const lanes = useMemo(() => chatLanes(filterChats(all, q), showPast), [all, q, showPast]);
  const shown = lanes.reduce((n, l) => n + l.items.length, 0);
  const past = all.filter((c) => c.status !== "upcoming").length;

  const set = (id: string, fields: Partial<Chat>) => api.edit({ kind: "chat", target: id, op: "set", fields });
  const remove = (c: Chat) => {
    if (window.confirm(`Remove the ${CHAT_TYPE_LABEL[c.type].toLowerCase()} with ${c.who || c.company}? This cannot be undone.`)) {
      api.edit({ kind: "chat", target: c.id, op: "delete" });
    }
  };
  const add = (type: ChatType) => (values: Record<string, string | null>) => {
    const c = newChat(values, type, newId("chat", now), now);
    if (!c.company) return;
    api.edit({ kind: "chat", target: c.id, op: "add", fields: { ...c } });
  };
  const fields = (who: string) => [
    { name: "company", placeholder: "Company" },
    { name: "who", placeholder: who },
    { name: "when", placeholder: "When", type: "datetime-local" as const },
    { name: "where", placeholder: "Meet or Teams link, or a place" },
  ];

  return (
    <div className="ch-view">
      <Toolbar query={q} onQuery={setQ} placeholder="Search companies, people, prep and notes">
        <label className="ch-toggle">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          Show done and cancelled{past ? ` (${past})` : ""}
        </label>
      </Toolbar>

      <div className="ch-adds">
        <AddForm label="Add a coffee chat" onAdd={add("coffee")} fields={fields("Who (name)")} />
        <AddForm label="Add an interview" onAdd={add("interview")} fields={fields("Interviewers")} />
      </div>

      {all.length === 0 ? (
        <p className="lg-empty">Coffee chats and interviews, with the prep for each. Add one when a time is booked.</p>
      ) : shown === 0 && q.trim() ? (
        <p className="lg-empty">Nothing matches "{q.trim()}"{showPast ? "" : " in upcoming"}.</p>
      ) : (
        lanes.map((lane) => (
          <Section key={lane.status} title={lane.label} count={lane.items.length}>
            {lane.items.length === 0 ? (
              <p className="lg-card-sub ch-lane-empty">Nothing booked.</p>
            ) : lane.items.map((c) => (
              <Card key={c.id} chat={c} now={now} set={set} remove={remove} />
            ))}
          </Section>
        ))
      )}
    </div>
  );
}

function Card({ chat: c, now, set, remove }: {
  chat: Chat; now: Date;
  set: (id: string, fields: Partial<Chat>) => void;
  remove: (c: Chat) => void;
}) {
  const d = parseWhen(c.when);
  const overdue = isOverdue(c, now);
  const soon = c.status === "upcoming" && d != null && !overdue && daysAway(d, now) <= 1;
  const href = hrefOf(c.where);
  const label = c.who ? `${c.who} (${c.company})` : c.company;
  return (
    <article className={`lg-card ch-card ch-${c.status}${overdue ? " ch-overdue" : ""}`}>
      <div className="ch-head">
        <Chip tone={c.type === "interview" ? "p2" : "go"}>{CHAT_TYPE_LABEL[c.type]}</Chip>
        <h3 className="lg-card-title ch-title">{c.company}</h3>
        {c.who && <span className="lg-card-sub ch-who">with {c.who}</span>}
      </div>

      <div className="ch-when">
        <span className="ch-when-text">{fmtSlot(c.when)}</span>
        {d && c.status === "upcoming" && (
          <Chip tone={overdue ? "warn" : soon ? "go" : "dim"}>
            {overdue ? "Passed: mark it done and write notes" : relativeDay(d, now)}
          </Chip>
        )}
      </div>
      <div className="ch-field">
        <InlineText value={c.when} placeholder="Set a time: 2026-10-12 11:00"
          label={`Time of the chat with ${label}`} onSave={(v) => set(c.id, { when: v ? v.replace("T", " ") : null })} />
      </div>
      <div className="ch-field ch-where">
        {href && <a className="ch-join" href={href} target="_blank" rel="noopener noreferrer">Join</a>}
        <InlineText value={c.where} placeholder="Add a Meet or Teams link, or a place"
          label={`Where the chat with ${label} is`} onSave={(v) => set(c.id, { where: v })} />
      </div>

      <div className="ch-block">
        <div className="ch-block-label">Prep</div>
        <InlineText value={c.prep} placeholder="Add prep: what to read, questions to ask, stories to tell"
          multiline rows={12} label={`Prep for ${label}`} onSave={(v) => set(c.id, { prep: v })} />
      </div>
      <div className="ch-block">
        <div className="ch-block-label">Notes</div>
        <InlineText value={c.notes} placeholder="After: what you learned, what to follow up on"
          multiline rows={5} label={`Notes from ${label}`} onSave={(v) => set(c.id, { notes: v })} />
      </div>

      <div className="lg-card-row ch-actions">
        <Choice value={c.status} options={CHAT_STATUS_ORDER} labels={CHAT_STATUS_LABEL}
          label={`Status of the chat with ${label}`} onChange={(s) => set(c.id, { status: s })} />
        {c.status === "upcoming" && (
          <button type="button" className="lg-btn" onClick={() => set(c.id, { status: "done" })}>Done</button>
        )}
        <button type="button" className="lg-btn lg-btn-quiet ch-remove"
          aria-label={`Remove the chat with ${label}`} onClick={() => remove(c)}>Remove</button>
      </div>
    </article>
  );
}
