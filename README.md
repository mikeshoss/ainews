# AI Edge Briefing

A daily, fact-first briefing on frontier AI — the advances, the research, and how AI is being used for good and for harm. Every headline links to its source. Nothing is written without one.

- **Site**: https://aiedgebriefing.com/ — one page per edition (`/YYYY-MM-DD/`), plus `/trends/` for topics that keep recurring.
- **Email**: each edition is sent to the reader's Gmail with a link and the key points.
- **Podcast — The AI Edge, presented by Epilogue**: every edition is an episode — feed at https://aiedgebriefing.com/podcast.xml, player on each page. Each episode has its own generated cover, coloured by that day's news (see *Section colours*). Two AI hosts when the script passes every factual lock (`scripts/validate-script.js`), otherwise a code-generated narration of the edition. Script with every claim linked to its item at `/YYYY-MM-DD/script/`.
- **Trace**: every edition has `/YYYY-MM-DD/trace/` — the complete record of the run that produced it (every tool call, input and response), captured by a harness hook rather than written by the model.
- **Schedule**: generated every morning at 07:00 America/Toronto (11:00 UTC) by a Claude Code cloud routine. Mondays include a week-in-review section.

## How it works

```
data/YYYY-MM-DD.json     one file per edition — the only thing the routine writes
scripts/validate.js      schema + live link check (404/410 fails the build)
scripts/build.js         static site generator → site/ (pages, trends, RSS, email bodies, podcast feed + players)
scripts/validate-script.js  the podcast-script locks: every number must be in the item, caveats voiced, sources named, no hype
scripts/narrate.js       deterministic single-voice narration from the JSON (podcast fallback)
scripts/podcast.js       runs in Actions: OpenAI TTS → MP3 → GitHub Release "audio" → audio/index.json for the build
scripts/cover.js         cover generator (SVG): per-episode covers mixed from section colours by share of items; show cover (--show, variant "line")
scripts/rasterize.sh     SVG → PNG via librsvg (rsvg-convert), used in CI and locally
.github/workflows/       builds and deploys site/ to GitHub Pages on every push to main
scripts/trace-hook.js    Claude Code hook: records every tool call of a run to trace/YYYY-MM-DD.jsonl (published at /YYYY-MM-DD/trace/)
.claude/settings.json    wires the hook (SessionStart, PostToolUse, SubagentStop, Stop); it only records inside the cloud sandbox
PROMPT.md                the editorial playbook the routine follows
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

A day's cover: one blurred colour blob per section, radius ∝ √(share of items), positions seeded by the date (unique per day, reproducible from the JSON), with the exact shares drawn as a bar along the bottom. Monday covers count the daily sections only.

## Secrets

One repo secret: `OPENAI_API_KEY` (set with `gh secret set OPENAI_API_KEY --repo mikeshoss/ainews`). Without it the workflow still builds and deploys the site; it just skips audio.

## Local

```
node scripts/validate.js data/2026-09-11.json --check-links
node scripts/narrate.js data/2026-09-11.json          # what the fallback episode would say
node scripts/validate-script.js data/2026-09-11.script.json
node scripts/podcast.js --dry-run                      # planned TTS requests, no API calls
node scripts/build.js && npx -y serve site
```
