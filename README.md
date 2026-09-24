# AI Edge Briefing

A daily, fact-first briefing on frontier AI — the advances, the research, and how AI is being used for good and for harm. Every headline links to its source. Nothing is written without one.

- **Site**: https://aiedgebriefing.com/ — one page per edition (`/YYYY-MM-DD/`), plus `/trends/` for topics that keep recurring.
- **Email**: each edition is sent to the reader's Gmail with a link and the key points.
- **Podcast — The AI Edge, presented by Epilogue**: every edition is an episode — feed at https://aiedgebriefing.com/podcast.xml, player on each page. Each episode has its own generated cover, coloured by that day's news (see *Section colours*). Two AI hosts when the script passes every factual lock (`scripts/validate-script.js`), otherwise a code-generated narration of the edition. Script with every claim linked to its item at `/YYYY-MM-DD/script/`.
- **Trace**: every edition has `/YYYY-MM-DD/trace/` — the complete record of the run that produced it (every tool call, input and response), captured by a harness hook rather than written by the model.
- **Schedule**: generated every morning at 07:00 America/Toronto (11:00 UTC) by a Claude Code cloud routine. A second routine writes the **Week in Review** (`data/DATE.week.json`, `/week/DATE/`) on Mondays at 09:00 Toronto from `PROMPT-WEEK.md`: what happened, what connects, what we don't know — validated by `scripts/validate-week.js`, which rejects unattributed causation, numbers not in the linked items, and opinion language.
- **When a run fails**: the routines write the edition, so a routine that dies writes nothing — and the deploy still succeeds, rebuilding yesterday's site without a word. Three things close that gap. A **catch-up routine** fires at 12:20 Toronto, stops immediately (and almost free) if `data/DATE.json` is already committed, and otherwise writes the edition from scratch — so a morning that hit a usage limit or crashed mid-run is not automatically a lost day. A **watchdog** (`.github/workflows/watchdog.yml`) runs on GitHub's scheduler, outside Claude entirely, and checks three times a day that today's edition is committed, live on the site and not suspiciously thin; on a miss it fails the run — GitHub emails the owner when a scheduled workflow fails — and writes the diagnosis to the job summary. The repository is public, so it does not open an issue unless the repository variable `WATCHDOG_ISSUE` is set to `true`. `node scripts/stats.js` marks missed days in its table and prints the pipeline's rolling 7-day spend, which is the number that runs a weekly usage allowance down before anyone notices.
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
scripts/social.js        posts today's edition to X / Bluesky / Mastodon (each only when its secrets exist), once, markers in R2
scripts/youtube.js       publishes today's episode to YouTube (cover + audio → video), once; `--auth` obtains the refresh token
scripts/indexnow.js      tells Bing/Yandex which pages changed (INDEXNOW_KEY); Google reads the sitemap via Search Console
scripts/dns.js           add/list DNS records on the zone via the Cloudflare token (sender authentication, verification records)
scripts/player.js        the site's only script: one shared audio element + bottom "now playing" bar; internal links swap the page in place so audio keeps playing; browser's leave-page prompt while playing
scripts/cover.js         cover generator (SVG): per-episode covers mixed from section colours by share of items; show cover (--show, variant "line")
scripts/rasterize.sh     SVG → PNG via librsvg (rsvg-convert), used in CI and locally
.github/workflows/       deploy.yml builds, makes the podcast and deploys site/ to GitHub Pages on every push to main; staging.yml builds the staging branch to the private preview; main-guard.yml flags code pushed to main outside a pull request
scripts/trace-hook.js    Claude Code hook: records every tool call of a run to trace/YYYY-MM-DD.jsonl (published at /YYYY-MM-DD/trace/); the weekly run's prompt carries AINEWS_RUN=week so it lands in trace/YYYY-MM-DD.week.jsonl
.claude/settings.json    wires the hook (SessionStart, PostToolUse, SubagentStop, Stop); it only records inside the cloud sandbox
PROMPT.md                the editorial playbook the daily routine follows
PROMPT-WEEK.md           the playbook for the Monday week in review
SOURCES.md               the source list it sweeps
```

The routine reads `PROMPT.md`, fans out four research subagents across `SOURCES.md` (labs/compute, research, security/military, health/policy), verifies, writes the edition, validates it, pushes to `main`, then emails the built email body. To change what gets covered or how, edit `PROMPT.md` or `SOURCES.md` — the routine picks up the change on its next run.

## Branches: staging, then main

Nothing goes live unseen. `main` is what the world sees — GitHub Pages at https://aiedgebriefing.com — and
`staging` is where code and design change first.

- **`staging`** builds to the private preview at https://staging.aiedgebriefing.com (Cloudflare Pages behind
  Cloudflare Access, one-time PIN to Mike's email) on every push, via `.github/workflows/staging.yml`. The build
  runs with `SITE_ENV=staging`: every page carries `noindex`, `robots.txt` disallows everything, there is no
  `feed.xml`, `podcast.xml` or `sitemap.xml` (a preview feed would carry the real show's permanent `podcast:guid`),
  no analytics, no subscribe form, and a red ribbon. The job holds a Pages-only Cloudflare token and cannot reach
  R2; it never runs `podcast.js`, never announces, and refuses to ship if any of those checks fail.
- **Content is not code.** Editions, scripts, storylines and traces land on `main` directly from the cloud
  routines every morning, exactly as before — that is the product publishing, not a change to review. The staging
  workflow merges `main` into `staging` before every build, so the preview always shows today's edition under the
  staged code. Code on `staging` never touches `data/`, `storylines/` or `trace/`; that is the only way the merge
  can conflict.
- **Promotion is a pull request**: `gh pr create --base main --head staging`, read the diff, merge (merge commit,
  so the branches stay convergent). That push runs `deploy.yml` as usual. Direct pushes of code to `main` are
  flagged by `main-guard.yml` — it fails and emails, it does not block, because the routine's morning push is the
  same GitHub account and must never be at risk.
- **Playbooks are read from `main` at run time.** A change to `PROMPT.md`, `PROMPT-WEEK.md` or `SOURCES.md` on
  `staging` is a diff to review and nothing more; it affects the next edition only once merged — before 11:00 UTC
  for that day's daily, 13:00 UTC Monday for the weekly.
- Secrets: `CLOUDFLARE_PAGES_TOKEN` (Cloudflare Pages: Edit only) lives on the `staging` GitHub environment, where
  `deploy.yml` cannot see it. `STAGING_SITE_FEATURES` optionally overrides `SITE_FEATURES` on the preview.

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

Everything below is off until its variable/secret exists, so the site does not change until you turn a feature on:

- `SITE_FEATURES` (variable, comma list): `share` renders the Share row (copy post / X / LinkedIn / Bluesky) on edition, weekly and storyline pages.
- `INDEXNOW_KEY` (variable, 32+ hex chars you choose): publishes `/<key>.txt` and submits changed pages after each deploy.
- Social: secrets `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`; `BLUESKY_HANDLE` (var) + `BLUESKY_APP_PASSWORD` (secret); `MASTODON_INSTANCE` (var) + `MASTODON_TOKEN` (secret).
- YouTube: secrets `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` (get the last with `node scripts/youtube.js --auth`).

- Browser Rendering (optional): `CLOUDFLARE_BROWSER_TOKEN` (a token with only *Browser Rendering: Edit*) + `CLOUDFLARE_ACCOUNT_ID`. `scripts/fetch.js` then retries JavaScript-only pages and bot-blocked (403) pages through headless Chrome at Cloudflare's edge (`--render` forces it, `--no-render` disables it), and `--check-links` re-checks blocked links in a real browser instead of leaving a warning. Free tier ≈ 10 browser-minutes a day. To use it inside the daily routine, the token must be added to the routine's environment variables (the cloud sandbox has no repo secrets).

Subscribers (optional): `BREVO_API_KEY` (secret) and `BREVO_DAILY_LIST_ID`, `BREVO_WEEKLY_LIST_ID` (or one `BREVO_LIST_ID` for both), `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `SUBSCRIBE_FORM_URL` (variables). The subscribe form renders only when `SUBSCRIBE_FORM_URL` is set; with `SUBSCRIBE_LIST_FIELD`, `SUBSCRIBE_DAILY_LIST` and `SUBSCRIBE_WEEKLY_LIST` also set (the checkbox field name and the two list IDs, copied from the Brevo form's exported HTML) readers pick daily, weekly or both. `scripts/mail.js` sends the daily edition to the daily list and the Monday review to the weekly list, only when the key and lists are set. Brevo's free tier sends 300 emails a day — beyond ~300 daily readers, upgrade or move the list to a self-hosted sender. Episodes are served from the R2 custom domain; the feed's enclosure URLs go through [OP3](https://op3.dev) (`https://op3.dev/e,pg=<podcast:guid>/…`) for open, IAB-style download stats — public at `https://op3.dev/show/<guid>`. The show's `podcast:guid` is pinned in `scripts/lib.js`.

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
