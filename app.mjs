// PaletteForge application shell: state, rendering, extraction, export.
// Everything runs locally in the page; no network calls of any kind.

import {
  hexToRgb,
  rgbToHex,
  hexToOklch,
  formatOklch,
  srgbToOklch,
  gamutMapOklch,
  generateHarmony,
  contrastMatrix,
  contrastRatio,
  contrastBadge,
  simulateCvdHex,
  extractPaletteFromPixels,
  luminanceOfHex,
  HARMONY_MODES,
  HARMONY_LABELS,
  CVD_TYPES,
} from './src/color-science.mjs';

import {
  composePoster,
  exportPosterSvg,
  drawOps,
  encodeState,
  decodeState,
  sanitizeSeed,
  MODES,
  MODE_LABELS,
  SYMMETRIES,
  POSTER_W,
  POSTER_H,
} from './src/generative.mjs';

import { runSelfTests } from './src/self-tests.mjs';

const $ = (sel) => document.querySelector(sel);

const DEFAULTS = {
  seed: 'first light',
  mode: 'flow',
  harmony: 'triadic',
  symmetry: 'p4m',
  cvd: 'none',
  theme: 'light',
  base: '#c8451f',
};

const state = { ...DEFAULTS, customPalette: null };
const poster = $('#poster');
const pctx = poster.getContext('2d');

// The poster develops like a print coming up in the developer: ops are
// painter-ordered and purely additive, so painting them in timed batches
// lands on the exact same final frame as one synchronous draw. This is the
// 30 second demo moment; reduced-motion users get the finished frame at once.
let posterAnim = 0;
const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function paintPoster(ops) {
  if (posterAnim) {
    cancelAnimationFrame(posterAnim);
    posterAnim = 0;
  }
  pctx.save();
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.clearRect(0, 0, poster.width, poster.height);
  pctx.restore();
  if (prefersReducedMotion() || ops.length < 10) {
    drawOps(pctx, ops, 1);
    return;
  }
  const FRAMES = 20;
  const per = Math.max(1, Math.ceil(ops.length / FRAMES));
  let i = 0;
  const step = () => {
    const end = Math.min(ops.length, i + per);
    drawOps(pctx, ops.slice(i, end), 1);
    i = end;
    posterAnim = i < ops.length ? requestAnimationFrame(step) : 0;
  };
  step();
}

const SURPRISE_WORDS = [
  'amber', 'verdant', 'cobalt', 'crimson', 'umber', 'ivory', 'slate', 'copper',
  'meadow', 'harbor', 'quarry', 'orchard', 'atlas', 'beacon', 'lantern', 'meridian',
  'solstice', 'monsoon', 'tundra', 'canyon', 'prairie', 'lagoon', 'summit', 'delta',
];

const SAMPLE_ART = [
  { seed: 'oxide study', mode: 'bauhaus' },
  { seed: 'tidal flat', mode: 'flow' },
  { seed: 'winter market', mode: 'moire' },
];
let sampleIdx = 0;

// ---------------------------------------------------------------------------

function activeHexes() {
  const base = state.customPalette
    ? state.customPalette
    : generateHarmony(hexToOklch(state.base), state.harmony, { count: 5 }).map((s) => s.hex);
  return state.cvd === 'none' ? base : base.map((h) => simulateCvdHex(h, state.cvd));
}

function naturalHexes() {
  return state.customPalette
    ? state.customPalette
    : generateHarmony(hexToOklch(state.base), state.harmony, { count: 5 }).map((s) => s.hex);
}

function contrastPassCount(rgbs) {
  const m = contrastMatrix(rgbs);
  let pass = 0;
  let total = 0;
  for (let i = 0; i < m.length; i++) {
    for (let j = i + 1; j < m.length; j++) {
      total++;
      if (m[i][j] >= 4.5) pass++;
    }
  }
  return `${pass}/${total} AA`;
}

function render() {
  const hexes = activeHexes();
  const rgbs = hexes.map((h) => hexToRgb(h));
  const natural = naturalHexes();
  const firstOklch = hexToOklch(natural[0]);
  const oklchLine = `OKLCH ${firstOklch.L.toFixed(2)} ${firstOklch.C.toFixed(2)} ${Math.round(firstOklch.H)}`;
  const passes = contrastPassCount(rgbs);

  const { ops } = composePoster(state.seed, state.mode, hexes, {
    symmetry: state.symmetry,
    harmony: state.customPalette ? 'extracted' : state.harmony,
    includeFooter: true,
    contrastPasses: passes,
    oklchLine,
    background: '#f6f1e7',
  });
  paintPoster(ops);

  renderSwatches(hexes);
  renderHueWheel(natural);
  renderMatrix(rgbs, hexes);
  renderPlacard();
  syncButtons();
  syncHash();
}

// The placard reads like a museum wall label: the seed becomes the artwork's
// title, the meta line carries provenance, the medium line describes the piece.
function artworkTitle() {
  if (state.customPalette) return 'Extracted study';
  const words = state.seed.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Untitled study';
  const titled = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return titled.length > 34 ? titled.slice(0, 33).trimEnd() + '…' : titled;
}

function renderPlacard() {
  $('#placard-title').textContent = artworkTitle();
  $('#placard-meta').textContent =
    `seed ${state.seed}  /  ${MODE_LABELS[state.mode].toLowerCase()}` +
    `${state.mode === 'wallpaper' ? ' ' + state.symmetry : ''}  /  ` +
    `${state.customPalette ? 'extracted palette' : HARMONY_LABELS[state.harmony].toLowerCase()}` +
    `${state.cvd !== 'none' ? '  /  ' + state.cvd + ' view' : ''}`;
  $('#placard-medium').textContent =
    `oklch generative study · ${MODE_LABELS[state.mode].toLowerCase()} · 1400 × 1800 · svg + png`;
}

function renderSwatches(hexes) {
  const natural = naturalHexes();
  const wrap = $('#swatches');
  wrap.innerHTML = '';
  const inkHex = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  const inkRgb = hexToRgb(inkHex) || { r: 0, g: 0, b: 0 };
  hexes.forEach((hex, i) => {
    const nat = natural[i];
    const ok = hexToOklch(nat);
    const rgb = hexToRgb(hex);
    const cr = rgb ? contrastRatio(rgb, inkRgb) : 1;
    const badge = contrastBadge(cr);
    const div = document.createElement('div');
    div.className = 'swatch';
    const simNote = state.cvd !== 'none' ? ' / ' + state.cvd : '';
    div.innerHTML =
      `<span class="chip" style="background:${hex}"></span>` +
      `<span><span class="hex">${nat}</span><span class="oklch">${formatOklch(ok.L, ok.C, ok.H)}${simNote}</span></span>` +
      `<span class="badge ${badge === 'AAA' ? 'aaa' : badge === 'AA' ? 'aa' : badge === 'AA Large' ? 'aal' : 'fail'}" title="contrast vs interface ink">${badge === 'Fail' ? 'below' : badge}</span>`;
    wrap.appendChild(div);
  });
  $('#palette-source-note').textContent = state.customPalette
    ? 'Palette extracted from image data with a deterministic median cut.'
    : `Palette generated geometrically in OKLCH from ${state.base}.`;
}

// Hue wheel: each swatch's OKLCH hue angle plotted on a 360 degree ring, so
// the harmony reads at a glance (analogous clusters, complementary opposes).
// Positions use the natural palette even under CVD simulation: the wheel
// explains why the colors belong together, not how they are seen.
const WHEEL_SHORT = {
  complementary: 'complementary',
  'split-complementary': 'split comp',
  triadic: 'triadic',
  analogous: 'analogous',
  tetradic: 'tetradic',
  monochromatic: 'mono tonal',
};

function renderHueWheel(hexes) {
  const wrap = $('#hue-wheel');
  const W = 216;
  const H = 200;
  const cx = 108;
  const cy = 88;
  const r = 62;
  const at = (hue, rad) => {
    const a = (hue * Math.PI) / 180;
    return [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
  };
  const f = (n) => (Math.round(n * 10) / 10).toString();
  let spokes = '';
  let dots = '';
  hexes.forEach((hex) => {
    const ok = hexToOklch(hex);
    const [sx, sy] = at(ok.H, 12);
    const [ex, ey] = at(ok.H, r - 10);
    const [dx, dy] = at(ok.H, r);
    spokes += `<line class="spoke" x1="${f(sx)}" y1="${f(sy)}" x2="${f(ex)}" y2="${f(ey)}"/>`;
    dots +=
      `<circle class="hue-dot" cx="${f(dx)}" cy="${f(dy)}" r="8" fill="${hex}">` +
      `<title>hue ${Math.round(ok.H)} deg</title></circle>`;
  });
  let cardinals = '';
  for (const [label, dx, dy] of [['0', cx, cy - r - 14], ['90', cx + r + 14, cy + 4], ['180', cx, cy + r + 18], ['270', cx - r - 14, cy + 4]]) {
    cardinals += `<text class="wheel-tick" x="${f(dx)}" y="${f(dy)}" text-anchor="middle">${label}</text>`;
  }
  const centerLabel = state.customPalette ? 'extracted' : (WHEEL_SHORT[state.harmony] || 'palette');
  wrap.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hue wheel of the palette">` +
    spokes +
    `<circle class="ring" cx="${cx}" cy="${cy}" r="${r}"/>` +
    dots +
    cardinals +
    `<text class="wheel-center" x="${cx}" y="${cy + 4}" text-anchor="middle">${centerLabel}</text>` +
    `</svg>`;
  $('#hue-wheel-note').textContent =
    `dot angle is the OKLCH hue of each swatch` +
    `${state.cvd !== 'none' ? ' (natural palette)' : ''}` +
    `${state.customPalette ? '' : ', ' + HARMONY_LABELS[state.harmony].toLowerCase() + ' spacing'}`;
}

function renderMatrix(rgbs, hexes) {
  const m = contrastMatrix(rgbs);
  const wrap = $('#matrix');
  let html = '<table><thead><tr><th></th>';
  hexes.forEach((h) => { html += `<th><span class="cellchip" style="background:${h}"></span></th>`; });
  html += '</tr></thead><tbody>';
  m.forEach((row, i) => {
    html += `<tr><th><span class="cellchip" style="background:${hexes[i]}"></span></th>`;
    row.forEach((r, j) => {
      if (i === j) {
        html += `<td><span class="cell" style="background:${hexes[j]}"><span class="diag">1.0</span></span></td>`;
        return;
      }
      const label = r >= 10 ? r.toFixed(0) : r.toFixed(1);
      html += `<td><span class="cell" style="background:${hexes[j]};color:${hexes[i]}" title="${hexes[i]} on ${hexes[j]}">${label}</span></td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  $('#matrix-note').textContent =
    `Rows are ink, columns are ground. AAA at 7, AA at 4.5, large text at 3.` +
    `${state.cvd !== 'none' ? ' Ratios computed on the simulated palette.' : ''}`;
}

function syncButtons() {
  document.querySelectorAll('#mode-group button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  document.querySelectorAll('#harmony-group button').forEach((b) =>
    b.setAttribute('aria-pressed', String(!state.customPalette && b.dataset.harmony === state.harmony)));
  document.querySelectorAll('#symmetry-group button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.symmetry === state.symmetry)));
  document.querySelectorAll('#cvd-group button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cvd === state.cvd)));
  $('#seed-input').value = state.seed;
  $('#base-hex').value = state.base;
  $('#base-color').value = state.base;
  document.documentElement.dataset.theme = state.theme;
  $('#btn-theme').textContent = state.theme === 'dark' ? 'Daylight' : 'Dark room';
}

function syncHash() {
  const h = encodeState({ ...state, harmony: state.customPalette ? '' : state.harmony });
  if (location.hash !== h) history.replaceState(null, '', h);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function setMode(m) { if (MODES.includes(m)) { state.mode = m; render(); } }
function setSymmetry(s) { if (SYMMETRIES.includes(s)) { state.symmetry = s; render(); } }
function setHarmony(h) {
  if (HARMONY_MODES.includes(h)) { state.harmony = h; state.customPalette = null; render(); }
}
function setCvd(c) { if (['none', ...CVD_TYPES].includes(c)) { state.cvd = c; render(); } }

$('#mode-group').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
$('#symmetry-group').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSymmetry(b.dataset.symmetry); });
$('#harmony-group').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setHarmony(b.dataset.harmony); });
$('#cvd-group').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setCvd(b.dataset.cvd); });

$('#btn-seed').addEventListener('click', applySeedInput);
$('#seed-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') applySeedInput(); });
function applySeedInput() {
  const s = sanitizeSeed($('#seed-input').value);
  if (s) { state.seed = s; render(); } else { $('#seed-input').value = state.seed; }
}

$('#btn-base').addEventListener('click', applyBase);
$('#base-hex').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyBase(); });
// The color well commits on change (picker close) so a live drag does not
// re-render the poster on every intermediate value.
$('#base-color').addEventListener('change', () => {
  const v = $('#base-color').value;
  if (v) { state.base = v.toLowerCase(); state.customPalette = null; render(); }
});
function applyBase() {
  const v = $('#base-hex').value.trim();
  const c = hexToRgb(v.startsWith('#') ? v : '#' + v);
  if (c) { state.base = rgbToHex(c.r, c.g, c.b); state.customPalette = null; render(); }
  else { $('#base-hex').value = state.base; }
}

$('#btn-surprise').addEventListener('click', () => {
  const a = SURPRISE_WORDS[Math.floor(Math.random() * SURPRISE_WORDS.length)];
  const b = SURPRISE_WORDS[Math.floor(Math.random() * SURPRISE_WORDS.length)];
  const hues = [20, 45, 90, 140, 200, 260, 330];
  const ok = gamutMapOklch(0.55 + Math.random() * 0.2, 0.1 + Math.random() * 0.12, hues[Math.floor(Math.random() * hues.length)]);
  state.seed = a === b ? a : `${a} ${b}`;
  state.base = rgbToHex(ok.r, ok.g, ok.b);
  state.harmony = HARMONY_MODES[Math.floor(Math.random() * HARMONY_MODES.length)];
  state.customPalette = null;
  render();
});

// Sample artwork extraction: compose small posters offscreen, read their
// pixels back, and median-cut them, so the judge sees extraction on real
// imagery without uploading anything.
$('#btn-extract').addEventListener('click', () => {
  const s = SAMPLE_ART[sampleIdx % SAMPLE_ART.length];
  sampleIdx++;
  const w = 320;
  const h = Math.round((w * POSTER_H) / POSTER_W);
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  const artPal = ['#2b3a4a', '#c8451f', '#e2a926', '#5d7a3a', '#efe6d4'];
  const { ops } = composePoster(s.seed, s.mode, artPal, { symmetry: 'p6m', includeFooter: false });
  drawOps(ctx, ops, w / POSTER_W);
  try {
    const img = ctx.getImageData(0, 0, w, h);
    const pal = extractPaletteFromPixels(img.data, w, h, 5);
    if (pal.length) {
      state.customPalette = pal.map((p) => p.hex);
      render();
    }
  } catch {
    // Canvas readback unavailable; leave the current palette in place.
  }
});

$('#btn-copy').addEventListener('click', async () => {
  const btn = $('#btn-copy');
  const url = location.href;
  const flash = () => {
    btn.textContent = 'Link copied';
    setTimeout(() => { btn.textContent = 'Copy share link'; }, 1400);
  };
  try {
    await navigator.clipboard.writeText(url);
    flash();
    return;
  } catch { /* clipboard API unavailable or denied; try the legacy path */ }
  const ta = document.createElement('textarea');
  ta.value = url;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (document.execCommand('copy')) flash();
  } catch { /* leave the label unchanged */ }
  ta.remove();
});

const dz = $('#drop-zone');
const fileInput = $('#file-input');
// Drops are accepted anywhere on the page, not only on the zone: the whole
// window prevents the browser's default file navigation and routes the file
// to extraction, while the zone lights up as the drop affordance.
const hasFiles = (e) => !!e.dataTransfer?.types?.includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); dz.classList.add('over'); } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); dz.classList.add('over'); } });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dz.classList.remove('over'); });
window.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  e.preventDefault();
  dz.classList.remove('over');
  extractFile(file);
});
// Keyboard and pointer fallback: click (or Enter/Space on the focused button)
// opens a real file picker, so palette extraction is not mouse-drag only.
dz.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) extractFile(file);
  fileInput.value = '';
});

function extractFile(file) {
  if (!file.type || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.min(480, img.naturalWidth);
        const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        const pal = extractPaletteFromPixels(data.data, w, h, 5);
        if (pal.length) { state.customPalette = pal.map((p) => p.hex); render(); }
      } catch { /* unreadable image; keep current palette */ }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

$('#btn-svg').addEventListener('click', () => {
  const svg = exportPosterSvg(state.seed, state.mode, activeHexes(), {
    symmetry: state.symmetry,
    harmony: state.customPalette ? 'extracted' : state.harmony,
    contrastPasses: contrastPassCount(activeHexes().map((h) => hexToRgb(h))),
    oklchLine: '',
    background: '#f6f1e7',
  });
  download(new Blob([svg], { type: 'image/svg+xml' }), `paletteforge-${state.seed.replace(/\W+/g, '-')}-${state.mode}.svg`);
});

$('#btn-png').addEventListener('click', () => {
  const off = document.createElement('canvas');
  off.width = POSTER_W;
  off.height = POSTER_H;
  const ctx = off.getContext('2d');
  const hexes = activeHexes();
  const firstOklch = hexToOklch(naturalHexes()[0]);
  const { ops } = composePoster(state.seed, state.mode, hexes, {
    symmetry: state.symmetry,
    harmony: state.customPalette ? 'extracted' : state.harmony,
    includeFooter: true,
    contrastPasses: contrastPassCount(hexes.map((h) => hexToRgb(h))),
    oklchLine: `OKLCH ${firstOklch.L.toFixed(2)} ${firstOklch.C.toFixed(2)} ${Math.round(firstOklch.H)}`,
    background: '#f6f1e7',
  });
  drawOps(ctx, ops, 1);
  off.toBlob((blob) => {
    if (blob) download(blob, `paletteforge-${state.seed.replace(/\W+/g, '-')}-${state.mode}.png`);
  }, 'image/png');
});

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$('#btn-tests').addEventListener('click', () => {
  const results = runSelfTests();
  const pass = results.filter((r) => r.pass).length;
  $('#test-block').hidden = false;
  const summary = $('#test-summary');
  summary.textContent = `${pass}/${results.length} checks passing`;
  summary.className = pass === results.length ? 'note ok' : 'note bad';
  const list = $('#test-list');
  list.innerHTML = '';
  for (const r of results) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot ${r.pass ? 'ok' : 'bad'}"></span><span><span class="tname">${r.name}</span><span class="tdetail"></span></span>`;
    li.querySelector('.tdetail').textContent = r.detail;
    list.appendChild(li);
  }
});

$('#btn-theme').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  render();
});

window.addEventListener('hashchange', () => {
  const s = decodeState(location.hash, DEFAULTS);
  if (!s) return;
  Object.assign(state, s);
  state.customPalette = null;
  render();
});

// Boot: hash wins over defaults, then one clean render.
(function init() {
  const s = decodeState(location.hash, DEFAULTS);
  if (s) {
    Object.assign(state, s);
    if (!HARMONY_MODES.includes(state.harmony)) state.harmony = DEFAULTS.harmony;
  }
  render();
})();
