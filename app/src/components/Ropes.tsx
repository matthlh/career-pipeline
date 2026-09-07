import { useEffect, useRef, useState } from "react";

/* The first two weeks, lifted out of the Process tab.
   
   It lived at the bottom of a page about how the pipeline works, which is the
   page you read once. The checklist is the opposite: one item a day, every day,
   and the whole point is that it is in front of you when you sit down. So it
   travels with every tab instead of living on one you have no reason to revisit. */

export const ROPES: [string, string][] = [
  ["Send one message", "Open Today, take the top card, hit copy, send it. One. The point is to break the seal, not to be good at it."],
  ["Send three, and mark them", "Same flow. Mark each one sent so the 7-day follow-up clock starts. You're learning what a good specific fact looks like, which is the only skill here."],
  ["Do the UBC alum check on all three", "LinkedIn, company page, People tab, filter School: UBC. Notice how much better an alum thread feels. Toggle Alum on the card and the template changes."],
  ["Find your own fact", "Take a card with no researched fact. Open their repo, read the last few commits, pick one real thing. Five minutes. Do this until it feels fast."],
  ["Five quick-applies in 15 minutes", "Volume tier. workatastartup.com and the GitHub Summer 2027 lists. No tailoring. Time yourself so you learn it's genuinely three minutes each."],
  ["First Sunday review", "Open People, sort by Follow up. Anything 7+ days with no reply gets template 4, once. Count what you sent. Say the number out loud to a person."],
  ["Reply triage", "By now something has come back. Mark it Replied. A no is data, not a failure. Two unanswered touches means dead, move on."],
  ["Ask question 3 on a call", "\"If you were me, what would you build in the next month?\" That answer is the spec for template 6, which is where referrals actually come from."],
  ["Send template 5 within 24h", "After any call. Repeat back exactly what they said. This is the message that converts and almost nobody sends it."],
  ["Build the thing", "One weekend. Whatever they told you in question 3. It doesn't need to be big, it needs to exist."],
  ["Send template 6", "Two weeks after the call. You said X, I built it, here's the link. Do not ask for the referral. Roughly half the time it's offered."],
  ["Steady state", "You now know the loop. Five applies, one real message, one problem, every day. Never miss two days in a row."],
];

export function RopesPanel({ done, setRope }:
  { done: Record<number, boolean>; setRope: (i: number, on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const n = Object.values(done).filter(Boolean).length;
  /* The next unticked item. This is the only one that matters today, so the
     button carries it and the panel opens scrolled to it. */
  const next = ROPES.findIndex((_, i) => !done[i]);
  const finished = next === -1;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <>
      <button ref={button} className={"ropes-fab" + (open ? " on" : "")}
        aria-expanded={open} aria-controls="ropes-panel"
        onClick={() => setOpen(!open)}
        title={finished ? "The first two weeks: done" : "Next: " + ROPES[next]![0]}>
        <span className="ropes-fab-count">{finished ? "✓" : n + "/" + ROPES.length}</span>
        <span className="ropes-fab-text">
          {finished ? "All twelve done" : ROPES[next]![0]}
        </span>
      </button>

      <div id="ropes-panel" ref={panel} className={"ropes-panel" + (open ? " on" : "")}
        role="dialog" aria-label="The first two weeks" aria-hidden={!open}>
        <div className="ropes-head">
          <div>
            <h3 style={{ margin: 0 }}>The first two weeks</h3>
            <div className="sm dim">
              {n} of {ROPES.length} done. One per day, and they are in this order for a reason.
            </div>
          </div>
          <button className="tiny ghost" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>

        <div className="ropes-body">
          {ROPES.map(([h, body], i) => (
            <div key={i} className={"chk" + (done[i] ? " on" : "") + (i === next ? " now" : "")}
              onClick={() => setRope(i, !done[i])}>
              <div className={"box" + (done[i] ? " on" : "")}>✓</div>
              <div className="ct">
                <b className="sm">Day {i + 1}. {h}</b>
                <div className="sm dim">{body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
