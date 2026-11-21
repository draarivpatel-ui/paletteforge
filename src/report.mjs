// PaletteForge contrast proof report and design-token exporters.
// The proof report recomputes every pairwise WCAG 2.1 contrast ratio in the
// palette under full vision and under each of the three Machado, Oliveira and
// Fernandes (2009) dichromat simulations, so an accessibility claim travels
// with verifiable math instead of a screenshot. The token exporters emit the
// same palette as CSS custom properties, a Tailwind color config, and W3C
// DTCG design tokens in the shape Figma Variables and Tokens Studio import.
// Pure ES module, zero dependencies, and deterministic by construction: no
// clocks, no randomness, so the same palette always produces identical bytes.

import {
  hexToRgb,
  rgbToHex,
  hexToOklch,
  relativeLuminance,
  contrastRatio,
  contrastBadge,
  contrastMatrix,
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
  const rawRatio = contrastRatio(hexToRgb(inkHex), hexToRgb(groundHex));
  // WCAG pass/fail is judged on the unrounded ratio: a pair at 4.499888 fails
  // AA even though it displays as 4.5, because the spec forbids rounding up
  // to reach a threshold. `ratio` ships the rounded value for display; every
  // flag and badge compares `rawRatio`.
  const ratio = Number(rawRatio.toFixed(3));
  const wcag = {};
  for (const [key, min] of WCAG_LEVELS) wcag[key] = rawRatio >= min;
  return {
    ink: `${TOKEN_ROOT}-${inkIndex + 1}`,
    ground: `${TOKEN_ROOT}-${groundIndex + 1}`,
    inkHex,
    groundHex,
    ratio,
    rawRatio,
    badge: contrastBadge(rawRatio),
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
    if (!weakest || p.rawRatio < weakest.rawRatio) weakest = p;
    if (!strongest || p.rawRatio > strongest.rawRatio) strongest = p;
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
      if (!weakest || p.rawRatio < weakest.rawRatio) {
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

// W3C DTCG design tokens ($type/$value), the shape Figma Variables and
// Tokens Studio import. Every $type "color" token carries a DTCG 2025.10
// color object: the sRGB color space, the normalized channel components, and
// the hex fallback, so Figma's native importer reads the file directly. Each
// swatch ships with its oklch() reading and its best-contrast ink partner as
// sibling tokens.
export function exportFigmaTokens(paletteHexes, meta = {}) {
  const palette = sanitizePalette(paletteHexes);
  const dtcgColor = (hex) => {
    const c = hexToRgb(hex);
    return { colorSpace: 'srgb', components: [c.r, c.g, c.b], hex };
  };
  const color = {};
  palette.forEach((h, i) => {
    const ok = hexToOklch(h);
    color[String(i + 1)] = {
      $type: 'color',
      $value: dtcgColor(h),
      $description: formatOklch(ok.L, ok.C, ok.H),
    };
    color[`on-${i + 1}`] = {
      $type: 'color',
      $value: dtcgColor(bestInk(h, palette)),
      $description: `strongest WCAG contrast on ${TOKEN_ROOT}-${i + 1}`,
    };
  });
  return JSON.stringify({ [TOKEN_ROOT]: { color } }, null, 2) + '\n';
}

// The WCAG level a matrix cell earns as a class, in the same four-level
// vocabulary the swatch badges use, always judged on the unrounded ratio.
const CELL_BADGE_CLASS = { AAA: 'aaa', AA: 'aa', 'AA Large': 'aal', Fail: 'fail' };

// The next WCAG line each badge fails, named in the cell tooltip so a pair
// never reads as passing a level its raw ratio does not reach.
const CELL_NEXT_LINE = { AAA: '', AA: 'AAA 7', 'AA Large': 'AA 4.5', Fail: 'AA Large 3' };

// The app's N x N contrast matrix as accessible markup. Every row and column
// header names its swatch (index + hex) in visually hidden text with
// scope="row" or scope="col", so assistive technology associates each ratio
// cell with its exact ink and ground pair. The colored chip keeps the
// gallery look; the hidden label carries the meaning. Each ratio cell is
// classified strictly by its unrounded ratio: the class, the badge verdict
// in the tooltip, and the visually hidden label all come from the raw
// value, and a leading < marks a ratio whose one-decimal display would
// round up onto a WCAG line it fails, so 4.499888 can never read as the
// AA pass it falls short of. Single-argument calls take hex strings.
export function matrixTableHtml(rgbs, hexes) {
  if (hexes === undefined) {
    hexes = sanitizePalette(rgbs);
    rgbs = hexes.map((h) => hexToRgb(h));
  }
  const m = contrastMatrix(rgbs);
  const label = (i) => `swatch ${i + 1} ${hexes[i]}`;
  let html = '<table><thead><tr><td><span class="sr-only">ink on ground</span></td>';
  hexes.forEach((h, i) => {
    html +=
      `<th scope="col"><span class="cellchip" style="background:${h}"></span>` +
      `<span class="sr-only">${label(i)}</span></th>`;
  });
  html += '</tr></thead><tbody>';
  m.forEach((row, i) => {
    html +=
      `<tr><th scope="row"><span class="cellchip" style="background:${hexes[i]}"></span>` +
      `<span class="sr-only">${label(i)}</span></th>`;
    row.forEach((r, j) => {
      if (i === j) {
        html += `<td><span class="cell" style="background:${hexes[j]}"><span class="diag">1.0</span></span></td>`;
        return;
      }
      const badge = contrastBadge(r);
      const shown = r >= 10 ? r.toFixed(0) : r.toFixed(1);
      const line = [7, 4.5, 3].find((min) => r < min && Number(shown) >= min);
      const text = line === undefined ? shown : `&lt;${line}`;
      const next = CELL_NEXT_LINE[badge];
      const verdict = next ? `${badge}, fails ${next}` : badge;
      const tip = `${hexes[i]} on ${hexes[j]} · ${(Math.floor(r * 1000) / 1000).toFixed(3)}:1 (${verdict})`;
      html +=
        `<td><span class="cell ${CELL_BADGE_CLASS[badge]}" style="background:${hexes[j]};color:${hexes[i]}" ` +
        `title="${tip}">${text}<span class="sr-only">, ${verdict}</span></span></td>`;
    });
    html += '</tr>';
  });
  return html + '</tbody></table>';
}
