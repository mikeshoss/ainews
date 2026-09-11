#!/usr/bin/env node
'use strict';
// Claude Code hook. Wired in .claude/settings.json for SessionStart, PostToolUse, SubagentStop and Stop.
// The harness pipes the hook event as JSON on stdin; we append a compact record to trace/YYYY-MM-DD.jsonl
// (date in America/Toronto) and keep a copy of the raw session transcript alongside it.
// This is the end-to-end record of a run: every tool call, its input, its (clipped) response, and the final message.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Only record inside the cloud sandbox (the routine's home) or when explicitly enabled — never in a developer's local session.
const ENABLED = process.env.AINEWS_TRACE === '1' || (process.env.HOME || '').startsWith('/home/user') || process.cwd().startsWith('/home/user');
if (!ENABLED) process.exit(0);
const MAX_RESPONSE = 16000; // characters kept per tool response in the jsonl (full text stays in the transcript copy)

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
    if (tool_input !== undefined) rec.input = tool_input;
    if (tool_response !== undefined) rec.response = clip(tool_response);
    if (last_assistant_message !== undefined) rec.last_message = clip(last_assistant_message);
    fs.appendFileSync(path.join(dir, `${date}.jsonl`), JSON.stringify(rec) + '\n');

    // Keep the raw transcript of the main session (not subagent sidechains) next to the events.
    if (transcript_path && !ev.agent_id && fs.existsSync(transcript_path)) {
      try { fs.copyFileSync(transcript_path, path.join(dir, `${date}.transcript.jsonl`)); } catch { /* best effort */ }
    }
  } catch { /* never block the harness */ }
  process.exit(0);
});
