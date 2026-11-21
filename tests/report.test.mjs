// Contrast proof report and design-token exporters: structure, WCAG level
// integrity, per-vision simulation coverage, and byte determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePalette,
  bestInk,
  buildProofReport,
  exportProofJson,
  exportCssTokens,
  exportTailwindConfig,
  exportFigmaTokens,
  TOKEN_ROOT,
  VISIONS,
} from '../src/report.mjs';
import {
  simulateCvdHex,
  hexToRgb,
  contrastRatio,
  contrastBadge,
  formatOklch,
  hexToOklch,
  CVD_TYPES,
} from '../src/color-science.mjs';

const PAL = ['#28324a', '#c8451f', '#e2a926', '#7a8f3f', '#efe6d4'];
const META = { seed: 'report check', mode: 'flow', harmony: 'triadic', base: '#c8451f' };

test('sanitizePalette', async (t) => {
  await t.test('canonicalizes spellings to lowercase #rrggbb', () => {
    assert.deepEqual(sanitizePalette(['#F80', 'ABCDEF', '#c8451fff']), ['#ff8800', '#abcdef', '#c8451f']);
  });
  await t.test('drops unparseable entries', () => {
    assert.deepEqual(sanitizePalette(['#123456', 'garbage', '#fff']), ['#123456', '#ffffff']);
  });
  await t.test('non-array input gives empty', () => {
    assert.deepEqual(sanitizePalette(null), []);
    assert.deepEqual(sanitizePalette(undefined), []);
    assert.deepEqual(sanitizePalette('#123456'), []);
  });
  await t.test('preserves order and duplicates', () => {
    assert.deepEqual(sanitizePalette(['#111111', '#222222', '#111111']), ['#111111', '#222222', '#111111']);
  });
});

test('bestInk', async (t) => {
  await t.test('returns the argmax contrast partner', () => {
    const ink = bestInk('#28324a', PAL);
    const want = PAL.reduce((best, h) =>
      contrastRatio(hexToRgb('#28324a'), hexToRgb(h)) > contrastRatio(hexToRgb('#28324a'), hexToRgb(best)) ? h : best);
    assert.equal(ink, want);
  });
  await t.test('light on dark and dark on light both resolve', () => {
    assert.equal(bestInk('#000000', ['#000000', '#ffffff']), '#ffffff');
    assert.equal(bestInk('#ffffff', ['#000000', '#ffffff']), '#000000');
  });
  await t.test('malformed input falls back to black', () => {
    assert.equal(bestInk('zzz', PAL), '#000000');
    assert.equal(bestInk('#123456', []), '#000000');
  });
});

test('proof report structure', async (t) => {
  const r = buildProofReport(PAL, META);
  await t.test('declares its type and version', () => {
    assert.equal(r.report, 'paletteforge-contrast-proof');
    assert.equal(r.version, 1);
  });
  await t.test('records the source metadata', () => {
    assert.equal(r.source.seed, META.seed);
    assert.equal(r.source.mode, META.mode);
    assert.equal(r.source.harmony, META.harmony);
    assert.equal(r.source.base, '#c8451f');
  });
  await t.test('palette tokens carry hex, rgb, oklch, and luminance', () => {
    for (const s of r.palette) {
      assert.match(s.name, /^paletteforge-\d+$/);
      assert.match(s.hex, /^#[0-9a-f]{6}$/);
      assert.equal(s.rgb.length, 3);
      assert.ok(s.rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
      assert.match(s.oklch, /^oklch\(\d\.\d{3} \d\.\d{3} \d+\.\d\)$/);
      assert.ok(s.luminance >= 0 && s.luminance <= 1);
    }
  });
  await t.test('reports every WCAG threshold it proves against', () => {
    assert.deepEqual(r.thresholds, { aa: 4.5, aaa: 7, aaLarge: 3, aaaLarge: 4.5, nonText: 3 });
  });
  await t.test('covers all four visions in fixed order', () => {
    assert.deepEqual(r.visions.map((v) => v.vision), ['none', 'protanopia', 'deuteranopia', 'tritanopia']);
    assert.deepEqual(VISIONS, ['none', ...CVD_TYPES]);
  });
  await t.test('natural vision carries the input palette verbatim', () => {
    assert.deepEqual(r.visions[0].palette, PAL);
  });
});

test('proof report vision simulations', async (t) => {
  const r = buildProofReport(PAL, META);
  for (const type of CVD_TYPES) {
    await t.test(`${type} palette matches simulateCvdHex`, () => {
      const v = r.visions.find((x) => x.vision === type);
      const want = PAL.map((h) => simulateCvdHex(h, type));
      assert.deepEqual(v.palette, want);
    });
    await t.test(`${type} matrix is square, symmetric, diagonal 1`, () => {
      const v = r.visions.find((x) => x.vision === type);
      const m = v.matrix;
      assert.equal(m.length, PAL.length);
      for (let i = 0; i < m.length; i++) {
        assert.equal(m[i].length, PAL.length);
        assert.equal(m[i][i], 1);
        for (let j = 0; j < m.length; j++) assert.equal(m[i][j], m[j][i]);
      }
    });
  }
});

test('proof report pair math is auditable', async (t) => {
  const r = buildProofReport(PAL, META);
  const v0 = r.visions[0];
  await t.test('ordered pairs count is n*(n-1)', () => {
    assert.equal(v0.pairs.length, PAL.length * (PAL.length - 1));
  });
  await t.test('pair ratios match independent contrast computation', () => {
    for (const p of v0.pairs.slice(0, 6)) {
      const want = contrastRatio(hexToRgb(p.inkHex), hexToRgb(p.groundHex));
      assert.ok(Math.abs(p.ratio - want) < 0.001, `${p.ratio} vs ${want}`);
    }
  });
  await t.test('pair names point at swatch tokens', () => {
    const names = new Set(r.palette.map((s) => s.name));
    for (const p of v0.pairs) {
      assert.ok(names.has(p.ink) && names.has(p.ground), `${p.ink} on ${p.ground}`);
      assert.notEqual(p.ink, p.ground);
    }
  });
  await t.test('wcag flags are consistent with the shipped ratio', () => {
    for (const v of r.visions) {
      for (const p of v.pairs) {
        assert.equal(p.wcag.aa, p.ratio >= 4.5);
        assert.equal(p.wcag.aaa, p.ratio >= 7);
        assert.equal(p.wcag.aaLarge, p.ratio >= 3);
        assert.equal(p.wcag.aaaLarge, p.ratio >= 4.5);
        assert.equal(p.wcag.nonText, p.ratio >= 3);
        assert.equal(p.badge, contrastBadge(p.ratio));
      }
    }
  });
  await t.test('summary counts equal recomputed tallies', () => {
    for (const v of r.visions) {
      assert.equal(v.summary.pairs, v.pairs.length);
      assert.equal(v.summary.counts.aa, v.pairs.filter((p) => p.wcag.aa).length);
      assert.equal(v.summary.counts.aaa, v.pairs.filter((p) => p.wcag.aaa).length);
      assert.equal(v.summary.minRatio, Math.min(...v.pairs.map((p) => p.ratio)));
      assert.equal(v.summary.maxRatio, Math.max(...v.pairs.map((p) => p.ratio)));
    }
  });
  await t.test('verdict aggregates the weakest link across visions', () => {
    const all = r.visions.flatMap((v) => v.pairs.map((p) => ({ v: v.vision, p })));
    const min = Math.min(...all.map((x) => x.p.ratio));
    assert.equal(r.verdict.minRatio, min);
    const hit = all.find((x) => x.p.ratio === min);
    assert.equal(r.verdict.weakestVision, hit.v);
    assert.equal(r.verdict.weakest, `${hit.p.ink} on ${hit.p.ground}`);
    assert.equal(r.verdict.visionsTested, 4);
  });
  await t.test('everywhere flags reflect every vision', () => {
    for (const key of ['aa', 'aaa', 'aaLarge', 'aaaLarge', 'nonText']) {
      const want = r.visions.every((v) => v.pairs.every((p) => p.wcag[key]));
      assert.equal(r.verdict[`${key}Everywhere`], want, key);
    }
  });
  await t.test('a deliberately AAA palette earns the aaa verdict', () => {
    // Black and white pair at 21:1 under every vision simulation, so each
    // ordered pair clears the strictest threshold in the report.
    const rep = buildProofReport(['#000000', '#ffffff']);
    assert.equal(rep.verdict.aaaEverywhere, true);
    assert.equal(rep.verdict.minRatio, 21);
  });
});

test('proof report edge cases', async (t) => {
  await t.test('malformed entries are dropped and counted', () => {
    const r = buildProofReport(['#123456', 'junk', '#abcdef', 42]);
    assert.equal(r.palette.length, 2);
    assert.equal(r.droppedEntries, 2);
    assert.equal(r.visions.length, 4);
  });
  await t.test('empty palette still reports cleanly', () => {
    const r = buildProofReport([]);
    assert.equal(r.palette.length, 0);
    assert.equal(r.verdict.minRatio, null);
    for (const v of r.visions) {
      assert.equal(v.pairs.length, 0);
      assert.equal(v.summary.minRatio, null);
    }
  });
  await t.test('single color yields zero pairs', () => {
    const r = buildProofReport(['#445566']);
    for (const v of r.visions) assert.equal(v.pairs.length, 0);
  });
  await t.test('non-finite source fields stringify safely', () => {
    const r = buildProofReport(PAL, { seed: 42, mode: null, harmony: undefined, base: 'junk' });
    assert.equal(r.source.seed, '42');
    assert.equal(r.source.base, null);
  });
});

test('token exporters are byte deterministic', async (t) => {
  const fns = [exportProofJson, exportCssTokens, exportTailwindConfig, exportFigmaTokens];
  for (const [i, fn] of fns.entries()) {
    await t.test(`exporter ${i} gives identical bytes twice`, () => {
      assert.equal(fn(PAL, META), fn(PAL, META));
    });
    await t.test(`exporter ${i} changes bytes with the palette`, () => {
      const other = ['#000000', '#333333', '#777777', '#bbbbbb', '#ffffff'];
      assert.notEqual(fn(PAL, META), fn(other, META));
    });
  }
  await t.test('proof json is valid and free of NaN', () => {
    const s = exportProofJson(PAL, META);
    assert.doesNotThrow(() => JSON.parse(s));
    assert.ok(!/NaN|undefined/.test(s));
    assert.ok(s.endsWith('\n'));
  });
});

test('css token export', async (t) => {
  const css = exportCssTokens(PAL, META);
  await t.test('opens a :root block with hex vars', () => {
    assert.ok(css.includes(':root {'));
    for (const [i, h] of PAL.entries()) {
      assert.ok(css.includes(`--pf-swatch-${i + 1}: ${h};`), h);
    }
  });
  await t.test('declares oklch readings beside each hex', () => {
    for (const [i, h] of PAL.entries()) {
      const ok = hexToOklch(h);
      assert.ok(css.includes(`--pf-swatch-${i + 1}-oklch: ${formatOklch(ok.L, ok.C, ok.H)};`));
    }
  });
  await t.test('declares a best-ink partner per swatch', () => {
    for (const [i, h] of PAL.entries()) {
      const want = bestInk(h, PAL);
      assert.ok(css.includes(`--pf-swatch-${i + 1}-on: ${want};`), `${h} -> ${want}`);
      assert.ok(PAL.includes(want));
    }
  });
  await t.test('emits one vision block per dichromat with simulated hexes', () => {
    for (const type of CVD_TYPES) {
      assert.ok(css.includes(`:root[data-vision="${type}"] {`));
      for (const h of PAL) assert.ok(css.includes(simulateCvdHex(h, type)), `${type} ${h}`);
    }
  });
  await t.test('holds no unparseable tokens', () => {
    const root = css.slice(0, css.indexOf('[data-vision'));
    const vars = root.match(/--pf-swatch-\d+(-oklch|-on)?:/g) || [];
    assert.equal(vars.length, PAL.length * 3);
    const visionVars = css.match(/--pf-swatch-\d+:/g) || [];
    assert.equal(visionVars.length, PAL.length * (1 + CVD_TYPES.length));
    assert.ok(!/NaN|undefined/.test(css));
  });
});

test('tailwind token export evaluates to a real config', async (t) => {
  const src = exportTailwindConfig(PAL, META);
  await t.test('is a CommonJS module fragment', () => {
    assert.ok(src.startsWith('/*'));
    assert.ok(src.includes('module.exports = '));
    assert.ok(src.endsWith(';\n'));
  });
  await t.test('evaluates to a theme with every swatch and ink', () => {
    const mod = { exports: {} };
    new Function('module', 'exports', src)(mod, mod.exports);
    const colors = mod.exports.theme.extend.colors[TOKEN_ROOT];
    assert.equal(colors.DEFAULT, PAL[0]);
    for (const [i, h] of PAL.entries()) {
      assert.equal(colors[String(i + 1)], h);
      assert.equal(colors[`on-${i + 1}`], bestInk(h, PAL));
    }
  });
  await t.test('names the paletteforge color namespace', () => {
    assert.ok(src.includes(`"${TOKEN_ROOT}"`));
  });
});

test('figma token export', async (t) => {
  const raw = exportFigmaTokens(PAL, META);
  const doc = JSON.parse(raw);
  await t.test('parses as W3C design tokens', () => {
    assert.ok(doc[TOKEN_ROOT]);
    const color = doc[TOKEN_ROOT].color;
    assert.ok(color);
    for (const key of Object.keys(color)) {
      assert.equal(color[key].$type, 'color');
      assert.match(color[key].$value, /^#[0-9a-f]{6}$/);
    }
  });
  await t.test('swatch tokens carry palette hexes and oklch descriptions', () => {
    const color = doc[TOKEN_ROOT].color;
    for (const [i, h] of PAL.entries()) {
      const tok = color[String(i + 1)];
      assert.equal(tok.$value, h);
      const ok = hexToOklch(h);
      assert.equal(tok.$description, formatOklch(ok.L, ok.C, ok.H));
    }
  });
  await t.test('ink partner tokens reference their swatch', () => {
    const color = doc[TOKEN_ROOT].color;
    for (const [i, h] of PAL.entries()) {
      const tok = color[`on-${i + 1}`];
      assert.equal(tok.$value, bestInk(h, PAL));
      assert.ok(tok.$description.includes(`${TOKEN_ROOT}-${i + 1}`));
    }
  });
  await t.test('emits exactly two tokens per swatch', () => {
    assert.equal(Object.keys(doc[TOKEN_ROOT].color).length, PAL.length * 2);
  });
});
