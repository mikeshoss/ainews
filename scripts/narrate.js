#!/usr/bin/env node
'use strict';
// Deterministic single-voice narration of an edition — built from the edition text itself, no LLM.
// This is the podcast fallback when no valid dialogue script exists: faithful by construction.
// Usage: node scripts/narrate.js data/2026-09-11.json [--full]   (prints the narration; --full reads every bullet)

const fs = require('fs');
const path = require('path');
const { spokenDate, spokenDates, paragraphs, PODCAST } = require('./lib.js');

const NARRATOR_VOICE = 'cedar';

// Make written text read well aloud without changing any fact.
function spoken(s) {
  return spokenDates(String(s))
    .replace(/\s&\s/g, ' and ')
    .replace(/→/g, ' to ')
    .replace(/\be\.g\.\s?/g, 'for example, ')
    .replace(/\bi\.e\.\s?/g, 'that is, ')
    .replace(/\bvs\.?\s/g, 'versus ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CAVEAT_SENTENCE = {
  'company-claim': 'Note: this is a company claim that has not been independently verified.',
  'single-source': 'Note: only a single source has reported this so far.',
  preprint: 'Note: this is a preprint that has not been peer reviewed.',
  update: 'This is an update to a story covered in an earlier edition.',
};

function narrationFor(ed, opts = {}) {
  const full = !!opts.full; // full: every bullet; default: headline + first bullet + caveats (~15 min)
  const lines = [];
  const say = (text, extra) => { const t = spoken(text); if (t) lines.push({ host: 'N', text: t, ...(extra || {}) }); };
  const monday = ed.edition === 'monday';

  say(`Good morning. It's ${spokenDate(ed.date)}, and this is ${PODCAST.title}, presented by ${PODCAST.presenter}${monday ? ' — the Monday edition' : ''}.`);
  say(`This episode is voiced by AI, read directly from the written edition. What you're about to hear is the last 24 hours in frontier AI: the advances, the research, and how it's being used, for good and for harm. Every claim comes from a source you can check on the site.`, { pause: 1.4 });
  for (const p of paragraphs(ed.summary)) say(p);

  for (const sec of ed.sections) {
    say(`Next: ${sec.name}.`, { section: true });
    for (const it of sec.items) {
      say(it.headline.replace(/\.?$/, '.'));
      for (const b of full ? it.bullets : it.bullets.slice(0, 1)) say(b);
      for (const f of it.flags || []) if (CAVEAT_SENTENCE[f]) say(CAVEAT_SENTENCE[f]);
      const names = (it.sources || []).map((s) => s.name).filter(Boolean);
      if (names.length) say(`Reported by ${names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]}.`);
    }
  }

  const w = ed.week_in_review;
  if (monday && w && (w.items || []).length) {
    say(`And now, the week in review${w.period ? `, covering ${w.period}` : ''}.`, { section: true });
    for (const p of paragraphs(w.summary)) say(p);
    for (const it of w.items) {
      say(it.headline.replace(/\.?$/, '.'));
      for (const b of full ? it.bullets : it.bullets.slice(0, 1)) say(b);
      for (const f of it.flags || []) if (CAVEAT_SENTENCE[f]) say(CAVEAT_SENTENCE[f]);
    }
    if ((w.figures || []).length) {
      say('By the numbers.');
      for (const f of w.figures) say(`${f.value}: ${f.label}${f.source ? `, according to ${f.source}` : ''}.`);
    }
    if ((w.calendar || []).length) {
      say('On the calendar this week.');
      for (const c of w.calendar) say(`${c.date}: ${c.event}${c.source ? `, per ${c.source}` : ''}.`);
    }
  }

  say(`That's ${PODCAST.title} for today. The full edition, with a link to every source, is on the site. Listen in tomorrow for the next edition. Have a good day.`);
  return { date: ed.date, format: 'narration', hosts: { N: { name: 'Narrator', voice: NARRATOR_VOICE } }, lines };
}

module.exports = { narrationFor, spoken, NARRATOR_VOICE };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: narrate.js data/YYYY-MM-DD.json'); process.exit(2); }
  const ed = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  ed.sections = (ed.sections || []).filter((s) => s.items && s.items.length);
  const n = narrationFor(ed, { full: process.argv.includes('--full') });
  const words = n.lines.reduce((a, l) => a + l.text.split(/\s+/).length, 0);
  console.log(n.lines.map((l) => l.text).join('\n\n'));
  console.error(`\n[${n.lines.length} lines, ${words} words, ~${Math.round(words / 150)} min]`);
}
