#!/usr/bin/env node
'use strict';
// Private per-day snapshot of how the briefing is doing: what each edition cost to make, how the podcast is
// being downloaded, and (when Google Analytics credentials are present) how the site is being read.
// Writes to stats/ (gitignored — nothing here is published) and prints a table.
//
// Usage: node scripts/stats.js [--days N] [--json] [--no-fetch]
//   --days N     how many days to show (default 14)
//   --json       print the per-day records as JSON instead of the table
//   --no-fetch   don't call OP3 / Google; use the last stored snapshots
//
// Sources
//   trace/DATE.jsonl + DATE.transcript.jsonl   run time, tool calls, subagents, token usage → Claude cost (API list price)
//   data/DATE.json, data/DATE.script.json       items, sections, whether the podcast script passed
//   OP3 (op3.dev, optional)                      IAB-style download counts per episode, top apps; needs OP3_API_KEY in
//                                                stats/.env. Snapshotted daily so per-day deltas can be computed.
//                                                (Before 2026-09-14 the snapshots were GitHub release download counts —
//                                                a different, cruder measure; deltas are never computed across the boundary.)
//   index.json from the audio bucket              episode length → TTS cost estimate
//   GA4 Data API (optional)                       users, page views, outbound clicks per day. Needs GA4_PROPERTY_ID and
//                                                GA4_SERVICE_ACCOUNT (path to a service-account JSON that has Viewer
//                                                access on the property); read from the environment or stats/.env.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AUDIO_BASE } = require('./r2.js');
const { podcastGuid } = require('./lib.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'stats');
const TZ = 'America/Toronto';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1]) || 14;
const JSON_OUT = args.includes('--json');
const FETCH = !args.includes('--no-fetch');

// USD per million tokens: [input, output, cache read, cache write 5m, cache write 1h]. Anthropic list prices.
const CLAUDE_PRICES = {
  'claude-opus-5': [5, 25, 0.5, 6.25, 10],
  'claude-sonnet-5': [2, 10, 0.2, 2.5, 4],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25, 2],
};
const TTS_USD_PER_MINUTE = 0.015; // OpenAI gpt-4o-mini-tts, approximate list price per minute of audio

fs.mkdirSync(path.join(OUT, 'downloads'), { recursive: true });
loadDotenv(path.join(OUT, '.env'));

// ---------- editions & runs ----------
function usageOf(file) {
  const seen = new Set();
  const sum = { model: null, messages: 0, input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const m = r.message; if (!m || !m.usage || (m.id && seen.has(m.id))) continue;
    if (m.id) seen.add(m.id);
    const u = m.usage; const cc = u.cache_creation || {};
    sum.model = sum.model || m.model || null; sum.messages++;
    sum.input += u.input_tokens || 0; sum.output += u.output_tokens || 0; sum.cache_read += u.cache_read_input_tokens || 0;
    sum.cache_write_5m += cc.ephemeral_5m_input_tokens || 0;
    sum.cache_write_1h += cc.ephemeral_1h_input_tokens != null ? cc.ephemeral_1h_input_tokens : Math.max(0, (u.cache_creation_input_tokens || 0) - (cc.ephemeral_5m_input_tokens || 0));
  }
  return sum.messages ? sum : null;
}
function costOf(u) {
  if (!u) return 0;
  const p = CLAUDE_PRICES[u.model] || CLAUDE_PRICES['claude-opus-5'];
  return (u.input * p[0] + u.output * p[1] + u.cache_read * p[2] + u.cache_write_5m * p[3] + u.cache_write_1h * p[4]) / 1e6;
}
const addUsage = (a, b) => { if (!b) return a; if (!a) return { ...b }; for (const k of ['messages', 'input', 'output', 'cache_read', 'cache_write_5m', 'cache_write_1h']) a[k] += b[k] || 0; return a; };

function runFor(date) {
  const file = path.join(ROOT, 'trace', `${date}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const evs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const run = { started: null, ended: null, minutes: 0, tools: {}, tool_calls: 0, subagents: 0, email_sent: false, usage: null, subagent_usage: null, usage_complete: false };
  for (const e of evs) {
    if (e.event === 'SessionStart' && !run.started) run.started = e.t;
    run.ended = e.t;
    if (e.event === 'PostToolUse') { run.tool_calls++; run.tools[e.tool_name] = (run.tools[e.tool_name] || 0) + 1; if (/gmail.*send_message/i.test(e.tool_name || '')) run.email_sent = true; }
    if (e.event === 'SubagentStop') { run.subagents++; if (e.usage) run.subagent_usage = addUsage(run.subagent_usage, e.usage); }
    if (e.event === 'Stop' && e.usage) run.usage = e.usage; // the last Stop carries the whole session
  }
  // Older traces have no usage on the Stop event; sum the kept transcript instead (main session only).
  const transcript = path.join(ROOT, 'trace', `${date}.transcript.jsonl`);
  if (!run.usage && fs.existsSync(transcript)) run.usage = usageOf(transcript);
  run.usage_complete = !!(run.usage && (run.subagents === 0 || run.subagent_usage));
  if (run.started && run.ended) run.minutes = Math.round((new Date(run.ended) - new Date(run.started)) / 60000);
  run.claude_usd = costOf(run.usage) + costOf(run.subagent_usage);
  return run;
}

function editionFor(date) {
  const file = path.join(ROOT, 'data', `${date}.json`);
  if (!fs.existsSync(file)) return null;
  const ed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sections = (ed.sections || []).filter((s) => (s.items || []).length);
  const items = sections.reduce((a, s) => a + s.items.length, 0);
  const links = new Set(sections.flatMap((s) => s.items.flatMap((i) => (i.sources || []).map((x) => x.url)))).size;
  return { edition: ed.edition || 'daily', items, sections: sections.length, links, script: fs.existsSync(path.join(ROOT, 'data', `${date}.script.json`)) };
}

// ---------- podcast downloads (OP3) ----------
const OP3 = 'https://op3.dev/api/1';
async function op3Get(pathAndQuery) {
  const res = await fetch(`${OP3}${pathAndQuery}`, { headers: { authorization: `Bearer ${process.env.OP3_API_KEY}`, 'user-agent': 'ainews-stats' } });
  if (!res.ok) throw new Error(`OP3 ${pathAndQuery.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function fetchOp3() {
  if (!process.env.OP3_API_KEY) throw new Error('no OP3_API_KEY in stats/.env (get one at https://op3.dev/api/keys)');
  const showFile = path.join(OUT, 'op3-show.json');
  let show = fs.existsSync(showFile) ? JSON.parse(fs.readFileSync(showFile, 'utf8')) : null;
  if (!show || !show.showUuid) {
    try { show = await op3Get(`/shows/${podcastGuid()}`); }
    catch (e) { if (/HTTP 404/.test(e.message)) throw new Error('OP3 does not know the show yet — it appears once podcast apps have fetched episodes through the op3.dev prefix (and the feed is in the Podcast Index: podcastindex.org/add)'); throw e; }
    fs.writeFileSync(showFile, JSON.stringify(show, null, 2));
  }
  const uuid = show.showUuid;
  const [ep, sh, apps] = await Promise.all([
    op3Get(`/queries/episode-download-counts?showUuid=${uuid}`),
    op3Get(`/queries/show-download-counts?showUuid=${uuid}`),
    op3Get(`/queries/top-apps-for-show?showUuid=${uuid}`),
  ]);
  const episodes = {};
  for (const e of ep.episodes || []) {
    const date = (String(e.itemGuid || '').match(/(\d{4}-\d{2}-\d{2})/) || [])[1]; if (!date) continue;
    episodes[date] = { d1: e.downloads1 ?? null, d3: e.downloads3 ?? null, d7: e.downloads7 ?? null, d30: e.downloads30 ?? null, all: e.downloadsAll ?? null, title: e.title || null };
  }
  const counts = (sh.showDownloadCounts || {})[uuid] || {};
  const snap = { source: 'op3', taken_at: new Date().toISOString(), showUuid: uuid, episodes, show: { monthly: counts.monthlyDownloads ?? null, weekly: counts.weeklyDownloads || null, weeklyAvg: counts.weeklyAvgDownloads ?? null }, apps: apps.appDownloads || apps.downloads || {} };
  fs.writeFileSync(path.join(OUT, 'downloads', `${today()}.json`), JSON.stringify(snap, null, 2));
  return snap;
}
function loadSnapshots() {
  return fs.readdirSync(path.join(OUT, 'downloads')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    .map((f) => ({ date: f.slice(0, 10), ...JSON.parse(fs.readFileSync(path.join(OUT, 'downloads', f), 'utf8')) }));
}
// All-time mp3 downloads in a snapshot, whichever source wrote it.
const snapSource = (snap) => snap.source || (snap.assets ? 'github' : 'unknown');
const mp3Total = (snap) => snapSource(snap) === 'op3' ? Object.values(snap.episodes || {}).reduce((a, e) => a + (e.all || 0), 0) : (snap.assets || []).filter((a) => a.name.endsWith('.mp3')).reduce((a, x) => a + x.downloads, 0);
const episodeOf = (name) => (name.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
// Per-episode all-time downloads from a snapshot (any source).
const episodeTotal = (snap, date) => snapSource(snap) === 'op3' ? ((snap.episodes || {})[date] || {}).all ?? null : (snap.assets || []).filter((x) => x.name.endsWith('.mp3') && episodeOf(x.name) === date).reduce((s, x) => s + x.downloads, 0);

async function loadAudioIndex() {
  const local = path.join(OUT, 'audio-index.json');
  if (FETCH) {
    try {
      const res = await fetch(`${AUDIO_BASE}/index.json?t=${Date.now()}`, { headers: { 'user-agent': 'ainews-stats' } });
      if (res.ok) fs.writeFileSync(local, await res.text());
    } catch { /* keep local copy */ }
  }
  try { return JSON.parse(fs.readFileSync(local, 'utf8')); } catch { return {}; }
}

// ---------- Google Analytics 4 (optional) ----------
function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
async function gaToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}` });
  if (!res.ok) throw new Error(`GA token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}
async function fetchGA(days) {
  const prop = process.env.GA4_PROPERTY_ID, saPath = process.env.GA4_SERVICE_ACCOUNT;
  const cache = path.join(OUT, 'ga.json');
  if (!prop || !saPath) return fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : null;
  const sa = JSON.parse(fs.readFileSync(path.resolve(ROOT, saPath), 'utf8'));
  const token = await gaToken(sa);
  const body = {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'eventCount' }],
    dimensionFilter: undefined,
  };
  const clicksBody = { ...body, metrics: [{ name: 'eventCount' }], dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'click' } } } };
  const run = async (b) => {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    if (!res.ok) throw new Error(`GA report ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()).rows || [];
  };
  const byDate = {};
  for (const r of await run(body)) {
    const d = r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    const [users, sessions, views] = r.metricValues.map((m) => Number(m.value));
    byDate[d] = { users, sessions, views, clicks: 0 };
  }
  for (const r of await run(clicksBody)) {
    const d = r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    (byDate[d] = byDate[d] || { users: 0, sessions: 0, views: 0, clicks: 0 }).clicks = Number(r.metricValues[0].value);
  }
  const prev = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : {};
  const merged = { ...prev, ...byDate };
  fs.writeFileSync(cache, JSON.stringify(merged, null, 2));
  return merged;
}

// ---------- assemble ----------
async function main() {
  let ga = null, gaError = null;
  if (FETCH) { try { ga = await fetchGA(Math.max(DAYS, 30)); } catch (e) { gaError = e.message; ga = null; } }
  if (!ga) { const c = path.join(OUT, 'ga.json'); if (fs.existsSync(c)) ga = JSON.parse(fs.readFileSync(c, 'utf8')); }
  let op3Error = null;
  if (FETCH) { try { await fetchOp3(); } catch (e) { op3Error = e.message; } }
  const snaps = loadSnapshots();
  const audio = await loadAudioIndex();

  const dates = new Set([...fs.readdirSync(path.join(ROOT, 'data')).map((f) => (f.match(/^(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean), ...snaps.map((s) => s.date)]);
  const days = [...dates].sort().slice(-DAYS);
  const rows = days.map((date) => {
    const ed = editionFor(date), run = runFor(date);
    // The Monday week in review is a second run on the same date; its cost is folded into the day's total.
    const weekRun = fs.existsSync(path.join(ROOT, 'data', `${date}.week.json`)) ? runFor(`${date}.week`) : null;
    const a = (audio.episodes || {})[date] || null;
    // Every version generated that day was paid for, not just the one in the feed.
    const versions = (audio.versions || {})[date] || (a ? [a] : []);
    const tts_seconds = versions.reduce((s, v) => s + (v.seconds || 0), 0);
    const tts_usd = (tts_seconds / 60) * TTS_USD_PER_MINUTE;
    // Downloads: cumulative for this episode as of the latest snapshot, and site-wide new mp3 downloads on this day
    // (difference between this day's snapshot and the previous one).
    const latest = snaps[snaps.length - 1];
    const episode_downloads = latest ? episodeTotal(latest, date) : null;
    const episode_7d = latest && snapSource(latest) === 'op3' ? ((latest.episodes || {})[date] || {}).d7 ?? null : null;
    const i = snaps.findIndex((s) => s.date === date);
    // A delta only makes sense between two snapshots from the same source (GitHub counts and OP3 counts are not comparable).
    const downloads_today = i > 0 && snapSource(snaps[i]) === snapSource(snaps[i - 1]) ? mp3Total(snaps[i]) - mp3Total(snaps[i - 1]) : null;
    const g = ga && ga[date];
    return {
      date, edition: ed, run,
      podcast: a ? { format: a.format, seconds: a.seconds, versions: versions.length, episode_downloads, episode_7d } : null,
      downloads_today,
      site: g || null,
      week: weekRun ? { minutes: weekRun.minutes, tool_calls: weekRun.tool_calls, claude_usd: +weekRun.claude_usd.toFixed(2), usage_complete: weekRun.usage_complete, email_sent: weekRun.email_sent } : null,
      cost: { claude_usd: +((run ? run.claude_usd : 0) + (weekRun ? weekRun.claude_usd : 0)).toFixed(2), tts_usd: +tts_usd.toFixed(3), total_usd: +((run ? run.claude_usd : 0) + (weekRun ? weekRun.claude_usd : 0) + tts_usd).toFixed(2) },
    };
  });
  fs.writeFileSync(path.join(OUT, 'daily.json'), JSON.stringify({ generated_at: new Date().toISOString(), days: rows }, null, 2));
  fs.writeFileSync(path.join(OUT, 'index.html'), renderHtml(rows, snaps, ga, gaError, op3Error));

  if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); return; }
  printTable(rows, snaps, ga, gaError, op3Error);
}

function printTable(rows, snaps, ga, gaError, op3Error) {
  const pad = (s, n, right) => { s = String(s == null ? '—' : s); return right ? s.padStart(n) : s.padEnd(n); };
  const cols = [['Date', 10], ['Items', 5, 1], ['Run', 5, 1], ['Tools', 5, 1], ['Claude $', 8, 1], ['TTS $', 6, 1], ['Total $', 7, 1], ['Ep 7d', 5, 1], ['Ep all', 6, 1], ['New dl', 6, 1], ['Users', 5, 1], ['Views', 5, 1], ['Clicks', 6, 1], ['Notes', 0]];
  console.log(cols.map(([h, n, r]) => pad(h, n, r)).join('  '));
  let total = 0;
  for (const r of rows) {
    total += r.cost.total_usd;
    const notes = [];
    if (r.run && !r.run.usage_complete) notes.push(`cost = main session only (${r.run.subagents} subagents untraced)`);
    if (r.edition && !r.edition.script) notes.push('no script (narrated)');
    if (r.run && !r.run.email_sent) notes.push('no email');
    if (r.run && r.run.subagents) notes.unshift(`${r.run.subagents} agents`);
    if (r.week) notes.push(`+ week in review: ${r.week.minutes}m, $${r.week.claude_usd}${r.week.usage_complete ? '' : ' (main only)'}${r.week.email_sent ? '' : ', no email'}`);
    const v = [r.date, r.edition && r.edition.items, r.run && `${r.run.minutes}m`, r.run && r.run.tool_calls,
      r.run ? r.cost.claude_usd.toFixed(2) : null, r.podcast ? r.cost.tts_usd.toFixed(2) : null, r.run || r.podcast ? r.cost.total_usd.toFixed(2) : null,
      r.podcast && r.podcast.episode_7d, r.podcast && r.podcast.episode_downloads, r.downloads_today, r.site && r.site.users, r.site && r.site.views, r.site && r.site.clicks, notes.join('; ')];
    console.log(v.map((x, i) => pad(x, cols[i][1], cols[i][2])).join('  '));
  }
  console.log(`\n${rows.length} day(s) · total $${total.toFixed(2)} · Claude at API list price (${Object.keys(CLAUDE_PRICES)[0]} rates), TTS at $${TTS_USD_PER_MINUTE}/min`);
  const latest = snaps[snaps.length - 1];
  if (latest) console.log(`podcast: ${mp3Total(latest)} downloads all-time per ${snapSource(latest)}${snapSource(latest) === 'op3' && latest.show ? ` · ${latest.show.monthly ?? '—'} this month` : ''} (${snaps.length} daily snapshot${snaps.length === 1 ? '' : 's'}) · https://op3.dev/show/${podcastGuid()}`);
  if (op3Error) console.log(`podcast: OP3 not fetched — ${op3Error}`);
  if (!ga) console.log(gaError ? `site: GA4 error — ${gaError}` : 'site: no Google Analytics credentials (set GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT in stats/.env)');
  console.log(`snapshot page: ${path.join(OUT, 'index.html')}`);
}

function renderHtml(rows, snaps, ga, gaError, op3Error) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = (x, d = 0) => (x == null ? '<span class="na">—</span>' : Number(x).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const total = rows.reduce((a, r) => a + r.cost.total_usd, 0);
  const latest = snaps[snaps.length - 1];
  const isOp3 = latest && snapSource(latest) === 'op3';
  const episodes = !latest ? [] : isOp3 ? Object.entries(latest.episodes || {}).sort((a, b) => b[0].localeCompare(a[0])) : latest.assets.filter((a) => a.name.endsWith('.mp3')).sort((a, b) => b.name.localeCompare(a.name));
  const apps = isOp3 ? Object.entries(latest.apps || {}).sort((a, b) => b[1] - a[1]) : [];
  const tr = rows.slice().reverse().map((r) => `<tr>
<td><a href="https://aiedgebriefing.com/${r.date}/">${r.date}</a></td>
<td class="r">${n(r.edition && r.edition.items)}</td><td class="r">${n(r.edition && r.edition.links)}</td>
<td class="r">${r.run ? `${r.run.minutes} min` : n(null)}</td><td class="r">${n(r.run && r.run.tool_calls)}</td><td class="r">${n(r.run && r.run.subagents)}</td>
<td class="r">${r.run ? '$' + n(r.cost.claude_usd, 2) + (r.run.usage_complete ? '' : '<sup title="main session only; subagent usage was not traced for this run">*</sup>') : n(null)}</td>
<td class="r">${r.podcast ? '$' + n(r.cost.tts_usd, 2) : n(null)}</td><td class="r"><strong>${r.run || r.podcast ? '$' + n(r.cost.total_usd, 2) : n(null)}</strong></td>
<td class="r">${r.podcast ? `${Math.round(r.podcast.seconds / 60)} min` : n(null)}</td><td class="r">${n(r.podcast && r.podcast.episode_7d)}</td><td class="r">${n(r.podcast && r.podcast.episode_downloads)}</td><td class="r">${n(r.downloads_today)}</td>
<td class="r">${n(r.site && r.site.users)}</td><td class="r">${n(r.site && r.site.views)}</td><td class="r">${n(r.site && r.site.clicks)}</td>
<td>${[r.run && !r.run.email_sent && r.edition ? 'no email' : '', r.edition && !r.edition.script ? 'narrated' : '', r.week ? `+ week in review (${r.week.minutes} min, $${n(r.week.claude_usd, 2)})` : ''].filter(Boolean).join(', ')}</td></tr>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Edge Briefing — private stats</title>
<style>
:root{color-scheme:light dark;--fg:#1a1a1a;--bg:#fff;--muted:#6b6b6b;--line:#e4e4e4;--accent:#0b5fff}
@media(prefers-color-scheme:dark){:root{--fg:#ececec;--bg:#121212;--muted:#9a9a9a;--line:#2a2a2a;--accent:#7aa7ff}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,system-ui,sans-serif}
h1{font-size:1.3rem;margin:0 0 4px}.muted{color:var(--muted)}a{color:var(--accent)}
.tiles{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}.tile{border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:120px}
.tile b{display:block;font-size:1.4rem}.tile span{color:var(--muted);font-size:.8rem}
.scroll{overflow-x:auto}table{border-collapse:collapse;white-space:nowrap}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left}
th{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}td.r,th.r{text-align:right}.na{color:var(--muted)}
th.group{border-bottom:none;text-align:center;color:var(--fg)}small{color:var(--muted)}h2{font-size:1rem;margin:28px 0 8px}
</style>
<h1>AI Edge Briefing — private stats</h1>
<p class="muted">Generated ${esc(new Date().toLocaleString('en-CA', { timeZone: TZ }))} (Toronto). Local only; nothing on this page is published.</p>
<div class="tiles">
<div class="tile"><b>$${n(total, 2)}</b><span>cost, ${rows.length} days shown</span></div>
<div class="tile"><b>$${n(rows.length ? total / rows.filter((r) => r.run || r.podcast).length || 0 : 0, 2)}</b><span>per edition</span></div>
<div class="tile"><b>${n(latest ? mp3Total(latest) : null)}</b><span>episode downloads, all-time${isOp3 ? ' (OP3)' : ' (GitHub)'}</span></div>
${isOp3 && latest.show ? `<div class="tile"><b>${n(latest.show.monthly)}</b><span>downloads this month</span></div>` : ''}
<div class="tile"><b>${n(ga ? Object.values(ga).reduce((a, g) => a + g.users, 0) : null)}</b><span>site users, ${ga ? Object.keys(ga).length : 0} days of GA</span></div>
</div>
<div class="scroll"><table>
<tr><th></th><th class="group" colspan="2">Edition</th><th class="group" colspan="3">Run</th><th class="group" colspan="3">Cost (USD)</th><th class="group" colspan="4">Podcast</th><th class="group" colspan="3">Site</th><th></th></tr>
<tr><th>Date</th><th class="r">Items</th><th class="r">Links</th><th class="r">Time</th><th class="r">Tool calls</th><th class="r">Agents</th><th class="r">Claude</th><th class="r">TTS</th><th class="r">Total</th><th class="r">Length</th><th class="r">7 days</th><th class="r">All time</th><th class="r">New dl</th><th class="r">Users</th><th class="r">Views</th><th class="r">Clicks</th><th>Notes</th></tr>
${tr}
</table></div>
<p class="muted">Claude cost is the run's token usage at Anthropic API list price (input $5, output $25, cache read $0.50, cache write $6.25/5m $10/1h per MTok for Opus 5). * = main session only; runs traced before subagent usage was recorded. TTS is episode length × $${TTS_USD_PER_MINUTE}/min (gpt-4o-mini-tts). Podcast downloads via <a href="https://op3.dev/show/${podcastGuid()}">OP3</a> (open, IAB-style de-duplicated, bots excluded; the site's own player is counted too) — 7 days and all time per episode, New dl = all-time total minus the previous day's snapshot. Snapshots before 14 Sep 2026 were raw GitHub release download counts, a cruder measure; no delta is computed across that boundary.${op3Error ? ` <b>OP3 not fetched: ${esc(op3Error)}</b>` : ''} ${ga ? 'Site figures from Google Analytics 4; Clicks = GA "click" events (outbound links).' : gaError ? `Google Analytics: ${esc(gaError)}` : 'Site figures need Google Analytics credentials (GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT in stats/.env).'}</p>
<h2>Episodes</h2>
<div class="scroll"><table>${isOp3
    ? `<tr><th>Episode</th><th class="r">1 day</th><th class="r">7 days</th><th class="r">30 days</th><th class="r">All time</th></tr>${episodes.map(([d, e]) => `<tr><td><a href="https://aiedgebriefing.com/${d}/">${d}</a></td><td class="r">${n(e.d1)}</td><td class="r">${n(e.d7)}</td><td class="r">${n(e.d30)}</td><td class="r">${n(e.all)}</td></tr>`).join('\n')}`
    : `<tr><th>File</th><th class="r">Downloads</th><th class="r">Size</th></tr>${episodes.map((a) => `<tr><td>${esc(a.name)}</td><td class="r">${n(a.downloads)}</td><td class="r">${n(a.bytes / 1e6, 1)} MB</td></tr>`).join('\n')}`}
</table></div>
${apps.length ? `<h2>Apps</h2><div class="scroll"><table><tr><th>App</th><th class="r">Downloads (3 months)</th></tr>${apps.map(([a, c]) => `<tr><td>${esc(a)}</td><td class="r">${n(c)}</td></tr>`).join('\n')}</table></div>` : ''}`;
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
