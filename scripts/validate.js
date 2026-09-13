#!/usr/bin/env node
'use strict';
// Validates a daily edition file. Usage: node scripts/validate.js data/2026-09-11.json [--check-links]
// Exits non-zero on any schema error, or (with --check-links) on any link that returns 404/410.
// Other HTTP failures (403, 429, timeouts — common for bot-blocking sites) are reported as warnings.
// The week in review has its own file and validator: scripts/validate-week.js.

const fs = require('fs');
const path = require('path');
const { makeReporter, checkItem, checkLinks } = require('./validate-lib.js');

const SECTIONS = new Set([
  'Frontier models & labs', 'Research & papers', 'Security, misuse & threat intelligence',
  'Military, defense & geopolitics', 'Health, science & medicine', 'Policy, regulation & law',
  'Compute, chips & infrastructure', 'Deployment & impact',
]);

const file = process.argv[2];
const doLinks = process.argv.includes('--check-links');
if (!file) { console.error('usage: validate.js data/YYYY-MM-DD.json [--check-links]'); process.exit(2); }

const rep = makeReporter();
const { err, warn } = rep;

let ed;
try { ed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`Cannot parse ${file}: ${e.message}`); process.exit(1); }

const fname = path.basename(file, '.json');
if (!/^\d{4}-\d{2}-\d{2}$/.test(fname)) err(`filename must be YYYY-MM-DD.json (got ${fname})`);
if (ed.date !== fname) err(`"date" (${ed.date}) must match filename (${fname})`);
if (ed.edition !== 'daily') err(`"edition" must be "daily" (the week in review is a separate data/DATE.week.json)`);
if (ed.week_in_review) err(`"week_in_review" no longer belongs in a daily edition — it is its own file, data/DATE.week.json`);
if (!ed.generated_at || isNaN(Date.parse(ed.generated_at))) err(`"generated_at" must be an ISO timestamp`);
const summaryText = Array.isArray(ed.summary) ? ed.summary.join(' ') : String(ed.summary || '');
if (summaryText.trim().length < 200) err(`"summary" is too short (${summaryText.trim().length} chars; want a real paragraph or two)`);
if (!Array.isArray(ed.sections) || !ed.sections.length) err(`"sections" must be a non-empty array`);

const ctx = { err, warn, urls: new Map(), headlines: new Set() };
let itemTotal = 0;
for (const [si, sec] of (ed.sections || []).entries()) {
  const where = `sections[${si}] "${sec.name}"`;
  if (!SECTIONS.has(sec.name)) err(`${where}: unknown section name. Allowed: ${[...SECTIONS].join(' | ')}`);
  if (!Array.isArray(sec.items) || !sec.items.length) err(`${where}: has no items (drop empty sections)`);
  for (const [ii, it] of (sec.items || []).entries()) { itemTotal++; checkItem(it, `${where} item[${ii}]`, ctx); }
}
if (itemTotal < 5) warn(`only ${itemTotal} items — a normal day has 10–25`);

(async () => {
  if (doLinks && !rep.errors.length) await checkLinks(ctx.urls, rep);
  rep.report(file, `${itemTotal} items, ${ctx.urls.size} links`);
})();
