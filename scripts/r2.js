#!/usr/bin/env node
'use strict';
// Cloudflare R2 client for the podcast audio, over Cloudflare's REST API with one API token — no S3 keys, no
// dependencies. Objects are served publicly from AUDIO_BASE (a custom domain on the bucket).
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, R2_BUCKET (default ainews-audio), AUDIO_BASE
// (default https://audio.aiedgebriefing.com). Locally these may live in stats/.env (gitignored).
// CLI: node scripts/r2.js setup | put <file> [key] [type] [cache] | get <key> <out> | head <key> | ls [prefix]
// There is deliberately no delete.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Local convenience: read stats/.env (never committed) so setup/migration can run from a developer shell.
(function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})(path.join(ROOT, 'stats', '.env'));

const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const BUCKET = process.env.R2_BUCKET || 'ainews-audio';
const AUDIO_BASE = (process.env.AUDIO_BASE || 'https://audio.aiedgebriefing.com').replace(/\/$/, '');
const API = 'https://api.cloudflare.com/client/v4';
const configured = () => !!(TOKEN && ACCOUNT);
const publicUrl = (key) => `${AUDIO_BASE}/${key}`;

// Versioned mp3 names never change → immutable. DATE.png is re-rendered under the same name → a day. index.json changes every run.
const CACHE = { mp3: 'public, max-age=31536000, immutable', png: 'public, max-age=86400', index: 'public, max-age=60', other: 'public, max-age=3600' };
const TYPES = { mp3: 'audio/mpeg', png: 'image/png', json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain', xml: 'application/xml' };
const ext = (name) => (String(name).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
const contentTypeFor = (name) => TYPES[ext(name)] || 'application/octet-stream';
const cacheFor = (name) => (ext(name) === 'mp3' ? CACHE.mp3 : ext(name) === 'png' ? CACHE.png : name === 'index.json' ? CACHE.index : CACHE.other);

const objectUrl = (key) => `${API}/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;

// One request with retries on 5xx / network errors. Returns the Response (any status); callers decide.
async function call(method, url, { body, headers = {}, timeoutMs = 120000 } = {}) {
  if (!configured()) throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set');
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, body, headers: { authorization: `Bearer ${TOKEN}`, ...headers }, signal: ctl.signal });
      if (res.status < 500) return res;
      last = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    } catch (e) { last = e; }
    finally { clearTimeout(timer); }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
  throw last;
}
async function apiError(res, what) {
  let msg = `${what}: HTTP ${res.status}`;
  try { const j = await res.json(); if (j.errors && j.errors.length) msg += ` — ${j.errors.map((e) => `${e.code} ${e.message}`).join('; ')}`; } catch { /* not json */ }
  return new Error(msg);
}

// ---------- objects ----------
async function put(key, src, contentType, cacheControl) {
  const body = Buffer.isBuffer(src) ? src : fs.readFileSync(src);
  const res = await call('PUT', objectUrl(key), { body, headers: { 'content-type': contentType || contentTypeFor(key), 'cache-control': cacheControl || cacheFor(key), 'content-length': String(body.length) }, timeoutMs: 600000 });
  if (!res.ok) throw await apiError(res, `put ${key}`);
  return { key, bytes: body.length, url: publicUrl(key) };
}
async function get(key) {
  const res = await call('GET', objectUrl(key), { timeoutMs: 600000 });
  if (res.status === 404) return null;
  if (!res.ok) throw await apiError(res, `get ${key}`);
  return Buffer.from(await res.arrayBuffer());
}
// The objects endpoint has no HEAD; a prefix listing gives the same facts (size, type) without downloading.
async function head(key) {
  const o = (await list(key)).find((x) => x.key === key);
  return o ? { key, bytes: o.bytes, contentType: o.contentType || null, modified: o.modified } : null;
}
const exists = async (key) => !!(await head(key));
async function list(prefix = '') {
  const out = [];
  let cursor = '';
  for (;;) {
    const u = new URL(`${API}/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects`);
    if (prefix) u.searchParams.set('prefix', prefix);
    if (cursor) u.searchParams.set('cursor', cursor);
    u.searchParams.set('per_page', '1000');
    const res = await call('GET', u.toString());
    if (!res.ok) throw await apiError(res, 'list');
    const j = await res.json();
    for (const o of j.result || []) out.push({ key: o.key, bytes: o.size, modified: o.last_modified, contentType: o.http_metadata && o.http_metadata.contentType });
    cursor = j.result_info && j.result_info.cursor && (j.result_info.is_truncated ?? true) && (j.result || []).length ? j.result_info.cursor : '';
    if (!cursor) break;
  }
  return out;
}

// ---------- setup (bucket + custom domain) ----------
async function createBucket() {
  const res = await call('POST', `${API}/accounts/${ACCOUNT}/r2/buckets`, { body: JSON.stringify({ name: BUCKET }), headers: { 'content-type': 'application/json' } });
  if (res.ok) return 'created';
  const j = await res.json().catch(() => ({}));
  if (res.status === 409 || (j.errors || []).some((e) => /already exists/i.test(e.message))) return 'exists';
  throw new Error(`create bucket: HTTP ${res.status} — ${(j.errors || []).map((e) => e.message).join('; ')}`);
}
async function zoneId(name) {
  const res = await call('GET', `${API}/zones?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw await apiError(res, 'zones');
  const z = ((await res.json()).result || [])[0];
  if (!z) throw new Error(`zone ${name} not found or token cannot read zones`);
  return z.id;
}
async function domainStatus(domain) {
  const res = await call('GET', `${API}/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/domains/custom/${encodeURIComponent(domain)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await apiError(res, 'domain status');
  return (await res.json()).result;
}
async function connectDomain(domain, zone) {
  const cur = await domainStatus(domain);
  if (!cur) {
    const res = await call('POST', `${API}/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/domains/custom`, { body: JSON.stringify({ domain, zoneId: zone, enabled: true, minTLS: '1.2' }), headers: { 'content-type': 'application/json' } });
    if (!res.ok) throw await apiError(res, 'connect domain');
  }
  for (let i = 0; i < 40; i++) {
    const s = await domainStatus(domain);
    const own = s && s.status && s.status.ownership, ssl = s && s.status && s.status.ssl;
    process.stdout.write(`  ${domain}: ownership=${own || '?'} ssl=${ssl || '?'}\n`);
    if (own === 'active' && ssl === 'active') return s;
    await new Promise((r) => setTimeout(r, 6000));
  }
  throw new Error(`${domain} did not become active in time — check R2 → ${BUCKET} → Settings → Custom Domains`);
}

module.exports = { configured, AUDIO_BASE, BUCKET, publicUrl, contentTypeFor, cacheFor, CACHE, put, get, head, exists, list, createBucket, zoneId, connectDomain, domainStatus };

// ---------- CLI ----------
if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  (async () => {
    if (!configured()) { console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required (env or stats/.env)'); process.exit(2); }
    if (cmd === 'setup') {
      const host = new URL(AUDIO_BASE).hostname;
      const zoneName = host.split('.').slice(-2).join('.');
      console.log(`bucket ${BUCKET}: ${await createBucket()}`);
      const z = await zoneId(zoneName);
      await connectDomain(host, z);
      const r = await put('smoke.txt', Buffer.from(`ok ${new Date().toISOString()}\n`), 'text/plain', 'public, max-age=60');
      console.log(`smoke object: ${r.url}`);
    } else if (cmd === 'put') {
      const [file, key, type, cache] = a; if (!file) throw new Error('put <file> [key] [type] [cache]');
      console.log(await put(key || path.basename(file), file, type, cache));
    } else if (cmd === 'get') {
      const [key, out] = a; if (!key || !out) throw new Error('get <key> <out>');
      const b = await get(key); if (!b) { console.log('not found'); process.exit(1); }
      fs.writeFileSync(out, b); console.log(`${b.length} bytes → ${out}`);
    } else if (cmd === 'head') {
      console.log((await head(a[0])) || 'not found');
    } else if (cmd === 'ls') {
      for (const o of await list(a[0] || '')) console.log(`${String(o.bytes).padStart(10)}  ${o.modified || ''}  ${o.key}`);
    } else { console.error('usage: r2.js setup | put <file> [key] [type] [cache] | get <key> <out> | head <key> | ls [prefix]'); process.exit(2); }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
