#!/usr/bin/env node
'use strict';
// Sends each new edition to the subscriber list (Brevo) — once. Runs in Actions after the build.
// For every data/DATE.json and DATE.week.json without a sent/<key> marker in R2: create a Brevo campaign from the
// built site/email/DATE.reader.html (daily) or DATE.week.reader.html (Monday) and send it, then write the marker.
// Always the *.reader.* file: the other copies are Mike's and carry the editorial queue, which subscribers never see.
// Only today's edition is sent; anything older is marked without sending (so a first run never blasts the archive).
// Env: BREVO_API_KEY, BREVO_DAILY_LIST_ID + BREVO_WEEKLY_LIST_ID (or one BREVO_LIST_ID for both), BREVO_SENDER_EMAIL,
// BREVO_SENDER_NAME (+ R2 creds for the markers).
// Usage: node scripts/mail.js [--dry-run]
const fs = require('fs');
const path = require('path');
const r2 = require('./r2.js');
const { SITE_NAME } = require('./build.js');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const KEY = process.env.BREVO_API_KEY;
const LISTS = { daily: Number(process.env.BREVO_DAILY_LIST_ID || process.env.BREVO_LIST_ID), weekly: Number(process.env.BREVO_WEEKLY_LIST_ID || process.env.BREVO_LIST_ID) };
const SENDER = { email: process.env.BREVO_SENDER_EMAIL || 'briefing@aiedgebriefing.com', name: process.env.BREVO_SENDER_NAME || SITE_NAME };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysOld = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);

async function brevo(method, p, body) {
  const res = await fetch(`https://api.brevo.com/v3${p}`, { method, headers: { 'api-key': KEY, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`Brevo ${method} ${p}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  if (!DRY && (!KEY || !LISTS.daily || !LISTS.weekly)) { console.log('BREVO_API_KEY / list IDs not set — skipping subscriber send'); return; }
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
    console.log(`${key}: ${DRY ? 'would send' : 'sending'} "${subject}" (${html.length} chars) to the ${weekly ? 'weekly' : 'daily'} list`);
    if (DRY) continue;
    const c = await brevo('POST', '/emailCampaigns', { name: `${SITE_NAME} ${key}`, subject, sender: SENDER, type: 'classic', htmlContent: html, recipients: { listIds: [weekly ? LISTS.weekly : LISTS.daily] } });
    await brevo('POST', `/emailCampaigns/${c.id}/sendNow`);
    await r2.put(marker, Buffer.from(`campaign ${c.id} ${new Date().toISOString()}\n`), 'text/plain', 'no-store');
    console.log(`${key}: sent (campaign ${c.id})`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
