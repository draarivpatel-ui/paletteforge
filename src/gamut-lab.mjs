// PaletteForge gamut-cusp and CVD-separability calibration lab.
// Pure-JS FIPS 180-4 SHA-256, constant-hue sRGB gamut boundary bisection in
// the OKLCH (L, C) slice, a six-harmony by four-vision WCAG and Delta-E_OK
// comparator, and a digest-stamped audited brief exporter (JSON, formula
// safe CSV, Markdown). Deterministic by construction: no clocks, no
// randomness, no dependencies. Runs in Node and in the browser.

import {
  hexToRgb,
  rgbToHex,
  hexToOklch,
  oklchToSrgb,
  isInSrgbGamut,
  gamutMapOklch,
  srgbToLinear,
  linearSrgbToOklab,
  contrastRatio,
  simulateCvdHex,
  generateHarmony,
  wrapHue,
  formatOklch,
  HARMONY_MODES,
  CVD_TYPES,
} from './color-science.mjs';
import { sanitizePalette } from './report.mjs';

const finiteOr = (v, fallback) => (Number.isFinite(v) ? v : fallback);

// ---------------------------------------------------------------------------
// UTF-8 and FIPS 180-4 SHA-256. The whole brief digest chain runs on this
// implementation so the page proves provenance with zero crypto imports.
// ---------------------------------------------------------------------------

export function utf8Bytes(str) {
  const s = String(str);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      } else {
        cp = 0xfffd;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = 0xfffd;
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

// message: string (encoded UTF-8) or array/typed array of byte values.
export function sha256Hex(message) {
  const bytes = typeof message === 'string' ? utf8Bytes(message) : [...message];
  const len = bytes.length;
  const padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  const bitLenHi = Math.floor(len / 0x20000000);
  const bitLenLo = (len << 3) >>> 0;
  padded.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255);
  padded.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// Canonical JSON: object keys sorted recursively, undefined and non-finite
// numbers normalized to null, cycles serialized as null, so identical content
// always hashes identically regardless of property insertion order.
export function canonicalJson(v, seen = new WeakSet()) {
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return 'null';
  if (v === null || typeof v !== 'object') {
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
  }
  if (seen.has(v)) return 'null';
  seen.add(v);
  const out = Array.isArray(v)
    ? '[' + v.map((x) => canonicalJson(x, seen)).join(',') + ']'
    : '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k], seen))
        .join(',') +
      '}';
  seen.delete(v);
  return out;
}

// ---------------------------------------------------------------------------
// Exact sRGB gamut boundary in the OKLCH (L, C) slice at constant hue.
// C_max(L, H) is bisected with a zero tolerance gamut test, so the slice ends
// exactly at the achromatic axis: C_max(0) = C_max(1) = 0 for every hue.
// ---------------------------------------------------------------------------

export const GAMUT_C_CEILING = 0.5;
export const GAMUT_SLICE_STEPS = 120;

export function gamutBoundaryC(L, H, iterations = 48) {
  if (!Number.isFinite(L) || !Number.isFinite(H)) return 0;
  if (L <= 0 || L >= 1) return 0;
  const h = wrapHue(H);
  const inG = (c) => isInSrgbGamut(oklchToSrgb(L, c, h), 0);
  if (inG(GAMUT_C_CEILING)) return GAMUT_C_CEILING;
  let lo = 0;
  let hi = GAMUT_C_CEILING;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (inG(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// The (L, C) silhouette at hue H plus its cusp: the point of maximum chroma,
// the most saturated displayable color at that hue.
export function gamutSlice(H, steps = GAMUT_SLICE_STEPS) {
  const hue = Number.isFinite(H) ? wrapHue(H) : 0;
  const n = Math.max(2, Math.min(512, Math.floor(finiteOr(steps, GAMUT_SLICE_STEPS))));
  const points = [];
  let cusp = { L: 0.5, C: 0 };
  for (let i = 0; i <= n; i++) {
    const L = i / n;
    const C = gamutBoundaryC(L, hue);
    points.push({ L, C });
    if (C > cusp.C) cusp = { L, C };
  }
  return { H: hue, points, cusp };
}

// Projects an OKLCH triple onto the slice: the raw point, whether it sits
// inside the hull, and the chroma-clipped landing point at constant hue and
// lightness (the head of the clip vector).
export function projectToSlice(L, C, H) {
  const Lc = Number.isFinite(L) ? Math.min(1, Math.max(0, L)) : 0;
  const Cc = Number.isFinite(C) ? Math.max(0, C) : 0;
  const h = Number.isFinite(H) ? wrapHue(H) : 0;
  const rgb = oklchToSrgb(Lc, Cc, h);
  const inGamut = Lc > 0 && Lc < 1 ? isInSrgbGamut(rgb, 0) : Cc === 0;
  const m = gamutMapOklch(Lc, Cc, h);
  return { L: Lc, C: Cc, H: h, inGamut, mapped: { L: m.L, C: m.C, hex: rgbToHex(m.r, m.g, m.b) } };
}

// ---------------------------------------------------------------------------
// Oklab Delta-E (perceptual distance) and pairwise separability.
// ---------------------------------------------------------------------------

export function oklabOfHex(hex) {
  const c = hexToRgb(hex);
  if (!c) return null;
  return linearSrgbToOklab(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b));
}

export function deltaEOK(labA, labB) {
  if (!labA || !labB) return NaN;
  return Math.hypot(labA.L - labB.L, labA.a - labB.a, labA.b - labB.b);
}

export function deltaEOKHex(hexA, hexB) {
  return deltaEOK(oklabOfHex(hexA), oklabOfHex(hexB));
}

// ---------------------------------------------------------------------------
// Six-harmony by four-vision accessibility comparator. Every pass count is
// judged on the unrounded WCAG ratio, and every separability figure is the
// minimum pairwise Oklab distance inside the simulated palette.
// ---------------------------------------------------------------------------

export const LAB_VISIONS = ['none', ...CVD_TYPES];

export function visionPalette(hexes, vision) {
  return vision === 'none' ? hexes.slice() : hexes.map((h) => simulateCvdHex(h, vision));
}

// Unordered i<j pairs over a hex palette: raw-ratio WCAG pass counts at the
// three lab thresholds plus the tightest pair by Oklab distance.
export function pairwiseCellStats(hexes) {
  const list = (hexes || []).map((h) => ({ rgb: hexToRgb(h), lab: oklabOfHex(h), hex: h }));
  let pairs = 0;
  let aa = 0;
  let aaa = 0;
  let ui = 0;
  let minDelta = Infinity;
  let ti = -1;
  let tj = -1;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!a.rgb || !b.rgb || !a.lab || !b.lab) continue;
      pairs++;
      const r = contrastRatio(a.rgb, b.rgb);
      if (r >= 4.5) aa++;
      if (r >= 7) aaa++;
      if (r >= 3) ui++;
      const d = deltaEOK(a.lab, b.lab);
      if (d < minDelta) {
        minDelta = d;
        ti = i;
        tj = j;
      }
    }
  }
  const tightest =
    ti < 0
      ? null
      : { i: ti, j: tj, d: minDelta, a: list[ti].hex, b: list[tj].hex };
  return { pairs, aa, aaa, ui, minDelta: pairs ? minDelta : 0, tightest };
}

const saneBase = (base) => ({
  L: finiteOr(base?.L, 0.6),
  C: Math.max(0, finiteOr(base?.C, 0.1)),
  H: finiteOr(base?.H, 0),
});

// The full 6 x 4 grid from one OKLCH base color. Each row flags its tightest
// CVD-confusable pair: the smallest min Delta-E across the three dichromat
// simulations.
export function compareHarmonyGrid(base, opts = {}) {
  const b = saneBase(base);
  const count = opts.count ?? 5;
  return HARMONY_MODES.map((harmony) => {
    const natural = generateHarmony(b, harmony, { count }).map((s) => s.hex);
    const cells = LAB_VISIONS.map((vision) => {
      const palette = visionPalette(natural, vision);
      return { vision, palette, ...pairwiseCellStats(palette) };
    });
    let worst = null;
    for (const cell of cells) {
      if (cell.vision === 'none' || !cell.tightest) continue;
      if (!worst || cell.minDelta < worst.minDelta) {
        worst = { vision: cell.vision, minDelta: cell.minDelta, pair: cell.tightest };
      }
    }
    return { harmony, natural, cells, worst };
  });
}

// ---------------------------------------------------------------------------
// Audited color-science brief. One canonical payload per state key is stamped
// with a single SHA-256 digest; the on-page fingerprint, the JSON export, the
// CSV provenance header and the Markdown footer all carry that same digest.
// ---------------------------------------------------------------------------

const AUDIT_KIND = 'paletteforge-gamut-lab-audit';
const r6 = (x) => {
  const v = Math.round(x * 1e6) / 1e6;
  return Object.is(v, -0) ? 0 : v;
};

const cellDigest = (cell) => ({
  vision: cell.vision,
  pairs: cell.pairs,
  aa: cell.aa,
  aaa: cell.aaa,
  ui: cell.ui,
  minDeltaE: r6(cell.minDelta),
  tightest: cell.tightest
    ? { i: cell.tightest.i, j: cell.tightest.j, d: r6(cell.tightest.d), a: cell.tightest.a, b: cell.tightest.b }
    : null,
});

// stateKey: {seed, mode, harmony, symmetry, cvd, theme, base, palette}. Every
// field is coerced; malformed hexes drop out through sanitizePalette.
export function buildAuditPayload(stateKey = {}) {
  const base = sanitizePalette([stateKey.base])[0] ?? '#000000';
  const baseOklch = hexToOklch(base);
  const palette = (() => {
    const p = sanitizePalette(stateKey.palette);
    return p.length ? p : generateHarmony(baseOklch, 'triadic', { count: 5 }).map((s) => s.hex);
  })();
  const grid = compareHarmonyGrid(baseOklch);
  const slice = gamutSlice(baseOklch.H);
  return {
    brief: AUDIT_KIND,
    version: 1,
    state: {
      seed: String(stateKey.seed ?? ''),
      mode: String(stateKey.mode ?? ''),
      harmony: String(stateKey.harmony ?? ''),
      symmetry: String(stateKey.symmetry ?? ''),
      cvd: String(stateKey.cvd ?? ''),
      theme: String(stateKey.theme ?? ''),
      base,
    },
    baseOklch: { L: r6(baseOklch.L), C: r6(baseOklch.C), H: r6(baseOklch.H) },
    palette: palette.map((hex) => {
      const ok = hexToOklch(hex);
      return { hex, oklch: formatOklch(ok.L, ok.C, ok.H) };
    }),
    cusp: { hue: r6(slice.H), L: r6(slice.cusp.L), C: r6(slice.cusp.C) },
    comparator: grid.map((row) => ({
      harmony: row.harmony,
      cells: row.cells.map(cellDigest),
      worstCvd: row.worst
        ? {
            vision: row.worst.vision,
            minDeltaE: r6(row.worst.minDelta),
            pair: { i: row.worst.pair.i, j: row.worst.pair.j, a: row.worst.pair.a, b: row.worst.pair.b },
          }
        : null,
    })),
  };
}

// Digest of the payload content alone; the stamped digest field is excluded
// so verification can recompute over any stamped or unstamped copy.
export function auditDigestOf(payload) {
  const clean = { ...payload };
  delete clean.digest;
  return sha256Hex(canonicalJson(clean));
}

const auditCache = new Map();
const AUDIT_CACHE_MAX = 48;

// One cached bundle per state key: payload, digest and all three export
// renderings are computed exactly once and shared by every surface.
export function auditBundle(stateKey = {}) {
  const key = canonicalJson(stateKey);
  const hit = auditCache.get(key);
  if (hit) return hit;
  const payload = buildAuditPayload(stateKey);
  const stamped = { ...payload, digest: sha256Hex(canonicalJson(payload)) };
  const bundle = {
    digest: stamped.digest,
    payload: stamped,
    json: exportAuditJson(stamped),
    csv: exportAuditCsv(stamped),
    markdown: exportAuditMarkdown(stamped),
  };
  if (auditCache.size >= AUDIT_CACHE_MAX) auditCache.delete(auditCache.keys().next().value);
  auditCache.set(key, bundle);
  return bundle;
}

export function verifyAudit(stamped) {
  if (!stamped || typeof stamped !== 'object' || typeof stamped.digest !== 'string') return false;
  return auditDigestOf(stamped) === stamped.digest;
}

// Interactive integrity demo: the real payload verifies, then a copy with one
// flipped leaf fails, showing exactly what the digest protects.
export function tamperAuditDemo(stamped) {
  const originalVerified = verifyAudit(stamped);
  const t = JSON.parse(JSON.stringify(stamped ?? {}));
  delete t.digest;
  let field = 'state.base';
  if (t.state && typeof t.state.base === 'string') {
    t.state.base = t.state.base === '#000000' ? '#000001' : '#000000';
  } else if (Array.isArray(t.palette) && t.palette[0]) {
    field = 'palette[0].hex';
    t.palette[0].hex = t.palette[0].hex === '#000000' ? '#000001' : '#000000';
  } else {
    field = 'version';
    t.version = (t.version || 0) + 1;
  }
  const tampered = { ...t, digest: stamped?.digest };
  return {
    originalVerified,
    tamperedVerified: verifyAudit(tampered),
    field,
    tamperDetected: !verifyAudit(tampered),
  };
}

export function exportAuditJson(stamped) {
  return JSON.stringify(stamped, null, 2) + '\n';
}

// Formula-safe CSV cell. A leading trigger character (=, +, -, @, tab, CR) or
// leading whitespace earns a single-quote prefix so spreadsheet apps never
// evaluate the cell; separators and quotes then force double quoting.
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r\x0b]/.test(s) || /^\s/.test(s) || s.startsWith('|')) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function csvTable(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function exportAuditCsv(stamped) {
  const p = { ...stamped };
  delete p.digest;
  const lines = [];
  lines.push('# paletteforge gamut lab audit');
  lines.push(`# sha256 ${stamped.digest}`);
  lines.push('# verify by recomputing sha256 over the canonical payload, digest field excluded');
  lines.push('');
  lines.push('section,field,value');
  const rows = [
    ['state', 'seed', p.state?.seed],
    ['state', 'mode', p.state?.mode],
    ['state', 'harmony', p.state?.harmony],
    ['state', 'symmetry', p.state?.symmetry],
    ['state', 'cvd', p.state?.cvd],
    ['state', 'theme', p.state?.theme],
    ['state', 'base', p.state?.base],
    ['base', 'oklch_L', p.baseOklch?.L],
    ['base', 'oklch_C', p.baseOklch?.C],
    ['base', 'oklch_H', p.baseOklch?.H],
    ['cusp', 'hue', p.cusp?.hue],
    ['cusp', 'L', p.cusp?.L],
    ['cusp', 'C', p.cusp?.C],
  ];
  (p.palette || []).forEach((sw, i) => {
    rows.push(['palette', `swatch_${i + 1}`, sw.hex]);
    rows.push(['palette', `swatch_${i + 1}_oklch`, sw.oklch]);
  });
  (p.comparator || []).forEach((row) => {
    (row.cells || []).forEach((cell) => {
      rows.push(['comparator', `${row.harmony}.${cell.vision}.pairs`, cell.pairs]);
      rows.push(['comparator', `${row.harmony}.${cell.vision}.aa`, cell.aa]);
      rows.push(['comparator', `${row.harmony}.${cell.vision}.aaa`, cell.aaa]);
      rows.push(['comparator', `${row.harmony}.${cell.vision}.ui`, cell.ui]);
      rows.push(['comparator', `${row.harmony}.${cell.vision}.minDeltaE`, cell.minDeltaE]);
      if (cell.tightest) {
        rows.push(['comparator', `${row.harmony}.${cell.vision}.tightest`, `${cell.tightest.a} vs ${cell.tightest.b} dE ${cell.tightest.d}`]);
      }
    });
    if (row.worstCvd) {
      rows.push(['comparator', `${row.harmony}.tightest_cvd_pair`, `${row.worstCvd.vision} swatches ${row.worstCvd.pair.i + 1} and ${row.worstCvd.pair.j + 1} dE ${row.worstCvd.minDeltaE}`]);
    }
  });
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return lines.join('\n') + '\n';
}

export function exportAuditMarkdown(stamped) {
  const p = { ...stamped };
  delete p.digest;
  const lines = [];
  lines.push('# PaletteForge gamut lab audit');
  lines.push('');
  lines.push(`- seed: ${p.state?.seed ?? ''}`);
  lines.push(`- mode: ${p.state?.mode ?? ''} / harmony: ${p.state?.harmony ?? ''}`);
  lines.push(`- base: ${p.state?.base ?? ''} = ${formatOklch(p.baseOklch?.L ?? 0, p.baseOklch?.C ?? 0, p.baseOklch?.H ?? 0)}`);
  lines.push(`- gamut cusp at hue ${p.cusp?.hue}: L ${p.cusp?.L}, C ${p.cusp?.C}`);
  lines.push('');
  lines.push('| harmony | vision | pairs | AA | AAA | UI | min dE |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of p.comparator || []) {
    for (const cell of row.cells || []) {
      lines.push(`| ${row.harmony} | ${cell.vision} | ${cell.pairs} | ${cell.aa} | ${cell.aaa} | ${cell.ui} | ${cell.minDeltaE} |`);
    }
  }
  lines.push('');
  lines.push('## Tightest CVD-confusable pairs');
  lines.push('');
  for (const row of p.comparator || []) {
    if (row.worstCvd) {
      lines.push(`- ${row.harmony}: ${row.worstCvd.vision}, swatches ${row.worstCvd.pair.i + 1} and ${row.worstCvd.pair.j + 1} at dE ${row.worstCvd.minDeltaE}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push(`sha256 ${stamped.digest}`);
  lines.push('');
  return lines.join('\n');
}
