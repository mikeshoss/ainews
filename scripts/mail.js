#!/usr/bin/env node
'use strict';
// Sends each new edition to subscribers as a Resend broadcast — once. Runs in Actions after the build.
// For every data/DATE.json and DATE.week.json without a sent/<key> marker in R2: create a broadcast from the built
// site/email/DATE.reader.html (daily → the daily topic) or DATE.week.reader.html (Monday → the weekly topic) and
// send it, then write the marker. The topic is what makes a reader's daily/weekly choice hold: only contacts in the
// segment who opted in to that topic receive it.
// Always the *.reader.* file: the other copies are Mike's and carry the editorial queue, which subscribers never see.
// Only today's edition is sent; anything older is marked without sending (so a first run never blasts the archive).
// Env: RESEND_API_KEY (full access), RESEND_SEGMENT_ID, RESEND_TOPIC_DAILY, RESEND_TOPIC_WEEKLY, MAIL_FROM,
// MAIL_REPLY_TO, MAIL_POSTAL_ADDRESS (the footer; nothing is sent while it is unset) + R2 creds for the markers.
// Usage: node scripts/mail.js [--dry-run]
const fs = require('fs');
const path = require('path');
const r2 = require('./r2.js');
const { SITE_NAME } = require('./build.js');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const KEY = process.env.RESEND_API_KEY, SEGMENT = process.env.RESEND_SEGMENT_ID;
const TOPIC = { daily: process.env.RESEND_TOPIC_DAILY, weekly: process.env.RESEND_TOPIC_WEEKLY };
const FROM = process.env.MAIL_FROM || `${SITE_NAME} <briefing@aiedgebriefing.com>`;
const REPLY_TO = process.env.MAIL_REPLY_TO || 'ventures+aiedge@epiloguelabs.com';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysOld = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);

async function resend(method, p, body) {
  const res = await fetch(`https://api.resend.com${p}`, { method, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resend ${method} ${p}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  if (!DRY && (!KEY || !SEGMENT || !TOPIC.daily || !TOPIC.weekly)) { console.log('RESEND_API_KEY / RESEND_SEGMENT_ID / RESEND_TOPIC_* not set — skipping subscriber send'); return; }
  if (!DRY && !process.env.MAIL_POSTAL_ADDRESS) { console.log('::warning::MAIL_POSTAL_ADDRESS not set — the footer would carry a placeholder, so nothing is sent'); return; }
  if (!DRY && !r2.configured()) { console.log('R2 not configured — cannot record send markers; skipping'); return; }
  const files = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /^\d{4}-\d{2}-\d{2}(\.week)?\.json$/.test(f)).sort();
  for (const f of files) {
    const key = f.replace(/\.json$/, '');            // DATE or DATE.week
    const date = key.slice(0, 10), weekly = key.endsWith('.week');
    const marker = `sent/${key}`;
    if (!DRY && await r2.exists(marker)) continue;
    const htmlPath = path.join(ROOT, 'site', 'email', weekly ? `${date}.week.reader.html` : `${date}.reader.html`);
    const subjPath = path.join(ROOT, 'site', 'email', weekly ? `${date}.week.reader.subject.txt` : `${date}.reader.subject.txt`);
    if (!fs.existsSync(htmlPath)) { console.log(`${key}: no built email — run build.js first`); continue; }
    if (daysOld(date) > 0) { console.log(`${key}: not today's edition — marking as sent without sending`); if (!DRY) await r2.put(marker, Buffer.from('skipped\n'), 'text/plain', 'no-store'); continue; }
    const html = fs.readFileSync(htmlPath, 'utf8'), subject = fs.readFileSync(subjPath, 'utf8').trim();
    if (!html.includes('{{{RESEND_UNSUBSCRIBE_URL}}}')) throw new Error(`${key}: the built email has no {{{RESEND_UNSUBSCRIBE_URL}}} — refusing to send without an unsubscribe link`);
    console.log(`${key}: ${DRY ? 'would send' : 'sending'} "${subject}" (${html.length} chars) to the ${weekly ? 'weekly' : 'daily'} topic`);
    if (DRY) continue;
    const b = await resend('POST', '/broadcasts', { segment_id: SEGMENT, topic_id: weekly ? TOPIC.weekly : TOPIC.daily, from: FROM, reply_to: REPLY_TO, subject, html, name: `${SITE_NAME} ${key}`, send: true });
    await r2.put(marker, Buffer.from(`resend broadcast ${b.id} ${new Date().toISOString()}\n`), 'text/plain', 'no-store');
    console.log(`${key}: sent (broadcast ${b.id})`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
