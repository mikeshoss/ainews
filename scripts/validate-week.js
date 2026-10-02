#!/usr/bin/env node
'use strict';
// Validates a week-in-review file. Usage: node scripts/validate-week.js data/2026-09-14.week.json [--check-links]
// The week in review is Facts → Connections → Uncertainty, never Facts → Opinion. These locks make that mechanical:
//   - "What happened" items pass the same checks as daily items;
//   - a connection must join ≥2 of them, and any sentence in it that asserts a cause must attribute that cause
//     to a named source (and the connection must link that source);
//   - numbers in a connection must come from the items it joins;
//   - opinion and hedge language is rejected everywhere; "what we don't know" must say what would settle it.
// Exits non-zero on any ERROR, or (with --check-links) on any link that returns 404/410.

const fs = require('fs');
const path = require('path');
const { isMonday, addDays } = require('./lib.js');
const { STORYLINES, SLUG_RE, isHttp, OPINION_ERROR, OPINION_WARN, CAUSAL_RE, ATTRIBUTION_RE, NUM_RE, normNum, digitsOf, bannedHits, stripQuotes, sentences, makeReporter, checkItem, checkLinks } = require('./validate-lib.js');

const file = process.argv[2];
const doLinks = process.argv.includes('--check-links');
if (!file) { console.error('usage: validate-week.js data/YYYY-MM-DD.week.json [--check-links]'); process.exit(2); }

const rep = makeReporter();
const { err, warn } = rep;
const DATA_DIR = path.dirname(path.resolve(file));

let wk;
try { wk = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`Cannot parse ${file}: ${e.message}`); process.exit(1); }

// ---------- envelope ----------
const fname = path.basename(file);
const date = (fname.match(/^(\d{4}-\d{2}-\d{2})\.week\.json$/) || [])[1];
if (!date) err(`filename must be YYYY-MM-DD.week.json (got ${fname})`);
if (wk.date !== date) err(`"date" (${wk.date}) must match filename (${date})`);
if (wk.kind !== 'week') err(`"kind" must be "week"`);
if (date && !isMonday(date)) err(`${date} is not a Monday — the week in review is dated by the Monday it publishes`);
if (!wk.generated_at || isNaN(Date.parse(wk.generated_at))) err(`"generated_at" must be an ISO timestamp`);
const period = wk.period || {};
if (date && (period.from !== addDays(date, -7) || period.to !== addDays(date, -1))) err(`"period" must be {"from":"${addDays(date, -7)}","to":"${addDays(date, -1)}"} (the Monday–Sunday before ${date}); got ${JSON.stringify(period)}`);
const summaryText = Array.isArray(wk.summary) ? wk.summary.join(' ') : String(wk.summary || '');
if (summaryText.trim().length < 200) err(`"summary" is too short (${summaryText.trim().length} chars)`);

const happened = Array.isArray(wk.happened) ? wk.happened : [];
const connects = Array.isArray(wk.connects) ? wk.connects : [];
const unknowns = Array.isArray(wk.unknowns) ? wk.unknowns : [];
const figures = Array.isArray(wk.figures) ? wk.figures : [];
const calendar = Array.isArray(wk.calendar) ? wk.calendar : [];

// ---------- ids ----------
const ids = new Map(); // id -> kind
const takeId = (o, where, kind) => {
  if (!o.id || !SLUG_RE.test(o.id)) err(`${where}: needs an "id" (lowercase-hyphen slug)`);
  else if (ids.has(o.id)) err(`${where}: id "${o.id}" is already used by a ${ids.get(o.id)}`);
  else ids.set(o.id, kind);
};
happened.forEach((it, i) => takeId(it, `happened[${i}]`, 'happened'));
connects.forEach((c, i) => takeId(c, `connects[${i}]`, 'connection'));
unknowns.forEach((u, i) => takeId(u, `unknowns[${i}]`, 'unknown'));
const happenedById = new Map(happened.filter((it) => it.id).map((it) => [it.id, it]));
const itemText = (it) => [it.headline, ...(it.bullets || [])].join(' ');
const inPeriod = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && d >= period.from && d <= date;

// ---------- opinion / hedge scan ----------
function scanOpinion(text, where, { allowHedges = false } = {}) {
  const clean = stripQuotes(text);
  for (const w of bannedHits(clean, OPINION_ERROR)) err(`${where}: "${w}" — no opinion, prediction or hype; state what the sources say`);
  if (!allowHedges) for (const w of bannedHits(clean, OPINION_WARN)) warn(`${where}: "${w}" — hedge or loaded word; keep it factual (allowed inside "what we don't know")`);
}

// ---------- what happened ----------
if (happened.length < 5 || happened.length > 12) err(`"happened" has ${happened.length} items; want 5–12`);
const ctx = { err, warn, urls: new Map(), headlines: new Set() };
const editionCache = new Map();
const editionUrls = (d) => {
  if (!editionCache.has(d)) {
    const p = path.join(DATA_DIR, `${d}.json`);
    editionCache.set(d, fs.existsSync(p) ? new Set(JSON.parse(fs.readFileSync(p, 'utf8')).sections.flatMap((s) => (s.items || []).flatMap((it) => (it.sources || []).map((x) => x.url)))) : null);
  }
  return editionCache.get(d);
};
happened.forEach((it, i) => {
  const where = `happened[${i}]${it.id ? ` "${it.id}"` : ''}`;
  checkItem(it, where, ctx);
  if (!Array.isArray(it.dates) || !it.dates.length) err(`${where}: needs "dates" — the day(s) it happened`);
  for (const d of it.dates || []) if (!inPeriod(d)) err(`${where}: date ${d} is outside ${period.from}…${date}`);
  if (!Array.isArray(it.editions)) err(`${where}: needs "editions" — the daily editions it appeared in ([] if none)`);
  for (const d of it.editions || []) {
    const set = editionUrls(d);
    if (!inPeriod(d)) err(`${where}: edition ${d} is outside the period`);
    else if (!set) err(`${where}: edition ${d} does not exist (no data/${d}.json)`);
    else if (!(it.sources || []).some((s) => set.has(s.url))) warn(`${where}: none of this item's sources appear in the ${d} edition — is it really that day's story?`);
  }
  scanOpinion(itemText(it), where);
});

// ---------- what connects ----------
if (!connects.length) err(`"connects" is empty — the week in review must connect at least two developments`);
else if (connects.length < 2 || connects.length > 6) warn(`"connects" has ${connects.length} entries; 2–6 is the usual range`);
connects.forEach((c, i) => {
  const where = `connects[${i}]${c.id ? ` "${c.id}"` : ''}`;
  if (!c.title || c.title.trim().length < 15) err(`${where}: title missing or too short`);
  const items = Array.isArray(c.items) ? [...new Set(c.items)] : [];
  if (items.length < 2) err(`${where}: must join at least 2 distinct "happened" items (a single development is not a connection)`);
  for (const id of items) if (!happenedById.has(id)) err(`${where}: item "${id}" is not a happened id`);
  const paras = Array.isArray(c.explanation) ? c.explanation : [];
  const text = paras.join(' ');
  if (text.trim().length < 120) err(`${where}: explanation too short — say what each development says, what they share, and the sequence with dates`);
  if (!Array.isArray(c.topics) || !c.topics.length) err(`${where}: needs topic slugs (these build the Trends timeline)`);
  for (const t of c.topics || []) if (!SLUG_RE.test(t)) err(`${where}: topic "${t}" must be a lowercase-hyphen slug`);
  for (const id of c.storylines || []) if (!STORYLINES.has(id)) err(`${where}: storyline "${id}" does not exist`);
  const sources = Array.isArray(c.sources) ? c.sources : [];
  sources.forEach((s, si) => { if (!s || !isHttp(s.url)) err(`${where}: source[${si}] has no valid url`); else if (!ctx.urls.has(s.url)) ctx.urls.set(s.url, `${where} source[${si}]`); });
  // Attribution lock: a cause must be someone's stated cause.
  for (const sent of sentences(stripQuotes(text))) {
    if (CAUSAL_RE.test(sent) && !ATTRIBUTION_RE.test(sent)) err(`${where}: asserts a cause without attributing it — "${sent.slice(0, 140)}"`);
    else if (CAUSAL_RE.test(sent) && !sources.length) err(`${where}: attributes a cause but lists no "sources" for it — "${sent.slice(0, 140)}"`);
  }
  // Numeric lock: only numbers from the joined items (or the period).
  const allowed = new Set([...items.flatMap((id) => [...digitsOf(itemText(happenedById.get(id) || {}))]), ...digitsOf(`${date} ${period.from} ${period.to}`)]);
  for (const raw of text.match(NUM_RE) || []) if (!allowed.has(normNum(raw))) err(`${where}: number "${raw}" does not appear in any of the joined items — a connection may not introduce new figures`);
  scanOpinion(`${c.title} ${text}`, where);
});

// ---------- what we don't know ----------
if (!unknowns.length) err(`"unknowns" is empty — say where the evidence ends`);
else if (unknowns.length < 2 || unknowns.length > 8) warn(`"unknowns" has ${unknowns.length} entries; 2–8 is the usual range`);
unknowns.forEach((u, i) => {
  const where = `unknowns[${i}]${u.id ? ` "${u.id}"` : ''}`;
  if (!u.question || u.question.trim().length < 15) err(`${where}: "question" missing or too short`);
  for (const k of ['evidence_ends', 'would_confirm', 'would_invalidate']) if (!u[k] || String(u[k]).trim().length < 20) err(`${where}: "${k}" missing or too short — name the concrete document, ruling, number or event`);
  const rel = Array.isArray(u.relates_to) ? u.relates_to : [];
  if (!rel.length) err(`${where}: "relates_to" must name at least one connection or happened id`);
  for (const id of rel) if (!ids.has(id) || ids.get(id) === 'unknown') err(`${where}: relates_to "${id}" is not a connection or happened id`);
  if (!Array.isArray(u.topics) || !u.topics.length) err(`${where}: needs topic slugs`);
  for (const t of u.topics || []) if (!SLUG_RE.test(t)) err(`${where}: topic "${t}" must be a lowercase-hyphen slug`);
  scanOpinion([u.question, u.evidence_ends, u.disagreement, u.would_confirm, u.would_invalidate].filter(Boolean).join(' '), where, { allowHedges: true });
  const allowed = new Set([...rel.flatMap((id) => { const h = happenedById.get(id); if (h) return [...digitsOf(itemText(h))]; const c = connects.find((x) => x.id === id); return c ? (c.items || []).flatMap((hid) => [...digitsOf(itemText(happenedById.get(hid) || {}))]) : []; }), ...digitsOf(figures.map((f) => `${f.value} ${f.label}`).join(' ')), ...digitsOf(calendar.map((c) => `${c.date} ${c.event}`).join(' ')), ...digitsOf(`${date} ${period.from} ${period.to}`)]);
  const utext = [u.evidence_ends, u.disagreement, u.would_confirm, u.would_invalidate].filter(Boolean).join(' ');
  for (const raw of utext.match(NUM_RE) || []) if (!allowed.has(normNum(raw))) warn(`${where}: number "${raw}" is not in the related items or figures`);
});

// ---------- summary, figures, calendar ----------
scanOpinion(summaryText, 'summary');
{
  const allowed = new Set([...happened.flatMap((it) => [...digitsOf(itemText(it))]), ...digitsOf(figures.map((f) => `${f.value} ${f.label}`).join(' ')), ...digitsOf(`${date} ${period.from} ${period.to}`)]);
  for (const raw of summaryText.match(NUM_RE) || []) if (!allowed.has(normNum(raw))) warn(`summary: number "${raw}" is not in any happened item or figure`);
}
if (!figures.length) err(`"figures" is empty — 5–10 key numbers from the week, verbatim`);
else if (figures.length < 5 || figures.length > 10) warn(`"figures" has ${figures.length} entries; 5–10 is the usual range`);
figures.forEach((f, i) => {
  if (!f.value || !f.label || !isHttp(f.url)) err(`figures[${i}] needs value, label and url`);
  else if (!ctx.urls.has(f.url)) ctx.urls.set(f.url, `figures[${i}]`);
  if (!f.source) warn(`figures[${i}] has no "source" (will fall back to hostname)`);
});
if (!calendar.length) warn(`"calendar" is empty — nothing sourced in the next seven days?`);
calendar.forEach((c, i) => {
  if (!c.date || !c.event || !isHttp(c.url)) err(`calendar[${i}] needs date, event and url`);
  else if (!ctx.urls.has(c.url)) ctx.urls.set(c.url, `calendar[${i}]`);
});

// ---------- topic slugs vs the daily index ----------
try {
  const { loadEditions, buildTopicIndex } = require('./build.js');
  const known = buildTopicIndex(loadEditions(), []).topics;
  const used = new Set([...happened, ...connects, ...unknowns].flatMap((o) => o.topics || []));
  for (const t of used) if (!known.has(t)) warn(`topic "${t}" has not been used in any daily edition — reuse an existing slug if one fits (node scripts/build.js --topics)`);
} catch { /* build.js unavailable — skip */ }

(async () => {
  if (doLinks && !rep.errors.length) await checkLinks(ctx.urls, rep);
  rep.report(file, `${happened.length} developments, ${connects.length} connections, ${unknowns.length} open questions, ${ctx.urls.size} links`);
})();
