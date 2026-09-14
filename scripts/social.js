#!/usr/bin/env node
'use strict';
// Posts each new edition (and the Monday week in review) to social accounts — once per platform, recorded in R2.
// Every platform is off until its secrets exist, so this is inert by default. No dependencies.
//   X         X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET   (OAuth 1.0a user context, POST /2/tweets)
//   Bluesky   BLUESKY_HANDLE, BLUESKY_APP_PASSWORD                         (com.atproto.repo.createRecord)
//   Mastodon  MASTODON_INSTANCE, MASTODON_TOKEN                            (POST /api/v1/statuses)
// Only today's edition is posted; older ones are marked as done without posting (a first run never floods).
// Usage: node scripts/social.js [--dry-run] [--platform x|bluesky|mastodon]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const r2 = require('./r2.js');
const { SITE_URL, SITE_NAME, loadEditions, loadWeeks } = require('./build.js');
const { periodLabel, paragraphs } = require('./lib.js');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const ONLY = process.argv.includes('--platform') ? process.argv[process.argv.indexOf('--platform') + 1] : null;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hook = (summary) => (paragraphs(summary)[0] || '').split(/(?<=[.!?])\s/)[0];
const link = (p, src) => `${SITE_URL}${p}?utm_source=${src}&utm_medium=social`;
// Keep the hook whole when it fits; otherwise cut at a word and add an ellipsis. Links count as ~23 chars on X.
const fit = (text, url, max) => { const room = max - 24 - 2; const t = text.length > room ? text.slice(0, room - 1).replace(/\s+\S*$/, '') + '…' : text; return `${t}\n\n${url}`; };

// What to say. Daily: the hook sentence + link. Weekly: the shape of the week + link.
function posts() {
  const out = [];
  for (const ed of loadEditions()) out.push({ key: ed.date, text: (max, src) => fit(hook(ed.summary), link(`/${ed.date}/`, src), max), date: ed.date });
  for (const wk of loadWeeks()) out.push({ key: `${wk.date}.week`, text: (max, src) => fit(`What actually changed in AI, ${periodLabel(wk.period)}: ${wk.happened.length} developments, ${wk.connects.length} connections, ${wk.unknowns.length} open questions — facts first, no opinion.`, link(`/week/${wk.date}/`, src), max), date: wk.date });
  return out;
}

// ---------- X (OAuth 1.0a) ----------
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function oauthHeader(method, url, creds) {
  const p = { oauth_consumer_key: creds.key, oauth_nonce: crypto.randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: creds.token, oauth_version: '1.0' };
  const base = [method, enc(url), enc(Object.keys(p).sort().map((k) => `${enc(k)}=${enc(p[k])}`).join('&'))].join('&');
  p.oauth_signature = crypto.createHmac('sha1', `${enc(creds.secret)}&${enc(creds.tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.keys(p).sort().map((k) => `${enc(k)}="${enc(p[k])}"`).join(', ');
}
const PLATFORMS = {
  x: {
    max: 280, src: 'x',
    ready: () => ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'].every((k) => process.env[k]),
    async post(text) {
      const creds = { key: process.env.X_API_KEY, secret: process.env.X_API_SECRET, token: process.env.X_ACCESS_TOKEN, tokenSecret: process.env.X_ACCESS_SECRET };
      const url = 'https://api.x.com/2/tweets';
      const res = await fetch(url, { method: 'POST', headers: { authorization: oauthHeader('POST', url, creds), 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`X HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
      return `https://x.com/i/status/${j.data.id}`;
    },
  },
  bluesky: {
    max: 300, src: 'bluesky',
    ready: () => process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD,
    async post(text) {
      const s = await (await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: process.env.BLUESKY_HANDLE, password: process.env.BLUESKY_APP_PASSWORD }) })).json();
      if (!s.accessJwt) throw new Error(`Bluesky login failed: ${JSON.stringify(s).slice(0, 200)}`);
      // Make the URL clickable: a link facet over its byte range.
      const m = text.match(/https?:\/\/\S+/); const facets = [];
      if (m) { const b = Buffer.byteLength(text.slice(0, m.index)); facets.push({ index: { byteStart: b, byteEnd: b + Buffer.byteLength(m[0]) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] }); }
      const res = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: { authorization: `Bearer ${s.accessJwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text, facets, createdAt: new Date().toISOString() } }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Bluesky HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
      return `https://bsky.app/profile/${process.env.BLUESKY_HANDLE}/post/${j.uri.split('/').pop()}`;
    },
  },
  mastodon: {
    max: 500, src: 'mastodon',
    ready: () => process.env.MASTODON_INSTANCE && process.env.MASTODON_TOKEN,
    async post(text) {
      const base = process.env.MASTODON_INSTANCE.replace(/\/$/, '').replace(/^(?!https?:)/, 'https://');
      const res = await fetch(`${base}/api/v1/statuses`, { method: 'POST', headers: { authorization: `Bearer ${process.env.MASTODON_TOKEN}`, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ status: text, visibility: 'public' }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Mastodon HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
      return j.url;
    },
  },
};

(async () => {
  const active = Object.entries(PLATFORMS).filter(([name, p]) => (!ONLY || ONLY === name) && (DRY || p.ready()));
  if (!active.length) { console.log('no social platform configured — nothing to post'); return; }
  if (!DRY && !r2.configured()) { console.log('R2 not configured — cannot record post markers; skipping'); return; }
  const all = posts();
  for (const [name, p] of active) {
    for (const item of all) {
      const marker = `posted/${name}/${item.key}`;
      if (!DRY && await r2.exists(marker)) continue;
      if (item.date !== today) { if (!DRY) await r2.put(marker, Buffer.from('skipped\n'), 'text/plain', 'no-store'); continue; }
      const text = item.text(p.max, p.src);
      console.log(`[${name}] ${item.key}${DRY ? ' (dry run)' : ''}:\n${text}\n`);
      if (DRY) continue;
      try {
        const url = await p.post(text);
        await r2.put(marker, Buffer.from(`${url}\n${new Date().toISOString()}\n`), 'text/plain', 'no-store');
        console.log(`[${name}] posted ${url}`);
      } catch (e) { console.log(`[${name}] FAILED ${item.key}: ${e.message}`); }
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
