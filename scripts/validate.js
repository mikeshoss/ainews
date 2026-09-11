#!/usr/bin/env node
'use strict';
// Validates an edition file. Usage: node scripts/validate.js data/2026-09-11.json [--check-links]
// Exits non-zero on any schema error, or (with --check-links) on any link that returns 404/410.
// Other HTTP failures (403, 429, timeouts — common for bot-blocking sites) are reported as warnings.

const fs = require('fs');
const path = require('path');

const SECTIONS = new Set([
  'Frontier models & labs', 'Research & papers', 'Security, misuse & threat intelligence',
  'Military, defense & geopolitics', 'Health, science & medicine', 'Policy, regulation & law',
  'Compute, chips & infrastructure', 'Deployment & impact',
]);
const IMPACTS = new Set(['beneficial', 'harmful', 'mixed', 'neutral']);

const file = process.argv[2];
const checkLinks = process.argv.includes('--check-links');
if (!file) { console.error('usage: validate.js data/YYYY-MM-DD.json [--check-links]'); process.exit(2); }

const errors = [], warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

let ed;
try { ed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`Cannot parse ${file}: ${e.message}`); process.exit(1); }

const fname = path.basename(file, '.json');
if (!/^\d{4}-\d{2}-\d{2}$/.test(fname)) err(`filename must be YYYY-MM-DD.json (got ${fname})`);
if (ed.date !== fname) err(`"date" (${ed.date}) must match filename (${fname})`);
if (!['daily', 'monday'].includes(ed.edition)) err(`"edition" must be "daily" or "monday"`);
const dow = new Date(fname + 'T12:00:00Z').getUTCDay();
if (ed.edition === 'monday' && dow !== 1) warn(`edition is "monday" but ${fname} is not a Monday`);
if (ed.edition === 'daily' && dow === 1) err(`${fname} is a Monday — edition must be "monday" and include week_in_review`);
if (!ed.generated_at || isNaN(Date.parse(ed.generated_at))) err(`"generated_at" must be an ISO timestamp`);
const summaryText = Array.isArray(ed.summary) ? ed.summary.join(' ') : String(ed.summary || '');
if (summaryText.trim().length < 200) err(`"summary" is too short (${summaryText.trim().length} chars; want a real paragraph or two)`);
if (!Array.isArray(ed.sections) || !ed.sections.length) err(`"sections" must be a non-empty array`);

const urls = new Map(); // url -> where
const headlines = new Set();
let itemTotal = 0;

function checkItem(it, where) {
  itemTotal++;
  if (!it.headline || it.headline.trim().length < 15) err(`${where}: headline missing or too short`);
  if (it.headline && headlines.has(it.headline.trim().toLowerCase())) err(`${where}: duplicate headline "${it.headline}"`);
  headlines.add((it.headline || '').trim().toLowerCase());
  if (!Array.isArray(it.sources) || !it.sources.length) err(`${where}: needs at least one source`);
  for (const [i, s] of (it.sources || []).entries()) {
    if (!s || !/^https?:\/\/\S+$/.test(s.url || '')) err(`${where}: source[${i}] has no valid http(s) url`);
    else if (!urls.has(s.url)) urls.set(s.url, where);
    if (!s.name) warn(`${where}: source[${i}] has no "name" (will fall back to hostname)`);
  }
  if (!Array.isArray(it.bullets) || !it.bullets.length) err(`${where}: needs at least one bullet`);
  for (const [i, b] of (it.bullets || []).entries()) if (typeof b !== 'string' || b.trim().length < 20) err(`${where}: bullet[${i}] too short`);
  if (!Array.isArray(it.topics) || !it.topics.length) err(`${where}: needs at least one topic slug`);
  for (const t of it.topics || []) if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t)) err(`${where}: topic "${t}" must be a lowercase-hyphen slug`);
  if (it.impact && !IMPACTS.has(it.impact)) err(`${where}: impact must be one of ${[...IMPACTS].join('|')}`);
}

for (const [si, sec] of (ed.sections || []).entries()) {
  const where = `sections[${si}] "${sec.name}"`;
  if (!SECTIONS.has(sec.name)) err(`${where}: unknown section name. Allowed: ${[...SECTIONS].join(' | ')}`);
  if (!Array.isArray(sec.items) || !sec.items.length) err(`${where}: has no items (drop empty sections)`);
  for (const [ii, it] of (sec.items || []).entries()) checkItem(it, `${where} item[${ii}]`);
}
if (ed.edition === 'monday') {
  const w = ed.week_in_review;
  if (!w || !Array.isArray(w.items) || !w.items.length) err(`Monday edition must include week_in_review with items`);
  else {
    const ws = Array.isArray(w.summary) ? w.summary.join(' ') : String(w.summary || '');
    if (ws.trim().length < 200) err(`week_in_review.summary too short`);
    for (const [ii, it] of w.items.entries()) checkItem(it, `week_in_review item[${ii}]`);
  }
}
if (itemTotal < 5) warn(`only ${itemTotal} items — a normal day has 10–25`);

async function checkUrl(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  const headers = { 'user-agent': 'Mozilla/5.0 (compatible; ai-edge-briefing-linkcheck/1.0)', accept: 'text/html,application/xhtml+xml,*/*' };
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers, signal: ctl.signal });
    if (r.status === 405 || r.status === 403 || r.status === 400 || r.status === 501) r = await fetch(url, { method: 'GET', redirect: 'follow', headers, signal: ctl.signal });
    return { status: r.status };
  } catch (e) { return { error: e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(timer); }
}

(async () => {
  if (checkLinks && !errors.length) {
    const list = [...urls.entries()];
    console.log(`Checking ${list.length} links…`);
    const results = await Promise.all(list.map(async ([url, where]) => [url, where, await checkUrl(url)]));
    for (const [url, where, r] of results) {
      if (r.error) warn(`${where}: ${url} — ${r.error} (could not verify; verify manually via WebFetch)`);
      else if (r.status === 404 || r.status === 410) err(`${where}: ${url} — HTTP ${r.status} (dead link: fix or remove)`);
      else if (r.status >= 400) warn(`${where}: ${url} — HTTP ${r.status} (bot-blocked? verify manually via WebFetch)`);
    }
  }
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`ERROR ${e}`);
  console.log(`${file}: ${itemTotal} items, ${urls.size} links — ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
})();
