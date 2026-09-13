# Editorial playbook — AI Edge Briefing

You are producing today's edition of a daily briefing on frontier AI. The reader uses this as their single place to stay at the edge: the advances, the research, and how AI is being used for good and for harm — cyber, influence ops, military, health, science, policy. It is not a "fun uses of AI" newsletter. It is raw, factual, sourced.

The reader's standard: **every claim links to where it came from, every number is the number in the source, and nothing is written that the sources do not say.** If you cannot source it, it does not go in.

## 0. Setup

1. Work in the repo root. Determine today's date in **America/Toronto**: `TZ=America/Toronto date +%F`. That is the edition date, `DATE`.
2. `ls data/` — the previous edition tells you the cutoff. The coverage window (`WINDOW`) is from the previous edition's `generated_at` to now (if there is no previous edition, the 24 hours before now). Write it down as absolute timestamps in both UTC and ET; you will hand it to the subagents. Read the previous edition so you do not repeat it; a story already covered goes in again **only if there is a new development**, flagged `update`, and the bullets report only the new facts.
3. `node scripts/build.js --topics` — the existing topic slugs. Reuse them; only coin a new slug when nothing fits.
4. Every day is a daily edition, Mondays included. The week in review is a separate weekly edition with its own playbook (`PROMPT-WEEK.md`) and its own routine — never part of the daily file.

## 1. Sweep the sources — four beats in parallel

Read `SOURCES.md`. Then launch **four general-purpose subagents in one message** with the Agent tool, one per beat. Give each: the `WINDOW` as absolute timestamps, its beat's source list from `SOURCES.md`, the **Sourcing rules** below verbatim, and the return format. Tell each to run many searches (15–30) and to open the listed primary sources directly. If the Agent tool is unavailable, work the four beats yourself in turn — do not skip any.

- **Beat A — Frontier models & labs · Compute, chips & infrastructure · Deployment & impact (industry, funding, labor).** SOURCES.md §1, §7, §8.
- **Beat B — Research & papers (incl. safety, alignment, evals).** SOURCES.md §2. arXiv new listings (cs.AI, cs.LG, cs.CL, cs.CR, cs.CV, cs.RO), Hugging Face papers, alphaXiv, Nature/Science, lab research blogs, Epoch, METR, AISI, CAISI, Apollo, Redwood, Alignment Forum. Prefer papers with a notable quantitative result, from major labs/universities, or drawing significant attention. Return arXiv IDs and author institutions.
- **Beat C — Security, misuse & threat intelligence · Military, defense & geopolitics.** SOURCES.md §3, §4. AI-enabled intrusions and malware, fraud and scams, deepfakes, influence operations, surveillance, prompt injection and agent exploits, model theft / illicit distillation, bio/chem misuse reports; procurement, deployment, autonomous weapons, export controls, national strategies.
- **Beat D — Health, science & medicine · Policy, regulation & law.** SOURCES.md §5, §6. Clinical results, FDA/Health Canada/WHO actions, drug discovery, AI for science, biosecurity; legislation, regulation, enforcement, court rulings and filings, government reports, standards — US federal and state, EU, UK, Canada, China, international bodies.

**Subagent return format** — one block per item, then a short list of rejected candidates and why:

```
SECTION: <one of the eight section names>
HEADLINE: <factual, specific, max 18 words, no hype>
PUBLISHED: <date/time and timezone exactly as the source shows it>
SOURCES: one per line — <publisher> | <exact URL> | primary or report   (only URLs actually opened or seen in search results; never constructed)
FACTS: 2–5 bullets, each a verifiable fact from a linked source, numbers/units/baselines exactly as written, naming which source
FLAGS: company-claim | single-source | preprint | update  (any that apply)
```

**Sourcing rules (give to subagents verbatim):**
1. Only include facts that appear in a source you opened (WebFetch) or in the text of a search result. No inference, speculation, predictions or "this could mean". No hype adjectives.
2. Every item links to the specific article, paper or document — never a homepage or index page. Link the primary source whenever one exists (paper, company post, government document, filing, court record) plus independent reporting. Aim for 2+ sources on significant items; if only one outlet has it, flag `single-source`.
3. Confirm the publication date is inside the window. If the date cannot be determined, drop the item. Older stories qualify only if something new happened inside the window, and only the new facts are reported (flag `update`).
4. Attribute claims: "OpenAI says…", "according to The Record…". Company-reported benchmarks, user counts, revenue and capability claims get `company-claim` unless independently verified. Research that is not peer reviewed gets `preprint`.
5. Quote numbers exactly as the source writes them, with units and the comparison baseline. Do not round, convert or compute new figures.
6. If `WebFetch` refuses a page, fetch it directly with `node scripts/fetch.js <url>` — the sites we read have given permission for direct reads, and the fetcher identifies itself. Use only what the returned text actually says; if it comes back as a paywall stub, a login page or nothing usable, fall back to search-result text or another source and say in the bullet where the figures came from. Never use archive or cache sites, and never cite a URL whose content you did not see. Sites that refuse `WebFetch` are listed in SOURCES.md.
7. Skip consumer tips, "fun uses", prompt guides, listicles, opinion pieces without new facts, minor feature updates, unsourced rumours, and small funding rounds unless strategically notable (US$100M+, or a frontier lab / defense / health / security company).
8. When in doubt, leave it out.

After the beats return, run a few **gap-check searches** yourself for anything a beat may have missed (WebSearch: "AI" + Pentagon / drone; "AI" + FDA / hospital; "AI" + scam / deepfake / influence operation; "AI" + export controls / data center power; "AI" + lawsuit / ruling; plus Techmeme and Hacker News front page), restricted to the window.

## 2. Verify and select

Merge the beats' returns. De-duplicate across beats and against previous editions. Then, for each candidate:
- Open the primary source. Confirm the headline and every number/date/name you intend to use. A secondary report of a paper links the paper. A report of a court ruling links the ruling or docket where possible.
- Prefer two independent sources for anything contested, surprising, or about a specific actor (a named threat group, a company's claim about a rival, a casualty figure).
- Drop: opinion pieces without new facts, product marketing with no numbers, speculation, "could" / "may" stories, anything you cannot open, anything older than the window without a new development.
- Spot-verify: open (WebFetch, or `node scripts/fetch.js` if it refuses) the key source for every item you will mention in the summary and for every figure in the summary; confirm date, numbers and URL yourself. Remove anything you cannot confirm.
- Keep: model/system releases with benchmarks or capabilities; papers with a result (state the result); documented misuse and threat-intel reports (name actors, counts, dates); military and government procurement/deployment; clinical and scientific results; regulation, enforcement, court decisions; compute/chip/energy facts with figures; large-scale deployments and measured impacts, good or bad.

## 3. Write the edition — `data/DATE.json`

Schema (see `data/2026-09-11.json` for a full example once it exists):

```json
{
  "date": "YYYY-MM-DD",
  "edition": "daily",
  "generated_at": "<ISO-8601 UTC timestamp>",
  "window": "e.g. 10 Sep 11:00 → 11 Sep 11:00 UTC",
  "summary": ["paragraph 1", "paragraph 2"],
  "sections": [
    {
      "name": "<one of the eight section names below>",
      "items": [
        {
          "headline": "Specific, factual, one line — who did what, with the key number",
          "sources": [{ "name": "Anthropic", "url": "https://..." }, { "name": "Reuters", "url": "https://..." }],
          "bullets": ["What was announced/found, with numbers.", "Why it matters / what it changes.", "Caveats, what is unverified, what to watch."],
          "topics": ["anthropic", "threat-intel", "cyber-offense"],
          "impact": "beneficial" | "harmful" | "mixed" | "neutral",
          "flags": ["company-claim" | "single-source" | "preprint" | "update"]
        }
      ]
    }
  ]
}
```

**Section names** (exactly these; omit a section if it has nothing that day):
1. `Frontier models & labs` — releases, capabilities, benchmarks, lab announcements, safety cases, system cards.
2. `Research & papers` — papers with results: new methods, evals, interpretability, alignment, scaling. State the result and the number.
3. `Security, misuse & threat intelligence` — threat-intel reports, documented attacks using AI, influence operations, scams/deepfakes, model vulnerabilities, prompt injection, jailbreaks, agent security.
4. `Military, defense & geopolitics` — procurement, deployment, autonomous weapons, export controls, national strategies, China/US/EU competition.
5. `Health, science & medicine` — clinical results, FDA actions, drug discovery, AI-for-science results, hospital deployments and their measured outcomes.
6. `Policy, regulation & law` — legislation, regulation, enforcement, court rulings, government reports, standards.
7. `Compute, chips & infrastructure` — chips, fabs, datacenters, power, capex figures, funding rounds and deals with numbers.
8. `Deployment & impact` — large-scale rollouts, labor effects, measured societal effects, incidents, the good and the bad in practice.

**Summary**: 2–3 paragraphs, ~150–250 words. The three to five things that matter most today, stated as facts, with the numbers. No throat-clearing, no "in today's edition".

**Headlines**: one line, specific, factual. "Anthropic report: Russian state group GTG-20006 used Claude to automate espionage against Ukrainian and European governments" — not "Anthropic releases threat report".

**Bullets**: 2–4 per item. First bullet is the fact with the number. Then significance. Then caveats — say plainly what is unverified, what the source did not say, what to watch. Write in complete sentences. Never pad.

**Sources**: 1–4 per item, primary first. `name` is the publisher (Anthropic, arXiv, Reuters, FDA, Court docket), not the article title.

**Topics**: 1–4 lowercase-hyphen slugs per item. Reuse existing slugs (`node scripts/build.js --topics`). Canonical slugs to prefer: `anthropic`, `openai`, `google-deepmind`, `meta`, `xai`, `mistral`, `deepseek`, `qwen`, `nvidia`, `microsoft`, `amazon`, `apple`, `threat-intel`, `cyber-offense`, `cyber-defense`, `influence-ops`, `scams-fraud`, `deepfakes`, `prompt-injection`, `agents`, `agent-security`, `alignment`, `interpretability`, `evals`, `open-weights`, `reasoning-models`, `scaling`, `compute`, `chips`, `export-controls`, `energy`, `datacenters`, `china`, `eu-ai-act`, `us-federal-policy`, `us-state-policy`, `uk`, `copyright`, `privacy`, `military`, `autonomous-weapons`, `pentagon`, `healthcare`, `fda`, `drug-discovery`, `bio-risk`, `ai-for-science`, `robotics`, `labor`, `education`, `elections`, `surveillance`, `child-safety`, `incidents`, `funding`, `earnings`. Add an entity slug (company, agency, named group) when the story is about that entity.

**Impact** (optional but encouraged): `beneficial`, `harmful`, `mixed`, or `neutral` — the demonstrated effect in the story, not your prediction.

**Flags** (include every one that applies; omit the key if none): `company-claim` — a company-reported benchmark, user count, revenue or capability claim not independently verified; `single-source` — only one outlet has it; `preprint` — research not peer reviewed; `update` — a story covered in an earlier edition, with new facts only.

**Style**: plain, declarative, numbers over adjectives. Attribute claims ("Anthropic says", "the paper reports", "according to the filing"). No hype, no hedging language beyond what the sources support. British or American spelling — either, consistently.

**Absolute rules**:
- Never invent a URL, a number, a quote, a name, or a date. If unsure, open the source again.
- Never write a bullet you could not point to a sentence in the source for.
- Never link a URL you did not open in this session.
- Quote numbers exactly as the source writes them, with units and baseline. Never round, convert, or compute new figures.
- Link the specific article, paper or document — never a homepage or index page (the validator rejects these).
- If `WebFetch` refuses a page, `node scripts/fetch.js <url>` is the only other way to read it — never archive or cache sites. If that returns nothing usable, use another source or leave the item out.
- Do not editorialise beyond stating why something matters.

## 3b. Write the podcast script — `data/DATE.script.json`

Each edition is also a podcast episode. Two hosts discuss the edition; the audio is synthesized later by GitHub Actions. The script is allowed only if it is **locked to the edition** — `scripts/validate-script.js` enforces it, and if the script does not pass, the episode is narrated by code straight from the JSON instead. So: nothing in the script may go beyond what `data/DATE.json` says.

Schema:

```json
{
  "date": "DATE", "format": "dialogue",
  "hosts": { "A": { "name": "Maya", "voice": "marin" }, "B": { "name": "Alex", "voice": "cedar" } },
  "blocks": [
    { "type": "intro", "lines": [ { "host": "A", "text": "..." }, { "host": "B", "text": "..." } ] },
    { "type": "transition", "lines": [ { "host": "B", "text": "..." } ] },
    { "type": "item", "section": "<section name>", "headline": "<exact headline from the edition>", "lines": [ { "host": "A", "text": "..." }, { "host": "B", "text": "..." } ] },
    { "type": "outro", "lines": [ ... ] }
  ]
}
```

How to write it:
- **Input is only the edition JSON.** Never add a fact, number, name, date, comparison or interpretation that is not in the item's headline or bullets. If the hosts want context, it must be context the item already contains.
- **Write for the ear — people read differently than they write.** Contractions, short sentences, one idea per line, no lists read out, no arXiv IDs, no bracketed asides. Units in words where a person would say them ("37 kilometres", "$664 billion"). One host asks the natural question, the other answers with the number and the caveat. Say who reported it, by the source `name` in the item ("Anthropic says…", "The Record reports…"). Alternate hosts; no host speaks more than 4 lines in a row; no line over 600 characters.
- **Numbers as digits**, exactly as in the item ("$664 billion", "8,913 articles", "37.0 km"). Never as words. Transitions and outros contain no numbers at all. The intro may use numbers only from the edition summary.
- **Caveats are mandatory.** An item flagged `company-claim` must be said as a company claim / not independently verified; `single-source` → "a single source" / "only one outlet"; `preprint` → "preprint" / "not peer reviewed"; `update` → say it is an update. If the bullets carry a caveat ("unverified", "did not say", "could not confirm"), the hosts voice it.
- **No speculation or hype.** Banned: "I think", "probably", "could mean", "imagine if", "huge", "massive", "insane", "crazy", "wild", "scary", "exciting", "incredible", "game-changer", "revolutionary", and the like. State what happened and why it matters as the item states it.
- **Intro (required, checked by the validator)**, in this order: (1) the date **the way it is spoken** — `Friday, September 11th` (or "Friday the 11th of September"), never "11 September"; (2) the show name and presenter exactly once: "this is The AI Edge, presented by Epilogue"; (3) each host introduces themselves by name in their own line ("I'm Maya." / "And I'm Alex."); (4) one line disclosing the voices are AI; (5) one or two lines of context in plain speech — that this is the last 24 hours in frontier AI, the advances, the research, and how it's being used for good and for harm, with every claim sourced — vary the wording, don't recite a tagline; (6) the three things that matter most, from the summary. The audio inserts a pause after the intro before the news. **"Epilogue" must not appear anywhere else in the script** — no plugs, no sign-off mention.
- **Every date is spoken, month first with an ordinal**: "September 10th", "August 3rd and 5th", "December 31st, 2028". Never "10 September". The validator rejects day-first dates.
- **Structure**: intro → every section in edition order, each with ≥1 item block, ≥8 item blocks in total → outro.
- **Outro (required)**: wrap up in a line or two, say the full edition with a link to every source is on the site (never read a URL), and remind listeners to **listen in tomorrow** for the next edition. The show name may be repeated here ("That's The AI Edge for today").
- **Length**: 1,300–2,300 words (~10–15 min).

Then:
1. `node scripts/validate-script.js data/DATE.script.json` — fix every ERROR until it exits 0.
2. Launch one general-purpose subagent as an adversarial fact-checker. Give it the full contents of `data/DATE.json` and `data/DATE.script.json` and this instruction: *"For every statement in the script, find the sentence in the edition that supports it. List every statement that is not supported, adds a detail, changes a number, softens or drops a caveat, or characterises something the edition does not — quote the script line and the closest edition text. If everything is supported, reply exactly: NO UNSUPPORTED STATEMENTS."* Fix everything it lists, re-run the validator, and repeat — up to 3 rounds.
3. If it still cannot be made clean, delete `data/DATE.script.json` and say so in your report; the episode will be narrated from the edition text instead. A missing script is acceptable; an unlocked script is not.

## 4. Validate, build, publish

```
node scripts/validate.js data/DATE.json --check-links
```
Fix every ERROR (a 404/410 means you must find the real URL or remove the item). For every WARN about a link that could not be verified, confirm it with `WebFetch` or `node scripts/fetch.js`; if it does not open either way, replace or remove it. Then:

```
node scripts/validate-script.js data/DATE.script.json   # if the script exists
node scripts/build.js
git add data/DATE.json data/DATE.script.json trace/
git commit -m "Edition DATE"
git push origin main
```

`trace/DATE.jsonl` and `trace/DATE.transcript.jsonl` are written automatically by a Claude Code hook (`scripts/trace-hook.js`, wired in `.claude/settings.json`) — every tool call you and your subagents make is recorded there and published at `/DATE/trace/`. Do not edit those files. Always `git add trace/` with the edition.
GitHub Actions builds and deploys the site to https://aiedgebriefing.com/ within a few minutes, and synthesizes the podcast episode (`scripts/podcast.js`) from your script — or from the code-generated narration if the script is missing or fails validation. The page for this edition will be `https://aiedgebriefing.com/DATE/`; the episode script at `/DATE/script/`.

If the push is rejected, `git pull --rebase origin main` and push again. Do not open a pull request; the edition must land on `main`.

## 5. The week in review is not part of the daily

Every edition, Mondays included, is a daily edition: `"edition": "daily"`, no `week_in_review` key. The Week in Review — what happened across the week, what connects, what we don't know — is a separate weekly edition written by its own routine on Monday mornings from `PROMPT-WEEK.md` into `data/DATE.week.json`. Do not attempt it here.

## 6. Send the email

After the push, send one email via the Gmail tool:
- **to**: the reader's address given in the routine prompt (never write it into this repo — the repo and the trace are public)
- **subject**: the contents of `site/email/DATE.subject.txt`
- **htmlBody**: the contents of `site/email/DATE.html`
- **body** (plain-text alternative): the contents of `site/email/DATE.txt`

Read those files after `node scripts/build.js` and pass their contents verbatim. Do not rewrite the email by hand; the built files are the email.

## 7. Commit the rest of the trace, then report

The email step above is also recorded in the trace. Commit it so the published trace is complete:

```
git add trace/ && git commit -m "Trace DATE" && git push origin main
```

Finish with a short report: number of items, sections used, any sources you could not reach, any items you dropped for lack of verification, whether the podcast script passed the validator and the fact-check (or was deleted), and the commit hash. If anything failed (push, email), say exactly what and why.
