import { Fragment, useMemo, useState } from "react";
import { CHANNELS, STATUSES, ago, nextAction, today } from "../rules";
import { copy } from "../ui";
import type { Upd } from "./PersonCard";
import type { AppState, Channel, Person, Status } from "../types";

type Filter = "due" | "stalled" | "live" | "new" | "all" | "dead";

const FILTERS: [Filter, string][] = [
  ["due", "Follow up"],
  ["stalled", "Stalled"],
  ["live", "In play"],
  ["new", "Not contacted"],
  ["all", "All"],
  ["dead", "Dead"],
];

export function People({ people, state, upd }: { people: Person[]; state: AppState; upd: Upd }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filter>("due");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => {
      const st = state.p[p.id];
      const s = st?.status ?? "not contacted";
      const a = nextAction(p, st);
      if (f === "due" && !["followup", "thanks", "return", "reply"].includes(a.kind)) return false;
      if (f === "stalled" && !a.stale) return false;
      if (f === "live" && (s === "not contacted" || s === "dead")) return false;
      if (f === "new" && s !== "not contacted") return false;
      if (f === "dead" && s !== "dead") return false;
      if (!needle) return true;
      return (p.company + " " + (p.name || "") + " " + p.email + " " + (p.domain || "")
        + " " + (p.loc || "") + " " + (p.roleFit || "")).toLowerCase().includes(needle);
    });
  }, [people, state, q, f]);

  const counts = useMemo(() => {
    const c = { due: 0, stalled: 0 } as Record<Status | "due" | "stalled", number>;
    for (const s of STATUSES) c[s] = 0;
    for (const p of people) {
      const st = state.p[p.id];
      c[st?.status ?? "not contacted"]++;
      const a = nextAction(p, st);
      if (a.kind === "followup") c.due++;
      if (a.stale) c.stalled++;
    }
    return c;
  }, [people, state]);

  return (
    <div>
      <div className="grid">
        <div className="stat"><div className="n">{counts.messaged}</div><div className="xs">messaged</div></div>
        <div className="stat"><div className="n">{counts.replied + counts["call booked"] + counts["call done"]}</div><div className="xs">replied</div></div>
        <div className="stat"><div className="n">{counts.due}</div><div className="xs">follow up due</div></div>
        <div className="stat"><div className="n">{counts["not contacted"]}</div><div className="xs">untouched</div></div>
      </div>

      <input type="text" placeholder="Search name, company, address, city, role fit"
        value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 9 }} />
      <div className="row" style={{ marginBottom: 12 }}>
        {FILTERS.map(([k, label]) => (
          <button key={k} className={"tiny" + (f === k ? " sel" : "")} onClick={() => setF(k)}>
            {label}{k === "stalled" && counts.stalled ? ` (${counts.stalled})` : ""}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card"><p className="sm dim" style={{ marginBottom: 0 }}>Nothing matches.</p></div>
      ) : (
        <div className="card" style={{ padding: "6px 14px" }}>
          <table>
            <thead>
              <tr><th>Who</th><th>Status</th><th>Last</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = state.p[p.id] ?? {};
                const isOpen = open === p.id;
                const a = nextAction(p, st);
                /* A Fragment, not a nested table. Wrapping each row in its own
                   <table> made every row compute its own column widths, so
                   nothing lined up with the header or with the row above it. */
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td onClick={() => setOpen(isOpen ? null : p.id)} style={{ cursor: "pointer" }}>
                        <b>{p.name || p.company}</b>
                        {a.stale && <span className="pill t3" style={{ marginLeft: 6 }}>stalled</span>}
                        <div className="dim" style={{ fontSize: 12 }}>
                          {p.company}{p.loc ? " · " + p.loc : ""}
                        </div>
                      </td>
                      <td>
                        <select value={st.status ?? "not contacted"}
                          onChange={(e) => upd(p.id, {
                            status: e.target.value as Status, last: today(),
                            first: st.first ?? today(),
                          })}>
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="dim">{ago(st.last)}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td className="detail" colSpan={3}>
                          <div className="sm" style={{ marginBottom: 6 }}>
                            <b>{a.label}.</b> <span className="dim">{a.why}</span>
                          </div>
                          <div className="sm dim" style={{ marginBottom: 6 }}>{p.email}</div>
                          {st.status && st.status !== "not contacted" && (
                            <div style={{ marginBottom: 6 }}>
                              <span className="xs">Channel </span>
                              <select value={st.channel ?? "email"}
                                onChange={(e) => upd(p.id, { channel: e.target.value as Channel })}>
                                {(Object.keys(CHANNELS) as Channel[]).map((c) => (
                                  <option key={c} value={c}>{CHANNELS[c]}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          <textarea placeholder="Notes" value={st.notes ?? ""}
                            onChange={(e) => upd(p.id, { notes: e.target.value })} />
                          <div className="row" style={{ marginTop: 6 }}>
                            <button className="tiny" onClick={() => copy(p.email, "Address copied")}>Copy address</button>
                            {p.postingUrl && <a className="sm" href={p.postingUrl} target="_blank" rel="noopener">posting</a>}
                            {p.repo && <a className="sm" href={"https://github.com/" + p.repo} target="_blank" rel="noopener">repo</a>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
