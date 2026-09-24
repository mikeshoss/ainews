#!/usr/bin/env node
'use strict';
// Sends each new edition to the subscriber list — once. Runs in Actions after the build.
// Provider: MAIL_PROVIDER=resend (Resend broadcast to a segment) or brevo (the default until the switch).
// For every data/DATE.json and DATE.week.json without a sent/<key> marker in R2: create a Brevo campaign from the
// built site/email/DATE.reader.html (daily) or DATE.week.reader.html (Monday) and send it, then write the marker.
// Always the *.reader.* file: the other copies are Mike's and carry the editorial queue, which subscribers never see.
// Only today's edition is sent; anything older is marked without sending (so a first run never blasts the archive).
// Env (brevo): BREVO_API_KEY, BREVO_LIST_ID, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME (+ R2 creds for the markers).
// Env (resend): RESEND_API_KEY, RESEND_SEGMENT_ID, MAIL_FROM ("AI Edge Briefing <briefing@aiedgebriefing.com>"), MAIL_REPLY_TO.
// Usage: node scripts/mail.js [--dry-run]
const fs = require('fs');
const path = require('path');
const r2 = require('./r2.js');
const { SITE_NAME } = require('./build.js');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const PROVIDER = (process.env.MAIL_PROVIDER || 'brevo').toLowerCase();
const KEY = process.env.BREVO_API_KEY, LIST = Number(process.env.BREVO_LIST_ID);
const RKEY = process.env.RESEND_API_KEY, SEGMENT = process.env.RESEND_SEGMENT_ID;
const FROM = process.env.MAIL_FROM || `${SITE_NAME} <briefing@aiedgebriefing.com>`, REPLY_TO = process.env.MAIL_REPLY_TO || undefined;
const SENDER = { email: process.env.BREVO_SENDER_EMAIL || 'briefing@aiedgebriefing.com', name: process.env.BREVO_SENDER_NAME || SITE_NAME };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysOld = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);

async function brevo(method, p, body) {
  const res = await fetch(`https://api.brevo.com/v3${p}`, { method, headers: { 'api-key': KEY, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`Brevo ${method} ${p}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function resend(method, p, body) {
  const res = await fetch(`https://api.resend.com${p}`, { method, headers: { authorization: `Bearer ${RKEY}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resend ${method} ${p}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// The built reader email carries Brevo's opt-out placeholder; Resend fills its own.
const forResend = (html) => html.replaceAll('{{ unsubscribe }}', '{{{RESEND_UNSUBSCRIBE_URL}}}');

(async () => {
  if (PROVIDER !== 'brevo' && PROVIDER !== 'resend') throw new Error(`MAIL_PROVIDER must be brevo or resend, not ${PROVIDER}`);
  if (!DRY && PROVIDER === 'brevo' && (!KEY || !LIST)) { console.log('BREVO_API_KEY / BREVO_LIST_ID not set — skipping subscriber send'); return; }
  if (!DRY && PROVIDER === 'resend' && (!RKEY || !SEGMENT)) { console.log('RESEND_API_KEY / RESEND_SEGMENT_ID not set — skipping subscriber send'); return; }
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
    console.log(`${key}: ${DRY ? 'would send' : 'sending'} "${subject}" (${html.length} chars)`);
    if (DRY) continue;
    if (PROVIDER === 'resend') {
      const b = await resend('POST', '/broadcasts', { segment_id: SEGMENT, from: FROM, reply_to: REPLY_TO, subject, html: forResend(html), name: `${SITE_NAME} ${key}`, send: true });
      await r2.put(marker, Buffer.from(`resend broadcast ${b.id} ${new Date().toISOString()}\n`), 'text/plain', 'no-store');
      console.log(`${key}: sent (Resend broadcast ${b.id})`);
      continue;
    }
    const c = await brevo('POST', '/emailCampaigns', { name: `${SITE_NAME} ${key}`, subject, sender: SENDER, type: 'classic', htmlContent: html, recipients: { listIds: [LIST] } });
    await brevo('POST', `/emailCampaigns/${c.id}/sendNow`);
    await r2.put(marker, Buffer.from(`campaign ${c.id} ${new Date().toISOString()}\n`), 'text/plain', 'no-store');
    console.log(`${key}: sent (campaign ${c.id})`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
