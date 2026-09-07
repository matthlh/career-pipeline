import { useEffect, useRef, useState } from "react";
import { nextPeak, today } from "../rules";
import { DEMO, REPO_URL, SEED } from "../seed";
import { applyTheme, loadState, loadTheme, saveState, type Theme } from "../storage";
import { toast } from "../ui";
import { People } from "./People";
import { Process } from "./Process";
import { TemplatesTab } from "./TemplatesTab";
import { Today } from "./Today";
import type { AppState, PersonState } from "../types";

type Tab = "today" | "people" | "process" | "templates";
const TABS: [Tab, string][] = [
  ["today", "Today"], ["people", "People"], ["process", "Process"], ["templates", "Templates"],
];

export function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [state, setState] = useState<AppState>(loadState);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { saveState(state); }, [state]);
  useEffect(() => { applyTheme(theme); }, [theme]);

  /* Two ways in. Locally, data.js ships alongside the page. On a published copy
     there is no data.js - you import the export file, which carries the people
     as well as the progress, so no one's address is ever on a public URL. */
  const people = state.people?.length ? state.people : SEED.people;
  const counts = state.counts ?? SEED.counts;

  /* Person state is merged, never replaced, so a data.js refresh that adds new
     people cannot wipe what you have already tracked. */
  function upd(id: string, patch: Partial<PersonState>) {
    setState((s) => {
      const was = s.p[id];
      return {
        ...s,
        p: { ...s.p, [id]: { ...was, ...patch, peak: nextPeak(was, patch.status) } },
        log: patch.status === "messaged"
          ? [...s.log, { id, at: new Date().toISOString(), ch: patch.channel }]
          : s.log,
      };
    });
  }

  function setRope(i: number, on: boolean) {
    setState((s) => ({ ...s, ropes: { ...s.ropes, [i]: on } }));
  }

  function exportState() {
    const out = { ...state, people, counts, generated: SEED.generated };
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "outreach-" + today() + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importState(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    /* Cleared before the read, not after: a file input fires no change event
       when you pick the same file twice, and re-importing the export you just
       fixed is the single most likely second attempt. */
    ev.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onerror = () => toast("Could not read that file");
    r.onload = () => {
      let incoming: AppState;
      try { incoming = JSON.parse(String(r.result)) as AppState; }
      catch { toast("That is not a JSON file"); return; }
      if (!incoming || typeof incoming.p !== "object") { toast("Not an outreach export"); return; }
      setState(incoming);
      toast(`Loaded ${incoming.people?.length ?? 0} people, ${Object.keys(incoming.p).length} tracked`);
    };
    r.readAsText(f);
  }

  const sent = state.log.length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Outreach</h1>
          <div className="sm dim">
            {DEMO ? "A job-search pipeline, running on invented data."
              : sent === 0 ? "Zero sent. That is still the only number that matters."
              : sent + " sent since you started. Keep the streak."}
          </div>
        </div>
        <button className="theme" title={"Theme: " + theme}
          onClick={() => setTheme(theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto")}>
          {theme === "auto" ? "◐" : theme === "dark" ? "☾" : "☀"}
        </button>
      </div>

      {DEMO && (
        <div className="warn" style={{ marginTop: 14, marginBottom: 0 }}>
          <b>This is the demo.</b> Twelve invented people at invented companies on the{" "}
          <code>.example</code> domain reserved by RFC 2606, so nothing here resolves to anyone's
          inbox. Everything else is the real thing: same build, same rules, same templates. The
          copy on my laptop points at a store of real contacts, which is gitignored and has never
          been pushed — which is why this one ships empty and takes its data through Import.
          <div className="sm dim" style={{ marginTop: 8, marginBottom: 0 }}>
            Start on <b>Process</b> for what the pipeline does and whether it is working, or{" "}
            <b>Templates</b> for the decision tree — three of its seven paths refuse to give you a
            message, which is the part I would want you to look at.{" "}
            <a href={REPO_URL} target="_blank" rel="noopener">Source</a>.
          </div>
        </div>
      )}

      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {people.length === 0 ? (
        <div className="card">
          <h3>No data loaded.</h3>
          <p className="sm dim">
            This copy is published without contact data on purpose — it would put real people's
            addresses on a public URL. Export from the machine that has the pipeline, then Import
            the file here. It carries the people and your progress together.
          </p>
          <button className="tiny" onClick={() => file.current?.click()}>Import a data file</button>
        </div>
      ) : (
        <>
          {tab === "today" && <Today people={people} state={state} upd={upd} />}
          {tab === "people" && <People people={people} state={state} upd={upd} />}
          {tab === "process" && <Process people={people} state={state} counts={counts} setRope={setRope} />}
          {tab === "templates" && <TemplatesTab />}
        </>
      )}

      <div className="foot">
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="tiny ghost" onClick={exportState}>Export progress</button>
          <button className="tiny ghost" onClick={() => file.current?.click()}>Import</button>
          <input ref={file} type="file" accept="application/json" style={{ display: "none" }} onChange={importState} />
        </div>
        {counts.people} people from {counts.companies} companies, data generated{" "}
        {state.generated ?? SEED.generated}. Progress is saved in this browser only — export it
        before you switch machines.
      </div>
    </>
  );
}
