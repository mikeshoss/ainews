'use strict';
// Shared helpers for the build, narration, validation and podcast scripts.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateObj = (d) => new Date(d + 'T12:00:00Z');
const longDate = (d) => { const o = dateObj(d); return `${DAYS[o.getUTCDay()]}, ${o.getUTCDate()} ${MONTHS[o.getUTCMonth()]} ${o.getUTCFullYear()}`; };
const shortDate = (d) => { const o = dateObj(d); return `${DAYS[o.getUTCDay()].slice(0, 3)} ${o.getUTCDate()} ${MONTHS[o.getUTCMonth()].slice(0, 3)}`; };
const isMonday = (d) => dateObj(d).getUTCDay() === 1;
const paragraphs = (s) => (Array.isArray(s) ? s : String(s || '').split(/\n\s*\n/)).map((p) => p.trim()).filter(Boolean);
// Spoken forms: "Friday, September 11th" — how a person says a date, not how it is written.
const ordinal = (n) => { const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(n % 10, 4)] || 'th'); };
const spokenDate = (d) => { const o = dateObj(d); return `${DAYS[o.getUTCDay()]}, ${MONTHS[o.getUTCMonth()]} ${ordinal(o.getUTCDate())}`; };
const MONTH_RE = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const fullMonth = (m) => MONTHS.find((x) => x.toLowerCase().startsWith(m.slice(0, 3).toLowerCase())) || m;
// Rewrite written dates inside prose into spoken form: "10 September 2026" → "September 10th, 2026", "3 and 5 August" → "August 3rd and 5th", "1–7 Sep" → "September 1st to 7th".
function spokenDates(text) {
  return String(text)
    .replace(new RegExp(`\\b(\\d{1,2})\\s*[–-]\\s*(\\d{1,2}) ${MONTH_RE}\\b( \\d{4})?`, 'g'), (m, a, b, mo, y) => `${fullMonth(mo)} ${ordinal(+a)} to ${ordinal(+b)}${y || ''}`)
    .replace(new RegExp(`\\b(\\d{1,2}) and (\\d{1,2}) ${MONTH_RE}\\b( \\d{4})?`, 'g'), (m, a, b, mo, y) => `${fullMonth(mo)} ${ordinal(+a)} and ${ordinal(+b)}${y || ''}`)
    .replace(new RegExp(`\\b(\\d{1,2}) ${MONTH_RE}\\b(,? \\d{4})?`, 'g'), (m, d, mo, y) => `${fullMonth(mo)} ${ordinal(+d)}${y ? ', ' + y.replace(/^,? /, '') : ''}`);
}

const FLAG_LABELS = { 'company-claim': 'Company claim', 'single-source': 'Single source', preprint: 'Preprint', update: 'Update' };
// Section colours — the documented palette used for podcast covers and site accents. Keep README.md in sync.
const SECTION_COLORS = {
  'Frontier models & labs':                 { hex: '#3B82F6', name: 'electric blue', short: 'Frontier' },
  'Research & papers':                      { hex: '#8B5CF6', name: 'violet',        short: 'Research' },
  'Security, misuse & threat intelligence': { hex: '#EF4444', name: 'red',           short: 'Security' },
  'Military, defense & geopolitics':        { hex: '#F97316', name: 'orange',        short: 'Military' },
  'Health, science & medicine':             { hex: '#10B981', name: 'green',         short: 'Health' },
  'Policy, regulation & law':               { hex: '#EAB308', name: 'gold',          short: 'Policy' },
  'Compute, chips & infrastructure':        { hex: '#06B6D4', name: 'cyan',          short: 'Compute' },
  'Deployment & impact':                    { hex: '#EC4899', name: 'magenta',       short: 'Deployment' },
};
const PODCAST = { title: 'The AI Edge', presenter: 'Epilogue', tagline: 'Daily, fact-first frontier AI news' };

// Share of the day's items per section (daily sections only; the Monday week-in-review is not counted).
function sectionWeights(ed) {
  const counts = (ed.sections || []).map((s) => [s.name, (s.items || []).length]).filter(([, n]) => n > 0);
  const total = counts.reduce((a, [, n]) => a + n, 0) || 1;
  return counts.map(([name, n]) => ({ name, count: n, share: n / total, ...(SECTION_COLORS[name] || { hex: '#9a9a9a', name: 'grey', short: name }) })).sort((a, b) => b.share - a.share);
}

module.exports = { dateObj, longDate, shortDate, spokenDate, spokenDates, ordinal, isMonday, paragraphs, FLAG_LABELS, SECTION_COLORS, PODCAST, sectionWeights };
