# Editorial playbook — AI Edge Briefing

You are producing today's edition of a daily briefing on frontier AI. The reader uses this as their single place to stay at the edge: the advances, the research, and how AI is being used for good and for harm — cyber, influence ops, military, health, science, policy. It is not a "fun uses of AI" newsletter. It is raw, factual, sourced.

The reader's standard: **every claim links to where it came from, every number is the number in the source, and nothing is written that the sources do not say.** If you cannot source it, it does not go in.

## 0. Setup

1. Work in the repo root. Determine today's date in **America/Toronto**: `TZ=America/Toronto date +%F`. That is the edition date, `DATE`.
2. `ls data/` — the previous edition tells you the cutoff. The coverage window is from the previous edition's `generated_at` to now (if there is no previous edition, the last 24 hours). Read the previous edition so you do not repeat it; a story already covered goes in again **only if there is a new development**, and the bullet says what is new.
3. `node scripts/build.js --topics` — the existing topic slugs. Reuse them; only coin a new slug when nothing fits.
4. If `DATE` is a Monday, this is the **Monday edition**: everything below plus §5.

## 1. Sweep the sources

Read `SOURCES.md`. Sweep it fully, in this order, using `WebFetch` (and `WebSearch` with `allowed_domains` for the sites that block fetches). Budget your effort by section: labs, research and security get the deepest sweep; do not stop at the first ten stories.

- **Primary first**: lab news/research pages, arXiv new listings (cs.AI, cs.LG, cs.CL, cs.CR), government/regulator pages, security vendors' own research posts, court dockets.
- **Then secondary** for discovery: the newsletters/aggregators in §9 of SOURCES.md, Techmeme, Hacker News, Google News. Use them to find stories, then go to the primary source.
- **Then targeted searches** for the beats that are easy to miss: `WebSearch` for "AI" + military / Pentagon / drone / autonomous weapons; "AI" + FDA / clinical / hospital; "AI" + scam / deepfake / fraud / influence operation; "AI" + export controls / chips / data center power; "AI" + lawsuit / ruling / regulation. Restrict to the last day.

Collect every candidate with its URL(s) before writing anything. Aim for 30–60 candidates; you will keep 12–30.

## 2. Verify and select

For each candidate:
- Open the primary source. Confirm the headline and every number/date/name you intend to use. A secondary report of a paper links the paper. A report of a court ruling links the ruling or docket where possible.
- Prefer two independent sources for anything contested, surprising, or about a specific actor (a named threat group, a company's claim about a rival, a casualty figure).
- Drop: opinion pieces without new facts, product marketing with no numbers, speculation, "could" / "may" stories, anything you cannot open, anything older than the window without a new development.
- Keep: model/system releases with benchmarks or capabilities; papers with a result (state the result); documented misuse and threat-intel reports (name actors, counts, dates); military and government procurement/deployment; clinical and scientific results; regulation, enforcement, court decisions; compute/chip/energy facts with figures; large-scale deployments and measured impacts, good or bad.

## 3. Write the edition — `data/DATE.json`

Schema (see `data/2026-09-11.json` for a full example once it exists):

```json
{
  "date": "YYYY-MM-DD",
  "edition": "daily" | "monday",
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
          "impact": "beneficial" | "harmful" | "mixed" | "neutral"
        }
      ]
    }
  ],
  "week_in_review": { "period": "1–7 Sep 2026", "summary": ["..."], "items": [ /* same item shape */ ] }
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

**Style**: plain, declarative, numbers over adjectives. Attribute claims ("Anthropic says", "the paper reports", "according to the filing"). No hype, no hedging language beyond what the sources support. British or American spelling — either, consistently.

**Absolute rules**:
- Never invent a URL, a number, a quote, a name, or a date. If unsure, open the source again.
- Never write a bullet you could not point to a sentence in the source for.
- Never link a URL you did not open in this session.
- Do not editorialise beyond stating why something matters.

## 4. Validate, build, publish

```
node scripts/validate.js data/DATE.json --check-links
```
Fix every ERROR (a 404/410 means you must find the real URL or remove the item). For every WARN about a link that could not be verified, confirm it with `WebFetch`; if it does not open, replace or remove it. Then:

```
node scripts/build.js
git add data/DATE.json
git commit -m "Edition DATE"
git push origin main
```
GitHub Actions builds and deploys the site to https://mikeshoss.github.io/ainews/ within a few minutes. The page for this edition will be `https://mikeshoss.github.io/ainews/DATE/`.

If the push is rejected, `git pull --rebase origin main` and push again. Do not open a pull request; the edition must land on `main`.

## 5. Monday edition — the week in review

On Mondays, after the daily sections, add `week_in_review`:
- `period`: the seven days ending yesterday (Sunday), e.g. `"1–7 Sep 2026"`.
- Read every `data/*.json` from those seven days (plus today's items). Identify the 6–12 threads that mattered most across the week — the storylines that recurred or the single biggest events. Prefer threads that appear as topics on multiple days (`node scripts/build.js --topics`).
- `summary`: 2–3 paragraphs on the shape of the week.
- `items`: one item per thread, same shape as daily items. The headline names the thread; bullets trace what happened across the week with dates; sources link the key primary documents (they may be reused from earlier editions).
- Set `"edition": "monday"`.

## 6. Send the email

After the push, send one email via the Gmail tool:
- **to**: `mike.shoss@gmail.com`
- **subject**: the contents of `site/email/DATE.subject.txt`
- **htmlBody**: the contents of `site/email/DATE.html`
- **body** (plain-text alternative): the contents of `site/email/DATE.txt`

Read those files after `node scripts/build.js` and pass their contents verbatim. Do not rewrite the email by hand; the built files are the email.

## 7. Done

Finish with a short report: number of items, sections used, any sources you could not reach, any items you dropped for lack of verification, and the commit hash. If anything failed (push, email), say exactly what and why.
