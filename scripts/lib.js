'use strict';
// Shared helpers for the build, narration, validation and podcast scripts.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateObj = (d) => new Date(d + 'T12:00:00Z');
const longDate = (d) => { const o = dateObj(d); return `${DAYS[o.getUTCDay()]}, ${o.getUTCDate()} ${MONTHS[o.getUTCMonth()]} ${o.getUTCFullYear()}`; };
const shortDate = (d) => { const o = dateObj(d); return `${DAYS[o.getUTCDay()].slice(0, 3)} ${o.getUTCDate()} ${MONTHS[o.getUTCMonth()].slice(0, 3)}`; };
const isMonday = (d) => dateObj(d).getUTCDay() === 1;
const paragraphs = (s) => (Array.isArray(s) ? s : String(s || '').split(/\n\s*\n/)).map((p) => p.trim()).filter(Boolean);
const FLAG_LABELS = { 'company-claim': 'Company claim', 'single-source': 'Single source', preprint: 'Preprint', update: 'Update' };
module.exports = { dateObj, longDate, shortDate, isMonday, paragraphs, FLAG_LABELS };
