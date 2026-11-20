// Color vision deficiency simulation: Vienot-Brettel invariants, bounds, and
// monotonic channel responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateCvd,
  simulateCvdHex,
  isInSrgbGamut,
  CVD_TYPES,
} from '../src/color-science.mjs';

test('CVD output stays in gamut for extreme inputs', async (t) => {
  const extremes = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [1, 1, 0], [0, 1, 1], [1, 0, 1],
    [1, 1, 1], [0, 0, 0], [0.9, 0.1, 0.5],
  ];
  for (const type of CVD_TYPES) {
    for (const [r, g, b] of extremes) {
      await t.test(`${type} of (${r},${g},${b})`, () => {
        const s = simulateCvd(r, g, b, type);
        assert.ok(isInSrgbGamut(s, 0), `out of gamut ${s.r} ${s.g} ${s.b}`);
      });
    }
  }
});

test('CVD preserves neutral grays', async (t) => {
  for (const type of CVD_TYPES) {
    for (const v of [0.2, 0.5, 0.8]) {
      await t.test(`${type} gray ${v}`, () => {
        const s = simulateCvd(v, v, v, type);
        assert.ok(Math.abs(s.r - s.g) < 0.02 && Math.abs(s.g - s.b) < 0.02, `${s.r} ${s.g} ${s.b}`);
      });
    }
  }
});

test('CVD channel monotonicity', async (t) => {
  await t.test('protanopia output rises with input red', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const s = simulateCvd(i / 10, 0, 0, 'protanopia');
      assert.ok(s.r >= prev);
      prev = s.r;
    }
  });
  await t.test('deuteranopia output rises with input green', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const s = simulateCvd(0, i / 10, 0, 'deuteranopia');
      assert.ok(s.g >= prev);
      prev = s.g;
    }
  });
  await t.test('tritanopia output rises with input blue', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const s = simulateCvd(0, 0, i / 10, 'tritanopia');
      assert.ok(s.b >= prev);
      prev = s.b;
    }
  });
});

test('CVD behavior and determinism', async (t) => {
  await t.test('protanopia darkens pure red', () => {
    const s = simulateCvd(1, 0, 0, 'protanopia');
    assert.ok(s.r < 0.55, `red channel ${s.r}`);
  });
  await t.test('tritanopia shifts pure blue toward cyan', () => {
    const s = simulateCvd(0, 0, 1, 'tritanopia');
    assert.ok(s.b < 1 && s.g > s.b * 0.3, `${s.g} ${s.b}`);
  });
  await t.test('simulation is deterministic', () => {
    const a = simulateCvd(0.4, 0.7, 0.2, 'deuteranopia');
    const b = simulateCvd(0.4, 0.7, 0.2, 'deuteranopia');
    assert.deepEqual(a, b);
  });
  await t.test('unknown type is identity', () => {
    const s = simulateCvd(0.3, 0.6, 0.9, 'achromatopsia');
    assert.deepEqual(s, { r: 0.3, g: 0.6, b: 0.9 });
  });
  await t.test('hex wrapper round-trips shape', () => {
    const h = simulateCvdHex('#ff0000', 'protanopia');
    assert.match(h, /^#[0-9a-f]{6}$/);
    assert.equal(simulateCvdHex('garbage', 'protanopia'), '#000000');
  });
  await t.test('white stays near white under all types', () => {
    for (const type of CVD_TYPES) {
      const s = simulateCvd(1, 1, 1, type);
      assert.ok(s.r > 0.95 && s.g > 0.95 && s.b > 0.95, `${type}: ${s.r} ${s.g} ${s.b}`);
    }
  });
});
