// WCAG 2.1 relative luminance and contrast ratio goldens and invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  relativeLuminance,
  contrastRatio,
  contrastBadge,
  contrastMatrix,
  hexToRgb,
  srgbToLinear,
} from '../src/color-science.mjs';

const rgb = (hex) => hexToRgb(hex);

test('WCAG golden values', async (t) => {
  await t.test('black on white is exactly 21', () => {
    assert.ok(Math.abs(contrastRatio(rgb('#000000'), rgb('#ffffff')) - 21) < 0.01);
  });
  await t.test('identical colors are exactly 1', () => {
    assert.ok(Math.abs(contrastRatio(rgb('#3a7bd5'), rgb('#3a7bd5')) - 1) < 1e-9);
  });
  await t.test('white luminance is 1', () => {
    assert.ok(Math.abs(relativeLuminance(1, 1, 1) - 1) < 1e-9);
  });
  await t.test('black luminance is 0', () => {
    assert.equal(relativeLuminance(0, 0, 0), 0);
  });
  await t.test('ratio bounded between 1 and 21', () => {
    const cases = [['#123456', '#fedcba'], ['#777777', '#111111'], ['#00ff00', '#0000ff']];
    for (const [a, b] of cases) {
      const r = contrastRatio(rgb(a), rgb(b));
      assert.ok(r >= 1 && r <= 21, `ratio ${r}`);
    }
  });
});

test('WCAG invariants', async (t) => {
  await t.test('contrast is symmetric', () => {
    const pairs = [['#c8451f', '#f6f1e7'], ['#28324a', '#e2a926'], ['#101010', '#efefef']];
    for (const [a, b] of pairs) {
      assert.ok(Math.abs(contrastRatio(rgb(a), rgb(b)) - contrastRatio(rgb(b), rgb(a))) < 1e-9);
    }
  });
  await t.test('contrast rises monotonically along a gray ramp vs black', () => {
    let prev = 0;
    for (let i = 0; i <= 10; i++) {
      const v = Math.round((i / 10) * 255);
      const c = { r: v / 255, g: v / 255, b: v / 255 };
      const r = contrastRatio(c, { r: 0, g: 0, b: 0 });
      assert.ok(r >= prev, `not monotonic at ${i}`);
      prev = r;
    }
  });
  await t.test('luminance is channel-weighted green heaviest', () => {
    const lr = relativeLuminance(1, 0, 0);
    const lg = relativeLuminance(0, 1, 0);
    const lb = relativeLuminance(0, 0, 1);
    assert.ok(lg > lr && lr > lb, `${lr} ${lg} ${lb}`);
    assert.ok(Math.abs(lr - 0.2126) < 1e-4);
    assert.ok(Math.abs(lb - 0.0722) < 1e-4);
  });
});

test('contrast badges', async (t) => {
  const cases = [
    [7.0, 'AAA'], [12.5, 'AAA'],
    [4.5, 'AA'], [6.99, 'AA'],
    [3.0, 'AA Large'], [4.49, 'AA Large'],
    [2.99, 'Fail'], [1.0, 'Fail'],
  ];
  for (const [ratio, want] of cases) {
    await t.test(`${ratio} earns ${want}`, () => {
      assert.equal(contrastBadge(ratio), want);
    });
  }
});

test('contrast matrix', async (t) => {
  await t.test('matrix is square with 1s on the diagonal', () => {
    const pal = ['#28324a', '#c8451f', '#e2a926', '#7a8f3f', '#efe6d4'].map(rgb);
    const m = contrastMatrix(pal);
    assert.equal(m.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(m[i].length, 5);
      assert.ok(Math.abs(m[i][i] - 1) < 1e-9);
    }
  });
  await t.test('matrix is symmetric', () => {
    const pal = ['#123456', '#abcdef', '#555555'].map(rgb);
    const m = contrastMatrix(pal);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(m[i][j] - m[j][i]) < 1e-9);
    }
  });
  await t.test('empty palette gives empty matrix', () => {
    assert.deepEqual(contrastMatrix([]), []);
  });
});

test('srgbToLinear threshold behavior', async (t) => {
  await t.test('linear segment below 0.04045', () => {
    assert.ok(Math.abs(srgbToLinear(0.04045) - 0.04045 / 12.92) < 1e-9);
    assert.ok(Math.abs(srgbToLinear(0.02) - 0.02 / 12.92) < 1e-12);
  });
  await t.test('power segment above threshold', () => {
    const v = srgbToLinear(0.5);
    assert.ok(Math.abs(v - Math.pow((0.5 + 0.055) / 1.055, 2.4)) < 1e-12);
  });
});
