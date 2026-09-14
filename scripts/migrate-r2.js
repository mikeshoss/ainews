#!/usr/bin/env node
'use strict';
// One-time move of the podcast assets from the GitHub Release "audio" to R2. Idempotent: objects already in R2 with
// the same size are skipped; index.json URLs are rewritten from the release base to AUDIO_BASE and merged with
// whatever R2 already holds. Never run by CI. Usage: node scripts/migrate-r2.js [--dry-run] [--verify]
const fs = require('fs');
const path = require('path');
const r2 = require('./r2.js');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'mikeshoss/ainews';
const GITHUB_BASE = `https://github.com/${REPO}/releases/download/audio`;
const DRY = process.argv.includes('--dry-run');
const VERIFY_ONLY = process.argv.includes('--verify');
const rewrite = (u) => (typeof u === 'string' && u.startsWith(GITHUB_BASE + '/') ? `${r2.AUDIO_BASE}/${u.slice(GITHUB_BASE.length + 1)}` : u);
const rewriteEntry = (e) => ({ ...e, url: rewrite(e.url), ...(e.image ? { image: rewrite(e.image) } : {}), ...(e.og ? { og: rewrite(e.og) } : {}) });

async function fetchJson(url) { const r = await fetch(url, { headers: { 'user-agent': 'ainews-migrate', accept: 'application/json' } }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }

async function verify(index) {
  const urls = new Map(); // url -> expected bytes (mp3) or null
  for (const e of [...Object.values(index.episodes || {}), ...Object.values(index.versions || {}).flat()]) {
    urls.set(e.url, e.bytes || null);
    if (e.image) urls.set(e.image, null);
    if (e.og) urls.set(e.og, null);
  }
  let bad = 0;
  for (const [u, bytes] of urls) {
    const r = await fetch(u, { method: 'HEAD' });
    const len = Number(r.headers.get('content-length'));
    const ok = r.ok && r.headers.get('accept-ranges') === 'bytes' && (bytes == null || len === bytes) && !u.startsWith(GITHUB_BASE);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'BAD '} ${r.status} ${String(len).padStart(9)} ${r.headers.get('content-type') || '-'}  ${u}`);
  }
  const newest = Object.values(index.episodes || {}).sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1))[0];
  if (newest) { const r = await fetch(newest.url, { headers: { range: 'bytes=0-100' } }); console.log(`${r.status === 206 ? 'ok  ' : 'BAD '} range request → ${r.status}`); if (r.status !== 206) bad++; }
  return bad;
}

(async () => {
  if (!r2.configured()) { console.error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set'); process.exit(2); }
  if (VERIFY_ONLY) {
    const buf = await r2.get('index.json'); if (!buf) { console.error('no index.json in R2'); process.exit(1); }
    process.exit((await verify(JSON.parse(buf.toString()))) ? 1 : 0);
  }
  const rel = await fetchJson(`https://api.github.com/repos/${REPO}/releases/tags/audio`);
  const assets = rel.assets.filter((a) => a.name !== 'index.json');
  const existing = new Map((await r2.list()).map((o) => [o.key, o]));
  for (const a of assets) {
    const have = existing.get(a.name);
    if (have && have.bytes === a.size) { console.log(`skip ${a.name} (already in R2, ${a.size} bytes)`); continue; }
    console.log(`${DRY ? 'would upload' : 'upload'} ${a.name} (${(a.size / 1e6).toFixed(1)} MB)`);
    if (DRY) continue;
    const r = await fetch(a.browser_download_url, { headers: { 'user-agent': 'ainews-migrate' } });
    if (!r.ok) throw new Error(`${a.name}: download HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length !== a.size) throw new Error(`${a.name}: got ${buf.length} bytes, expected ${a.size}`);
    await r2.put(a.name, buf, r2.contentTypeFor(a.name), r2.cacheFor(a.name));
  }
  // Index: the live release copy, rewritten, merged over whatever R2 already has.
  const gh = await fetchJson(`${GITHUB_BASE}/index.json`);
  const curBuf = await r2.get('index.json');
  const merged = curBuf ? JSON.parse(curBuf.toString()) : { episodes: {} };
  merged.episodes = merged.episodes || {}; merged.versions = merged.versions || {};
  for (const [date, e] of Object.entries(gh.episodes || {})) {
    const cur = merged.episodes[date];
    if (!cur || cur.url.startsWith(GITHUB_BASE)) merged.episodes[date] = rewriteEntry(e);
  }
  for (const [date, list] of Object.entries(gh.versions || {})) {
    const cur = merged.versions[date] || [];
    const labels = new Set(cur.map((v) => v.label));
    merged.versions[date] = [...cur.map(rewriteEntry), ...list.filter((v) => !labels.has(v.label)).map(rewriteEntry)];
  }
  console.log(`index: ${Object.keys(merged.episodes).length} episodes, ${Object.values(merged.versions).flat().length} versions`);
  if (!DRY) {
    await r2.put('index.json', Buffer.from(JSON.stringify(merged, null, 2)), 'application/json', r2.CACHE.index);
    fs.mkdirSync(path.join(ROOT, 'audio'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'audio', 'index.json'), JSON.stringify(merged, null, 2));
    const bad = await verify(merged);
    console.log(bad ? `${bad} problem(s)` : 'all objects verified');
    process.exit(bad ? 1 : 0);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
