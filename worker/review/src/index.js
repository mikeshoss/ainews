// The AI Edge — podcast review page.
//   GET  /:date?t=SIG            the page: player, transcript link, feedback box, "Put it live"
//   POST /:date/approve?t=SIG    → dispatch podcast-review.yml {date, action: approve}
//   POST /:date/feedback?t=SIG   {note} → dispatch podcast-review.yml {date, action: feedback, note}
// SIG = HMAC-SHA256(REVIEW_SIGNING_SECRET, date) as hex — the same signature scripts/podcast.js puts in the email.

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/(\d{4}-\d{2}-\d{2})(?:\/(approve|feedback))?\/?$/);
    if (!m) return page('The AI Edge review', '<p>Open the link from the review email.</p>', 404);
    const [, date, action] = m;
    if (!(await verify(env, date, url.searchParams.get('t') || ''))) return page('This link is not valid', '<p>Open the link from the review email for this date.</p>', 403);
    try {
      if (!action && req.method === 'GET') return await review(env, date, url);
      if (action && req.method === 'POST') return await act(env, date, action, req);
      return page('Not allowed', '', 405);
    } catch (e) {
      console.error(e && e.stack || e);
      return json({ error: `Something went wrong: ${e.message}` }, 500);
    }
  },
};

async function index(env) {
  const res = await fetch(`${env.AUDIO_BASE}/index.json?ts=${Date.now()}`, { cf: { cacheTtl: 0 }, headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
  return res.json();
}

async function review(env, date, url) {
  const idx = await index(env);
  const pending = idx.pending && idx.pending[date], live = idx.episodes && idx.episodes[date];
  const t = url.searchParams.get('t');
  const long = new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (!pending) {
    return page(`${long} — nothing waiting`, `<p>${live ? `The live episode is <b>${live.url.split('/').pop()}</b> (${Math.round(live.seconds / 60)} min), generated ${live.generated_at.slice(0, 16).replace('T', ' ')} UTC.` : 'No episode has been generated for this date.'}</p><p class="muted">Nothing is pending review. If a new version was just made, give it a minute and reload.</p>`);
  }
  const mins = Math.floor(pending.seconds / 60), secs = String(pending.seconds % 60).padStart(2, '0');
  const body = `
<p class="eyebrow">Pending review · ${esc(pending.label)} · ${mins}:${secs} · generated ${esc(pending.generated_at.slice(0, 16).replace('T', ' '))} UTC${live ? ` · replaces the live ${esc(live.url.split('/').pop())}` : ''}</p>
<audio controls preload="metadata" src="${esc(pending.url)}" style="width:100%;margin:12px 0 18px"></audio>
<p><a href="${esc(env.SITE_URL)}/${date}/script/" target="_blank" rel="noopener">Read the transcript</a> · <a href="${esc(pending.url)}" target="_blank" rel="noopener">audio file</a></p>
<form id="f">
  <label for="note"><b>Feedback</b> <span class="muted">— what to change; Claude rewrites the script and a new version comes back for review</span></label>
  <textarea id="note" name="note" rows="5" placeholder="e.g. the second item opens with a number nobody can place — say what happened first"></textarea>
  <div class="row">
    <button type="button" id="live" class="primary">Put it live</button>
    <button type="button" id="send">Send feedback</button>
    <span id="status" role="status" aria-live="polite"></span>
  </div>
</form>
<script>
(function(){
  var st=document.getElementById('status'),live=document.getElementById('live'),send=document.getElementById('send'),note=document.getElementById('note');
  function post(action,body,label){live.disabled=send.disabled=true;st.textContent='Working…';
    fetch(location.pathname.replace(/\\/$/,'')+'/'+action+location.search,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
      .then(function(x){st.textContent=x.ok?x.j.message:('Failed: '+(x.j.error||'unknown'));if(!x.ok){live.disabled=send.disabled=false}})
      .catch(function(){st.textContent='Could not reach the server — try again.';live.disabled=send.disabled=false});}
  live.addEventListener('click',function(){if(confirm('Put ${esc(pending.label)} live on the site and in the feed?'))post('approve',{},'live')});
  send.addEventListener('click',function(){var n=note.value.trim();if(!n){st.textContent='Write the feedback first.';note.focus();return}post('feedback',{note:n})});
})();
</script>`;
  return page(`${long} — review`, body);
}

async function act(env, date, action, req) {
  let note = '';
  if (action === 'feedback') { const b = await req.json().catch(() => ({})); note = String(b.note || '').trim().slice(0, 4000); if (!note) return json({ error: 'Write the feedback first.' }, 400); }
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/podcast-review.yml/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ainews-review', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify({ ref: 'main', inputs: { date, action, note } }),
  });
  if (res.status !== 204) { const t = await res.text(); throw new Error(`GitHub dispatch HTTP ${res.status} ${t.slice(0, 200)}`); }
  return json({ ok: true, message: action === 'approve' ? 'Going live — on the site and in the feed in about five minutes.' : 'Feedback saved. Claude rewrites the script and you get a new link when the next version is ready.' });
}

// --- helpers ---
async function verify(env, date, sig) {
  if (!env.REVIEW_SIGNING_SECRET || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.REVIEW_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sig.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} — The AI Edge</title>
<style>:root{color-scheme:light dark;--bg:#f7f6f2;--fg:#1a1a1a;--muted:#6b6b6b;--line:#e2e0d8;--card:#fff;--accent:#0b57d0}@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ebebeb;--muted:#9a9a9a;--line:#2a2a2a;--card:#1b1b1b;--accent:#8ab4f8}}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5}main{max-width:640px;margin:0 auto;padding:28px 16px 64px}h1{font-size:1.5rem;line-height:1.2;margin:0 0 6px}a{color:var(--accent)}.muted{color:var(--muted)}.eyebrow{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
textarea{width:100%;box-sizing:border-box;margin:8px 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}button{padding:10px 16px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit;font-weight:600;cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.6;cursor:default}#status{font-size:.92rem;color:var(--muted)}</style></head>
<body><main><p class="eyebrow">The AI Edge · podcast review</p><h1>${esc(title)}</h1>${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
