#!/usr/bin/env node
'use strict';
// Validates a podcast dialogue script against its edition. These are the LOCKS that make a two-host
// conversation acceptable: nothing in the script may go beyond what the edition says.
// Usage: node scripts/validate-script.js data/2026-09-11.script.json
// Exit 0 = every lock holds. Exit 1 = at least one ERROR (the Action then ships the code-generated narration instead).

const fs = require('fs');
const path = require('path');
const { longDate } = require('./lib.js');

const VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar']);
const BLOCK_TYPES = new Set(['intro', 'item', 'transition', 'week', 'figures', 'outro']);
const BANNED = ['i think', 'i bet', 'i guess', 'probably', 'could mean', 'might mean', 'imagine if', 'game-changer', 'game changer', 'huge', 'massive', 'insane', 'crazy', 'wild', 'mind-blowing', 'mind blowing', 'scary', 'terrifying', 'exciting', 'incredible', 'unbelievable', 'revolutionary', 'blew my mind', 'jaw-dropping'];
const WARN_WORDS = ['interesting', 'fascinating'];
const CAVEAT_PHRASES = {
  'company-claim': ['company claim', 'company says', 'company-reported', 'not independently verified', "hasn't been independently verified", 'has not been independently verified', 'their own numbers', 'its own numbers'],
  'single-source': ['single source', 'only one outlet', 'one outlet', 'only source', 'no one else has confirmed', 'nobody else has confirmed'],
  preprint: ['preprint', 'not peer reviewed', "hasn't been peer reviewed", 'not been peer reviewed', 'pre-print'],
  update: ['update', 'follow-up', 'follow up', 'we covered', 'covered before', 'earlier edition'],
};
const BULLET_CAVEAT_TRIGGERS = ['unverified', 'not independently', 'did not say', 'does not say', 'could not confirm', "couldn't confirm", 'caveat', 'has not confirmed', 'not yet confirmed'];
const SCRIPT_CAVEAT_WORDS = ['unverified', 'not verified', "hasn't verified", "hasn't confirmed", 'has not confirmed', "haven't confirmed", 'caveat', 'not independently', "didn't say", 'did not say', "doesn't say", "couldn't confirm", 'could not confirm', 'only ', 'not yet'];
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|a couple of|a few|several|dozens of|hundreds of|thousands of|millions of|billions of)\s+(hundred|thousand|million|billion|trillion|percent|per cent)\b/i;
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

const file = process.argv[2];
if (!file) { console.error('usage: validate-script.js data/YYYY-MM-DD.script.json'); process.exit(2); }
const errors = [], warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

let sc;
try { sc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log(`ERROR cannot parse ${file}: ${e.message}`); process.exit(1); }
const date = path.basename(file).slice(0, 10);
const edPath = path.join(path.dirname(file), `${date}.json`);
if (!fs.existsSync(edPath)) { console.log(`ERROR no edition file ${edPath}`); process.exit(1); }
const ed = JSON.parse(fs.readFileSync(edPath, 'utf8'));
ed.sections = (ed.sections || []).filter((s) => s.items && s.items.length);
const monday = ed.edition === 'monday';

// ---------- schema ----------
if (sc.date !== date) err(`"date" (${sc.date}) must be ${date}`);
if (sc.format !== 'dialogue') err(`"format" must be "dialogue"`);
const hosts = sc.hosts || {};
const hostKeys = Object.keys(hosts);
if (hostKeys.length !== 2) err(`exactly two hosts required (got ${hostKeys.length})`);
for (const k of hostKeys) {
  if (!hosts[k].name) err(`host ${k} needs a name`);
  if (!VOICES.has(hosts[k].voice)) err(`host ${k} voice "${hosts[k].voice}" is not a supported voice (${[...VOICES].join(', ')})`);
}
if (hostKeys.length === 2 && hosts[hostKeys[0]].voice === hosts[hostKeys[1]].voice) err(`the two hosts must use different voices`);
if (!Array.isArray(sc.blocks) || !sc.blocks.length) err(`"blocks" must be a non-empty array`);

// ---------- edition lookups ----------
const digitsOf = (text) => new Set((String(text).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []));
const itemByHeadline = new Map();
for (const sec of ed.sections) for (const it of sec.items) itemByHeadline.set(it.headline, { item: it, section: sec.name });
const weekByHeadline = new Map();
for (const it of (ed.week_in_review && ed.week_in_review.items) || []) weekByHeadline.set(it.headline, it);
const itemText = (it) => [it.headline, ...(it.bullets || [])].join(' ');
const summaryText = Array.isArray(ed.summary) ? ed.summary.join(' ') : String(ed.summary || '');
const summaryDigits = digitsOf(summaryText);
const dateDigits = digitsOf(`${longDate(date)} ${date}`);
const figuresText = ((ed.week_in_review && ed.week_in_review.figures) || []).map((f) => `${f.value} ${f.label}`).join(' ');
const figuresDigits = digitsOf(figuresText);

// ---------- walk blocks ----------
const seenItems = new Set(), seenWeek = new Set();
const sectionsCovered = new Set();
let words = 0, lineCount = 0, itemBlocks = 0, introSeen = false, outroSeen = false;
const warnWordCount = {};
let prevHost = null, run = 0;

(sc.blocks || []).forEach((b, bi) => {
  const where = `block[${bi}] (${b.type}${b.headline ? `: "${String(b.headline).slice(0, 60)}"` : ''})`;
  if (!BLOCK_TYPES.has(b.type)) { err(`${where}: unknown block type`); return; }
  if (!Array.isArray(b.lines) || !b.lines.length) { err(`${where}: no lines`); return; }
  if (b.type === 'intro') { if (introSeen) err(`${where}: more than one intro`); introSeen = true; if (bi !== 0) err(`${where}: intro must be the first block`); }
  if (b.type === 'outro') { outroSeen = true; if (bi !== sc.blocks.length - 1) err(`${where}: outro must be the last block`); }

  // What this block is allowed to contain numbers from.
  let allowedDigits = dateDigits, ref = null;
  if (b.type === 'item') {
    ref = itemByHeadline.get(b.headline);
    if (!ref) err(`${where}: headline does not exactly match any item in ${path.basename(edPath)}`);
    else {
      if (b.section && b.section !== ref.section) err(`${where}: section "${b.section}" but the item is in "${ref.section}"`);
      if (seenItems.has(b.headline)) err(`${where}: item already has a block`);
      seenItems.add(b.headline); sectionsCovered.add(ref.section); itemBlocks++;
      allowedDigits = new Set([...digitsOf(itemText(ref.item)), ...dateDigits]);
    }
  } else if (b.type === 'week') {
    const it = weekByHeadline.get(b.headline);
    if (!it) err(`${where}: headline does not exactly match any week_in_review item`);
    else { if (seenWeek.has(b.headline)) err(`${where}: week item already has a block`); seenWeek.add(b.headline); allowedDigits = new Set([...digitsOf(itemText(it)), ...dateDigits]); }
  } else if (b.type === 'figures') {
    allowedDigits = new Set([...figuresDigits, ...dateDigits]);
    if (!figuresText) err(`${where}: edition has no week_in_review.figures`);
  } else if (b.type === 'intro') {
    allowedDigits = new Set([...summaryDigits, ...dateDigits]);
  }

  const blockText = b.lines.map((l) => l.text || '').join(' ');
  const lower = blockText.toLowerCase();

  b.lines.forEach((l, li) => {
    const lw = `${where} line[${li}]`;
    if (!hostKeys.includes(l.host)) err(`${lw}: host "${l.host}" is not one of ${hostKeys.join('/')}`);
    if (typeof l.text !== 'string' || l.text.trim().length < 2) err(`${lw}: empty text`);
    const text = String(l.text || '');
    lineCount++; words += text.trim().split(/\s+/).length;
    if (text.length > 600) err(`${lw}: line is ${text.length} chars (max 600) — split it`);
    if (/https?:\/\/|www\./i.test(text)) err(`${lw}: URLs must not be read aloud`);
    if (NUMBER_WORDS.test(text)) err(`${lw}: numbers must be written as digits, not words ("${text.match(NUMBER_WORDS)[0]}")`);
    // Numeric lock
    for (const raw of text.match(NUM_RE) || []) {
      const core = raw.replace(/,/g, '');
      if (!allowedDigits.has(core)) {
        if (b.type === 'transition' || b.type === 'outro') err(`${lw}: number "${raw}" — transitions and outros may not contain numbers`);
        else err(`${lw}: number "${raw}" does not appear in the ${b.type === 'intro' ? 'edition summary' : b.type === 'figures' ? 'week figures' : 'item'} — remove it or fix the item`);
      }
    }
    // Host alternation
    if (l.host === prevHost) { run++; if (run >= 4) err(`${lw}: ${l.host} has spoken ${run + 1} lines in a row (max 4)`); } else { prevHost = l.host; run = 0; }
  });

  // Banned language
  for (const w of BANNED) { const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i'); if (re.test(blockText)) err(`${where}: banned phrase "${w}" — no speculation or hype`); }
  for (const w of WARN_WORDS) { const n = (lower.match(new RegExp(`\\b${w}\\b`, 'g')) || []).length; warnWordCount[w] = (warnWordCount[w] || 0) + n; }

  // Item-specific locks
  if (b.type === 'item' && ref) {
    const it = ref.item;
    const names = (it.sources || []).map((s) => (s.name || '').toLowerCase()).filter(Boolean);
    if (names.length && !names.some((n) => lower.includes(n))) err(`${where}: must name a source (${(it.sources || []).map((s) => s.name).join(' / ')})`);
    for (const f of it.flags || []) {
      const phrases = CAVEAT_PHRASES[f] || [];
      if (!phrases.some((p) => lower.includes(p))) err(`${where}: item is flagged "${f}" — the hosts must say so (e.g. "${phrases[0]}")`);
    }
    const bulletsLower = (it.bullets || []).join(' ').toLowerCase();
    if (BULLET_CAVEAT_TRIGGERS.some((t) => bulletsLower.includes(t)) && !SCRIPT_CAVEAT_WORDS.some((w) => lower.includes(w))) {
      warn(`${where}: the item's bullets carry a caveat ("${BULLET_CAVEAT_TRIGGERS.find((t) => bulletsLower.includes(t))}") but the block does not voice one`);
    }
  }
  if (b.type === 'intro' && !/voiced by ai|synthetic voice|ai[- ]generated voice|ai voices/i.test(blockText)) err(`${where}: intro must disclose that the episode is voiced by AI`);
});

// ---------- whole-script locks ----------
if (!introSeen) err('no intro block');
if (!outroSeen) err('no outro block');
for (const sec of ed.sections) if (!sectionsCovered.has(sec.name)) err(`section "${sec.name}" has no item block — every section must be represented`);
const totalItems = ed.sections.reduce((n, s) => n + s.items.length, 0);
const minItems = Math.min(8, totalItems);
if (itemBlocks < minItems) err(`only ${itemBlocks} item blocks; need at least ${minItems}`);
if (monday) {
  const wk = (ed.week_in_review && ed.week_in_review.items) || [];
  if (wk.length && seenWeek.size < Math.min(5, wk.length)) err(`Monday: only ${seenWeek.size} week_in_review blocks; need at least ${Math.min(5, wk.length)}`);
}
const [minW, maxW] = monday ? [1800, 3400] : [1300, 2300];
if (words < minW || words > maxW) err(`script is ${words} words; must be ${minW}–${maxW} for a ${monday ? 'Monday' : 'daily'} episode`);
for (const [w, n] of Object.entries(warnWordCount)) if (n > 3) warn(`"${w}" used ${n} times — keep it factual`);

for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`${file}: ${sc.blocks ? sc.blocks.length : 0} blocks, ${itemBlocks} items voiced, ${lineCount} lines, ${words} words (~${Math.round(words / 150)} min) — ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
