import { useState } from "react";
import { CHANNELS, ago, nextAction, sendWindow, today } from "../rules";
import { buildMsg, T } from "../templates";
import { CopyBtn, MsgMeter, Pills, alumUrl, copy, gmailUrl, linkedinUrl, toast } from "../ui";
import type { Channel, Person, PersonState, Status, TemplateKey } from "../types";

export interface Upd { (id: string, patch: Partial<PersonState>): void }

export function PersonCard({ p, st, upd }: { p: Person; st?: PersonState; upd: Upd }) {
  const act = nextAction(p, st);
  const [chan, setChan] = useState<Channel>(st?.channel ?? "email");
  const [alum, setAlum] = useState(!!st?.alum);
  const [override, setOverride] = useState<TemplateKey | null>(null);
  const [applied, setApplied] = useState(st?.status === "applied");

  /* LinkedIn has its own short templates; everything else is the email set. */
  let key: TemplateKey = override ?? act.tmpl ?? "3";
  if (!override && chan === "linkedin") {
    if (key === "3" || key === "2") key = alum ? "1a" : "1";
    if (key === "1" && alum) key = "1a";
  }
  const msg = buildMsg(key, p, st);
  const needApply = act.apply && !applied && p.applyUrl;
  const win = sendWindow(p);

  function mark(status: Status, extra: Partial<PersonState> = {}) {
    upd(p.id, {
      status, channel: chan, alum,
      last: today(),
      first: st?.first ?? today(),
      ...extra,
    });
    toast(status === "messaged" ? "Marked sent. Follow up in 7 days." : "Marked " + status);
  }

  return (
    <div className={"card" + (act.kind === "followup" ? " hot" : "") + (act.stale ? " hot" : "")}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>{p.name || p.company}</h3>
        <Pills p={p} />
      </div>
      <div className="sm dim" style={{ marginBottom: 8 }}>
        {p.name ? p.company + " · " : ""}{p.email}
        {p.location ? " · " + p.location : ""}
      </div>

      <div className="sm" style={{ marginBottom: 10 }}>
        <b>{act.label}.</b> <span className="dim">{act.why}</span>
      </div>

      {act.kind === "wait" || act.kind === "reply" || act.kind === "build" ? (
        <div className="row">
          <button className="tiny" onClick={() => mark("replied")}>They replied</button>
          <button className="tiny" onClick={() => mark("call booked")}>Call booked</button>
          <button className="tiny" onClick={() => mark("call done")}>Call done</button>
          {act.kind === "build" && <button className="tiny" onClick={() => mark("built it")}>I built it</button>}
          <button className="tiny" onClick={() => mark("dead")}>Dead</button>
        </div>
      ) : (
        <>
          {key === "4" ? null : p.fact ? (
            <div className="fact">
              {p.fact}
              {p.cite && (
                <div className="dim" style={{ marginTop: 6, fontSize: 12.5 }}>
                  {p.cite}{" "}
                  {p.citeUrl && <a href={p.citeUrl} target="_blank" rel="noopener">source</a>}
                </div>
              )}
            </div>
          ) : (
            <div className="fact none">
              <b>No researched fact yet.</b> Five minutes: open the source, find one real specific
              thing, paste it into the message where the bracket is.
              <div style={{ marginTop: 6 }} className="row">
                {p.repo && <a className="sm" href={"https://github.com/" + p.repo} target="_blank" rel="noopener">github.com/{p.repo}</a>}
                {p.postingUrl && <a className="sm" href={p.postingUrl} target="_blank" rel="noopener">the posting</a>}
                <a className="sm" href={"https://" + p.domain} target="_blank" rel="noopener">{p.domain}</a>
              </div>
            </div>
          )}

          {needApply && (
            <div className="warn">
              <b>Apply first, then send this.</b> Three minutes, and it turns the ask into
              "I applied, would value fifteen minutes."
              <div className="row" style={{ marginTop: 9 }}>
                <a href={p.applyUrl!} target="_blank" rel="noopener"><button className="tiny">Open application</button></a>
                <button className="tiny sel" onClick={() => { setApplied(true); mark("applied"); }}>I applied</button>
              </div>
            </div>
          )}

          <div className="xs" style={{ marginBottom: 5 }}>Where are you sending this?</div>
          <div className="row eq" style={{ marginBottom: 10 }}>
            <button className={"tiny" + (chan === "email" ? " sel" : "")} onClick={() => setChan("email")}>Email</button>
            <button className={"tiny" + (chan === "linkedin" ? " sel" : "")} onClick={() => setChan("linkedin")}>LinkedIn</button>
            <button className={"tiny" + (alum ? " sel" : "")} onClick={() => setAlum(!alum)}>{alum ? "UBC alum ✓" : "UBC alum?"}</button>
          </div>

          {chan === "linkedin" && (
            <div className="sm dim" style={{ marginBottom: 10 }}>
              <a href={linkedinUrl(p)} target="_blank" rel="noopener">Find them on LinkedIn</a>
              {" · "}
              <a href={alumUrl(p)} target="_blank" rel="noopener">check for UBC alumni here</a>
              {" — open the company, People tab, filter School."}
            </div>
          )}

          <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
            <span className="xs" style={{ flex: "none" }}>Template</span>
            <select value={override ?? key} style={{ flex: 1 }}
              onChange={(e) => setOverride(e.target.value as TemplateKey)}>
              {(Object.keys(T) as TemplateKey[]).map((k) => (
                <option key={k} value={k}>{T[k]().n} — {T[k]().name}</option>
              ))}
            </select>
            {override && <button className="tiny ghost" onClick={() => setOverride(null)}>auto</button>}
          </div>

          <div className="sm dim" style={{ marginBottom: 8 }}>{msg.note}</div>

          {key === "4" && (
            <>
              <div className="xs" style={{ marginBottom: 5 }}>The one new thing</div>
              <textarea
                style={{ marginBottom: 8 }}
                placeholder="Something else you read in their code, a question the first message didn't ask, or something you built since."
                value={st?.newthing ?? ""}
                onChange={(e) => upd(p.id, { newthing: e.target.value })}
              />
            </>
          )}

          {msg.subject && <div className="sm" style={{ marginBottom: 6 }}><b>Subject:</b> {msg.subject}</div>}
          <pre>{msg.text}</pre>
          <MsgMeter msg={msg} />

          <CopyBtn text={msg.text} label={chan === "linkedin" ? "Copy the note" : "Copy the email"} />

          <div className="row eq" style={{ marginTop: 8 }}>
            {chan === "email" ? (
              <a href={gmailUrl(p.email, msg.subject, msg.text)} target="_blank" rel="noopener" style={{ flex: 1 }}>
                <button className="tiny" style={{ width: "100%" }}>Open in Gmail</button>
              </a>
            ) : (
              <a href={linkedinUrl(p)} target="_blank" rel="noopener" style={{ flex: 1 }}>
                <button className="tiny" style={{ width: "100%" }}>Open LinkedIn</button>
              </a>
            )}
            <button className="tiny" onClick={() => copy(p.email, "Address copied")}>Copy address</button>
          </div>

          {chan === "email" && (
            <div className="sm dim" style={{ marginTop: 8 }}>
              {win.off === 0
                ? "Best window is 6-9am your time, Tuesday to Thursday."
                : `Best window is ${win.theirs}, Tuesday to Thursday — ${win.yours} your time. `
                  + "Write it now and use Gmail's Schedule send."}
            </div>
          )}

          <div className="sep" />
          <div className="row eq">
            <button className="go" style={{ fontSize: 15, padding: 12 }}
              onClick={() => mark("messaged", act.kind === "followup" ? { ups: (st?.ups ?? 0) + 1 } : {})}>
              {act.kind === "followup" ? "Follow-up sent" : "Sent it"}
            </button>
            <button className="tiny" onClick={() => mark("dead")}>Skip / dead</button>
          </div>
        </>
      )}
    </div>
  );
}

/** The one-line version used in "Close these out", where the only choice left
 *  is whether to close it. */
export function DeadRow({ p, st, upd }: { p: Person; st?: PersonState; upd: Upd }) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <b>{p.name || p.company}</b>
          <div className="sm dim">
            {p.company} · {CHANNELS[st?.channel ?? "email"]} · {ago(st?.last)}
          </div>
        </div>
        <button className="tiny" onClick={() => upd(p.id, { status: "dead" })}>Mark dead</button>
      </div>
    </div>
  );
}
