'use strict';
// Shared checks for the three validators (edition, week in review, podcast script).
// Keep network code here and out of lib.js, which build.js loads at build time.

const fs = require('fs');
const path = require('path');
const IMPACTS = new Set(['beneficial', 'harmful', 'mixed', 'neutral']);
const FLAGS = new Set(['company-claim', 'single-source', 'preprint', 'update']);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isHttp = (u) => /^https?:\/\/\S+$/.test(u || '');
const isHomepage = (u) => /^https?:\/\/[^/]+\/?$/.test(u);
const isPlaceholder = (u) => /example\.com|\.\.\./.test(u);

// Speculation and hype — never allowed in anything we publish or voice.
const BANNED = ['i think', 'i bet', 'i guess', 'probably', 'could mean', 'might mean', 'imagine if', 'game-changer', 'game changer', 'huge', 'massive', 'insane', 'crazy', 'wild', 'mind-blowing', 'mind blowing', 'scary', 'terrifying', 'exciting', 'incredible', 'unbelievable', 'revolutionary', 'blew my mind', 'jaw-dropping'];
const WARN_WORDS = ['interesting', 'fascinating'];
// Editorial opinion — the week in review states facts, relationships and open questions; it never takes a view.
const OPINION_ERROR = [...BANNED, 'we believe', 'we think', 'we expect', 'we suspect', 'in our view', 'in our opinion', 'our take', 'our read', 'clearly', 'obviously', 'undoubtedly', 'no doubt', 'it is likely', "it's likely", 'is likely to', 'are likely to', 'in all likelihood', 'all but certain', 'inevitable', 'inevitably', 'it seems', 'seems to', 'appears to be', 'arguably', 'the real story', 'the takeaway', 'bottom line', 'make no mistake', 'read between the lines', 'could signal', 'may signal', 'game-changing'];
const OPINION_WARN = ['likely', 'suggests that', 'suggest that', 'signals that', 'signal that', 'should', 'must', 'could', 'might', 'notably', 'importantly', 'interestingly', 'worrying', 'alarming', 'concerning', 'striking', 'remarkable', 'landmark', 'watershed', 'unprecedented', 'historic'];
// A sentence that asserts a cause must attribute it to someone who said so.
const CAUSAL_RE = /\b(because|led to|leads to|caused|causes|driven by|in response to|as a result|resulted in|due to|prompted|triggered|in reaction to|therefore|consequently|explains why|is why|to counter|retaliat\w*)\b/i;
const ATTRIBUTION_RE = /\b(said|says|wrote|writes|told|according to|reported|reports|argued|argues|stated|states|attributed|attributes|cited|cites|citing|described|describes|filing|announced|testified)\b/i;

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const normNum = (n) => n.replace(/,/g, '').replace(/\.0+$/, '');
const digitsOf = (text) => new Set((String(text).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(normNum));

const escapeRe = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
// Phrases from `list` found in `text` (word-bounded, case-insensitive).
const bannedHits = (text, list) => list.filter((w) => new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(text));
// Quoted spans are what a source said, not us — drop them before scanning for opinion or causation.
const stripQuotes = (text) => String(text).replace(/"[^"]*"|“[^”]*”|‘[^’]*’/g, ' ');
const sentences = (text) => String(text).split(/(?<=[.!?])\s+(?=[A-Z"“(])/).map((s) => s.trim()).filter(Boolean);

function makeReporter() {
  const errors = [], warnings = [];
  return {
    errors, warnings,
    err: (m) => errors.push(m),
    warn: (m) => warnings.push(m),
    report(file, summary) {
      for (const w of warnings) console.log(`WARN  ${w}`);
      for (const e of errors) console.log(`ERROR ${e}`);
      console.log(`${file}: ${summary} — ${errors.length} error(s), ${warnings.length} warning(s)`);
      process.exit(errors.length ? 1 : 0);
    },
  };
}

// Ids of the storylines an item may be filed under (storylines/*.json), with their status.
function storylineIds() {
  const dir = path.join(__dirname, '..', 'storylines');
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) { try { out.set(f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).status || 'live'); } catch { /* validate-storyline reports it */ } }
  return out;
}
const STORYLINES = storylineIds();

// The daily item shape. ctx = { err, warn, urls: Map(url -> where), headlines: Set }.
function checkItem(it, where, ctx) {
  const { err, warn, urls, headlines } = ctx;
  if (!it.headline || it.headline.trim().length < 15) err(`${where}: headline missing or too short`);
  if (it.headline && headlines.has(it.headline.trim().toLowerCase())) err(`${where}: duplicate headline "${it.headline}"`);
  headlines.add((it.headline || '').trim().toLowerCase());
  if (!Array.isArray(it.sources) || !it.sources.length) err(`${where}: needs at least one source`);
  for (const [i, s] of (it.sources || []).entries()) {
    if (!s || !isHttp(s.url)) err(`${where}: source[${i}] has no valid http(s) url`);
    else {
      if (isHomepage(s.url)) err(`${where}: source[${i}] is a homepage (${s.url}) — link the specific article, paper or document`);
      if (isPlaceholder(s.url)) err(`${where}: source[${i}] looks like a placeholder url`);
      if (!urls.has(s.url)) urls.set(s.url, where);
    }
    if (!s.name) warn(`${where}: source[${i}] has no "name" (will fall back to hostname)`);
  }
  if (!Array.isArray(it.bullets) || !it.bullets.length) err(`${where}: needs at least one bullet`);
  for (const [i, b] of (it.bullets || []).entries()) if (typeof b !== 'string' || b.trim().length < 20) err(`${where}: bullet[${i}] too short`);
  if (!Array.isArray(it.topics) || !it.topics.length) err(`${where}: needs at least one topic slug`);
  for (const t of it.topics || []) if (!SLUG_RE.test(t)) err(`${where}: topic "${t}" must be a lowercase-hyphen slug`);
  if (it.impact && !IMPACTS.has(it.impact)) err(`${where}: impact must be one of ${[...IMPACTS].join('|')}`);
  for (const f of it.flags || []) if (!FLAGS.has(f)) err(`${where}: flag "${f}" must be one of ${[...FLAGS].join('|')}`);
  // Storylines: only existing, open ones. The daily never creates a storyline; the weekly does.
  if (it.storylines !== undefined && !Array.isArray(it.storylines)) err(`${where}: "storylines" must be an array of ids`);
  for (const id of it.storylines || []) {
    if (!STORYLINES.has(id)) err(`${where}: storyline "${id}" does not exist — use an id from \`node scripts/build.js --storylines\`, or none`);
    else if (STORYLINES.get(id) === 'resolved') err(`${where}: storyline "${id}" is resolved — file the item elsewhere or leave it untagged`);
  }
  if ((it.storylines || []).length > 3) warn(`${where}: filed under ${it.storylines.length} storylines — usually one, at most two`);
}

async function checkUrl(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  const headers = { 'user-agent': 'Mozilla/5.0 (compatible; ai-edge-briefing-linkcheck/1.0)', accept: 'text/html,application/xhtml+xml,*/*' };
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers, signal: ctl.signal });
    if (r.status === 405 || r.status === 403 || r.status === 400 || r.status === 501) r = await fetch(url, { method: 'GET', redirect: 'follow', headers, signal: ctl.signal });
    return { status: r.status };
  } catch (e) { return { error: e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(timer); }
}

// 404/410 is an error (dead link); anything else that fails is a warning to verify by hand.
async function checkLinks(urls, { err, warn }) {
  const list = [...urls.entries()];
  console.log(`Checking ${list.length} links…`);
  const results = await Promise.all(list.map(async ([url, where]) => [url, where, await checkUrl(url)]));
  for (const [url, where, r] of results) {
    if (r.error) warn(`${where}: ${url} — ${r.error} (could not verify; verify manually via WebFetch)`);
    else if (r.status === 404 || r.status === 410) err(`${where}: ${url} — HTTP ${r.status} (dead link: fix or remove)`);
    else if (r.status >= 400) warn(`${where}: ${url} — HTTP ${r.status} (bot-blocked? verify manually via WebFetch)`);
  }
}

module.exports = { STORYLINES, IMPACTS, FLAGS, SLUG_RE, isHttp, isHomepage, isPlaceholder, BANNED, WARN_WORDS, OPINION_ERROR, OPINION_WARN, CAUSAL_RE, ATTRIBUTION_RE, NUM_RE, normNum, digitsOf, bannedHits, stripQuotes, sentences, makeReporter, checkItem, checkUrl, checkLinks };
