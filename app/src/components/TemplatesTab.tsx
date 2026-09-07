import { useState } from "react";
import { LEAF, STOP, TREE, buildMsg } from "../templates";
import { CopyBtn, MsgMeter } from "../ui";

export function TemplatesTab() {
  const [path, setPath] = useState<string[]>(["start"]);
  const node = path[path.length - 1]!;

  const leaf = LEAF[node];
  const stop = STOP[node];

  if (leaf || stop) {
    const msg = leaf ? buildMsg(leaf, {}) : null;
    return (
      <div>
        <button className="tiny ghost" onClick={() => setPath(path.slice(0, -1))}>← back</button>
        <button className="tiny ghost" onClick={() => setPath(["start"])}>start over</button>
        {stop ? (
          <div className="card" style={{ marginTop: 10 }}>
            <div className="warn stop" style={{ marginBottom: 0 }}>
              <h3>{stop.h}</h3>
              <p className="sm" style={{ marginBottom: 0 }}>{stop.p}</p>
            </div>
          </div>
        ) : msg ? (
          <div className="card" style={{ marginTop: 10 }}>
            <h3>Template {msg.n} — {msg.name}</h3>
            <p className="sm dim">{msg.note}</p>
            {msg.subject && <div className="sm" style={{ marginBottom: 6 }}><b>Subject:</b> {msg.subject}</div>}
            <pre>{msg.text}</pre>
            <MsgMeter msg={msg} />
            <CopyBtn text={msg.text} />
            <p className="sm dim" style={{ marginTop: 9, marginBottom: 0 }}>
              Blank template. Use the Today tab instead when you want it filled in with a real
              person's name and fact.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  const t = TREE[node];
  if (!t) return null;

  return (
    <div>
      {path.length > 1 && <button className="tiny ghost" onClick={() => setPath(path.slice(0, -1))}>← back</button>}
      <div className="card">
        <h3>{t.q}</h3>
        <div style={{ marginTop: 12 }}>
          {t.a.map(([label, next]) => (
            <button key={next} className="go" style={{ marginBottom: 8, fontSize: 15 }}
              onClick={() => setPath(path.concat([next]))}>{label}</button>
          ))}
        </div>
      </div>
      <p className="sm dim">
        Three of these paths end in "don't send anything yet". That is deliberate. The message you
        don't send costs you nothing; the wrong one spends the contact.
      </p>
    </div>
  );
}
