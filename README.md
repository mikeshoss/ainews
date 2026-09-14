# AI Edge Briefing

A daily, fact-first briefing on frontier AI — the advances, the research, and how AI is being used for good and for harm. Every headline links to its source. Nothing is written without one.

- **Site**: https://aiedgebriefing.com/ — one page per edition (`/YYYY-MM-DD/`), plus `/trends/` for topics that keep recurring.
- **Email**: each edition is sent to the reader's Gmail with a link and the key points.
- **Podcast — The AI Edge, presented by Epilogue**: every edition is an episode — feed at https://aiedgebriefing.com/podcast.xml, player on each page. Each episode has its own generated cover, coloured by that day's news (see *Section colours*). Two AI hosts when the script passes every factual lock (`scripts/validate-script.js`), otherwise a code-generated narration of the edition. Script with every claim linked to its item at `/YYYY-MM-DD/script/`.
- **Trace**: every edition has `/YYYY-MM-DD/trace/` — the complete record of the run that produced it (every tool call, input and response), captured by a harness hook rather than written by the model.
- **Schedule**: generated every morning at 07:00 America/Toronto (11:00 UTC) by a Claude Code cloud routine. A second routine writes the **Week in Review** (`data/DATE.week.json`, `/week/DATE/`) on Mondays at 09:00 Toronto from `PROMPT-WEEK.md`: what happened, what connects, what we don't know — validated by `scripts/validate-week.js`, which rejects unattributed causation, numbers not in the linked items, and opinion language.
- **Storylines**: tags are literal, so the site also keeps a small curated set of arcs (AI-enabled hacking, the push to regulate frontier AI, …), each with a dated "where this stands", the record of how that changed, every item filed under it and the open questions. The daily routine files items under existing storylines only; the Monday routine writes the new state, marks dormant/resolved, and may propose one new storyline a week. Nothing is removed — `/storylines/history/` lists all of them.
- **Fetching**: pages that refuse the harness's `WebFetch` are read with `scripts/fetch.js`, which identifies itself (`AIEdgeBriefing/1.0`, contact address in the User-Agent). The sites have given permission for direct reads. No archive or cache sites, ever.

## How it works

```
data/YYYY-MM-DD.json     one file per daily edition — the only thing the daily routine writes
data/YYYY-MM-DD.week.json  the week in review (dated by the Monday it publishes): happened → connects → unknowns, figures, calendar
storylines/<id>.json     the curated arcs (/storylines/): frame, the question that would settle it, dated "where this stands" snapshots, figures, open questions; daily items are filed under them, the weekly updates them; capped at 12 live, never deleted
scripts/validate-storyline.js  storyline locks: no opinion, attributed causes, numbers only from filed items or figures, ≤12 live
scripts/validate.js      daily schema + live link check (404/410 fails the build)
scripts/validate-week.js the week-in-review locks: connections join ≥2 developments, causes must be attributed, no new numbers, no opinion language
scripts/validate-lib.js  shared checks (item shape, link check, banned-language lists)
scripts/fetch.js         identifiable direct fetch for pages that refuse WebFetch (prints readable text)
scripts/build.js         static site generator → site/ (pages, trends, RSS, email bodies, podcast feed + players)
scripts/validate-script.js  the podcast-script locks: every number must be in the item, caveats voiced, sources named, no hype
scripts/narrate.js       deterministic single-voice narration from the JSON (podcast fallback)
scripts/podcast.js       runs in Actions: OpenAI TTS → MP3 → Cloudflare R2 (audio.aiedgebriefing.com) → audio/index.json for the build
scripts/r2.js            R2 client over Cloudflare's REST API (one token; no S3 keys, no dependencies); `setup` creates the bucket + custom domain
scripts/migrate-r2.js    one-time move of the audio from the old GitHub Release to R2 (idempotent, verifies every URL)
scripts/spotify.js       maps each episode date to its Spotify episode id (spotify.json in R2) so the player can hand off to Spotify at the current timestamp
scripts/mail.js          sends today's edition (and the Monday week) to the subscriber list via Brevo, once, with sent/ markers in R2
scripts/player.js        the site's only script: one shared audio element + bottom "now playing" bar; internal links swap the page in place so audio keeps playing; browser's leave-page prompt while playing
scripts/cover.js         cover generator (SVG): per-episode covers mixed from section colours by share of items; show cover (--show, variant "line")
scripts/rasterize.sh     SVG → PNG via librsvg (rsvg-convert), used in CI and locally
.github/workflows/       builds and deploys site/ to GitHub Pages on every push to main
scripts/trace-hook.js    Claude Code hook: records every tool call of a run to trace/YYYY-MM-DD.jsonl (published at /YYYY-MM-DD/trace/); the weekly run's prompt carries AINEWS_RUN=week so it lands in trace/YYYY-MM-DD.week.jsonl
.claude/settings.json    wires the hook (SessionStart, PostToolUse, SubagentStop, Stop); it only records inside the cloud sandbox
PROMPT.md                the editorial playbook the daily routine follows
PROMPT-WEEK.md           the playbook for the Monday week in review
SOURCES.md               the source list it sweeps
```

The routine reads `PROMPT.md`, fans out four research subagents across `SOURCES.md` (labs/compute, research, security/military, health/policy), verifies, writes the edition, validates it, pushes to `main`, then emails the built email body. To change what gets covered or how, edit `PROMPT.md` or `SOURCES.md` — the routine picks up the change on its next run.

## Section colours

The palette behind the podcast covers and the site's section marks. Single source of truth: `SECTION_COLORS` in `scripts/lib.js`.

| Section | Colour | Hex |
|---|---|---|
| Frontier models & labs | electric blue | `#3B82F6` |
| Research & papers | violet | `#8B5CF6` |
| Security, misuse & threat intelligence | red | `#EF4444` |
| Military, defense & geopolitics | orange | `#F97316` |
| Health, science & medicine | green | `#10B981` |
| Policy, regulation & law | gold | `#EAB308` |
| Compute, chips & infrastructure | cyan | `#06B6D4` |
| Deployment & impact | magenta | `#EC4899` |

A day's cover: one blurred colour blob per section, radius ∝ √(share of items), positions seeded by the date (unique per day, reproducible from the JSON), with the exact shares drawn as a bar along the bottom.

## Secrets

Two repo secrets and three variables:

```
gh secret set OPENAI_API_KEY --repo mikeshoss/ainews          # TTS
gh secret set CLOUDFLARE_API_TOKEN --repo mikeshoss/ainews    # Workers R2 Storage: Edit + Zone DNS: Edit + Zone: Read, scoped to the account/zone
gh variable set CLOUDFLARE_ACCOUNT_ID --body <id> --repo mikeshoss/ainews
gh variable set R2_BUCKET --body ainews-audio --repo mikeshoss/ainews
gh variable set AUDIO_BASE --body https://audio.aiedgebriefing.com --repo mikeshoss/ainews
```

Without them the workflow still builds and deploys the site; it just skips audio.

Subscribers (optional): `BREVO_API_KEY` (secret) and `BREVO_LIST_ID`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `SUBSCRIBE_FORM_URL` (variables). The subscribe form renders only when `SUBSCRIBE_FORM_URL` is set; `scripts/mail.js` sends only when the key and list are set. Brevo's free tier sends 300 emails a day — beyond ~300 daily readers, upgrade or move the list to a self-hosted sender. Episodes are served from the R2 custom domain; the feed's enclosure URLs go through [OP3](https://op3.dev) (`https://op3.dev/e,pg=<podcast:guid>/…`) for open, IAB-style download stats — public at `https://op3.dev/show/<guid>`. The show's `podcast:guid` is pinned in `scripts/lib.js`.

## Local

```
node scripts/validate.js data/2026-09-11.json --check-links
node scripts/narrate.js data/2026-09-11.json          # what the fallback episode would say
node scripts/validate-script.js data/2026-09-11.script.json
node scripts/podcast.js --dry-run                      # planned TTS requests, no API calls
node scripts/build.js && npx -y serve site
```

## Licence

Code is [MIT](LICENSE). The editions (`data/`, `trace/`, and everything built from them) are [CC BY 4.0](LICENSE-EDITIONS.md) — reuse with credit to AI Edge Briefing and a link to https://aiedgebriefing.com/.

## Private stats

`node scripts/stats.js` prints a per-day snapshot — items, run time, tool calls, what the run cost (Claude tokens at API list price + TTS), podcast downloads from OP3 (`OP3_API_KEY` in `stats/.env`), and site traffic if Google Analytics credentials are present — and writes `stats/index.html`. `stats/` is gitignored; nothing in it is published. Run it daily from one machine so per-day download deltas accumulate.
