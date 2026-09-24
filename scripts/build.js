#!/usr/bin/env node
'use strict';
// Static site generator for AI Edge Briefing.
// Reads data/YYYY-MM-DD.json editions, writes a complete static site to site/.
// No dependencies. Run: node scripts/build.js   (or --topics to list known topic slugs)

const fs = require('fs');
const path = require('path');
const { dateObj, longDate, shortDate, periodLabel, shortPeriodLabel, paragraphs, FLAG_LABELS, SECTION_COLORS, PODCAST, CREDITS, sectionWeights, podcastGuid, op3 } = require('./lib.js');
const { narrationFor } = require('./narrate.js');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'site');
const SITE_NAME = 'AI Edge Briefing';
const SITE_TAGLINE = 'Daily, fact-first coverage of frontier AI — the advances, the research, and how it is being used for good and for harm.';
// SITE_ENV=staging builds the private preview at staging.aiedgebriefing.com: noindex everywhere, robots
// Disallow, no feeds or sitemap (a staging podcast.xml would carry the real show's permanent podcast:guid), a
// visible ribbon, and no silent fallback to the production origin. With the flag absent — production — nothing
// below changes a single byte of the output; that is verified by diffing builds, not assumed.
const SITE_ENV = process.env.SITE_ENV || 'production';
const STAGING = SITE_ENV === 'staging';
if (STAGING && !process.env.SITE_URL) { console.error('SITE_ENV=staging but SITE_URL is not set — refusing to default to https://aiedgebriefing.com'); process.exit(2); }
if (STAGING && /^https:\/\/(www\.)?aiedgebriefing\.com\/?$/.test(process.env.SITE_URL)) { console.error(`SITE_ENV=staging with the production SITE_URL ${process.env.SITE_URL} — refusing`); process.exit(2); }
const SITE_URL = (process.env.SITE_URL || 'https://aiedgebriefing.com').replace(/\/$/, '');
const REPO_URL = 'https://github.com/mikeshoss/ainews';
const GA_ID = process.env.GA_MEASUREMENT_ID || '';
const UTM_SOURCE = 'aiedgebriefing';
// Tag an outbound link so the destination can see it came from us: utm_source=aiedgebriefing, utm_medium=web|email,
// utm_campaign=<edition date>. Data files keep the clean URL; tags are added only when rendering.
function utm(url, medium, campaign) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || u.searchParams.has('utm_source')) return url;
    u.searchParams.set('utm_source', UTM_SOURCE);
    u.searchParams.set('utm_medium', medium);
    if (campaign) u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  } catch { return url; }
} // Google Analytics 4 measurement id (G-XXXXXXXXXX); empty = no analytics
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

// Week-in-review files: data/YYYY-MM-DD.week.json, dated by the Monday they publish. Newest first.
function loadWeeks() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.week\.json$/.test(f))
    .map((f) => {
      const wk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      wk.date = wk.date || f.slice(0, 10);
      wk.happened = wk.happened || []; wk.connects = wk.connects || []; wk.unknowns = wk.unknowns || [];
      wk.byId = new Map([...wk.happened, ...wk.connects, ...wk.unknowns].map((o) => [o.id, o]));
      wk.label = periodLabel(wk.period);
      wk.shortLabel = shortPeriodLabel(wk.period);
      wk.itemCount = wk.happened.length;
      return wk;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Storylines: storylines/<id>.json — curated arcs with dated "where this stands" snapshots. The timeline is derived
// from daily items filed under the id (item.storylines) and weekly connections that carry it.
const STORY_DIR = path.join(ROOT, 'storylines');
const STATUS_LABEL = { proposed: 'Proposed', live: 'Live', dormant: 'Dormant', resolved: 'Resolved' };
const STATUS_ORDER = { live: 0, proposed: 1, dormant: 2, resolved: 3 };
function loadStorylines(editions, weeks) {
  if (!fs.existsSync(STORY_DIR)) return [];
  // Activity is measured the same way buildTopicIndex measures it for topic slugs, so the two never
  // disagree about what "recently" means: a window of TREND_WINDOW_DAYS back from the newest edition.
  const latestEdition = editions[0] ? editions[0].date : null;
  const editionDates = editions.map((e) => e.date);                        // newest first
  const windowEditions = latestEdition ? editionDates.filter((d) => daysBetween(latestEdition, d) < TREND_WINDOW_DAYS).length : 0;
  const list = fs.readdirSync(STORY_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const st = JSON.parse(fs.readFileSync(path.join(STORY_DIR, f), 'utf8'));
    st.id = st.id || f.slice(0, -5);
    st.states = (st.states || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    st.current = st.states[st.states.length - 1] || null;
    st.timeline = [];
    for (const ed of editions) for (const sec of ed.sections) for (const item of sec.items) if ((item.storylines || []).includes(st.id)) st.timeline.push({ date: ed.date, section: sec.name, item });
    st.connections = [];
    for (const wk of weeks) for (const c of wk.connects) if ((c.storylines || []).includes(st.id)) st.connections.push({ week: wk, connect: c });
    st.timeline.sort((a, b) => (a.date < b.date ? 1 : -1));
    st.lastActivity = [st.timeline[0] && st.timeline[0].date, st.current && st.current.date, ...st.connections.map((c) => c.week.date)].filter(Boolean).sort().pop() || st.opened;
    st.editions = new Set(st.timeline.map((t) => t.date));
    // How much this arc actually moved lately. `recent` counts developments, not days: an arc with
    // eighteen items this week and one with three both "moved", and only the count says which is which.
    st.recent = latestEdition ? st.timeline.filter((t) => daysBetween(latestEdition, t.date) < TREND_WINDOW_DAYS).length : 0;
    st.recentDays = latestEdition ? [...st.editions].filter((d) => daysBetween(latestEdition, d) < TREND_WINDOW_DAYS).length : 0;
    st.streak = 0;
    for (const d of editionDates) { if (st.editions.has(d)) st.streak++; else break; }
    st.everyEdition = windowEditions > 0 && st.streak >= windowEditions;
    st.quietDays = latestEdition && st.timeline[0] ? daysBetween(latestEdition, st.timeline[0].date) : null;
    return st;
  });
  return list.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || (a.lastActivity < b.lastActivity ? 1 : -1) || a.name.localeCompare(b.name));
}
// Most active first. `lastActivity` cannot order this list: nearly every live arc shares the newest
// edition's date, so that sort fell through to the name and the strip came out alphabetical.
const byActivity = (a, b) => b.recent - a.recent || b.streak - a.streak || b.timeline.length - a.timeline.length || a.name.localeCompare(b.name);
const HOME_STORYLINES = 4;   // ranked rows on the home page; the rest are named on one line

function buildTopicIndex(editions, weeks = []) {
  const topics = new Map();
  const topicFor = (slug) => { if (!topics.has(slug)) topics.set(slug, { slug, label: topicLabel(slug), dates: new Set(), entries: [], weekly: [], weeks: new Set(), threads: 0 }); return topics.get(slug); };
  // Weekly threads: every development, connection and open question carrying the slug. These are the "how this story has evolved" timeline.
  for (const wk of weeks) {
    const add = (kind, ref) => { for (const slug of ref.topics || []) { const t = topicFor(slug); t.weekly.push({ kind, ref, week: wk }); t.weeks.add(wk.date); if (kind === 'connect') t.threads++; } };
    wk.connects.forEach((c) => add('connect', c));
    wk.happened.forEach((h) => add('happened', h));
    wk.unknowns.forEach((u) => add('unknown', u));
  }
  for (const ed of editions) {
    for (const sec of ed.sections) {
      for (const item of sec.items) {
        for (const slug of item.topics || []) {
          const t = topicFor(slug);
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
    const seen = [...t.dates].sort();
    t.lastSeen = seen[seen.length - 1] || null;
    t.firstSeen = seen[0] || null;
  }
  const trending = [...topics.values()]
    .filter((t) => t.daysInWindow >= TREND_MIN_DAYS)
    .sort((a, b) => b.streak - a.streak || b.daysInWindow - a.daysInWindow || b.entries.length - a.entries.length || a.slug.localeCompare(b.slug));
  return { topics, trending };
}

// ---------- rendering ----------
const ORG = { '@type': 'Organization', name: PODCAST.presenter, url: PODCAST.presenterUrl };
const jsonld = (obj) => obj ? `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>` : '';

// The stylesheet URL carries a content hash so browsers and the CDN never pair new HTML with a cached old CSS.
let CSS_HASH = '', JS_HASH = '';
const PLAYER_JS = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf8');
function layout({ title, description, base, body, canonical, og = {}, ld, nav }) {
  if (!CSS_HASH) { const h = (t) => require('crypto').createHash('sha1').update(t).digest('hex').slice(0, 10); CSS_HASH = h(CSS); JS_HASH = h(PLAYER_JS); }
  const desc = description || SITE_TAGLINE;
  // Current-section treatment: nav = 'home' | 'editions' (daily index) | 'week' | 'topics' | 'storylines' | 'podcast' | 'about'
  const cur = (k) => (nav === k ? ' class="current" aria-current="page"' : '');
  const image = og.image || `${SITE_URL}/og.png`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#121212">
${STAGING ? '<meta name="robots" content="noindex,nofollow">\n' : ''}${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:type" content="${esc(og.type || 'website')}">
<meta property="og:title" content="${esc(og.title || title)}">
<meta property="og:description" content="${esc(desc)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(og.imageAlt || `${PODCAST.title} — ${SITE_TAGLINE}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(og.title || title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" type="image/svg+xml" href="${base}favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="${base}favicon-32.png">
<link rel="apple-touch-icon" href="${base}apple-touch-icon.png">
<link rel="manifest" href="${base}site.webmanifest">
${STAGING ? '' : `<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)}" href="${base}feed.xml">
<link rel="alternate" type="application/rss+xml" title="${esc(PODCAST.title)} — Podcast" href="${base}podcast.xml">
`}<link rel="stylesheet" href="${base}style.css?v=${CSS_HASH}">
${jsonld(ld)}
${GA_ID ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(GA_ID)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(GA_ID)}',{anonymize_ip:true});</script>` : ''}
</head>
<body>
${STAGING ? stagingRibbon() : ''}<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${base}">${esc(SITE_NAME)}</a>
    <nav>
      <div class="menu${['home', 'editions', 'week', 'topics'].includes(nav) ? ' current-group' : ''}">
        <a href="${base}"${cur('home')}>Editions</a><button class="caret" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Editions menu"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
        <div class="menu-list"><div class="menu-list-inner" role="menu">
          <a href="${base}daily/"${cur('editions')}>Daily</a>
          <a href="${base}week/"${cur('week')}>Weekly</a>
          <a href="${base}topics/"${cur('topics')}>Topics</a>
        </div></div>
      </div>
      <a href="${base}storylines/"${cur('storylines')}>Storylines</a>
      <a href="${base}podcast/"${cur('podcast')}>Podcast</a>
      <a href="${REPO_URL}/blob/main/SOURCES.md">Sources</a>
      <a href="${base}about/"${cur('about')}>About</a>
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer"><div class="wrap">
  ${renderSubscribe(base, 'footer')}
  <p>${esc(SITE_NAME)} is generated daily from primary sources. Every claim links to where it came from. Nothing is written without a source.</p>
  <p>Presented by <a href="${esc(utm(PODCAST.presenterUrl, 'web', 'site'))}" rel="noopener">${esc(PODCAST.presenter)}</a> · Built by <a href="${esc(utm(CREDITS.url, 'web', 'site'))}" rel="noopener">${esc(CREDITS.name)}</a> · <a href="${base}about/">About</a> · <a href="${REPO_URL}">Data &amp; code</a></p>
  <p>© ${new Date().getUTCFullYear()} ${esc(PODCAST.presenter)}. Editions <a href="https://creativecommons.org/licenses/by/4.0/" rel="license noopener">CC BY 4.0</a> · Code <a href="${REPO_URL}/blob/main/LICENSE" rel="license">MIT</a></p>
</div></footer>
<script src="${base}player.js?v=${JS_HASH}" defer></script>
</body>
</html>
`;
}

function renderSources(sources, campaign) {
  return (sources || []).map((s, i) => `<a class="src" href="${esc(utm(s.url, 'web', campaign))}" rel="noopener" title="${esc(s.url)}">${esc(s.name || hostname(s.url))}</a>`).join('<span class="sep">·</span>');
}

function renderItem(item, base, opts = {}) {
  const first = (item.sources || [])[0];
  const impact = item.impact && item.impact !== 'neutral' ? `<span class="impact impact-${esc(item.impact)}">${esc(item.impact)}</span>` : '';
  const flags = (item.flags || []).map((f) => `<span class="flag flag-${esc(f)}">${esc(FLAG_LABELS[f] || f)}</span>`).join('');
  const topics = (item.topics || []).map((t) => `<a class="topic" href="${base}topics/${esc(t)}/">${esc(topicLabel(t))}</a>`).join('');
  const stories = (item.storylines || []).map((id) => { const st = STORY_BY_ID.get(id); return st ? `<a class="topic storyline-chip" href="${base}storylines/${esc(id)}/">${esc(st.name)}</a>` : ''; }).join('');
  let dateLine = opts.date ? `<div class="item-meta"><a href="${base}${opts.date}/">${esc(shortDate(opts.date))}</a> · ${esc(opts.section || '')}</div>` : '';
  // Week-in-review items: when it happened and which daily editions carried it.
  if (opts.week) {
    const when = (item.dates || []).map((d) => esc(shortDate(d))).join(', ');
    const covered = (item.editions || []).map((d) => `<a href="${base}${d}/">${esc(shortDate(d))}</a>`).join(' · ');
    dateLine = `<div class="item-meta">${when}${covered ? ` · covered in ${covered}` : ' · not in a daily edition'}</div>`;
  }
  return `<article class="item"${opts.anchorId ? ` id="${esc(opts.anchorId)}"` : ''}>
  ${dateLine}
  <h3>${first ? `<a href="${esc(utm(first.url, 'web', opts.campaign))}" rel="noopener">${esc(item.headline)}</a>` : esc(item.headline)} ${impact}${flags}</h3>
  <div class="sources">${renderSources(item.sources, opts.campaign)}</div>
  <ul>${(item.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
  ${topics || stories ? `<div class="topics">${stories}${topics}</div>` : ''}
</article>`;
}
let STORY_BY_ID = new Map();

function renderFigures(figures, campaign) {
  if (!(figures || []).length) return '';
  return `<h3 class="sub" id="figures">By the numbers</h3><dl class="figures">${figures.map((f) => `<div><dt>${esc(f.value)}</dt><dd>${esc(f.label)} <a class="src" href="${esc(utm(f.url, 'web', campaign))}" rel="noopener">${esc(f.source || hostname(f.url))}</a></dd></div>`).join('')}</dl>`;
}
function renderCalendar(calendar, campaign) {
  if (!(calendar || []).length) return '';
  return `<h3 class="sub" id="calendar">On the calendar</h3><ul class="calendar">${calendar.map((c) => `<li><strong>${esc(c.date)}</strong> — ${esc(c.event)} <a class="src" href="${esc(utm(c.url, 'web', campaign))}" rel="noopener">${esc(c.source || hostname(c.url))}</a></li>`).join('')}</ul>`;
}

function renderEditionPage(ed, editions, idx) {
  const base = '../';
  const newer = editions[idx - 1], older = editions[idx + 1];
  const summary = paragraphs(ed.summary).map((p) => `<p>${esc(p)}</p>`).join('');
  const toc = ed.sections.map((s) => `<a href="#${esc(slugify(s.name))}">${esc(s.name)} <span class="count">${s.items.length}</span></a>`).join('');
  const sections = ed.sections.map((s) => `<section class="section" id="${esc(slugify(s.name))}">
  <h2><i class="dot" style="background:${(SECTION_COLORS[s.name] || {}).hex || '#9a9a9a'}"></i>${esc(s.name)}</h2>
  ${s.items.map((it) => renderItem(it, base, { campaign: ed.date })).join('\n')}
</section>`).join('\n');
  const body = `<article class="edition">
  <header class="edition-header">
    <div class="eyebrow">Daily edition · ${ed.itemCount} items${ed.window ? ` · covers ${esc(ed.window.replace(/\s*\(.*?\)\s*/g, ''))}` : ''}${ed.hasTrace ? ` · <a href="${base}${ed.date}/trace/">how this edition was made</a>` : ''}</div>
    <h1>${esc(longDate(ed.date))}</h1>
    ${renderSpectrum(ed, true)}
    ${renderPlayer(ed.audio, base, ed, false)}
    <div class="summary">${summary}</div>
    <nav class="toc">${toc}</nav>
  </header>
  ${sections}
  ${renderShare(renderLinkedIn(ed).split('\n\n').slice(0, -1).join('\n\n'), `${SITE_URL}/${ed.date}/`)}
  ${renderSubscribe(base)}
  <nav class="pager">
    ${older ? `<a href="${base}${older.date}/">← ${esc(shortDate(older.date))}</a>` : '<span></span>'}
    ${newer ? `<a href="${base}${newer.date}/">${esc(shortDate(newer.date))} →</a>` : '<span></span>'}
  </nav>
</article>`;
  const url = `${SITE_URL}/${ed.date}/`;
  const ld = [{
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: `${longDate(ed.date)} — ${PODCAST.title}`, description: paragraphs(ed.summary)[0],
    datePublished: ed.generated_at || `${ed.date}T11:00:00Z`, dateModified: ed.generated_at || `${ed.date}T11:00:00Z`,
    author: ORG, publisher: { ...ORG, logo: { '@type': 'ImageObject', url: `${SITE_URL}/cover.png` } },
    image: [ed.ogUrl || `${SITE_URL}/og.png`, ...(ed.coverUrl ? [ed.coverUrl] : [])], mainEntityOfPage: url, isAccessibleForFree: true,
  }];
  if (ed.audio) ld.push({
    '@context': 'https://schema.org', '@type': 'PodcastEpisode', name: `${longDate(ed.date)}`, url, datePublished: ed.audio.generated_at,
    duration: `PT${Math.floor(ed.audio.seconds / 60)}M${ed.audio.seconds % 60}S`, description: paragraphs(ed.summary)[0],
    associatedMedia: { '@type': 'MediaObject', contentUrl: ed.audio.url, encodingFormat: 'audio/mpeg' },
    partOfSeries: { '@type': 'PodcastSeries', name: PODCAST.title, url: `${SITE_URL}/podcast/` }, image: ed.coverUrl,
  });
  return layout({ title: `${longDate(ed.date)} — ${SITE_NAME}`, description: paragraphs(ed.summary)[0], base, body, canonical: url, nav: 'editions',
    og: { type: 'article', title: `${PODCAST.title} — ${longDate(ed.date)}`, image: ed.ogUrl, imageAlt: `${PODCAST.title} — ${longDate(ed.date)}` }, ld });
}

const FEATURES = new Set((process.env.SITE_FEATURES || '').split(',').map((s) => s.trim()).filter(Boolean));
// Share row: copy the ready-made post, or open a pre-filled share on X / LinkedIn / Bluesky. Every link is tagged.
function renderShare(text, pageUrl) {
  if (!FEATURES.has('share')) return '';
  const u = (src) => `${pageUrl}?utm_source=${src}&utm_medium=share`;
  const t = encodeURIComponent(text);
  return `<div class="share"><span class="share-label">Share</span>
  <button type="button" class="share-copy" data-copy="${esc(text)}\n\n${esc(u('copy'))}">Copy post</button>
  <a href="https://x.com/intent/post?text=${t}&url=${encodeURIComponent(u('x'))}" rel="noopener" target="_blank">X</a>
  <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u('linkedin'))}" rel="noopener" target="_blank">LinkedIn</a>
  <a href="https://bsky.app/intent/compose?text=${t}%0A%0A${encodeURIComponent(u('bluesky'))}" rel="noopener" target="_blank">Bluesky</a>
</div>`;
}
function renderSubscribe(base, variant = 'inline') {
  if (!SUBSCRIBE_URL) return '';
  return `<form class="subscribe ${esc(variant)}" method="POST" action="${esc(SUBSCRIBE_URL)}" target="_blank">
  <div class="subscribe-text"><strong>One email each morning.</strong> Every claim linked to its source. No opinion, no ads.</div>
  <div class="subscribe-row"><input type="email" name="EMAIL" required placeholder="you@example.com" aria-label="Email address" autocomplete="email"><input type="hidden" name="email_address_check" value="" class="hp"><input type="hidden" name="locale" value="en"><button type="submit">Subscribe</button></div>
</form>`;
}
function renderEditionCard(ed, base) {
  const topTopics = topTopicsFor(ed).slice(0, 6).map((t) => `<a class="topic" href="${base}topics/${esc(t)}/">${esc(topicLabel(t))}</a>`).join('');
  return `<article class="card card-link">
  <div class="eyebrow">Daily edition · ${ed.itemCount} items</div>
  <h2><a href="${base}${ed.date}/" class="stretch">${esc(longDate(ed.date))}</a></h2>
  ${renderSpectrum(ed, false)}
  <p>${esc(paragraphs(ed.summary)[0] || '')}</p>
  ${renderPlayer(ed.audio, base, ed, true)}
  <div class="topics">${topTopics}</div>
</article>`;
}
function weekTopTopics(wk) {
  const counts = new Map();
  for (const o of [...wk.connects, ...wk.happened]) for (const t of o.topics || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((e) => e[0]);
}
function renderWeekCard(wk, base) {
  const topTopics = weekTopTopics(wk).slice(0, 6).map((t) => `<a class="topic" href="${base}topics/${esc(t)}/">${esc(topicLabel(t))}</a>`).join('');
  return `<article class="card card-link week-card">
  <div class="eyebrow"><span class="badge">Week in review</span> · ${wk.happened.length} developments · ${wk.connects.length} connection${wk.connects.length === 1 ? '' : 's'} · ${wk.unknowns.length} open question${wk.unknowns.length === 1 ? '' : 's'}</div>
  <h2><a href="${base}week/${wk.date}/" class="stretch">${esc(wk.label)}</a></h2>
  <p>${esc(paragraphs(wk.summary)[0] || '')}</p>
  <ul class="connect-list">${wk.connects.map((c) => `<li><a href="${base}week/${wk.date}/#c-${esc(c.id)}">${esc(c.title)}</a></li>`).join('')}</ul>
  <div class="topics">${topTopics}</div>
</article>`;
}

// Home: one feed, dailies and weekly reviews interleaved newest-first (a week sorts before the daily of the same date).
function renderHome(editions, weeks, storylines) {
  const base = './';
  const live = storylines.filter((st) => st.status === 'live').slice().sort(byActivity);
  const top = live.slice(0, HOME_STORYLINES), rest = live.slice(HOME_STORYLINES);
  const storyRows = top.map((st) => `<a class="story-row" href="${base}storylines/${esc(st.id)}/"><span class="story-name">${esc(st.name)}</span><span class="story-n">${st.recent}${st.everyEdition ? '<span class="story-run" title="a development in every edition this week">●</span>' : ''}</span></a>`).join('');
  const quieter = rest.length ? `<p class="story-quiet"><span class="label">quieter</span>${rest.map((st) => `<a href="${base}storylines/${esc(st.id)}/">${esc(st.name)}</a>`).join('<span class="sep">·</span>')}</p>` : '';
  const anyRun = top.some((st) => st.everyEdition);
  const feed = [...editions.map((ed) => ({ key: `${ed.date}-0`, html: renderEditionCard(ed, base) })), ...weeks.map((wk) => ({ key: `${wk.date}-1`, html: renderWeekCard(wk, base) }))]
    .sort((a, b) => (a.key < b.key ? 1 : -1)).map((x) => x.html).join('\n');
  const body = `<section class="hero">
  <h1>${esc(SITE_NAME)}</h1>
  <p class="lede">${esc(SITE_TAGLINE)}</p>
  ${live.length ? `<div class="storylines">
    <div class="story-head"><span class="label">Storylines</span><span class="story-window">developments · last 7 days</span></div>
    ${storyRows}
    ${quieter}
    <p class="story-foot">${anyRun ? '<span class="story-run">●</span> in every edition this week' : ''}<a class="more" href="${base}storylines/">all storylines →</a></p>
  </div>` : ''}
  ${renderSubscribe(base, 'hero')}
</section>
<section class="editions">
${feed || '<p class="muted">No editions yet.</p>'}
</section>`;
  return layout({ title: `${SITE_NAME} — ${PODCAST.tagline}`, base, body, canonical: `${SITE_URL}/`, nav: 'home', og: { title: `${SITE_NAME} — daily, fact-first frontier AI news` }, ld: { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/`, description: SITE_TAGLINE, publisher: ORG } });
}

function renderEditionsIndex(editions) {
  const base = '../';
  const body = `<h1>Daily editions</h1>
<p class="lede">Every daily edition, newest first. Each is the last 24 hours in frontier AI, with a source behind every claim.</p>
<section class="editions">${editions.map((ed) => renderEditionCard(ed, base)).join('\n') || '<p class="muted">No editions yet.</p>'}</section>`;
  return layout({ title: `Editions — ${SITE_NAME}`, description: `Every daily edition of ${SITE_NAME}.`, base, body, canonical: `${SITE_URL}/daily/`, nav: 'editions', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Editions — ${SITE_NAME}`, url: `${SITE_URL}/daily/`, publisher: ORG } });
}

const WEEK_LEDE = 'Every Monday: what happened, what connects, and what we don\'t know — facts first, connections without opinion, then the open questions.';

function renderWeekIndex(weeks) {
  const base = '../';
  const body = `<h1>Week in review</h1>
<p class="lede">${esc(WEEK_LEDE)}</p>
<section class="editions">${weeks.map((wk) => renderWeekCard(wk, base)).join('\n') || '<p class="muted">First week in review: Monday 14 September 2026.</p>'}</section>`;
  return layout({ title: `Week in review — ${SITE_NAME}`, description: WEEK_LEDE, base, body, canonical: `${SITE_URL}/week/`, nav: 'week', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Week in review — ${SITE_NAME}`, url: `${SITE_URL}/week/`, publisher: ORG } });
}

function renderConnect(c, wk, base, opts = {}) {
  const campaign = `week-${wk.date}`;
  const linked = (c.items || []).map((id) => { const h = wk.byId.get(id); return h ? `<li><a href="${opts.pageHref || ''}#h-${esc(id)}">${esc(h.headline)}</a></li>` : ''; }).join('');
  const topics = (c.topics || []).map((t) => `<a class="topic" href="${base}topics/${esc(t)}/">${esc(topicLabel(t))}</a>`).join('');
  const stories = (c.storylines || []).map((id) => { const st = STORY_BY_ID.get(id); return st ? `<a class="topic storyline-chip" href="${base}storylines/${esc(id)}/">${esc(st.name)}</a>` : ''; }).join('');
  return `<article class="item connect" id="c-${esc(c.id)}">
  <h3>${esc(c.title)}</h3>
  <ul class="linked">${linked}</ul>
  ${paragraphs(c.explanation).map((p) => `<p>${esc(p)}</p>`).join('')}
  ${(c.sources || []).length ? `<div class="sources"><span class="muted">Attributed to</span> ${renderSources(c.sources, campaign)}</div>` : ''}
  ${topics || stories ? `<div class="topics">${stories}${topics}</div>` : ''}
</article>`;
}
function renderUnknown(u, wk, base, opts = {}) {
  const rel = (u.relates_to || []).map((id) => { const o = wk.byId.get(id); if (!o) return ''; const prefix = o.headline ? 'h' : 'c'; return `<a href="${opts.pageHref || ''}#${prefix}-${esc(id)}">${esc(o.headline || o.title)}</a>`; }).filter(Boolean).join(' · ');
  const topics = (u.topics || []).map((t) => `<a class="topic" href="${base}topics/${esc(t)}/">${esc(topicLabel(t))}</a>`).join('');
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');
  return `<article class="item unknown" id="u-${esc(u.id)}">
  <h3>${esc(u.question)}</h3>
  <dl>${row('Where the evidence ends', u.evidence_ends)}${row('Where sources disagree', u.disagreement)}${row('What would confirm it', u.would_confirm)}${row('What would invalidate it', u.would_invalidate)}${rel ? `<dt>Relates to</dt><dd>${rel}</dd>` : ''}</dl>
  ${topics ? `<div class="topics">${topics}</div>` : ''}
</article>`;
}

function renderWeekPage(wk, weeks, idx) {
  const base = '../../';
  const campaign = `week-${wk.date}`;
  const newer = weeks[idx - 1], older = weeks[idx + 1];
  const summary = paragraphs(wk.summary).map((p) => `<p>${esc(p)}</p>`).join('');
  const body = `<article class="edition week-review">
  <header class="edition-header">
    <div class="eyebrow"><span class="badge">Week in review</span> · ${wk.happened.length} developments · ${wk.connects.length} connection${wk.connects.length === 1 ? '' : 's'} · ${wk.unknowns.length} open question${wk.unknowns.length === 1 ? '' : 's'}${wk.hasTrace ? ` · <a href="${base}week/${wk.date}/trace/">how this edition was made</a>` : ''}</div>
    <h1>The week of ${esc(wk.label)}</h1>
    <div class="summary">${summary}</div>
    <nav class="toc"><a href="#happened">1 · What happened <span class="count">${wk.happened.length}</span></a><a href="#connects">2 · What connects <span class="count">${wk.connects.length}</span></a><a href="#unknowns">3 · What we don't know <span class="count">${wk.unknowns.length}</span></a>${(wk.figures || []).length ? '<a href="#figures">By the numbers</a>' : ''}${(wk.calendar || []).length ? '<a href="#calendar">Calendar</a>' : ''}</nav>
  </header>
  <section class="section" id="happened">
    <h2><span class="num">1</span>What happened</h2>
    <p class="muted">The developments that mattered, ${esc(wk.label)}. Same rules as the daily: every claim links to its source, every number is the source's number.</p>
    ${wk.happened.map((it) => renderItem(it, base, { campaign, week: true, anchorId: `h-${it.id}` })).join('\n')}
  </section>
  <section class="section week" id="connects">
    <h2><span class="num">2</span>What connects</h2>
    <p class="muted">Developments that appear to be part of the same larger shift. Only what the record supports: shared actors, sequence, and causes attributed to whoever stated them — never our own.</p>
    ${wk.connects.map((c) => renderConnect(c, wk, base)).join('\n')}
  </section>
  <section class="section" id="unknowns">
    <h2><span class="num">3</span>What we don't know</h2>
    <p class="muted">Where the evidence ends, where sources disagree, and what would confirm or invalidate the emerging picture.</p>
    ${wk.unknowns.map((u) => renderUnknown(u, wk, base)).join('\n')}
  </section>
  ${renderFigures(wk.figures, campaign)}
  ${renderCalendar(wk.calendar, campaign)}
  ${renderShare(`What actually changed in AI, ${wk.label}: ${wk.happened.length} developments, ${wk.connects.length} connections, ${wk.unknowns.length} open questions — facts first, no opinion.`, `${SITE_URL}/week/${wk.date}/`)}
  ${renderSubscribe(base)}
  <nav class="pager">
    ${older ? `<a href="${base}week/${older.date}/">← ${esc(older.shortLabel)}</a>` : '<span></span>'}
    ${newer ? `<a href="${base}week/${newer.date}/">${esc(newer.shortLabel)} →</a>` : '<span></span>'}
  </nav>
</article>`;
  const url = `${SITE_URL}/week/${wk.date}/`;
  const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: `Week in review — ${wk.label} — ${PODCAST.title}`, description: paragraphs(wk.summary)[0],
    datePublished: wk.generated_at || `${wk.date}T13:00:00Z`, dateModified: wk.generated_at || `${wk.date}T13:00:00Z`, author: ORG, publisher: { ...ORG, logo: { '@type': 'ImageObject', url: `${SITE_URL}/cover.png` } }, image: [`${SITE_URL}/og.png`], mainEntityOfPage: url, isAccessibleForFree: true };
  return layout({ title: `Week in review — ${wk.label} — ${SITE_NAME}`, description: paragraphs(wk.summary)[0], base, body, canonical: url, nav: 'week',
    og: { type: 'article', title: `${PODCAST.title} — week in review, ${wk.label}` }, ld });
}

// ---------- storylines ----------
const STORY_LEDE = 'The arcs that keep going: where each one stands as of its latest update, how that has changed, and what would settle it. Curated, capped at twelve, never deleted.';
function renderStorylineCard(st, base, latest) {
  const moved = st.recent > 0;
  const first = st.current ? paragraphs(st.current.text)[0] : '';
  return `<article class="card card-link story-card status-${esc(st.status)}">
  <div class="eyebrow"><span class="badge status-badge">${esc(STATUS_LABEL[st.status] || st.status)}</span>${moved ? ` · <span class="moved">${st.recent} this week</span>` : ''} · ${st.timeline.length} item${st.timeline.length === 1 ? '' : 's'} across ${st.editions.size} edition${st.editions.size === 1 ? '' : 's'}${st.current ? ` · updated ${esc(shortDate(st.current.date))}` : ''}</div>
  <h2><a href="${base}storylines/${esc(st.id)}/" class="stretch">${esc(st.name)}</a></h2>
  <p class="muted">${esc(st.frame)}</p>
  ${st.current ? `<p>${esc(first)}</p>` : ''}
</article>`;
}
function renderStorylinesIndex(storylines, editions) {
  const base = '../';
  const latest = editions[0] ? editions[0].date : null;
  const open = storylines.filter((st) => st.status === 'live');
  const rest = storylines.length - open.length;
  const body = `<h1>Storylines</h1>
<p class="lede">${esc(STORY_LEDE)}</p>
<section class="editions">${open.map((st) => renderStorylineCard(st, base, latest)).join('\n') || '<p class="muted">No storylines yet.</p>'}</section>
<p class="muted">${rest ? `${rest} storyline${rest === 1 ? '' : 's'} dormant or resolved — ` : ''}<a href="${base}storylines/history/">${rest ? 'see the history' : 'History'}</a>: every storyline there has ever been, with its full record.</p>`;
  return layout({ title: `Storylines — ${SITE_NAME}`, description: STORY_LEDE, base, body, canonical: `${SITE_URL}/storylines/`, nav: 'storylines', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Storylines — ${SITE_NAME}`, url: `${SITE_URL}/storylines/`, publisher: ORG } });
}
function renderStorylinesHistory(storylines, editions) {
  const base = '../../';
  const latest = editions[0] ? editions[0].date : null;
  const groups = ['live', 'dormant', 'resolved'].map((status) => {
    const list = storylines.filter((st) => st.status === status);
    return list.length ? `<h2>${esc(STATUS_LABEL[status])}</h2><section class="editions">${list.map((st) => renderStorylineCard(st, base, latest)).join('\n')}</section>` : '';
  }).join('');
  const body = `<div class="eyebrow"><a href="${base}storylines/">Storylines</a> / history</div>
<h1>Every storyline</h1>
<p class="lede">Nothing is removed. A storyline goes dormant when nothing has been filed under it for a while and resolved when the question it was opened on has been settled; either way its record stays here in full.</p>
${groups}`;
  return layout({ title: `Storyline history — ${SITE_NAME}`, description: 'Every storyline ever opened, including dormant and resolved ones.', base, body, canonical: `${SITE_URL}/storylines/history/`, nav: 'storylines', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Storyline history — ${SITE_NAME}`, url: `${SITE_URL}/storylines/history/`, publisher: ORG } });
}
function renderStorylinePage(st, storylines, editions) {
  const base = '../../';
  const campaign = `storyline-${st.id}`;
  const latest = editions[0] ? editions[0].date : null;
  const current = st.current;
  const history = st.states.slice(0, -1).reverse();
  const timeline = (() => {
    const byDate = new Map();
    for (const t of st.timeline) { if (!byDate.has(t.date)) byDate.set(t.date, []); byDate.get(t.date).push(t); }
    for (const c of st.connections) { if (!byDate.has(c.week.date)) byDate.set(c.week.date, []); byDate.get(c.week.date).push(c); }
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, entries]) => `<section class="section">
  <h3>${esc(longDate(date))}</h3>
  ${entries.map((e) => e.connect ? `<div class="evo evo-connect"><div class="evo-kind">Connection · <a href="${base}week/${e.week.date}/">week in review</a></div><a class="evo-title" href="${base}week/${e.week.date}/#c-${esc(e.connect.id)}">${esc(e.connect.title)}</a><p>${esc(paragraphs(e.connect.explanation)[0] || '')}</p></div>` : renderItem(e.item, base, { date: e.date, section: e.section, campaign })).join('\n')}
</section>`).join('\n');
  })();
  const related = (st.related || []).map((id) => { const r = storylines.find((x) => x.id === id); return r ? `<a class="topic storyline-chip" href="${base}storylines/${esc(id)}/">${esc(r.name)}</a>` : ''; }).join('');
  const topics = (st.topics || []).map((t) => `<a class="topic" href="${base}topics/${esc(t)}/">${esc(topicLabel(t))}</a>`).join('');
  const questions = (st.questions || []).slice().reverse();
  const body = `<article class="edition storyline">
  <header class="edition-header">
    <div class="eyebrow"><a href="${base}storylines/">Storylines</a> / <span class="badge status-badge">${esc(STATUS_LABEL[st.status] || st.status)}</span> · opened ${esc(shortDate(st.opened))}${st.recent ? ` · <span class="moved">${st.recent} this week</span>` : ''} · ${st.timeline.length} item${st.timeline.length === 1 ? '' : 's'} · ${st.states.length} update${st.states.length === 1 ? '' : 's'}</div>
    <h1>${esc(st.name)}</h1>
    <p class="lede">${esc(st.frame)}</p>
    <div class="settle"><strong>What would settle it</strong><p>${esc(st.question)}</p></div>
    ${st.resolved ? `<div class="settle resolved-box"><strong>Resolved ${esc(shortDate(st.resolved.date))}</strong><p>${esc(st.resolved.text)}${st.resolved.url ? ` <a class="src" href="${esc(utm(st.resolved.url, 'web', campaign))}" rel="noopener">source</a>` : ''}</p></div>` : ''}
    <nav class="toc"><a href="#stands">Where this stands</a>${history.length ? `<a href="#changed">How it has changed <span class="count">${history.length}</span></a>` : ''}<a href="#timeline">Timeline <span class="count">${st.timeline.length}</span></a>${(st.figures || []).length ? `<a href="#figures">Figures</a>` : ''}${questions.length ? `<a href="#questions">Open questions <span class="count">${questions.length}</span></a>` : ''}</nav>
  </header>
  <section class="section week" id="stands">
    <h2>Where this stands <span class="muted asof">as of ${current ? esc(longDate(current.date)) : '—'}</span></h2>
    ${current ? paragraphs(current.text).map((p) => `<p>${esc(p)}</p>`).join('') : '<p class="muted">No update yet.</p>'}
    ${current && current.changed ? `<p class="changed"><strong>What changed:</strong> ${esc(current.changed)}</p>` : ''}
  </section>
  ${history.length ? `<section class="section" id="changed">
    <h2>How it has changed</h2>
    <p class="muted">Every earlier "where this stands", kept as written.</p>
    ${history.map((h) => `<details class="snapshot"><summary><strong>${esc(longDate(h.date))}</strong>${h.changed ? ` — ${esc(h.changed)}` : ''}</summary>${paragraphs(h.text).map((p) => `<p>${esc(p)}</p>`).join('')}</details>`).join('')}
  </section>` : ''}
  <section class="section" id="timeline">
    <h2>Timeline</h2>
    <p class="muted">Every item filed under this storyline, newest first, with its sources.</p>
    ${timeline || '<p class="muted">Nothing filed yet.</p>'}
  </section>
  ${(st.figures || []).length ? `<section class="section" id="figures"><h2>Tracked figures</h2><dl class="figures">${st.figures.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((f) => `<div><dt>${esc(f.value)}</dt><dd>${esc(f.label)} <span class="muted">${esc(shortDate(f.date))}</span> <a class="src" href="${esc(utm(f.url, 'web', campaign))}" rel="noopener">${esc(f.source || hostname(f.url))}</a></dd></div>`).join('')}</dl></section>` : ''}
  ${questions.length ? `<section class="section" id="questions"><h2>Open questions</h2>${questions.map((q) => `<article class="item unknown${q.settled ? ' settled' : ''}"><h3>${esc(q.question)}</h3><dl><dt>${q.settled ? 'Settled' : 'What would settle it'}</dt><dd>${q.settled ? `${esc(shortDate(q.settled.date))} — ${esc(q.settled.text)}${q.settled.url ? ` <a class="src" href="${esc(utm(q.settled.url, 'web', campaign))}" rel="noopener">source</a>` : ''}` : esc(q.would_settle)}</dd><dt>Asked</dt><dd>${esc(shortDate(q.date))}</dd></dl></article>`).join('')}</section>` : ''}
  <section class="section"><div class="topics">${related}${topics}</div></section>
  ${renderShare(`${st.name} — where it stands as of ${current ? shortDate(current.date) : shortDate(st.opened)}: ${current ? paragraphs(current.text)[0].split(/(?<=[.!?])\s/)[0] : st.frame}`, `${SITE_URL}/storylines/${st.id}/`)}
  ${renderSubscribe(base)}
</article>`;
  const url = `${SITE_URL}/storylines/${st.id}/`;
  return layout({ title: `${st.name} — Storylines — ${SITE_NAME}`, description: st.frame, base, body, canonical: url, nav: 'storylines',
    og: { type: 'article', title: `${st.name} — ${SITE_NAME}` },
    ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${st.name} — ${SITE_NAME}`, url, description: st.frame, publisher: ORG, dateModified: current ? current.date : st.opened } });
}
// Staging only: an unmistakable banner. Its CSS is inlined here rather than added to the CSS constant, because
// that constant feeds CSS_HASH and touching it would change production's style.css?v= on the next deploy.
function stagingRibbon() {
  return `<style>.staging-ribbon{position:sticky;top:0;z-index:1000;background:#b3261e;color:#fff;text-align:center;padding:6px 12px;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:.04em}</style>
<div class="staging-ribbon" role="status">STAGING PREVIEW · ${esc(new URL(SITE_URL).host)} · not the live site — nothing here is announced</div>
`;
}
// A tiny page that sends old URLs to their new home (GitHub Pages cannot issue redirects).
function renderRedirect(to) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="${esc(to)}"><meta http-equiv="refresh" content="0; url=${esc(to)}"><meta name="robots" content="noindex"></head><body><p>This page has moved to <a href="${esc(to)}">${esc(to)}</a>.</p></body></html>\n`;
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
  <div class="eyebrow">${t.streak > 1 ? `${t.streak}-edition streak · ` : ''}${t.daysInWindow} of the last ${TREND_WINDOW_DAYS} days · ${t.entries.length} items total${t.threads ? ` · ${t.threads} weekly thread${t.threads === 1 ? '' : 's'}` : ''}</div>
  <h2><a href="${base}topics/${esc(t.slug)}/">${esc(t.label)}</a></h2>
  <p class="muted">Latest: <a href="${esc(utm((latest.item.sources || [{}])[0].url || '#', 'web', latest.date))}" rel="noopener">${esc(latest.item.headline)}</a> <span class="count">${esc(shortDate(latest.date))}</span></p>
</article>`;
  }).join('\n');
  const all = [...topics.values()].sort((a, b) => b.dates.size - a.dates.size || b.entries.length - a.entries.length || a.slug.localeCompare(b.slug));
  const rows = all.map((t) => `<tr><td><a href="${base}topics/${esc(t.slug)}/">${esc(t.label)}</a></td><td>${t.dates.size}</td><td>${t.entries.length}</td><td>${t.threads || ''}</td><td>${t.lastSeen ? esc(shortDate(t.lastSeen)) : ''}</td><td>${t.firstSeen ? esc(shortDate(t.firstSeen)) : ''}</td></tr>`).join('');
  const body = `<h1>Topics</h1>
<p class="lede">Every tag, and what keeps showing up. A topic is trending when it appears in at least ${TREND_MIN_DAYS} editions within the last ${TREND_WINDOW_DAYS} days. Each topic page collects every item ever filed under it, newest first — and, where the <a href="${base}week/">week in review</a> has connected it to other developments, how that story has evolved week by week.</p>
<section>${cards || '<p class="muted">Nothing is trending yet — it takes at least two editions.</p>'}</section>
<h2>All topics</h2>
<div class="table-wrap"><table>
<thead><tr><th>Topic</th><th>Editions</th><th>Items</th><th>Weekly threads</th><th>Last seen</th><th>First seen</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`;
  return layout({ title: `Topics — ${SITE_NAME}`, base, body, canonical: `${SITE_URL}/topics/`, nav: 'topics', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Topics — ${SITE_NAME}`, url: `${SITE_URL}/topics/`, publisher: ORG } });
}

function renderTopicPage(t) {
  const base = '../../';
  const byDate = new Map();
  for (const e of t.entries) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
  const groups = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, entries]) => `<section class="section">
  <h2><a href="${base}${date}/">${esc(longDate(date))}</a></h2>
  ${entries.map((e) => renderItem(e.item, base, { section: e.section, campaign: e.date })).join('\n')}
</section>`).join('\n');
  // How this story has evolved: the weekly reviews' connections, developments and open questions carrying this topic, by week.
  let evolution = '';
  if (t.weekly.length) {
    const byWeek = new Map();
    for (const w of t.weekly) { if (!byWeek.has(w.week.date)) byWeek.set(w.week.date, { week: w.week, connect: [], happened: [], unknown: [] }); byWeek.get(w.week.date)[w.kind].push(w.ref); }
    const weeksHtml = [...byWeek.values()].sort((a, b) => (a.week.date < b.week.date ? 1 : -1)).map(({ week, connect, happened, unknown }) => {
      const href = `${base}week/${week.date}/`;
      return `<section class="evo-week">
  <h3><a href="${href}">Week of ${esc(week.label)}</a></h3>
  ${connect.map((c) => `<div class="evo evo-connect"><div class="evo-kind">Connection</div><a class="evo-title" href="${href}#c-${esc(c.id)}">${esc(c.title)}</a><p>${esc(paragraphs(c.explanation)[0] || '')}</p><ul class="linked">${(c.items || []).map((id) => { const h = week.byId.get(id); return h ? `<li><a href="${href}#h-${esc(id)}">${esc(h.headline)}</a></li>` : ''; }).join('')}</ul></div>`).join('')}
  ${happened.map((h) => `<div class="evo evo-happened"><div class="evo-kind">Development · ${esc((h.dates || []).map(shortDate).join(', '))}</div><a class="evo-title" href="${href}#h-${esc(h.id)}">${esc(h.headline)}</a><p>${esc((h.bullets || [])[0] || '')}</p></div>`).join('')}
  ${unknown.map((u) => `<div class="evo evo-unknown"><div class="evo-kind">Open question</div><a class="evo-title" href="${href}#u-${esc(u.id)}">${esc(u.question)}</a><p>${esc(u.evidence_ends || '')}</p></div>`).join('')}
</section>`;
    }).join('\n');
    evolution = `<section class="section evolution" id="evolution">
  <h2>How this story has evolved</h2>
  <p class="muted">From the <a href="${base}week/">week in review</a>: the connections, developments and open questions filed under ${esc(t.label)}, newest week first.</p>
  ${weeksHtml}
</section>`;
  }
  const dailyLine = t.entries.length ? `${t.entries.length} item${t.entries.length === 1 ? '' : 's'} across ${t.dates.size} edition${t.dates.size === 1 ? '' : 's'}${t.streak > 1 ? ` · appeared in the last ${t.streak} editions in a row` : ''}. First seen ${esc(shortDate(t.firstSeen))}, last seen ${esc(shortDate(t.lastSeen))}.` : 'Not yet filed in a daily edition.';
  const body = `<div class="eyebrow"><a href="${base}topics/">Topics</a> / topic</div>
<h1>${esc(t.label)}</h1>
<p class="lede">${dailyLine}${t.weeks.size ? ` Traced across ${t.weeks.size} weekly review${t.weeks.size === 1 ? '' : 's'}.` : ''}</p>
${evolution}
${groups}`;
  return layout({ title: `${t.label} — Topics — ${SITE_NAME}`, description: `${t.entries.length} sourced items about ${t.label} across ${t.dates.size} editions of ${SITE_NAME}.`, base, body, canonical: `${SITE_URL}/topics/${t.slug}/`, nav: 'topics', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${t.label} — ${SITE_NAME}`, url: `${SITE_URL}/topics/${t.slug}/`, publisher: ORG } });
}

// Source count for the About page: rows of the SOURCES.md tables (header/divider rows excluded), rounded down to a ten.
function sourceCount() {
  try {
    const n = fs.readFileSync(path.join(ROOT, 'SOURCES.md'), 'utf8').split('\n').filter((l) => /^\| [^-|]/.test(l) && !/^\| Source /.test(l)).length;
    return Math.floor(n / 10) * 10;
  } catch { return 100; }
}

function renderAbout(editions) {
  const base = '../';
  const latest = editions[0];
  const traceLink = latest && latest.hasTrace ? `${base}${latest.date}/trace/` : `${base}`;
  const body = `<h1>About</h1>
<div class="prose">
<p class="lede">${esc(SITE_NAME)} is a daily, fact-first briefing on frontier AI — the advances, the research, and how the technology is being used, for good and for harm. Cyber operations and influence campaigns, military and defence, health and science, policy and the courts, chips and compute. Every headline links to its source. Nothing is written without one.</p>

<h2>Why this exists</h2>
<p>I'm Mike Shoss. I lead <a href="${esc(utm(PODCAST.presenterUrl, 'web', 'about'))}" rel="noopener">Epilogue</a>, an AI consulting and product studio in Toronto. Part of that job is knowing, every morning, where this technology actually is — so I've long started the day the same way: the lab announcements, the new papers, the threat-intelligence reports, what's landing in defence, health and policy.</p>
<p>It's a job requirement, but it's also a fascination. This is the most powerful technology we've ever had, and every day it's being used to do remarkable good and real harm — often in the same report. What pushed me to publish was <a href="https://www.anthropic.com/threat-intelligence-report-september-2026" rel="noopener">Anthropic's September 2026 threat-intelligence report</a> and the realisation that most people who should know what's in documents like that never will. Not everyone can keep up, or wants to, or has the time. I can, and I felt it was on me to share it where I could.</p>
<p>So this is the briefing I was already making for myself, made public.</p>

<h2>How an edition is made</h2>
<p>Every morning:</p>
<ul>
<li><strong>The sweep.</strong> About ${sourceCount()} sources — labs and their research blogs, arXiv, security vendors' own threat reports, government and regulator sites, court dockets, defence and health press, and the trade and mainstream outlets that cover them. <a href="${REPO_URL}/blob/main/SOURCES.md">The full list is public.</a></li>
<li><strong>The rules.</strong> Primary sources first. Every number quoted exactly as the source wrote it, with its baseline. Every caveat the source raises is stated — company claims, single-source stories, preprints — and flagged as such. If a claim can't be traced to a document that can be opened, it's left out. Opinion without new facts, marketing without numbers, and rumour don't make the cut. <a href="${REPO_URL}/blob/main/PROMPT.md">The editorial rules are public too.</a></li>
<li><strong>The check.</strong> Every link is tested live before publishing; a dead link fails the build.</li>
</ul>
<p>Every Monday a separate <a href="${base}week/">Week in Review</a> steps back: what happened across the week, which developments appear to be part of the same larger shift, and — stated just as carefully — what we don't yet know and what would settle it.</p>

<h2>The role of AI — read this part</h2>
<p>The research, the writing and the voices are produced by AI. Claude does the morning sweep, verifies items against their primary sources and writes each edition; OpenAI's speech models voice the podcast. No person reviews an edition before it goes out.</p>
<p>What makes that trustworthy isn't the model — it's the checks around it, and the fact that you can see everything:</p>
<ul>
<li><strong>Every edition publishes its complete build log</strong> — every page fetched, every search run, every check passed — recorded automatically by the tooling, not written by the AI. Open any edition and click <em>how this edition was made</em>${latest && latest.hasTrace ? ` (<a href="${traceLink}">here's the latest</a>)` : ''}.</li>
<li><strong>The podcast script is mechanically locked to the edition.</strong> Before an episode can be made, a validator rejects any number that doesn't appear in the source item, any missing caveat, any unnamed source, and any speculative or hyped language. If a day's script can't pass, that day is narrated straight from the edition text instead.</li>
<li><strong>Every claim links to its source</strong>, so you never have to take the briefing's word for it.</li>
</ul>
<p>It will still get things wrong sometimes. When it does, tell me: <a href="mailto:${esc(PODCAST.email)}">${esc(PODCAST.email)}</a>. Corrections are made in the open.</p>

<h2>The podcast</h2>
<p><a href="${base}podcast/">${esc(PODCAST.title)}, presented by ${esc(PODCAST.presenter)}</a>, is each day's edition as a 10–15 minute conversation between two hosts, Maya and Alex. They're AI voices, and they say so at the top of every episode. Each episode has a transcript showing exactly which item every part of the conversation came from. Listen on <a href="${esc(PODCAST.listen.Spotify.url)}" rel="noopener">Spotify</a> or add <a href="${base}podcast.xml">the RSS feed</a> to any podcast app.</p>
<p>Each episode's cover is generated from that day's news: every section has a colour — security is red, research violet, military orange, and so on — and the cover mixes them in proportion to how much of the day fell in each.</p>

<h2>Trends</h2>
<p>Every item carries topic tags; <a href="${base}topics/">the Topics page</a> is the index of them, and a topic is marked trending when it keeps appearing across editions. Tags are literal, so the site also keeps <a href="${base}storylines/">Storylines</a>: a small, curated set of arcs — AI-enabled hacking, the push to regulate frontier AI, and so on — each with a dated "where this stands", a record of how that has changed, every item filed under it, and the open questions. The daily edition files items under existing storylines; the Monday Week in Review updates each storyline's state and may propose a new one. Nothing is ever deleted: dormant and resolved storylines move to a history page.</p>

<h2>Who's behind it</h2>
<p><a href="${esc(utm(PODCAST.presenterUrl, 'web', 'about'))}" rel="noopener">Epilogue</a> is an AI consulting and product studio based in Toronto, focused on turning complex business problems into practical, high-impact AI products — built end to end.</p>
<p>Mike Shoss is Epilogue's founder and principal. He ships AI products in industries where being wrong is expensive, advises and mentors AI startups at <a href="https://theforge.mcmaster.ca/" rel="noopener">The Forge</a> and <a href="https://dmz.torontomu.ca/" rel="noopener">DMZ</a>, and is an angel investor in early-stage Canadian AI. He lives in Milton, Ontario. <a href="${esc(CREDITS.url)}" rel="noopener">LinkedIn</a></p>

<h2>Open</h2>
<p>The editions, the source list, and all the code are <a href="${REPO_URL}">on GitHub</a>. The editions are published under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a> — reuse them with a link back. The code is <a href="${REPO_URL}/blob/main/LICENSE">MIT</a>. <a href="${REPO_URL}/blob/main/LICENSE-EDITIONS.md">Full terms.</a></p>
</div>`;
  return layout({ title: `About — ${SITE_NAME}`, description: `Who makes ${SITE_NAME}, how each edition is produced, and what the AI does and doesn't do.`, base, body, canonical: `${SITE_URL}/about/`, nav: 'about',
    ld: { '@context': 'https://schema.org', '@type': 'AboutPage', name: `About — ${SITE_NAME}`, url: `${SITE_URL}/about/`, publisher: ORG, author: { '@type': 'Person', name: CREDITS.name, url: CREDITS.url } } });
}

// A LinkedIn-ready post for the day, generated from the edition so it can say nothing the edition does not:
// one hook sentence from the summary, the lead item of each section as a bullet, the count, and a clean link
// (no UTM — LinkedIn attributes the referral itself and the preview card wants the canonical URL).
function renderLinkedIn(ed) {
  const url = `${SITE_URL}/${ed.date}/`;
  const first = paragraphs(ed.summary)[0] || '';
  const hook = (first.match(/^.*?[.!?](?=\s|$)/) || [first])[0].trim();
  const leads = ed.sections.map((s) => s.items[0]).filter(Boolean).slice(0, 7).map((it) => `• ${it.headline.replace(/\.?$/, '')}`);
  const minutes = ed.audio ? `, plus a ${Math.round(ed.audio.seconds / 60)}-minute podcast episode` : '';
  return [
    `What happened in frontier AI — ${longDate(ed.date)}`,
    '',
    hook,
    '',
    ...leads,
    '',
    `${ed.itemCount} items today, every one linked to its source${minutes}:`,
    url,
  ].join('\n');
}

// The daily email is the LinkedIn post and nothing else: the reader consumes the edition on the site and the
// podcast; the email's job is to make sharing a copy-paste. The post is generated from the edition (renderLinkedIn).
function renderEmail(ed) {
  const post = renderLinkedIn(ed);
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:8px 4px;font-size:15px;line-height:1.5;color:#222">
<div style="white-space:pre-wrap">${esc(post)}</div>
</div>`;
  return { html, text: post, post, subject: `${SITE_NAME} — ${shortDate(ed.date)} ${ed.date.slice(0, 4)}` };
}

// The subscriber edition: fuller than the LinkedIn post, shorter than the page. Sent by scripts/mail.js.
const SUBSCRIBE_URL = process.env.SUBSCRIBE_FORM_URL || '';
// Brevo replaces {{ unsubscribe }} with the opt-out link when it sends a campaign. It only belongs in the two
// files mail.js sends; Mike's own Gmail copies are not campaigns and would show the tag as literal text.
const UNSUB = `<p style="color:#999;font-size:11px;margin:12px 0 0">You are receiving this because you subscribed at <a href="${SITE_URL}/" style="color:#999">aiedgebriefing.com</a>. <a href="{{ unsubscribe }}" style="color:#999">Unsubscribe</a>.</p>`;

function renderReaderEmail(ed) {
  const url = `${SITE_URL}/${ed.date}/?utm_source=email&utm_medium=email&utm_campaign=${ed.date}`;
  const h2 = (t) => `<h2 style="font-size:14px;margin:22px 0 8px;color:#111;text-transform:uppercase;letter-spacing:.04em">${esc(t)}</h2>`;
  const sections = ed.sections.map((s) => {
    const it = s.items[0];
    const first = (it.sources || [])[0];
    const more = s.items.length - 1;
    return `<p style="margin:0 0 14px"><span style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.04em">${esc(s.name)}</span><br><a href="${esc(first ? utm(first.url, 'email', ed.date) : url)}" style="color:#0b57d0;font-weight:600;text-decoration:none">${esc(it.headline)}</a><br><span style="color:#333">${esc((it.bullets || [])[0] || '')}</span>${more ? `<br><a href="${url}#${esc(slugify(s.name))}" style="color:#777;font-size:12px">+ ${more} more in this section</a>` : ''}</p>`;
  }).join('');
  const html = `<meta charset="utf-8"><div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:8px 4px;font-size:15px;line-height:1.5;color:#222">
<p style="color:#777;font-size:12px;margin:0 0 4px">${esc(SITE_NAME)} · every claim links to its source</p>
<h1 style="font-size:22px;margin:0 0 10px">${esc(longDate(ed.date))}</h1>
${paragraphs(ed.summary).map((p) => `<p style="margin:0 0 10px">${esc(p)}</p>`).join('')}
<p style="margin:12px 0 0"><a href="${url}" style="color:#0b57d0;font-weight:600">Read all ${ed.itemCount} items →</a>${ed.audio ? ` · <a href="${url}" style="color:#0b57d0">listen (${Math.round(ed.audio.seconds / 60)} min)</a>` : ''}</p>
${h2('The lead item in each section')}${sections}
<hr style="border:0;border-top:1px solid #ddd;margin:24px 0">
<p style="color:#777;font-size:12px">Written by AI from primary sources, checked mechanically, with the full run log published — <a href="${SITE_URL}/about/" style="color:#777">how it works</a>. <a href="${SITE_URL}/storylines/" style="color:#777">Storylines</a> · <a href="${SITE_URL}/week/" style="color:#777">Week in review</a> · <a href="${SITE_URL}/podcast/" style="color:#777">Podcast</a></p>
${UNSUB}
</div>`;
  return { html, subject: `${SITE_NAME}: ${paragraphs(ed.summary)[0].split(/(?<=[.!?])\s/)[0].slice(0, 110)}` };
}

// forSubscribers = the Brevo campaign: no editorial queue, and an unsubscribe link.
function renderWeekEmail(wk, proposed = [], forSubscribers = false) {
  const url = `${SITE_URL}/week/${wk.date}/`;
  const campaign = `week-${wk.date}`;
  const h2 = (s) => `<h2 style="font-size:15px;margin:22px 0 8px;color:#111;text-transform:uppercase;letter-spacing:.04em">${esc(s)}</h2>`;
  const link = (href, text, bold) => `<a href="${esc(href)}" style="color:#0b57d0;${bold ? 'font-weight:600;' : ''}text-decoration:none">${esc(text)}</a>`;
  const happened = wk.happened.map((it) => {
    const first = (it.sources || [])[0];
    const extra = (it.sources || []).slice(1).map((x) => `<a href="${esc(utm(x.url, 'email', campaign))}" style="color:#555">${esc(x.name || hostname(x.url))}</a>`).join(', ');
    const fl = (it.flags || []).map((f) => `<b style="color:#7a4b00;font-size:11px;text-transform:uppercase;letter-spacing:.04em">[${esc(FLAG_LABELS[f] || f)}]</b> `).join('');
    return `<p style="margin:0 0 12px">${fl}${link(first ? utm(first.url, 'email', campaign) : `${url}#h-${it.id}`, it.headline, true)}${extra ? ` <span style="color:#777;font-size:12px">(also: ${extra})</span>` : ''}<br><span style="color:#333">${esc((it.bullets || [])[0] || '')}</span></p>`;
  }).join('');
  const connects = wk.connects.map((c) => `<p style="margin:0 0 12px">${link(`${url}#c-${c.id}`, c.title, true)}<br><span style="color:#333">${esc(paragraphs(c.explanation)[0] || '')}</span><br><span style="color:#777;font-size:12px">Joins: ${(c.items || []).map((id) => { const h = wk.byId.get(id); return h ? esc(h.headline) : ''; }).filter(Boolean).join(' · ')}</span></p>`).join('');
  const unknowns = wk.unknowns.map((u) => `<p style="margin:0 0 12px">${link(`${url}#u-${u.id}`, u.question, true)}<br><span style="color:#333">${esc(u.evidence_ends)}</span><br><span style="color:#555;font-size:13px"><b>Would confirm:</b> ${esc(u.would_confirm)} <b>Would invalidate:</b> ${esc(u.would_invalidate)}</span></p>`).join('');
  const figures = (wk.figures || []).map((f) => `<p style="margin:0 0 8px"><b>${esc(f.value)}</b> — ${esc(f.label)} <a href="${esc(utm(f.url, 'email', campaign))}" style="color:#555;font-size:12px">${esc(f.source || hostname(f.url))}</a></p>`).join('');
  const calendar = (wk.calendar || []).map((c) => `<p style="margin:0 0 8px"><b>${esc(c.date)}</b> — ${esc(c.event)} <a href="${esc(utm(c.url, 'email', campaign))}" style="color:#555;font-size:12px">${esc(c.source || hostname(c.url))}</a></p>`).join('');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:8px 4px;font-size:15px;line-height:1.5;color:#222">
<p style="color:#777;font-size:12px;margin:0 0 4px">${esc(SITE_NAME)} · Week in review</p>
<h1 style="font-size:22px;margin:0 0 10px">The week of ${esc(wk.label)}</h1>
<p style="margin:0 0 16px"><a href="${url}" style="color:#0b57d0;font-weight:600">Read the full week in review →</a></p>
${paragraphs(wk.summary).map((p) => `<p style="margin:0 0 10px">${esc(p)}</p>`).join('')}
${h2('1 · What happened')}${happened}
${h2('2 · What connects')}${connects}
${h2("3 · What we don't know")}${unknowns}
${figures ? h2('By the numbers') + figures : ''}
${calendar ? h2('On the calendar') + calendar : ''}
${/* The proposed-storyline queue used to render here. It is editorial state: it reached the published
     trace of the run that built this email, which is a page on the public site. It lives on the private
     stats page instead (scripts/stats.js proposedStorylines()). */ ''}
<hr style="border:0;border-top:1px solid #ddd;margin:24px 0">
<p style="color:#777;font-size:12px">Facts, then connections, then what is still open — never opinion. Every claim links to its source. <a href="${url}" style="color:#777">Web version</a> · <a href="${SITE_URL}/topics/" style="color:#777">Trends</a> · <a href="${REPO_URL}" style="color:#777">Data on GitHub</a></p>
${forSubscribers ? UNSUB : ''}
</div>`;
  const text = [
    `${SITE_NAME} - Week in review`, `The week of ${wk.label}`, '', `Full week in review: ${url}`, '',
    ...paragraphs(wk.summary), '',
    '## 1. What happened', ...wk.happened.flatMap((it) => [`- ${it.headline}`, `  ${(it.bullets || [])[0] || ''}`, ...(it.sources || []).map((x) => `  ${utm(x.url, 'email', campaign)}`)]), '',
    '## 2. What connects', ...wk.connects.flatMap((c) => [`- ${c.title}`, `  ${paragraphs(c.explanation)[0] || ''}`, `  ${url}#c-${c.id}`]), '',
    "## 3. What we don't know", ...wk.unknowns.flatMap((u) => [`- ${u.question}`, `  ${u.evidence_ends}`, `  Would confirm: ${u.would_confirm}`, `  Would invalidate: ${u.would_invalidate}`]), '',
    ...((wk.figures || []).length ? ['## By the numbers', ...wk.figures.map((f) => `- ${f.value} — ${f.label} (${f.source || hostname(f.url)})`), ''] : []),
    ...((wk.calendar || []).length ? ['## On the calendar', ...wk.calendar.map((c) => `- ${c.date} — ${c.event} (${c.source || hostname(c.url)})`), ''] : []),
    // (the proposed-storyline queue is on the private stats page, not in any email — see above)
  ].join('\n');
  return { html, text, subject: `${SITE_NAME} — Week in review, ${wk.shortLabel}` };
}

function renderFeed(editions, weeks) {
  const entries = [
    ...editions.map((ed) => ({ key: `${ed.date}-0`, title: longDate(ed.date), link: `${SITE_URL}/${ed.date}/`, pub: dateObj(ed.date), summary: ed.summary })),
    ...weeks.map((wk) => ({ key: `${wk.date}-1`, title: `Week in review — ${wk.label}`, link: `${SITE_URL}/week/${wk.date}/`, pub: new Date(wk.generated_at || `${wk.date}T13:00:00Z`), summary: wk.summary })),
  ].sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, 30);
  const items = entries.map((e) => `<item>
<title>${esc(e.title)}</title>
<link>${e.link}</link>
<guid>${e.link}</guid>
<pubDate>${e.pub.toUTCString()}</pubDate>
<description>${esc(paragraphs(e.summary).join('\n\n'))}</description>
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
.site-header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px 24px;padding-block:16px;flex-wrap:wrap}
.brand{font-weight:700;text-decoration:none;color:var(--fg);letter-spacing:-.01em}
.site-header nav{display:flex;gap:10px 22px;flex-wrap:wrap;align-items:center}
.site-header nav a{color:var(--muted);text-decoration:none;font-size:.92rem}
.site-header nav a:hover{color:var(--accent)}
.site-header nav a.current{color:var(--fg);font-weight:600;border-bottom:2px solid var(--accent);padding-bottom:2px}
main.wrap{padding-block:36px 64px}
h1{font-size:2rem;line-height:1.15;letter-spacing:-.02em;margin:.25em 0 .6em}
h2{font-size:1.25rem;margin:0 0 .7em}
h3{font-size:1.05rem;margin:0 0 .45em;line-height:1.4}
h3 a{color:var(--fg);text-decoration:none;border-bottom:1px solid transparent}
h3 a:hover{border-bottom-color:var(--accent);color:var(--accent)}
.lede{font-size:1.1rem;color:var(--muted);margin:0 0 1.4em;line-height:1.5}
.prose{max-width:46rem;line-height:1.6}.prose h2{margin-top:1.8em}.prose li{margin-bottom:.5em}
.muted{color:var(--muted)}
.eyebrow{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.7em;line-height:1.7}
.badge{display:inline-block;background:var(--badge);color:#fff;border-radius:4px;padding:2px 8px;font-weight:600;letter-spacing:.04em;line-height:1.4;vertical-align:middle}
.summary{font-size:1.08rem;border-left:3px solid var(--accent);padding-left:18px;margin:24px 0;line-height:1.6}
.summary p{margin:0 0 .8em}
.toc{display:flex;flex-wrap:wrap;gap:10px 18px;margin:20px 0 12px;font-size:.9rem}
.toc a{text-decoration:none;color:var(--muted)}
.toc a:hover{color:var(--accent)}
.count{display:inline-block;background:var(--accent-soft);color:var(--accent);border-radius:10px;padding:0 7px;font-size:.75rem;font-weight:600;vertical-align:middle}
.section{margin:48px 0}
.section>h2{padding-bottom:10px;margin-bottom:6px;border-bottom:2px solid var(--fg);text-transform:uppercase;letter-spacing:.06em;font-size:.95rem}
.section>p.muted{margin:0 0 18px}
.item{padding:24px 0;border-bottom:1px solid var(--line)}
.item:last-child{border-bottom:0}
.item ul{margin:10px 0 10px;padding-left:22px}
.item li{margin:6px 0}
.item-meta{font-size:.8rem;color:var(--muted);margin-bottom:8px}
.item-meta a{color:var(--muted)}
.sources{font-size:.82rem;color:var(--muted);margin:2px 0 4px;line-height:1.7}
.sources .src{color:var(--accent);text-decoration:none}
.sources .src:hover{text-decoration:underline}
.sources .sep{margin:0 6px}
.topics{display:flex;flex-wrap:wrap;gap:6px 8px;margin-top:14px}
.topic{font-size:.75rem;text-decoration:none;color:var(--muted);border:1px solid var(--line);border-radius:12px;padding:3px 10px;background:var(--card);line-height:1.4}
.topic:hover{color:var(--accent);border-color:var(--accent)}
.impact{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;vertical-align:2px;margin-left:8px;border-radius:3px;padding:2px 7px;border:1px solid currentColor;white-space:nowrap;line-height:1.3}
.flag{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;vertical-align:2px;margin-left:8px;border-radius:3px;padding:2px 7px;white-space:nowrap;line-height:1.3;background:var(--accent-soft);color:var(--mixed)}
.sub{margin-top:28px;font-size:.9rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.figures{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin:0 0 8px}
.figures div{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.figures dt{font-size:1.4rem;font-weight:700;letter-spacing:-.02em}
.figures dd{margin:2px 0 0;font-size:.85rem;color:var(--muted)}
.calendar{padding-left:20px}.calendar li{margin:6px 0}
.impact-beneficial{color:var(--good)}.impact-harmful{color:var(--bad)}.impact-mixed{color:var(--mixed)}.impact-neutral{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:22px 24px;margin:0 0 20px}
.card .eyebrow{margin-bottom:.5em}
.card h2{margin:.15em 0 .5em}
.card h2 a{color:var(--fg);text-decoration:none}
.card h2 a:hover{color:var(--accent)}
.card-link{position:relative;cursor:pointer;transition:border-color .15s}.card-link:hover{border-color:var(--accent)}.card-link:hover h2 a{color:var(--accent)}
.card-link .stretch::after{content:"";position:absolute;inset:0;border-radius:10px}
.card-link .player,.card-link .topics{position:relative;z-index:1}
.card p{margin:0 0 .8em}
.hero{margin-bottom:32px}
/* The storylines block. Rows, not chips: nine wrapped pills filled a whole phone screen before the
   first edition, and carried a badge that fired on eight of them. A row per arc with its count of
   recent developments ranks itself, and the quieter ones still get named. */
.storylines{padding:14px 16px;background:var(--card);border:1px solid var(--line);border-radius:10px}
.story-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px}
.story-head .label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.story-window{font-size:.72rem;color:var(--muted)}
.story-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:7px 0;text-decoration:none;color:var(--fg);border-bottom:1px solid var(--line)}
.story-row:last-of-type{border-bottom:none}
.story-row:hover .story-name{color:var(--accent)}
.story-name{font-size:.95rem;line-height:1.35}
.story-n{font-variant-numeric:tabular-nums;color:var(--muted);font-size:.9rem;white-space:nowrap}
.story-run{color:var(--accent);margin-left:5px;font-size:.7rem;vertical-align:.15em}
/* The quieter arcs are a different kind of thing from the ranked rows, so they get a rule above them
   and a label with its own shape — without it the block read as one undifferentiated list. */
.story-quiet{margin:12px 0 0;padding-top:12px;border-top:1px solid var(--line);font-size:.82rem;line-height:1.7;color:var(--muted)}
.story-quiet .label{display:inline-block;text-transform:uppercase;letter-spacing:.07em;font-size:.66rem;font-weight:600;color:var(--fg);opacity:.75;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:2px 6px;margin-right:9px;vertical-align:1px}
.story-quiet a{color:var(--muted);text-decoration:none}
.story-quiet a:hover{color:var(--accent)}
.story-quiet .sep{margin:0 6px;opacity:.45}
.story-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:12px 0 0;font-size:.75rem;color:var(--muted)}
.story-foot .more{font-size:.8rem;text-decoration:none;margin-left:auto}
.pager{display:flex;justify-content:space-between;margin-top:48px;padding-top:18px;border-top:1px solid var(--line)}
.pager a{text-decoration:none}
.week{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 26px 18px}
.week-review h2 .num{display:inline-block;min-width:1.6em;height:1.6em;line-height:1.6em;text-align:center;border-radius:50%;background:var(--accent);color:#fff;font-size:.7em;margin-right:.6em;vertical-align:middle}
.connect-list{margin:.2em 0 .6em;padding-left:18px;font-size:.92rem}.connect-list li{margin:3px 0}.connect-list a{text-decoration:none}.connect-list a:hover{text-decoration:underline}
.linked{list-style:none;padding:0;margin:4px 0 12px;display:flex;flex-wrap:wrap;gap:6px 8px}
.linked li a{display:inline-block;font-size:.8rem;text-decoration:none;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:3px 9px;background:var(--bg)}
.linked li a:hover{border-color:var(--accent);color:var(--accent)}
.connect p{margin:.6em 0}
.unknown dl{display:grid;grid-template-columns:minmax(150px,max-content) 1fr;gap:8px 16px;margin:.6em 0 0;font-size:.95rem}
.unknown dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding-top:2px}.unknown dd{margin:0}
@media (max-width:560px){.unknown dl{grid-template-columns:1fr}.unknown dd{margin-bottom:6px}}
.week-card{border-left:4px solid var(--accent)}
.menu{position:relative;display:inline-flex;align-items:center;gap:2px}
.menu .caret{background:none;border:0;padding:4px 3px;margin:0;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;line-height:1}.menu .caret:hover,.menu:hover .caret{color:var(--accent)}
.menu-list{display:none;position:absolute;top:100%;left:-8px;padding-top:6px;z-index:20}
.menu-list>a{display:block}
.menu:hover .menu-list,.menu.open .menu-list,.menu:focus-within .menu-list{display:block}
.menu-list-inner{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px;min-width:150px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.site-header nav .menu-list a{display:block;padding:7px 12px;border-radius:6px;border-bottom:0;font-size:.92rem}.site-header nav .menu-list a:hover{background:var(--accent-soft);color:var(--fg)}
.site-header nav .menu-list a.current{background:var(--accent-soft);border-bottom:0;padding-bottom:7px}
.menu.current-group>a{color:var(--fg)}
@media (hover:none){.menu:hover .menu-list{display:none}.menu.open .menu-list{display:block}}
.storyline-chip{border-color:var(--accent);color:var(--accent);font-weight:600}.storyline-chip::before{content:"⟶ ";opacity:.7}
.status-badge{background:var(--accent)}.status-proposed .status-badge{background:var(--mixed);color:#111}.status-dormant .status-badge{background:var(--muted)}.status-resolved .status-badge{background:var(--good);color:#111}
.moved{color:var(--good);font-weight:600}
.settle{border:1px solid var(--line);border-left:4px solid var(--mixed);border-radius:8px;padding:12px 16px;margin:18px 0}.settle p{margin:.3em 0 0}.resolved-box{border-left-color:var(--good)}
.asof{font-size:.85rem;font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px}
.changed{border-top:1px solid var(--line);padding-top:10px;margin-top:14px}
.snapshot{border:1px solid var(--line);border-radius:8px;padding:8px 14px;margin:10px 0}.snapshot summary{cursor:pointer}.snapshot p{margin:.6em 0}
.unknown.settled h3{color:var(--muted)}
.evolution{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 26px 18px}
.evo-week h3{margin:1.2em 0 .4em;font-size:1rem}.evo-week h3 a{color:var(--fg);text-decoration:none}.evo-week h3 a:hover{color:var(--accent)}
.evo{border-left:3px solid var(--line);padding:2px 0 2px 14px;margin:10px 0}.evo-connect{border-left-color:var(--accent)}.evo-unknown{border-left-color:var(--mixed)}
.evo-kind{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.evo-title{font-weight:600;color:var(--fg);text-decoration:none}.evo-title:hover{color:var(--accent)}
.evo p{margin:.3em 0;font-size:.92rem;color:var(--muted)}
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
.player{margin:18px 0 10px;display:flex;gap:14px;align-items:flex-start}.player .art{width:140px;height:140px;border-radius:8px;flex:0 0 auto}.player-body{min-width:0;flex:1}
.p-controls{display:flex;align-items:center;gap:12px;max-width:560px;background:var(--card);border:1px solid var(--line);border-radius:28px;padding:8px 16px 8px 8px}
.pp{width:36px;height:36px;border-radius:50%;border:0;background:var(--accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;padding:0}.pp:hover{filter:brightness(1.1)}
.pp .i-pause{display:none}.playing .pp .i-play{display:none}.playing .pp .i-pause{display:block}
.p-bar{flex:1;height:6px;background:var(--line);border-radius:3px;cursor:pointer;position:relative;overflow:hidden}.p-fill{height:100%;width:0;background:var(--accent);border-radius:3px}
.p-time{font-size:.8rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.player.compact .p-controls{max-width:420px;padding:6px 12px 6px 6px}.player.compact .pp{width:30px;height:30px}
.read-link{font-size:.85rem;font-weight:400;margin-left:10px;color:var(--accent)!important;text-decoration:none;white-space:nowrap}.read-link:hover{text-decoration:underline}
body.has-player{padding-bottom:84px}
#now-playing{position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--card);border-top:1px solid var(--line);box-shadow:0 -6px 24px rgba(0,0,0,.25)}
.np-wrap{max-width:820px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:14px}
.np-cover img{display:block;width:44px;height:44px;border-radius:6px}.np-main{flex:1;min-width:0}
.np-title{display:block;font-size:.85rem;font-weight:600;color:var(--fg);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}.np-title:hover{color:var(--accent)}
.np-controls{display:flex;align-items:center;gap:10px}
.np-pp{width:32px;height:32px;border-radius:50%;border:0;background:var(--accent);color:#fff;cursor:pointer;flex:0 0 auto;position:relative}.np-pp::before{content:"";position:absolute;left:12px;top:9px;border-left:11px solid #fff;border-top:7px solid transparent;border-bottom:7px solid transparent}
#now-playing.playing .np-pp::before{left:10px;top:9px;width:4px;height:14px;border:0;border-left:4px solid #fff;border-right:4px solid #fff}
.np-back,.np-fwd{background:none;border:1px solid var(--line);color:var(--muted);border-radius:12px;padding:2px 8px;font-size:.72rem;cursor:pointer}.np-back:hover,.np-fwd:hover{color:var(--fg);border-color:var(--fg)}
.np-bar{flex:1;height:6px;background:var(--line);border-radius:3px;cursor:pointer;overflow:hidden}.np-fill{height:100%;width:0;background:var(--accent)}
.np-time{font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.np-actions{display:flex;align-items:center;gap:8px}
.np-spotify{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;text-decoration:none;color:var(--fg);border:1px solid var(--line);border-radius:16px;padding:5px 11px;white-space:nowrap}.np-spotify:hover{border-color:#1db954;color:#1db954}
.np-close{background:none;border:0;color:var(--muted);font-size:1.3rem;line-height:1;cursor:pointer;padding:4px 6px}.np-close:hover{color:var(--fg)}
@media (max-width:640px){.np-back,.np-fwd,.np-spotify span{display:none}.np-spotify{padding:6px}.np-cover{display:none}}
.spectrum{display:flex;gap:3px;height:8px;margin:10px 0 6px;max-width:560px}.spectrum span{display:block;border-radius:4px;min-width:4px}
.spectrum-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.78rem;color:var(--muted);margin-bottom:8px}.spectrum-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;vertical-align:1px}
.versions{margin-top:10px}.versions summary{cursor:pointer;font-size:.85rem;color:var(--muted)}.version{padding:10px 0;border-top:1px solid var(--line)}.version audio{width:100%;max-width:560px;display:block;margin-top:4px}
.listen{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}.listen-label{font-size:.85rem;color:var(--muted);margin-right:4px}
.badge-listen{display:inline-flex;align-items:center;gap:7px;text-decoration:none;color:var(--fg);border:1px solid var(--line);background:var(--card);border-radius:20px;padding:4px 12px 4px 6px;font-size:.88rem}.badge-listen:hover{border-color:var(--accent)}
.podcast-hero{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;margin-bottom:20px}.podcast-hero img{width:180px;height:180px;border-radius:12px;flex:0 0 auto}.podcast-hero>div{flex:1 1 300px;min-width:0}.podcast-hero h1{margin-top:0}
.player-meta{font-size:.8rem;color:var(--muted);margin-top:4px}
.notes{margin-top:14px}.notes-text{color:var(--muted);font-size:.95rem;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.notes-text p{margin:0 0 .7em}.notes.open .notes-text{display:block;-webkit-line-clamp:unset;overflow:visible}
.notes-more{background:none;border:0;padding:4px 0 0;margin:0;color:var(--accent);font:inherit;font-size:.85rem;cursor:pointer}.notes-more:hover{text-decoration:underline}
.feed{display:block;word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px 10px;font-size:.9rem}
.script-block{padding:14px 0;border-bottom:1px solid var(--line)}.script-ref{font-size:.8rem;color:var(--muted);margin-bottom:8px}
.line{display:flex;gap:12px;margin:6px 0}.line .who{flex:0 0 64px;font-weight:600;font-size:.85rem;color:var(--accent)}
.script-section{font-weight:600;margin-top:1.4em}
.share{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:28px 0 0;font-size:.85rem}.share-label{color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-size:.72rem;margin-right:4px}
.share a,.share-copy{text-decoration:none;color:var(--fg);border:1px solid var(--line);background:var(--card);border-radius:14px;padding:4px 12px;font:inherit;font-size:.85rem;cursor:pointer}.share a:hover,.share-copy:hover{border-color:var(--accent);color:var(--accent)}.share-copy.done{border-color:var(--good);color:var(--good)}
.subscribe{margin:28px 0 8px;padding:16px 18px;background:var(--card);border:1px solid var(--line);border-radius:10px}
.subscribe.hero{margin:16px 0 0}.subscribe.footer{margin:0 0 22px}
.subscribe-text{margin-bottom:10px;font-size:.95rem}.subscribe.footer .subscribe-text{font-size:.88rem}
.subscribe-row{display:flex;gap:8px;flex-wrap:wrap}.subscribe input[type=email]{flex:1 1 220px;min-width:0;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;font-size:.95rem}
.subscribe input[type=email]:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.subscribe button{padding:9px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}.subscribe button:hover{filter:brightness(1.1)}
.hp{position:absolute;left:-9999px}
.site-footer{border-top:1px solid var(--line);color:var(--muted);font-size:.85rem;padding-block:28px 36px;line-height:1.7}
.site-footer p{margin:0 0 .6em}
@media (max-width:520px){h1{font-size:1.6rem}main{padding-block:20px 36px}
.storylines{padding:12px 14px}.story-name{font-size:.9rem}.story-row{padding:6px 0}
.story-head{flex-wrap:wrap;gap:2px 10px}.story-foot{flex-wrap:wrap;gap:4px 10px}}
`;


// ---------- podcast ----------
const PLATFORM_ICONS = {
  // Spotify mark: green disc with three arcs.
  Spotify: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1DB954"/><path d="M6.2 9.3c3.9-1.2 8.3-.8 11.7 1.1" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round"/><path d="M6.8 12.5c3.2-1 6.9-.6 9.8.9" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round"/><path d="M7.3 15.5c2.6-.8 5.5-.5 7.9.7" fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  RSS: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect width="24" height="24" rx="5" fill="#f26522"/><circle cx="7" cy="17" r="2" fill="#fff"/><path d="M5 10a9 9 0 0 1 9 9M5 5a14 14 0 0 1 14 14" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`,
};
const AUDIO_INDEX = path.join(ROOT, 'audio', 'index.json');
let AUDIO_VERSIONS = {};
function loadAudio() {
  try { const idx = JSON.parse(fs.readFileSync(AUDIO_INDEX, 'utf8')); AUDIO_VERSIONS = idx.versions || {}; return idx.episodes || {}; } catch { return {}; }
}
const mmss = (sec) => { const m = Math.floor(sec / 60), s2 = sec % 60; return `${m}:${String(s2).padStart(2, '0')}`; };
const hhmmss = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

function renderSpectrum(ed, withLegend) {
  const w = sectionWeights(ed);
  if (!w.length) return '';
  const bar = `<div class="spectrum" role="img" aria-label="${esc(w.map((x) => `${x.short} ${Math.round(x.share * 100)}%`).join(', '))}">${w.map((x) => `<span style="flex:${x.share.toFixed(4)};background:${x.hex}" title="${esc(x.name)}: ${x.count}"></span>`).join('')}</div>`;
  return withLegend ? `${bar}<div class="spectrum-legend">${w.map((x) => `<span><i style="background:${x.hex}"></i>${esc(x.short)} ${Math.round(x.share * 100)}%</span>`).join('')}</div>` : bar;
}

// "Maya & Alex" from the episode's voices map ({A: "Maya (marin)", B: "Alex (cedar)"}); narration → "Narrated".
const hostsLabel = (ep) => ep.format === 'dialogue' && ep.voices ? Object.values(ep.voices).map((v) => String(v).replace(/\s*\(.*\)\s*$/, '')).join(' & ') : 'Narrated';

// date -> Spotify episode id (audio/spotify.json, kept by scripts/spotify.js) for "continue in Spotify" deep links.
let SPOTIFY = {};
try { SPOTIFY = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio', 'spotify.json'), 'utf8')); } catch { /* none yet */ }
const spotifyUrl = (date) => (SPOTIFY[date] ? `https://open.spotify.com/episode/${SPOTIFY[date]}` : '');

// The site player: markup only — scripts/player.js drives one shared audio element and the bottom bar.
// The duration is written in from the index so the control never reads 0:00 before it is touched.
function renderPlayer(ep, base, ed, compact) {
  if (!ep) return '';
  const label = `${hostsLabel(ep)} · ${mmss(ep.seconds)}`;
  const art = ep.image && !compact ? `<img class="art" src="${esc(ep.image)}" alt="Episode cover" width="140" height="140" loading="lazy">` : '';
  const date = ed ? ed.date : '';
  const title = ed ? longDate(ed.date) : PODCAST.title;
  return `<div class="player${compact ? ' compact' : ''}" data-src="${esc(op3(ep.url))}" data-title="${esc(title)}" data-date="${esc(date)}" data-seconds="${ep.seconds}" data-cover="${esc(ep.image || '')}" data-href="${esc(base + (date ? date + '/' : 'podcast/'))}" data-spotify="${esc(spotifyUrl(date))}">${art}<div class="player-body">
  <div class="p-controls"><button class="pp" type="button" aria-label="Play"><svg class="i-play" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg><svg class="i-pause" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor"/></svg></button><div class="p-bar" role="slider" aria-label="Position"><div class="p-fill"></div></div><span class="p-time">0:00 / ${mmss(ep.seconds)}</span></div>
  <div class="player-meta">${esc(PODCAST.title)} · ${esc(label)}${!compact && ed ? ` · <a href="${base}${ed.date}/script/">read the transcript</a> · <a href="${base}podcast/">subscribe</a>` : ''}${!compact && spotifyUrl(date) ? ` · <a href="${esc(spotifyUrl(date))}" rel="noopener" target="_blank">open in Spotify</a>` : ''}</div>
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
      const ref = b.type === 'item' ? `<div class="script-ref">${esc(b.section || '')} — <a href="${base}${ed.date}/#${esc(slugify(b.section || ''))}">${esc(b.headline)}</a></div>` : `<div class="script-ref muted">${esc(b.type.charAt(0).toUpperCase() + b.type.slice(1))}</div>`;
      const lines = b.lines.map((l) => `<div class="line"><span class="who">${esc((hosts[l.host] || {}).name || l.host)}</span><span>${esc(l.text)}</span></div>`).join('');
      return `<section class="script-block">${ref}${lines}</section>`;
    }).join('\n');
    body = `<p class="lede">${Object.values(hosts).map((h) => esc(h.name)).join(' and ')} are AI voices. Each part of the conversation below comes from one item in the written edition — linked above it — and is checked automatically before publishing: every number must appear in that item, every caveat the edition raises must be said aloud, the source must be named, and speculative or hyped language is rejected.</p>${blocks}`;
  } else {
    const n = narrationFor(ed);
    body = `<p class="lede">A single AI narrator reads this edition. The text is assembled directly from the written edition — the summary, then each item's headline, key fact and caveats — so it cannot say anything the edition does not.</p>` +
      n.lines.map((l) => `<p${l.section ? ' class="script-section"' : ''}>${esc(l.text)}</p>`).join('');
  }
  const page = `<div class="eyebrow"><a href="${base}${ed.date}/">${esc(longDate(ed.date))}</a> / transcript</div>
<h1>Transcript — ${esc(shortDate(ed.date))}</h1>
${renderPlayer(ep, base, ed, false)}
${body}`;
  return layout({ title: `Transcript — ${shortDate(ed.date)} — ${SITE_NAME}`, base, body: page, canonical: `${SITE_URL}/${ed.date}/script/`, nav: 'podcast' });
}

function renderPodcastPage(editions, audio) {
  const base = '../';
  const feed = `${SITE_URL}/podcast.xml`;
  const eps = editions.filter((ed) => audio[ed.date]).map((ed) => {
    const versions = AUDIO_VERSIONS[ed.date] || [];
    const older = versions.length > 1 && process.env.SHOW_VERSIONS ? `<details class="versions"><summary>${versions.length} versions — earlier ones kept for comparison</summary>${[...versions].reverse().map((v) => `<div class="version"><div class="eyebrow">${esc(v.label)} · ${esc(hostsLabel(v))} · ${mmss(v.seconds)} · ${esc(new Date(v.generated_at).toUTCString().slice(0, 22))}${v.url === audio[ed.date].url ? ' · <b>in the feed</b>' : ''}</div><audio controls preload="none" src="${esc(v.url)}"></audio></div>`).join('')}</details>` : '';
    // Episode notes: the edition summary, clamped to a few lines with a "more" toggle (the same text the feed carries).
    const notes = paragraphs(ed.summary).map((p) => `<p>${esc(p)}</p>`).join('');
    return `<article class="card episode">
  <div class="eyebrow">${esc(shortDate(ed.date))} · ${esc(hostsLabel(audio[ed.date]))} · ${mmss(audio[ed.date].seconds)} · ${ed.itemCount} items</div>
  <h2><a href="${base}${ed.date}/">${esc(longDate(ed.date))}</a> <a class="read-link" href="${base}${ed.date}/">Read the edition →</a></h2>
  ${renderSpectrum(ed, false)}
  ${renderPlayer(audio[ed.date], base, ed, false)}
  <div class="notes"><div class="notes-text">${notes}</div><button class="notes-more" type="button" aria-expanded="false">More</button></div>
  ${older}
</article>`;
  }).join('\n');
  const legend = Object.entries(SECTION_COLORS).map(([name, c]) => `<span><i style="background:${c.hex}"></i>${esc(name)} <span class="muted">${esc(c.name)}</span></span>`).join('');
  const badges = [...Object.entries(PODCAST.listen || {}).map(([k, v]) => `<a class="badge-listen" href="${esc(v.url)}" rel="noopener">${PLATFORM_ICONS[k] || ''}<span>${esc(v.label || k)}</span></a>`),
    `<a class="badge-listen" href="${base}podcast.xml" title="Podcast RSS feed">${PLATFORM_ICONS.RSS}<span>RSS</span></a>`].join('');
  const body = `<div class="podcast-hero"><img src="${base}cover.png" alt="${esc(PODCAST.title)} cover" width="180" height="180"><div>
<h1>${esc(PODCAST.title)}</h1>
<p class="lede">Presented by ${esc(PODCAST.presenter)}. Every edition as an episode, ready when the morning edition is.</p>
<div class="listen"><span class="listen-label">You can also listen here</span>${badges}</div></div></div>
<div class="card">
  <p><b>Episode covers are coloured by the news.</b> Each section has a fixed colour; a day's cover mixes them in proportion to how many items fell in each section, with the exact shares shown as a bar along the bottom.</p>
  <div class="spectrum-legend">${legend}</div>
</div>
${eps || '<p class="muted">No episodes yet.</p>'}`;
  return layout({ title: `${PODCAST.title} — Podcast — ${SITE_NAME}`, description: `${PODCAST.title}, presented by ${PODCAST.presenter}: every edition of ${SITE_NAME} as a daily episode.`, base, body, canonical: `${SITE_URL}/podcast/`, nav: 'podcast',
    og: { title: `${PODCAST.title} — daily podcast`, imageAlt: `${PODCAST.title}, presented by ${PODCAST.presenter}` },
    ld: { '@context': 'https://schema.org', '@type': 'PodcastSeries', name: PODCAST.title, url: `${SITE_URL}/podcast/`, webFeed: feed, image: `${SITE_URL}/cover.png`, description: `${PODCAST.tagline}. Presented by ${PODCAST.presenter}.`, author: ORG, sameAs: Object.values(PODCAST.listen || {}).map((v) => v.url) } });
}

function renderPodcastFeed(editions, audio) {
  const items = editions.filter((ed) => audio[ed.date]).slice(0, 60).map((ed) => {
    const ep = audio[ed.date];
    const desc = paragraphs(ed.summary).join('\n\n');
    return `<item>
<title>${esc(longDate(ed.date))}</title>
<itunes:title>${esc(longDate(ed.date))}</itunes:title>
<link>${SITE_URL}/${ed.date}/</link>
<guid isPermaLink="false">ainews-${ed.date}</guid>
<pubDate>${new Date(ep.generated_at || ed.date + 'T12:00:00Z').toUTCString()}</pubDate>
<description>${esc(desc)}</description>
<itunes:summary>${esc(desc)}</itunes:summary>
<itunes:duration>${hhmmss(ep.seconds)}</itunes:duration>
${ep.image ? `<itunes:image href="${esc(ep.image)}"/>` : ''}
<itunes:explicit>false</itunes:explicit>
<itunes:episodeType>full</itunes:episodeType>
<itunes:author>${esc(PODCAST.author)}</itunes:author>
<enclosure url="${esc(op3(ep.url))}" length="${ep.bytes}" type="audio/mpeg"/>
<podcast:transcript url="${SITE_URL}/${ed.date}/script/" type="text/html"/>
</item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
<title>${esc(PODCAST.title)}</title>
<link>${SITE_URL}/podcast/</link>
<atom:link href="${SITE_URL}/podcast.xml" rel="self" type="application/rss+xml"/>
<podcast:guid>${podcastGuid()}</podcast:guid>
<language>en</language>
<description>${esc(PODCAST.title)}, presented by ${esc(PODCAST.presenter)}. ${esc(SITE_TAGLINE)} Each episode is voiced by AI from the written edition; every claim links to its source on the site.</description>
<itunes:author>${esc(PODCAST.author)}</itunes:author>
<itunes:owner><itunes:name>${esc(PODCAST.author)}</itunes:name><itunes:email>${esc(PODCAST.email)}</itunes:email></itunes:owner>
<managingEditor>${esc(PODCAST.email)} (${esc(PODCAST.author)})</managingEditor>
<itunes:subtitle>${esc(PODCAST.tagline)}</itunes:subtitle>
<itunes:type>episodic</itunes:type>
<copyright>© ${new Date().getUTCFullYear()} ${esc(PODCAST.presenter)}</copyright>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
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

// page = { base, backHref, backLabel, title, canonical, nav }
function renderTracePage(page, trace) {
  const base = page.base;
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
    if (r.kind === 'SessionStart') return `<div class="tr tr-sys"><span class="tt">${hhmmss(r.t)}</span><div><div class="tl">Session start</div><div class="tx muted">${e.model ? esc(e.model) : 'Claude'}</div></div></div>`;
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
  const html = `<div class="eyebrow"><a href="${page.backHref}">${esc(page.backLabel)}</a> / trace</div>
<h1>Run trace — ${esc(page.title)}</h1>
<p class="lede">How this edition was made, step by step: every page the AI fetched, every search it ran, every file it wrote and every check it passed, with the responses it got back. This log is recorded automatically by the tooling around the AI — it is not written by the AI — so it is a faithful record, not a summary.</p>
${stats}
<p class="muted">Raw files: <a href="events.jsonl">events.jsonl</a>${trace.hasTranscript ? ` · <a href="transcript.jsonl">transcript.jsonl</a> (the complete session)` : ''}. Times are UTC. Long responses are shortened on this page but complete in the raw files.</p>
<div class="trace">${body}</div>`;
  return layout({ title: `Trace — ${page.title} — ${SITE_NAME}`, base, body: html, canonical: page.canonical, nav: page.nav });
}

// ---------- main ----------
function main() {
  const editions = loadEditions();
  const weeks = loadWeeks();
  const allStorylines = loadStorylines(editions, weeks);
  // Proposed storylines are an editorial state, not content: they never appear on the public site. They are surfaced
  // to the editor in the Monday email and the private stats page until promoted to live (or renamed/merged).
  const storylines = allStorylines.filter((st) => st.status !== 'proposed');
  const proposed = allStorylines.filter((st) => st.status === 'proposed');
  STORY_BY_ID = new Map(storylines.map((st) => [st.id, st]));
  const { topics, trending } = buildTopicIndex(editions, weeks);

  if (process.argv.includes('--storylines')) {
    for (const st of allStorylines) console.log(`${st.id}\t${st.status}\t${st.name}\t${st.frame}`);
    return;
  }
  const audio = loadAudio();
  for (const ed of editions) ed.audio = audio[ed.date] || null;

  if (process.argv.includes('--topics')) {
    const all = [...topics.values()].sort((a, b) => b.entries.length - a.entries.length || a.slug.localeCompare(b.slug));
    for (const t of all) console.log(`${t.slug}\t${t.entries.length} items\t${t.dates.size} editions\t${t.threads} weekly threads\tlast ${t.lastSeen || '—'}`);
    return;
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  write('.nojekyll', '');
  write('style.css', CSS.trim() + '\n');
  write('player.js', PLAYER_JS);
  if (process.env.INDEXNOW_KEY && !STAGING) write(`${process.env.INDEXNOW_KEY}.txt`, process.env.INDEXNOW_KEY);
  // Cloudflare Pages honours _headers; this keeps images, json and txt out of search too, not just the html.
  if (STAGING) write('_headers', '/*\n  X-Robots-Tag: noindex, nofollow\n');
  write('index.html', renderHome(editions, weeks, storylines));
  write('daily/index.html', renderEditionsIndex(editions));
  write('week/index.html', renderWeekIndex(weeks));
  write('storylines/index.html', renderStorylinesIndex(storylines, editions));
  write('storylines/history/index.html', renderStorylinesHistory(storylines, editions));
  for (const st of storylines) write(`storylines/${st.id}/index.html`, renderStorylinePage(st, storylines, editions));
  // Old URLs: /trends/… became /topics/…, /editions/ became /daily/.
  write('trends/index.html', renderRedirect(`${SITE_URL}/topics/`));
  for (const t of topics.values()) write(`trends/${t.slug}/index.html`, renderRedirect(`${SITE_URL}/topics/${t.slug}/`));
  write('editions/index.html', renderRedirect(`${SITE_URL}/daily/`));
  if (!STAGING) write('feed.xml', renderFeed(editions, weeks));
  write('topics/index.html', renderTrendsIndex(topics, trending, editions));
  write('podcast/index.html', renderPodcastPage(editions, audio));
  if (!STAGING) write('podcast.xml', renderPodcastFeed(editions, audio));   // a preview feed would carry the real podcast:guid
  for (const t of topics.values()) write(`topics/${t.slug}/index.html`, renderTopicPage(t));
  editions.forEach((ed, i) => {
    const trace = loadTrace(ed.date);
    ed.hasTrace = !!trace;
    const localCover = path.join(ROOT, 'audio', `${ed.date}.png`), localWide = path.join(ROOT, 'audio', `${ed.date}-og.png`);
    fs.mkdirSync(path.join(OUT_DIR, ed.date), { recursive: true });
    if (fs.existsSync(localCover)) { fs.copyFileSync(localCover, path.join(OUT_DIR, ed.date, 'cover.png')); ed.coverUrl = `${SITE_URL}/${ed.date}/cover.png`; }
    else if (ed.audio && ed.audio.image) ed.coverUrl = ed.audio.image;
    if (fs.existsSync(localWide)) { fs.copyFileSync(localWide, path.join(OUT_DIR, ed.date, 'og.png')); ed.ogUrl = `${SITE_URL}/${ed.date}/og.png`; }
    else if (ed.audio && ed.audio.og) ed.ogUrl = ed.audio.og;
    write(`${ed.date}/index.html`, renderEditionPage(ed, editions, i));
    const sc = loadScript(ed.date);
    if (ed.audio || sc) write(`${ed.date}/script/index.html`, renderScriptPage(ed, sc, ed.audio));
    if (trace) {
      write(`${ed.date}/trace/index.html`, renderTracePage({ base: '../../', backHref: `../../${ed.date}/`, backLabel: longDate(ed.date), title: shortDate(ed.date), canonical: `${SITE_URL}/${ed.date}/trace/`, nav: 'editions' }, trace));
      fs.copyFileSync(path.join(TRACE_DIR, `${ed.date}.jsonl`), path.join(OUT_DIR, ed.date, 'trace', 'events.jsonl'));
      if (trace.hasTranscript) fs.copyFileSync(path.join(TRACE_DIR, `${ed.date}.transcript.jsonl`), path.join(OUT_DIR, ed.date, 'trace', 'transcript.jsonl'));
    }
    const em = renderEmail(ed);
    write(`email/${ed.date}.html`, em.html);
    write(`email/${ed.date}.txt`, em.text);
    write(`email/${ed.date}.subject.txt`, em.subject + '\n');
    write(`email/${ed.date}.linkedin.txt`, em.post + '\n');
    const rd = renderReaderEmail(ed);
    write(`email/${ed.date}.reader.html`, rd.html);
    write(`email/${ed.date}.reader.subject.txt`, rd.subject + '\n');
  });
  weeks.forEach((wk, i) => {
    const trace = loadTrace(`${wk.date}.week`);
    wk.hasTrace = !!trace;
    write(`week/${wk.date}/index.html`, renderWeekPage(wk, weeks, i));
    if (trace) {
      write(`week/${wk.date}/trace/index.html`, renderTracePage({ base: '../../../', backHref: `../../../week/${wk.date}/`, backLabel: `Week in review — ${wk.label}`, title: `week of ${wk.shortLabel}`, canonical: `${SITE_URL}/week/${wk.date}/trace/`, nav: 'week' }, trace));
      fs.copyFileSync(path.join(TRACE_DIR, `${wk.date}.week.jsonl`), path.join(OUT_DIR, 'week', wk.date, 'trace', 'events.jsonl'));
      if (trace.hasTranscript) fs.copyFileSync(path.join(TRACE_DIR, `${wk.date}.week.transcript.jsonl`), path.join(OUT_DIR, 'week', wk.date, 'trace', 'transcript.jsonl'));
    }
    // Two weekly emails: Mike's carries the proposed-storyline queue, the subscribers' never does.
    const em = renderWeekEmail(wk, proposed);
    write(`email/${wk.date}.week.html`, em.html);
    write(`email/${wk.date}.week.txt`, em.text);
    write(`email/${wk.date}.week.subject.txt`, em.subject + '\n');
    const wrd = renderWeekEmail(wk, [], true);
    write(`email/${wk.date}.week.reader.html`, wrd.html);
    write(`email/${wk.date}.week.reader.subject.txt`, wrd.subject + '\n');
  });
  write('about/index.html', renderAbout(editions));
  const urls = [`${SITE_URL}/`, `${SITE_URL}/daily/`, `${SITE_URL}/week/`, `${SITE_URL}/storylines/`, `${SITE_URL}/storylines/history/`, `${SITE_URL}/topics/`, `${SITE_URL}/podcast/`, `${SITE_URL}/about/`,
    ...editions.flatMap((ed) => [`${SITE_URL}/${ed.date}/`, ...(ed.audio || loadScript(ed.date) ? [`${SITE_URL}/${ed.date}/script/`] : []), ...(ed.hasTrace ? [`${SITE_URL}/${ed.date}/trace/`] : [])]),
    ...weeks.flatMap((wk) => [`${SITE_URL}/week/${wk.date}/`, ...(wk.hasTrace ? [`${SITE_URL}/week/${wk.date}/trace/`] : [])]),
    ...storylines.map((st) => `${SITE_URL}/storylines/${st.id}/`),
    ...[...topics.keys()].map((t) => `${SITE_URL}/topics/${t}/`)];
  const lastmod = editions[0] ? editions[0].date : new Date().toISOString().slice(0, 10);
  if (!STAGING) write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u)}</loc><lastmod>${/\/(\d{4}-\d{2}-\d{2})\//.exec(u) ? RegExp.$1 : lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  write('robots.txt', STAGING ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  write('site.webmanifest', JSON.stringify({ name: SITE_NAME, short_name: PODCAST.title, start_url: './', display: 'standalone', background_color: '#121212', theme_color: '#121212', icons: [{ src: 'favicon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' }] }, null, 2));
  write('topics.json', JSON.stringify([...topics.values()].map((t) => ({ slug: t.slug, label: t.label, editions: t.dates.size, items: t.entries.length, weeks: t.weeks.size, threads: t.threads, lastSeen: t.lastSeen })), null, 2));
  console.log(`Built ${editions.length} edition(s), ${weeks.length} week(s), ${storylines.length} storyline(s), ${topics.size} topic(s), ${trending.length} trending, ${Object.keys(audio).length} episode(s) → ${path.relative(ROOT, OUT_DIR)}/ [${SITE_ENV}]`);
}

if (require.main === module) main();

module.exports = { longDate, shortDate, paragraphs, loadEditions, loadWeeks, loadStorylines, buildTopicIndex, SECTION_ORDER, FLAG_LABELS, SITE_NAME, SITE_URL, REPO_URL };
