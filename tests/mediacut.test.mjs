// Median-cut extraction: determinism, edge cases, dominant-color fidelity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPaletteFromPixels } from '../src/color-science.mjs';
import { mulberry32 } from '../src/generative.mjs';

function makePixels(list) {
  // list: [[r,g,b,a]...]
  const a = new Uint8ClampedArray(list.length * 4);
  list.forEach((p, i) => a.set(p, i * 4));
  return a;
}

test('median-cut edge cases', async (t) => {
  await t.test('empty buffer returns empty', () => {
    assert.deepEqual(extractPaletteFromPixels(new Uint8ClampedArray(0), 0, 0, 5), []);
  });
  await t.test('zero k returns empty', () => {
    const px = makePixels([[255, 0, 0, 255]]);
    assert.deepEqual(extractPaletteFromPixels(px, 1, 1, 0), []);
  });
  await t.test('single color image returns that color', () => {
    const px = makePixels(Array(9).fill([10, 200, 90, 255]));
    const pal = extractPaletteFromPixels(px, 3, 3, 5);
    assert.equal(pal.length, 1);
    assert.equal(pal[0].hex, '#0ac85a');
    assert.equal(pal[0].weight, 9);
  });
  await t.test('k above unique count returns the uniques', () => {
    const px = makePixels([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
    const pal = extractPaletteFromPixels(px, 3, 1, 8);
    assert.equal(pal.length, 3);
    const hexes = pal.map((p) => p.hex).sort();
    assert.deepEqual(hexes, ['#00ff00', '#ff0000', '#0000ff'].sort());
  });
  await t.test('transparent pixels are skipped', () => {
    const px = makePixels([[255, 0, 0, 0], [0, 255, 0, 4], [0, 0, 255, 255], [0, 0, 255, 200]]);
    const pal = extractPaletteFromPixels(px, 2, 2, 4);
    assert.equal(pal.length, 1);
    assert.equal(pal[0].hex, '#0000ff');
  });
  await t.test('all transparent returns empty', () => {
    const px = makePixels([[255, 0, 0, 0], [0, 255, 0, 10]]);
    assert.deepEqual(extractPaletteFromPixels(px, 2, 1, 4), []);
  });
});

test('median-cut determinism', async (t) => {
  const rng = mulberry32(1234);
  const n = 600;
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    px[i * 4] = Math.floor(rng() * 256);
    px[i * 4 + 1] = Math.floor(rng() * 256);
    px[i * 4 + 2] = Math.floor(rng() * 256);
    px[i * 4 + 3] = 255;
  }
  await t.test('same input gives identical palette', () => {
    const a = extractPaletteFromPixels(px, 30, 20, 6);
    const b = extractPaletteFromPixels(px, 30, 20, 6);
    assert.deepEqual(a, b);
  });
  await t.test('returns exactly k colors for rich input', () => {
    const pal = extractPaletteFromPixels(px, 30, 20, 6);
    assert.equal(pal.length, 6);
  });
  await t.test('weights sum to pixel count', () => {
    const pal = extractPaletteFromPixels(px, 30, 20, 6);
    assert.equal(pal.reduce((s, p) => s + p.weight, 0), n);
  });
  await t.test('output is sorted by weight descending', () => {
    const pal = extractPaletteFromPixels(px, 30, 20, 6);
    for (let i = 1; i < pal.length; i++) {
      assert.ok(pal[i - 1].weight >= pal[i].weight);
    }
  });
});

test('median-cut finds dominant colors', async (t) => {
  await t.test('dominant blob keeps plurality and stays near red', () => {
    const px = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) {
      if (i < 80) px.set([200, 40, 30, 255], i * 4);
      else px.set([(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255], i * 4);
    }
    const pal = extractPaletteFromPixels(px, 10, 10, 3);
    // The box holding the 80-weight blob is the heaviest and its average is
    // dominated by red: within a tolerance that allows some noise mixing.
    assert.ok(pal[0].weight >= 80, `top weight ${pal[0].weight}`);
    assert.ok(pal[0].r > 150 && pal[0].g < 120 && pal[0].b < 120, `top ${pal[0].hex}`);
  });
  await t.test('two equal clusters recover exactly at k 2', () => {
    const px = new Uint8ClampedArray(64 * 4);
    for (let i = 0; i < 64; i++) {
      if (i < 32) px.set([10, 10, 10, 255], i * 4);
      else px.set([245, 245, 245, 255], i * 4);
    }
    const pal = extractPaletteFromPixels(px, 8, 8, 2);
    assert.equal(pal.length, 2);
    const hexes = pal.map((p) => p.hex).sort();
    assert.deepEqual(hexes, ['#0a0a0a', '#f5f5f5'].sort());
  });
  await t.test('each result carries rgb weight and hex', () => {
    const px = makePixels([[255, 0, 0, 255], [0, 0, 255, 255]]);
    const pal = extractPaletteFromPixels(px, 2, 1, 2);
    for (const p of pal) {
      assert.ok(Number.isInteger(p.r) && p.r >= 0 && p.r <= 255);
      assert.ok(Number.isInteger(p.weight) && p.weight > 0);
      assert.match(p.hex, /^#[0-9a-f]{6}$/);
    }
  });
});
