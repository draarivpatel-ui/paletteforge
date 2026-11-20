// Geometric OKLCH harmony generators: anchor angles, in-gamut output,
// determinism, and adjustable curves/envelopes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateHarmony,
  isInSrgbGamut,
  wrapHue,
  HARMONY_MODES,
} from '../src/color-science.mjs';

const BASE = { L: 0.62, C: 0.13, H: 30 };

test('every harmony mode returns 5 in-gamut swatches', async (t) => {
  for (const mode of HARMONY_MODES) {
    await t.test(mode, () => {
      const s = generateHarmony(BASE, mode, { count: 5 });
      assert.equal(s.length, 5);
      for (const sw of s) {
        assert.ok(isInSrgbGamut(sw.rgb, 0), `${mode} out of gamut`);
        assert.match(sw.hex, /^#[0-9a-f]{6}$/);
        assert.ok(sw.H >= 0 && sw.H < 360);
      }
    });
  }
});

test('harmony anchor geometry', async (t) => {
  await t.test('complementary anchors 180 degrees apart', () => {
    const s = generateHarmony(BASE, 'complementary', { count: 2 });
    const hues = [...new Set(s.map((x) => Math.round(x.H)))].sort((a, b) => a - b);
    assert.ok((hues[1] - hues[0]) === 180, `hues ${hues}`);
  });
  await t.test('triadic anchors 120 degrees apart', () => {
    const s = generateHarmony(BASE, 'triadic', { count: 3 });
    const hues = [...new Set(s.map((x) => Math.round(x.H)))].sort((a, b) => a - b);
    assert.equal(hues.length, 3);
    assert.ok(Math.abs(hues[1] - hues[0] - 120) <= 1);
    assert.ok(Math.abs(hues[2] - hues[1] - 120) <= 1);
  });
  await t.test('tetradic anchors 90 degrees apart', () => {
    const s = generateHarmony(BASE, 'tetradic', { count: 4 });
    const hues = [...new Set(s.map((x) => Math.round(x.H)))].sort((a, b) => a - b);
    assert.equal(hues.length, 4);
    assert.ok(Math.abs(hues[1] - hues[0] - 90) <= 1);
  });
  await t.test('split complementary straddles the complement', () => {
    const s = generateHarmony(BASE, 'split-complementary', { count: 3 });
    const hues = [...new Set(s.map((x) => Math.round(x.H)))].sort((a, b) => a - b);
    assert.equal(hues.length, 3);
    assert.ok(hues[0] === 30 && hues[1] === 180 && hues[2] === 240, `hues ${hues}`);
  });
  await t.test('analogous stays inside its range', () => {
    const s = generateHarmony(BASE, 'analogous', { count: 5, analogousRange: 60 });
    const hues = s.map((x) => x.H);
    assert.ok(Math.min(...hues) >= 0 - 1e-9);
    assert.ok(Math.max(...hues) - Math.min(...hues) <= 60.5, `spread ${Math.max(...hues) - Math.min(...hues)}`);
  });
  await t.test('monochromatic holds a single hue', () => {
    const s = generateHarmony(BASE, 'monochromatic', { count: 5 });
    const hues = new Set(s.map((x) => Math.round(x.H)));
    assert.equal(hues.size, 1);
  });
  await t.test('monochromatic walks lightness', () => {
    const s = generateHarmony(BASE, 'monochromatic', { count: 5 });
    const Ls = s.map((x) => x.L);
    assert.ok(Math.max(...Ls) - Math.min(...Ls) > 0.3);
  });
});

test('harmony controls', async (t) => {
  await t.test('ease curve keeps endpoints symmetric', () => {
    const a = generateHarmony(BASE, 'triadic', { count: 5, lightnessCurve: 'ease' })[0];
    const b = generateHarmony(BASE, 'triadic', { count: 5, lightnessCurve: 'ease' })[4];
    const la = generateHarmony(BASE, 'triadic', { count: 5, lightnessCurve: 'ease' });
    assert.ok(Math.abs(la[0].L - (BASE.L - 0.22)) < 0.02, `L0 ${la[0].L}`);
    assert.ok(Math.abs(la[4].L - (BASE.L + 0.22)) < 0.02, `L4 ${la[4].L}`);
  });
  await t.test('taper envelope reduces end chroma vs middle', () => {
    const s = generateHarmony(BASE, 'monochromatic', { count: 5, chromaEnvelope: 'taper' });
    assert.ok(s[0].C < s[2].C, `${s[0].C} vs ${s[2].C}`);
  });
  await t.test('flat envelope keeps chroma level', () => {
    const s = generateHarmony(BASE, 'monochromatic', { count: 5, chromaEnvelope: 'flat' });
    for (const sw of s) assert.ok(Math.abs(sw.C - BASE.C) < 1e-9, `C ${sw.C}`);
  });
  await t.test('chromaScale multiplies', () => {
    const s = generateHarmony(BASE, 'monochromatic', { count: 5, chromaEnvelope: 'flat', chromaScale: 0.5 });
    for (const sw of s) assert.ok(Math.abs(sw.C - BASE.C * 0.5) < 1e-9);
  });
  await t.test('deterministic output', () => {
    const a = generateHarmony(BASE, 'tetradic', { count: 5 });
    const b = generateHarmony(BASE, 'tetradic', { count: 5 });
    assert.deepEqual(a, b);
  });
  await t.test('unknown mode falls back to triadic', () => {
    const a = generateHarmony(BASE, 'bogus', { count: 3 });
    const b = generateHarmony(BASE, 'triadic', { count: 3 });
    assert.deepEqual(a.map((x) => x.hex), b.map((x) => x.hex));
  });
  await t.test('hue wraps around 360', () => {
    assert.equal(wrapHue(390), 30);
    assert.equal(wrapHue(-30), 330);
    const s = generateHarmony({ ...BASE, H: 350 }, 'complementary', { count: 2 });
    assert.ok(s.every((x) => x.H >= 0 && x.H < 360));
  });
});
