#!/usr/bin/env node
'use strict';
// Claude Code hook. Wired in .claude/settings.json for SessionStart, PostToolUse, SubagentStop and Stop.
// The harness pipes the hook event as JSON on stdin; we append a compact record to trace/<key>.jsonl and keep a
// copy of the raw session transcript alongside it. The key is the America/Toronto date — or DATE.week when the
// session's prompt carries the AINEWS_RUN=week sentinel (the weekly routine), so the two Monday runs stay apart.
// This is the end-to-end record of a run: every tool call, its input, its (clipped) response, and the final message.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Only record inside the cloud sandbox (the routine's home) or when explicitly enabled — never in a developer's local session.
const ENABLED = process.env.AINEWS_TRACE === '1' || (process.env.HOME || '').startsWith('/home/user') || process.cwd().startsWith('/home/user');
if (!ENABLED) process.exit(0);
const MAX_RESPONSE = 16000; // characters kept per tool response in the jsonl (full text stays in the transcript copy)

// The trace is published. Redact anything that should never be public: email addresses and token-shaped strings.
const REDACT = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email redacted]'],
  [/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/g, '[token redacted]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[token redacted]'],
  [/\b(?:xox[abp]|AIza|AKIA)[A-Za-z0-9_-]{12,}\b/g, '[token redacted]'],
  [/Bearer\s+[A-Za-z0-9._-]{16,}/g, 'Bearer [token redacted]'],
];
const redact = (s) => REDACT.reduce((acc, [re, rep]) => acc.replace(re, rep), s);

// Sum API usage across a transcript's assistant messages (one message id may appear on several rows; count it once).
function usageOf(file) {
  try {
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
  } catch { return null; }
}

// Which trace this session belongs to. Resolved once from the prompt in the transcript and cached per session;
// events that arrive before the prompt exists (SessionStart) wait in a pending file and are drained on the first resolve.
function resolveKey(ev, date, dir) {
  if (process.env.AINEWS_TRACE_KEY) return process.env.AINEWS_TRACE_KEY;
  const cache = ev.session_id ? path.join(dir, `.key-${ev.session_id}`) : null;
  if (cache && fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8').trim() || null;
  const tp = ev.transcript_path;
  if (!tp || !fs.existsSync(tp)) return null;
  let prompt = null;
  for (const line of fs.readFileSync(tp, 'utf8').split('\n')) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.type === 'queue-operation' && typeof d.content === 'string') { prompt = d.content; break; }
    const c = d.message && d.message.content;
    if (d.type === 'user' && !d.isSidechain && typeof c === 'string') { prompt = c; break; }
  }
  if (prompt == null) return null;
  const key = /\bAINEWS_RUN=week\b/.test(prompt) ? `${date}.week` : date;
  if (cache) { try { fs.writeFileSync(cache, key); } catch { /* best effort */ } }
  return key;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try {
    const ev = JSON.parse(raw || '{}');
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const dir = path.join(ROOT, 'trace');
    fs.mkdirSync(dir, { recursive: true });

    const clip = (v) => {
      if (v == null) return v;
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.length > MAX_RESPONSE ? { truncated: true, length: s.length, head: s.slice(0, MAX_RESPONSE) } : v;
    };
    const { tool_input, tool_response, transcript_path, last_assistant_message, ...meta } = ev;
    const rec = { t: now.toISOString(), event: ev.hook_event_name, ...meta };
    // Token usage of the session (Stop) or the finished subagent (SubagentStop), summed from its transcript so the
    // run's full cost can be reconstructed later. Subagent transcripts are not otherwise kept.
    const usagePath = ev.hook_event_name === 'SubagentStop' ? meta.agent_transcript_path : ev.hook_event_name === 'Stop' ? transcript_path : null;
    if (usagePath) { const u = usageOf(usagePath); if (u) rec.usage = u; }
    if (tool_input !== undefined) rec.input = tool_input;
    if (tool_response !== undefined) rec.response = clip(tool_response);
    if (last_assistant_message !== undefined) rec.last_message = clip(last_assistant_message);
    const line = redact(JSON.stringify(rec)) + '\n';
    // If the prompt could not be read by the time the session ends, the run is almost certainly the daily.
    const key = resolveKey(ev, date, dir) || (ev.hook_event_name === 'Stop' ? date : null);
    const pending = ev.session_id ? path.join(dir, `.pending-${ev.session_id}.jsonl`) : null;
    if (!key) { fs.appendFileSync(pending || path.join(dir, `${date}.jsonl`), line); process.exit(0); }
    if (pending && fs.existsSync(pending)) { fs.appendFileSync(path.join(dir, `${key}.jsonl`), fs.readFileSync(pending, 'utf8')); fs.unlinkSync(pending); }
    fs.appendFileSync(path.join(dir, `${key}.jsonl`), line);

    // Keep the raw transcript of the main session (not subagent sidechains) next to the events.
    // More than one session can share a key — the catch-up routine runs as AINEWS_RUN=daily too — and this
    // file is written whole each time, so a second session would replace the first one's record. Within a
    // session the transcript only grows, so "never replace a longer one" keeps the run that did the work and
    // puts the other session beside it rather than throwing it away.
    if (transcript_path && !ev.agent_id && fs.existsSync(transcript_path)) {
      try {
        const primary = path.join(dir, `${key}.transcript.jsonl`);
        const body = redact(fs.readFileSync(transcript_path, 'utf8'));
        if (!fs.existsSync(primary) || fs.statSync(primary).size <= Buffer.byteLength(body)) fs.writeFileSync(primary, body);
        else fs.writeFileSync(path.join(dir, `${key}.transcript.${String(ev.session_id || 'other').slice(0, 8)}.jsonl`), body);
      } catch { /* best effort */ }
    }
  } catch { /* never block the harness */ }
  process.exit(0);
});
