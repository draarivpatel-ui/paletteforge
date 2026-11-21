// Typed OKLCH input: the parser accepts the CSS spellings a user would
// paste, recovers like the CSS parser, and rejects what it cannot prove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOklch,
  gamutMapOklch,
  isInSrgbGamut,
  rgbToHex,
  formatOklch,
} from '../src/color-science.mjs';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('parseOklch accepts valid spellings', async (t) => {
  const cases = [
    ['oklch(0.55 0.14 28)', { L: 0.55, C: 0.14, H: 28 }],
    ['oklch(0.55, 0.14, 28)', { L: 0.55, C: 0.14, H: 28 }],
    ['0.6 0.15 300', { L: 0.6, C: 0.15, H: 300 }],
    ['OKLCH(0.5 0.1 30)', { L: 0.5, C: 0.1, H: 30 }],
    ['oklch(  0.5   0.1   30  )', { L: 0.5, C: 0.1, H: 30 }],
    ['oklch(0.5 0.1 30 / 0.8)', { L: 0.5, C: 0.1, H: 30 }],
    ['oklch(0.5 0.1 30deg)', { L: 0.5, C: 0.1, H: 30 }],
    ['oklch(+0.5 .1 3e1)', { L: 0.5, C: 0.1, H: 30 }],
  ];
  for (const [input, want] of cases) {
    await t.test(input, () => {
      const p = parseOklch(input);
      assert.ok(p, `should parse ${input}`);
      assert.ok(close(p.L, want.L), `L ${p.L} vs ${want.L}`);
      assert.ok(close(p.C, want.C), `C ${p.C} vs ${want.C}`);
      assert.ok(close(p.H, want.H), `H ${p.H} vs ${want.H}`);
    });
  }
});

test('parseOklch resolves percentages like CSS', async (t) => {
  await t.test('lightness percent maps to 0..1', () => {
    const p = parseOklch('oklch(55% 0.14 28)');
    assert.ok(p && close(p.L, 0.55), `L ${p && p.L}`);
  });
  await t.test('chroma percent uses the 0.4 reference range', () => {
    const p = parseOklch('oklch(50% 50% 180)');
    assert.ok(p && close(p.C, 0.2), `C ${p && p.C}`);
  });
  await t.test('hue percent is rejected', () => {
    assert.equal(parseOklch('oklch(0.5 0.1 30%)'), null);
  });
});

test('parseOklch recovers like the CSS parser', async (t) => {
  await t.test('negative chroma clamps to zero', () => {
    const p = parseOklch('oklch(0.5 -0.2 30)');
    assert.ok(p && p.C === 0, `C ${p && p.C}`);
  });
  await t.test('hue below zero wraps', () => {
    const p = parseOklch('oklch(0.5 0.1 -30)');
    assert.ok(p && close(p.H, 330), `H ${p && p.H}`);
  });
  await t.test('hue above 360 wraps', () => {
    const p = parseOklch('oklch(0.5 0.1 390)');
    assert.ok(p && close(p.H, 30), `H ${p && p.H}`);
  });
  await t.test('hue wraps through multiple turns', () => {
    const p = parseOklch('oklch(0.5 0.1 750)');
    assert.ok(p && close(p.H, 30), `H ${p && p.H}`);
  });
});

test('parseOklch rejects malformed input without guessing', async (t) => {
  const bad = [
    'oklch(0.5 0.1)',
    'oklch(0.5 0.1 30 40)',
    'oklch()',
    'oklch',
    'oklch(a b c)',
    'oklch(none 0.1 30)',
    'lch(0.5 0.1 30)',
    '#ff8800',
    'oklch(0.5 0.1 30',
    'oklch 0.5 0.1 30)',
    'oklch(0.5/0.1/30)',
    'hello world',
    '0.5 0.1 abc',
    'oklch(0.5 0.1 30deg deg)',
  ];
  for (const input of bad) {
    await t.test(JSON.stringify(input), () => {
      assert.equal(parseOklch(input), null);
    });
  }
  await t.test('non-string inputs are null', () => {
    for (const v of [null, undefined, 42, {}, [], NaN]) assert.equal(parseOklch(v), null);
  });
});

test('parsed OKLCH drives the gamut map deterministically', async (t) => {
  await t.test('out of gamut chroma maps inside srgb', () => {
    const p = parseOklch('oklch(0.7 0.4 30)');
    const m = gamutMapOklch(p.L, p.C, p.H);
    assert.ok(isInSrgbGamut(m, 0));
    assert.ok(close(m.H, p.H), `hue ${m.H}`);
    assert.ok(m.C < p.C, `chroma ${m.C}`);
  });
  await t.test('lightness above one clamps at the top of the gamut', () => {
    const p = parseOklch('oklch(2 0.1 30)');
    const m = gamutMapOklch(p.L, p.C, p.H);
    assert.ok(isInSrgbGamut(m, 0));
    assert.ok(m.L === 1, `L ${m.L}`);
  });
  await t.test('same input gives same hex twice', () => {
    const p = parseOklch('oklch(0.6 0.2 140)');
    const a = gamutMapOklch(p.L, p.C, p.H);
    const b = gamutMapOklch(p.L, p.C, p.H);
    assert.equal(rgbToHex(a.r, a.g, a.b), rgbToHex(b.r, b.g, b.b));
  });
  await t.test('formatted parse round-trips through the pipeline', () => {
    const p = parseOklch('oklch(0.6 0.15 200)');
    const m = gamutMapOklch(p.L, p.C, p.H);
    const hex = rgbToHex(m.r, m.g, m.b);
    assert.match(hex, /^#[0-9a-f]{6}$/);
    const again = parseOklch(formatOklch(m.L, m.C, m.H));
    assert.ok(again && close(again.L, m.L, 1e-3) && close(again.C, m.C, 1e-3));
  });
});
