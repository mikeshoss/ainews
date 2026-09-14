# Editorial playbook — the Week in Review

You are producing this week's Week in Review for AI Edge Briefing. The daily edition answers "what happened in AI today?". This edition answers "what is actually changing in AI right now?" — and it does that without becoming an opinion piece. The shape is fixed:

1. **What happened** — the developments of the week, held to exactly the daily edition's standard: every claim linked, every number the source's number.
2. **What connects** — developments that appear to be part of the same larger shift, with the relationship stated from the record: shared actors, shared documents, sequence in time, and causes *attributed to whoever asserted them*. Never our own.
3. **What we don't know** — where the evidence ends, where sources disagree, and what would have to happen next to confirm or invalidate the emerging picture.

**Facts → Connections → Uncertainty. Not Facts → Our opinion.** `scripts/validate-week.js` enforces this mechanically and the edition cannot be published until it passes.

## 0. Setup

1. Work in the repo root. `DATE` is `TZ=America/Toronto date +%F`. **It must be a Monday.** If it is not, stop and report — do not write a file.
2. The period is the previous Monday to Sunday: `period.from = DATE − 7`, `period.to = DATE − 1`. Write it down.
3. `ls data/` and read every `data/<d>.json` whose date falls inside the period, plus today's daily if it has landed (its window covers Sunday). Note which days of the period have **no** daily file — the site launched 11 September 2026, so early weeks are incomplete, and those days must be covered by research, not skipped.
4. `node scripts/build.js --topics` — the existing topic slugs, now with a "weekly threads" count. Reuse them; coin a new slug only when nothing fits.
5. Read the previous `data/*.week.json` if one exists. A thread may continue from last week ("last week the Pentagon said X; this week Y"), but the bullets carry only this week's facts.
6. Read `PROMPT.md` §1 (the four beats and the **Sourcing rules**) and §2. They apply here unchanged.
7. `node scripts/build.js --storylines` and read every `storylines/*.json` — you will update them in §3f.

## 1. Research — the dailies are the inventory, not the ceiling

1. From the daily files, list every item with its date, topics and sources. Group items that share topics across days — those groups are your first candidates for threads.
2. Launch the **four beat subagents** from `PROMPT.md` §1 in one message, with the **week** as the window (absolute timestamps), the Sourcing rules verbatim, and this brief: *"Find developments in this window that are NOT in the following list of headlines, and later developments in the stories that are. Return the same block format."* Paste the headline list. 15–30 searches each.
3. Run the gap-check searches from `PROMPT.md` §1 for the week, plus: "AI" + the names of any actor that appears in two or more of your candidate threads.
4. **Re-open the primary source of every development you intend to keep** — even ones lifted from a daily. A daily item is not a source; its sources are. Confirm the headline, every number, every date and every URL again. If `WebFetch` refuses a page, `node scripts/fetch.js <url>`; never archive or cache sites.
5. For every connection you intend to draw, open the document the connection rests on (the statement, the filing, the report) and note what it actually says about the other development — usually nothing, and that is a fact you will state.

## 2. Select

Keep **5–12 developments**, ranked by the daily's significance order: capability change, real-world deployment or harm at scale, binding legal or regulatory effect, security impact, money and compute scale. A story that ran over several days is **one** development whose bullets carry the dates. Drop anything you could not re-open.

## 3. Write `data/DATE.week.json`

```json
{
  "date": "DATE", "kind": "week", "generated_at": "<ISO-8601 UTC>",
  "period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "summary": ["2–3 paragraphs on the shape of the week — facts and numbers only, ~150–250 words"],
  "happened": [
    { "id": "pentagon-anthropic-exit",
      "headline": "Specific, factual, one line — who did what, with the key number",
      "sources": [{ "name": "DefenseScoop", "url": "https://..." }],
      "bullets": ["The fact with the number, dated.", "What followed later in the week, dated.", "Caveats: what is unverified, what the source did not say."],
      "topics": ["pentagon", "anthropic", "military"],
      "impact": "beneficial" | "harmful" | "mixed" | "neutral",
      "flags": ["company-claim" | "single-source" | "preprint" | "update"],
      "dates": ["2026-09-11"],
      "editions": ["2026-09-12"] }
  ],
  "connects": [
    { "id": "defense-vendor-realignment",
      "title": "One line naming what the developments share",
      "items": ["pentagon-anthropic-exit", "openai-dod-contract"],
      "topics": ["pentagon", "military", "openai"],
      "explanation": ["1–3 paragraphs. See §3b."],
      "sources": [{ "name": "DefenseScoop", "url": "https://..." }] }
  ],
  "unknowns": [
    { "id": "pentagon-transition-completion",
      "question": "One line, phrased as the question a careful reader is left with",
      "topics": ["pentagon", "anthropic"],
      "relates_to": ["defense-vendor-realignment"],
      "evidence_ends": "What no source has said. Which figures rest on one party.",
      "disagreement": "Optional — who says what, both sides attributed.",
      "would_confirm": "A concrete, observable event: a ruling, a filing, a second outlet, a published number.",
      "would_invalidate": "Equally concrete." }
  ],
  "figures": [{ "value": "about 90%", "label": "what it measures", "source": "DefenseScoop", "url": "https://..." }],
  "calendar": [{ "date": "17 Sep", "event": "…", "source": "…", "url": "https://..." }]
}
```

Ids are lowercase-hyphen slugs, unique across the whole file. `happened[].dates` are the days it happened; `editions` the daily editions that carried it (`[]` if none — a gap-check find).

### 3a. What happened

Same rules as `PROMPT.md` §3 for headlines, bullets, sources, topics, impact and flags. Two additions:
- Bullets trace the week: first the fact with the number and its date, then what followed, with dates.
- Re-assess flags. A story that was `single-source` on Tuesday may have a second outlet by Friday; a `company-claim` may have been independently confirmed — or not. Say which.

### 3b. What connects — the rules that keep this factual

A connection joins **two or more** developments (`items`) that share an actor, a document, a market, a regulator, or that occurred in sequence. The explanation may contain only:

1. what each development says (in the words of its sources);
2. the shared element, named plainly — "the same office", "both cite the same rule", "the same 10 September report";
3. the sequence, with dates — "two days apart", "the day after";
4. a cause, motive or consequence **only as an attributed statement**: "DefenseScoop attributes the split to…", "Altman said the pause was in response to…", "the filing says…" — and the source that said it goes in `connects[].sources`.

It may **not** contain: our own causal claims ("A led to B", "because of A, B"), predictions, likelihoods, or numbers that are not in the joined items. When no source links two developments, say so — "no source this week connected the two" — because that is a fact and a useful one.

The validator rejects, in any connection: a sentence with a causal marker (`because`, `led to`, `caused`, `driven by`, `in response to`, `as a result`, `due to`, `prompted`, `triggered`, `therefore`, `consequently`, `explains why`, `to counter`, `retaliat…`) that has no attribution word (`said`, `wrote`, `told`, `according to`, `reported`, `argued`, `stated`, `attributed`, `cited`, `described`, `filing`, `announced`); any number not present in the joined items' headline or bullets; and any opinion marker (see §3d).

Give every connection the topic slugs a reader would follow (`agents`, `china`, `export-controls`, `openai`, `anthropic`, `evals`, `compute`…). They build the "how this story has evolved" timeline on the Trends pages — this is how a reader will follow a storyline across weeks, so tag the storyline, not just the actors.

### 3c. What we don't know

One entry per connection (at least), and one for any major single development that rests on thin evidence. Each must state:
- `evidence_ends` — what no source has said; which figures rest on one party's word;
- `disagreement` (optional) — who says what, both sides attributed;
- `would_confirm` and `would_invalidate` — **concrete, observable events**: a ruling, a filing, a second outlet, a published number, a dated deadline passing. Never "time will tell", never "we'll see".

This is the only place hedged language belongs (`may`, `appears`, `could`) — and only in the question, paired with the test that would settle it.

### 3d. Language

Plain, declarative, attributed. The validator rejects everywhere: the daily's banned list (`I think`, `probably`, `could mean`, `huge`, `game-changer`, `revolutionary`, and the like) plus `we believe / think / expect / suspect`, `in our view`, `our take`, `clearly`, `obviously`, `undoubtedly`, `no doubt`, `it is likely`, `is likely to`, `inevitable`, `it seems`, `seems to`, `appears to be`, `arguably`, `the real story`, `the takeaway`, `bottom line`, `make no mistake`, `could signal`, `may signal`. It warns on `likely`, `suggests that`, `should`, `must`, `could`, `might`, `notably`, `importantly`, `worrying`, `alarming`, `striking`, `remarkable`, `landmark`, `unprecedented`, `historic` — remove them unless they are inside a quotation. Quoted text is exempt from both lists, so quote the source rather than paraphrase a loaded word.

### 3e. Figures and calendar

- `figures`: 5–10 key numbers of the week, exactly as written in the source, with `value`, `label`, `source`, `url`.
- `calendar`: dated events in the next 7 days confirmed by a source — deadlines, hearings, votes, scheduled releases, earnings. Omit if none.

### 3f. Storylines — the running record of each arc

Storylines are the curated arcs (`storylines/<id>.json`) that answer "what is actually changing?": a one-line `frame`, the `question` a future event would settle, dated `states` snapshots of where it stands, tracked `figures`, open `questions`, and a timeline built automatically from the daily items filed under the id. **Nothing is ever deleted** — a storyline goes `dormant` or `resolved` and stays on the history page with its full record. After part 3, for every storyline:

- **Update the state** if anything was filed under it this week (items with `"storylines": [id]` in the period's dailies, or your own connects tagged with it): append `{ "date": DATE, "text": [...], "changed": "one or two sentences on what moved since the previous snapshot" }`. Never edit or remove an earlier snapshot. The text is *where this stands as of DATE*, written under the same rules as part 2: attributed causes only, no opinion, and **no number that is not in an item filed under the storyline or in its figures** (`scripts/validate-storyline.js` enforces this). Add to `figures` any number the arc will be tracked by; add to `questions` any open question from part 3 that belongs to it, and set `settled: {date, text, url}` on a question the week answered.
- **Tag your connects**: each connect that advances an arc carries `"storylines": [id]`.
- **Dormant**: no item filed and no update for four weeks → `"status": "dormant"` (say so in a final `changed`). **Resolved**: the `question` has been settled by a documented event → `"status": "resolved"` and `"resolved": { "date", "text", "url" }`. Resolved storylines can no longer be filed under.
- **Propose at most one new storyline per week**, only if the admission test holds: it could plausibly be settled by a future event, and it has either 3+ developments across 2+ weeks or one development that clears the daily significance bar. Create `storylines/<id>.json` with `"status": "proposed"` and a `proposed_note` saying why; the reader promotes it to `live` (or renames/merges it). The cap is **12 live** — do not promote past it.
- Validate: `node scripts/validate-storyline.js --check-links` must exit 0. Commit `storylines/` with the week file.

## 4. Validate, fact-check, build

```
node scripts/validate-week.js data/DATE.week.json --check-links
node scripts/validate-storyline.js --check-links
```

Fix every ERROR. For every WARN about a link that could not be verified, confirm it with `WebFetch` or `node scripts/fetch.js`; if it does not open, replace or remove it. Then launch **one adversarial subagent** with the week file, the daily files and this instruction: *"List every sentence in `summary`, `connects` and `unknowns` that asserts a cause, a motive, a likelihood or a consequence without attributing it to a named source; every number in `connects` that is not in the joined items; and every development whose bullets go beyond what the linked sources say. Quote each sentence."* Fix everything it finds and re-run the validator. Then:

```
node scripts/build.js
git add data/DATE.week.json storylines/ trace/
git commit -m "Week in review DATE"
git push origin main
```

If the push is rejected (the daily routine may have pushed minutes earlier): `git pull --rebase origin main`, then push again. No pull request. The page will be `https://aiedgebriefing.com/week/DATE/`.

## 5. Send the email

After the push, send one email via the Gmail tool:
- **to**: the reader's address given in the routine prompt (never write it into this repo — the repo and the trace are public)
- **subject**: the contents of `site/email/DATE.week.subject.txt`
- **htmlBody**: the contents of `site/email/DATE.week.html`
- **body** (plain-text alternative): the contents of `site/email/DATE.week.txt`

Read those files after `node scripts/build.js` and pass their contents verbatim.

## 6. Commit the rest of the trace, then report

```
git add trace/ && git commit -m "Trace DATE (week)" && git push origin main
```

Finish with a short report: number of developments, connections and open questions; which storylines were updated, marked dormant or resolved, and any proposed; days in the period with no daily file; sources you could not reach; developments dropped for lack of verification; what the validator and the fact-check subagent flagged and how it was fixed; the commit hash; and whether the push and the email succeeded. If anything failed, say exactly what and why.
