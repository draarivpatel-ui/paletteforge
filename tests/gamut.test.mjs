// Gamut bisection invariants: constant hue and lightness, output always in
// the sRGB cube, and chroma never increases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gamutMapOklch,
  oklchToSrgb,
  isInSrgbGamut,
  srgbToOklch,
} from '../src/color-science.mjs';

test('bisection maps out-of-gamut colors into [0,1]', async (t) => {
  for (const L of [0.4, 0.65]) {
    for (const H of [0, 45, 90, 140, 200, 260, 320, 359]) {
      await t.test(`L ${L} H ${H} C 0.4`, () => {
        const m = gamutMapOklch(L, 0.4, H);
        assert.ok(isInSrgbGamut(m, 0), `out of gamut ${m.r} ${m.g} ${m.b}`);
        assert.equal(m.H, H, 'hue changed');
        assert.ok(Math.abs(m.L - L) < 1e-9, 'lightness changed');
        assert.ok(m.C <= 0.4, `chroma grew to ${m.C}`);
      });
    }
  }
});

test('bisection is a fixed point for in-gamut colors', async (t) => {
  await t.test('modest chroma stays put', () => {
    const before = oklchToSrgb(0.7, 0.08, 150);
    if (isInSrgbGamut(before)) {
      const m = gamutMapOklch(0.7, 0.08, 150);
      assert.ok(Math.abs(m.C - 0.08) < 1e-9);
    }
  });
  await t.test('all real sRGB colors map to themselves', () => {
    const rng = [0.13, 0.42, 0.71, 0.95];
    for (const r of rng) for (const g of rng) for (const b of rng) {
      const lch = srgbToOklch(r, g, b);
      const m = gamutMapOklch(lch.L, lch.C, lch.H);
      assert.ok(isInSrgbGamut(m, 0));
      // Reconverting should land near the original color.
      assert.ok(Math.abs(m.r - r) < 0.02 && Math.abs(m.g - g) < 0.02 && Math.abs(m.b - b) < 0.02, `drift for ${r},${g},${b}`);
    }
  });
});

test('bisection edge cases', async (t) => {
  await t.test('zero chroma maps to neutral', () => {
    const m = gamutMapOklch(0.5, 0, 200);
    assert.ok(Math.abs(m.r - m.g) < 1e-6 && Math.abs(m.g - m.b) < 1e-6);
  });
  await t.test('L above 1 clamps to white', () => {
    const m = gamutMapOklch(1.4, 0.2, 30);
    assert.ok(m.r >= 0.99 && m.g >= 0.99 && m.b >= 0.99);
  });
  await t.test('L below 0 clamps to black', () => {
    const m = gamutMapOklch(-0.4, 0.2, 30);
    assert.ok(m.r <= 0.01 && m.g <= 0.01 && m.b <= 0.01);
  });
  await t.test('extreme chroma still resolves', () => {
    const m = gamutMapOklch(0.55, 5, 120);
    assert.ok(isInSrgbGamut(m, 0));
    assert.ok(m.C <= 5);
  });
  await t.test('hue is preserved bit-exactly', () => {
    const m = gamutMapOklch(0.6, 0.9, 271.3);
    assert.equal(m.H, 271.3);
  });
});
