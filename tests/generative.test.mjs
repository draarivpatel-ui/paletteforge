// Generative engine: seeded PRNG goldens, determinism, SVG validity, escaping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fnv1a,
  mulberry32,
  makeRng,
  gradientNoise2,
  fbm2,
  composePoster,
  exportPosterSvg,
  escapeXml,
  MODES,
  POSTER_W,
  POSTER_H,
} from '../src/generative.mjs';

const PAL = ['#28324a', '#c8451f', '#e2a926', '#7a8f3f', '#efe6d4'];

test('PRNG goldens', async (t) => {
  await t.test('fnv1a known vectors', () => {
    assert.equal(fnv1a(''), 0x811c9dc5);
    assert.equal(fnv1a('paletteforge'), 0x03e59967);
    assert.equal(fnv1a('a'), 0xe40c292c);
  });
  await t.test('mulberry32 sequence goldens', () => {
    const r = mulberry32(42);
    assert.ok(Math.abs(r() - 0.6011037519201636) < 1e-15);
    assert.ok(Math.abs(r() - 0.44829055899754167) < 1e-15);
  });
  await t.test('makeRng streams differ by salt', () => {
    const a = makeRng('seed', 0)();
    const b = makeRng('seed', 1)();
    assert.notEqual(a, b);
  });
  await t.test('rng output bounded in [0,1)', () => {
    const r = mulberry32(9);
    for (let i = 0; i < 500; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1);
    }
  });
  await t.test('same seed reproducibility', () => {
    const a = makeRng('repro');
    const b = makeRng('repro');
    for (let i = 0; i < 10; i++) assert.equal(a(), b());
  });
});

test('noise field determinism', async (t) => {
  await t.test('gradient noise is deterministic', () => {
    assert.equal(gradientNoise2(3.7, 8.2, 11), gradientNoise2(3.7, 8.2, 11));
    assert.notEqual(gradientNoise2(3.7, 8.2, 11), gradientNoise2(3.7, 8.2, 12));
  });
  await t.test('noise bounded roughly within [-1,1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = gradientNoise2(i * 0.37, i * 0.11, 5);
      assert.ok(v >= -1.5 && v <= 1.5);
    }
  });
  await t.test('fbm deterministic', () => {
    assert.equal(fbm2(1.5, 2.5, 99), fbm2(1.5, 2.5, 99));
  });
});

test('poster composition per mode', async (t) => {
  for (const mode of MODES) {
    await t.test(`${mode} produces drawable ops`, () => {
      const { ops, meta } = composePoster('studio test', mode, PAL, { includeFooter: true });
      assert.ok(ops.length > 10, `only ${ops.length} ops`);
      assert.equal(meta.mode, mode);
      assert.equal(meta.w, POSTER_W);
      assert.equal(meta.h, POSTER_H);
      const kinds = new Set(ops.map((o) => o.t));
      assert.ok(kinds.has('path') || kinds.has('circle') || kinds.has('rect'));
    });
  }
});

test('poster and SVG determinism', async (t) => {
  await t.test('same seed produces identical ops', () => {
    const a = composePoster('alpha', 'flow', PAL);
    const b = composePoster('alpha', 'flow', PAL);
    assert.deepEqual(a.ops, b.ops);
  });
  await t.test('same seed produces byte-identical SVG', () => {
    const a = exportPosterSvg('alpha', 'wallpaper', PAL, { symmetry: 'p4m' });
    const b = exportPosterSvg('alpha', 'wallpaper', PAL, { symmetry: 'p4m' });
    assert.equal(a, b);
    assert.ok(a.length > 1000);
  });
  await t.test('different seeds produce different SVG', () => {
    const a = exportPosterSvg('alpha', 'flow', PAL);
    const b = exportPosterSvg('beta', 'flow', PAL);
    assert.notEqual(a, b);
  });
  await t.test('different modes produce different SVG', () => {
    const a = exportPosterSvg('alpha', 'flow', PAL);
    const b = exportPosterSvg('alpha', 'bauhaus', PAL);
    assert.notEqual(a, b);
  });
  await t.test('different palettes produce different SVG', () => {
    const a = exportPosterSvg('alpha', 'flow', PAL);
    const b = exportPosterSvg('alpha', 'flow', ['#111111', '#222222', '#333333', '#444444', '#555555']);
    assert.notEqual(a, b);
  });
});

test('SVG structural validity', async (t) => {
  for (const mode of MODES) {
    await t.test(`${mode} SVG document is well formed`, () => {
      const svg = exportPosterSvg('validity', mode, PAL);
      assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
      assert.ok(svg.includes(`viewBox="0 0 ${POSTER_W} ${POSTER_H}"`));
      assert.ok(svg.trimEnd().endsWith('</svg>'));
      assert.ok(!/NaN|undefined|null"/.test(svg), 'numeric garbage in output');
      assert.ok(!/Infinity/.test(svg));
      const starts = (svg.match(/<[a-zA-Z]/g) || []).length;
      const closes = (svg.match(/<\//g) || []).length;
      const selfClosed = (svg.match(/\/>/g) || []).length;
      assert.ok(starts === selfClosed + closes, `unbalanced: ${starts} opens, ${selfClosed} self-closed, ${closes} closers`);
    });
  }
});

test('SVG escaping and footer', async (t) => {
  await t.test('seed containing markup is escaped', () => {
    const svg = exportPosterSvg('<script>alert(1)</script>', 'flow', PAL);
    assert.ok(!svg.includes('<script>'), 'unescaped seed in document');
    assert.ok(svg.includes('&lt;script&gt;'));
  });
  await t.test('escapeXml covers the five entities', () => {
    assert.equal(escapeXml(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });
  await t.test('footer lines are present when requested', () => {
    const svg = exportPosterSvg('footercase', 'flow', PAL, { includeFooter: true, harmony: 'triadic', contrastPasses: '7/10 AA' });
    assert.ok(svg.includes('SEED footercase'));
    assert.ok(svg.includes('HARMONY TRIADIC'));
    assert.ok(svg.includes('WCAG PASSES 7/10 AA'));
  });
  await t.test('footer omitted when disabled', () => {
    const svg = exportPosterSvg('footercase', 'flow', PAL, { includeFooter: false });
    assert.ok(!svg.includes('SEED footercase'));
  });
  await t.test('long seeds truncate inside the footer', () => {
    const svg = exportPosterSvg('x'.repeat(80), 'flow', PAL, { includeFooter: true });
    assert.ok(svg.includes('SEED ' + 'x'.repeat(33) + '...'));
  });
});

test('wallpaper symmetry variants all render', async (t) => {
  for (const sym of ['p4m', 'p6m', 'p2']) {
    await t.test(sym, () => {
      const { ops } = composePoster('tile', 'wallpaper', PAL, { symmetry: sym });
      assert.ok(ops.length > 40, `thin wallpaper for ${sym}`);
    });
  }
});

test('bauhaus never degenerates to a near-empty poster', async (t) => {
  // Regression: a degenerate rng run could stop the recursive split after a
  // handful of leaves, producing posters that were essentially blank.
  const seeds = [
    'quarry cobalt', 'slate orchard', 'first light', 'amber tundra',
    'slate solstice', 'meridian delta', 'beacon verdant', 'harbor monsoon',
    'crimson prairie', 'tundra prairie', 'prairie tundra', 'verdant orchard',
  ];
  for (const seed of seeds) {
    const { ops } = composePoster(seed, 'bauhaus', PAL);
    assert.ok(ops.length > 16, `${seed}: only ${ops.length} ops`);
  }
});
