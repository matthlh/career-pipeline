import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as folder from "../folder";
import { applyEdits, newEdit } from "./apply";
import { EDITS_KEY, dropApplied, loadEdits, saveEdits, startEdits } from "./persist";
import type { Edit, LedgerApi, LedgerSeed } from "./types";

/* localStorage is the record; ledger-edits.json in the connected folder is a copy
   for ledger-import to read. So the folder write is best-effort, debounced, and
   never prompts: a permission dialog popping up mid-edit would be worse than the
   file being a few edits behind until he clicks the button that grants it. */

const WRITE_DELAY_MS = 300;

/* connectFolderForWrites is called from a button anywhere in the app, outside
   any hook; a granted upgrade reaches the mounted hooks through this, so the
   edits made before the grant land in the file straight away. */
const onWritable = new Set<() => void>();

/** Upgrade the saved folder handle to readwrite. May prompt, so call it from a
 *  click. False when no folder is connected or the grant is refused. */
export async function connectFolderForWrites(): Promise<boolean> {
  if (!folder.supported()) return false;
  try {
    const h = await folder.saved();
    if (!h) return false;
    const ok = (await folder.access(h, true, "readwrite")) === "granted";
    if (ok) onWritable.forEach((f) => f());
    return ok;
  } catch {
    return false;
  }
}

/** Only when the grant already exists - never asks. */
async function writableFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!folder.supported()) return null;
  const h = await folder.saved();
  if (!h) return null;
  return (await folder.access(h, false, "readwrite")) === "granted" ? h : null;
}

export function useLedger(seed: LedgerSeed): LedgerApi {
  const [edits, setEdits] = useState<Edit[]>(() => startEdits(seed.appliedEdits));
  const [savedTo, setSavedTo] = useState<"folder" | "local">("local");

  /* The log as of the latest edit, read by edit() and the folder write without
     waiting for a render. Every change goes through commit(). */
  const live = useRef(edits);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writing = useRef<Promise<void>>(Promise.resolve());

  const writeNow = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    // Chained, so two writes never hold the file open at once; each writes
    // whatever the log is when its turn comes.
    writing.current = writing.current.then(async () => {
      try {
        const h = await writableFolder();
        if (!h) { setSavedTo("local"); return; }
        await folder.writeEdits(h, { version: 1, edits: live.current });
        setSavedTo("folder");
      } catch {
        setSavedTo("local");
      }
    });
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(writeNow, WRITE_DELAY_MS);
  }, [writeNow]);

  const commit = useCallback((next: Edit[], persist: boolean) => {
    live.current = next;
    setEdits(next);
    if (persist) saveEdits(next);
    schedule();
  }, [schedule]);

  const edit = useCallback((e: Omit<Edit, "id" | "at">) => {
    commit([...live.current, newEdit(e)], true);
  }, [commit]);

  /* A newer seed (data.js re-read off the folder) can carry more edits. */
  useEffect(() => {
    const kept = dropApplied(live.current, seed.appliedEdits);
    if (kept.length !== live.current.length) commit(kept, true);
  }, [seed.appliedEdits, commit]);

  /* Another tab saved the log. Without this, the next edit here would save this
     tab's stale copy over it and the other tab's edits would be gone. */
  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== EDITS_KEY) return;
      commit(dropApplied(loadEdits(), seed.appliedEdits), false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [seed.appliedEdits, commit]);

  /* Bring the file up to date on mount when anything is pending, and again the
     moment the folder becomes writable. A write still waiting at unmount goes
     out now rather than being dropped. */
  useEffect(() => {
    if (live.current.length) schedule();
    onWritable.add(writeNow);
    return () => {
      onWritable.delete(writeNow);
      if (timer.current) writeNow();
    };
  }, [schedule, writeNow]);

  const ledger = useMemo(() => applyEdits(seed, edits), [seed, edits]);
  const pending = edits.length;

  return useMemo(() => ({ ledger, edit, pending, savedTo }), [ledger, edit, pending, savedTo]);
}
