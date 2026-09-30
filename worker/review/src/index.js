// The AI Edge — podcast review page.
//   GET  /:key?t=SIG            key = DATE (daily) or DATE.week (Monday). Pending episode → player, feedback box,
//                              "Put it live". Monday with no pending yet → the teleprompter with Record / Upload.
//   POST /:key/approve?t=SIG    → dispatch podcast-review.yml {date: key, action: approve}
//   POST /:key/feedback?t=SIG   {note} → dispatch podcast-review.yml {date: key, action: feedback, note}
//   POST /:key/upload?t=SIG     multipart "audio" → R2 weekly/DATE.raw.<ext> → dispatch weekly-audio.yml {date}
// SIG = HMAC-SHA256(REVIEW_SIGNING_SECRET, key) as hex — what scripts/podcast.js and weekly-audio.js put in the email.

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/(\d{4}-\d{2}-\d{2}(?:\.week)?)(?:\/(approve|feedback|upload))?\/?$/);
    if (!m) return page('The AI Edge review', '<p>Open the link from the review email.</p>', 404);
    const [, key, action] = m;
    if (!(await verify(env, key, url.searchParams.get('t') || ''))) return page('This link is not valid', '<p>Open the link from the review email for this date.</p>', 403);
    try {
      if (!action && req.method === 'GET') return await review(env, key, url);
      if (action === 'upload' && req.method === 'POST') return await upload(env, key, req);
      if (action && req.method === 'POST') return await act(env, key, action, req);
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
const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function review(env, key, url) {
  const idx = await index(env);
  const isWeek = key.endsWith('.week'), date = key.slice(0, 10);
  const pending = idx.pending && idx.pending[key], live = idx.episodes && idx.episodes[key];
  const long = (isWeek ? 'Week in review, ' : '') + longDate(date);
  const t = url.searchParams.get('t');
  if (!pending) {
    if (isWeek) {
      // No recording processed yet: show the script to read, with Record and Upload.
      const r = await fetch(`${env.SITE_URL}/week/${date}/script.json`, { cf: { cacheTtl: 0 } });
      if (r.ok) return teleprompter(env, key, date, await r.json(), t, live);
      return page(`${long} — no script yet`, `<p>The week-in-review script for ${esc(longDate(date))} is not on the site yet. The Monday run writes it; give it a few minutes and reload.</p>`);
    }
    return page(`${long} — nothing waiting`, `<p>${live ? `The live episode is <b>${esc(live.url.split('/').pop())}</b> (${Math.round(live.seconds / 60)} min), generated ${esc(live.generated_at.slice(0, 16).replace('T', ' '))} UTC.` : 'No episode has been generated for this date.'}</p><p class="muted">Nothing is pending review. If a new version was just made, give it a minute and reload.</p>`);
  }
  const mins = Math.floor(pending.seconds / 60), secs = String(pending.seconds % 60).padStart(2, '0');
  const transcript = isWeek ? `${env.SITE_URL}/week/${date}/script/` : `${env.SITE_URL}/${date}/script/`;
  const body = `
<p class="eyebrow">Pending review · ${esc(pending.label)} · ${mins}:${secs} · generated ${esc(pending.generated_at.slice(0, 16).replace('T', ' '))} UTC${live ? ` · replaces the live ${esc(live.url.split('/').pop())}` : ''}${isWeek ? ' · read by ' + esc(Object.values(pending.voices || {})[0] || 'Mike') : ''}</p>
<audio controls preload="metadata" src="${esc(pending.url)}" style="width:100%;margin:12px 0 18px"></audio>
<p><a href="${esc(transcript)}" target="_blank" rel="noopener">Read the transcript</a> · <a href="${esc(pending.url)}" target="_blank" rel="noopener">audio file</a>${isWeek ? ` · <a href="${esc(env.SITE_URL)}/week/${date}/script/" target="_blank" rel="noopener">the script</a>` : ''}</p>
<form id="f">
  <label for="note"><b>Feedback</b> <span class="muted">— ${isWeek ? 'what to change; the script is revised and you record again' : 'what to change; Claude rewrites the script and a new version comes back for review'}</span></label>
  <textarea id="note" name="note" rows="5" placeholder="e.g. the second item opens with a number nobody can place — say what happened first"></textarea>
  <div class="row">
    <button type="button" id="live" class="primary">Put it live</button>
    <button type="button" id="send">Send feedback</button>
    <span id="status" role="status" aria-live="polite"></span>
  </div>
</form>
${isWeek ? `<details style="margin-top:28px"><summary class="muted">Record it again instead</summary>${recorderHtml(key, t)}</details>` : ''}
<script>
(function(){
  var st=document.getElementById('status'),live=document.getElementById('live'),send=document.getElementById('send'),note=document.getElementById('note');
  function post(action,body){live.disabled=send.disabled=true;st.textContent='Working…';
    fetch(location.pathname.replace(/\\/$/,'')+'/'+action+location.search,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
      .then(function(x){st.textContent=x.ok?x.j.message:('Failed: '+(x.j.error||'unknown'));if(!x.ok){live.disabled=send.disabled=false}})
      .catch(function(){st.textContent='Could not reach the server — try again.';live.disabled=send.disabled=false});}
  live.addEventListener('click',function(){if(confirm('Put ${esc(pending.label)} live on the site and in the feed?'))post('approve',{})});
  send.addEventListener('click',function(){var n=note.value.trim();if(!n){st.textContent='Write the feedback first.';note.focus();return}post('feedback',{note:n})});
})();
</script>
${isWeek ? recorderJs() : ''}`;
  return page(`${long} — review`, body);
}

// The Monday teleprompter: the script one paragraph per screen, Record (in the browser) or Upload a file.
function teleprompter(env, key, date, sc, t, live) {
  const names = { open: 'Open', happened: 'What happened', connects: 'What connects', unknowns: "What we don't know", calendar: 'On the calendar', close: 'Close' };
  const words = sc.blocks.reduce((n, b) => n + b.lines.reduce((m, l) => m + l.text.split(/\s+/).length, 0), 0);
  const script = sc.blocks.map((b) => `<h2>${esc(names[b.type] || b.type)}</h2>${b.lines.map((l) => `<p class="cue">${esc(l.text)}</p>`).join('')}`).join('');
  const body = `
<p class="eyebrow">Week in review · read by ${esc(sc.host.name)} · ${words} words · about ${Math.round(words / 140)} minutes${live ? ' · a live version exists; this makes a new one' : ''}</p>
${recorderHtml(key, t)}
<div class="prompter">${script}</div>
${recorderJs()}`;
  return page(`Week in review, ${longDate(date)} — record`, body);
}

function recorderHtml(key, t) {
  return `<div class="rec card">
  <div class="row">
    <button type="button" id="rec" class="primary">Record</button>
    <span id="rtime" class="mono">0:00</span>
    <label class="btn" for="file">Upload a file<input id="file" type="file" accept="audio/*,.wav,.mp3,.m4a,.webm,.flac,.aiff" hidden></label>
    <span id="rstatus" role="status" aria-live="polite"></span>
  </div>
  <p class="muted small">Record straight from your mic here (Chrome or Safari), or record in your own software and upload the file — WAV, AIFF, FLAC, MP3 or M4A, any size up to 300 MB. The whole read in one take; the check tells you which paragraphs to do again, if any.</p>
  <audio id="preview" controls hidden style="width:100%;margin-top:8px"></audio>
  <div class="row" id="sendrow" hidden><button type="button" id="upload" class="primary">Send this recording</button><button type="button" id="discard">Discard</button></div>
</div>`;
}

function recorderJs() {
  return `<script>
(function(){
  var rec=document.getElementById('rec'),time=document.getElementById('rtime'),file=document.getElementById('file'),st=document.getElementById('rstatus'),prev=document.getElementById('preview'),row=document.getElementById('sendrow'),up=document.getElementById('upload'),disc=document.getElementById('discard');
  if(!rec)return;
  var mr=null,chunks=[],blob=null,ext='webm',t0=0,timer=null;
  function fmt(s){return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0')}
  function ready(b,e){blob=b;ext=e;prev.src=URL.createObjectURL(b);prev.hidden=false;row.hidden=false;st.textContent=(b.size/1e6).toFixed(1)+' MB ready';}
  rec.addEventListener('click',function(){
    if(mr&&mr.state==='recording'){mr.stop();return}
    if(!navigator.mediaDevices){st.textContent='This browser cannot record — upload a file instead.';return}
    navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}}).then(function(stream){
      var mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(function(m){return window.MediaRecorder&&MediaRecorder.isTypeSupported(m)})||'';
      mr=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:192000}:undefined);chunks=[];
      mr.ondataavailable=function(e){if(e.data.size)chunks.push(e.data)};
      mr.onstop=function(){stream.getTracks().forEach(function(tr){tr.stop()});clearInterval(timer);rec.textContent='Record again';rec.classList.remove('live');ready(new Blob(chunks,{type:mr.mimeType||'audio/webm'}),(mr.mimeType||'').indexOf('mp4')>=0?'m4a':'webm')};
      mr.start(1000);t0=Date.now();rec.textContent='Stop';rec.classList.add('live');st.textContent='Recording…';prev.hidden=true;row.hidden=true;
      timer=setInterval(function(){time.textContent=fmt((Date.now()-t0)/1000)},500);
    }).catch(function(e){st.textContent='Microphone not available: '+e.message});
  });
  file.addEventListener('change',function(){var f=file.files[0];if(!f)return;if(f.size>300e6){st.textContent='That file is over 300 MB.';return}ready(f,(f.name.split('.').pop()||'wav').toLowerCase())});
  disc.addEventListener('click',function(){blob=null;prev.hidden=true;row.hidden=true;st.textContent='';time.textContent='0:00'});
  up.addEventListener('click',function(){
    if(!blob)return;up.disabled=disc.disabled=rec.disabled=true;st.textContent='Sending '+(blob.size/1e6).toFixed(1)+' MB…';
    var fd=new FormData();fd.append('audio',blob,'recording.'+ext);
    fetch(location.pathname.replace(/\\/$/,'')+'/upload'+location.search,{method:'POST',body:fd})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
      .then(function(x){st.textContent=x.ok?x.j.message:('Failed: '+(x.j.error||'unknown'));if(!x.ok){up.disabled=disc.disabled=rec.disabled=false}})
      .catch(function(){st.textContent='Upload failed — try again.';up.disabled=disc.disabled=rec.disabled=false});
  });
})();
</script>`;
}

async function upload(env, key, req) {
  if (!key.endsWith('.week')) return json({ error: 'Only the week in review takes a recording.' }, 400);
  if (!env.AUDIO) return json({ error: 'Storage is not connected to this page yet.' }, 500);
  const date = key.slice(0, 10);
  const fd = await req.formData();
  const f = fd.get('audio');
  if (!f || typeof f === 'string' || !f.size) return json({ error: 'No audio file received.' }, 400);
  if (f.size > 300e6) return json({ error: 'That file is over 300 MB.' }, 413);
  const ext = ((f.name || '').split('.').pop() || 'webm').toLowerCase().replace(/[^a-z0-9]/g, '') || 'webm';
  const objKey = `weekly/${date}.raw.${ext}`;
  await env.AUDIO.put(objKey, f.stream(), { httpMetadata: { contentType: f.type || 'application/octet-stream', cacheControl: 'no-store' } });
  let dispatched = false;
  if (env.GITHUB_TOKEN) {
    const res = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/weekly-audio.yml/dispatches`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ainews-review', 'x-github-api-version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main', inputs: { date } }),
    });
    dispatched = res.status === 204;
  }
  return json({ ok: true, message: dispatched ? `Sent (${(f.size / 1e6).toFixed(1)} MB). It is being cleaned and checked — you get an email in about five minutes with the review link, or the paragraphs to do again.` : `Sent (${(f.size / 1e6).toFixed(1)} MB) and stored. Processing is started by Claude — you get an email when it is ready.` });
}

async function act(env, key, action, req) {
  let note = '';
  if (action === 'feedback') { const b = await req.json().catch(() => ({})); note = String(b.note || '').trim().slice(0, 4000); if (!note) return json({ error: 'Write the feedback first.' }, 400); }
  if (!env.GITHUB_TOKEN) return json({ error: 'This page cannot reach GitHub yet (no token). Tell Claude "approve" or send the feedback in chat.' }, 500);
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/podcast-review.yml/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ainews-review', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify({ ref: 'main', inputs: { date: key, action, note } }),
  });
  if (res.status !== 204) { const t = await res.text(); throw new Error(`GitHub dispatch HTTP ${res.status} ${t.slice(0, 200)}`); }
  return json({ ok: true, message: action === 'approve' ? 'Going live — on the site and in the feed in about five minutes.' : 'Feedback saved. Claude rewrites the script and you get a new link when the next version is ready.' });
}

// --- helpers ---
async function verify(env, key, sig) {
  if (!env.REVIEW_SIGNING_SECRET || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.REVIEW_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(key)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sig.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} — The AI Edge</title>
<style>:root{color-scheme:light dark;--bg:#f7f6f2;--fg:#1a1a1a;--muted:#6b6b6b;--line:#e2e0d8;--card:#fff;--accent:#0b57d0;--rec:#b3261e}@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ebebeb;--muted:#9a9a9a;--line:#2a2a2a;--card:#1b1b1b;--accent:#8ab4f8;--rec:#f28b82}}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5}main{max-width:680px;margin:0 auto;padding:28px 16px 80px}h1{font-size:1.5rem;line-height:1.2;margin:0 0 6px}a{color:var(--accent)}.muted{color:var(--muted)}.small{font-size:.85rem}.eyebrow{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.mono{font-variant-numeric:tabular-nums;color:var(--muted)}
textarea{width:100%;box-sizing:border-box;margin:8px 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}button,.btn{padding:10px 16px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit;font-weight:600;cursor:pointer;display:inline-block}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.live{background:var(--rec);border-color:var(--rec);color:#fff}button:disabled{opacity:.6;cursor:default}#status,#rstatus{font-size:.92rem;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0}
.prompter{font-family:Georgia,"Iowan Old Style","Times New Roman",serif}.prompter h2{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin:36px 0 6px;padding-top:14px;border-top:1px solid var(--line)}.cue{font-size:1.4rem;line-height:1.5;margin:0 0 26px}</style></head>
<body><main><p class="eyebrow">The AI Edge · podcast review</p><h1>${esc(title)}</h1>${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
