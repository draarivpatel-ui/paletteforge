// PaletteForge color science engine.
// Exact Bjorn Ottosson Oklab/OKLCH conversion, chroma-bisection sRGB gamut
// mapping, geometric harmony generation, WCAG 2.1 contrast, Vienot-Brettel
// color vision deficiency simulation, and deterministic median-cut extraction.
// Pure ES module, zero dependencies, runs in Node and in the browser.

export const TAU = Math.PI * 2;

export function clamp01(x) {
  // NaN fails both comparisons, so it must be handled first; NaN maps to 0
  // rather than propagating through the gamut pipeline into '#NaNNaNNaN'.
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Non-finite numbers fall back to a safe scalar. Used at every pipeline entry
// that accepts raw numbers (gamut mapping, harmony generation).
function finiteOr(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// sRGB transfer functions (IEC 61966-2-1)
// ---------------------------------------------------------------------------

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------------
// Oklab / OKLCH (Ottosson, 2020). All sRGB channels are floats in [0, 1].
// Linear sRGB -> LMS cone response -> cube root -> Lab opponent space.
// ---------------------------------------------------------------------------

export function linearSrgbToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToLinearSrgb(L, a, b) {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541729 * b;
  const s = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

export function labToLch({ L, a, b }) {
  const C = Math.hypot(a, b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  if (C < 1e-9) H = 0;
  return { L, C, H };
}

export function lchToLab({ L, C, H }) {
  const rad = (H * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

// sRGB floats [0,1] -> OKLCH. Channels may exceed [0,1]; values are used raw.
export function srgbToOklch(r, g, b) {
  return labToLch(linearSrgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)));
}

// OKLCH -> sRGB floats, unclamped (channels may leave [0,1] when out of gamut).
export function oklchToSrgb(L, C, H) {
  const { a, b } = lchToLab({ L, C, H });
  const { r, g, b: bb } = oklabToLinearSrgb(L, a, b);
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(bb) };
}

// ---------------------------------------------------------------------------
// sRGB gamut mapping by chroma bisection. Lightness and hue are held constant;
// chroma is reduced by binary search until every channel lands inside [0,1],
// so out-of-gamut colors clip along constant hue and lightness instead of
// shifting hue.
// ---------------------------------------------------------------------------

export function isInSrgbGamut({ r, g, b }, eps = 1e-6) {
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
}

export function gamutMapOklch(L, C, H, iterations = 32) {
  // Non-finite inputs resolve to safe values instead of propagating NaN into
  // every downstream hex, matrix cell, and poster op. clamp01 now absorbs NaN
  // (to 0) and clamps +-Infinity naturally; hue and chroma fall back to 0.
  const Lc = clamp01(L);
  const Hs = finiteOr(H, 0);
  const evalC = (c) => oklchToSrgb(Lc, c, Hs);
  let mappedC = finiteOr(C, 0);
  if (mappedC > 0 && !isInSrgbGamut(evalC(mappedC))) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < iterations; i++) {
      const mid = (lo + hi) / 2;
      if (isInSrgbGamut(evalC(mid))) lo = mid;
      else hi = mid;
    }
    mappedC = lo;
  }
  const s = evalC(mappedC);
  return { r: clamp01(s.r), g: clamp01(s.g), b: clamp01(s.b), L: Lc, C: mappedC, H: Hs };
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

export function rgbToHex(r, g, b) {
  const h = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

export function rgb255ToHex(r, g, b) {
  return rgbToHex(r / 255, g / 255, b / 255);
}

// Accepts #rgb, #rrggbb, #rrggbbaa (alpha ignored). Returns sRGB floats.
export function hexToRgb(hex) {
  const s = String(hex).trim().replace(/^#/, '');
  let m;
  if ((m = /^([0-9a-fA-F]{3})$/.exec(s))) {
    const v = (ch) => parseInt(ch + ch, 16) / 255;
    return { r: v(m[1][0]), g: v(m[1][1]), b: v(m[1][2]) };
  }
  if ((m = /^([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(s))) {
    return {
      r: parseInt(m[1].slice(0, 2), 16) / 255,
      g: parseInt(m[1].slice(2, 4), 16) / 255,
      b: parseInt(m[1].slice(4, 6), 16) / 255,
    };
  }
  return null;
}

export function oklchToHex(L, C, H) {
  const s = gamutMapOklch(L, C, H);
  return rgbToHex(s.r, s.g, s.b);
}

export function formatOklch(L, C, H) {
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
}

// Parses a user-typed OKLCH color into {L, C, H}, or null when the input does
// not check out. Accepts the CSS spelling 'oklch(0.55 0.14 28)', a lightness or
// chroma percentage ('55%' maps to 0.55 and '50%' chroma to 0.2, the CSS 0.4
// reference range), an optional 'deg' on hue, comma separators, an alpha slash
// segment (ignored), and a bare triple '0.55 0.14 28'. Wrong arity, non-numeric
// channels, and percent-signed hue are rejected rather than guessed. Negative
// chroma clamps to zero and hue wraps into [0, 360), matching the CSS parser's
// own recovery rules.
export function parseOklch(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('oklch')) {
    const m = /^oklch\(\s*(.*?)\s*\)$/s.exec(s);
    if (!m) return null;
    s = m[1];
  }
  s = s.split('/')[0].trim().replace(/,/g, ' ');
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const chan = (p, allowPct, pctScale, allowDeg) => {
    const m = /^([-+]?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)(%|deg)?$/.exec(p);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (m[2] === '%') return allowPct ? v * pctScale : null;
    if (m[2] === 'deg') return allowDeg ? v : null;
    return v;
  };
  const L = chan(parts[0], true, 0.01, false);
  const C = chan(parts[1], true, 0.004, false);
  const H = chan(parts[2], false, 0, true);
  if (L === null || C === null || H === null) return null;
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) return null;
  return { L, C: Math.max(0, C), H: wrapHue(H) };
}

// ---------------------------------------------------------------------------
// WCAG 2.1 relative luminance and contrast ratio
// ---------------------------------------------------------------------------

export function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(rgbA, rgbB) {
  const la = relativeLuminance(rgbA.r, rgbA.g, rgbA.b);
  const lb = relativeLuminance(rgbB.r, rgbB.g, rgbB.b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastBadge(ratio) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}

// N x N matrix of pairwise contrast ratios. colors: [{r,g,b} in 0..1].
export function contrastMatrix(colors) {
  return colors.map((a) => colors.map((b) => contrastRatio(a, b)));
}

// ---------------------------------------------------------------------------
// Color vision deficiency simulation. Vienot, Brettel and Mollon (1999)
// linear-RGB dichromat projection matrices, applied in linear sRGB space.
// ---------------------------------------------------------------------------

export const CVD_TYPES = ['protanopia', 'deuteranopia', 'tritanopia'];

export const CVD_MATRICES = {
  protanopia: [
    0.152286, 1.052583, -0.204868,
    0.114503, 0.786281, 0.099216,
    -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968,
    0.280085, 0.672501, 0.047413,
    -0.01182, 0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779,
    -0.078411, 0.930809, 0.147602,
    0.004733, 0.691367, 0.3039,
  ],
};

// rgb: sRGB floats [0,1]. Returns simulated sRGB floats clamped to [0,1].
export function simulateCvd(r, g, b, type) {
  const M = CVD_MATRICES[type];
  if (!M) return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const rr = M[0] * lr + M[1] * lg + M[2] * lb;
  const gg = M[3] * lr + M[4] * lg + M[5] * lb;
  const bb = M[6] * lr + M[7] * lg + M[8] * lb;
  return { r: linearToSrgb(clamp01(rr)), g: linearToSrgb(clamp01(gg)), b: linearToSrgb(clamp01(bb)) };
}

export function simulateCvdHex(hex, type) {
  const c = hexToRgb(hex);
  if (!c) return '#000000';
  const s = simulateCvd(c.r, c.g, c.b, type);
  return rgbToHex(s.r, s.g, s.b);
}

// ---------------------------------------------------------------------------
// Geometric OKLCH harmony generators. Each mode rotates hue around the OKLCH
// wheel by fixed anchor angles, then walks lightness along a curve and chroma
// along an envelope so the result is a graded family, not a flat set.
// ---------------------------------------------------------------------------

export const HARMONY_MODES = [
  'complementary',
  'split-complementary',
  'triadic',
  'analogous',
  'tetradic',
  'monochromatic',
];

export const HARMONY_LABELS = {
  complementary: 'Complementary',
  'split-complementary': 'Split Complementary',
  triadic: 'Triadic',
  analogous: 'Analogous',
  tetradic: 'Tetradic',
  monochromatic: 'Monochromatic Tonal',
};

const HARMONY_ANCHORS = {
  complementary: [0, 180],
  'split-complementary': [0, 150, 210],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  monochromatic: [0],
};

export function wrapHue(h) {
  const w = h % 360;
  return w < 0 ? w + 360 : w;
}

// opts:
//   count            number of swatches (default 5)
//   analogousRange   total hue spread for analogous mode in degrees (default 60)
//   lightnessSpread  max lightness departure from base L, 0..1 scale (default 0.22)
//   lightnessCurve   'linear' | 'ease' (default 'linear')
//   chromaEnvelope   'flat' | 'taper' (taper reduces chroma toward the ends)
//   chromaScale      multiplier on base chroma (default 1)
export function generateHarmony(base, mode, opts = {}) {
  if (!HARMONY_MODES.includes(mode)) mode = 'triadic';
  // A malformed base object degrades to a neutral anchor instead of producing
  // NaN swatches with '#NaNNaNNaN' hexes.
  base = {
    L: finiteOr(base?.L, 0.6),
    C: finiteOr(base?.C, 0.1),
    H: finiteOr(base?.H, 0),
  };
  const count = Math.max(1, Math.min(12, Math.floor(finiteOr(opts.count, 5))));
  const spread = Math.max(0, Math.min(0.45, opts.lightnessSpread ?? 0.22));
  const curve = opts.lightnessCurve === 'ease' ? 'ease' : 'linear';
  const envelope = opts.chromaEnvelope === 'flat' ? 'flat' : 'taper';
  const cScale = Math.max(0, Math.min(2, opts.chromaScale ?? 1));
  const aRange = Math.max(10, Math.min(120, opts.analogousRange ?? 60));

  const anchorAt = (i) => {
    if (mode === 'analogous') {
      if (count === 1) return 0;
      return -aRange / 2 + (aRange * i) / (count - 1);
    }
    const anchors = HARMONY_ANCHORS[mode];
    return anchors[Math.floor((i * anchors.length) / count)];
  };

  const swatches = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1; // -1 .. 1
    const lOffset = curve === 'ease' ? Math.sin((t * Math.PI) / 2) * spread : t * spread;
    const cEnv = envelope === 'taper' ? 1 - 0.4 * Math.abs(t) : 1;
    const L = clamp01(base.L + lOffset);
    const C = Math.max(0, base.C * cScale * cEnv);
    const H = wrapHue(base.H + anchorAt(i));
    const mapped = gamutMapOklch(L, C, H);
    swatches.push({
      L,
      C,
      H,
      rgb: { r: mapped.r, g: mapped.g, b: mapped.b },
      hex: rgbToHex(mapped.r, mapped.g, mapped.b),
    });
  }
  return swatches;
}

// ---------------------------------------------------------------------------
// Deterministic median-cut palette extraction.
// Buckets unique colors (weighted by frequency) along their widest channel at
// the weighted median until k buckets exist, then averages each bucket.
// Same input bytes always produce the same palette in the same order.
// ---------------------------------------------------------------------------

export function extractPaletteFromPixels(rgba, width, height, k = 6) {
  const total = Math.floor((rgba?.length ?? 0) / 4);
  const w = Math.floor(width);
  const h = Math.floor(height);
  // NaN or negative dimensions would otherwise compute NaN pixel counts that
  // slip past numeric guards; treat any non-finite dimension as empty input.
  const px = Number.isFinite(width) && Number.isFinite(height) && w > 0 && h > 0
    ? Math.min(total, w * h)
    : 0;
  const wanted = Math.floor(finiteOr(k, 0));
  if (px <= 0 || wanted <= 0) return [];

  const buckets = new Map(); // packed rgb -> {r,g,b,w}
  for (let i = 0; i < px; i++) {
    const a = rgba[i * 4 + 3];
    if (a < 16) continue;
    const r = rgba[i * 4] | 0;
    const g = rgba[i * 4 + 1] | 0;
    const b = rgba[i * 4 + 2] | 0;
    const key = (r << 16) | (g << 8) | b;
    const e = buckets.get(key);
    if (e) e.w++;
    else buckets.set(key, { r, g, b, w: 1 });
  }
  if (buckets.size === 0) return [];

  const sortOut = (list) =>
    list
      .slice()
      .sort((p, q) => (q.w ?? q.weight) - (p.w ?? p.weight) || p.r - q.r || p.g - q.g || p.b - q.b)
      .map((p) => {
        const w = p.w ?? p.weight;
        return { r: p.r, g: p.g, b: p.b, weight: w, hex: rgb255ToHex(p.r, p.g, p.b) };
      });

  const uniques = [...buckets.values()];
  if (uniques.length <= wanted) return sortOut(uniques);

  const CHANNELS = ['r', 'g', 'b'];
  let boxes = [uniques];

  const boxRange = (box) => {
    let best = -1;
    let bestCh = 'r';
    for (const ch of CHANNELS) {
      let lo = 255;
      let hi = 0;
      for (const p of box) {
        if (p[ch] < lo) lo = p[ch];
        if (p[ch] > hi) hi = p[ch];
      }
      const range = hi - lo;
      if (range > best) {
        best = range;
        bestCh = ch;
      }
    }
    return { range: best, ch: bestCh };
  };

  while (boxes.length < wanted) {
    // Pick the box with the widest channel range; ties break by larger
    // weight, then by lowest index, so the choice is deterministic.
    let pick = -1;
    let pickRange = 0;
    let pickWeight = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      const { range } = boxRange(box);
      const w = box.reduce((s, p) => s + p.w, 0);
      if (range > pickRange || (range === pickRange && w > pickWeight)) {
        pick = i;
        pickRange = range;
        pickWeight = w;
      }
    }
    if (pick < 0 || pickRange <= 0) break;

    const box = boxes[pick];
    const { ch } = boxRange(box);
    const sorted = box
      .slice()
      .sort((p, q) => p[ch] - q[ch] || p.r - q.r || p.g - q.g || p.b - q.b);
    const totalW = sorted.reduce((s, p) => s + p.w, 0);
    let acc = 0;
    let cut = 0;
    while (cut < sorted.length - 1 && acc + sorted[cut].w < totalW / 2) {
      acc += sorted[cut].w;
      cut++;
    }
    if (cut <= 0) cut = 1;
    if (cut >= sorted.length) cut = sorted.length - 1;
    boxes = boxes.slice(0, pick).concat([sorted.slice(0, cut), sorted.slice(cut)], boxes.slice(pick + 1));
  }

  const palette = boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let w = 0;
    for (const p of box) {
      r += p.r * p.w;
      g += p.g * p.w;
      b += p.b * p.w;
      w += p.w;
    }
    return {
      r: Math.round(r / w),
      g: Math.round(g / w),
      b: Math.round(b / w),
      weight: w,
    };
  });

  // Merge accidental duplicate averages, then order by weight.
  const dedup = new Map();
  for (const p of palette) {
    const key = (p.r << 16) | (p.g << 8) | p.b;
    const e = dedup.get(key);
    if (e) e.weight += p.weight;
    else dedup.set(key, p);
  }
  return sortOut([...dedup.values()]);
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export function hexToOklch(hex) {
  const c = hexToRgb(hex);
  if (!c) return { L: 0, C: 0, H: 0 };
  return srgbToOklch(c.r, c.g, c.b);
}

export function luminanceOfHex(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  return relativeLuminance(c.r, c.g, c.b);
}
