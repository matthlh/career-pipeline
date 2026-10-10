/* The Learning view: tools, topics and skills to pick up, usually because
   postings keep asking for them. Four lanes - learning now, to learn, done,
   dropped - with the last two hidden until asked for, so the default screen
   is only what is still in play. Every change is one api.edit. */
import { useMemo, useState } from "react";
import type { LearnStatus, Learning as Item, LedgerApi } from "../../ledger/types";
import { newId } from "../../ledger/apply";
import { AddForm, Choice, InlineText, Section, Toolbar, matches, todayLocal } from "./common";
import "./learning.css";

/* ------------------------------------------------------------ pure helpers */

/** Lane order: what is in progress first, then the queue, then the closed ones. */
export const LEARN_ORDER: readonly LearnStatus[] = ["learning", "todo", "done", "dropped"];

export const LEARN_LABEL: Record<LearnStatus, string> = {
  learning: "Learning now",
  todo: "To learn",
  done: "Done",
  dropped: "Dropped",
};

const CLOSED: readonly LearnStatus[] = ["done", "dropped"];

export interface Lane { status: LearnStatus; label: string; items: Item[] }

/** Items whose topic, why or note contain the query (all of them when it is blank). */
export function filterLearning(items: readonly Item[], q: string): Item[] {
  return items.filter((i) => matches(q, i.topic, i.why, i.note));
}

/** The lanes in LEARN_ORDER, newest added first inside each (ties by topic).
 *  Done and dropped are left out unless showClosed. An unknown status falls
 *  into "To learn" rather than vanishing. */
export function learnLanes(items: readonly Item[], showClosed: boolean): Lane[] {
  const byStatus = new Map<LearnStatus, Item[]>(LEARN_ORDER.map((s) => [s, []]));
  for (const i of items) (byStatus.get(i.status) ?? byStatus.get("todo"))?.push(i);
  return LEARN_ORDER
    .filter((s) => showClosed || !CLOSED.includes(s))
    .map((s) => ({
      status: s,
      label: LEARN_LABEL[s],
      items: [...(byStatus.get(s) ?? [])].sort((a, b) =>
        a.added === b.added ? a.topic.localeCompare(b.topic) : a.added < b.added ? 1 : -1),
    }));
}

/** How many items sit in each status. */
export function learnCounts(items: readonly Item[]): Record<LearnStatus, number> {
  const c: Record<LearnStatus, number> = { learning: 0, todo: 0, done: 0, dropped: 0 };
  for (const i of items) if (i.status in c) c[i.status]++;
  return c;
}

/** "2 learning now, 5 to learn". */
export function summaryLine(c: Record<LearnStatus, number>): string {
  return `${c.learning} learning now, ${c.todo} to learn`;
}

/** The one-tap move a card offers: Start a queued item, finish one in progress. */
export function quickMove(status: LearnStatus): { label: string; to: LearnStatus } | null {
  if (status === "todo") return { label: "Start", to: "learning" };
  if (status === "learning") return { label: "Done", to: "done" };
  return null;
}

/** A safe href for a stored link: http(s) as given, a bare "docs.foo.dev/x"
 *  gets https://, any other scheme (javascript:, data:) gets no link at all. */
export function hrefOf(link: string | null): string | null {
  const s = (link ?? "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return "https://" + s;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 4" this year, "Oct 4, 2025" otherwise; the raw text if it is not a date. */
export function fmtAdded(added: string, now: Date): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(added ?? "");
  const mon = m ? MON[Number(m[2]) - 1] : undefined;
  if (!m || !mon) return added ?? "";
  const day = `${mon} ${Number(m[3])}`;
  return Number(m[1]) === now.getFullYear() ? day : `${day}, ${m[1]}`;
}

/** The full entity an "add" carries, from the add form's values. */
export function newLearning(values: Record<string, string | null>, id: string, now: Date): Item {
  return {
    id, topic: (values.topic ?? "").trim(), why: values.why ?? null, link: values.link ?? null,
    status: "todo", note: null, added: todayLocal(now),
  };
}

/* ------------------------------------------------------------- the view */

export function Learning({ api, now }: {
  api: LedgerApi; now: Date; onOpenCompany?: (companyId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const all = api.ledger.learning;

  const counts = useMemo(() => learnCounts(all), [all]);
  const lanes = useMemo(() => learnLanes(filterLearning(all, q), showClosed), [all, q, showClosed]);
  const shown = lanes.reduce((n, l) => n + l.items.length, 0);
  const closed = counts.done + counts.dropped;

  const set = (id: string, fields: Partial<Item>) =>
    api.edit({ kind: "learning", target: id, op: "set", fields });
  const remove = (i: Item) => {
    if (window.confirm(`Remove "${i.topic}"? This cannot be undone.`)) {
      api.edit({ kind: "learning", target: i.id, op: "delete" });
    }
  };
  const add = (values: Record<string, string | null>) => {
    const item = newLearning(values, newId("learn", now), now);
    if (!item.topic) return;
    api.edit({ kind: "learning", target: item.id, op: "add", fields: { ...item } });
  };

  return (
    <div className="le-view">
      <Toolbar query={q} onQuery={setQ} placeholder="Search topics, reasons and notes">
        <label className="le-toggle">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show done and dropped{closed ? ` (${closed})` : ""}
        </label>
      </Toolbar>

      {all.length > 0 && <p className="lg-card-sub le-summary">{summaryLine(counts)}</p>}

      <AddForm label="Add something to learn" onAdd={add} fields={[
        { name: "topic", placeholder: "Topic, tool or skill" },
        { name: "why", placeholder: "Why (e.g. 3 postings ask for Kubernetes)" },
        { name: "link", placeholder: "Link to a course or docs", type: "url" },
      ]} />

      {all.length === 0 ? (
        <p className="lg-empty">Tools and topics to learn. Add one when a posting asks for something you have not used.</p>
      ) : shown === 0 && q.trim() ? (
        <p className="lg-empty">Nothing matches "{q.trim()}"{showClosed ? "" : " in the open lanes"}.</p>
      ) : (
        <div className="le-lanes">
          {lanes.map((lane) => (
            <Section key={lane.status} title={lane.label} count={lane.items.length}>
              {lane.items.length === 0 ? (
                <p className="lg-card-sub le-lane-empty">
                  {lane.status === "learning" ? "Nothing in progress. Start one from To learn." : "Nothing here."}
                </p>
              ) : lane.items.map((i) => (
                <Card key={i.id} item={i} now={now} set={set} remove={remove} />
              ))}
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ item: i, now, set, remove }: {
  item: Item; now: Date;
  set: (id: string, fields: Partial<Item>) => void;
  remove: (i: Item) => void;
}) {
  const href = hrefOf(i.link);
  const move = quickMove(i.status);
  return (
    <article className={`lg-card le-card le-${i.status}`}>
      <div className="le-head">
        <h3 className="lg-card-title le-topic">{i.topic}</h3>
        <span className="lg-card-sub le-added">Added {fmtAdded(i.added, now)}</span>
      </div>

      <div className="le-why">
        <InlineText value={i.why} placeholder="Why: which posting or company asks for it"
          label={`Why learn ${i.topic}`} onSave={(v) => set(i.id, { why: v })} />
      </div>

      <div className="le-link">
        {href && <a className="le-open" href={href} target="_blank" rel="noopener noreferrer">Open</a>}
        <InlineText value={i.link} placeholder="Add a link to a course or docs"
          label={`Link for ${i.topic}`} onSave={(v) => set(i.id, { link: v })} />
      </div>

      <div className="le-note">
        <InlineText value={i.note} placeholder="Add a note" multiline
          label={`Note on ${i.topic}`} onSave={(v) => set(i.id, { note: v })} />
      </div>

      <div className="lg-card-row le-actions">
        <Choice value={i.status} options={LEARN_ORDER} labels={LEARN_LABEL}
          label={`Status of ${i.topic}`} onChange={(s) => set(i.id, { status: s })} />
        {move && (
          <button type="button" className="lg-btn" onClick={() => set(i.id, { status: move.to })}>
            {move.label}
          </button>
        )}
        <button type="button" className="lg-btn lg-btn-quiet le-remove"
          aria-label={`Remove ${i.topic}`} onClick={() => remove(i)}>Remove</button>
      </div>
    </article>
  );
}
