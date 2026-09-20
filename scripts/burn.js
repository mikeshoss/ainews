#!/usr/bin/env node
'use strict';
// Why a run cost what it cost. Usage: node scripts/burn.js [--days N] [YYYY-MM-DD ...] [--context]
//
// The API is stateless: every turn re-sends the whole conversation. Prompt caching makes the repeat ~10x
// cheaper, not free, so the price of a token is its size times the number of turns that come after it.
// That makes turn count — not cleverness, not model choice — the thing that sets the bill, and it is why
// the per-turn cost of a run is close to constant. This prints that: the split between re-reading the
// conversation and actually writing, the cost per turn, and (with --context) what is taking up the room.
//
//   trace/DATE.transcript.jsonl   the main session (what the editor itself did)
//   trace/DATE.jsonl              the hook log, which carries each subagent's usage on SubagentStop
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TZ = 'America/Toronto';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// USD per million tokens: [input, output, cache read, cache write 5m, cache write 1h].
const PRICES = {
  'claude-opus-5': [5, 25, 0.5, 6.25, 10],
  'claude-sonnet-5': [2, 10, 0.2, 2.5, 4],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25, 2],
};
const args = process.argv.slice(2);
const SHOW_CONTEXT = args.includes('--context');
const DAYS = Number(args[args.indexOf('--days') + 1]) || 7;
const addDays = (d, n) => { const o = new Date(`${d}T12:00:00Z`); o.setUTCDate(o.getUTCDate() + n); return o.toISOString().slice(0, 10); };
let dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!dates.length) dates = Array.from({ length: DAYS }, (_, i) => addDays(today(), i - DAYS + 1));

const zero = () => ({ model: null, msgs: 0, input: 0, output: 0, cache_read: 0, cw5: 0, cw1h: 0 });
const priceOf = (u) => PRICES[u.model] || PRICES['claude-opus-5'];
const costOf = (u) => { const p = priceOf(u); return (u.input * p[0] + u.output * p[1] + u.cache_read * p[2] + u.cw5 * p[3] + u.cw1h * p[4]) / 1e6; };
const partOf = (u, k) => { const p = priceOf(u); return u[k] * p[{ input: 0, output: 1, cache_read: 2, cw5: 3, cw1h: 4 }[k]] / 1e6; };

// One entry per assistant message in the main session's transcript, de-duplicated by message id
// (a streamed message can appear more than once).
function mainSession(date) {
  const file = path.join(ROOT, 'trace', `${date}.transcript.jsonl`);
  if (!fs.existsSync(file)) return null;
  const seen = new Set(), sum = zero(); const ctx = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const m = r.message; if (!m || !m.usage || (m.id && seen.has(m.id))) continue;
    if (m.id) seen.add(m.id);
    const u = m.usage, cc = u.cache_creation || {};
    const cw1h = cc.ephemeral_1h_input_tokens != null ? cc.ephemeral_1h_input_tokens : Math.max(0, (u.cache_creation_input_tokens || 0) - (cc.ephemeral_5m_input_tokens || 0));
    sum.model = sum.model || m.model; sum.msgs++;
    sum.input += u.input_tokens || 0; sum.output += u.output_tokens || 0; sum.cache_read += u.cache_read_input_tokens || 0;
    sum.cw5 += cc.ephemeral_5m_input_tokens || 0; sum.cw1h += cw1h;
    ctx.push((u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0));
  }
  return sum.msgs ? { ...sum, peak: Math.max(...ctx), avg: Math.round(ctx.reduce((a, b) => a + b, 0) / ctx.length) } : null;
}

// Subagents report their whole usage once, on SubagentStop.
function subagents(date) {
  const file = path.join(ROOT, 'trace', `${date}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const sum = zero(); let n = 0, tools = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.event === 'PostToolUse') tools++;
    if (e.event !== 'SubagentStop' || !e.usage) continue;
    const u = e.usage; n++;
    sum.model = sum.model || u.model; sum.msgs += u.messages || 0;
    sum.input += u.input || 0; sum.output += u.output || 0; sum.cache_read += u.cache_read || 0;
    sum.cw5 += u.cache_write_5m || 0; sum.cw1h += u.cache_write_1h || 0;
  }
  return { ...sum, agents: n, tools };
}

// What is actually sitting in the main session's context, by the tool that put it there.
function context(date) {
  const file = path.join(ROOT, 'trace', `${date}.transcript.jsonl`);
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const name = {}, by = {}; let total = 0;
  const add = (k, n) => { (by[k] = by[k] || { chars: 0, calls: 0 }).chars += n; by[k].calls++; total += n; };
  for (const l of lines) { if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; } const m = r.message; if (!m || !Array.isArray(m.content)) continue; for (const b of m.content) if (b.type === 'tool_use') name[b.id] = b.name; }
  for (const l of lines) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    const m = r.message; if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'tool_use') add(`${b.name} (what we sent)`, JSON.stringify(b.input || '').length);
      else if (b.type === 'tool_result') add(`${name[b.tool_use_id] || 'unknown'} (what came back)`, JSON.stringify(b.content || '').length);
      else if (b.type === 'text') add('the editor\'s own words', (b.text || '').length);
    }
  }
  return { by, total };
}

let grand = 0;
for (const date of dates) {
  const main = mainSession(date), sub = subagents(date);
  if (!main) { console.log(`${date}  no run`); continue; }
  const mc = costOf(main), sc = sub && sub.msgs ? costOf(sub) : 0;
  grand += mc + sc;
  console.log(`\n${date} — $${(mc + sc).toFixed(2)}`);
  console.log(`  main session   ${String(main.msgs).padStart(4)} turns  $${mc.toFixed(2).padStart(6)}  ${(mc / main.msgs * 100).toFixed(1)}¢/turn   context avg ${(main.avg / 1000).toFixed(0)}k peak ${(main.peak / 1000).toFixed(0)}k tokens`);
  console.log(`    re-reading itself  $${partOf(main, 'cache_read').toFixed(2).padStart(6)}  ${(partOf(main, 'cache_read') / mc * 100).toFixed(0)}%   (${(main.cache_read / 1e6).toFixed(1)}M tokens read back)`);
  console.log(`    writing the edition $${partOf(main, 'output').toFixed(2).padStart(5)}  ${(partOf(main, 'output') / mc * 100).toFixed(0)}%   (${(main.output / 1000).toFixed(0)}k tokens written)`);
  if (sub && sub.agents) {
    console.log(`  ${String(sub.agents).padStart(2)} subagents    ${String(sub.msgs || '?').padStart(4)} turns  $${sc.toFixed(2).padStart(6)}  ${sub.msgs ? (sc / sub.msgs * 100).toFixed(1) + '¢/turn' : ''}   (${(sub.cache_read / 1e6).toFixed(1)}M tokens read back)`);
    console.log(`  ${sub.tools} tool calls in total (main session + subagents)`);
  }
  if (SHOW_CONTEXT) {
    const c = context(date);
    console.log(`  what fills the main session's context (${Math.round(c.total / 1000)}k chars ≈ ${Math.round(c.total / 4000)}k tokens):`);
    for (const [k, v] of Object.entries(c.by).sort((a, b) => b[1].chars - a[1].chars).slice(0, 10))
      if (v.chars > c.total / 200) console.log(`    ${String(Math.round(v.chars / 1000) + 'k').padStart(6)}  ${(v.chars / c.total * 100).toFixed(1).padStart(5)}%  ${String(v.calls).padStart(4)}×  ${k}`);
  }
}
const runs = dates.filter((d) => mainSession(d)).length;
console.log(`\n${runs} run(s) · $${grand.toFixed(2)} · $${runs ? (grand / runs).toFixed(2) : '0'}/run at API list prices`);
console.log('Cost ≈ turns × context size. Both levers are the same lever: keep less in the room, for less time.');
