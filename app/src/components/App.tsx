import { useCallback, useEffect, useRef, useState } from "react";
import { nextPeak, today } from "../rules";
import { DEMO, REPO_URL, SEED } from "../seed";
import { applyTheme, loadState, loadTheme, saveState, watchSystemTheme, type Theme } from "../storage";
import { Logo, toast } from "../ui";
import { People } from "./People";
import { Process } from "./Process";
import { RopesPanel } from "./Ropes";
import * as folder from "../folder";
import { TemplatesTab } from "./TemplatesTab";
import { Today } from "./Today";
import type { AppState, PersonState, Seed } from "../types";

const THEME_LABEL: Record<Theme, string> = { auto: "System", light: "Light", dark: "Dark" };

type Tab = "today" | "people" | "process" | "templates";
const TABS: [Tab, string][] = [
  ["today", "Today"], ["people", "People"], ["process", "Process"], ["templates", "Templates"],
];

export function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [state, setState] = useState<AppState>(loadState);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const file = useRef<HTMLInputElement>(null);

  /* Skip the save on mount. Writing state before anything has happened is what
     poisoned the published copy: the stored empty object then looked like real
     progress on the next visit. */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    saveState(state);
  }, [state]);
  useEffect(() => { applyTheme(theme); }, [theme]);

  /* Keep the browser-chrome colour honest when the OS flips while the page is
     open. The ref keeps the listener reading the current value without being
     torn down and rebuilt on every theme change. */
  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => watchSystemTheme(() => themeRef.current), []);

  /* A folder the pipeline writes into, remembered across visits. Takes
     precedence over the built-in seed and is deliberately *not* copied into
     localStorage: the point is that it is re-read every load, so the morning's
     cron run shows up without anyone importing anything. */
  const [dir, setDir] = useState<Seed | null>(null);
  const [dirState, setDirState] = useState<"off" | "needs-click" | "on" | "error">("off");
  const [dirError, setDirError] = useState("");

  const loadFolder = useCallback(async (ask: boolean) => {
    const h = await folder.saved();
    if (!h) return;
    const perm = await folder.access(h, ask);
    if (perm === "needs-click") { setDirState("needs-click"); return; }
    if (perm === "denied") { setDirState("error"); setDirError("Permission was refused."); return; }
    try {
      setDir(await folder.readSeed(h));
      setDirState("on");
    } catch (e) {
      setDirState("error");
      setDirError(e instanceof Error ? e.message : "could not read data.js there");
    }
  }, []);

  useEffect(() => { if (folder.supported()) void loadFolder(false); }, [loadFolder]);

  async function connectFolder() {
    try {
      await folder.choose();
      await loadFolder(true);
      toast("Folder connected");
    } catch {
      /* the picker was dismissed */
    }
  }

  async function disconnectFolder() {
    await folder.forget();
    setDir(null);
    setDirState("off");
    toast("Folder disconnected");
  }

  /* Two ways in. Locally, data.js ships alongside the page. On a published copy
     there is no data.js - you import the export file, which carries the people
     as well as the progress, so no one's address is ever on a public URL. */
  const source = state.people?.length ? null : dir;
  const people = state.people?.length ? state.people : (source?.people ?? SEED.people);
  const counts = state.counts ?? source?.counts ?? SEED.counts;

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

  /* Shared by the file picker and by dropping a file anywhere on the page.
     On a phone the picker is fine; on a laptop, dragging the export out of
     Downloads is one gesture instead of four. */
  function readExport(f: File | undefined) {
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

  function importState(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    /* Cleared before the read, not after: a file input fires no change event
       when you pick the same file twice, and re-importing the export you just
       fixed is the single most likely second attempt. */
    ev.target.value = "";
    readExport(f);
  }

  /* Drop anywhere on the window, not on a wrapper element. The app's root uses
     display:contents so a wrapper has no box of its own, and dropping on the
     empty space below the content would miss it. Depth counting rather than a
     boolean because dragenter fires again for every child crossed. */
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const isFile = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!isFile(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    // Without preventDefault on dragover the browser navigates to the file
    // instead of letting the page have it.
    const over = (e: DragEvent) => { if (isFile(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!isFile(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      readExport(e.dataTransfer?.files?.[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const sent = state.log.length;

  return (
    <>
      {dragging && <div className="dropzone">Drop the export to load it</div>}

      <div className="head">
        <div className="brand">
          <Logo />
          <div>
          <h1>Outreach</h1>
          <div className="sm dim">
            {DEMO ? "A job-search pipeline, running on invented data."
              : sent === 0 ? "Zero sent. That is still the only number that matters."
              : sent + " sent since you started. Keep the streak."}
          </div>
          </div>
        </div>
        {/* Says which mode is in force rather than leaving you to decode a
            glyph. "System" is the default and the first stop in the cycle. */}
        <button className="theme" aria-label={"Appearance: " + THEME_LABEL[theme] + ". Click to change."}
          title={"Appearance: " + THEME_LABEL[theme]}
          onClick={() => setTheme(theme === "auto" ? "light" : theme === "light" ? "dark" : "auto")}>
          <span aria-hidden="true">{theme === "auto" ? "◐" : theme === "dark" ? "☾" : "☀"}</span>
          <span className="theme-label">{THEME_LABEL[theme]}</span>
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
            addresses on a public URL. There is no account to sign into and nothing is uploaded
            anywhere; the data lives on whichever machine you put it on.
          </p>
          {folder.supported() && (
            <p className="sm dim">
              <b>On the machine with the pipeline:</b> connect the folder the pipeline writes
              into — <code>app/public</code> — and this page reads it on every visit, so
              whatever cron wrote this morning is just here. The browser remembers the folder;
              nothing is uploaded and nothing leaves the machine.
              <div style={{ marginTop: 8 }}>
                <button className="tiny sel" onClick={connectFolder}>Connect data folder</button>
              </div>
            </p>
          )}
          <p className="sm dim">
            <b>{folder.supported() ? "Or open it from disk:" : "On the machine with the pipeline:"}</b>{" "}
            run <code>python3 scripts/run.py app</code> and bookmark the file it opens. No
            server, no terminal after the first time.
          </p>
          <p className="sm dim">
            <b>Anywhere else:</b> hit <b>Export progress</b> there, then drop that file
            anywhere on this page. It carries the people and your progress together, and stays
            in this browser.
          </p>
          <button className="tiny" onClick={() => file.current?.click()}>Choose a file</button>
        </div>
      ) : (
        <>
          {tab === "today" && <Today people={people} state={state} upd={upd} />}
          {tab === "people" && <People people={people} state={state} upd={upd} />}
          {tab === "process" && <Process people={people} state={state} counts={counts} />}
          {tab === "templates" && <TemplatesTab />}
        </>
      )}

      <RopesPanel done={state.ropes || {}} setRope={setRope} />

      <div className="foot">
        {dirState === "needs-click" && (
          <div className="warn" style={{ marginBottom: 10 }}>
            <b>Your data folder is connected but locked.</b> Browsers re-ask on a fresh visit,
            and only a click can answer.
            <div style={{ marginTop: 8 }}>
              <button className="tiny sel" onClick={() => void loadFolder(true)}>Unlock it</button>
            </div>
          </div>
        )}
        {dirState === "error" && (
          <div className="warn stop" style={{ marginBottom: 10 }}>
            <b>Could not read that folder.</b> {dirError} Pick the folder containing{" "}
            <code>data.js</code> — that is <code>app/public</code>.
            <div style={{ marginTop: 8 }} className="row">
              <button className="tiny" onClick={connectFolder}>Pick again</button>
              <button className="tiny ghost" onClick={disconnectFolder}>Forget it</button>
            </div>
          </div>
        )}
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="tiny ghost" onClick={exportState}>Export progress</button>
          <button className="tiny ghost" onClick={() => file.current?.click()}>Import</button>
          <input ref={file} type="file" accept="application/json" style={{ display: "none" }} onChange={importState} />
          {folder.supported() && (dirState === "on"
            ? <button className="tiny ghost" onClick={disconnectFolder}>Disconnect folder</button>
            : <button className="tiny ghost" onClick={connectFolder}>Connect data folder</button>)}
        </div>
        {dirState === "on" && (
          <div style={{ marginBottom: 6 }}>
            Reading <code>data.js</code> from your connected folder — re-read on every visit, so
            a pipeline run shows up without importing anything.
          </div>
        )}
        {counts.people} people from {counts.companies} companies, data generated{" "}
        {state.generated ?? SEED.generated}. Progress is saved in this browser only — export it
        before you switch machines, or drop the file anywhere on this page to load it.
      </div>
    </>
  );
}
