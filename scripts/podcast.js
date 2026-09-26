#!/usr/bin/env node
'use strict';
// Turns editions into podcast episodes. Runs in GitHub Actions (needs OPENAI_API_KEY, CLOUDFLARE_API_TOKEN +
// CLOUDFLARE_ACCOUNT_ID, ffmpeg).
// For each edition in the last LOOKBACK_DAYS without audio: use the dialogue script if it exists AND passes
// validate-script.js, otherwise the code-generated narration (narrate.js).
//
// The two scripts do not arrive at the same moment. The morning run is meant to commit the edition and its
// dialogue script together, but if it commits them separately the push of the edition alone starts a build,
// and that build would reach this script before the dialogue one exists — narrating an episode that had a
// perfectly good two-host script a minute behind it. So an edition younger than GRACE_MS with no valid
// dialogue script is left alone rather than narrated; --no-wait (which the nightly safety-net run passes)
// says the wait is over, narrate what is there. And a narration that is still fresh is replaced if a valid
// dialogue script turns up inside UPGRADE_MS, keeping the narration as an earlier version. Synthesizes with OpenAI TTS,
// concatenates with ffmpeg, renders the episode cover (cover.js → librsvg) and embeds it, uploads DATE.mp3 + DATE.png
// to the R2 bucket behind AUDIO_BASE (scripts/r2.js), and maintains index.json there
// (also written to audio/index.json for build.js). Idempotent; the index is updated last.
// Usage: node scripts/podcast.js [--dry-run] [--max N] [--force DATE --label vN]
// Re-running a date with --force keeps every earlier version (index.versions) and makes the new one current.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { loadEditions } = require('./build.js');
const { longDate, PODCAST } = require('./lib.js');
const { narrationFor } = require('./narrate.js');
const verify = require('./verify-audio.js');
const { coverSvg, wideCoverSvg } = require('./cover.js');
const r2 = require('./r2.js');

const ROOT = path.resolve(__dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'audio');
const LOOKBACK_DAYS = 14;
const GRACE_MS = 2 * 60 * 60 * 1000;      // how long to wait for a dialogue script before narrating
const UPGRADE_MS = 6 * 60 * 60 * 1000;    // how late a dialogue script may arrive and still replace a narration
const MAX_PER_RUN = 3;             // cost cap
const MAX_CHARS = 3800;            // per TTS request (API limit 4096)
const VERIFY = !process.argv.includes('--no-verify');   // transcribe each segment and check it says what we sent
const VERIFY_ROUNDS = 3;           // passes of transcribe-and-repair before giving up on an episode
const MODEL = 'gpt-4o-mini-tts';
const PAUSE_TURN = 0.45;           // seconds of silence between speaker turns
const PAUSE_PARA = 0.7;            // between narration paragraphs / blocks
const INSTRUCTIONS = {
  // The constraint comes first, deliberately. This model is generative, not a reader: told only to be "a
  // conversational co-host" it performs, and on 2026-09-22 it smoothed "I'm Maya." out of the intro entirely.
  // Every word here has already passed the script locks, so the only correct behaviour is to say all of them.
  dialogue: 'Read the text exactly as written, word for word. Do not add, omit, shorten, reorder or paraphrase anything, including short sentences at the end of a passage. Deliver it as a co-host of a calm, credible morning news briefing about AI: warm, natural pacing, no dramatisation or sales energy. Read numbers, currencies, percentages and acronyms clearly. Brief natural pauses at commas and full stops.',
  narration: 'Read the text exactly as written, word for word. Do not add, omit, shorten, reorder or paraphrase anything. Deliver it as the narrator of a calm, credible morning news briefing about AI: measured, clear, unhurried; a professional newsreader, not a robot. Read numbers, currencies, percentages and acronyms clearly. Brief natural pauses at commas and full stops.',
};

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const MAX = Number((args[args.indexOf('--max') + 1]) || MAX_PER_RUN) || MAX_PER_RUN;
const FORCE = args.includes('--force') ? args[args.indexOf('--force') + 1] : (process.env.FORCE_DATE || null);
const LABEL = args.includes('--label') ? args[args.indexOf('--label') + 1] : (process.env.FORCE_LABEL || null);
const NO_WAIT = args.includes('--no-wait') || process.env.PODCAST_NO_WAIT === '1';
const PAUSE_INTRO = 1.4;           // longer breath after the intro before the news starts
const KEY = process.env.OPENAI_API_KEY;
const AUDIO_BASE = r2.AUDIO_BASE;

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const has = (cmd) => spawnSync('which', [cmd]).status === 0;

// ---------- index (lives in R2 next to the audio) ----------
async function loadIndex() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const local = path.join(AUDIO_DIR, 'index.json');
  let text = null;
  if (!DRY) { const b = await r2.get('index.json'); if (b) text = b.toString(); }
  else { try { const r = await fetch(`${AUDIO_BASE}/index.json?t=${Date.now()}`); if (r.ok) text = await r.text(); } catch { /* offline: use the local copy */ } }
  if (text) fs.writeFileSync(local, text);
  else if (!fs.existsSync(local)) fs.writeFileSync(local, '{"episodes":{}}');
  return JSON.parse(fs.readFileSync(local, 'utf8'));
}
async function saveIndex(index) {
  const local = path.join(AUDIO_DIR, 'index.json');
  const text = JSON.stringify(index, null, 2);
  fs.writeFileSync(local, text);
  if (!DRY) await r2.put('index.json', Buffer.from(text), 'application/json', r2.CACHE.index);
}
// Public GET of an object we already published (covers), so build.js can serve them same-origin.
async function download(name, to) {
  try { const r = await fetch(`${AUDIO_BASE}/${name}`); if (r.ok) { fs.writeFileSync(to, Buffer.from(await r.arrayBuffer())); return true; } } catch { /* best effort */ }
  return false;
}

// ---------- script selection ----------
// 'valid' | 'invalid' | 'none'. Cached: the selection pass and the synthesis pass both ask.
const scriptStateCache = new Map();
function scriptState(date) {
  if (scriptStateCache.has(date)) return scriptStateCache.get(date);
  const p = path.join(ROOT, 'data', `${date}.script.json`);
  let state = 'none';
  if (fs.existsSync(p)) state = spawnSync('node', [path.join(__dirname, 'validate-script.js'), p], { encoding: 'utf8' }).status === 0 ? 'valid' : 'invalid';
  scriptStateCache.set(date, state);
  return state;
}

function segmentsFor(ed) {
  const scriptPath = path.join(ROOT, 'data', `${ed.date}.script.json`);
  if (fs.existsSync(scriptPath)) {
    const v = spawnSync('node', [path.join(__dirname, 'validate-script.js'), scriptPath], { encoding: 'utf8' });
    if (v.status === 0) {
      const sc = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
      const lines = [];
      sc.blocks.forEach((b, i) => { b.lines.forEach((l) => lines.push({ voice: sc.hosts[l.host].voice, text: l.text })); if (i < sc.blocks.length - 1) lines.push({ pause: b.pause_after || (b.type === 'intro' ? PAUSE_INTRO : PAUSE_PARA) }); });
      return { format: 'dialogue', voices: Object.fromEntries(Object.entries(sc.hosts).map(([k, h]) => [k, `${h.name} (${h.voice})`])), lines, instructions: INSTRUCTIONS.dialogue };
    }
    console.log(`  script for ${ed.date} FAILED validation — falling back to narration:\n${v.stdout.split('\n').filter((l) => l.startsWith('ERROR')).slice(0, 5).map((l) => '    ' + l).join('\n')}`);
  }
  const n = narrationFor(ed);
  const lines = [];
  n.lines.forEach((l) => { if (l.section && lines.length) lines.push({ pause: PAUSE_PARA }); lines.push({ voice: n.hosts.N.voice, text: l.text }); if (l.pause) lines.push({ pause: l.pause }); });
  return { format: 'narration', voices: { N: `Narrator (${n.hosts.N.voice})` }, lines, instructions: INSTRUCTIONS.narration };
}

// Group consecutive same-voice lines into requests of <= MAX_CHARS; keep pauses between voice changes.
function requestsFor(seg) {
  const out = [];
  let cur = null;
  for (const l of seg.lines) {
    if (l.pause) { if (cur) { out.push(cur); cur = null; } if (out.length && !out[out.length - 1].pause) out.push({ pause: l.pause }); continue; }
    if (cur && cur.voice === l.voice && cur.text.length + 1 + l.text.length <= MAX_CHARS) { cur.text += '\n\n' + l.text; continue; }
    if (cur) { out.push(cur); if (cur.voice !== l.voice) out.push({ pause: PAUSE_TURN }); }
    cur = { voice: l.voice, text: l.text };
  }
  if (cur) out.push(cur);
  // A single line longer than MAX_CHARS: split on sentence boundaries.
  return out.flatMap((r) => {
    if (r.pause || r.text.length <= MAX_CHARS) return [r];
    const parts = []; let buf = '';
    for (const s of r.text.split(/(?<=[.!?])\s+/)) { if ((buf + ' ' + s).length > MAX_CHARS) { parts.push({ voice: r.voice, text: buf.trim() }); buf = s; } else buf += ' ' + s; }
    if (buf.trim()) parts.push({ voice: r.voice, text: buf.trim() });
    return parts;
  });
}

// ---------- synthesis ----------
// One TTS request. A hung connection is the failure mode seen on 2026-09-26 (five minutes per call, then
// "fetch failed"), so every attempt has a hard deadline and network errors retry like a 5xx does.
const TTS_TIMEOUT_MS = 90_000;
async function tts(req, instructions, outFile) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, voice: req.voice, input: req.text, instructions, response_format: 'mp3' }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      });
      if (res.ok) { fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer())); return; }
    } catch (e) {
      if (attempt === 4) throw new Error(`TTS network error after ${attempt} attempts: ${e.message}`);
      const wait = 2000 * 2 ** attempt; console.log(`  TTS ${e.name === 'TimeoutError' ? `no answer in ${TTS_TIMEOUT_MS / 1000}s` : e.message}, retrying in ${wait / 1000}s`); await new Promise((r) => setTimeout(r, wait)); continue;
    }
    const body = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { const wait = 2000 * 2 ** attempt; console.log(`  TTS ${res.status}, retrying in ${wait / 1000}s`); await new Promise((r) => setTimeout(r, wait)); continue; }
    throw new Error(`TTS failed ${res.status}: ${body.slice(0, 300)}`);
  }
}

// Episode cover: SVG from the edition → PNG (librsvg). Returns the png path or null if rasterising is unavailable.
function makeCover(ed) {
  const svg = path.join(AUDIO_DIR, `${ed.date}.svg`);
  const png = path.join(AUDIO_DIR, `${ed.date}.png`);
  fs.writeFileSync(svg, coverSvg(ed));
  const r = spawnSync(path.join(__dirname, 'rasterize.sh'), [svg, png, '3000'], { encoding: 'utf8' });
  makeWideCover(ed);
  return r.status === 0 && fs.existsSync(png) ? png : null;
}

// 1200×630 share image for the edition page (social cards want 1.91:1, not the square podcast art).
function makeWideCover(ed) {
  const svg = path.join(AUDIO_DIR, `${ed.date}-og.svg`);
  const png = path.join(AUDIO_DIR, `${ed.date}-og.png`);
  fs.writeFileSync(svg, wideCoverSvg(ed));
  const r = spawnSync(path.join(__dirname, 'rasterize.sh'), [svg, png, '1200', '630'], { encoding: 'utf8' });
  return r.status === 0 && fs.existsSync(png) ? png : null;
}

// Embed the cover as ID3 attached picture so players show it even without the feed's <itunes:image>.
function embedCover(mp3, png) {
  const tmp = mp3 + '.tmp.mp3';
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, '-i', png, '-map', '0:a', '-map', '1:v', '-c', 'copy', '-id3v2_version', '3',
    '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', '-disposition:v', 'attached_pic', tmp]);
  fs.renameSync(tmp, mp3);
}

function silence(seconds, outFile) {
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(seconds), '-c:a', 'libmp3lame', '-b:a', '64k', outFile]);
}

function versionsFor(index, date) {
  index.versions = index.versions || {};
  if (!index.versions[date] && index.episodes[date]) index.versions[date] = [{ label: 'v1', ...index.episodes[date] }];
  return (index.versions[date] = index.versions[date] || []);
}

// The script as verify-audio.js wants it: every line the episode is supposed to speak, in order.
const asScript = (seg) => ({ hosts: {}, blocks: [{ type: 'episode', lines: seg.lines.filter((l) => l.text).map((l) => ({ host: 'x', text: l.text })) }] });

async function synthesize(ed, seg, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ep-${ed.date}-`));
  const reqs = requestsFor(seg);
  const files = [];
  for (const [i, r] of reqs.entries()) {
    const f = path.join(tmp, `seg-${String(i).padStart(3, '0')}.mp3`);
    if (r.pause) silence(r.pause, f); else { process.stdout.write(`  tts ${r.voice} ${r.text.length} chars\n`); await tts(r, seg.instructions, f); }
    files.push(f);
  }
  const listFile = path.join(tmp, 'list.txt');
  const out = path.join(AUDIO_DIR, `${ed.date}${label && label !== 'v1' ? '-' + label : ''}.mp3`);
  // Re-encode on concat so segments with different encoder settings join cleanly; mono 64k is plenty for speech.
  const join = () => {
    fs.writeFileSync(listFile, files.map((f) => `file '${f}'`).join('\n'));
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k',
      '-metadata', `title=${PODCAST.title} — ${longDate(ed.date)}`, '-metadata', `artist=${PODCAST.title}`, '-metadata', `album=${PODCAST.title}`, '-metadata', `album_artist=${PODCAST.presenter}`, out]);
  };
  join();

  // Does the episode say what the script says? gpt-4o-mini-tts is generative and can return good audio that
  // quietly left a sentence out — on 2026-09-22 it dropped "I'm Maya." and we published it. One transcription
  // of the finished episode costs ~30s and about 10c, and whisper is more accurate over a whole episode than
  // over a five-second clip; only the segments carrying a missing sentence are spoken again.
  if (VERIFY) {
    for (let round = 1; round <= VERIFY_ROUNDS; round++) {
      let heard;
      try { heard = await verify.transcribe(fs.readFileSync(out), path.basename(out)); }
      catch (e) { console.log(`  cannot verify this episode (${e.message}) — publishing it unchecked`); break; }
      const r = verify.check(asScript(seg), heard);
      for (const w of r.warnings) console.log(`  note: ${w.why} — rest of the sentence is there, not treating it as missing`);
      if (!r.missing.length) { console.log(`  verified: no sentence missing from the audio (${r.total} checked, ${r.warnings.length} heard differently)`); break; }
      const bad = new Set();
      for (const m of r.missing) { const i = reqs.findIndex((q) => q.text && q.text.includes(m.sentence)); if (i >= 0) bad.add(i); }
      console.log(`  round ${round}: ${r.missing.length} sentence(s) missing — ${r.missing.map((m) => m.why).join('; ')}`);
      if (!bad.size || round === VERIFY_ROUNDS) {
        fs.rmSync(tmp, { recursive: true, force: true });
        throw new Error(`audio does not match the script after ${round} attempt(s): ${r.missing.map((m) => `"${m.sentence.slice(0, 60)}" (${m.why})`).join('; ')}`);
      }
      for (const i of bad) { console.log(`    re-speaking segment ${i}`); await tts(reqs[i], seg.instructions, files[i]); }
      join();
    }
  }
  const png = makeCover(ed);
  if (png) embedCover(out, png);
  const seconds = Math.round(parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out])));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { file: out, png, seconds, bytes: fs.statSync(out).size };
}

// ---------- main ----------
(async () => {
  if (!KEY && !DRY) { console.log('OPENAI_API_KEY not set — skipping podcast generation (set the repo secret to enable).'); process.exit(0); }
  for (const c of ['ffmpeg', 'ffprobe']) if (!has(c)) { console.log(`${c} not found — skipping podcast generation`); process.exit(0); }
  if (!DRY && !r2.configured()) { console.log('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set — skipping podcast generation'); process.exit(0); }

  const editions = loadEditions();
  const latest = editions[0];
  if (!latest) { console.log('no editions'); return; }
  const index = await loadIndex();
  index.episodes = index.episodes || {};

  const cutoff = new Date(Date.parse(latest.date + 'T12:00:00Z') - LOOKBACK_DAYS * 86400000);

  // Make sure every published cover is present locally so build.js can serve it from the site (same-origin og:image).
  if (!DRY) for (const [date, ep] of Object.entries(index.episodes)) {
    for (const f of [`${date}.png`, `${date}-og.png`]) if (!fs.existsSync(path.join(AUDIO_DIR, f))) await download(f, path.join(AUDIO_DIR, f));
    if (ep.image && !ep.og && !DRY) {
      const ed = editions.find((e) => e.date === date);
      const png = ed && makeWideCover(ed);
      if (png) { try { await r2.put(`${date}-og.png`, png, 'image/png', r2.CACHE.png); ep.og = `${AUDIO_BASE}/${date}-og.png`; await saveIndex(index); console.log(`${date}: share image backfilled`); } catch (e) { console.log(`${date}: share image failed: ${e.message}`); } }
    }
  }

  // Backfill covers for episodes that already have audio but no image (cheap: no TTS).
  for (const ed of editions) {
    const ep = index.episodes[ed.date];
    if (!ep || ep.image || DRY) continue;
    try {
      const png = makeCover(ed);
      if (!png) break;
      await r2.put(`${ed.date}.png`, png, 'image/png', r2.CACHE.png);
      ep.image = `${AUDIO_BASE}/${ed.date}.png`;
      await saveIndex(index);
      console.log(`${ed.date}: cover backfilled`);
    } catch (e) { console.log(`${ed.date}: cover backfill failed: ${e.message}`); }
  }
  if (FORCE && !LABEL) { console.log('--force needs --label (e.g. v2) so the earlier version is kept'); process.exit(2); }
  const now = Date.now();
  const ageOf = (iso, fallbackDate) => { const t = Date.parse(iso || ''); return now - (Number.isFinite(t) ? t : Date.parse(fallbackDate + 'T12:00:00Z')); };
  const todo = [];
  for (const ed of editions) {
    if (Date.parse(ed.date + 'T12:00:00Z') < cutoff) continue;
    const ep = index.episodes[ed.date];
    const script = scriptState(ed.date);
    if (FORCE === ed.date) { todo.push({ ed, upgrade: !!ep }); continue; }
    if (!ep) {
      if (script === 'valid' || NO_WAIT) { todo.push({ ed, upgrade: false }); continue; }
      // 'invalid' is a decision, not a gap — the run wrote a script and it failed its locks, so narrate.
      if (script === 'invalid') { todo.push({ ed, upgrade: false }); continue; }
      const age = ageOf(ed.generated_at, ed.date);
      if (age >= GRACE_MS) { todo.push({ ed, upgrade: false }); continue; }
      console.log(`${ed.date}: no dialogue script yet and the edition is ${Math.round(age / 60000)} min old — waiting (up to ${GRACE_MS / 3600000}h) rather than narrating it`);
      continue;
    }
    // Already has audio. The only reason to make it again is a dialogue script that arrived after we narrated.
    if (ep.format === 'narration' && script === 'valid') {
      const age = ageOf(ep.generated_at, ed.date);
      if (age < UPGRADE_MS) { console.log(`${ed.date}: narrated ${Math.round(age / 60000)} min ago but a valid dialogue script exists now — remaking it with both hosts`); todo.push({ ed, upgrade: true }); }
      else console.log(`${ed.date}: narrated, and a dialogue script exists, but the episode is ${(age / 3600000).toFixed(1)}h old — leaving it (use --force DATE --label vN to replace it)`);
    }
  }
  if (!todo.length) { console.log('nothing to do: every recent edition has the best audio available for it'); return; }
  todo.splice(MAX);

  let failures = 0;
  for (const { ed, upgrade } of todo) {
    const seg = segmentsFor(ed);
    const reqs = requestsFor(seg);
    const chars = reqs.reduce((a, r) => a + (r.text ? r.text.length : 0), 0);
    console.log(`${ed.date}: ${seg.format}, ${reqs.filter((r) => r.text).length} TTS requests, ${chars.toLocaleString()} chars${DRY ? ' (dry run)' : ''}`);
    if (DRY) continue;
    try {
      const versions = versionsFor(index, ed.date);
      const label = FORCE === ed.date ? LABEL : (upgrade ? `v${versions.length + 1}` : 'v1');
      if (versions.some((v) => v.label === label)) throw new Error(`version "${label}" already exists for ${ed.date}; pick another label`);
      const a = await synthesize(ed, seg, label);
      const wide = path.join(AUDIO_DIR, `${ed.date}-og.png`);
      await r2.put(path.basename(a.file), a.file, 'audio/mpeg', r2.CACHE.mp3);
      if (a.png) await r2.put(`${ed.date}.png`, a.png, 'image/png', r2.CACHE.png);
      if (fs.existsSync(wide)) await r2.put(`${ed.date}-og.png`, wide, 'image/png', r2.CACHE.png);
      const entry = { url: `${AUDIO_BASE}/${path.basename(a.file)}`, bytes: a.bytes, seconds: a.seconds, format: seg.format, voices: seg.voices, model: MODEL, generated_at: new Date().toISOString(), ...(a.png ? { image: `${AUDIO_BASE}/${ed.date}.png` } : {}), ...(fs.existsSync(wide) ? { og: `${AUDIO_BASE}/${ed.date}-og.png` } : {}) };
      versions.push({ label, ...entry });
      index.episodes[ed.date] = entry; // newest version is what the feed carries; earlier ones stay in the bucket and on /podcast/
      await saveIndex(index); // after each episode so a later failure keeps earlier work
      console.log(`  → ${a.seconds}s, ${(a.bytes / 1e6).toFixed(1)} MB, uploaded`);
    } catch (e) {
      failures++;
      console.log(`  FAILED ${ed.date}: ${e.message}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=No episode for ${ed.date}::${e.message.slice(0, 200)} — the page still deploys; the next push retries the audio and the watchdog reports it if it is still missing.`);
    }
  }
  if (failures) process.exit(1);
})();
