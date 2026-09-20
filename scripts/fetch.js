#!/usr/bin/env node
'use strict';
// Direct page fetch for the editorial run: node scripts/fetch.js <url> [--raw] [--full] [--render|--no-render]
// Used when the harness's WebFetch refuses a page. The sites we read have given permission for direct reads,
// so every request identifies itself (User-Agent names the briefing and a contact address). Prints one status
// line — "HTTP <code> · <final url> · <content-type>" — then the page as readable text (or the raw body with
// --raw). Exit 1 on HTTP >= 400 or a network error, so a failed fetch is never mistaken for content.
// This does not get past paywalls or login walls; if what comes back is a stub, that is the answer.
// Pages that need JavaScript (an app shell, "enable JavaScript", almost no text) are retried through Cloudflare
// Browser Rendering (headless Chrome at the edge, /markdown endpoint) when CLOUDFLARE_BROWSER_TOKEN and
// CLOUDFLARE_ACCOUNT_ID are set — free tier is ~10 browser-minutes a day. --render forces it; --no-render disables it.
//
// Output is capped at 12,000 characters, because everything this prints lands in the caller's context and is
// then re-read on every turn that follows — a single uncapped page can cost more than the rest of the run.
// The top of a page is where the claim, the date and the figures are; --full lifts the cap when the answer is
// genuinely further down, and the truncation notice says how much was held back.

const UA = 'AIEdgeBriefing/1.0 (+https://aiedgebriefing.com/about/; mike@epiloguelabs.com)';
const TIMEOUT_MS = 20000;
const MAX_CHARS = 12000;   // --full raises this; see the note above
const MAX_CHARS_FULL = 200000;

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const raw = args.includes('--raw');
const FULL = args.includes('--full');
const cap = () => (FULL ? MAX_CHARS_FULL : MAX_CHARS);
const FORCE_RENDER = args.includes('--render'), NO_RENDER = args.includes('--no-render');
(function loadDotenv(file) { try { for (const line of require('fs').readFileSync(file, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } } catch { /* none */ } })(require('path').join(__dirname, '..', 'stats', '.env'));
const BROWSER_TOKEN = process.env.CLOUDFLARE_BROWSER_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const canRender = () => !!(BROWSER_TOKEN && ACCOUNT) && !NO_RENDER;
// A page that only works with JavaScript: an app shell with almost no readable text, or an explicit notice.
const looksLikeShell = (html, text) => text.length < 500 || /enable javascript|javascript is required|please enable js|<noscript>[^<]{0,80}javascript/i.test(html);
async function render(target) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-rendering/markdown`, { method: 'POST', headers: { authorization: `Bearer ${BROWSER_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: target, rejectResourceTypes: ['image', 'media', 'font'], gotoOptions: { waitUntil: 'networkidle0', timeout: 25000 } }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.success) throw new Error(`render failed: HTTP ${res.status} ${(j.errors || []).map((e) => e.message).join('; ')}`);
  return String(j.result || '');
}
if (!url || !/^https?:\/\//.test(url)) { console.error('usage: node scripts/fetch.js <http(s) url> [--raw] [--full]'); process.exit(2); }

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

const clip = (text) => text.length <= cap() ? text
  : `${text.slice(0, cap())}\n\n… [truncated: ${(text.length - cap()).toLocaleString()} of ${text.length.toLocaleString()} characters not shown. Re-run with --full if what you need is further down.]`;

(async () => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5', 'accept-language': 'en-CA,en;q=0.9' } });
    const type = res.headers.get('content-type') || '';
    console.log(`HTTP ${res.status} · ${res.url} · ${type.split(';')[0]}`);
    const body = await res.text();
    if (res.status >= 400) {
      // Blocked to a plain request: a real browser at the edge often gets the page. Same permission rules apply.
      if (canRender() && res.status !== 404 && res.status !== 410) {
        try { const md = await render(url); if (md.trim().length > 200) { console.log(`RENDERED · headless Chrome (Cloudflare Browser Rendering) — the plain request got HTTP ${res.status}`); console.log(clip(md)); process.exit(0); } }
        catch (e) { console.log(`RENDER FAILED · ${e.message}`); }
      }
      console.log(textOf(body).slice(0, 600)); process.exit(1);
    }
    let out = raw || !/html|xml/.test(type) ? body : textOf(body);
    if (!raw && /html/.test(type) && canRender() && (FORCE_RENDER || looksLikeShell(body, out))) {
      try { const md = await render(res.url || url); if (md.trim().length > out.length || FORCE_RENDER) { console.log(`RENDERED · headless Chrome (Cloudflare Browser Rendering)${FORCE_RENDER ? '' : ' — the plain fetch returned only a JavaScript shell'}`); out = md; } }
      catch (e) { console.log(`RENDER FAILED · ${e.message} — showing the plain fetch`); }
    }
    console.log(clip(out));
  } catch (e) {
    console.log(`FETCH FAILED · ${url} · ${e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS / 1000}s` : e.message}`);
    process.exit(1);
  } finally { clearTimeout(timer); }
})();
