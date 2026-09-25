// Double opt-in sign-up for AI Edge Briefing, on Resend.
//
//   POST /subscribe   {email, daily, weekly, website}  (JSON or a plain form post)
//                     → sends a confirmation email with a signed link. Nothing is stored yet.
//   GET  /confirm?t=  → verifies the link, creates (or updates) the Resend contact in the segment, opted in to
//                       the topics they ticked, then redirects to the site's "you're subscribed" page.
//
// `website` is a honeypot: humans never see the field; a filled one gets a 200 and nothing else. The link is an
// HMAC over {email, daily, weekly, expiry}, valid 48 hours, so the Worker keeps no state at all.

const TOKEN_TTL_MS = 48 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(env, req.headers.get('origin') || '');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/subscribe' && req.method === 'POST') return await subscribe(req, env, cors);
      if (url.pathname === '/confirm' && req.method === 'GET') return await confirm(url, env);
      if (url.pathname === '/') return Response.redirect(`${env.SITE_URL}/`, 302);
      return reply(req, cors, { error: 'not found' }, 404);
    } catch (e) {
      console.error(e && e.stack || e);
      return reply(req, cors, { error: 'Something went wrong on our side. Please try again in a minute.' }, 500);
    }
  },
};

async function subscribe(req, env, cors) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  if (env.RL) { const { success } = await env.RL.limit({ key: ip }); if (!success) return reply(req, cors, { error: 'Too many attempts. Please try again in a minute.' }, 429); }
  const f = await readForm(req);
  if (f.website) return reply(req, cors, { ok: true, message: 'Check your email to confirm.' }, 200, env);  // honeypot
  const email = String(f.email || '').trim().toLowerCase();
  const daily = truthy(f.daily), weekly = truthy(f.weekly);
  if (!EMAIL_RE.test(email) || email.length > 254) return reply(req, cors, { error: 'That email address does not look right.' }, 400);
  if (!daily && !weekly) return reply(req, cors, { error: 'Pick the daily briefing, the weekly review, or both.' }, 400);
  const token = await sign(env, { e: email, d: daily ? 1 : 0, w: weekly ? 1 : 0, x: Date.now() + TOKEN_TTL_MS });
  const link = `${new URL(req.url).origin}/confirm?t=${encodeURIComponent(token)}`;
  await resend(env, 'POST', '/emails', {
    from: env.MAIL_FROM, to: [email], reply_to: env.MAIL_REPLY_TO,
    subject: 'Confirm your AI Edge Briefing subscription',
    html: confirmationHtml(env, link, daily, weekly),
    text: `Confirm your subscription to AI Edge Briefing (${what(daily, weekly)}) by opening this link within 48 hours:\n\n${link}\n\nIf you did not ask for this, ignore this email and nothing happens.`,
  });
  return reply(req, cors, { ok: true, message: 'Check your email to confirm.' }, 200, env);
}

async function confirm(url, env) {
  const t = url.searchParams.get('t') || '';
  const p = await verify(env, t);
  if (!p) return page('This link is not valid', 'Confirmation links work once and expire after 48 hours. Subscribe again from the site to get a fresh one.', env, 400);
  const topics = [];
  if (p.d) topics.push({ id: env.RESEND_TOPIC_DAILY, subscription: 'opt_in' });
  if (p.w) topics.push({ id: env.RESEND_TOPIC_WEEKLY, subscription: 'opt_in' });
  const created = await resend(env, 'POST', '/contacts', { email: p.e, unsubscribed: false, segments: [{ id: env.RESEND_SEGMENT_ID }], topics }, true);
  if (!created.ok) {
    // Already a contact (re-subscribing, or changing their choice): re-enable, set the topics, make sure they are
    // in the segment. Each call is idempotent on Resend's side.
    const id = encodeURIComponent(p.e);
    await resend(env, 'PATCH', `/contacts/${id}`, { unsubscribed: false });
    await resend(env, 'PATCH', `/contacts/${id}/topics`, { topics });
    await resend(env, 'POST', `/contacts/${id}/segments/${env.RESEND_SEGMENT_ID}`, null, true);
  }
  return Response.redirect(`${env.SITE_URL}/subscribe/confirmed/`, 303);
}

// --- helpers ---
async function readForm(req) {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await req.json();
  const fd = await req.formData();
  return Object.fromEntries(fd.entries());
}
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'on' || v === 'true' || v === 'yes';
const what = (d, w) => d && w ? 'the daily briefing and the weekly review' : d ? 'the daily briefing' : 'the weekly review';
const wantsJson = (req) => (req.headers.get('accept') || '').includes('application/json') || (req.headers.get('content-type') || '').includes('application/json');

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  const h = { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept', 'access-control-max-age': '86400', vary: 'origin' };
  if (allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}
// JSON for the script on the site; a small page for a browser that posted the form without JavaScript.
function reply(req, cors, body, status, env) {
  if (wantsJson(req)) return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (body.ok && env) return Response.redirect(`${env.SITE_URL}/subscribe/check-email/`, 303);
  return page(body.error ? 'Could not subscribe' : 'AI Edge Briefing', body.error || body.message || '', env, status);
}
function page(title, text, env, status = 200) {
  const home = env && env.SITE_URL ? env.SITE_URL : 'https://aiedgebriefing.com';
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${esc(title)} — AI Edge Briefing</title>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:32rem;margin:15vh auto;padding:0 20px;line-height:1.5;color:#1a1a1a"><h1 style="font-size:1.4rem">${esc(title)}</h1><p>${esc(text)}</p><p><a href="${home}/" style="color:#0b57d0">Back to AI Edge Briefing</a></p>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
function confirmationHtml(env, link, d, w) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:8px 4px;font-size:15px;line-height:1.5;color:#222">
<p style="color:#777;font-size:12px;margin:0 0 4px">AI Edge Briefing</p>
<h1 style="font-size:20px;margin:0 0 12px">One click to confirm</h1>
<p>You asked for ${esc(what(d, w))} from AI Edge Briefing. Confirm it here:</p>
<p style="margin:18px 0"><a href="${esc(link)}" style="background:#0b57d0;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Confirm my subscription</a></p>
<p style="color:#777;font-size:13px">The link works for 48 hours. If you did not ask for this, ignore this email — nothing is stored until you confirm.</p>
<p style="color:#999;font-size:12px;margin-top:24px">AI Edge Briefing is presented by Epilogue Labs, Toronto. <a href="${esc(env.SITE_URL)}/" style="color:#999">aiedgebriefing.com</a></p>
</div>`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function resend(env, method, p, body, soft = false) {
  const res = await fetch(`https://api.resend.com${p}`, { method, headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok && !soft) throw new Error(`Resend ${method} ${p}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : {} };
}

// token = base64url(payload JSON) + "." + base64url(HMAC-SHA256(payload))
async function key(env) { return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SUBSCRIBE_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function sign(env, payload) {
  const data = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(data)));
  return `${data}.${b64u(mac)}`;
}
async function verify(env, token) {
  const [data, mac] = String(token).split('.');
  if (!data || !mac) return null;
  const ok = await crypto.subtle.verify('HMAC', await key(env), unb64u(mac), new TextEncoder().encode(data));
  if (!ok) return null;
  let p; try { p = JSON.parse(new TextDecoder().decode(unb64u(data))); } catch { return null; }
  if (!p || typeof p.e !== 'string' || !EMAIL_RE.test(p.e) || !(p.x > Date.now())) return null;
  return p;
}
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
