#!/usr/bin/env node
'use strict';
// Turns editions into podcast episodes. Runs in GitHub Actions (needs OPENAI_API_KEY, GH_TOKEN, ffmpeg, gh).
// For each edition in the last LOOKBACK_DAYS without audio: use the dialogue script if it exists AND passes
// validate-script.js, otherwise the code-generated narration (narrate.js). Synthesizes with OpenAI TTS,
// concatenates with ffmpeg, uploads DATE.mp3 to the rolling GitHub Release "audio", and maintains index.json
// (also written to audio/index.json for build.js). Idempotent; the index is updated last.
// Usage: node scripts/podcast.js [--dry-run] [--max N] [--force DATE]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { loadEditions } = require('./build.js');
const { longDate } = require('./lib.js');
const { narrationFor } = require('./narrate.js');

const ROOT = path.resolve(__dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'audio');
const RELEASE_TAG = 'audio';
const LOOKBACK_DAYS = 14;
const MAX_PER_RUN = 3;             // cost cap
const MAX_CHARS = 3800;            // per TTS request (API limit 4096)
const MODEL = 'gpt-4o-mini-tts';
const PAUSE_TURN = 0.45;           // seconds of silence between speaker turns
const PAUSE_PARA = 0.7;            // between narration paragraphs / blocks
const INSTRUCTIONS = {
  dialogue: 'You are a co-host of a calm, credible morning news briefing about AI. Conversational and warm, natural pacing, no dramatisation or sales energy. Read numbers, currencies, percentages and acronyms clearly. Brief natural pauses at commas and full stops.',
  narration: 'You are the narrator of a calm, credible morning news briefing about AI. Measured, clear, unhurried; a professional newsreader, not a robot. Read numbers, currencies, percentages and acronyms clearly. Brief natural pauses at commas and full stops.',
};

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const MAX = Number((args[args.indexOf('--max') + 1]) || MAX_PER_RUN) || MAX_PER_RUN;
const FORCE = args.includes('--force') ? args[args.indexOf('--force') + 1] : null;
const KEY = process.env.OPENAI_API_KEY;
const REPO = process.env.GITHUB_REPOSITORY || 'mikeshoss/ainews';
const DOWNLOAD_BASE = `https://github.com/${REPO}/releases/download/${RELEASE_TAG}`;

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const has = (cmd) => spawnSync('which', [cmd]).status === 0;

// ---------- release + index ----------
function ensureRelease() {
  if (DRY) return;
  if (spawnSync('gh', ['release', 'view', RELEASE_TAG, '-R', REPO], { stdio: 'ignore' }).status !== 0) {
    sh('gh', ['release', 'create', RELEASE_TAG, '-R', REPO, '-t', 'Podcast audio', '-n', 'MP3 episodes referenced by podcast.xml. Managed by scripts/podcast.js.', '--latest=false']);
    console.log(`created release ${RELEASE_TAG}`);
  }
}
function loadIndex() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const local = path.join(AUDIO_DIR, 'index.json');
  if (!DRY) {
    const r = spawnSync('gh', ['release', 'download', RELEASE_TAG, '-R', REPO, '-p', 'index.json', '-O', local, '--clobber'], { stdio: 'ignore' });
    if (r.status !== 0 && !fs.existsSync(local)) fs.writeFileSync(local, '{"episodes":{}}');
  } else if (!fs.existsSync(local)) fs.writeFileSync(local, '{"episodes":{}}');
  return JSON.parse(fs.readFileSync(local, 'utf8'));
}
function saveIndex(index) {
  const local = path.join(AUDIO_DIR, 'index.json');
  fs.writeFileSync(local, JSON.stringify(index, null, 2));
  if (!DRY) sh('gh', ['release', 'upload', RELEASE_TAG, local, '-R', REPO, '--clobber']);
}

// ---------- script selection ----------
function segmentsFor(ed) {
  const scriptPath = path.join(ROOT, 'data', `${ed.date}.script.json`);
  if (fs.existsSync(scriptPath)) {
    const v = spawnSync('node', [path.join(__dirname, 'validate-script.js'), scriptPath], { encoding: 'utf8' });
    if (v.status === 0) {
      const sc = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
      const lines = [];
      sc.blocks.forEach((b, i) => { b.lines.forEach((l) => lines.push({ voice: sc.hosts[l.host].voice, text: l.text })); if (i < sc.blocks.length - 1) lines.push({ pause: PAUSE_PARA }); });
      return { format: 'dialogue', voices: Object.fromEntries(Object.entries(sc.hosts).map(([k, h]) => [k, `${h.name} (${h.voice})`])), lines, instructions: INSTRUCTIONS.dialogue };
    }
    console.log(`  script for ${ed.date} FAILED validation — falling back to narration:\n${v.stdout.split('\n').filter((l) => l.startsWith('ERROR')).slice(0, 5).map((l) => '    ' + l).join('\n')}`);
  }
  const n = narrationFor(ed);
  const lines = [];
  n.lines.forEach((l) => { if (l.section && lines.length) lines.push({ pause: PAUSE_PARA }); lines.push({ voice: n.hosts.N.voice, text: l.text }); });
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
async function tts(req, instructions, outFile) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, voice: req.voice, input: req.text, instructions, response_format: 'mp3' }),
    });
    if (res.ok) { fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer())); return; }
    const body = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { const wait = 2000 * 2 ** attempt; console.log(`  TTS ${res.status}, retrying in ${wait / 1000}s`); await new Promise((r) => setTimeout(r, wait)); continue; }
    throw new Error(`TTS failed ${res.status}: ${body.slice(0, 300)}`);
  }
}

function silence(seconds, outFile) {
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(seconds), '-c:a', 'libmp3lame', '-b:a', '64k', outFile]);
}

async function synthesize(ed, seg) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ep-${ed.date}-`));
  const reqs = requestsFor(seg);
  const list = [];
  let n = 0;
  for (const r of reqs) {
    const f = path.join(tmp, `seg-${String(n++).padStart(3, '0')}.mp3`);
    if (r.pause) silence(r.pause, f); else { process.stdout.write(`  tts ${r.voice} ${r.text.length} chars\n`); await tts(r, seg.instructions, f); }
    list.push(`file '${f}'`);
  }
  const listFile = path.join(tmp, 'list.txt');
  fs.writeFileSync(listFile, list.join('\n'));
  const out = path.join(AUDIO_DIR, `${ed.date}.mp3`);
  // Re-encode on concat so segments with different encoder settings join cleanly; mono 64k is plenty for speech.
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k',
    '-metadata', `title=AI Edge Briefing — ${longDate(ed.date)}`, '-metadata', 'artist=AI Edge Briefing', '-metadata', `album=AI Edge Briefing`, out]);
  const seconds = Math.round(parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out])));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { file: out, seconds, bytes: fs.statSync(out).size };
}

// ---------- main ----------
(async () => {
  if (!KEY && !DRY) { console.log('OPENAI_API_KEY not set — skipping podcast generation (set the repo secret to enable).'); process.exit(0); }
  for (const c of ['ffmpeg', 'ffprobe']) if (!has(c)) { console.log(`${c} not found — skipping podcast generation`); process.exit(0); }
  if (!DRY && !has('gh')) { console.log('gh not found — skipping podcast generation'); process.exit(0); }

  const editions = loadEditions();
  const latest = editions[0];
  if (!latest) { console.log('no editions'); return; }
  ensureRelease();
  const index = loadIndex();
  index.episodes = index.episodes || {};

  const cutoff = new Date(Date.parse(latest.date + 'T12:00:00Z') - LOOKBACK_DAYS * 86400000);
  const todo = editions.filter((ed) => Date.parse(ed.date + 'T12:00:00Z') >= cutoff && (!index.episodes[ed.date] || FORCE === ed.date)).slice(0, MAX);
  if (!todo.length) { console.log('all recent editions already have audio'); return; }

  let failures = 0;
  for (const ed of todo) {
    const seg = segmentsFor(ed);
    const reqs = requestsFor(seg);
    const chars = reqs.reduce((a, r) => a + (r.text ? r.text.length : 0), 0);
    console.log(`${ed.date}: ${seg.format}, ${reqs.filter((r) => r.text).length} TTS requests, ${chars.toLocaleString()} chars${DRY ? ' (dry run)' : ''}`);
    if (DRY) continue;
    try {
      const a = await synthesize(ed, seg);
      sh('gh', ['release', 'upload', RELEASE_TAG, a.file, '-R', REPO, '--clobber']);
      index.episodes[ed.date] = { url: `${DOWNLOAD_BASE}/${ed.date}.mp3`, bytes: a.bytes, seconds: a.seconds, format: seg.format, voices: seg.voices, model: MODEL, generated_at: new Date().toISOString() };
      saveIndex(index); // after each episode so a later failure keeps earlier work
      console.log(`  → ${a.seconds}s, ${(a.bytes / 1e6).toFixed(1)} MB, uploaded`);
    } catch (e) {
      failures++;
      console.log(`  FAILED ${ed.date}: ${e.message}`);
    }
  }
  if (failures) process.exit(1);
})();
