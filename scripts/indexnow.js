#!/usr/bin/env node
'use strict';
// Tells Bing/Yandex/Seznam (IndexNow) which pages changed today, so they crawl them within minutes. Off until
// INDEXNOW_KEY is set (any 32+ char hex string you choose; build.js publishes it at /<key>.txt as proof of ownership).
// Google does not use IndexNow; it reads the sitemap from Search Console. Usage: node scripts/indexnow.js [--dry-run]
const { SITE_URL, loadEditions, loadWeeks, loadStorylines } = require('./build.js');
const KEY = process.env.INDEXNOW_KEY, DRY = process.argv.includes('--dry-run');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
(async () => {
  if (!KEY) { console.log('INDEXNOW_KEY not set — skipping'); return; }
  const editions = loadEditions(), weeks = loadWeeks(), storylines = loadStorylines(editions, weeks).filter((s) => s.status !== 'proposed');
  const urls = new Set([`${SITE_URL}/`, `${SITE_URL}/daily/`, `${SITE_URL}/storylines/`, `${SITE_URL}/topics/`, `${SITE_URL}/podcast/`]);
  for (const ed of editions) if (ed.date === today) urls.add(`${SITE_URL}/${ed.date}/`);
  for (const wk of weeks) if (wk.date === today) { urls.add(`${SITE_URL}/week/${wk.date}/`); urls.add(`${SITE_URL}/week/`); }
  for (const st of storylines) if (st.lastActivity === today) urls.add(`${SITE_URL}/storylines/${st.id}/`);
  const list = [...urls];
  console.log(`${DRY ? 'would submit' : 'submitting'} ${list.length} url(s)`); if (DRY) { list.forEach((u) => console.log('  ' + u)); return; }
  const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: new URL(SITE_URL).host, key: KEY, keyLocation: `${SITE_URL}/${KEY}.txt`, urlList: list }) });
  console.log(`IndexNow HTTP ${res.status}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
