// PaletteForge contrast proof report and design-token exporters.
// The proof report recomputes every pairwise WCAG 2.1 contrast ratio in the
// palette under full vision and under each of the three Vienot-Brettel
// dichromat simulations, so an accessibility claim travels with verifiable
// math instead of a screenshot. The token exporters emit the same palette as
// CSS custom properties, a Tailwind color config, and W3C-format design
// tokens in the shape Figma Variables and Tokens Studio import.
// Pure ES module, zero dependencies, and deterministic by construction: no
// clocks, no randomness, so the same palette always produces identical bytes.

import {
  hexToRgb,
  rgbToHex,
  hexToOklch,
  relativeLuminance,
  contrastRatio,
  contrastBadge,
  simulateCvdHex,
  formatOklch,
  CVD_TYPES,
} from './color-science.mjs';

export const TOKEN_ROOT = 'paletteforge';
export const VISIONS = ['none', ...CVD_TYPES];

// WCAG 2.1 thresholds: SC 1.4.6 AAA normal text at 7, SC 1.4.3 AA normal text
// at 4.5, AA large text at 3, AAA large text at 4.5, and SC 1.4.11 non-text
// (icons, focus rings, chart marks) at 3.
const WCAG_LEVELS = [
  ['aa', 4.5],
  ['aaa', 7],
  ['aaLarge', 3],
  ['aaaLarge', 4.5],
  ['nonText', 3],
];

// Drops entries that do not parse as hex and canonicalizes the rest to
// lowercase #rrggbb, so a report never carries the raw text a user typed.
export function sanitizePalette(hexes) {
  const out = [];
  for (const h of hexes || []) {
    const c = hexToRgb(h);
    if (c) out.push(rgbToHex(c.r, c.g, c.b));
  }
  return out;
}

function swatchToken(hex, index) {
  const c = hexToRgb(hex);
  const ok = hexToOklch(hex);
  return {
    name: `${TOKEN_ROOT}-${index + 1}`,
    hex,
    rgb: [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)],
    oklch: formatOklch(ok.L, ok.C, ok.H),
    luminance: Number(relativeLuminance(c.r, c.g, c.b).toFixed(6)),
  };
}

// The palette entry with the strongest contrast against `hex`. Useful as the
// recommended ink to print on that swatch; when the palette holds one color
// it answers itself.
export function bestInk(hex, paletteHexes) {
  const c = hexToRgb(hex);
  if (!c) return '#000000';
  let best = null;
  let bestRatio = 0;
  for (const h of paletteHexes || []) {
    const o = hexToRgb(h);
    if (!o) continue;
    const r = contrastRatio(c, o);
    if (r > bestRatio || (r === bestRatio && best === null)) {
      bestRatio = r;
      best = h;
    }
  }
  return best ?? '#000000';
}

function pairEntry(inkHex, groundHex, inkIndex, groundIndex) {
  const ratio = Number(contrastRatio(hexToRgb(inkHex), hexToRgb(groundHex)).toFixed(3));
  // Levels are judged on the rounded ratio that ships in the report, so the
  // artifact is self-consistent for anyone auditing it by eye.
  const wcag = {};
  for (const [key, min] of WCAG_LEVELS) wcag[key] = ratio >= min;
  return {
    ink: `${TOKEN_ROOT}-${inkIndex + 1}`,
    ground: `${TOKEN_ROOT}-${groundIndex + 1}`,
    inkHex,
    groundHex,
    ratio,
    badge: contrastBadge(ratio),
    wcag,
  };
}

// One vision view: the palette as simulated, the full N x N matrix, every
// ordered ink-on-ground pair, and per-level pass counts.
function visionProof(vision, hexes) {
  const rgbs = hexes.map((h) => hexToRgb(h));
  const matrix = rgbs.map((a) =>
    rgbs.map((b) => Number(contrastRatio(a, b).toFixed(3)))
  );
  const pairs = [];
  for (let i = 0; i < hexes.length; i++) {
    for (let j = 0; j < hexes.length; j++) {
      if (i !== j) pairs.push(pairEntry(hexes[i], hexes[j], i, j));
    }
  }
  const counts = {};
  for (const [key] of WCAG_LEVELS) counts[key] = pairs.filter((p) => p.wcag[key]).length;
  let weakest = null;
  let strongest = null;
  for (const p of pairs) {
    if (!weakest || p.ratio < weakest.ratio) weakest = p;
    if (!strongest || p.ratio > strongest.ratio) strongest = p;
  }
  return {
    vision,
    palette: hexes.slice(),
    matrix,
    pairs,
    summary: {
      pairs: pairs.length,
      counts,
      minRatio: weakest ? weakest.ratio : null,
      maxRatio: strongest ? strongest.ratio : null,
      weakest: weakest ? `${weakest.ink} on ${weakest.ground}` : null,
      strongest: strongest ? `${strongest.ink} on ${strongest.ground}` : null,
    },
  };
}

// meta: {seed, mode, harmony, base}. All fields are recorded verbatim after
// string conversion; nothing else about the environment is captured.
export function buildProofReport(paletteHexes, meta = {}) {
  const palette = sanitizePalette(paletteHexes);
  const dropped = (paletteHexes || []).length - palette.length;
  const visions = VISIONS.map((v) => {
    const sim = v === 'none' ? palette : palette.map((h) => simulateCvdHex(h, v));
    return visionProof(v, sim);
  });
  let weakestVision = null;
  let weakest = null;
  for (const v of visions) {
    for (const p of v.pairs) {
      if (!weakest || p.ratio < weakest.ratio) {
        weakest = p;
        weakestVision = v.vision;
      }
    }
  }
  const verdict = { pairs: visions[0] ? visions[0].pairs.length : 0, visionsTested: visions.length };
  for (const [key] of WCAG_LEVELS) {
    verdict[`${key}Everywhere`] = visions.every((v) => v.pairs.every((p) => p.wcag[key]));
  }
  verdict.minRatio = weakest ? weakest.ratio : null;
  verdict.weakestVision = weakestVision;
  verdict.weakest = weakest ? `${weakest.ink} on ${weakest.ground}` : null;
  return {
    report: 'paletteforge-contrast-proof',
    version: 1,
    source: {
      seed: String(meta.seed ?? ''),
      mode: String(meta.mode ?? ''),
      harmony: String(meta.harmony ?? ''),
      base: sanitizePalette([meta.base])[0] ?? null,
    },
    palette: palette.map(swatchToken),
    droppedEntries: dropped,
    thresholds: Object.fromEntries(WCAG_LEVELS),
    visions,
    verdict,
  };
}

export function exportProofJson(paletteHexes, meta = {}) {
  return JSON.stringify(buildProofReport(paletteHexes, meta), null, 2) + '\n';
}

// CSS custom properties: the natural palette on :root, one vision block per
// dichromat selected by [data-vision] on the root element, an oklch() reading
// for each swatch, and a best-ink partner per swatch.
export function exportCssTokens(paletteHexes, meta = {}) {
  const palette = sanitizePalette(paletteHexes);
  const lines = [];
  lines.push('/* PaletteForge design tokens.');
  lines.push('   Natural palette on :root. Set data-vision="protanopia",');
  lines.push('   "deuteranopia" or "tritanopia" on the root element to preview a');
  lines.push('   color vision deficiency simulation. --pf-swatch-N-on is the');
  lines.push('   palette entry with the strongest WCAG contrast on swatch N. */');
  const rootLines = [];
  palette.forEach((h, i) => {
    const ok = hexToOklch(h);
    rootLines.push(`  --pf-swatch-${i + 1}: ${h};`);
    rootLines.push(`  --pf-swatch-${i + 1}-oklch: ${formatOklch(ok.L, ok.C, ok.H)};`);
    rootLines.push(`  --pf-swatch-${i + 1}-on: ${bestInk(h, palette)};`);
  });
  lines.push(':root {', ...rootLines, '}');
  for (const v of CVD_TYPES) {
    lines.push(`:root[data-vision="${v}"] {`);
    palette.forEach((h, i) => {
      lines.push(`  --pf-swatch-${i + 1}: ${simulateCvdHex(h, v)};`);
    });
    lines.push('}');
  }
  return lines.join('\n') + '\n';
}

// Tailwind color config emitted as a CommonJS fragment: merge or paste the
// colors object into an existing tailwind.config.
export function exportTailwindConfig(paletteHexes, meta = {}) {
  const palette = sanitizePalette(paletteHexes);
  const colors = {};
  palette.forEach((h, i) => {
    colors[String(i + 1)] = h;
    colors[`on-${i + 1}`] = bestInk(h, palette);
  });
  const cfg = {
    theme: {
      extend: {
        colors: {
          [TOKEN_ROOT]: { DEFAULT: palette[0] ?? '#000000', ...colors },
        },
      },
    },
  };
  return (
    '/* PaletteForge palette fragment for tailwind.config */\n' +
    'module.exports = ' +
    JSON.stringify(cfg, null, 2) +
    ';\n'
  );
}

// W3C design-token format ($type/$value), the shape Figma Variables and
// Tokens Studio import. Each swatch ships with its oklch() reading and its
// best-contrast ink partner as sibling tokens.
export function exportFigmaTokens(paletteHexes, meta = {}) {
  const palette = sanitizePalette(paletteHexes);
  const color = {};
  palette.forEach((h, i) => {
    const ok = hexToOklch(h);
    color[String(i + 1)] = {
      $type: 'color',
      $value: h,
      $description: formatOklch(ok.L, ok.C, ok.H),
    };
    color[`on-${i + 1}`] = {
      $type: 'color',
      $value: bestInk(h, palette),
      $description: `strongest WCAG contrast on ${TOKEN_ROOT}-${i + 1}`,
    };
  });
  return JSON.stringify({ [TOKEN_ROOT]: { color } }, null, 2) + '\n';
}
