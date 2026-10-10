import type { EditsFile } from "./ledger/types";
import type { Seed } from "./types";

/* Point the published page at the folder the pipeline writes into.
 *
 * The File System Access API lets a page hold a directory handle across visits,
 * so you grant read access to app/public once and every later visit picks up
 * whatever cron wrote at 7:45 that morning. No server, no account, and the data
 * never leaves the machine - the page reads it locally, the same way it reads
 * localStorage.
 *
 * Chromium only (Chrome, Edge, Arc, Brave). Safari and Firefox have no handle
 * persistence, so `supported()` is false there and the UI does not offer it.
 */

/* TypeScript's DOM lib does not carry these yet: showDirectoryPicker and the
   permission methods on a handle are still Chromium-only additions. Declared
   narrowly rather than pulled in as a dependency. */
type FsPermission = "granted" | "denied" | "prompt";
export type FsMode = "read" | "readwrite";
interface FsPermissionOpts { mode: FsMode }

declare global {
  interface Window {
    showDirectoryPicker(opts?: { id?: string; mode?: FsMode }):
      Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle {
    queryPermission(opts?: FsPermissionOpts): Promise<FsPermission>;
    requestPermission(opts?: FsPermissionOpts): Promise<FsPermission>;
  }
}

const DB = "career.folder";
const STORE = "handles";
const KEY = "data-dir";

export function supported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    // Handles are structured-cloneable but not JSON-serialisable, which is why
    // this is IndexedDB and not localStorage like everything else here.
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then((db) => new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export async function remember(handle: FileSystemDirectoryHandle): Promise<void> {
  await tx("readwrite", (s) => s.put(handle, KEY));
}

export async function forget(): Promise<void> {
  await tx("readwrite", (s) => s.delete(KEY));
}

export async function saved(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await tx("readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

/** Ask for the folder. Must be called from a click - browsers require a gesture. */
export async function choose(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: "career-data", mode: "read" });
  await remember(handle);
  return handle;
}

export type Access = "granted" | "needs-click" | "denied";

/** `prompt` is not a failure: it means the browser will grant on a gesture, so
 *  the UI shows a button rather than an error.
 *
 *  The folder is granted "read" when it is connected. "readwrite" is a separate,
 *  larger grant (the ledger writes its edit log back), so it is asked for on its
 *  own and a read grant never implies it. */
export async function access(
  h: FileSystemDirectoryHandle, ask: boolean, mode: FsMode = "read",
): Promise<Access> {
  const opts: FsPermissionOpts = { mode };
  let state = await h.queryPermission(opts);
  if (state === "prompt" && ask) state = await h.requestPermission(opts);
  return state === "granted" ? "granted" : state === "prompt" ? "needs-click" : "denied";
}

/** data.js is `window.SEED = {...};` - parsed, never evaluated. It is a file
 *  off the user's disk, but "off my disk" and "safe to execute" are different
 *  claims and only one of them is needed here. */
export function parseSeed(text: string): Seed {
  const start = text.indexOf("{", text.indexOf("window.SEED"));
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("that folder's data.js is not in the expected shape");
  }
  const seed = JSON.parse(text.slice(start, end + 1)) as Seed;
  if (!Array.isArray(seed.people)) throw new Error("no people in that data.js");
  return seed;
}

export async function readSeed(h: FileSystemDirectoryHandle): Promise<Seed> {
  const file = await h.getFileHandle("data.js");
  return parseSeed(await (await file.getFile()).text());
}

export const EDITS_FILE = "ledger-edits.json";

/** The ledger's whole local edit log, as ledger-import reads it. Needs
 *  "readwrite" already granted - this never asks. createWritable writes to a
 *  swap file and only replaces the real one on close, so a failed write leaves
 *  the previous log intact rather than half a file. */
export async function writeEdits(h: FileSystemDirectoryHandle, file: EditsFile): Promise<void> {
  const fh = await h.getFileHandle(EDITS_FILE, { create: true });
  const out = await fh.createWritable();
  try {
    await out.write(JSON.stringify(file, null, 2) + "\n");
  } catch (e) {
    await out.abort().catch(() => undefined);
    throw e;
  }
  await out.close();
}
