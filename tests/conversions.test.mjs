// sRGB <-> OKLCH round-trip accuracy and golden values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  srgbToOklch,
  oklchToSrgb,
  srgbToLinear,
  linearToSrgb,
  hexToRgb,
  rgbToHex,
  hexToOklch,
  formatOklch,
  clamp01,
} from '../src/color-science.mjs';
import { mulberry32 } from '../src/generative.mjs';

const NAMED = [
  ['pure red', 1, 0, 0],
  ['pure green', 0, 1, 0],
  ['pure blue', 0, 0, 1],
  ['yellow', 1, 1, 0],
  ['cyan', 0, 1, 1],
  ['magenta', 1, 0, 1],
  ['black', 0, 0, 0],
  ['white', 1, 1, 1],
  ['mid gray', 0.5, 0.5, 0.5],
  ['quarter gray', 0.25, 0.25, 0.25],
  ['rebeccapurple', 0.4, 0.2, 0.6],
  ['oxide red', 0.7843, 0.2706, 0.1216],
  ['sage', 0.51, 0.63, 0.42],
  ['deep navy', 0.03, 0.07, 0.2],
];

test('sRGB to OKLCH round-trip stays under 1e-4', async (t) => {
  for (const [name, r, g, b] of NAMED) {
    await t.test(`round-trip ${name}`, () => {
      const lch = srgbToOklch(r, g, b);
      const back = oklchToSrgb(lch.L, lch.C, lch.H);
      assert.ok(Math.abs(back.r - r) < 1e-4, `r ${back.r} vs ${r}`);
      assert.ok(Math.abs(back.g - g) < 1e-4, `g ${back.g} vs ${g}`);
      assert.ok(Math.abs(back.b - b) < 1e-4, `b ${back.b} vs ${b}`);
    });
  }
  const rng = mulberry32(777);
  for (let i = 0; i < 40; i++) {
    const r = rng();
    const g = rng();
    const b = rng();
    await t.test(`round-trip random sample ${i}`, () => {
      const lch = srgbToOklch(r, g, b);
      const back = oklchToSrgb(lch.L, lch.C, lch.H);
      const err = Math.max(Math.abs(back.r - r), Math.abs(back.g - g), Math.abs(back.b - b));
      assert.ok(err < 1e-4, `error ${err}`);
    });
  }
});

test('OKLCH golden values', async (t) => {
  await t.test('black maps to L 0', () => {
    const lch = srgbToOklch(0, 0, 0);
    assert.ok(Math.abs(lch.L) < 1e-9);
    assert.ok(Math.abs(lch.C) < 1e-9);
  });
  await t.test('white maps to L 1', () => {
    const lch = srgbToOklch(1, 1, 1);
    assert.ok(Math.abs(lch.L - 1) < 1e-3, `L ${lch.L}`);
  });
  await t.test('pure red hue near 29 degrees', () => {
    const lch = srgbToOklch(1, 0, 0);
    assert.ok(lch.H > 20 && lch.H < 40, `H ${lch.H}`);
    assert.ok(lch.C > 0.2 && lch.C < 0.3, `C ${lch.C}`);
  });
  await t.test('pure blue hue near 265 degrees', () => {
    const lch = srgbToOklch(0, 0, 1);
    assert.ok(lch.H > 255 && lch.H < 275, `H ${lch.H}`);
  });
  await t.test('grays have zero chroma', () => {
    for (const v of [0.1, 0.35, 0.7, 0.9]) {
      const lch = srgbToOklch(v, v, v);
      assert.ok(lch.C < 1e-6, `C ${lch.C} at ${v}`);
    }
  });
});

test('transfer function edges', async (t) => {
  await t.test('srgbToLinear of 0 and 1', () => {
    assert.equal(srgbToLinear(0), 0);
    assert.ok(Math.abs(srgbToLinear(1) - 1) < 1e-12);
  });
  await t.test('linearToSrgb of 0 and 1', () => {
    assert.equal(linearToSrgb(0), 0);
    assert.ok(Math.abs(linearToSrgb(1) - 1) < 1e-12);
  });
  await t.test('transfer round-trip across range', () => {
    for (let i = 0; i <= 20; i++) {
      const c = i / 20;
      assert.ok(Math.abs(linearToSrgb(srgbToLinear(c)) - c) < 1e-9, `at ${c}`);
    }
  });
  await t.test('linearToSrgb handles negatives via linear segment', () => {
    assert.ok(linearToSrgb(-0.05) < 0);
    assert.ok(Number.isFinite(linearToSrgb(-0.05)));
  });
});

test('hex helpers', async (t) => {
  await t.test('hexToRgb parses 6 digit', () => {
    const c = hexToRgb('#ff8800');
    assert.ok(Math.abs(c.r - 1) < 1e-9 && Math.abs(c.g - 136 / 255) < 1e-9 && c.b === 0);
  });
  await t.test('hexToRgb parses 3 digit', () => {
    const c = hexToRgb('#f80');
    assert.ok(Math.abs(c.r - 1) < 1e-9 && Math.abs(c.g - 136 / 255) < 1e-9);
  });
  await t.test('hexToRgb accepts missing hash', () => {
    assert.ok(hexToRgb('4f8ac2'));
  });
  await t.test('hexToRgb rejects garbage', () => {
    assert.equal(hexToRgb('#zzzzzz'), null);
    assert.equal(hexToRgb('notacolor'), null);
    assert.equal(hexToRgb('#12345'), null);
  });
  await t.test('rgbToHex round-trips', () => {
    for (const h of ['#000000', '#ffffff', '#4f8ac2', '#c8451f', '#0ac85a']) {
      const c = hexToRgb(h);
      assert.equal(rgbToHex(c.r, c.g, c.b), h);
    }
  });
  await t.test('rgbToHex clamps out of range', () => {
    assert.equal(rgbToHex(2, -1, 0.5), '#ff0080');
  });
  await t.test('hexToOklch matches srgbToOklch', () => {
    const a = hexToOklch('#c8451f');
    const b = srgbToOklch(0.7843, 0.2706, 0.1216);
    assert.ok(Math.abs(a.L - b.L) < 0.01);
  });
  await t.test('formatOklch shape', () => {
    assert.match(formatOklch(0.71234, 0.19876, 28.34), /^oklch\(0\.712 0\.199 28\.3\)$/);
  });
  await t.test('clamp01 bounds', () => {
    assert.equal(clamp01(-0.4), 0);
    assert.equal(clamp01(1.4), 1);
    assert.equal(clamp01(0.4), 0.4);
  });
});
