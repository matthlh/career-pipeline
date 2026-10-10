import { useMemo, useState, type ReactNode } from "react";
import { newId } from "../../ledger/apply";
import {
  DEAD, QUIET_DAYS, STATUS_LABEL, STATUS_ORDER, deadlineOf, fmtDeadline, groupApplications, nextStep,
  type AppGroup,
} from "../../ledger/rules";
import {
  TILES, TILE_LABEL, TODO_DAYS, followUps, funnel, heldByCompany, isHeld, sortSaved, todoLanes,
  type Tile, type Todo, type TodoItem, type TodoKind,
} from "../../ledger/todo";
import type { AppEvent, AppStatus, Application, LedgerApi, Outreach, Referral } from "../../ledger/types";
import { FOLLOWUP_DAYS, daysSince } from "../../rules";
import {
  AddForm, Chip, Choice, Danger, InlineText, Section, Toolbar, fmtWhen, matches, todayLocal, type Tone,
} from "./common";
import "./applications.css";

/* The applications view, and the screen he opens most. Three questions, in
   the order he asks them: how many have gone in (the sent line and the
   tiles), what do I do next (the to-do lanes), and where does everything
   stand (the list, one row each, tap for the controls). On a phone the three
   stack; on a laptop the first two sit beside the list. */

/* ---------------------------------------------- pure helpers (tested) -- */

export type TermFilter = "all" | "W27" | "S27" | "other";
export const TERMS: readonly TermFilter[] = ["all", "W27", "S27", "other"];

export interface AppFilter { q: string; term: TermFilter; showClosed: boolean }

/** Search covers company, title and note. Rejected, withdrawn and closed stay
 *  out unless asked for; "other" is any term that is not W27 or S27, null included. */
export function filterApps(apps: readonly Application[], f: AppFilter): Application[] {
  return apps.filter((a) => {
    if (!f.showClosed && DEAD.includes(a.status)) return false;
    if (f.term === "other" && (a.term === "W27" || a.term === "S27")) return false;
    if (f.term !== "all" && f.term !== "other" && a.term !== f.term) return false;
    return matches(f.q, a.company, a.title, a.note);
  });
}

export type ListKey = "offer" | "interview" | "applied" | "saved" | "held" | "closed";
export interface ListGroup { key: ListKey; label: string; apps: Application[] }

/** groupApplications' groups with "saved" split in two: what he applies to
 *  himself, and what waits on a referral. The second would otherwise be ten
 *  times the size of the first and bury it. */
export function splitHeld(groups: readonly AppGroup[]): ListGroup[] {
  const out: ListGroup[] = [];
  for (const g of groups) {
    if (g.key !== "saved") { out.push({ key: g.key, label: g.label, apps: g.apps }); continue; }
    const mine = g.apps.filter((a) => !isHeld(a)), held = g.apps.filter(isHeld);
    if (mine.length) out.push({ key: "saved", label: "To apply", apps: mine });
    if (held.length) out.push({ key: "held", label: "Held for referral", apps: held });
  }
  return out;
}

/** "saved" is only offered while it is the current status: an event cannot move
 *  an application back to saved (apply.ts and mark_app both refuse it). */
export function statusOptions(current: AppStatus): readonly AppStatus[] {
  return current === "saved" ? STATUS_ORDER : STATUS_ORDER.filter((s) => s !== "saved");
}

/** Newest first; an unparseable `at` sorts last; equal times keep the later-added first. */
export function historyNewestFirst(events: readonly AppEvent[]): AppEvent[] {
  const t = (at: string) => { const n = Date.parse(at); return Number.isNaN(n) ? -Infinity : n; };
  return events
    .map((e, i) => ({ e, i, t: t(e.at) }))
    .sort((x, y) => (y.t === x.t ? y.i - x.i : y.t > x.t ? 1 : -1))
    .map((x) => x.e);
}

/** The one date a row shows: when it closes while it is still to apply to,
 *  when it went in once it has. */
export function whenLabel(a: Application, now: Date): { text: string; late: boolean } {
  if (a.status === "saved") {
    const d = deadlineOf(a);
    if (!d) return { text: "Rolling", late: false };
    return d < now ? { text: "Passed " + fmtDeadline(a), late: true } : { text: "Due " + fmtDeadline(a), late: false };
  }
  return { text: a.submitted ? "Sent " + fmtWhen(a.submitted) : "", late: false };
}

/** An href that is safe to open: http(s) as is, a bare domain path gets https://,
 *  anything else (javascript:, prose) is null and shown as text instead. */
export function safeUrl(link: string | null): string | null {
  const s = (link ?? "").trim();
  if (/^https?:\/\/\S+$/i.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return "https://" + s;
  return null;
}

/** The full new entity the "Add application" form records. */
export function newApplication(id: string, v: Record<string, string | null>): Application {
  return {
    id, company: v.company ?? "", title: v.title ?? "", status: "saved", via: null, term: null,
    deadline: v.deadline ?? null, submitted: null, link: v.link ?? null, where: null,
    referral: "none", referrer: null, hold: null, note: null, events: [],
  };
}

/* ------------------------------------------------------------- view -- */

const SAVED_LIMIT = 20;
const TERM_LABEL: Record<TermFilter, string> = { all: "All terms", W27: "W27", S27: "S27", other: "Other term" };
const REFERRALS: readonly Referral[] = ["none", "want", "asked", "referred"];
const REFERRAL_LABEL: Record<Referral, string> = {
  none: "None", want: "Want one", asked: "Asked", referred: "Referred",
};
const REFERRAL_CHIP: Partial<Record<Referral, [Tone, string]>> = {
  want: ["warn", "Wants a referral"], asked: ["p2", "Referral asked"], referred: ["go", "Referred"],
};
const STATUS_TONE: Record<AppStatus, Tone> = {
  offer: "go", interview: "go", applied: "p2", saved: "warn", rejected: "red", withdrawn: "dim", closed: "dim",
};
const KIND_LABEL: Record<TodoKind, string> = {
  offer: "Offer", interview: "Interview", apply: "Apply", referral: "Referral",
  rolling: "Apply", nudge: "Nudge", expired: "Passed",
};
const eventLabel = (s: string) =>
  (STATUS_LABEL as Record<string, string>)[s] ?? (s === "note" ? "Note" : s);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Props = { api: LedgerApi; now: Date };

export function Applications({ api, now }: Props) {
  const apps = api.ledger.applications;
  const [q, setQ] = useState("");
  const [term, setTerm] = useState<TermFilter>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [tile, setTile] = useState<Tile | null>(null);
  const [allSaved, setAllSaved] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const counts = useMemo(() => funnel(apps), [apps]);
  const todo = useMemo(() => todoLanes(apps, now), [apps, now]);
  const due = useMemo(() => followUps(api.ledger.outreach, now), [api.ledger.outreach, now]);

  /* A tile is a filter: tap Applied and only the applied rows stay. Closed is
     hidden by default, so its tile also turns it on. */
  const closedOn = showClosed || tile === "closed";
  const groups = useMemo(() => {
    const gs = splitHeld(groupApplications(filterApps(apps, { q, term, showClosed: closedOn })));
    return tile ? gs.filter((g) => g.key === tile) : gs;
  }, [apps, q, term, closedOn, tile]);
  const searching = q.trim() !== "";

  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const add = (v: Record<string, string | null>) => {
    const id = newId("app");
    api.edit({ kind: "application", target: id, op: "add", fields: { ...newApplication(id, v) } });
  };
  const clear = () => { setQ(""); setTerm("all"); setShowClosed(false); setTile(null); };

  return (
    <div className="ap">
      <aside className="ap-side">
        <div className="ap-tiles" role="group" aria-label="Where everything stands">
          {TILES.map((t) => (
            <button key={t} type="button" className={`ap-tile ap-tile-${t}${tile === t ? " on" : ""}`}
              aria-pressed={tile === t} onClick={() => setTile(tile === t ? null : t)}>
              <span className="ap-tile-n">{counts[t]}</span>
              <span className="ap-tile-l">{TILE_LABEL[t]}</span>
            </button>
          ))}
        </div>
        <TodoPanel todo={todo} due={due} api={api} now={now} />
      </aside>

      <div className="ap-main">
        <Toolbar query={q} onQuery={setQ} placeholder="Search company, title, note">
          <Choice value={term} options={TERMS} labels={TERM_LABEL} label="Term" onChange={setTerm} />
          <Toggle on={showClosed} set={setShowClosed}>Show closed</Toggle>
        </Toolbar>

        <div className="ap-add">
          <AddForm label="Add application" onAdd={add} fields={[
            { name: "company", placeholder: "Company" },
            { name: "title", placeholder: "Role title" },
            { name: "link", placeholder: "Posting link", type: "url" },
            { name: "deadline", placeholder: "Deadline", type: "date" },
          ]} />
        </div>

        {tile && (
          <div className="ap-focus sm dim" role="status">
            Showing <b>{TILE_LABEL[tile]}</b> only.{" "}
            <button type="button" className="lg-btn lg-btn-quiet lg-act" onClick={() => setTile(null)}>Show everything</button>
          </div>
        )}

        {groups.length === 0 ? (
          <div className="lg-empty">
            {apps.length === 0 ? "No applications yet. Add the first one above." : (
              <>Nothing matches.{" "}
                <button type="button" className="lg-btn lg-btn-quiet lg-act" onClick={clear}>Clear filters</button></>
            )}
          </div>
        ) : groups.map((g) => {
          if (g.key === "held") {
            return <HeldSection key={g.key} apps={g.apps} api={api} now={now} open={open} toggle={toggle} />;
          }
          const list = g.key === "saved" ? sortSaved(g.apps, now) : g.apps;
          const long = g.key === "saved" && !searching && list.length > SAVED_LIMIT;
          const shown = long && !allSaved ? list.slice(0, SAVED_LIMIT) : list;
          return (
            <Section key={g.key} title={g.label} count={list.length}>
              <ColumnHeads />
              <ul className="ap-rows">
                {shown.map((a) => (
                  <AppRow key={a.id} a={a} api={api} now={now} open={open.has(a.id)} toggle={() => toggle(a.id)} />
                ))}
              </ul>
              {long && (
                <button type="button" className="lg-btn lg-btn-quiet ap-more" aria-expanded={allSaved}
                  onClick={() => setAllSaved(!allSaved)}>
                  {allSaved ? `Show the first ${SAVED_LIMIT}` : `Show all ${list.length}`}
                </button>
              )}
            </Section>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ do next -- */

function TodoPanel({ todo, due, api, now }: { todo: Todo; due: Outreach[]; api: LedgerApi; now: Date }) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + TODO_DAYS);
  const quiet = todo.now.length === 0;
  return (
    <section className="lg-section ap-todo-sec" aria-label="Do next">
      <header className="lg-section-head">
        <h2>Do next{!quiet && <span className="lg-count">{todo.now.length}</span>}</h2>
        <span className="sm dim">next {TODO_DAYS} days</span>
      </header>
      {quiet ? (
        <div className="lg-empty ap-todo-empty">Nothing closes before {fmtDeadline({ deadline: todayLocal(end) })}.</div>
      ) : (
        <ul className="ap-todo">
          {todo.now.map((it) => <TodoRow key={it.apps[0]!.id} item={it} api={api} now={now} />)}
        </ul>
      )}
      {todo.later > 0 && (
        <p className="ap-todo-later sm dim">{plural(todo.later, "more posting closes", "more postings close")} after that.</p>
      )}
      {/* Open by default: day 7 is a day, not a week, and this is the one lane
          that is about a person rather than a posting. */}
      <Lane title="Follow up today" count={due.length} open
        hint={`Day ${FOLLOWUP_DAYS}, nothing back. One follow-up each, never two, and it has to say something new.`}>
        {due.map((o) => <FollowUpRow key={o.id} o={o} api={api} now={now} />)}
      </Lane>
      <Lane title="Rolling, no deadline" count={todo.rolling.length}
        hint="Apply when there is a slot. Nothing here expires, and nothing here nags.">
        {todo.rolling.map((it) => <TodoRow key={it.apps[0]!.id} item={it} api={api} now={now} />)}
      </Lane>
      <Lane title={`Quiet ${QUIET_DAYS}+ days`} count={todo.nudge.length}
        hint="No word since it went in. One nudge each, never two.">
        {todo.nudge.map((it) => <TodoRow key={it.apps[0]!.id} item={it} api={api} now={now} />)}
      </Lane>
      <Lane title="Deadline passed" count={todo.expired.length}
        hint="Still marked to apply. Mark the ones that went in, close the rest.">
        {todo.expired.map((it) => <TodoRow key={it.apps[0]!.id} item={it} api={api} now={now} />)}
      </Lane>
    </section>
  );
}

function Lane({ title, hint, count, open, children }: {
  title: string; hint: string; count: number; open?: boolean; children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="ap-lane" open={open}>
      <summary><span className="ap-lane-title">{title}</span><span className="lg-count">{count}</span></summary>
      <p className="ap-lane-hint sm dim">{hint}</p>
      <ul className="ap-todo">{children}</ul>
    </details>
  );
}

/** One thread whose follow-up is due. The two clicks that end its stay here:
 *  the follow-up went, or they wrote back. Everything else is on Outreach. */
function FollowUpRow({ o, api, now }: { o: Outreach; api: LedgerApi; now: Date }) {
  const set = (fields: Partial<Outreach>) => api.edit({ kind: "outreach", target: o.id, op: "set", fields });
  const days = daysSince(o.sent, now);
  return (
    <li className="ap-todo-row ap-todo-followup">
      <span className="ap-todo-kind">Follow up</span>
      <div className="ap-todo-body">
        <span className="ap-todo-co">{o.name}{o.company && <span className="dim"> · {o.company}</span>}</span>
        <span className="ap-todo-title">{o.what}</span>
        <div className="ap-todo-note dim">
          Sent {fmtWhen(o.sent)}{days !== null && `, ${plural(days, "day", "days")} with no word.`}
        </div>
      </div>
      <div className="ap-todo-acts">
        <button type="button" className="lg-btn lg-act" aria-label={`Followed up with ${o.name}`}
          onClick={() => set({ followedUp: todayLocal(now) })}>Followed up</button>
        <button type="button" className="lg-btn lg-btn-quiet lg-act" aria-label={`${o.name} replied`}
          onClick={() => set({ status: "replied" })}>Replied</button>
      </div>
    </li>
  );
}

/** The deadline a to-do shows, formatted from the application that carries it
 *  (so a bare date never grows a time). */
function dueText(item: TodoItem): string | null {
  if (!item.due) return null;
  const t = item.due.getTime();
  const a = item.apps.find((x) => deadlineOf(x)?.getTime() === t) ?? item.apps[0];
  return a ? fmtDeadline(a) : null;
}

function TodoRow({ item, api, now }: { item: TodoItem; api: LedgerApi; now: Date }) {
  const a = item.apps[0]!;
  const many = item.apps.length > 1;
  const href = safeUrl(a.link);
  const due = dueText(item);
  const kind = item.kind;
  const who = item.company || a.title || "this application";
  const event = (x: Application, status: string) =>
    api.edit({ kind: "application", target: x.id, op: "event", event: { status, note: "" } });
  const askable = kind === "referral" && item.apps.some((x) => x.referral !== "asked" && x.referral !== "referred");
  const days = kind === "nudge" && a.submitted ? daysSince(a.submitted.slice(0, 10), now) : null;

  return (
    <li className={`ap-todo-row ap-todo-${kind}`}>
      <span className="ap-todo-kind">{KIND_LABEL[kind]}</span>
      <div className="ap-todo-body">
        <span className="ap-todo-co">{item.company || "No company"}</span>
        {many ? (
          <details className="ap-todo-roles">
            <summary>{plural(item.apps.length, "role", "roles")}</summary>
            <ul>
              {item.apps.map((x) => {
                const h = safeUrl(x.link);
                return (
                  <li key={x.id}>
                    {h ? <a href={h} target="_blank" rel="noopener">{x.title || "Posting"}</a> : (x.title || "Posting")}
                    {x.deadline && <span className="dim"> · {fmtDeadline(x)}</span>}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : <span className="ap-todo-title">{a.title || "No title"}</span>}
        {item.note && (kind === "interview" || kind === "offer") && <div className="ap-todo-note">{item.note}</div>}
        {days !== null && a.submitted && (
          <div className="ap-todo-note dim">Sent {fmtWhen(a.submitted)}, {plural(days, "day", "days")} with no word.</div>
        )}
      </div>
      {due && <span className={`ap-todo-when${kind === "expired" ? " ap-late" : ""}`}>{due}</span>}
      <div className="ap-todo-acts">
        {!many && href && <a className="lg-btn lg-btn-quiet lg-act" href={href} target="_blank" rel="noopener">Open posting</a>}
        {(kind === "apply" || kind === "rolling" || kind === "expired") && !many && (
          <>
            <button type="button" className="lg-btn lg-act" aria-label={`Mark ${who} applied`}
              onClick={() => event(a, "applied")}>Applied</button>
            {kind === "expired"
              ? <Danger label="Close" aria={`Close ${who}`} onConfirm={() => event(a, "closed")} />
              : <Danger label="Skip" aria={`Skip ${who}`}
                  onConfirm={() => api.edit({ kind: "application", target: a.id, op: "delete" })} />}
          </>
        )}
        {kind === "referral" && (askable
          ? <button type="button" className="lg-btn lg-btn-quiet lg-act" aria-label={`Referral asked at ${who}`}
              onClick={() => item.apps.forEach((x) => api.edit({ kind: "application", target: x.id, op: "set", fields: { referral: "asked" } }))}>
              Mark asked
            </button>
          : <Chip tone="p2">Asked</Chip>)}
        {kind === "expired" && many && (
          <Danger label={`Close all ${item.apps.length}`} aria={`Close every ${who} posting`}
            onConfirm={() => item.apps.forEach((x) => event(x, "closed"))} />
        )}
        {kind === "nudge" && <Danger label="Close" aria={`Close ${who}`} onConfirm={() => event(a, "closed")} />}
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- list -- */

function Toggle({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" className={`lg-btn lg-btn-quiet ap-toggle${on ? " ap-toggle-on" : ""}`}
      aria-pressed={on} onClick={() => set(!on)}>{children}</button>
  );
}

/** Column names, shown only where the rows are wide enough to have columns. */
function ColumnHeads() {
  return (
    <div className="ap-cols" aria-hidden="true">
      <span>Company</span><span>Role</span><span>When</span><span>Next</span><span />
    </div>
  );
}

function HeldSection({ apps, api, now, open, toggle }: {
  apps: Application[]; api: LedgerApi; now: Date; open: ReadonlySet<string>; toggle: (id: string) => void;
}) {
  const groups = useMemo(() => heldByCompany(apps, now), [apps, now]);
  return (
    <Section title="Held for referral" count={apps.length}
      aside={<span className="sm dim">{plural(groups.length, "company", "companies")}</span>}>
      <p className="ap-held-hint sm dim">
        Parked until someone inside can refer. One ask per company covers every role.
      </p>
      {groups.map((h) => {
        const soonApp = h.soonest ? h.apps.find((x) => deadlineOf(x)?.getTime() === h.soonest!.getTime()) : undefined;
        const when = soonApp ? "closes " + fmtDeadline(soonApp)
          : h.passed === h.apps.length ? "all passed" : "no deadline";
        return (
          <details key={h.company} className="ap-held">
            <summary>
              <span className="ap-held-co">{h.company || "No company"}</span>
              <span className="ap-held-n">{plural(h.apps.length, "role", "roles")}</span>
              <span className={`ap-held-when${h.passed === h.apps.length ? " ap-late" : ""}`}>{when}</span>
            </summary>
            <ul className="ap-rows">
              {h.apps.map((a) => (
                <AppRow key={a.id} a={a} api={api} now={now} open={open.has(a.id)} toggle={() => toggle(a.id)} />
              ))}
            </ul>
          </details>
        );
      })}
    </Section>
  );
}

function AppRow({ a, api, now, open, toggle }: {
  a: Application; api: LedgerApi; now: Date; open: boolean; toggle: () => void;
}) {
  const step = nextStep(a, now);
  const when = whenLabel(a, now);
  return (
    <li className={`ap-row${open ? " ap-row-open" : ""}`}>
      <button type="button" className="ap-row-main" aria-expanded={open} onClick={toggle}>
        <span className="ap-co">{a.company || "No company"}</span>
        <span className="ap-role">{a.title || "No title"}</span>
        <span className={`ap-when${when.late ? " ap-late" : ""}`}>{when.text}</span>
        <span className={`ap-next${step === "Deadline passed" ? " ap-late" : ""}`}>{step ?? ""}</span>
        {isHeld(a)
          ? <Chip tone="dim">Held</Chip>
          : <Chip tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Chip>}
      </button>
      {open && <AppDetail a={a} api={api} />}
    </li>
  );
}

function AppDetail({ a, api }: { a: Application; api: LedgerApi }) {
  const set = (fields: Record<string, unknown>) =>
    api.edit({ kind: "application", target: a.id, op: "set", fields });
  const event = (status: string) =>
    api.edit({ kind: "application", target: a.id, op: "event", event: { status, note: "" } });
  const href = safeUrl(a.link);
  const ref = REFERRAL_CHIP[a.referral];
  const history = historyNewestFirst(a.events ?? []);
  const who = a.company || a.title || "this application";

  return (
    <div className="ap-detail">
      {(a.term || a.via || ref || a.hold === "referral") && (
        <div className="lg-card-row ap-chips">
          {a.term && <Chip tone="p2">{a.term}</Chip>}
          {a.via && <Chip>{a.via}</Chip>}
          {ref && <Chip tone={ref[0]}>{ref[1]}</Chip>}
          {a.hold === "referral" && <Chip tone="warn">Held for referral</Chip>}
        </div>
      )}
      <div className="ap-detail-acts">
        {href
          ? <a className="lg-btn lg-btn-quiet lg-act" href={href} target="_blank" rel="noopener">Open posting</a>
          : (a.where || a.link) && <span className="lg-card-sub ap-where">{a.where || a.link}</span>}
        {a.status === "saved" && (
          <>
            <button type="button" className="lg-btn lg-act" aria-label={`Mark ${who} applied`}
              onClick={() => event("applied")}>Applied</button>
            <Danger label="Skip" aria={`Skip ${who}`}
              onConfirm={() => api.edit({ kind: "application", target: a.id, op: "delete" })} />
          </>
        )}
        {a.status === "applied" && <Danger label="Close" aria={`Close ${who}`} onConfirm={() => event("closed")} />}
      </div>
      <div className="ap-controls">
        <label className="ap-field">Status
          <Choice value={a.status} options={statusOptions(a.status)} labels={STATUS_LABEL}
            label={`Status, ${who}`} onChange={(s) => event(s)} />
        </label>
        <label className="ap-field">Referral
          <Choice value={a.referral} options={REFERRALS} labels={REFERRAL_LABEL}
            label={`Referral, ${who}`} onChange={(r) => set({ referral: r })} />
        </label>
        <span className="ap-field">Referrer
          <InlineText value={a.referrer} placeholder="add a name" label={`Referrer, ${who}`}
            onSave={(v) => set({ referrer: v })} />
        </span>
      </div>
      <div className="ap-note">
        <InlineText value={a.note} placeholder="Add a note" multiline label={`Note, ${who}`}
          onSave={(v) => set({ note: v })} />
      </div>
      {history.length > 0 && (
        <details className="ap-history">
          <summary>History, {history.length}</summary>
          <ol>
            {history.map((e, i) => (
              <li key={i}>{fmtWhen(e.at)} · {eventLabel(e.status)}{e.note ? ` - ${e.note}` : ""}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
