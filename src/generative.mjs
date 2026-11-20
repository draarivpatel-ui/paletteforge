// PaletteForge generative engine.
// Deterministic seeded PRNG (FNV-1a string hash + mulberry32), gradient-noise
// flow fields, wallpaper symmetry tiling, golden-ratio subdivision, and
// superformula moire geometry. Every mode emits a flat list of drawing ops
// that serialize to byte-identical SVG and render to canvas or 1400x1800 PNG.
// Pure ES module, zero dependencies.

import { relativeLuminance, hexToRgb, HARMONY_MODES } from './color-science.mjs';

export const POSTER_W = 1400;
export const POSTER_H = 1800;
export const FOOTER_H = 120;
export const ART_H = POSTER_H - FOOTER_H;

export const MODES = ['flow', 'wallpaper', 'bauhaus', 'moire'];
export const MODE_LABELS = {
  flow: 'Flow Ribbons',
  wallpaper: 'Wallpaper Symmetry',
  bauhaus: 'Bauhaus Grid',
  moire: 'Moire Superformula',
};
export const SYMMETRIES = ['p4m', 'p6m', 'p2'];

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seedStr, salt = 0) {
  return mulberry32((fnv1a(seedStr) ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0);
}

// Deterministic 2D lattice hash -> [0, 1). Used for the noise gradients.
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Perlin-style gradient noise in [-1, 1], fully seeded and deterministic.
export function gradientNoise2(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (ix, iy, dx, dy) => {
    const ang = hash2(ix, iy, seed) * Math.PI * 2;
    return Math.cos(ang) * dx + Math.sin(ang) * dy;
  };
  const v00 = dot(x0, y0, fx, fy);
  const v10 = dot(x0 + 1, y0, fx - 1, fy);
  const v01 = dot(x0, y0 + 1, fx, fy - 1);
  const v11 = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
  const u = fade(fx);
  const x1 = v00 + (v10 - v00) * u;
  const x2 = v01 + (v11 - v01) * u;
  return x1 + (x2 - x1) * fade(fy);
}

export function fbm2(x, y, seed, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gradientNoise2(x * f, y * f, seed + i * 101);
    f *= 2;
    amp *= 0.5;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Drawing ops. A poster is a flat list of ops over a POSTER_W x POSTER_H
// space; ops serialize deterministically to SVG and draw to Canvas2D.
// Colors are always literal '#rrggbb' strings for stable output.
// ---------------------------------------------------------------------------

const path = (pts, props) => ({ t: 'path', pts, close: false, fill: null, stroke: null, w: 1, alpha: 1, cap: 'round', join: 'round', ...props });
const circle = (c, r, props) => ({ t: 'circle', c, r, fill: null, stroke: null, w: 1, alpha: 1, ...props });
const rect = (x, y, w, h, props) => ({ t: 'rect', x, y, w, h, fill: null, stroke: null, sw: 1, alpha: 1, ...props });
const text = (x, y, str, props) => ({ t: 'text', x, y, str, size: 28, fill: '#191613', align: 'left', font: 'mono', alpha: 1, ...props });

// Rigid transform matrices [a,b,c,d,e,f] applied as x' = a x + c y + e,
// y' = b x + d y + f. Composition order: m(m2(p)) via mul(m, m2).
function mTranslate(x, y) { return [1, 0, 0, 1, x, y]; }
function mRotate(deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}
function mMirrorX() { return [-1, 0, 0, 1, 0, 0]; }
function mMul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function applyM(m, p) {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

function transformOp(op, m) {
  if (op.t === 'path') return { ...op, pts: op.pts.map((p) => applyM(m, p)) };
  if (op.t === 'circle') return { ...op, c: applyM(m, op.c) };
  return op;
}

// ---------------------------------------------------------------------------
// Composition modes. Each returns ops inside the art area [0, POSTER_W] x
// [0, ART_H]. Deterministic for a given seed string and palette.
// ---------------------------------------------------------------------------

function composeFlow(rng, seed, pal) {
  const ops = [];
  const noiseSeed = fnv1a('flow:' + seed);
  const scale = 0.0014 + rng() * 0.0013;
  const ribbons = 110 + Math.floor(rng() * 80);
  for (let i = 0; i < ribbons; i++) {
    let x = rng() * POSTER_W;
    let y = rng() * ART_H;
    const step = 7 + rng() * 5;
    const steps = 45 + Math.floor(rng() * 90);
    const pts = [[x, y]];
    for (let s = 0; s < steps; s++) {
      const a = fbm2(x * scale, y * scale, noiseSeed) * Math.PI * 4;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      if (x < 20 || x > POSTER_W - 20 || y < 20 || y > ART_H - 20) break;
      pts.push([x, y]);
    }
    if (pts.length < 4) continue;
    ops.push(
      path(pts, {
        stroke: pal[i % pal.length],
        w: 2 + rng() * 9,
        alpha: 0.5 + rng() * 0.4,
      })
    );
  }
  // A few heavier accents on top.
  for (let i = 0; i < 6; i++) {
    const cx = rng() * POSTER_W;
    const cy = rng() * ART_H;
    ops.push(circle([cx, cy], 8 + rng() * 26, { fill: pal[(i * 2 + 1) % pal.length], alpha: 0.85 }));
  }
  return ops;
}

// Motif ops are authored inside a unit cell [0,1]x[0,1] then scaled.
function wallpaperMotif(rng, pal, cell) {
  const ops = [];
  const u = (v) => v * cell;
  const kind = Math.floor(rng() * 4);
  const pick = () => pal[Math.floor(rng() * pal.length)];
  if (kind === 0) {
    // Quarter arc fan from a corner.
    const corner = [[0, 0], [cell, 0], [cell, cell], [0, cell]][Math.floor(rng() * 4)];
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 1; i <= n; i++) {
      const r = u(0.16) * i;
      const pts = [];
      for (let s = 0; s <= 12; s++) {
        const a = (s / 12) * Math.PI * 0.5;
        const px = corner[0] + Math.cos(a) * r * Math.sign(cell / 2 - corner[0] || 1) * (corner[0] === 0 ? 1 : -1);
        const py = corner[1] + Math.sin(a) * r * (corner[1] === 0 ? 1 : -1);
        pts.push([px, py]);
      }
      ops.push(path(pts, { stroke: pick(), w: u(0.02) + 1, alpha: 0.9 }));
    }
  } else if (kind === 1) {
    // Diagonal bar pair.
    const off = u(0.12) + rng() * u(0.2);
    ops.push(path([[0, off], [off, 0]], { stroke: pick(), w: u(0.08), alpha: 0.85 }));
    ops.push(path([[cell - off, cell], [cell, cell - off]], { stroke: pick(), w: u(0.08), alpha: 0.85 }));
    ops.push(circle([u(0.5), u(0.5)], u(0.07), { fill: pick(), alpha: 0.95 }));
  } else if (kind === 2) {
    // Triangle and dot.
    const cx = u(0.5);
    const cy = u(0.5);
    const r = u(0.22) + rng() * u(0.12);
    const rot = Math.floor(rng() * 4) * (Math.PI / 2);
    const pts = [0, 1, 2].map((k) => {
      const a = rot + (k * 2 * Math.PI) / 3 - Math.PI / 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
    ops.push(path(pts, { close: true, fill: pick(), alpha: 0.9 }));
    ops.push(circle([cx, cy], u(0.05), { fill: pick() }));
  } else {
    // Ring with cross tick.
    const cx = u(0.5);
    const cy = u(0.5);
    ops.push(circle([cx, cy], u(0.16) + rng() * u(0.1), { stroke: pick(), w: u(0.035) + 1 }));
    ops.push(path([[cx, cy - u(0.3)], [cx, cy + u(0.3)]], { stroke: pick(), w: u(0.03) + 1, alpha: 0.8 }));
  }
  return ops;
}

function composeWallpaper(rng, seed, pal, symmetry) {
  const ops = [];
  const group = SYMMETRIES.includes(symmetry) ? symmetry : SYMMETRIES[Math.floor(rng() * 3)];

  if (group === 'p4m' || group === 'p2') {
    const cols = group === 'p4m' ? 5 + Math.floor(rng() * 3) : 4 + Math.floor(rng() * 3);
    const cell = POSTER_W / cols;
    const rows = Math.ceil(ART_H / cell) + 1;
    const motif = wallpaperMotif(rng, pal, cell);
    const dihedral = group === 'p4m' ? 8 : 2;
    for (let gy = -1; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const cx = gx * cell;
        const cy = gy * cell;
        for (let k = 0; k < dihedral; k++) {
          // Dihedral element k: mirror first when k >= 4, then rotate k*45.
          const rot = group === 'p4m' ? (k % 4) * 90 : k * 180;
          let m = mTranslate(cx + cell / 2, cy + cell / 2);
          m = mMul(m, mRotate(rot));
          if (group === 'p4m' && k >= 4) m = mMul(m, mMirrorX());
          m = mMul(m, mTranslate(-cell / 2, -cell / 2));
          for (const op of motif) ops.push(transformOp(op, m));
        }
      }
    }
    return ops;
  }

  // p6m: 12 dihedral elements around points of a triangular lattice.
  const s = POSTER_W / (4 + Math.floor(rng() * 3));
  const h = (s * Math.sqrt(3)) / 2;
  const motif = wallpaperMotif(rng, pal, s * 0.6);
  const scaleM = (p) => [p[0] - (s * 0.6) / 2, p[1] - (s * 0.6) / 2];
  const lattice = [];
  for (let j = -1; j * h < ART_H + h; j++) {
    for (let i = -1; i * s < POSTER_W + s; i++) {
      lattice.push([i * s + (j % 2 === 0 ? 0 : s / 2), j * h]);
    }
  }
  for (const [lx, ly] of lattice) {
    for (let k = 0; k < 12; k++) {
      let m = mTranslate(lx, ly);
      m = mMul(m, mRotate(k * 30));
      if (k % 2 === 1) m = mMul(m, mMirrorX());
      for (const op of motif) {
        const shifted = { ...op };
        if (op.t === 'path') shifted.pts = op.pts.map(scaleM);
        else if (op.t === 'circle') shifted.c = scaleM(op.c);
        ops.push(transformOp(shifted, m));
      }
    }
  }
  return ops;
}

function composeBauhaus(rng, seed, pal) {
  const ops = [];
  const PHI = 0.6180339887498949;
  const lums = pal.map((hex) => {
    const c = hexToRgb(hex);
    return c ? relativeLuminance(c.r, c.g, c.b) : 0;
  });
  const byLum = pal.map((hex, i) => ({ hex, lum: lums[i] })).sort((a, b) => b.lum - a.lum);

  const leaves = [];
  const split = (r, depth) => {
    const area = r.w * r.h;
    if (depth > 6 || area < 26000 || rng() < 0.16) {
      leaves.push(r);
      return;
    }
    const horizontal = r.w > r.h ? rng() < 0.35 : rng() < 0.75;
    const ratio = rng() < 0.5 ? PHI : 1 - PHI;
    if (horizontal) {
      const hh = Math.max(60, r.h * ratio);
      split({ x: r.x, y: r.y, w: r.w, h: hh }, depth + 1);
      split({ x: r.x, y: r.y + hh, w: r.w, h: r.h - hh }, depth + 1);
    } else {
      const ww = Math.max(60, r.w * ratio);
      split({ x: r.x, y: r.y, w: ww, h: r.h }, depth + 1);
      split({ x: r.x + ww, y: r.y, w: r.w - ww, h: r.h }, depth + 1);
    }
  };
  split({ x: 0, y: 0, w: POSTER_W, h: ART_H }, 0);

  // Largest leaves receive the highest-luminance palette entries.
  const ordered = leaves.slice().sort((a, b) => b.w * b.h - a.w * a.h);
  ordered.forEach((leaf, i) => {
    const col = byLum[i % byLum.length].hex;
    leaf.color = col;
    ops.push(rect(leaf.x + 3, leaf.y + 3, leaf.w - 6, leaf.h - 6, { fill: col }));
  });

  // Bauhaus motifs: quarter circle wedges and rings, corners picked by rng.
  for (const leaf of ordered) {
    if (rng() > 0.34 || leaf.w < 110 || leaf.h < 110) continue;
    const cx = leaf.x + (rng() < 0.5 ? 0 : leaf.w);
    const cy = leaf.y + (rng() < 0.5 ? 0 : leaf.h);
    const r = Math.min(leaf.w, leaf.h) * (0.45 + rng() * 0.4);
    const accent = pal[Math.floor(rng() * pal.length)];
    if (rng() < 0.5) {
      const pts = [[cx, cy]];
      const a0 = Math.atan2(leaf.y + leaf.h / 2 - cy, leaf.x + leaf.w / 2 - cx);
      for (let s = 0; s <= 16; s++) {
        const a = a0 - Math.PI / 4 + (s / 16) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      ops.push(path(pts, { close: true, fill: accent, alpha: 0.92 }));
    } else {
      ops.push(circle([cx, cy], r * 0.5, { stroke: accent, w: 6 + rng() * 10, alpha: 0.9 }));
    }
  }
  return ops;
}

function composeMoire(rng, seed, pal) {
  const ops = [];
  const cx = POSTER_W / 2;
  const cy = ART_H / 2;
  const layers = 3 + Math.floor(rng() * 3);
  const baseM = 2 + Math.floor(rng() * 9); // superformula symmetry order
  const n1 = 0.3 + rng() * 2.4;
  const n2 = 0.3 + rng() * 1.8;
  const n3 = 0.3 + rng() * 1.8;
  const baseR = Math.min(POSTER_W, ART_H) * (0.3 + rng() * 0.14);

  const superR = (theta, m, a, b, p1, p2, p3) => {
    const t = (m * theta) / 4;
    const part1 = Math.pow(Math.abs(Math.cos(t) / a), p2);
    const part2 = Math.pow(Math.abs(Math.sin(t) / b), p3);
    const sum = part1 + part2;
    if (sum < 1e-9) return baseR;
    return Math.pow(sum, -1 / p1);
  };

  for (let l = 0; l < layers; l++) {
    const rot = (l * Math.PI) / (layers * 2) + rng() * 0.06;
    const scaleR = baseR * (0.55 + (0.5 * l) / Math.max(1, layers - 1));
    const m = baseM + (l % 2);
    const pts = [];
    const N = 720;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const r = Math.min(superR(th + rot, m, 1, 1, n1, n2, n3), 2.2) * scaleR;
      pts.push([cx + Math.cos(th) * r, cy + Math.sin(th) * r]);
    }
    ops.push(path(pts, { close: true, stroke: pal[l % pal.length], w: 1.6 + rng() * 2, alpha: 0.5 + rng() * 0.35 }));
  }

  // Interference ring set on a second center for the moire beat.
  const rings = 14 + Math.floor(rng() * 10);
  const off = [cx + (rng() - 0.5) * POSTER_W * 0.3, cy + (rng() - 0.5) * ART_H * 0.3];
  for (let i = 1; i <= rings; i++) {
    ops.push(
      circle(off, (i / rings) * baseR * 0.9, {
        stroke: pal[(i + 1) % pal.length],
        w: 1.4,
        alpha: 0.28,
      })
    );
  }
  return ops;
}

const COMPOSERS = { flow: composeFlow, wallpaper: composeWallpaper, bauhaus: composeBauhaus, moire: composeMoire };

// paletteHexes: array of '#rrggbb'. Returns {ops, meta}.
export function composePoster(seedStr, mode, paletteHexes, opts = {}) {
  const useMode = MODES.includes(mode) ? mode : 'flow';
  const pal = paletteHexes && paletteHexes.length ? paletteHexes : ['#333333', '#777777', '#bbbbbb'];
  const rng = makeRng(`${seedStr}|${useMode}|${pal.join(',')}`);
  const ops = COMPOSERS[useMode](rng, String(seedStr), pal, opts.symmetry);
  const meta = {
    seed: String(seedStr),
    mode: useMode,
    w: POSTER_W,
    h: POSTER_H,
    palette: pal.slice(),
    contrastPasses: opts.contrastPasses ?? null,
    harmony: opts.harmony ?? '',
  };
  const all = [
    rect(0, 0, POSTER_W, POSTER_H, { fill: opts.background || '#f6f1e7' }),
    ...ops,
  ];
  if (opts.includeFooter) all.push(...footerOps(meta, opts));
  return { ops: all, meta };
}

function footerOps(meta, opts) {
  const y0 = POSTER_H - FOOTER_H;
  const ink = opts.footerInk || '#191613';
  const ops = [path([[0, y0], [POSTER_W, y0]], { stroke: ink, w: 2, cap: 'butt', alpha: 0.85 })];
  const seedTxt = meta.seed.length > 34 ? meta.seed.slice(0, 33) + '...' : meta.seed;
  const oklchLine = (opts.oklchLine || '').slice(0, 64);
  const passes = meta.contrastPasses == null ? 'n/a' : String(meta.contrastPasses);
  ops.push(text(56, y0 + 46, `SEED ${seedTxt}`, { fill: ink, size: 26 }));
  ops.push(
    text(56, y0 + 86, `MODE ${MODE_LABELS[meta.mode].toUpperCase()}  /  HARMONY ${String(meta.harmony || 'custom').toUpperCase()}`, {
      fill: ink,
      size: 22,
      alpha: 0.75,
    })
  );
  ops.push(text(POSTER_W - 56, y0 + 46, oklchLine || 'OKLCH', { fill: ink, size: 22, align: 'right', alpha: 0.8 }));
  ops.push(text(POSTER_W - 56, y0 + 86, `WCAG PASSES ${passes}`, { fill: ink, size: 22, align: 'right', alpha: 0.8 }));
  return ops;
}

// ---------------------------------------------------------------------------
// Deterministic SVG serializer
// ---------------------------------------------------------------------------

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const f2 = (n) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? '0' : String(v);
};

function opToSvg(op) {
  const alpha = op.alpha !== undefined && op.alpha !== 1 ? ` opacity="${f2(op.alpha)}"` : '';
  if (op.t === 'path') {
    const d = op.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f2(p[0])} ${f2(p[1])}`).join(' ') + (op.close ? ' Z' : '');
    const fill = op.fill ? ` fill="${op.fill}"` : ' fill="none"';
    const stroke = op.stroke ? ` stroke="${op.stroke}" stroke-width="${f2(op.w)}" stroke-linecap="${op.cap || 'round'}" stroke-linejoin="${op.join || 'round'}"` : '';
    return `<path d="${d}"${fill}${stroke}${alpha}/>`;
  }
  if (op.t === 'circle') {
    const fill = op.fill ? ` fill="${op.fill}"` : ' fill="none"';
    const stroke = op.stroke ? ` stroke="${op.stroke}" stroke-width="${f2(op.w)}"` : '';
    return `<circle cx="${f2(op.c[0])}" cy="${f2(op.c[1])}" r="${f2(op.r)}"${fill}${stroke}${alpha}/>`;
  }
  if (op.t === 'rect') {
    const fill = op.fill ? ` fill="${op.fill}"` : ' fill="none"';
    const stroke = op.stroke ? ` stroke="${op.stroke}" stroke-width="${f2(op.sw)}"` : '';
    return `<rect x="${f2(op.x)}" y="${f2(op.y)}" width="${f2(op.w)}" height="${f2(op.h)}"${fill}${stroke}${alpha}/>`;
  }
  if (op.t === 'text') {
    const anchor = op.align === 'right' ? 'end' : op.align === 'center' ? 'middle' : 'start';
    const family = op.font === 'serif' ? 'Georgia, serif' : 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    return `<text x="${f2(op.x)}" y="${f2(op.y)}" font-size="${f2(op.size)}" font-family="${family}" text-anchor="${anchor}" fill="${op.fill}"${alpha}>${escapeXml(op.str)}</text>`;
  }
  return '';
}

// Full deterministic SVG document. Same inputs -> identical bytes.
export function exportPosterSvg(seedStr, mode, paletteHexes, opts = {}) {
  const { ops, meta } = composePoster(seedStr, mode, paletteHexes, { ...opts, includeFooter: opts.includeFooter !== false });
  const body = ops.map(opToSvg).join('\n  ');
  const desc = `PaletteForge poster. Seed ${meta.seed}. Mode ${meta.mode}.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${POSTER_W} ${POSTER_H}" width="${POSTER_W}" height="${POSTER_H}" role="img">\n  <desc>${escapeXml(desc)}</desc>\n  ${body}\n</svg>\n`;
}

// ---------------------------------------------------------------------------
// Canvas renderer (used by the app; takes any Canvas2D-like context)
// ---------------------------------------------------------------------------

export function drawOps(ctx, ops, scale = 1) {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  for (const op of ops) {
    ctx.globalAlpha = op.alpha ?? 1;
    if (op.t === 'path') {
      ctx.beginPath();
      op.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      if (op.close) ctx.closePath();
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fill();
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.w;
        ctx.lineCap = op.cap || 'round';
        ctx.stroke();
      }
    } else if (op.t === 'circle') {
      ctx.beginPath();
      ctx.arc(op.c[0], op.c[1], op.r, 0, Math.PI * 2);
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fill();
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.w;
        ctx.stroke();
      }
    } else if (op.t === 'rect') {
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fillRect(op.x, op.y, op.w, op.h);
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.sw;
        ctx.strokeRect(op.x, op.y, op.w, op.h);
      }
    } else if (op.t === 'text') {
      ctx.fillStyle = op.fill;
      ctx.font = `${op.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textAlign = op.align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(op.str, op.x, op.y);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// URL hash state codec with strict validation
// ---------------------------------------------------------------------------

export const STATE_KEYS = ['seed', 'mode', 'harmony', 'symmetry', 'cvd', 'theme'];

export function sanitizeSeed(s) {
  // Strip control characters and cap length; keep any printable text.
  const clean = String(s ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 64);
  return clean;
}

export function encodeState(state) {
  const p = new URLSearchParams();
  p.set('seed', sanitizeSeed(state.seed) || 'atelier');
  if (MODES.includes(state.mode)) p.set('mode', state.mode);
  if (state.harmony) p.set('harmony', state.harmony);
  if (SYMMETRIES.includes(state.symmetry)) p.set('symmetry', state.symmetry);
  if (state.cvd && state.cvd !== 'none') p.set('cvd', state.cvd);
  if (state.theme === 'dark') p.set('theme', 'dark');
  return '#' + p.toString();
}

// Returns null on malformed hash; otherwise a validated state object whose
// unknown or out-of-range fields fall back to defaults.
export function decodeState(hash, defaults = {}) {
  if (typeof hash !== 'string') return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return { ...defaults };
  let p;
  try {
    p = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const out = { ...defaults };
  const seed = p.get('seed');
  if (seed !== null) {
    const s = sanitizeSeed(seed);
    if (s) out.seed = s;
  }
  const mode = p.get('mode');
  if (mode !== null && MODES.includes(mode)) out.mode = mode;
  const harmony = p.get('harmony');
  // Membership check, not shape check: a well-formed but unknown harmony name
  // must fall back to the default rather than reach the UI and crash the
  // label lookup on hashchange.
  if (harmony !== null && HARMONY_MODES.includes(harmony)) out.harmony = harmony;
  const symmetry = p.get('symmetry');
  if (symmetry !== null && SYMMETRIES.includes(symmetry)) out.symmetry = symmetry;
  const cvd = p.get('cvd');
  if (cvd !== null) out.cvd = CVD_VALUES.includes(cvd) ? cvd : 'none';
  const theme = p.get('theme');
  if (theme !== null) out.theme = theme === 'dark' ? 'dark' : 'light';
  return out;
}

export const CVD_VALUES = ['none', 'protanopia', 'deuteranopia', 'tritanopia'];
