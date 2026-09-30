#!/usr/bin/env node
'use strict';
// Validates a week-in-review host script — the one Mike reads himself on Mondays — against the week file.
// data/DATE.week.host.json:
//   { "date": "YYYY-MM-DD", "kind": "week-host", "host": { "name": "Mike Shoss" },
//     "blocks": [ { "type": "open"|"happened"|"connects"|"unknowns"|"calendar"|"close", "lines": [ { "text": "…" } ] } ] }
// One line = one paragraph = one teleprompter screen. Locks (all errors):
//   block order fixed; every figure in the script appears in the week file; the date is spoken; the show and
//   presenter are named; the host names themselves in the open; the close hands back to the daily; no URLs;
//   numbers as digits; every sentence is a sentence (≤2 words only for the host's name or a question);
//   900–1,600 words. Usage: node scripts/validate-host-script.js data/DATE.week.host.json
const fs = require('fs');
const path = require('path');
const { PODCAST } = require('./lib.js');

const file = process.argv[2];
if (!file) { console.error('usage: validate-host-script.js data/YYYY-MM-DD.week.host.json'); process.exit(2); }
const errors = [], warnings = [];
const err = (m) => errors.push(m);
const sc = JSON.parse(fs.readFileSync(file, 'utf8'));
const date = sc.date || path.basename(file).slice(0, 10);
const wkPath = path.join(path.dirname(file), `${date}.week.json`);
if (!fs.existsSync(wkPath)) { console.error(`ERROR ${wkPath} does not exist`); process.exit(1); }
const wk = JSON.parse(fs.readFileSync(wkPath, 'utf8'));

const ORDER = ['open', 'happened', 'connects', 'unknowns', 'calendar', 'close'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const d = new Date(date + 'T12:00:00Z');
const spokenDate = `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${ordinal(d.getUTCDate())}`;
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|a couple of|a few|several|dozens of|hundreds of|thousands of|millions of|billions of)\s+(hundred|thousand|million|billion|trillion|percent|per cent)\b/i;
const ABBR = /\b(?:[A-Z]\.){2,}/g;   // "D.C." and "U.S." are not sentence ends

// Every digit-bearing token in the week file (all text fields, recursively) is the set the script may use.
const digitsOf = (s) => new Set((String(s).match(/\d[\d,.:]*\d|\d/g) || []).map((x) => x.replace(/[,.:]+$/, '').replace(/,/g, '')));
const allText = (o) => typeof o === 'string' ? o : Array.isArray(o) ? o.map(allText).join(' ') : o && typeof o === 'object' ? Object.values(o).map(allText).join(' ') : '';
const allowed = new Set([...digitsOf(allText(wk)), ...digitsOf(date), String(d.getUTCFullYear())]);
for (let i = 1; i <= 31; i++) allowed.add(String(i));   // days of the month, spoken as "September 25th"

if (sc.kind !== 'week-host') err('kind must be "week-host"');
if (!sc.host || !sc.host.name) err('host.name is required');
const hostName = (sc.host && sc.host.name) || '';
const blocks = sc.blocks || [];
const types = blocks.map((b) => b.type);
if (types.join(',') !== ORDER.join(',')) err(`blocks must be exactly, in order: ${ORDER.join(' > ')} (got ${types.join(' > ') || 'none'})`);

let words = 0;
blocks.forEach((b, bi) => {
  const where = `block[${bi}] (${b.type})`;
  if (!Array.isArray(b.lines) || !b.lines.length) { err(`${where}: no lines`); return; }
  b.lines.forEach((l, li) => {
    const lw = `${where} line[${li}]`;
    const text = String(l.text || '');
    if (text.trim().length < 2) { err(`${lw}: empty text`); return; }
    words += text.trim().split(/\s+/).length;
    if (text.length > 900) err(`${lw}: ${text.length} chars — a teleprompter screen is one paragraph; split it`);
    if (/https?:\/\/|www\./i.test(text)) err(`${lw}: URLs must not be read aloud`);
    if (NUMBER_WORDS.test(text)) err(`${lw}: numbers as digits, not words ("${text.match(NUMBER_WORDS)[0]}")`);
    if (/\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(text)) err(`${lw}: dates are spoken month-first with an ordinal ("September 25th"), never "25 September"`);
    for (const tok of digitsOf(text)) if (!allowed.has(tok)) err(`${lw}: figure "${tok}" does not appear in ${path.basename(wkPath)} — every number is the edition's number`);
    const masked = text.replace(ABBR, (m) => m.replace(/\./g, '#'));
    for (const sent of masked.split(/(?<=[.!?])\s+/).map((x) => x.replace(/#/g, '.').trim()).filter(Boolean)) {
      const n = sent.split(/\s+/).length;
      if (n <= 2 && !/\?$/.test(sent) && !(hostName && sent.includes(hostName))) err(`${lw}: "${sent}" is a label, not a sentence — this is read aloud; say the thing`);
    }
  });
});

const textOf = (t) => (blocks.find((b) => b.type === t) || { lines: [] }).lines.map((l) => l.text || '').join(' ');
const open = textOf('open'), close = textOf('close');
if (open && !open.includes(spokenDate)) err(`open must say the date as spoken: "${spokenDate}"`);
if (open && !open.includes(PODCAST.title)) err(`open must name the show: "${PODCAST.title}"`);
if (open && !open.includes(`presented by ${PODCAST.presenter}`)) err(`open must say "presented by ${PODCAST.presenter}"`);
if (open && hostName && !open.includes(hostName)) err(`open: the host introduces themselves by name ("I'm ${hostName}")`);
if (close && !/tomorrow/i.test(close)) err('close must hand back to the daily ("back tomorrow morning")');
if (/our voices? (?:are|is) ai|ai[- ]generated/i.test(close)) warnings.push('the AI-voice disclosure is for the daily; this episode is a human read');
// The open questions read out must be the week's own, not new ones.
const known = (wk.unknowns || []).map((u) => (typeof u === 'string' ? u : u.question || u.title || '').toLowerCase().replace(/[?.]$/, ''));
for (const s of textOf('unknowns').toLowerCase().split(/(?<=[.!?])\s+/).filter((x) => x.trim().endsWith('?'))) {
  const q = s.trim().replace(/^and:?\s+/, '').replace(/[?.]$/, '');
  if (q.length > 25 && !known.some((k) => k.startsWith(q.slice(0, 40)) || q.startsWith(k.slice(0, 40)))) warnings.push(`unknowns: "${q.slice(0, 70)}…" is not one of the week's ${known.length} open questions verbatim`);
}
if (words < 900 || words > 1600) err(`script is ${words} words; must be 900–1,600 (about 7–11 minutes read aloud)`);

for (const w of warnings) console.log(`WARN ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`${file}: ${blocks.length} blocks, ${words} words (~${Math.round(words / 140)} min) — ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
