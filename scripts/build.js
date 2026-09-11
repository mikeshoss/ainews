#!/usr/bin/env node
'use strict';
// Static site generator for AI Edge Briefing.
// Reads data/YYYY-MM-DD.json editions, writes a complete static site to site/.
// No dependencies. Run: node scripts/build.js   (or --topics to list known topic slugs)

const fs = require('fs');
const path = require('path');
const { dateObj, longDate, shortDate, isMonday, paragraphs, FLAG_LABELS, SECTION_COLORS, PODCAST, sectionWeights } = require('./lib.js');
const { narrationFor } = require('./narrate.js');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'site');
const SITE_NAME = 'AI Edge Briefing';
const SITE_TAGLINE = 'Daily, fact-first coverage of frontier AI — the advances, the research, and how it is being used for good and for harm.';
const SITE_URL = (process.env.SITE_URL || 'https://mikeshoss.github.io/ainews').replace(/\/$/, '');
const REPO_URL = 'https://github.com/mikeshoss/ainews';
const TREND_WINDOW_DAYS = 7;   // look-back window for "trending"
const TREND_MIN_DAYS = 2;      // a topic must appear on at least this many editions in the window

const SECTION_ORDER = [
  'Frontier models & labs',
  'Research & papers',
  'Security, misuse & threat intelligence',
  'Military, defense & geopolitics',
  'Health, science & medicine',
  'Policy, regulation & law',
  'Compute, chips & infrastructure',
  'Deployment & impact',
];

const TOKEN_LABELS = {
  ai: 'AI', eu: 'EU', us: 'US', uk: 'UK', un: 'UN', gpu: 'GPU', gpus: 'GPUs', llm: 'LLM', llms: 'LLMs',
  api: 'API', fda: 'FDA', nist: 'NIST', darpa: 'DARPA', dod: 'DoD', cisa: 'CISA', nato: 'NATO', ftc: 'FTC',
  sec: 'SEC', doj: 'DOJ', nih: 'NIH', who: 'WHO', openai: 'OpenAI', xai: 'xAI', deepseek: 'DeepSeek',
  deepmind: 'DeepMind', nvidia: 'NVIDIA', tsmc: 'TSMC', amd: 'AMD', aisi: 'AISI', caisi: 'CAISI', cac: 'CAC',
  rl: 'RL', rlhf: 'RLHF', ml: 'ML', iot: 'IoT', cve: 'CVE', cves: 'CVEs', ceo: 'CEO', ipo: 'IPO', m2: 'M2',
  gpt: 'GPT', o3: 'o3', o4: 'o4', ai2: 'AI2', hf: 'HF', ucla: 'UCLA', mit: 'MIT', ipc: 'IPC', ucsd: 'UCSD',
};

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const daysBetween = (a, b) => Math.round((dateObj(a) - dateObj(b)) / 86400000);
const topicLabel = (slug) => slug.split('-').map((t) => TOKEN_LABELS[t] || (t.charAt(0).toUpperCase() + t.slice(1))).join(' ');
const hostname = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const write = (rel, content) => { const p = path.join(OUT_DIR, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };

// ---------- load ----------
function loadEditions() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => {
      const ed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      ed.date = ed.date || f.slice(0, 10);
      ed.sections = (ed.sections || []).filter((s) => s.items && s.items.length);
      ed.sections.sort((a, b) => {
        const ia = SECTION_ORDER.indexOf(a.name), ib = SECTION_ORDER.indexOf(b.name);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      ed.itemCount = ed.sections.reduce((n, s) => n + s.items.length, 0);
      return ed;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
}

function buildTopicIndex(editions) {
  const topics = new Map();
  for (const ed of editions) {
    for (const sec of ed.sections) {
      for (const item of sec.items) {
        for (const slug of item.topics || []) {
          if (!topics.has(slug)) topics.set(slug, { slug, label: topicLabel(slug), dates: new Set(), entries: [] });
          const t = topics.get(slug);
          t.dates.add(ed.date);
          t.entries.push({ date: ed.date, section: sec.name, item });
        }
      }
    }
  }
  if (!editions.length) return { topics, trending: [] };
  const latest = editions[0].date;
  const editionDates = editions.map((e) => e.date); // newest first
  for (const t of topics.values()) {
    t.daysInWindow = [...t.dates].filter((d) => daysBetween(latest, d) < TREND_WINDOW_DAYS).length;
    t.streak = 0;
    for (const d of editionDates) { if (t.dates.has(d)) t.streak++; else break; }
    t.lastSeen = [...t.dates].sort().pop();
    t.firstSeen = [...t.dates].sort()[0];
  }
  const trending = [...topics.values()]
    .filter((t) => t.daysInWindow >= TREND_MIN_DAYS)
    .sort((a, b) => b.streak - a.streak || b.daysInWindow - a.daysInWindow || b.entries.length - a.entries.length || a.slug.localeCompare(b.slug));
  return { topics, trending };
}

// ---------- rendering ----------
function layout({ title, description, base, body, canonical }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || SITE_TAGLINE)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)}" href="${base}feed.xml">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)} — Podcast" href="${base}podcast.xml">
<link rel="stylesheet" href="${base}style.css">
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${base}">${esc(SITE_NAME)}</a>
    <nav>
      <a href="${base}">Editions</a>
      <a href="${base}trends/">Trends</a>
      <a href="${base}podcast/">Podcast</a>
      <a href="${REPO_URL}/blob/main/SOURCES.md">Sources</a>
      <a href="${base}feed.xml">RSS</a>
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer"><div class="wrap">
  <p>${esc(SITE_NAME)} is generated daily from primary sources. Every claim links to where it came from. Nothing is written without a source. <a href="${REPO_URL}">Data &amp; code on GitHub</a>.</p>
</div></footer>
</body>
</html>
`;
}

function renderSources(sources) {
  return (sources || []).map((s, i) => `<a class="src" href="${esc(s.url)}" rel="noopener" title="${esc(s.url)}">${esc(s.name || hostname(s.url))}</a>`).join('<span class="sep">·</span>');
}

function renderItem(item, base, opts = {}) {
  const first = (item.sources || [])[0];
  const impact = item.impact ? `<span class="impact impact-${esc(item.impact)}">${esc(item.impact)}</span>` : '';
  const flags = (item.flags || []).map((f) => `<span class="flag flag-${esc(f)}">${esc(FLAG_LABELS[f] || f)}</span>`).join('');
  const topics = (item.topics || []).map((t) => `<a class="topic" href="${base}trends/${esc(t)}/">${esc(topicLabel(t))}</a>`).join('');
  const dateLine = opts.date ? `<div class="item-meta"><a href="${base}${opts.date}/">${esc(shortDate(opts.date))}</a> · ${esc(opts.section || '')}</div>` : '';
  return `<article class="item">
  ${dateLine}
  <h3>${first ? `<a href="${esc(first.url)}" rel="noopener">${esc(item.headline)}</a>` : esc(item.headline)} ${impact}${flags}</h3>
  <div class="sources">${renderSources(item.sources)}</div>
  <ul>${(item.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
  ${topics ? `<div class="topics">${topics}</div>` : ''}
</article>`;
}

function renderEditionPage(ed, editions, idx) {
  const base = '../';
  const newer = editions[idx - 1], older = editions[idx + 1];
  const monday = ed.edition === 'monday' || isMonday(ed.date);
  const summary = paragraphs(ed.summary).map((p) => `<p>${esc(p)}</p>`).join('');
  const toc = ed.sections.map((s) => `<a href="#${esc(slugify(s.name))}">${esc(s.name)} <span class="count">${s.items.length}</span></a>`).join('');
  const sections = ed.sections.map((s) => `<section class="section" id="${esc(slugify(s.name))}">
  <h2><i class="dot" style="background:${(SECTION_COLORS[s.name] || {}).hex || '#9a9a9a'}"></i>${esc(s.name)}</h2>
  ${s.items.map((it) => renderItem(it, base)).join('\n')}
</section>`).join('\n');
  let week = '';
  if (ed.week_in_review && (ed.week_in_review.items || []).length) {
    const w = ed.week_in_review;
    week = `<section class="section week" id="week-in-review">
  <h2>The week in review</h2>
  <p class="muted">What mattered over the last seven days${w.period ? ` (${esc(w.period)})` : ''}.</p>
  ${paragraphs(w.summary).map((p) => `<p>${esc(p)}</p>`).join('')}
  ${w.items.map((it) => renderItem(it, base)).join('\n')}
  ${(w.figures || []).length ? `<h3 class="sub">By the numbers</h3><dl class="figures">${w.figures.map((f) => `<div><dt>${esc(f.value)}</dt><dd>${esc(f.label)} <a class="src" href="${esc(f.url)}" rel="noopener">${esc(f.source || hostname(f.url))}</a></dd></div>`).join('')}</dl>` : ''}
  ${(w.calendar || []).length ? `<h3 class="sub">On the calendar</h3><ul class="calendar">${w.calendar.map((c) => `<li><strong>${esc(c.date)}</strong> — ${esc(c.event)} <a class="src" href="${esc(c.url)}" rel="noopener">${esc(c.source || hostname(c.url))}</a></li>`).join('')}</ul>` : ''}
</section>`;
  }
  const body = `<article class="edition">
  <header class="edition-header">
    <div class="eyebrow">${monday ? '<span class="badge">Monday edition</span>' : 'Daily edition'} · ${ed.itemCount} items${ed.window ? ` · ${esc(ed.window)}` : ''}${ed.hasTrace ? ` · <a href="${base}${ed.date}/trace/">run trace</a>` : ''}</div>
    <h1>${esc(longDate(ed.date))}</h1>
    ${renderSpectrum(ed, true)}
    ${renderPlayer(ed.audio, base, ed, false)}
    <div class="summary">${summary}</div>
    <nav class="toc">${toc}${week ? `<a href="#week-in-review">The week in review</a>` : ''}</nav>
  </header>
  ${sections}
  ${week}
  <nav class="pager">
    ${older ? `<a href="${base}${older.date}/">← ${esc(shortDate(older.date))}</a>` : '<span></span>'}
    ${newer ? `<a href="${base}${newer.date}/">${esc(shortDate(newer.date))} →</a>` : '<span></span>'}
  </nav>
</article>`;
  return layout({ title: `${longDate(ed.date)} — ${SITE_NAME}`, description: paragraphs(ed.summary)[0], base, body, canonical: `${SITE_URL}/${ed.date}/` });
}

function renderHome(editions, trending) {
  const base = './';
  const trend = trending.slice(0, 10).map((t) => `<a class="trend-chip" href="${base}trends/${esc(t.slug)}/">${esc(t.label)} <span class="count">${t.daysInWindow}d</span></a>`).join('');
  const list = editions.map((ed) => {
    const monday = ed.edition === 'monday' || isMonday(ed.date);
    const topTopics = topTopicsFor(ed).slice(0, 6).map((t) => `<a class="topic" href="${base}trends/${esc(t)}/">${esc(topicLabel(t))}</a>`).join('');
    return `<article class="card">
  <div class="eyebrow">${monday ? '<span class="badge">Monday edition</span>' : 'Daily'} · ${ed.itemCount} items · ${ed.sections.map((s) => esc(s.name)).join(' / ')}</div>
  <h2><a href="${base}${ed.date}/">${esc(longDate(ed.date))}</a></h2>
  ${renderSpectrum(ed, false)}
  <p>${esc(paragraphs(ed.summary)[0] || '')}</p>
  ${renderPlayer(ed.audio, base, ed, true)}
  <div class="topics">${topTopics}</div>
</article>`;
  }).join('\n');
  const body = `<section class="hero">
  <h1>${esc(SITE_NAME)}</h1>
  <p class="lede">${esc(SITE_TAGLINE)}</p>
  ${trending.length ? `<div class="trend-strip"><span class="label">Trending</span>${trend}<a class="more" href="${base}trends/">all trends →</a></div>` : ''}
</section>
<section class="editions">
${list || '<p class="muted">No editions yet.</p>'}
</section>`;
  return layout({ title: SITE_NAME, base, body, canonical: `${SITE_URL}/` });
}

function topTopicsFor(ed) {
  const counts = new Map();
  for (const s of ed.sections) for (const it of s.items) for (const t of it.topics || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((e) => e[0]);
}

function renderTrendsIndex(topics, trending, editions) {
  const base = '../';
  const cards = trending.map((t) => {
    const latest = t.entries[0];
    return `<article class="card trend-card">
  <div class="eyebrow">${t.streak > 1 ? `${t.streak}-edition streak · ` : ''}${t.daysInWindow} of the last ${TREND_WINDOW_DAYS} days · ${t.entries.length} items total</div>
  <h2><a href="${base}trends/${esc(t.slug)}/">${esc(t.label)}</a></h2>
  <p class="muted">Latest: <a href="${esc((latest.item.sources || [{}])[0].url || '#')}" rel="noopener">${esc(latest.item.headline)}</a> <span class="count">${esc(shortDate(latest.date))}</span></p>
</article>`;
  }).join('\n');
  const all = [...topics.values()].sort((a, b) => b.dates.size - a.dates.size || b.entries.length - a.entries.length || a.slug.localeCompare(b.slug));
  const rows = all.map((t) => `<tr><td><a href="${base}trends/${esc(t.slug)}/">${esc(t.label)}</a></td><td>${t.dates.size}</td><td>${t.entries.length}</td><td>${esc(shortDate(t.lastSeen))}</td><td>${esc(shortDate(t.firstSeen))}</td></tr>`).join('');
  const body = `<h1>Trends</h1>
<p class="lede">Topics that keep showing up. A topic is trending when it appears in at least ${TREND_MIN_DAYS} editions within the last ${TREND_WINDOW_DAYS} days. Each topic page collects every item ever filed under it, newest first.</p>
<section>${cards || '<p class="muted">Nothing is trending yet — it takes at least two editions.</p>'}</section>
<h2>All topics</h2>
<div class="table-wrap"><table>
<thead><tr><th>Topic</th><th>Editions</th><th>Items</th><th>Last seen</th><th>First seen</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`;
  return layout({ title: `Trends — ${SITE_NAME}`, base, body, canonical: `${SITE_URL}/trends/` });
}

function renderTopicPage(t) {
  const base = '../../';
  const byDate = new Map();
  for (const e of t.entries) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
  const groups = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, entries]) => `<section class="section">
  <h2><a href="${base}${date}/">${esc(longDate(date))}</a></h2>
  ${entries.map((e) => renderItem(e.item, base, { section: e.section })).join('\n')}
</section>`).join('\n');
  const body = `<div class="eyebrow"><a href="${base}trends/">Trends</a> / topic</div>
<h1>${esc(t.label)}</h1>
<p class="lede">${t.entries.length} item${t.entries.length === 1 ? '' : 's'} across ${t.dates.size} edition${t.dates.size === 1 ? '' : 's'}${t.streak > 1 ? ` · appeared in the last ${t.streak} editions in a row` : ''}. First seen ${esc(shortDate(t.firstSeen))}, last seen ${esc(shortDate(t.lastSeen))}.</p>
${groups}`;
  return layout({ title: `${t.label} — Trends — ${SITE_NAME}`, base, body, canonical: `${SITE_URL}/trends/${t.slug}/` });
}

function renderEmail(ed) {
  const url = `${SITE_URL}/${ed.date}/`;
  const monday = ed.edition === 'monday' || isMonday(ed.date);
  const summary = paragraphs(ed.summary);
  const sec = (s) => `<h2 style="font-size:15px;margin:22px 0 8px;color:#111;text-transform:uppercase;letter-spacing:.04em">${esc(s.name)}</h2>` +
    s.items.map((it) => {
      const first = (it.sources || [])[0];
      const extra = (it.sources || []).slice(1).map((x) => `<a href="${esc(x.url)}" style="color:#555">${esc(x.name || hostname(x.url))}</a>`).join(', ');
      const fl = (it.flags || []).map((f) => `<b style="color:#7a4b00;font-size:11px;text-transform:uppercase;letter-spacing:.04em">[${esc(FLAG_LABELS[f] || f)}]</b> `).join('');
      return `<p style="margin:0 0 12px">${fl}<a href="${esc(first ? first.url : url)}" style="color:#0b57d0;font-weight:600;text-decoration:none">${esc(it.headline)}</a>${extra ? ` <span style="color:#777;font-size:12px">(also: ${extra})</span>` : ''}<br><span style="color:#333">${esc((it.bullets || [])[0] || '')}</span></p>`;
    }).join('');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:8px 4px;font-size:15px;line-height:1.5;color:#222">
<p style="color:#777;font-size:12px;margin:0 0 4px">${esc(SITE_NAME)}${monday ? ' · Monday edition' : ''}</p>
<h1 style="font-size:22px;margin:0 0 10px">${esc(longDate(ed.date))}</h1>
<p style="margin:0 0 16px"><a href="${url}" style="color:#0b57d0;font-weight:600">Read the full edition (${ed.itemCount} items) →</a></p>
${summary.map((p) => `<p style="margin:0 0 10px">${esc(p)}</p>`).join('')}
${ed.sections.map(sec).join('')}
${ed.week_in_review && (ed.week_in_review.items || []).length ? `<h2 style="font-size:15px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.04em">The week in review</h2>${paragraphs(ed.week_in_review.summary).map((p) => `<p style="margin:0 0 10px">${esc(p)}</p>`).join('')}<p><a href="${url}#week-in-review" style="color:#0b57d0">Read the full week in review →</a></p>` : ''}
<hr style="border:0;border-top:1px solid #ddd;margin:24px 0">
<p style="color:#777;font-size:12px">Every headline links to its source. <a href="${url}" style="color:#777">Web version</a> · <a href="${SITE_URL}/trends/" style="color:#777">Trends</a> · <a href="${REPO_URL}" style="color:#777">Data on GitHub</a></p>
</div>`;
  const text = [
    `${SITE_NAME}${monday ? ' - Monday edition' : ''}`, longDate(ed.date), '', `Full edition: ${url}`, '',
    ...summary, '',
    ...ed.sections.flatMap((s) => [`## ${s.name}`, ...s.items.flatMap((it) => [`- ${it.headline}`, `  ${(it.bullets || [])[0] || ''}`, ...(it.sources || []).map((x) => `  ${x.url}`)]), '']),
  ].join('\n');
  return { html, text, subject: `${SITE_NAME} — ${shortDate(ed.date)} ${ed.date.slice(0, 4)}${monday ? ' (Monday edition, with the week in review)' : ''}` };
}

function renderFeed(editions) {
  const items = editions.slice(0, 30).map((ed) => `<item>
<title>${esc(longDate(ed.date))}</title>
<link>${SITE_URL}/${ed.date}/</link>
<guid>${SITE_URL}/${ed.date}/</guid>
<pubDate>${dateObj(ed.date).toUTCString()}</pubDate>
<description>${esc(paragraphs(ed.summary).join('\n\n'))}</description>
</item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(SITE_NAME)}</title>
<link>${SITE_URL}/</link>
<description>${esc(SITE_TAGLINE)}</description>
${items}
</channel></rss>
`;
}

const slugify = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const CSS = `
:root{--bg:#f7f6f2;--fg:#1a1a1a;--muted:#6b6b6b;--line:#e2e0d8;--card:#ffffff;--accent:#0b57d0;--accent-soft:#e8f0fe;--badge:#b3261e;--good:#146c2e;--bad:#8a1c1c;--mixed:#7a4b00;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ebebeb;--muted:#9a9a9a;--line:#2a2a2a;--card:#1b1b1b;--accent:#8ab4f8;--accent-soft:#1e2a3d;--badge:#f28b82;--good:#81c995;--bad:#f28b82;--mixed:#fdd663}}
*{box-sizing:border-box}
html{font-size:16px}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55}
a{color:var(--accent)}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
.site-header{border-bottom:1px solid var(--line);background:var(--card)}
.site-header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:14px;flex-wrap:wrap}
.brand{font-weight:700;text-decoration:none;color:var(--fg);letter-spacing:-.01em}
.site-header nav{display:flex;gap:18px;flex-wrap:wrap}
.site-header nav a{color:var(--muted);text-decoration:none;font-size:.92rem}
.site-header nav a:hover{color:var(--accent)}
main{padding-block:32px 48px}
h1{font-size:2rem;line-height:1.15;letter-spacing:-.02em;margin:.2em 0 .5em}
h2{font-size:1.25rem;margin:0 0 .6em}
h3{font-size:1.05rem;margin:0 0 .35em;line-height:1.35}
h3 a{color:var(--fg);text-decoration:none;border-bottom:1px solid transparent}
h3 a:hover{border-bottom-color:var(--accent);color:var(--accent)}
.lede{font-size:1.1rem;color:var(--muted);margin:0 0 1.2em}
.muted{color:var(--muted)}
.eyebrow{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.4em}
.badge{display:inline-block;background:var(--badge);color:#fff;border-radius:4px;padding:1px 7px;font-weight:600;letter-spacing:.04em}
.summary{font-size:1.08rem;border-left:3px solid var(--accent);padding-left:16px;margin:18px 0}
.summary p{margin:0 0 .8em}
.toc{display:flex;flex-wrap:wrap;gap:8px 14px;margin:14px 0 8px;font-size:.9rem}
.toc a{text-decoration:none;color:var(--muted)}
.toc a:hover{color:var(--accent)}
.count{display:inline-block;background:var(--accent-soft);color:var(--accent);border-radius:10px;padding:0 7px;font-size:.75rem;font-weight:600;vertical-align:middle}
.section{margin:40px 0}
.section>h2{padding-bottom:8px;border-bottom:2px solid var(--fg);text-transform:uppercase;letter-spacing:.06em;font-size:.95rem}
.item{padding:18px 0;border-bottom:1px solid var(--line)}
.item:last-child{border-bottom:0}
.item ul{margin:8px 0 6px;padding-left:20px}
.item li{margin:4px 0}
.item-meta{font-size:.8rem;color:var(--muted);margin-bottom:4px}
.item-meta a{color:var(--muted)}
.sources{font-size:.82rem;color:var(--muted)}
.sources .src{color:var(--accent);text-decoration:none}
.sources .src:hover{text-decoration:underline}
.sources .sep{margin:0 6px}
.topics{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.topic{font-size:.75rem;text-decoration:none;color:var(--muted);border:1px solid var(--line);border-radius:12px;padding:1px 9px;background:var(--card)}
.topic:hover{color:var(--accent);border-color:var(--accent)}
.impact{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;vertical-align:middle;margin-left:6px;border-radius:3px;padding:1px 6px;border:1px solid currentColor}
.flag{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;vertical-align:middle;margin-left:6px;border-radius:3px;padding:1px 6px;background:var(--accent-soft);color:var(--mixed)}
.sub{margin-top:28px;font-size:.9rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.figures{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin:0}
.figures div{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.figures dt{font-size:1.4rem;font-weight:700;letter-spacing:-.02em}
.figures dd{margin:2px 0 0;font-size:.85rem;color:var(--muted)}
.calendar{padding-left:20px}.calendar li{margin:6px 0}
.impact-beneficial{color:var(--good)}.impact-harmful{color:var(--bad)}.impact-mixed{color:var(--mixed)}.impact-neutral{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:0 0 16px}
.card h2{margin:.2em 0 .4em}
.card h2 a{color:var(--fg);text-decoration:none}
.card h2 a:hover{color:var(--accent)}
.card p{margin:0 0 .6em}
.hero{margin-bottom:28px}
.trend-strip{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px}
.trend-strip .label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-right:4px}
.trend-chip{text-decoration:none;color:var(--fg);font-size:.88rem;border:1px solid var(--line);border-radius:14px;padding:2px 10px}
.trend-chip:hover{border-color:var(--accent);color:var(--accent)}
.trend-strip .more{margin-left:auto;font-size:.85rem;text-decoration:none}
.pager{display:flex;justify-content:space-between;margin-top:40px;padding-top:16px;border-top:1px solid var(--line)}
.pager a{text-decoration:none}
.week{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 22px 14px}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.trace-stats{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:.9rem;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin:0 0 16px}
.tool{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;background:var(--accent-soft);color:var(--accent);border-radius:4px;padding:1px 6px}
.trace{border-left:2px solid var(--line);margin-top:20px}
.tr{display:flex;gap:12px;padding:10px 0 10px 14px;border-bottom:1px solid var(--line);font-size:.92rem}
.tr .tt{flex:0 0 64px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;color:var(--muted);padding-top:2px}
.tr>div{min-width:0;flex:1}
.tl{word-break:break-all}
.tx{white-space:pre-wrap;margin-top:4px}
.tr-assistant .tx{border-left:3px solid var(--accent);padding-left:10px}
.tr-sub{opacity:.85}.tr-sub .tt::after{content:"↳";margin-left:4px}
.tr-prompt pre{max-height:240px}
.tr details{margin-top:4px}.tr summary{cursor:pointer;font-size:.8rem;color:var(--muted)}
.tr pre{white-space:pre-wrap;word-break:break-word;font-size:.78rem;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:4px 0 0;max-height:420px;overflow:auto}
.player{margin:14px 0 6px;display:flex;gap:14px;align-items:flex-start}.player .art{width:140px;height:140px;border-radius:8px;flex:0 0 auto}.player-body{min-width:0;flex:1}.player audio{width:100%;max-width:560px;display:block}
.spectrum{display:flex;gap:3px;height:8px;margin:10px 0 6px;max-width:560px}.spectrum span{display:block;border-radius:4px;min-width:4px}
.spectrum-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.78rem;color:var(--muted);margin-bottom:8px}.spectrum-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;vertical-align:1px}
.podcast-hero{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}.podcast-hero img{width:180px;height:180px;border-radius:12px;flex:0 0 auto}
.player-meta{font-size:.8rem;color:var(--muted);margin-top:4px}.player.compact audio{max-width:420px;height:36px}
.feed{display:block;word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px 10px;font-size:.9rem}
.script-block{padding:14px 0;border-bottom:1px solid var(--line)}.script-ref{font-size:.8rem;color:var(--muted);margin-bottom:8px}
.line{display:flex;gap:12px;margin:6px 0}.line .who{flex:0 0 64px;font-weight:600;font-size:.85rem;color:var(--accent)}
.script-section{font-weight:600;margin-top:1.4em}
.site-footer{border-top:1px solid var(--line);color:var(--muted);font-size:.85rem;padding-block:20px}
@media (max-width:520px){h1{font-size:1.6rem}main{padding-block:20px 36px}}
`;


// ---------- podcast ----------
const AUDIO_INDEX = path.join(ROOT, 'audio', 'index.json');
function loadAudio() {
  try { return JSON.parse(fs.readFileSync(AUDIO_INDEX, 'utf8')).episodes || {}; } catch { return {}; }
}
const mmss = (sec) => { const m = Math.floor(sec / 60), s2 = sec % 60; return `${m}:${String(s2).padStart(2, '0')}`; };
const hhmmss = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

function renderSpectrum(ed, withLegend) {
  const w = sectionWeights(ed);
  if (!w.length) return '';
  const bar = `<div class="spectrum" role="img" aria-label="${esc(w.map((x) => `${x.short} ${Math.round(x.share * 100)}%`).join(', '))}">${w.map((x) => `<span style="flex:${x.share.toFixed(4)};background:${x.hex}" title="${esc(x.name)}: ${x.count}"></span>`).join('')}</div>`;
  return withLegend ? `${bar}<div class="spectrum-legend">${w.map((x) => `<span><i style="background:${x.hex}"></i>${esc(x.short)} ${Math.round(x.share * 100)}%</span>`).join('')}</div>` : bar;
}

function renderPlayer(ep, base, ed, compact) {
  if (!ep) return '';
  const label = `${ep.format === 'dialogue' ? 'Two-host episode' : 'Narrated edition'} · ${mmss(ep.seconds)}`;
  const art = ep.image && !compact ? `<img class="art" src="${esc(ep.image)}" alt="Episode cover" width="140" height="140" loading="lazy">` : '';
  return `<div class="player${compact ? ' compact' : ''}">${art}<div class="player-body">
  <audio controls preload="none" src="${esc(ep.url)}"></audio>
  <div class="player-meta">${esc(PODCAST.title)} · ${esc(label)}${!compact && ed ? ` · <a href="${base}${ed.date}/script/">${ep.format === 'dialogue' ? 'read the script' : 'read the narration'}</a> · <a href="${base}podcast/">subscribe</a>` : ''}</div>
</div></div>`;
}

function loadScript(date) {
  const p = path.join(DATA_DIR, `${date}.script.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function renderScriptPage(ed, sc, ep) {
  const base = '../../';
  const usedDialogue = ep ? ep.format === 'dialogue' : !!sc;
  let body;
  if (usedDialogue && sc) {
    const hosts = sc.hosts;
    const blocks = sc.blocks.map((b) => {
      const ref = b.type === 'item' || b.type === 'week' ? `<div class="script-ref">${b.type === 'week' ? 'Week in review' : esc(b.section || '')} — <a href="${base}${ed.date}/#${esc(slugify(b.section || 'week-in-review'))}">${esc(b.headline)}</a></div>` : `<div class="script-ref muted">${esc(b.type)}</div>`;
      const lines = b.lines.map((l) => `<div class="line"><span class="who">${esc((hosts[l.host] || {}).name || l.host)}</span><span>${esc(l.text)}</span></div>`).join('');
      return `<section class="script-block">${ref}${lines}</section>`;
    }).join('\n');
    body = `<p class="lede">Two hosts, ${Object.values(hosts).map((h) => esc(h.name)).join(' and ')} — synthetic voices. Every block below is pinned to one item of the written edition (linked); a validator checks that every number in a block appears in that item, that flagged items voice their caveat, that a source is named, and that no speculative or hype language is used.</p>${blocks}`;
  } else {
    const n = narrationFor(ed);
    body = `<p class="lede">Single narrator (synthetic voice). This text is generated by code directly from the written edition — summary, then each item's headline, key fact and caveats — so it cannot say anything the edition does not.</p>` +
      n.lines.map((l) => `<p${l.section ? ' class="script-section"' : ''}>${esc(l.text)}</p>`).join('');
  }
  const page = `<div class="eyebrow"><a href="${base}${ed.date}/">${esc(longDate(ed.date))}</a> / script</div>
<h1>Episode script — ${esc(shortDate(ed.date))}</h1>
${renderPlayer(ep, base, ed, false)}
${body}`;
  return layout({ title: `Script — ${shortDate(ed.date)} — ${SITE_NAME}`, base, body: page, canonical: `${SITE_URL}/${ed.date}/script/` });
}

function renderPodcastPage(editions, audio) {
  const base = '../';
  const feed = `${SITE_URL}/podcast.xml`;
  const eps = editions.filter((ed) => audio[ed.date]).map((ed) => `<article class="card">
  <div class="eyebrow">${esc(shortDate(ed.date))} · ${audio[ed.date].format === 'dialogue' ? 'two hosts' : 'narrated'} · ${mmss(audio[ed.date].seconds)}</div>
  <h2><a href="${base}${ed.date}/">${esc(longDate(ed.date))}</a></h2>
  ${renderSpectrum(ed, false)}
  ${renderPlayer(audio[ed.date], base, ed, false)}
</article>`).join('\n');
  const legend = Object.entries(SECTION_COLORS).map(([name, c]) => `<span><i style="background:${c.hex}"></i>${esc(name)} <span class="muted">${esc(c.name)}</span></span>`).join('');
  const body = `<div class="podcast-hero"><img src="${base}cover.png" alt="${esc(PODCAST.title)} cover" width="180" height="180"><div>
<h1>${esc(PODCAST.title)}</h1>
<p class="lede">Presented by ${esc(PODCAST.presenter)}. Every edition as an episode, ready when the morning edition is. Subscribe once and each day's episode downloads to your phone.</p></div></div>
<div class="card">
  <p><b>Feed URL</b> — paste into your podcast app:</p>
  <p><code class="feed">${esc(feed)}</code></p>
  <p class="muted">Apple Podcasts: Library → ⋯ → <i>Follow a Show by URL</i>. Overcast: + → <i>Add URL</i>. Pocket Casts: search bar → paste the URL. Episodes are voiced by AI from the written edition; the two-host format is used only when the script passes every factual lock, otherwise the day is narrated straight from the edition text. Each episode page has the script with every claim linked to its source.</p>
</div>
<div class="card">
  <p><b>Episode covers are coloured by the news.</b> Each section has a fixed colour; a day's cover mixes them in proportion to how many items fell in each section, with the exact shares shown as a bar along the bottom.</p>
  <div class="spectrum-legend">${legend}</div>
</div>
${eps || '<p class="muted">No episodes yet.</p>'}`;
  return layout({ title: `${PODCAST.title} — Podcast — ${SITE_NAME}`, base, body, canonical: `${SITE_URL}/podcast/` });
}

function renderPodcastFeed(editions, audio) {
  const items = editions.filter((ed) => audio[ed.date]).slice(0, 60).map((ed) => {
    const ep = audio[ed.date];
    const desc = paragraphs(ed.summary).join('\n\n');
    return `<item>
<title>${esc(longDate(ed.date))}${ed.edition === 'monday' ? ' — Monday edition' : ''}</title>
<link>${SITE_URL}/${ed.date}/</link>
<guid isPermaLink="false">ainews-${ed.date}</guid>
<pubDate>${new Date(ep.generated_at || ed.date + 'T12:00:00Z').toUTCString()}</pubDate>
<description>${esc(desc)}</description>
<itunes:summary>${esc(desc)}</itunes:summary>
<itunes:duration>${hhmmss(ep.seconds)}</itunes:duration>
${ep.image ? `<itunes:image href="${esc(ep.image)}"/>` : ''}
<itunes:explicit>false</itunes:explicit>
<enclosure url="${esc(ep.url)}" length="${ep.bytes}" type="audio/mpeg"/>
</item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(PODCAST.title)}</title>
<link>${SITE_URL}/podcast/</link>
<atom:link href="${SITE_URL}/podcast.xml" rel="self" type="application/rss+xml"/>
<language>en</language>
<description>${esc(PODCAST.title)}, presented by ${esc(PODCAST.presenter)}. ${esc(SITE_TAGLINE)} Each episode is voiced by AI from the written edition; every claim links to its source on the site.</description>
<itunes:author>${esc(PODCAST.presenter)}</itunes:author>
<itunes:subtitle>${esc(PODCAST.tagline)}</itunes:subtitle>
<itunes:image href="${SITE_URL}/cover.png"/>
<image><url>${SITE_URL}/cover.png</url><title>${esc(PODCAST.title)}</title><link>${SITE_URL}/podcast/</link></image>
<itunes:explicit>false</itunes:explicit>
<itunes:category text="Technology"/>
<itunes:category text="News"><itunes:category text="Tech News"/></itunes:category>
${items}
</channel>
</rss>
`;
}

// ---------- trace (end-to-end run record) ----------
const TRACE_DIR = path.join(ROOT, 'trace');
const TRACE_MAX_SHOWN = 6000; // characters of a response shown inline on the trace page (full text in the jsonl)

function loadTrace(date) {
  const evPath = path.join(TRACE_DIR, `${date}.jsonl`);
  if (!fs.existsSync(evPath)) return null;
  const events = fs.readFileSync(evPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  // Assistant narration (text blocks, not thinking) and user prompts from the raw transcript, if present.
  const trPath = path.join(TRACE_DIR, `${date}.transcript.jsonl`);
  const narration = [];
  if (fs.existsSync(trPath)) {
    for (const line of fs.readFileSync(trPath, 'utf8').split('\n')) {
      if (!line) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      const c = d.message && d.message.content;
      if (d.type === 'assistant' && Array.isArray(c)) {
        for (const b of c) if (b.type === 'text' && b.text && b.text.trim()) narration.push({ t: d.timestamp, kind: 'assistant', text: b.text, sidechain: !!d.isSidechain });
      } else if (d.type === 'user' && typeof c === 'string' && c.trim() && !d.isSidechain) {
        narration.push({ t: d.timestamp, kind: 'prompt', text: c });
      }
    }
  }
  return { events, narration, hasTranscript: fs.existsSync(trPath) };
}

function toolSummary(e) {
  const i = e.input || {};
  switch (e.tool_name) {
    case 'WebFetch': return i.url || '';
    case 'WebSearch': return `“${i.query || ''}”${i.allowed_domains ? ` in ${i.allowed_domains.join(', ')}` : ''}`;
    case 'Bash': return i.description || i.command || '';
    case 'Read': case 'Write': case 'Edit': case 'Glob': case 'Grep': return i.file_path || i.pattern || i.path || '';
    case 'Agent': case 'Task': return `${i.description || ''}${i.subagent_type ? ` (${i.subagent_type})` : ''}`;
    case 'ToolSearch': return i.query || '';
    default:
      if (/send_message/.test(e.tool_name || '')) return `to ${(i.to || []).join(', ')} — “${i.subject || ''}”`;
      return Object.keys(i).slice(0, 3).map((k) => `${k}=${typeof i[k] === 'string' ? i[k].slice(0, 80) : JSON.stringify(i[k]).slice(0, 80)}`).join(' ');
  }
}

function prettyResponse(r) {
  if (r == null) return '';
  if (typeof r === 'object' && r.truncated) return `${r.head}\n… [truncated: ${r.length} characters total; full text in transcript.jsonl]`;
  if (typeof r === 'string') return r;
  return JSON.stringify(r, null, 2);
}

function renderTracePage(ed, trace) {
  const base = '../../';
  const { events, narration } = trace;
  const start = events.find((e) => e.event === 'SessionStart');
  const stop = [...events].reverse().find((e) => e.event === 'Stop');
  const calls = events.filter((e) => e.event === 'PostToolUse');
  const byTool = new Map();
  for (const c of calls) byTool.set(c.tool_name, (byTool.get(c.tool_name) || 0) + 1);
  const urls = new Set(calls.filter((c) => c.tool_name === 'WebFetch').map((c) => (c.input || {}).url));
  const t0 = events.length ? Date.parse(events[0].t) : 0;
  const t1 = events.length ? Date.parse(events[events.length - 1].t) : 0;
  const dur = t0 && t1 ? Math.round((t1 - t0) / 60000) : null;
  const sessionId = start && start.session_id;
  const agents = new Set(calls.map((c) => c.agent_id).filter(Boolean));

  // Merge narration and events into one timeline by timestamp.
  const rows = [
    ...events.map((e) => ({ t: Date.parse(e.t), kind: e.event, e })),
    ...narration.map((n) => ({ t: Date.parse(n.t) || 0, kind: n.kind, n })),
  ].sort((a, b) => a.t - b.t);

  const hhmmss = (ms) => new Date(ms).toISOString().slice(11, 19);
  const body = rows.map((r) => {
    if (r.kind === 'prompt') return `<div class="tr tr-prompt"><span class="tt">${hhmmss(r.t)}</span><div><div class="tl">Prompt</div><pre>${esc(r.n.text)}</pre></div></div>`;
    if (r.kind === 'assistant') return `<div class="tr tr-assistant${r.n.sidechain ? ' tr-sub' : ''}"><span class="tt">${hhmmss(r.t)}</span><div><div class="tl">${r.n.sidechain ? 'Subagent' : 'Claude'}</div><div class="tx">${esc(r.n.text)}</div></div></div>`;
    const e = r.e;
    if (r.kind === 'SessionStart') return `<div class="tr tr-sys"><span class="tt">${hhmmss(r.t)}</span><div><div class="tl">Session start</div><div class="tx muted">${esc(e.session_id || '')}${e.model ? ` · ${esc(e.model)}` : ''}${e.cwd ? ` · ${esc(e.cwd)}` : ''}</div></div></div>`;
    if (r.kind === 'Stop' || r.kind === 'SubagentStop') return `<div class="tr tr-sys"><span class="tt">${hhmmss(r.t)}</span><div><div class="tl">${r.kind === 'Stop' ? 'Session end' : 'Subagent finished'}</div>${e.last_message ? `<details><summary>final message</summary><pre>${esc(prettyResponse(e.last_message))}</pre></details>` : ''}</div></div>`;
    if (r.kind === 'PostToolUse') {
      const resp = prettyResponse(e.response);
      const shown = resp.length > TRACE_MAX_SHOWN ? resp.slice(0, TRACE_MAX_SHOWN) + `\n… [${resp.length - TRACE_MAX_SHOWN} more characters in events.jsonl]` : resp;
      return `<div class="tr tr-tool${e.agent_id ? ' tr-sub' : ''}"><span class="tt">${hhmmss(r.t)}</span><div>
  <div class="tl"><span class="tool">${esc(e.tool_name)}</span> ${esc(toolSummary(e))}${e.duration_ms != null ? ` <span class="muted">${e.duration_ms} ms</span>` : ''}${e.agent_id ? ` <span class="muted">· subagent</span>` : ''}</div>
  <details><summary>input</summary><pre>${esc(JSON.stringify(e.input, null, 2))}</pre></details>
  <details><summary>response${resp ? ` (${resp.length.toLocaleString()} chars)` : ''}</summary><pre>${esc(shown)}</pre></details>
</div></div>`;
    }
    return '';
  }).join('\n');

  const stats = `<div class="trace-stats">
  <div><b>${calls.length}</b> tool calls</div>
  <div><b>${urls.size}</b> pages fetched</div>
  ${dur != null ? `<div><b>${dur}</b> min</div>` : ''}
  ${agents.size ? `<div><b>${agents.size}</b> subagents</div>` : ''}
  ${[...byTool.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><span class="tool">${esc(k)}</span> ${v}</div>`).join('')}
</div>`;
  const page = `<div class="eyebrow"><a href="${base}${ed.date}/">${esc(longDate(ed.date))}</a> / trace</div>
<h1>Run trace — ${esc(shortDate(ed.date))}</h1>
<p class="lede">The end-to-end record of the run that produced this edition: every tool call the agent made, its input, and its response, captured automatically by the harness (Claude Code hooks) — not written by the model. ${sessionId ? `Provisioning steps and the full session are on <a href="https://claude.ai/code/session_${esc(sessionId)}">claude.ai</a>.` : ''}</p>
${stats}
<p class="muted">Raw files: <a href="events.jsonl">events.jsonl</a>${trace.hasTranscript ? ` · <a href="transcript.jsonl">transcript.jsonl</a> (complete session, untruncated)` : ''}. Times are UTC. Responses longer than ${TRACE_MAX_SHOWN.toLocaleString()} characters are cut on this page but complete in the raw files.</p>
<div class="trace">${body}</div>`;
  return layout({ title: `Trace — ${shortDate(ed.date)} — ${SITE_NAME}`, base, body: page, canonical: `${SITE_URL}/${ed.date}/trace/` });
}

// ---------- main ----------
function main() {
  const editions = loadEditions();
  const { topics, trending } = buildTopicIndex(editions);
  const audio = loadAudio();
  for (const ed of editions) ed.audio = audio[ed.date] || null;

  if (process.argv.includes('--topics')) {
    const all = [...topics.values()].sort((a, b) => b.entries.length - a.entries.length || a.slug.localeCompare(b.slug));
    for (const t of all) console.log(`${t.slug}\t${t.entries.length} items\t${t.dates.size} editions\tlast ${t.lastSeen}`);
    return;
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  write('.nojekyll', '');
  write('style.css', CSS.trim() + '\n');
  write('index.html', renderHome(editions, trending));
  write('feed.xml', renderFeed(editions));
  write('trends/index.html', renderTrendsIndex(topics, trending, editions));
  write('podcast/index.html', renderPodcastPage(editions, audio));
  write('podcast.xml', renderPodcastFeed(editions, audio));
  for (const t of topics.values()) write(`trends/${t.slug}/index.html`, renderTopicPage(t));
  editions.forEach((ed, i) => {
    const trace = loadTrace(ed.date);
    ed.hasTrace = !!trace;
    write(`${ed.date}/index.html`, renderEditionPage(ed, editions, i));
    const sc = loadScript(ed.date);
    if (ed.audio || sc) write(`${ed.date}/script/index.html`, renderScriptPage(ed, sc, ed.audio));
    if (trace) {
      write(`${ed.date}/trace/index.html`, renderTracePage(ed, trace));
      fs.copyFileSync(path.join(TRACE_DIR, `${ed.date}.jsonl`), path.join(OUT_DIR, ed.date, 'trace', 'events.jsonl'));
      if (trace.hasTranscript) fs.copyFileSync(path.join(TRACE_DIR, `${ed.date}.transcript.jsonl`), path.join(OUT_DIR, ed.date, 'trace', 'transcript.jsonl'));
    }
    const em = renderEmail(ed);
    write(`email/${ed.date}.html`, em.html);
    write(`email/${ed.date}.txt`, em.text);
    write(`email/${ed.date}.subject.txt`, em.subject + '\n');
  });
  write('topics.json', JSON.stringify([...topics.values()].map((t) => ({ slug: t.slug, label: t.label, editions: t.dates.size, items: t.entries.length, lastSeen: t.lastSeen })), null, 2));
  console.log(`Built ${editions.length} edition(s), ${topics.size} topic(s), ${trending.length} trending, ${Object.keys(audio).length} episode(s) → ${path.relative(ROOT, OUT_DIR)}/`);
}

if (require.main === module) main();

module.exports = { longDate, shortDate, paragraphs, isMonday, loadEditions, SECTION_ORDER, FLAG_LABELS, SITE_NAME, SITE_URL, REPO_URL };
