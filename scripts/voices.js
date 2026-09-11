#!/usr/bin/env node
'use strict';
// One-off: synthesize the same passage in every gpt-4o-mini-tts voice so the hosts can be chosen by ear.
// Runs in the "Voice samples" workflow (needs OPENAI_API_KEY); writes voices/<voice>.mp3.
const fs = require('fs');
const path = require('path');

const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const TEXT = "Good morning. It's Friday, September 11th, and this is The AI Edge, presented by Epilogue. Today: Anthropic says a Russian intelligence group used Claude against more than 20 government and defence organisations. And Oracle reported remaining performance obligations of $664 billion, up $209 billion year over year. That's a company figure — contracted revenue not yet recognised. Let's get into it.";
const INSTRUCTIONS = 'You are a co-host of a calm, credible morning news briefing about AI. Conversational and warm, natural pacing, no dramatisation or sales energy. Read numbers, currencies, percentages and acronyms clearly. Brief natural pauses at commas and full stops.';

const out = path.resolve(__dirname, '..', 'voices');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.log('OPENAI_API_KEY not set'); process.exit(1); }
  for (const voice of VOICES) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: TEXT, instructions: INSTRUCTIONS, response_format: 'mp3' }),
    });
    if (!res.ok) { console.log(`${voice}: ${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
    fs.writeFileSync(path.join(out, `${voice}.mp3`), Buffer.from(await res.arrayBuffer()));
    console.log(`${voice}: ok`);
  }
  fs.writeFileSync(path.join(out, 'text.txt'), TEXT + '\n');
})();
