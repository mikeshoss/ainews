#!/usr/bin/env node
'use strict';
// Validates storyline files. Usage: node scripts/validate-storyline.js [storylines/<id>.json ...] [--check-links]
// With no files, validates every file in storylines/ plus the set as a whole (ids unique, at most 12 live).
// A storyline is the running record of one arc: dated "where this stands" snapshots (kept forever), the daily
// items filed under it, tracked figures and open questions. The locks are the week in review's — no opinion, no
// unattributed causes — plus one more: every number in a snapshot must come from an item filed under the storyline,
// a tracked figure, or a date. Nothing in the state that is not in the record.

const fs = require('fs');
const path = require('path');
const { SLUG_RE, isHttp, OPINION_ERROR, OPINION_WARN, CAUSAL_RE, ATTRIBUTION_RE, NUM_RE, normNum, digitsOf, bannedHits, stripQuotes, sentences, makeReporter, checkLinks } = require('./validate-lib.js');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'storylines');
const STATUSES = new Set(['proposed', 'live', 'dormant', 'resolved']);
const MAX_LIVE = 12;

const args = process.argv.slice(2);
const doLinks = args.includes('--check-links');
const files = args.filter((a) => !a.startsWith('--'));
const all = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(DIR, f)) : [];
const targets = files.length ? files : all;

const rep = makeReporter();
const { err, warn } = rep;
const urls = new Map();

// Every daily item filed under each storyline (id -> [{date, item}]), for the numeric lock and the timeline check.
const filed = new Map();
const dataDir = path.join(ROOT, 'data');
for (const f of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) {
  if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
  let ed; try { ed = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch { continue; }
  for (const s of ed.sections || []) for (const it of s.items || []) for (const id of it.storylines || []) { if (!filed.has(id)) filed.set(id, []); filed.get(id).push({ date: ed.date, item: it }); }
}
const itemText = (it) => [it.headline, ...(it.bullets || [])].join(' ');

const ids = new Map();
const wholeSet = !files.length;
for (const file of targets) {
  const where = path.relative(ROOT, file);
  let s; try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { err(`${where}: cannot parse — ${e.message}`); continue; }
  const id = path.basename(file, '.json');
  if (s.id !== id) err(`${where}: "id" (${s.id}) must match the filename`);
  if (!SLUG_RE.test(id)) err(`${where}: filename must be a lowercase-hyphen slug`);
  if (ids.has(id)) err(`${where}: duplicate id`); ids.set(id, s.status);
  if (!s.name || s.name.trim().length < 4) err(`${where}: "name" missing`);
  if (!s.frame || s.frame.trim().length < 30) err(`${where}: "frame" (one line on what the arc is) missing or too short`);
  if (!STATUSES.has(s.status)) err(`${where}: "status" must be one of ${[...STATUSES].join('|')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.opened || '')) err(`${where}: "opened" must be a date`);
  if (!s.question || s.question.trim().length < 40) err(`${where}: "question" — the question a future event would settle — missing or too short (admission test)`);
  if (s.status === 'resolved' && !(s.resolved && s.resolved.date && s.resolved.text)) err(`${where}: a resolved storyline needs "resolved": {date, text, url?}`);
  if (s.status !== 'resolved' && s.resolved) err(`${where}: "resolved" is set but status is ${s.status}`);
  if (!Array.isArray(s.topics) || !s.topics.length) err(`${where}: needs "topics"`);
  for (const t of s.topics || []) if (!SLUG_RE.test(t)) err(`${where}: topic "${t}" must be a slug`);
  for (const r of s.related || []) if (!SLUG_RE.test(r) || (wholeSet && !all.some((f) => path.basename(f, '.json') === r))) err(`${where}: related "${r}" is not a storyline`);
  if (s.status === 'proposed' && !s.proposed_note) warn(`${where}: a proposed storyline should carry "proposed_note" saying why it was proposed`);

  const items = filed.get(id) || [];
  if (s.status === 'live' && !items.length) warn(`${where}: live but no daily item is filed under it yet`);
  const figures = Array.isArray(s.figures) ? s.figures : [];
  figures.forEach((f, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') || !f.value || !f.label || !isHttp(f.url)) err(`${where}: figures[${i}] needs date, value, label and url`);
    else if (!urls.has(f.url)) urls.set(f.url, `${where} figures[${i}]`);
  });
  const allowedBase = new Set([...items.flatMap((x) => [...digitsOf(itemText(x.item))]), ...digitsOf(figures.map((f) => `${f.value} ${f.label}`).join(' ')), ...digitsOf(`${s.opened} ${(s.resolved || {}).date || ''}`)]);
  const scan = (text, w, allowHedges = false) => {
    const clean = stripQuotes(text);
    for (const x of bannedHits(clean, OPINION_ERROR)) err(`${w}: "${x}" — no opinion, prediction or hype`);
    if (!allowHedges) for (const x of bannedHits(clean, OPINION_WARN)) warn(`${w}: "${x}" — hedge or loaded word`);
  };
  const states = Array.isArray(s.states) ? s.states : [];
  if (!states.length) err(`${where}: needs at least one "states" snapshot`);
  let prev = null;
  states.forEach((st, i) => {
    const w = `${where} states[${i}]`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(st.date || '')) err(`${w}: needs a date`);
    if (prev && st.date <= prev) err(`${w}: snapshots must be in date order (${st.date} after ${prev})`);
    prev = st.date;
    const text = Array.isArray(st.text) ? st.text.join(' ') : String(st.text || '');
    if (text.trim().length < 200) err(`${w}: "text" too short — where does this stand, in the record's own facts`);
    if (i > 0 && (!st.changed || String(st.changed).trim().length < 20)) err(`${w}: every snapshot after the first needs "changed" — what moved since the previous one`);
    for (const sent of sentences(stripQuotes(text))) if (CAUSAL_RE.test(sent) && !ATTRIBUTION_RE.test(sent)) err(`${w}: asserts a cause without attributing it — "${sent.slice(0, 140)}"`);
    // Numeric lock: only numbers from items filed under this storyline up to the snapshot date, its figures, or dates.
    const allowed = new Set([...allowedBase, ...digitsOf(st.date), ...(st.changed ? [] : [])]);
    for (const raw of stripQuotes(text).match(NUM_RE) || []) if (!allowed.has(normNum(raw))) err(`${w}: number "${raw}" is not in any item filed under this storyline or in its figures`);
    scan(`${text} ${st.changed || ''}`, w);
  });
  (Array.isArray(s.questions) ? s.questions : []).forEach((q, i) => {
    const w = `${where} questions[${i}]`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date || '') || !q.question || String(q.question).length < 15 || !q.would_settle || String(q.would_settle).length < 20) err(`${w}: needs date, question and would_settle`);
    if (q.settled && !(q.settled.date && q.settled.text)) err(`${w}: "settled" needs {date, text, url?}`);
    scan([q.question, q.would_settle, q.settled && q.settled.text].filter(Boolean).join(' '), w, true);
  });
  scan(`${s.frame} ${s.question} ${(s.resolved || {}).text || ''}`, where, true);
}
if (wholeSet) {
  const live = [...ids.values()].filter((st) => st === 'live').length;
  if (live > MAX_LIVE) err(`${live} live storylines — the cap is ${MAX_LIVE}; mark one dormant or resolved first`);
  // Items filed under ids that do not exist.
  for (const id of filed.keys()) if (!ids.has(id)) err(`daily items are filed under "${id}" but storylines/${id}.json does not exist`);
}

(async () => {
  if (doLinks && !rep.errors.length) await checkLinks(urls, rep);
  const live = [...ids.values()].filter((st) => st === 'live').length;
  rep.report(files.length ? targets.map((f) => path.relative(ROOT, f)).join(', ') : 'storylines/', `${ids.size} storyline(s), ${live} live, ${[...filed.values()].reduce((a, x) => a + x.length, 0)} filed items`);
})();
