// Wave 2 adversarial regressions: NaN hardening through the gamut and harmony
// pipelines, hostile median-cut inputs, and tampered hash values that must
// fall back instead of reaching the UI. Every probe here reproduced a real
// Wave 2 audit finding or guards a library edge that the UI can hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01,
  gamutMapOklch,
  generateHarmony,
  oklchToHex,
  isInSrgbGamut,
  extractPaletteFromPixels,
} from '../src/color-science.mjs';
import { decodeState } from '../src/generative.mjs';

const finiteRgb = (m) =>
  Number.isFinite(m.r) && Number.isFinite(m.g) && Number.isFinite(m.b);

test('clamp01 hardens against NaN', async (t) => {
  await t.test('NaN maps to 0 instead of propagating', () => {
    assert.equal(clamp01(NaN), 0);
  });
  await t.test('regular bounds unchanged', () => {
    assert.equal(clamp01(-0.5), 0);
    assert.equal(clamp01(0.5), 0.5);
    assert.equal(clamp01(1.5), 1);
  });
});

test('gamut map resolves non-finite inputs to finite in-gamut colors', async (t) => {
  await t.test('NaN lightness maps to a finite color', () => {
    const m = gamutMapOklch(NaN, 0.1, 90);
    assert.ok(finiteRgb(m), JSON.stringify(m));
    assert.ok(isInSrgbGamut(m, 0), 'out of gamut');
    assert.equal(m.L, 0);
  });
  await t.test('NaN hue maps to a finite in-gamut color', () => {
    const m = gamutMapOklch(0.5, 0.1, NaN);
    assert.ok(finiteRgb(m), JSON.stringify(m));
    assert.ok(isInSrgbGamut(m, 0), 'out of gamut');
    assert.equal(m.H, 0);
  });
  await t.test('NaN chroma maps to neutral gray', () => {
    const m = gamutMapOklch(0.5, NaN, 200);
    assert.ok(finiteRgb(m), JSON.stringify(m));
    assert.equal(m.C, 0);
  });
  await t.test('Infinity lightness clamps to white', () => {
    const m = gamutMapOklch(Infinity, 0.2, 45);
    assert.ok(finiteRgb(m), JSON.stringify(m));
    assert.equal(m.L, 1);
    // L 1 admits only near-zero chroma, so the bisection lands just inside
    // the gamut epsilon; assert near-white rather than bit-exact channels.
    assert.ok(m.r > 0.9999 && m.g > 0.9999 && m.b > 0.9999, JSON.stringify(m));
    assert.ok(isInSrgbGamut(m, 0), 'out of gamut');
  });
  await t.test('NaN never reaches a hex string', () => {
    const h = oklchToHex(NaN, NaN, NaN);
    assert.match(h, /^#[0-9a-f]{6}$/);
    assert.ok(!h.includes('NaN'), h);
  });
});

test('harmony generation survives a malformed base', async (t) => {
  await t.test('NaN base falls back to a usable anchor', () => {
    const s = generateHarmony({ L: NaN, C: NaN, H: NaN }, 'triadic', { count: 5 });
    assert.equal(s.length, 5);
    for (const sw of s) {
      assert.ok(Number.isFinite(sw.L) && Number.isFinite(sw.C) && Number.isFinite(sw.H));
      assert.match(sw.hex, /^#[0-9a-f]{6}$/);
      assert.ok(isInSrgbGamut(sw.rgb, 0), 'out of gamut');
    }
  });
  await t.test('null base falls back instead of throwing', () => {
    const s = generateHarmony(null, 'analogous', { count: 3 });
    assert.equal(s.length, 3);
    assert.ok(s.every((sw) => isInSrgbGamut(sw.rgb, 0)));
  });
  await t.test('NaN count falls back to 5', () => {
    const s = generateHarmony({ L: 0.6, C: 0.1, H: 30 }, 'triadic', { count: NaN });
    assert.equal(s.length, 5);
  });
});

test('median cut rejects hostile dimensions and buffers', async (t) => {
  const solid = (n) => {
    const d = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      d[i * 4] = 90;
      d[i * 4 + 1] = 120;
      d[i * 4 + 2] = 140;
      d[i * 4 + 3] = 255;
    }
    return d;
  };
  await t.test('NaN dimensions return empty', () => {
    assert.deepEqual(extractPaletteFromPixels(solid(64), NaN, NaN, 6), []);
    assert.deepEqual(extractPaletteFromPixels(solid(64), 8, NaN, 6), []);
  });
  await t.test('Infinity dimensions return empty', () => {
    assert.deepEqual(extractPaletteFromPixels(solid(64), Infinity, 8, 6), []);
  });
  await t.test('negative dimensions return empty', () => {
    assert.deepEqual(extractPaletteFromPixels(solid(64), -8, 8, 6), []);
    assert.deepEqual(extractPaletteFromPixels(solid(64), 8, -8, 6), []);
  });
  await t.test('NaN k returns empty', () => {
    assert.deepEqual(extractPaletteFromPixels(solid(64), 8, 8, NaN), []);
  });
  await t.test('non-multiple-of-4 buffer is safe', () => {
    const d = new Uint8ClampedArray([90, 120, 140, 255, 90, 120, 140]);
    const p = extractPaletteFromPixels(d, 2, 2, 6);
    assert.ok(p.length >= 0 && p.length <= 1);
  });
  await t.test('buffer smaller than w times h clamps to available pixels', () => {
    const p = extractPaletteFromPixels(solid(1), 100, 100, 6);
    assert.equal(p.length, 1);
    assert.equal(p[0].hex, '#5a788c');
  });
});

test('tampered hash values fall back instead of crashing the UI', async (t) => {
  const DEF = { seed: 'default', mode: 'flow', harmony: 'analogous', symmetry: 'p4m', cvd: 'none', theme: 'light' };
  await t.test('well-formed but unknown harmony falls back to default', () => {
    // This exact shape previously passed validation and later crashed the
    // placard label lookup on hashchange.
    const s = decodeState('#harmony=zzz', DEF);
    assert.equal(s.harmony, 'analogous');
  });
  await t.test('uppercase harmony falls back to default', () => {
    const s = decodeState('#harmony=TRIADIC', DEF);
    assert.equal(s.harmony, 'analogous');
  });
  await t.test('every real harmony name still round-trips', () => {
    for (const h of ['complementary', 'split-complementary', 'triadic', 'analogous', 'tetradic', 'monochromatic']) {
      const s = decodeState('#harmony=' + h, DEF);
      assert.equal(s.harmony, h);
    }
  });
  await t.test('malformed hash still returns null', () => {
    assert.equal(decodeState(null, DEF), null);
  });
});
