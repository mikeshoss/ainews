#!/usr/bin/env node
'use strict';
// Maps each episode date to its Spotify episode id so the site can deep-link "continue in Spotify" at a timestamp.
// Spotify's show page lists recent episode ids; each id's title ("Monday, 14 September 2026") gives the date.
// The mapping accumulates in spotify.json next to the audio in R2 (and audio/spotify.json for build.js).
// Runs in Actions after podcast.js; harmless if Spotify has not indexed a new episode yet (it fills in next run).
// Usage: node scripts/spotify.js [--dry-run]
const fs = require('fs');
const path = require('path');
const r2 = require('./r2.js');
const { PODCAST } = require('./lib.js');

const ROOT = path.resolve(__dirname, '..');
const LOCAL = path.join(ROOT, 'audio', 'spotify.json');
const DRY = process.argv.includes('--dry-run');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const UA = 'AIEdgeBriefing/1.0 (+https://aiedgebriefing.com/about/)';

const dateOfTitle = (t) => { const m = String(t || '').match(/(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/); return m ? `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };

(async () => {
  const showUrl = PODCAST.listen && PODCAST.listen.Spotify && PODCAST.listen.Spotify.url;
  if (!showUrl) { console.log('no Spotify show url in PODCAST.listen'); return; }
  fs.mkdirSync(path.dirname(LOCAL), { recursive: true });
  let map = {};
  if (!DRY && r2.configured()) { const b = await r2.get('spotify.json'); if (b) map = JSON.parse(b.toString()); }
  else if (fs.existsSync(LOCAL)) map = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
  const known = new Set(Object.values(map));
  const page = await (await fetch(showUrl, { headers: { 'user-agent': UA } })).text();
  const ids = [...new Set(page.match(/episode\/([A-Za-z0-9]{22})/g) || [])].map((s) => s.slice(8));
  let added = 0;
  for (const id of ids) {
    if (known.has(id)) continue;
    try {
      const o = await (await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/episode/${id}`, { headers: { 'user-agent': UA } })).json();
      const date = dateOfTitle(o.title);
      if (date) { map[date] = id; added++; console.log(`${date} → ${id}`); }
    } catch (e) { console.log(`${id}: ${e.message}`); }
  }
  fs.writeFileSync(LOCAL, JSON.stringify(map, null, 2));
  if (added && !DRY && r2.configured()) await r2.put('spotify.json', Buffer.from(JSON.stringify(map, null, 2)), 'application/json', r2.CACHE.index);
  console.log(`${Object.keys(map).length} episode(s) mapped, ${added} new${DRY ? ' (dry run, not saved to R2)' : ''}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
