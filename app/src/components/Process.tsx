import { peakOf } from "../rules";
import { ROPES } from "./Ropes";
import { DEMO } from "../seed";
import type { AppState, Counts, Person } from "../types";

const FLOW: [string, boolean, string][] = [
  ["Sources pull companies", true,
   "HN 'Who is hiring' once a month, The Next Play every week. Both are just job postings scraped into one file. Nothing here knows about people yet."],
  ["Enrich fills in the company", true,
   "What they build, where they are, remote policy, and the work-authorisation tier: Canada, remote-US, or US onsite. Runs Monday mornings."],
  ["Find a human at that company", true,
   "Two ways, both automatic, both verified. Read the commit authors on their public GitHub repos, or take an address the posting printed itself. This is the step that turns a company into a person. It never guesses an address."],
  ["Research one real fact", false,
   "You, five minutes, per person. Open their repo or their blog and find one specific true thing. This is the only step that decides whether the message reads as a person or as a mail merge, and it is the step that is actually short-staffed."],
  ["Send it", false,
   "You, by hand, one a day, two maximum. Nothing in this system has ever sent an email and nothing in it will."],
  ["Follow up on day 7", false,
   "Once. Never twice. A first follow-up lifts replies from about 4.1% to 6.6%; a second takes it to 6.9%, which is not worth the second ask. The app raises the flag on its own and tells you which channel you used."],
  ["Call, then the loop that actually works", false,
   "Thank-you inside 24 hours repeating what they said. Build the thing they told you to build. Two weeks later, send it. That last message is where referrals come from, and almost nobody sends it."],
];


/* Stage-to-stage conversion, which is the one number that says whether the
   messages are working. It reads `peak` rather than `status` so closing a
   thread out cannot flatter the rate. */
function Funnel({ people, state }: { people: Person[]; state: AppState }) {
  const at = (k: number) => people.filter((p) => peakOf(state.p[p.id]) >= k).length;
  const sent = at(2);

  if (!sent) {
    return (
      <div className="card">
        <h3>Nothing to measure yet.</h3>
        <p className="sm dim" style={{ marginBottom: 0 }}>
          The funnel starts the first time you mark one sent. Until then every rate on this page
          is zero over zero, which is not a bad score — it is no score.
        </p>
      </div>
    );
  }

  const replied = at(3);
  const rate = (100 * replied) / sent;
  const band: [string, string] =
    rate >= 10 ? ["t1", "top decile for cold email"]
    : rate >= 5 ? ["t1", "above the 3.4% average, which is where you want to be"]
    : rate >= 3.4 ? ["t3", "about the 3.4% cold-email average"]
    : ["t4", "under the 3.4% average — the fact is usually what is missing"];

  const rows: [string, number][] = [
    ["Messaged", sent], ["Replied", replied], ["Call booked", at(4)],
    ["Call happened", at(5)], ["Built the thing", at(6)],
  ];

  return (
    <div className="card">
      {/* On the published copy this is invented data, and a rate computed from
          eight invented people is not a result. Saying so is cheaper than
          having someone who knows the benchmarks assume the number is a claim. */}
      <h3>Reply rate: <span className={DEMO ? "dim" : band[0]}>{rate.toFixed(1)}%</span></h3>
      <p className="sm dim">
        {DEMO
          ? `${replied} of ${sent} answered — but these are twelve invented people, so the `
            + "number is a demonstration and not a result. On a real run this is the figure "
            + "that decides everything: the 2026 cold-email average is 3.4%, and above 10% is "
            + "top decile."
          : `${replied} of ${sent} answered — ${band[1]}.`}
      </p>
      {rows.map(([label, n]) => (
        <div key={label} style={{ marginBottom: 7 }}>
          <div className="sm" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{label}</span><span className="dim">{n}</span>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: "var(--sunk)", marginTop: 3 }}>
            <div style={{ height: 6, borderRadius: 99, background: "var(--go)", width: (100 * n) / sent + "%" }} />
          </div>
        </div>
      ))}
      <p className="sm dim" style={{ marginTop: 11, marginBottom: 0 }}>
        Below 3.4% the answer is almost never the template. It is that the message went to a role
        inbox, or that the specific fact was not specific.
      </p>
    </div>
  );
}

export function Process({ people, state, counts }:
  { people: Person[]; state: AppState; counts: Counts }) {
  const done = state.ropes || {};
  const n = Object.values(done).filter(Boolean).length;
  const named = people.filter((p) => p.name).length;
  const sent = people.filter((p) => {
    const s = state.p[p.id]?.status;
    return !!s && s !== "not contacted";
  }).length;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>What this actually is</h2>
      <div className="card">
        <p className="sm">
          The store holds <b>companies</b>, not founders. {counts.companies} of them. A company
          becomes contactable only when step 3 finds a human attached to it, and right now{" "}
          {counts.people} have one.
        </p>
        <p className="sm" style={{ marginBottom: 0 }}>
          Of those: <b>{named} are named people</b> found through commit authorship on the
          company's own repos, which at a ten-person startup is usually an engineer and often the
          founder. The rest are addresses the job posting printed — typically the founder or
          whoever is doing the hiring — and a handful are role inboxes like jobs@, which are not a
          person at all and should be treated as an application, not a conversation.
        </p>
      </div>

      <h2>Who you contact, and in what order</h2>
      <div className="card">
        <p className="sm"><b>Engineer or founder first. Recruiter last, and only warm.</b></p>
        <p className="sm dim" style={{ marginBottom: 0 }}>
          A cold message from a student is noise in a recruiter's stack of four hundred. The same
          message to an engineer, asking a specific question about a commit they wrote last week,
          is a conversation. Founders also receive roughly three times less outreach than
          directors and managers do, which is the whole reason small companies come first.
        </p>
      </div>

      <h2>The pipeline, end to end</h2>
      <ol className="flow">
        {FLOW.map(([h, auto, body], i) => (
          <li key={i} className={auto ? "" : "man"}>
            <h3 style={{ display: "inline" }}>{h}</h3>
            <span className={"tag" + (auto ? "" : " man")}>{auto ? "automatic" : "you"}</span>
            <p className="sm dim" style={{ marginTop: 5, marginBottom: 0 }}>{body}</p>
          </li>
        ))}
      </ol>

      <div className="warn">
        <b>Everything above step 4 is already built and running on a schedule.</b> The four
        automatic steps have produced {counts.people} contactable people and {counts.unworked} more
        companies waiting for a contact. The manual steps have produced <b>{sent} sent</b>. That
        ratio is the whole problem, and no amount of further automation moves it.
      </div>

      <h2>Is it working?</h2>
      <Funnel people={people} state={state} />

      <h2>The first two weeks</h2>
      <div className="card">
        <p className="sm" style={{ marginBottom: 0 }}>
          {n} of {ROPES.length} done. The checklist follows you across every tab now — it is
          the button in the bottom corner, showing whichever day you are on. It lived here
          for a while, at the foot of a page you read once, which is the wrong place for the
          one thing you are meant to look at daily.
        </p>
      </div>
    </div>
  );
}
