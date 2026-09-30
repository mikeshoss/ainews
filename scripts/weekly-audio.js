#!/usr/bin/env node
'use strict';
// The Monday episode is a human read: Mike records the week-in-review host script (data/DATE.week.host.json) and
// the recording lands in R2 at weekly/DATE.raw.<ext> through the review Worker. This turns it into the parked episode.
//   node scripts/weekly-audio.js DATE [--file local.wav] [--label vN]
// 1. fetch the newest weekly/DATE.raw.* (or --file); 2. ffmpeg: trim the silence either end, loudness-normalise,
// mono 24 kHz 96 kbps mp3 — no speed change, this is a person; 3. the same audio lock the daily gets
// (verify-audio.js): every sentence of the script must be heard, and every figure; 4. pass → upload
// DATE.week[-vN].mp3, park it in index.pending["DATE.week"], email the review link; fail → email the paragraphs to
// re-record and exit 1. Env: OPENAI_API_KEY (transcription only), R2 creds, RESEND_API_KEY, MAIL_FROM,
// REVIEW_EMAIL, REVIEW_URL, REVIEW_SIGNING_SECRET, SITE_URL.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const r2 = require('./r2.js');
const verify = require('./verify-audio.js');
const { longDate, PODCAST } = require('./lib.js');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const DATE = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const FILE = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const LABEL = args.includes('--label') ? args[args.indexOf('--label') + 1] : null;
const KEY = `${DATE}.week`;
const SITE_URL = (process.env.SITE_URL || 'https://aiedgebriefing.com').replace(/\/$/, '');
const REVIEW_URL = (process.env.REVIEW_URL || '').replace(/\/$/, '');
const AUDIO_BASE = r2.AUDIO_BASE;
if (!DATE) { console.error('usage: weekly-audio.js YYYY-MM-DD [--file local.wav] [--label vN]'); process.exit(2); }

const sh = (cmd, a) => { const r = spawnSync(cmd, a, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || '').slice(0, 400)}`); return r.stdout; };
const has = (c) => spawnSync('which', [c]).status === 0;
async function loadIndex() { const b = await r2.get('index.json'); const i = b ? JSON.parse(b.toString('utf8')) : {}; i.episodes = i.episodes || {}; i.versions = i.versions || {}; i.pending = i.pending || {}; return i; }
const saveIndex = (i) => r2.put('index.json', Buffer.from(JSON.stringify(i, null, 2)), 'application/json', r2.CACHE.index);
const reviewSig = (k) => require('crypto').createHmac('sha256', process.env.REVIEW_SIGNING_SECRET || '').update(k).digest('hex');

async function email(subject, html, text) {
  const key = process.env.RESEND_API_KEY, to = process.env.REVIEW_EMAIL, from = process.env.MAIL_FROM || `${PODCAST.title} <briefing@aiedgebriefing.com>`;
  if (!key || !to) { console.log('  email not sent (RESEND_API_KEY / REVIEW_EMAIL unset)'); return; }
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html, text }) });
  console.log(`  email ${res.ok ? 'sent' : 'FAILED ' + res.status} → ${to}`);
}
const wrap = (h) => `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:8px 4px;font-size:15px;line-height:1.5;color:#222"><p style="color:#777;font-size:12px;margin:0 0 4px">The AI Edge · week in review · review</p>${h}</div>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

(async () => {
  const scriptPath = path.join(ROOT, 'data', `${DATE}.week.host.json`);
  if (!fs.existsSync(scriptPath)) throw new Error(`${scriptPath} does not exist — the weekly run writes it`);
  const v = spawnSync('node', [path.join(__dirname, 'validate-host-script.js'), scriptPath], { encoding: 'utf8' });
  if (v.status !== 0) throw new Error(`host script fails validation:\n${v.stdout}`);
  const sc = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  for (const c of ['ffmpeg', 'ffprobe']) if (!has(c)) throw new Error(`${c} not found`);
  if (!r2.configured()) throw new Error('R2 not configured');

  // 1. the recording
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `week-${DATE}-`));
  let raw;
  if (FILE) raw = FILE;
  else {
    const objs = (await r2.list(`weekly/${DATE}.raw`)).sort((a, b) => (a.modified < b.modified ? 1 : -1));
    if (!objs.length) throw new Error(`no recording at weekly/${DATE}.raw.* — upload one from the review page`);
    raw = path.join(tmp, path.basename(objs[0].key));
    fs.writeFileSync(raw, await r2.get(objs[0].key));
    console.log(`${DATE}: recording ${objs[0].key} (${(objs[0].bytes / 1e6).toFixed(1)} MB, ${objs[0].modified})`);
  }

  // 2. clean and encode — trim silence at both ends, broadcast loudness, no tempo change
  const index = await loadIndex();
  const versions = (index.versions[KEY] = index.versions[KEY] || []);
  const label = LABEL || `v${versions.length + 1}`;
  if (versions.some((x) => x.label === label)) throw new Error(`version "${label}" already exists for ${KEY}`);
  const outName = `${DATE}.week${label !== 'v1' ? '-' + label : ''}.mp3`;
  const out = path.join(tmp, outName);
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw,
    '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.4,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.4,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '96k',
    '-metadata', `title=${PODCAST.title} — Week in review, ${longDate(DATE)}`, '-metadata', `artist=${sc.host.name}`, '-metadata', `album=${PODCAST.title}`, out]);
  const seconds = Math.round(parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out])));
  const bytes = fs.statSync(out).size;
  console.log(`  encoded ${outName}: ${seconds}s, ${(bytes / 1e6).toFixed(1)} MB`);

  // 3. the lock — one block per paragraph so a miss names the screen to re-record
  const asScript = { hosts: { h: { name: sc.host.name } }, blocks: sc.blocks.flatMap((b) => b.lines.map((l, i) => ({ type: `${b.type} · paragraph ${i + 1}`, lines: [{ host: 'h', text: l.text }] }))) };
  const heard = await verify.transcribe(fs.readFileSync(out), outName);
  const r = verify.check(asScript, heard);
  for (const w of r.warnings) console.log(`  note: ${w.block}: ${w.why} — rest of the sentence is there`);
  if (r.missing.length) {
    // Group by paragraph: that is the unit Mike re-reads.
    const byPara = new Map();
    for (const m of r.missing) { if (!byPara.has(m.block)) byPara.set(m.block, []); byPara.get(m.block).push(m); }
    const rows = [...byPara].map(([block, ms]) => `<li><b>${esc(block)}</b>${ms.map((m) => `<br>${esc(m.why)} — <span style="color:#555">“${esc(m.sentence)}”</span>`).join('')}</li>`).join('');
    console.log(`  ${r.missing.length} sentence(s) in ${byPara.size} paragraph(s) not heard:`);
    for (const m of r.missing) console.log(`    ${m.block}: ${m.why}`);
    await email(`Re-record: ${byPara.size} paragraph(s) in the week in review, ${longDate(DATE)}`,
      wrap(`<h1 style="font-size:20px;margin:0 0 12px">${byPara.size} paragraph(s) to record again</h1><p>The recording is ${Math.round(seconds / 60)} minutes; these were not heard in it. Record the whole read again, or upload a corrected file, from the same review page.</p><ul>${rows}</ul>`),
      `Not heard:\n${[...byPara].map(([b, ms]) => `- ${b}: ${ms.map((m) => m.why).join('; ')}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`  verified: every sentence heard (${r.total} checked, ${r.warnings.length} heard differently)`);

  // 4. park it for approval
  await r2.put(outName, out, 'audio/mpeg', r2.CACHE.mp3);
  const entry = { url: `${AUDIO_BASE}/${outName}`, bytes, seconds, format: 'host', voices: { H: sc.host.name }, model: 'human', generated_at: new Date().toISOString() };
  versions.push({ label, ...entry });
  index.pending[KEY] = { label, ...entry };
  if (index.retracted) delete index.retracted[KEY];
  await saveIndex(index);
  console.log(`  → parked as ${KEY} ${label} — PENDING REVIEW`);
  const link = REVIEW_URL ? `${REVIEW_URL}/${KEY}?t=${reviewSig(KEY)}` : entry.url;
  await email(`Review: The AI Edge week in review, ${longDate(DATE)} (${label})`,
    wrap(`<h1 style="font-size:20px;margin:0 0 12px">Week in review, ${longDate(DATE)} — ${label} is ready (${Math.round(seconds / 60)} min)</h1><p>Your read passed the check: every sentence and every figure heard. It is parked, not on the site or in the feed.</p><p style="margin:18px 0"><a href="${link}" style="background:#0b57d0;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Open the review page</a></p><p style="color:#777;font-size:13px">Transcript: <a href="${SITE_URL}/week/${DATE}/script/" style="color:#777">${SITE_URL}/week/${DATE}/script/</a></p>`),
    `Week in review ${DATE} ${label} is ready (${Math.round(seconds / 60)} min): ${link}`);
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e.message); process.exit(1); });
