import { useState } from "react";
import { SUBJ_BAD, SUBJ_GOOD, WORDS_BAD, WORDS_GOOD, words } from "./rules";
import { FROM } from "./seed";
import type { Msg } from "./templates";
import type { Person, Tier } from "./types";

/* ============================ small shared pieces ====================== */

export const TIER: Record<Tier, [string, string]> = {
  tier_1_canada: ["Canada", "t1"],
  tier_2_remote: ["Remote US", "t2"],
  tier_3_us_onsite: ["US onsite", "t3"],
  unknown: ["?", "tu"],
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string): void {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 1500);
}

export function copy(text: string, msg?: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast(msg || "Copied"),
    () => toast("Copy failed - select the text instead"),
  );
}

export function gmailUrl(to: string, subject: string | undefined, body: string): string {
  return "https://mail.google.com/mail/?view=cm&fs=1"
    + "&to=" + encodeURIComponent(to)
    + "&su=" + encodeURIComponent(subject || "")
    + "&body=" + encodeURIComponent(body || "")
    + "&authuser=" + encodeURIComponent(FROM);
}

export function linkedinUrl(p: Pick<Person, "name" | "company">): string {
  const q = p.name ? p.name + " " + p.company : p.company;
  return "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(q);
}

export function alumUrl(p: Pick<Person, "company">): string {
  return "https://www.linkedin.com/search/results/people/?keywords="
    + encodeURIComponent(p.company + " University of British Columbia");
}

/* The same funnel as public/favicon.svg, inline so it takes the theme's accent
   rather than shipping a second copy of the palette. 765 companies narrow to
   188 people narrow to one message a day - the mark is the argument. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32"
         role="img" aria-label="Outreach">
      <rect width="32" height="32" rx="8" fill="var(--go)" />
      <path fill="var(--go-ink)"
        d="M7.2 8.4h17.6a1 1 0 0 1 .78 1.63L18.6 18.4v6.1a1 1 0 0 1-.55.9l-3.4 1.7a1
           1 0 0 1-1.45-.9V18.4L6.42 10.03A1 1 0 0 1 7.2 8.4Z" />
    </svg>
  );
}

export function Pills({ p }: { p: Person }) {
  const tier = TIER[p.tier] ?? TIER.unknown;
  return (
    <span className="row" style={{ gap: 5, display: "inline-flex" }}>
      <span className={"pill " + tier[1]}>{tier[0]}</span>
      {p.mentionsIntern && <span className="pill t1">intern</span>}
      {p.roleInbox && <span className="pill tu">role inbox</span>}
      {p.method === "github_commits" && <span className="pill t2">github</span>}
    </span>
  );
}

export function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [hit, setHit] = useState(false);
  return (
    <button
      className={"copy" + (hit ? " done" : "")}
      onClick={() => { copy(text); setHit(true); setTimeout(() => setHit(false), 1400); }}
    >
      {hit ? "Copied" : label || "Copy message"}
    </button>
  );
}

/* Length feedback, never length enforcement. The thresholds are measured reply
   and open rates and the gaps are steep enough to be worth seeing before you
   hit send. It deliberately has no disabled state: the message you did not send
   replies at zero, which is worse than any number below. */
export function MsgMeter({ msg }: { msg: Msg }) {
  if (msg.limit) {
    const over = msg.text.length > msg.limit;
    return (
      <div className="sm" style={{ marginBottom: 8 }}>
        <span className={over ? "t4" : "t1"}>{msg.text.length} / {msg.limit} characters</span>
        {over && <span className="dim"> — LinkedIn truncates silently past the limit.</span>}
      </div>
    );
  }
  const w = words(msg.text);
  const wcls = w <= WORDS_GOOD ? "t1" : w <= WORDS_BAD ? "t3" : "t4";
  const wnote = w <= WORDS_GOOD ? "under 100, the band that replies at 11.9%"
    : w <= WORDS_BAD ? "100-200 words replies at 1.9%. Cut a sentence."
    : "over 200 replies at 0.3%. Cut it in half.";
  const sl = msg.subject ? msg.subject.length : 0;
  const scls = sl <= SUBJ_GOOD ? "t1" : sl <= SUBJ_BAD ? "t3" : "t4";
  return (
    <div className="sm" style={{ marginBottom: 8 }}>
      <span className={wcls}>{w} words</span> <span className="dim">— {wnote}</span>
      {msg.subject && (
        <>
          <br />
          <span className={scls}>subject {sl} characters</span>
          <span className="dim">
            {sl <= SUBJ_GOOD ? " — under 30, which opens at 83.7%"
              : " — under 30 opens at 83.7%, over 70 at 69.5%"}
          </span>
        </>
      )}
    </div>
  );
}
