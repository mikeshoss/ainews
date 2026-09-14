#!/usr/bin/env node
'use strict';
// Adds or updates DNS records on the site's zone through the Cloudflare API (the same token as R2) — used for
// sender authentication (Brevo DKIM/DMARC), search-console verification, IndexNow, etc. No dependencies.
// Usage: node scripts/dns.js add <TYPE> <name> <content> [--proxied]   |   node scripts/dns.js list [name]
// name may be a subdomain label ("brevo._domainkey") or a full name; content is the record value.
const fs = require('fs');
const path = require('path');
(function loadDotenv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } })(path.join(__dirname, '..', 'stats', '.env'));
const TOKEN = process.env.CLOUDFLARE_API_TOKEN, ZONE = process.env.DNS_ZONE || 'aiedgebriefing.com', API = 'https://api.cloudflare.com/client/v4';
const call = async (method, p, body) => { const r = await fetch(`${API}${p}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!j.success) throw new Error(`${method} ${p}: ${(j.errors || []).map((e) => e.message).join('; ')}`); return j.result; };
(async () => {
  if (!TOKEN) throw new Error('CLOUDFLARE_API_TOKEN not set');
  const [cmd, ...a] = process.argv.slice(2);
  const zone = (await call('GET', `/zones?name=${ZONE}`))[0]; if (!zone) throw new Error(`zone ${ZONE} not found`);
  const full = (n) => (n === '@' || !n ? ZONE : n.endsWith(ZONE) ? n : `${n}.${ZONE}`);
  if (cmd === 'list') { for (const r of await call('GET', `/zones/${zone.id}/dns_records?per_page=200${a[0] ? `&name=${full(a[0])}` : ''}`)) console.log(`${r.type.padEnd(6)} ${r.name.padEnd(40)} ${r.proxied ? '(proxied) ' : ''}${r.content}`); return; }
  if (cmd === 'add') {
    const [type, name, content] = a; if (!type || !name || content == null) throw new Error('add <TYPE> <name> <content> [--proxied]');
    const proxied = process.argv.includes('--proxied');
    const existing = (await call('GET', `/zones/${zone.id}/dns_records?type=${type}&name=${full(name)}`)).find((r) => type !== 'TXT' || r.content.replace(/^"|"$/g, '') === content);
    const body = { type, name: full(name), content, ttl: 1, proxied };
    const r = existing ? await call('PUT', `/zones/${zone.id}/dns_records/${existing.id}`, body) : await call('POST', `/zones/${zone.id}/dns_records`, body);
    console.log(`${existing ? 'updated' : 'added'} ${r.type} ${r.name} → ${r.content}`); return;
  }
  console.log('usage: dns.js add <TYPE> <name> <content> [--proxied] | list [name]'); process.exit(2);
})().catch((e) => { console.error(e.message); process.exit(1); });
