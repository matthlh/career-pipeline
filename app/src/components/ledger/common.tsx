/* Small pieces every ledger view shares, so five views read as one app.
   Styles live in ledger.css (imported once here). Keep this file small: a
   piece belongs here only when at least two views use it. */
import { useEffect, useState, type ReactNode } from "react";
import { fmtDeadline } from "../../ledger/rules";
import "./ledger.css";

export type Tone = "go" | "warn" | "red" | "dim" | "p2";

/** A small rounded label. */
export function Chip({ tone = "dim", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`lg-chip lg-chip-${tone}`} title={title}>{children}</span>;
}

/** Text that turns into an input on click and saves on blur or Enter.
 *  Escape cancels. Empty string saves as null. */
export function InlineText({
  value, placeholder, onSave, multiline = false, rows = 3, label,
}: {
  value: string | null; placeholder: string; onSave: (v: string | null) => void;
  multiline?: boolean; rows?: number; label?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { if (!editing) setDraft(value ?? ""); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if ((v || null) !== (value || null)) onSave(v || null);
  };
  if (!editing) {
    return (
      <button type="button" className={`lg-inline ${value ? "" : "lg-inline-empty"}`}
        aria-label={label ?? placeholder} onClick={() => setEditing(true)}>
        {value || placeholder}
      </button>
    );
  }
  const common = {
    className: "lg-input", value: draft, autoFocus: true, "aria-label": label ?? placeholder,
    placeholder, onBlur: commit,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
    },
  };
  return multiline ? <textarea rows={rows} {...common} /> : <input {...common} />;
}

/** A labelled native select. Native on purpose: it is the one control that is
 *  right on every phone. */
export function Choice<T extends string>({
  value, options, onChange, label, labels,
}: {
  value: T; options: readonly T[]; onChange: (v: T) => void; label: string;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <select className="lg-select" aria-label={label} value={value}
      onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
    </select>
  );
}

/** A titled group with a count. */
export function Section({ title, count, children, aside }: {
  title: string; count?: number; children: ReactNode; aside?: ReactNode;
}) {
  return (
    <section className="lg-section">
      <header className="lg-section-head">
        <h2>{title}{count != null && <span className="lg-count">{count}</span>}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** Search box plus any filter controls, in one row that wraps on a phone. */
export function Toolbar({ query, onQuery, placeholder, children }: {
  query: string; onQuery: (q: string) => void; placeholder: string; children?: ReactNode;
}) {
  return (
    <div className="lg-toolbar">
      <input className="lg-input lg-search" type="search" value={query} placeholder={placeholder}
        aria-label={placeholder} onChange={(e) => onQuery(e.target.value)} />
      {children}
    </div>
  );
}

/** A collapsible "Add ..." form. Fields are plain inputs keyed by name, or a
 *  select when given options (the first option is the default); the first
 *  field is required. Calls onAdd with trimmed values (empty -> null). */
export function AddForm({ label, fields, onAdd }: {
  label: string;
  fields: {
    name: string; placeholder: string; type?: "text" | "url" | "date" | "datetime-local";
    options?: readonly { value: string; label: string }[];
  }[];
  onAdd: (values: Record<string, string | null>) => void;
}) {
  const [open, setOpen] = useState(false);
  const empty = () => Object.fromEntries(fields.map((f) => [f.name, f.options?.[0]?.value ?? ""]));
  const [vals, setVals] = useState<Record<string, string>>(empty);
  if (!open) {
    return <button type="button" className="lg-btn lg-btn-quiet" onClick={() => setOpen(true)}>+ {label}</button>;
  }
  const first = fields[0]?.name ?? "";
  return (
    <form className="lg-form" onSubmit={(e) => {
      e.preventDefault();
      if (!(vals[first] ?? "").trim()) return;
      onAdd(Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim() || null])));
      setVals(empty()); setOpen(false);
    }}>
      {fields.map((f) => f.options ? (
        <select key={f.name} className="lg-select" aria-label={f.placeholder} value={vals[f.name] ?? ""}
          onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input key={f.name} className="lg-input" type={f.type ?? "text"} placeholder={f.placeholder}
          aria-label={f.placeholder} value={vals[f.name] ?? ""} required={f.name === first}
          onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
      ))}
      <div className="lg-form-actions">
        <button type="submit" className="lg-btn">Add</button>
        <button type="button" className="lg-btn lg-btn-quiet" onClick={() => { setVals(empty()); setOpen(false); }}>Cancel</button>
      </div>
    </form>
  );
}

/** A button that asks once. The second tap within three seconds does it;
 *  otherwise it forgets, so a thumb that slips on a phone changes nothing. */
export function Danger({ label, aria, onConfirm }: { label: string; aria: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={`lg-btn lg-btn-quiet lg-act${armed ? " lg-act-armed" : ""}`}
      aria-label={armed ? `Confirm: ${aria}` : aria}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? "Sure?" : label}
    </button>
  );
}

/** An event time as a local day ("Mon Oct 5"). A full ISO stamp is UTC, so it is
 *  converted; a bare date is already local and is never shifted. */
export function fmtWhen(at: string): string {
  const s = (at ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const n = Date.parse(s);
    if (!Number.isNaN(n)) return fmtDeadline({ deadline: todayLocal(new Date(n)) });
  }
  const d = fmtDeadline({ deadline: s.slice(0, 10) });
  return d === "no date" ? s : d;
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

/** Today as local YYYY-MM-DD, for "touched today" and "added" stamps. */
export function todayLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Case-insensitive match of a query against any of the given strings. */
export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(s));
}
