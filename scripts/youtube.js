#!/usr/bin/env node
'use strict';
// Publishes each new episode to YouTube as a video (the episode cover + the MP3, rendered with ffmpeg) — once,
// recorded in R2 (posted/youtube/DATE) with the video id kept in youtube.json for the site's listen links.
// Off until the OAuth secrets exist: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
// (a Google Cloud OAuth "Desktop" client with the YouTube Data API v3 enabled; the refresh token is obtained once
// with `node scripts/youtube.js --auth`). Only today's episode is uploaded; older ones are marked as done.
// Usage: node scripts/youtube.js [--dry-run] | --auth
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const r2 = require('./r2.js');
const { SITE_URL, SITE_NAME, loadEditions } = require('./build.js');
const { longDate, paragraphs, PODCAST } = require('./lib.js');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const ID = process.env.YOUTUBE_CLIENT_ID, SECRET = process.env.YOUTUBE_CLIENT_SECRET, REFRESH = process.env.YOUTUBE_REFRESH_TOKEN;
const ready = () => !!(ID && SECRET && REFRESH);

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: ID, client_secret: SECRET, refresh_token: REFRESH, grant_type: 'refresh_token' }) });
  const j = await res.json(); if (!j.access_token) throw new Error(`token refresh failed: ${JSON.stringify(j).slice(0, 200)}`); return j.access_token;
}

// One-time: print the consent URL, paste the code back, get the refresh token to store as a secret.
async function auth() {
  if (!ID || !SECRET) { console.log('set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET first'); return; }
  const redirect = 'urn:ietf:wg:oauth:2.0:oob';
  console.log(`Open this URL, approve, and paste the code:\n\nhttps://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(ID)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&access_type=offline&prompt=consent&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload')}\n`);
  const code = await new Promise((r) => { process.stdout.write('code: '); process.stdin.once('data', (d) => r(String(d).trim())); });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: ID, client_secret: SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }) });
  const j = await res.json();
  console.log(j.refresh_token ? `\nYOUTUBE_REFRESH_TOKEN=${j.refresh_token}\n(store it with: gh secret set YOUTUBE_REFRESH_TOKEN --repo mikeshoss/ainews)` : JSON.stringify(j));
  process.exit(0);
}

// Cover + audio → 1080p video (still image, so the file is small and encodes fast).
function render(mp3, png, out) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '2', '-i', png, '-i', mp3, '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-vf', 'scale=1080:1080', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out]);
  return out;
}

async function upload(token, file, meta) {
  const size = fs.statSync(file).size;
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(size) }, body: JSON.stringify(meta) });
  if (!init.ok) throw new Error(`upload init HTTP ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const loc = init.headers.get('location');
  const put = await fetch(loc, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(size) }, body: fs.readFileSync(file) });
  const j = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error(`upload HTTP ${put.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.id;
}

(async () => {
  if (process.argv.includes('--auth')) return auth();
  if (!DRY && !ready()) { console.log('YouTube not configured (YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN) — skipping'); return; }
  if (!DRY && !r2.configured()) { console.log('R2 not configured — skipping'); return; }
  if (spawnSync('which', ['ffmpeg']).status !== 0) { console.log('ffmpeg not found — skipping'); return; }
  const indexBuf = DRY ? null : await r2.get('index.json');
  const index = indexBuf ? JSON.parse(indexBuf.toString()) : JSON.parse(fs.readFileSync(path.join(ROOT, 'audio', 'index.json'), 'utf8'));
  const ytBuf = DRY ? null : await r2.get('youtube.json');
  const yt = ytBuf ? JSON.parse(ytBuf.toString()) : {};
  let token = null;
  for (const ed of loadEditions()) {
    const ep = index.episodes[ed.date]; if (!ep) continue;
    const marker = `posted/youtube/${ed.date}`;
    if (!DRY && (yt[ed.date] || await r2.exists(marker))) continue;
    if (ed.date !== today) { if (!DRY) await r2.put(marker, Buffer.from('skipped\n'), 'text/plain', 'no-store'); continue; }
    const title = `${longDate(ed.date)} — ${PODCAST.title}`;
    const description = `${paragraphs(ed.summary).join('\n\n')}\n\nEvery claim links to its source: ${SITE_URL}/${ed.date}/?utm_source=youtube\nTranscript: ${SITE_URL}/${ed.date}/script/\n\n${PODCAST.title}, presented by ${PODCAST.presenter}. Voiced by AI from the written edition.`;
    console.log(`${ed.date}: ${DRY ? 'would upload' : 'uploading'} "${title}"`);
    if (DRY) continue;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
    const mp3 = path.join(tmp, 'a.mp3'), png = path.join(tmp, 'c.png'), mp4 = path.join(tmp, 'v.mp4');
    fs.writeFileSync(mp3, Buffer.from(await (await fetch(ep.url)).arrayBuffer()));
    fs.writeFileSync(png, Buffer.from(await (await fetch(ep.image || `${SITE_URL}/cover.png`)).arrayBuffer()));
    render(mp3, png, mp4);
    token = token || await accessToken();
    const id = await upload(token, mp4, { snippet: { title, description, categoryId: '25', defaultLanguage: 'en' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } });
    yt[ed.date] = id;
    await r2.put('youtube.json', Buffer.from(JSON.stringify(yt, null, 2)), 'application/json', r2.CACHE.index);
    await r2.put(marker, Buffer.from(`https://youtu.be/${id}\n`), 'text/plain', 'no-store');
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`${ed.date}: https://youtu.be/${id}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
