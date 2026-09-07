import { useMemo, useState } from "react";
import { nextAction, weakSendDay } from "../rules";
import { storage } from "../storage";
import { DeadRow, PersonCard, type Upd } from "./PersonCard";
import type { AppState, Person } from "../types";

export function Today({ people, state, upd }: { people: Person[]; state: AppState; upd: Upd }) {
  const [extra, setExtra] = useState(0);
  const target = (state.target || 2) + extra;

  const buckets = useMemo(() => {
    const b = {
      followup: [] as Person[], after: [] as Person[], fresh: [] as Person[],
      close: [] as Person[], stalled: [] as Person[], waiting: 0, live: 0,
    };
    for (const p of people) {
      const st = state.p[p.id];
      const a = nextAction(p, st);
      const s = st?.status ?? "not contacted";
      if (s !== "not contacted" && s !== "dead") b.live++;
      if (a.stale) { b.stalled.push(p); continue; }
      if (a.kind === "followup") b.followup.push(p);
      else if (a.kind === "thanks" || a.kind === "return" || a.kind === "reply") b.after.push(p);
      else if (a.kind === "wait") b.waiting++;
      else if (a.dead) b.close.push(p);
      else if (s === "not contacted" || s === "applied") b.fresh.push(p);
    }
    return b;
  }, [people, state]);

  const queue = buckets.fresh.slice(0, target);
  const nothing = !buckets.followup.length && !buckets.after.length && !buckets.close.length
    && !buckets.stalled.length && !queue.length;
  const weakDay = weakSendDay();

  return (
    <div>
      <div className="grid">
        <div className="stat"><div className="n">{buckets.followup.length}</div><div className="xs">follow up</div></div>
        <div className="stat"><div className="n">{queue.length}</div><div className="xs">to send</div></div>
        <div className="stat"><div className="n">{buckets.waiting}</div><div className="xs">waiting</div></div>
        <div className="stat"><div className="n">{buckets.live}</div><div className="xs">live threads</div></div>
      </div>

      {weakDay && (
        <p className="sm dim" style={{ marginTop: -4 }}>
          {weakDay} is a weaker send day — Tuesday and Wednesday open about ten points better.
          Send anyway. A message you did not send opens at zero, and never missing two days in a
          row outranks ten points.
        </p>
      )}

      {!storage.ok && (
        <div className="warn stop">
          <b>This browser is blocking local storage.</b> Nothing you mark will be saved.
          Private windows do this. Open the page in a normal window.
        </div>
      )}

      {nothing && (
        <div className="card">
          <h3>Nothing due.</h3>
          <p className="dim sm">
            {buckets.waiting > 0
              ? buckets.waiting + " threads are inside the 7-day window. Nothing to do but wait."
              : "You're through the list."}
          </p>
          <button className="tiny" onClick={() => setExtra(extra + 2)}>Queue two more anyway</button>
        </div>
      )}

      {buckets.followup.length > 0 && (
        <>
          <h2>Follow up first</h2>
          <p className="sm dim" style={{ marginTop: -4 }}>
            Seven days, no reply. One follow-up, never two — a first follow-up lifts replies by
            about 60%, a second one adds almost nothing and costs the relationship.
          </p>
          {buckets.followup.map((p) => <PersonCard key={p.id} p={p} st={state.p[p.id]} upd={upd} />)}
        </>
      )}

      {buckets.stalled.length > 0 && (
        <>
          <h2>Stalled</h2>
          <p className="sm dim" style={{ marginTop: -4 }}>
            Three weeks with no movement. These were the good ones — somebody answered — and they
            are the cheapest thing on this page to recover.
          </p>
          {buckets.stalled.map((p) => <PersonCard key={p.id} p={p} st={state.p[p.id]} upd={upd} />)}
        </>
      )}

      {buckets.after.length > 0 && (
        <>
          <h2>Live threads</h2>
          {buckets.after.map((p) => <PersonCard key={p.id} p={p} st={state.p[p.id]} upd={upd} />)}
        </>
      )}

      {buckets.close.length > 0 && (
        <>
          <h2>Close these out</h2>
          <p className="sm dim" style={{ marginTop: -4 }}>
            Two touches, no reply. That is the rule, and leaving them open is how the list stops
            meaning anything.
          </p>
          {buckets.close.map((p) => <DeadRow key={p.id} p={p} st={state.p[p.id]} upd={upd} />)}
        </>
      )}

      {queue.length > 0 && (
        <>
          <h2>Send today</h2>
          <p className="sm dim" style={{ marginTop: -4 }}>
            Cap is two a day. The floor is one. Never miss two days in a row.
          </p>
          {queue.map((p) => <PersonCard key={p.id} p={p} st={state.p[p.id]} upd={upd} />)}
          <button className="tiny ghost" onClick={() => setExtra(extra + 1)}>One more</button>
        </>
      )}
    </div>
  );
}
