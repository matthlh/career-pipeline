import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEMO, LEDGER_SEED, PUBLIC_ORIGIN, REPO_URL, SEED, ledgerSeed, setShowingDemo, showingDemo } from "../seed";
import { applyTheme, loadTheme, watchSystemTheme, type Theme } from "../storage";
import { Logo, toast } from "../ui";
import * as folder from "../folder";
import { applyEdits } from "../ledger/apply";
import { sentCounts } from "../ledger/todo";
import { connectFolderForWrites, useLedger } from "../ledger/useLedger";
import type { LedgerApi } from "../ledger/types";
import { Applications } from "./ledger/Applications";
import { Learning } from "./ledger/Learning";
import { TemplatesTab } from "./TemplatesTab";
import type { Seed } from "../types";

const THEME_LABEL: Record<Theme, string> = { auto: "System", light: "Light", dark: "Dark" };

/* Three tabs. People, Companies and Open source were views too (Oct 4-9),
   and went: he is not going to work contacts by hand, so a screen for them was
   a screen to feel bad in front of. The data behind them is still in the seed. */
type Tab = "applications" | "learning" | "templates";
const TABS: [Tab, string][] = [
  ["applications", "Applications"], ["learning", "Learning"], ["templates", "Templates"],
];

/* Session-scoped, like the demo switch: a reload lands where you were, a fresh
   launch starts on Applications. */
const TAB_KEY = "career.tab";

function loadTab(): Tab {
  try {
    const t = sessionStorage.getItem(TAB_KEY);
    return TABS.some(([k]) => k === t) ? (t as Tab) : "applications";
  } catch {
    return "applications";
  }
}

function saveTab(t: Tab): void {
  try { sessionStorage.setItem(TAB_KEY, t); } catch { /* private window */ }
}

/* The example ledger with nothing applied: what "Switch to example data" shows.
   Read-only on purpose. Edits made there would land in the real log, and from
   there in ledger-edits.json and the real files. */
const EXAMPLE_API: LedgerApi = {
  ledger: applyEdits(LEDGER_SEED, []),
  pending: 0,
  savedTo: "local",
  edit: () => toast("Example data is read-only. Show your data again to make changes."),
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function App() {
  const [tab, setTabState] = useState<Tab>(loadTab);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const tabsRef = useRef<HTMLDivElement>(null);

  /* One clock for the whole render, so every view agrees on what "today" and
     "closing soon" mean, and a page left open overnight rolls over by itself. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  function setTab(t: Tab) {
    setTabState(t);
    saveTab(t);
  }

  /* Three tabs fit any phone, but the bar still scrolls if it ever has to;
     keep the current tab in view without moving the page itself. */
  useEffect(() => {
    const bar = tabsRef.current;
    const on = bar?.querySelector<HTMLElement>("button.on");
    if (!bar || !on) return;
    const b = bar.getBoundingClientRect(), r = on.getBoundingClientRect();
    if (r.left < b.left) bar.scrollLeft -= b.left - r.left + 8;
    else if (r.right > b.right) bar.scrollLeft += r.right - b.right + 8;
  }, [tab]);

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

  async function connectFolder(): Promise<boolean> {
    try {
      await folder.choose();
      await loadFolder(true);
      toast("Folder connected");
      return true;
    } catch {
      return false;                       // the picker was dismissed
    }
  }

  async function disconnectFolder() {
    await folder.forget();
    setDir(null);
    setDirState("off");
    toast("Folder disconnected");
  }

  /* Writing back is a bigger grant than reading, so it is asked for here, on a
     click, and never in the middle of an edit. */
  async function saveToFolder() {
    if (!(await folder.saved()) && !(await connectFolder())) return;
    const ok = await connectFolderForWrites();
    toast(ok ? "Saving to folder"
      : "Not saved: the folder needs write permission. Click Save to folder again to allow it.");
  }

  /* One switch for showing the screen to someone. It swaps the *displayed*
     ledger for the invented one without disconnecting anything, because the
     alternative - disconnect, demo, remember to reconnect - is the kind of
     thing you forget in exactly the direction you cannot afford to. */
  const [demoView, setDemoView] = useState(showingDemo);
  function setDemoViewPersisted(on: boolean) {
    setShowingDemo(on);
    setDemoView(on);
  }

  /* Real data exists but is being withheld from the screen on purpose. */
  const hidden = demoView && !!dir;
  /* Invented data on screen: the published demo, or the switch above. */
  const example = hidden || (DEMO && !dir);

  const realSeed = useMemo(() => (dir ? ledgerSeed(dir) : LEDGER_SEED), [dir]);
  const live = useLedger(realSeed);
  const api = hidden ? EXAMPLE_API : live;
  const generated = (!hidden && dir?.generated) || SEED.generated;

  /* The one number that matters, counted the honest way: a rejection was still
     an application sent. "Saved for later" is not here any more - most of it
     is big tech held for referrals, and counting that as progress was a lie. */
  const sent = useMemo(() => sentCounts(api.ledger.applications, now), [api.ledger.applications, now]);

  return (
    <>
      <div className="head">
        <div className="brand">
          <Logo />
          <div>
          <h1>Ledger</h1>
          <div className="sm dim">
            {example ? "A job-search ledger, running on invented data."
              : sent.total === 0 ? "Nothing sent yet."
              : `${plural(sent.total, "application", "applications")} sent${sent.week ? `, ${sent.week} this week` : ""}.`}
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

      {/* Where his changes are. Says nothing on invented data: there, a count of
          unsaved changes would be a demonstration posing as a warning. */}
      {(folder.supported() || (!example && (live.savedTo === "folder" || live.pending > 0))) && (
        <div className="row sm dim" style={{ alignItems: "center", marginTop: 10 }}>
          {!example && (live.savedTo === "folder" ? (
            <span role="status">Saved to folder</span>
          ) : live.pending > 0 ? (
            <>
              <span role="status">{plural(live.pending, "change", "changes")} saved in this browser</span>
              {folder.supported() && (
                <button className="tiny sel" onClick={() => void saveToFolder()}>Save to folder</button>
              )}
            </>
          ) : null)}
          {folder.supported() && (dirState === "on"
            ? <button className="tiny ghost" onClick={() => void disconnectFolder()}>Disconnect folder</button>
            : <button className="tiny ghost" onClick={() => void connectFolder()}>Connect data folder</button>)}
        </div>
      )}

      {dirState === "needs-click" && (
        <div className="warn" style={{ marginTop: 10, marginBottom: 0 }}>
          <b>Your data folder is connected but locked.</b> Browsers re-ask on a fresh visit,
          and only a click can answer.
          <div style={{ marginTop: 8 }}>
            <button className="tiny sel" onClick={() => void loadFolder(true)}>Unlock it</button>
          </div>
        </div>
      )}
      {dirState === "error" && (
        <div className="warn stop" style={{ marginTop: 10, marginBottom: 0 }}>
          <b>Could not read that folder.</b> {dirError} Pick the folder containing{" "}
          <code>data.js</code> — that is <code>app/public</code>.
          <div style={{ marginTop: 8 }} className="row">
            <button className="tiny" onClick={() => void connectFolder()}>Pick again</button>
            <button className="tiny ghost" onClick={() => void disconnectFolder()}>Forget it</button>
          </div>
        </div>
      )}

      {/* Real data on a public URL. Nobody else can see it - there is no server
          and nothing is uploaded - but the person next to you can. */}
      {PUBLIC_ORIGIN && dir && !hidden && (
        <div className="warn" style={{ marginTop: 14, marginBottom: 0 }}>
          <b>Your own data is loaded on the public URL.</b> Only in this browser: nothing was
          uploaded, and every other visitor gets the invented example data. But anyone looking
          at this screen is looking at real names and addresses.
          <div className="row" style={{ marginTop: 9 }}>
            <button className="tiny sel" onClick={() => setDemoViewPersisted(true)}>
              Switch to example data
            </button>
          </div>
        </div>
      )}

      {hidden && (
        <div className="warn" style={{ marginTop: 14, marginBottom: 0 }}>
          <b>Showing example data.</b> Your {plural(realSeed.applications.length, "application", "applications")}{" "}
          are still connected and untouched — they are just off the screen, and nothing here can
          change them. This resets when you close the browser.
          <div className="row" style={{ marginTop: 9 }}>
            <button className="tiny sel" onClick={() => setDemoViewPersisted(false)}>
              Show my data again
            </button>
          </div>
        </div>
      )}

      {DEMO && !dir && (
        <div className="warn" style={{ marginTop: 14, marginBottom: 0 }}>
          <b>This is the demo.</b> Invented applications and companies on the{" "}
          <code>.example</code> domain reserved by RFC 2606, so nothing here resolves to anyone's
          inbox. Everything else is the real thing: same build, same rules, same templates. The
          copy on my laptop reads a folder of real data, which is gitignored and has never been
          pushed. Changes you make here stay in this browser.
          <div className="sm dim" style={{ marginTop: 8, marginBottom: 0 }}>
            Start on <b>Applications</b> for what went in and what to do next, or{" "}
            <b>Templates</b> for the decision tree — three of its seven paths refuse to give you a
            message, which is the part I would want you to look at.{" "}
            <a href={REPO_URL} target="_blank" rel="noopener">Source</a>.
          </div>
        </div>
      )}

      <div className="tabs" ref={tabsRef} role="navigation" aria-label="Sections">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined}
            onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === "applications" && <Applications api={api} now={now} />}
      {tab === "learning" && <Learning api={api} now={now} />}
      {tab === "templates" && <div className="narrow"><TemplatesTab /></div>}

      <div className="foot">
        {dirState === "on" && (
          <div style={{ marginBottom: 6 }}>
            Reading <code>data.js</code> from your connected folder — re-read on every visit, so
            a pipeline run shows up without importing anything. It is read in this browser and
            never sent anywhere; this page has no network calls of its own.
          </div>
        )}
        Data generated {generated}.{" "}
        {example
          ? "Changes stay in this browser."
          : <>Changes are kept in this browser{live.savedTo === "folder" && <>{" "}and copied to{" "}
              <code>ledger-edits.json</code> in the connected folder</>} until{" "}
              <code>python3 scripts/run.py ledger-import</code> folds them into the files.</>}
      </div>
    </>
  );
}
