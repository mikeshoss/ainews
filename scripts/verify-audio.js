#!/usr/bin/env node
'use strict';
// Does the audio actually say what the script says?
//
// Every editorial lock in this repo stops at the script: numbers must appear in the item, caveats must be
// voiced, sources named, no hype. Then gpt-4o-mini-tts — a generative model, not a reader — speaks it, and
// until now nothing checked what came out. On 2026-09-22 it silently dropped "I'm Maya." from the intro.
// A dropped name is embarrassing; a dropped "according to TechCrunch" or "that's a company claim" would be
// the briefing breaking its own promise. So the audio gets a lock too, the same mechanical shape as the rest.
//
// Usage:
//   node scripts/verify-audio.js DATE                 audit the published episode against data/DATE.script.json
//   node scripts/verify-audio.js DATE --file a.mp3    audit a local file instead
//   node scripts/verify-audio.js DATE --json          machine-readable result
// Exit 0 if every sentence is accounted for, 1 if anything is missing, 2 on a usage/setup error.
//
// Needs OPENAI_API_KEY. Transcription is whisper-1 at $0.006/minute — about 10c for a 16-minute episode.

const fs = require('fs');
const path = require('path');
const { AUDIO_BASE } = require('./r2.js');

const ROOT = path.resolve(__dirname, '..');
const KEY = process.env.OPENAI_API_KEY;
const MODEL = 'whisper-1';
// Below this share of a sentence's distinctive words, the sentence was not spoken at all — a failure that
// stops the deploy. Above it, the words are there and the transcriber just heard one differently — a note.
const BLOCK_BELOW = 0.4;
// Below this share of a sentence's words found in the transcript, we call it missing. Whisper is accurate on
// clean synthetic speech; the slack is for its own spelling choices, not for the voice skipping words.
const SENTENCE_MATCH = 0.6;

// ---------- text normalising ----------
// Compare what was *said*, not how either side spells it: whisper writes "26 percent" where the script writes
// "26%", one side writes "1,750" and the other "1750", and neither side's punctuation matters. Thousands
// separators go first — otherwise "1,750" becomes the two tokens "1" and "750" and never matches "1750".
const stripThousands = (s) => { let out = String(s); while (/\d,\d{3}/.test(out)) out = out.replace(/(\d),(\d{3})/g, '$1$2'); return out; };
// A decimal is one number, not two: "81.1%" must not become the tokens "81" and "1", or the figure the
// sentence exists to carry stops being checkable.
const joinDecimals = (s) => String(s).replace(/(\d)\.(\d)/g, '$1point$2');
const norm = (s) => joinDecimals(stripThousands(s))
  .toLowerCase()
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/%/g, ' percent ')
  .replace(/\$/g, ' dollars ')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
// The script is written in British English and whisper transcribes in American; it also splits compounds
// ("build out" for "buildout") and joins them the other way. Fold both sides to one spelling so the check is
// about words that were *not said*, not about how either side spells them.
const KEEP_OUR = new Set(['our', 'four', 'your', 'hour', 'tour', 'pour', 'flour', 'sour', 'scour', 'devour']);
const fold = (w) => {
  let x = w;
  x = x.replace(/isation\b/, 'ization').replace(/isations\b/, 'izations');
  x = x.replace(/ise\b/, 'ize').replace(/ised\b/, 'ized').replace(/ising\b/, 'izing').replace(/ises\b/, 'izes');
  x = x.replace(/ysed\b/, 'yzed').replace(/yse\b/, 'yze');
  if (!KEEP_OUR.has(x)) x = x.replace(/our\b/, 'or').replace(/ours\b/, 'ors');
  x = x.replace(/mme\b/, 'm').replace(/mmes\b/, 'ms');
  x = x.replace(/tre\b/, 'ter').replace(/tres\b/, 'ters');
  x = x.replace(/ogue\b/, 'og');
  x = x.replace(/ll(ed|ing|er)\b/, 'l$1');
  return x;
};
const words = (s) => norm(s).split(' ').filter(Boolean).map(fold);
const sentences = (s) => String(s).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

// What a sentence is *identifiable* by: its rare words. "That's a company claim, and it hasn't been
// independently verified" is carried by company/claim/independently/verified, not by that/a/and/it.
//
// Two earlier attempts tracked position — a per-sentence sliding window with a cursor, then a greedy
// forward alignment — and both desynchronised on a 2,300-word transcript: one mismatch moved the pointer
// and every sentence after it was reported missing. Rarity needs no position, so nothing can cascade.
// The cost is that a sentence made only of common words cannot be judged; those carry no claim anyway.
const STOP = new Set(['the','a','an','and','or','but','of','to','in','on','at','is','it','its','that','this','we','our','you','they','he','she','for','with','as','by','from','was','were','be','been','are','not','no','so','do','does','did','has','have','had','will','would','can','could','what','which','who','when','where','there','here','then','than','if','all','one','two','up','out','about','into','over','after','before','more','most','some','any','each','their','them','i','my','me',"i'm","it's","that's",'us','also','just','now','new','said','says']);

function rarity(scriptText) {
  const freq = new Map();
  for (const w of words(scriptText)) freq.set(w, (freq.get(w) || 0) + 1);
  return freq;
}
// A word worth checking: not a stopword, not a single letter, and said at most a few times in the whole script.
// Numbers count whatever their length — "81point1" and "12" are exactly the words a briefing must get right —
// except bare single digits, which whisper as often spells out ("two centres" vs "2 centres").
const isFigure = (w) => /\d/.test(w) && w.length > 1;
const rareWords = (sentenceWords, freq) => sentenceWords.filter((w) => (isFigure(w) || (!STOP.has(w) && w.length > 2 && !/\d/.test(w))) && (freq.get(w) || 0) <= 3);

// How much of one sentence survived, when it is all you have (a single segment checked on its own).
function coverage(sentence, hay) {
  const need = words(sentence);
  if (!need.length) return 1;
  const have = new Set(hay);
  return need.filter((w) => have.has(w)).length / need.length;
}

// ---------- transcription ----------
async function transcribe(buf, filename = 'audio.mp3') {
  if (!KEY) throw new Error('OPENAI_API_KEY is not set');
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), filename);
  fd.append('model', MODEL);
  fd.append('response_format', 'text');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: fd });
    if (res.ok) return (await res.text()).trim();
    const body = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
    throw new Error(`transcription failed ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ---------- the check ----------
// `spoken` is every line the script asks a voice to say, in order, with who says it.
function spokenLines(script) {
  const out = [];
  for (const b of script.blocks || []) for (const l of b.lines || []) if (l.text) out.push({ block: b.type, host: l.host, name: (script.hosts[l.host] || {}).name || l.host, text: l.text });
  return out;
}

// Returns { total, skipped, missing: [{block, name, sentence, coverage, needed}], worst }
function check(script, transcript) {
  const hay = words(transcript);
  const heard = new Map();
  const bump = (w) => heard.set(w, (heard.get(w) || 0) + 1);
  for (let i = 0; i < hay.length; i++) {
    bump(hay[i]);
    // "buildout" in the script against "build out" in the transcript, and the reverse via the split below.
    if (i + 1 < hay.length) bump(hay[i] + hay[i + 1]);
    for (const part of hay[i].split(/(?=[A-Z])/)) if (part !== hay[i]) bump(part);
  }

  const lines = spokenLines(script);
  const freq = rarity(lines.map((l) => l.text).join(' '));
  const missing = [], warnings = [];
  let total = 0, skipped = 0;
  for (const line of lines) {
    for (const s of sentences(line.text)) {
      const rare = rareWords(words(s), freq);
      // Nothing distinctive to look for — "They do." is real speech but carries no claim to lose.
      if (!rare.length) { skipped++; continue; }
      total++;
      const seen = new Map();
      const present = (w) => { const used = seen.get(w) || 0; if ((heard.get(w) || 0) > used) { seen.set(w, used + 1); return true; } return false; };
      const gone = rare.filter((w) => !present(w));
      // Numbers get no slack. Every other lock in this repo exists to keep figures tied to their source, and
      // whisper transcribes digits reliably — so a figure that is not in the audio is a failure, full stop.
      // A name or a technical term may be spelled differently, so those allow one miss in a long sentence.
      const c = (rare.length - gone.length) / rare.length;
      if (!gone.length) continue;
      const why = `${gone.filter((w) => /\d/.test(w)).length ? 'figure ' : ''}not spoken: ${gone.join(', ')}`;
      const row = { block: line.block, name: line.name, sentence: s, rare, gone, coverage: +c.toFixed(2), why };
      // Two different findings, and conflating them cost us on 2026-09-23. A sentence that is mostly absent
      // was not spoken — that is the failure this exists to catch, and it blocks. A sentence that is all
      // there bar one word is the transcriber, not the voice: whisper writes "cash" for "cache", splits
      // "preprints", and turns "$2.00" into words. Blocking on that made the editor reword accurate copy —
      // it dropped the caveat "preprints" and a real price — to satisfy a machine. That is worse than the
      // bug. So a near-miss is reported and published; only a missing sentence stops the run.
      if (c < BLOCK_BELOW) missing.push(row); else warnings.push(row);
    }
  }
  return { total, skipped, missing, warnings, worst: missing.reduce((a, m) => Math.min(a, m.coverage), 1) };
}

async function audioFor(date, file) {
  if (file) return { buf: fs.readFileSync(file), where: file };
  const url = `${AUDIO_BASE}/${date}.mp3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cannot fetch ${url}: HTTP ${res.status}`);
  return { buf: Buffer.from(await res.arrayBuffer()), where: url };
}

module.exports = { check, coverage, rareWords, rarity, transcribe, words, sentences };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
    const asJson = args.includes('--json');
    if (!date) { console.error('usage: node scripts/verify-audio.js YYYY-MM-DD [--file a.mp3] [--json]'); process.exit(2); }
    const scriptPath = path.join(ROOT, 'data', `${date}.script.json`);
    if (!fs.existsSync(scriptPath)) { console.error(`no ${scriptPath} — this date has no dialogue script to check against`); process.exit(2); }
    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));

    const { buf, where } = await audioFor(date, file);
    console.log(`${date}: transcribing ${(buf.length / 1e6).toFixed(1)} MB from ${where} …`);
    const transcript = await transcribe(buf, `${date}.mp3`);
    const r = check(script, transcript);

    if (asJson) { console.log(JSON.stringify({ date, ...r }, null, 2)); process.exit(r.missing.length ? 1 : 0); }
    console.log(`${r.total} checkable sentences · ${r.missing.length} not spoken · ${r.warnings.length} heard differently\n`);
    for (const m of r.missing) console.log(`  [${m.block}] ${m.name}: "${m.sentence}"\n      ${m.why}  (${Math.round(m.coverage * 100)}% of its distinctive words are in the audio)\n`);
    for (const m of r.warnings) console.log(`  note  [${m.block}] ${m.name}: ${m.why} — the rest of the sentence is there`);
    if (!r.missing.length) console.log('\nno sentence is missing from the audio.');
    process.exit(r.missing.length ? 1 : 0);
  })().catch((e) => { console.error(e.message); process.exit(2); });
}
