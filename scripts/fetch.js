#!/usr/bin/env node
'use strict';
// Direct page fetch for the editorial run: node scripts/fetch.js <url> [--raw]
// Used when the harness's WebFetch refuses a page. The sites we read have given permission for direct reads,
// so every request identifies itself (User-Agent names the briefing and a contact address). Prints one status
// line — "HTTP <code> · <final url> · <content-type>" — then the page as readable text (or the raw body with
// --raw). Exit 1 on HTTP >= 400 or a network error, so a failed fetch is never mistaken for content.
// This does not get past paywalls or login walls; if what comes back is a stub, that is the answer.

const UA = 'AIEdgeBriefing/1.0 (+https://aiedgebriefing.com/about/; mike@epiloguelabs.com)';
const TIMEOUT_MS = 20000;
const MAX_CHARS = 200000;

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const raw = args.includes('--raw');
if (!url || !/^https?:\/\//.test(url)) { console.error('usage: node scripts/fetch.js <http(s) url> [--raw]'); process.exit(2); }

const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }[e.toLowerCase()] ?? m;
});

// HTML → readable text: drop chrome and scripts, keep block structure, show link targets once.
function textOf(html) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|figcaption|dd|dt|pre)>/gi, '\n')
    .replace(/<(h[1-6])\b[^>]*>/gi, '\n\n# ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => `${inner} <${href}>`)
    .replace(/<[^>]+>/g, ' ');
  h = decode(h).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return h;
}

(async () => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5', 'accept-language': 'en-CA,en;q=0.9' } });
    const type = res.headers.get('content-type') || '';
    console.log(`HTTP ${res.status} · ${res.url} · ${type.split(';')[0]}`);
    const body = await res.text();
    if (res.status >= 400) { console.log(textOf(body).slice(0, 600)); process.exit(1); }
    const out = raw || !/html|xml/.test(type) ? body : textOf(body);
    console.log(out.length > MAX_CHARS ? out.slice(0, MAX_CHARS) + `\n… [truncated; ${out.length.toLocaleString()} characters in total]` : out);
  } catch (e) {
    console.log(`FETCH FAILED · ${url} · ${e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS / 1000}s` : e.message}`);
    process.exit(1);
  } finally { clearTimeout(timer); }
})();
