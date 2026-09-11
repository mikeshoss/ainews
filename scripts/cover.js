#!/usr/bin/env node
'use strict';
// Podcast cover generator. Produces a 3000×3000 SVG whose background is a blurred field of colour, one blob per
// section sized by that section's share of the day's items, placed at positions seeded by the date — unique per day,
// reproducible from the JSON. Text on top: show title, presenter, the date, and a proportional "spectrum bar".
// Usage: node scripts/cover.js data/DATE.json out.svg      (episode cover)
//        node scripts/cover.js --show [--variant prism|edge|line|aurora] out.svg   (show-level cover)
//        node scripts/cover.js --favicon out.svg | --og out.svg                    (site icon, social share image)
// Rasterise with scripts/rasterize.sh (librsvg).

const fs = require('fs');
const path = require('path');
const { longDate, dateObj, SECTION_COLORS, PODCAST, sectionWeights } = require('./lib.js');

const SIZE = 3000;
const M = 200; // margin
const FONT = "'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Deterministic PRNG (mulberry32) seeded from a string, so the same date always yields the same layout.
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function colourField(weights, seed) {
  const rand = rng(seed);
  const defs = [], blobs = [];
  // Largest first so smaller sections stay visible on top.
  [...weights].sort((a, b) => b.share - a.share).forEach((w, i) => {
    const r = Math.round(420 + 1500 * Math.sqrt(w.share));
    const cx = Math.round(M + rand() * (SIZE - 2 * M));
    const cy = Math.round(M + rand() * (SIZE - 2 * M));
    const id = `g${i}`;
    defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${w.hex}" stop-opacity="0.95"/><stop offset="0.55" stop-color="${w.hex}" stop-opacity="0.55"/><stop offset="1" stop-color="${w.hex}" stop-opacity="0"/></radialGradient>`);
    blobs.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`);
  });
  return { defs: defs.join(''), blobs: blobs.join('') };
}

function spectrumBar(weights, y, h) {
  const gap = 14, x0 = M, width = SIZE - 2 * M - gap * (weights.length - 1);
  let x = x0;
  const segs = weights.map((w) => { const sw = Math.max(24, Math.round(width * w.share)); const s = `<rect x="${x}" y="${y}" width="${sw}" height="${h}" rx="${h / 2}" fill="${w.hex}"/>`; x += sw + gap; return s; });
  return segs.join('');
}

function coverSvg(ed) {
  const show = !ed;
  const weights = show
    ? Object.entries(SECTION_COLORS).map(([name, c]) => ({ name, share: 1 / 8, count: 0, ...c }))
    : sectionWeights(ed);
  const seed = show ? 'the-ai-edge-show' : ed.date;
  const field = colourField(weights, seed);
  const monday = !show && ed.edition === 'monday';
  const total = show ? 0 : weights.reduce((a, w) => a + w.count, 0);
  const legend = show ? PODCAST.tagline : weights.slice(0, 4).map((w) => `${w.short} ${Math.round(w.share * 100)}%`).join('  ·  ');

  let dateBlock = '';
  if (!show) {
    const d = dateObj(ed.date);
    const weekday = longDate(ed.date).split(',')[0];
    const rest = longDate(ed.date).split(', ')[1];
    dateBlock = `
  <text x="${M}" y="1930" font-family="${FONT}" font-size="170" font-weight="500" fill="#ffffff" fill-opacity="0.82">${esc(weekday)}</text>
  <text x="${M}" y="2200" font-family="${FONT}" font-size="250" font-weight="700" fill="#ffffff" letter-spacing="-6">${esc(rest)}</text>
  <text x="${M}" y="2340" font-family="${FONT}" font-size="96" font-weight="500" fill="#ffffff" fill-opacity="0.62">${esc(monday ? 'Monday edition · with the week in review' : 'Daily edition')}${total ? esc(` · ${total} items`) : ''}</text>`;
    void d;
  } else {
    dateBlock = `
  <text x="${M}" y="2200" font-family="${FONT}" font-size="150" font-weight="500" fill="#ffffff" fill-opacity="0.82">${esc(PODCAST.tagline)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<defs>
  ${field.defs}
  <filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="170"/></filter>
  <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.58"/><stop offset="0.45" stop-color="#000" stop-opacity="0.30"/><stop offset="1" stop-color="#000" stop-opacity="0.62"/></linearGradient>
</defs>
<rect width="${SIZE}" height="${SIZE}" fill="#0f0f10"/>
<g filter="url(#blur)">${field.blobs}</g>
<rect width="${SIZE}" height="${SIZE}" fill="url(#shade)"/>
<text x="${M}" y="540" font-family="${FONT}" font-size="310" font-weight="800" fill="#ffffff" letter-spacing="14">${esc(PODCAST.title.toUpperCase())}</text>
<text x="${M}" y="690" font-family="${FONT}" font-size="112" font-weight="500" fill="#ffffff" fill-opacity="0.72">presented by ${esc(PODCAST.presenter)}</text>
${dateBlock}
${spectrumBar(weights, 2610, 64)}
<text x="${M}" y="2790" font-family="${FONT}" font-size="72" font-weight="500" fill="#ffffff" fill-opacity="0.7">${esc(legend)}</text>
</svg>
`;
}


// ---------- show-level cover variants ----------
const ALL = Object.entries(SECTION_COLORS).map(([name, c]) => ({ name, ...c }));
const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`;
const title = (x, y, size, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" font-weight="800" fill="#ffffff" letter-spacing="${Math.round(size * 0.045)}">${esc(PODCAST.title.toUpperCase())}</text>`;
const sub = (x, y, size, text, anchor = 'start', op = 0.72) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" font-weight="500" fill="#ffffff" fill-opacity="${op}">${esc(text)}</text>`;

const SHOW_VARIANTS = {
  // A. Prism: eight vertical bands blurred into a spectrum, title centred on a dark band.
  prism: () => `${head}
<defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="120"/></filter>
<linearGradient id="dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f0f10" stop-opacity="0"/><stop offset="0.38" stop-color="#0f0f10" stop-opacity="0.92"/><stop offset="0.62" stop-color="#0f0f10" stop-opacity="0.92"/><stop offset="1" stop-color="#0f0f10" stop-opacity="0"/></linearGradient></defs>
<rect width="${SIZE}" height="${SIZE}" fill="#0f0f10"/>
<g filter="url(#b)">${ALL.map((c, i) => `<rect x="${i * (SIZE / 8) - 60}" y="-200" width="${SIZE / 8 + 120}" height="${SIZE + 400}" fill="${c.hex}" fill-opacity="0.85"/>`).join('')}</g>
<rect width="${SIZE}" height="${SIZE}" fill="url(#dark)"/>
${title(SIZE / 2, 1560, 330, 'middle')}
${sub(SIZE / 2, 1720, 112, `presented by ${PODCAST.presenter}`, 'middle')}
</svg>
`,
  // B. Edge: a hard diagonal edge — dark left with stacked title, the full spectrum sweeping in from the right.
  edge: () => `${head}
<defs><linearGradient id="sweep" x1="0" y1="0" x2="1" y2="1">${ALL.map((c, i) => `<stop offset="${(i / 7).toFixed(3)}" stop-color="${c.hex}"/>`).join('')}</linearGradient>
<linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0f0f10" stop-opacity="0.55"/><stop offset="1" stop-color="#0f0f10" stop-opacity="0.15"/></linearGradient></defs>
<rect width="${SIZE}" height="${SIZE}" fill="#0f0f10"/>
<polygon points="2150,0 3000,0 3000,3000 1650,3000" fill="url(#sweep)"/>
<polygon points="2150,0 3000,0 3000,3000 1650,3000" fill="url(#fade)"/>
<polygon points="2150,0 2200,0 1700,3000 1650,3000" fill="#ffffff" fill-opacity="0.92"/>
<text x="${M}" y="1330" font-family="${FONT}" font-size="330" font-weight="800" fill="#ffffff" letter-spacing="14">THE AI</text>
<text x="${M}" y="1660" font-family="${FONT}" font-size="330" font-weight="800" fill="#ffffff" letter-spacing="14">EDGE</text>
${sub(M, 1830, 112, `presented by ${PODCAST.presenter}`)}
${sub(M, 2760, 84, PODCAST.tagline, 'start', 0.55)}
</svg>
`,
  // C. Line: dark, quiet, centred type with a single rainbow "edge" line as the hero.
  line: () => `${head}
<defs><linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">${ALL.map((c, i) => `<stop offset="${(i / 7).toFixed(3)}" stop-color="${c.hex}"/>`).join('')}</linearGradient>
<filter id="glow" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="60"/></filter></defs>
<rect width="${SIZE}" height="${SIZE}" fill="#0f0f10"/>
<rect x="${M}" y="1640" width="${SIZE - 2 * M}" height="80" rx="40" fill="url(#rule)" filter="url(#glow)" opacity="0.9"/>
<rect x="${M}" y="1650" width="${SIZE - 2 * M}" height="60" rx="30" fill="url(#rule)"/>
${title(SIZE / 2, 1500, 340, 'middle')}
${sub(SIZE / 2, 1900, 118, `presented by ${PODCAST.presenter}`, 'middle')}
${sub(SIZE / 2, 2760, 84, PODCAST.tagline, 'middle', 0.5)}
</svg>
`,
  // D. Aurora: the daily colour field at full strength, no top shading, title anchored bottom-left on a dark band.
  aurora: () => {
    const weights = ALL.map((c) => ({ ...c, share: 1 / 8 }));
    const field = colourField(weights, 'the-ai-edge-aurora');
    return `${head}
<defs>${field.defs}<filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="150"/></filter>
<linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f0f10" stop-opacity="0"/><stop offset="0.55" stop-color="#0f0f10" stop-opacity="0.15"/><stop offset="1" stop-color="#0f0f10" stop-opacity="0.9"/></linearGradient></defs>
<rect width="${SIZE}" height="${SIZE}" fill="#0f0f10"/>
<g filter="url(#blur)">${field.blobs}</g>
<rect width="${SIZE}" height="${SIZE}" fill="url(#foot)"/>
${title(M, 2440, 330)}
${sub(M, 2600, 112, `presented by ${PODCAST.presenter}`)}
${sub(M, 2780, 84, PODCAST.tagline, 'start', 0.55)}
</svg>
`;
  },
};

// Favicon: dark rounded square with the spectrum rule — reads at 16px.
function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="0">${ALL.map((c, i) => `<stop offset="${(i / 7).toFixed(3)}" stop-color="${c.hex}"/>`).join('')}</linearGradient></defs>
<rect width="256" height="256" rx="56" fill="#121212"/>
<rect x="40" y="108" width="176" height="40" rx="20" fill="url(#r)"/>
</svg>
`;
}

// Open Graph image (1200×630): the "line" design, wide.
function ogSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="0">${ALL.map((c, i) => `<stop offset="${(i / 7).toFixed(3)}" stop-color="${c.hex}"/>`).join('')}</linearGradient>
<filter id="g" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="18"/></filter></defs>
<rect width="1200" height="630" fill="#0f0f10"/>
<text x="80" y="300" font-family="${FONT}" font-size="118" font-weight="800" fill="#ffffff" letter-spacing="5">${esc(PODCAST.title.toUpperCase())}</text>
<rect x="80" y="338" width="1040" height="26" rx="13" fill="url(#r)" filter="url(#g)" opacity="0.9"/>
<rect x="80" y="341" width="1040" height="20" rx="10" fill="url(#r)"/>
<text x="80" y="428" font-family="${FONT}" font-size="40" font-weight="500" fill="#ffffff" fill-opacity="0.72">presented by ${esc(PODCAST.presenter)}</text>
<text x="80" y="560" font-family="${FONT}" font-size="30" font-weight="500" fill="#ffffff" fill-opacity="0.5">${esc(PODCAST.tagline)}</text>
</svg>
`;
}

const DEFAULT_SHOW_VARIANT = 'line';
function showCoverSvg(variant = DEFAULT_SHOW_VARIANT) {
  const fn = SHOW_VARIANTS[variant];
  if (!fn) throw new Error(`unknown show cover variant "${variant}" (${Object.keys(SHOW_VARIANTS).join(', ')})`);
  return fn();
}

module.exports = { coverSvg, showCoverSvg, faviconSvg, ogSvg, SHOW_VARIANTS };

if (require.main === module) {
  const a = process.argv.slice(2);
  const show = a.includes('--show');
  const out = a[a.length - 1];
  if (a.includes('--favicon')) fs.writeFileSync(out, faviconSvg());
  else if (a.includes('--og')) fs.writeFileSync(out, ogSvg());
  else if (show) {
    const vi = a.indexOf('--variant');
    fs.writeFileSync(out, showCoverSvg(vi >= 0 ? a[vi + 1] : undefined));
  } else {
    const ed = JSON.parse(fs.readFileSync(path.resolve(a[0]), 'utf8'));
    ed.sections = (ed.sections || []).filter((s) => s.items && s.items.length);
    fs.writeFileSync(out, coverSvg(ed));
  }
  console.log(`wrote ${out}`);
}
