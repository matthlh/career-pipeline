/* Example data. Every person, company and domain below is invented, and the
   domains use the .example TLD reserved by RFC 2606, so nothing here resolves
   to a real company or a real person's inbox.
 *
 * Loaded only when data.js is absent - the real data.js is gitignored, because
 * it holds addresses belonging to actual people.
 */
window.SEED = window.SEED || {
 "generated": "example",
 "from": "you@example.com",
 "counts": {"people": 12, "researched": 5, "named": 8, "companies": 40, "unworked": 14},
 "people": [
  {"id":"dana@lantern.example","email":"dana@lantern.example","name":"Dana Okonkwo","first":"Dana",
   "company":"Lantern","domain":"lantern.example","repo":"lantern/lantern-core","method":"github_commits",
   "github":"dokonkwo","evidenceUrl":"https://github.com/lantern","roleInbox":false,"tier":"tier_2_remote",
   "what":"Incident timelines assembled from logs, traces and chat in one view.",
   "location":"Remote (US)","remote":"remote","stage":"series-a","mentionsIntern":true,
   "postingUrl":"https://example.com/posting/1","applyUrl":"https://example.com/apply/lantern",
   "fact":"Saw you moved the trace merge off the request path and into a background reducer, which reads like the kind of change you only make after an incident taught you to.",
   "ask":"how you decide what belongs on the hot path",
   "cite":"Commit to lantern/lantern-core on 2026-08-29: \"move trace merge into background reducer\" (#412).",
   "citeUrl":"https://github.com/lantern","score":173},

  {"id":"priya@stellwater.example","email":"priya@stellwater.example","name":"Priya Raghunathan","first":"Priya",
   "company":"Stellwater","domain":"stellwater.example","repo":"stellwater/tide","method":"github_commits",
   "github":"praghu","evidenceUrl":"https://github.com/stellwater","roleInbox":false,"tier":"tier_3_us_onsite",
   "what":"Forecasting for coastal infrastructure operators.","location":"New York, NY","remote":"onsite",
   "stage":"seed","mentionsIntern":false,"postingUrl":"https://example.com/posting/2","applyUrl":null,
   "fact":"You wrote the tide model's backfill so it replays historical gauge data through the same code path as live ingest, which is a discipline most forecasting stacks give up on early.",
   "ask":"how you keep backfill and live ingest from drifting apart",
   "cite":"Commit to stellwater/tide on 2026-08-21: \"replay backfill through live ingest path\" (#88).",
   "citeUrl":"https://github.com/stellwater","score":165},

  {"id":"marcus@fernbank.example","email":"marcus@fernbank.example","name":"Marcus Alvi","first":"Marcus",
   "company":"Fernbank Systems","domain":"fernbank.example","repo":"fernbank/ledger-rs","method":"github_commits",
   "github":"malvi","evidenceUrl":"https://github.com/fernbank","roleInbox":false,"tier":"tier_1_canada",
   "what":"Double-entry ledger infrastructure for fintechs.","location":"Toronto, ON","remote":"hybrid",
   "stage":"series-a","mentionsIntern":true,"postingUrl":"https://example.com/posting/3",
   "applyUrl":"https://example.com/apply/fernbank",
   "fact":"The ledger's reconciliation pass runs as a pure function over an event log, so a disagreement can be replayed instead of argued about.",
   "ask":"what you gave up to keep reconciliation pure",
   "cite":"Commit to fernbank/ledger-rs on 2026-09-01: \"reconciliation as pure fold over event log\" (#231).",
   "citeUrl":"https://github.com/fernbank","score":177},

  {"id":"wei@overtone.example","email":"wei@overtone.example","name":"Wei Nakamura","first":"Wei",
   "company":"Overtone","domain":"overtone.example","repo":"overtone/embed","method":"github_commits",
   "github":"weinak","evidenceUrl":"https://github.com/overtone","roleInbox":false,"tier":"tier_2_remote",
   "what":"Semantic search you drop into an existing product in an afternoon.",
   "location":"Remote (US)","remote":"remote","stage":"seed","mentionsIntern":false,
   "postingUrl":"https://example.com/posting/4","applyUrl":null,
   "fact":"You benchmark recall against a frozen eval set on every release and publish the number, which almost nobody in retrieval actually does in public.",
   "ask":"how you built the eval set and how often it goes stale",
   "cite":"Release notes, overtone/embed v0.9: recall@10 held at 0.82 across the frozen set.",
   "citeUrl":"https://github.com/overtone","score":169},

  {"id":"sam@pitchpine.example","email":"sam@pitchpine.example","name":"Sam Iyer","first":"Sam",
   "company":"Pitchpine","domain":"pitchpine.example","repo":"pitchpine/harvest","method":"github_commits",
   "github":"siyer","evidenceUrl":"https://github.com/pitchpine","roleInbox":false,"tier":"tier_3_us_onsite",
   "what":"Scheduling and payroll for seasonal agricultural crews.","location":"San Francisco, CA",
   "remote":"onsite","stage":"pre-seed","mentionsIntern":true,"postingUrl":"https://example.com/posting/5",
   "applyUrl":"https://example.com/apply/pitchpine",
   "fact":"Harvest stores shift changes as an append-only log so a crew lead's phone can go offline for a day and still reconcile.",
   "ask":"what offline-first costs you on the server side",
   "cite":"Commit to pitchpine/harvest on 2026-08-14: \"append-only shift log for offline reconcile\" (#57).",
   "citeUrl":"https://github.com/pitchpine","score":177},

  {"id":"tomas@bellwether.example","email":"tomas@bellwether.example","name":"Tomas Lindqvist","first":"Tomas",
   "company":"Bellwether Labs","domain":"bellwether.example","repo":"bellwether/probe","method":"github_commits",
   "github":"tlindqvist","evidenceUrl":"https://github.com/bellwether","roleInbox":false,"tier":"tier_2_remote",
   "what":"Load testing that replays real production traffic shapes.","location":"Remote","remote":"remote",
   "stage":"seed","mentionsIntern":false,"postingUrl":"https://example.com/posting/6","applyUrl":null,
   "fact":null,"ask":null,"cite":null,"citeUrl":null,"score":65},

  {"id":"nadia@quarterturn.example","email":"nadia@quarterturn.example","name":"Nadia Beaulieu","first":"Nadia",
   "company":"Quarterturn","domain":"quarterturn.example","repo":"quarterturn/api","method":"github_commits",
   "github":"nbeaulieu","evidenceUrl":"https://github.com/quarterturn","roleInbox":false,"tier":"tier_1_canada",
   "what":"Warehouse robotics fleet coordination.","location":"Vancouver, BC","remote":"onsite",
   "stage":"series-b","mentionsIntern":true,"postingUrl":"https://example.com/posting/7",
   "applyUrl":"https://example.com/apply/quarterturn",
   "fact":null,"ask":null,"cite":null,"citeUrl":null,"score":77},

  {"id":"ade@corvidae.example","email":"ade@corvidae.example","name":"Ade Fashola","first":"Ade",
   "company":"Corvidae","domain":"corvidae.example","repo":null,"method":"posting",
   "github":null,"evidenceUrl":"https://example.com/posting/8","roleInbox":false,"tier":"tier_2_remote",
   "what":"Bird-strike risk modelling for regional airports.","location":"Remote (US)","remote":"remote",
   "stage":"seed","mentionsIntern":false,"postingUrl":"https://example.com/posting/8","applyUrl":null,
   "fact":null,"ask":null,"cite":null,"citeUrl":null,"score":45},

  {"id":"rowan@saltmarsh.example","email":"rowan@saltmarsh.example","name":null,"first":"Rowan",
   "company":"Saltmarsh","domain":"saltmarsh.example","repo":null,"method":"posting","github":null,
   "evidenceUrl":"https://example.com/posting/9","roleInbox":false,"tier":"unknown",
   "what":"Compliance evidence collection for small banks.","location":"Boston, MA","remote":"hybrid",
   "stage":"series-a","mentionsIntern":false,"postingUrl":"https://example.com/posting/9","applyUrl":null,
   "fact":null,"ask":null,"cite":null,"citeUrl":null,"score":15},

  {"id":"founders@driftwood.example","email":"founders@driftwood.example","name":null,"first":"",
   "company":"Driftwood","domain":"driftwood.example","repo":null,"method":"posting","github":null,
   "evidenceUrl":"https://example.com/posting/10","roleInbox":false,"tier":"tier_3_us_onsite",
   "what":"Marketplace for surplus construction material.","location":"Austin, TX","remote":"onsite",
   "stage":"pre-seed","mentionsIntern":true,"postingUrl":"https://example.com/posting/10",
   "applyUrl":"https://example.com/apply/driftwood",
   "fact":null,"ask":null,"cite":null,"citeUrl":null,"score":33},

  {"id":"jobs@thornfield.example","email":"jobs@thornfield.example","name":null,"first":"",
   "company":"Thornfield","domain":"thornfield.example","repo":null,"method":"posting","github":null,
   "evidenceUrl":"https://example.com/posting/11","roleInbox":true,"tier":"tier_2_remote",
   "what":"Developer tooling for embedded Rust.","location":"Remote (EU)","remote":"remote",
   "stage":"seed","mentionsIntern":false,"postingUrl":"https://example.com/posting/11","applyUrl":null,
   "fact":null,"ask":null,"cite":null,"citeUrl":null,"score":4},

  {"id":"careers@windrow.example","email":"careers@windrow.example","name":null,"first":"",
   "company":"Windrow","domain":"windrow.example","repo":null,"method":"posting","github":null,
   "evidenceUrl":"https://example.com/posting/12","roleInbox":true,"tier":"unknown",
   "what":"Grid-scale battery dispatch optimisation.","location":"Denver, CO","remote":"onsite",
   "stage":"series-a","mentionsIntern":true,"postingUrl":"https://example.com/posting/12",
   "applyUrl":"https://example.com/apply/windrow",
   "fact":null,"ask":null,"cite":null,"citeUrl":null,"score":18}
 ]
};
