// Property checks over the color pipeline: deep round-trips, gamut-map
// invariants, CVD matrix algebra, WCAG bounds, and generative determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  srgbToOklch,
  oklchToSrgb,
  srgbToLinear,
  linearToSrgb,
  hexToRgb,
  rgbToHex,
  oklchToHex,
  hexToOklch,
  gamutMapOklch,
  isInSrgbGamut,
  relativeLuminance,
  contrastRatio,
  contrastBadge,
  contrastMatrix,
  simulateCvd,
  simulateCvdHex,
  generateHarmony,
  wrapHue,
  extractPaletteFromPixels,
  CVD_TYPES,
  CVD_MATRICES,
  HARMONY_MODES,
} from '../src/color-science.mjs';
import { mulberry32, fnv1a, makeRng, encodeState, decodeState, exportPosterSvg, MODES } from '../src/generative.mjs';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('hex to OKLCH to hex round-trips within one quantization step', async (t) => {
  // A hex triple is in gamut by definition, so the only error the pipeline
  // may add is float noise inside one 1/255 step.
  const rng = mulberry32(fnv1a('hex-rt'));
  for (let batch = 0; batch < 8; batch++) {
    await t.test(`batch ${batch}`, () => {
      for (let i = 0; i < 60; i++) {
        const r = Math.floor(rng() * 256);
        const g = Math.floor(rng() * 256);
        const b = Math.floor(rng() * 256);
        const hex = rgbToHex(r / 255, g / 255, b / 255);
        const ok = hexToOklch(hex);
        const s = oklchToSrgb(ok.L, ok.C, ok.H);
        const back = rgbToHex(s.r, s.g, s.b);
        const [c1, c2] = [hexToRgb(hex), hexToRgb(back)];
        const err = Math.max(Math.abs(c1.r - c2.r), Math.abs(c1.g - c2.g), Math.abs(c1.b - c2.b));
        assert.ok(err <= 1 / 255 + 1e-9, `${hex} -> ${back} err ${err}`);
      }
    });
  }
});

test('oklch hue and wrap invariants', async (t) => {
  await t.test('wrapHue normalizes into [0, 360)', () => {
    const cases = [[-30, 330], [390, 30], [720, 0], [-720, 0], [0, 0], [359.9, 359.9]];
    for (const [h, want] of cases) assert.ok(close(wrapHue(h), want), `${h} -> ${wrapHue(h)}`);
  });
  await t.test('srgbToOklch hue always lands in [0, 360)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 80; i++) {
      const ok = srgbToOklch(rng(), rng(), rng());
      assert.ok(ok.H >= 0 && ok.H < 360, `H ${ok.H}`);
    }
  });
  await t.test('oklab hue survives a full rotation unchanged', () => {
    const a = srgbToOklch(0.8, 0.3, 0.1);
    const b = oklchToSrgb(a.L, a.C, wrapHue(a.H + 360));
    const c = oklchToSrgb(a.L, a.C, a.H);
    assert.ok(close(b.r, c.r, 1e-9) && close(b.g, c.g, 1e-9) && close(b.b, c.b, 1e-9));
  });
});

test('lightness ordering properties', async (t) => {
  await t.test('oklch L rises monotonically along the gray ramp', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = i / 20;
      const { L } = srgbToOklch(v, v, v);
      assert.ok(L >= prev, `L ${L} at ${v}`);
      prev = L;
    }
  });
  await t.test('relative luminance rises monotonically along the gray ramp', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = i / 20;
      const y = relativeLuminance(v, v, v);
      assert.ok(y >= prev, `Y ${y} at ${v}`);
      prev = y;
    }
  });
  await t.test('oklch L of equal channels has no chroma', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 30; i++) {
      const v = rng();
      const { C } = srgbToOklch(v, v, v);
      assert.ok(C < 1e-6, `C ${C} at ${v}`);
    }
  });
});

test('transfer function inverse over dense samples', async (t) => {
  const rng = mulberry32(19);
  for (let batch = 0; batch < 3; batch++) {
    await t.test(`batch ${batch}`, () => {
      for (let i = 0; i < 80; i++) {
        const c = rng();
        assert.ok(close(linearToSrgb(srgbToLinear(c)), c, 1e-9), `at ${c}`);
      }
    });
  }
  await t.test('threshold continuity at 0.04045', () => {
    const below = srgbToLinear(0.04045);
    const above = srgbToLinear(0.040450000001);
    assert.ok(close(below, above, 1e-4), `${below} ${above}`);
  });
});

test('WCAG contrast invariants over random pairs', async (t) => {
  const rng = mulberry32(23);
  for (let batch = 0; batch < 3; batch++) {
    await t.test(`batch ${batch} bounded and symmetric`, () => {
      for (let i = 0; i < 40; i++) {
        const a = { r: rng(), g: rng(), b: rng() };
        const b = { r: rng(), g: rng(), b: rng() };
        const rab = contrastRatio(a, b);
        assert.ok(rab >= 1 && rab <= 21, `ratio ${rab}`);
        assert.ok(close(rab, contrastRatio(b, a), 1e-9));
      }
    });
  }
  await t.test('badge is a pure threshold function', () => {
    assert.equal(contrastBadge(2.999), 'Fail');
    assert.equal(contrastBadge(3.001), 'AA Large');
    assert.equal(contrastBadge(4.499), 'AA Large');
    assert.equal(contrastBadge(4.501), 'AA');
    assert.equal(contrastBadge(6.999), 'AA');
    assert.equal(contrastBadge(7.001), 'AAA');
  });
  await t.test('matrix over random palettes is symmetric with unit diagonal', () => {
    for (let k = 0; k < 5; k++) {
      const pal = [];
      for (let i = 0; i < 6; i++) pal.push({ r: rng(), g: rng(), b: rng() });
      const m = contrastMatrix(pal);
      for (let i = 0; i < 6; i++) {
        assert.ok(close(m[i][i], 1));
        for (let j = 0; j < 6; j++) assert.ok(close(m[i][j], m[j][i], 1e-9));
      }
    }
  });
});

test('CVD matrices are stochastic: each row sums to one', async (t) => {
  for (const type of CVD_TYPES) {
    await t.test(type, () => {
      const M = CVD_MATRICES[type];
      for (let row = 0; row < 3; row++) {
        const sum = M[row * 3] + M[row * 3 + 1] + M[row * 3 + 2];
        assert.ok(close(sum, 1, 1e-5), `${type} row ${row} sums ${sum}`);
      }
    });
  }
});

test('CVD fixes the achromatic anchors', async (t) => {
  for (const type of CVD_TYPES) {
    await t.test(`${type} maps black to black and white to white`, () => {
      const k = simulateCvd(0, 0, 0, type);
      const w = simulateCvd(1, 1, 1, type);
      assert.ok(Math.max(k.r, k.g, k.b) < 1e-9, `black -> ${k.r} ${k.g} ${k.b}`);
      assert.ok(Math.min(w.r, w.g, w.b) > 1 - 1e-3, `white -> ${w.r} ${w.g} ${w.b}`);
    });
    await t.test(`${type} keeps a gray ramp neutral`, () => {
      for (let i = 0; i <= 10; i++) {
        const v = i / 10;
        const s = simulateCvd(v, v, v, type);
        const spread = Math.max(s.r, s.g, s.b) - Math.min(s.r, s.g, s.b);
        assert.ok(spread < 0.03, `${type} spread ${spread} at ${v}`);
      }
    });
  }
  await t.test('simulateCvdHex reproduces simulateCvd on hex input', () => {
    const rng = mulberry32(29);
    for (let i = 0; i < 20; i++) {
      const hex = rgbToHex(rng(), rng(), rng());
      const c = hexToRgb(hex);
      for (const type of CVD_TYPES) {
        const want = simulateCvd(c.r, c.g, c.b, type);
        assert.equal(simulateCvdHex(hex, type), rgbToHex(want.r, want.g, want.b));
      }
    }
  });
});

test('gamut mapping invariants', async (t) => {
  await t.test('holds hue and lightness for a hue sweep', () => {
    for (let h = 0; h < 360; h += 30) {
      const m = gamutMapOklch(0.65, 0.5, h);
      assert.ok(isInSrgbGamut(m, 0), `H ${h}`);
      assert.ok(close(m.H, wrapHue(h)), `H ${m.H}`);
      assert.ok(close(m.L, 0.65), `L ${m.L}`);
      assert.ok(m.C <= 0.5 + 1e-9, `C ${m.C}`);
    }
  });
  await t.test('is idempotent: mapping twice changes nothing', () => {
    const rng = mulberry32(31);
    for (let i = 0; i < 40; i++) {
      const first = gamutMapOklch(rng(), rng() * 0.5, rng() * 360);
      const second = gamutMapOklch(first.L, first.C, first.H);
      assert.equal(rgbToHex(first.r, first.g, first.b), rgbToHex(second.r, second.g, second.b));
    }
  });
  await t.test('non-finite inputs still land in gamut', () => {
    for (const [L, C, H] of [[NaN, 0.2, 30], [0.6, NaN, 30], [0.6, 0.2, NaN], [Infinity, 0.5, 0], [0.6, Infinity, 0]]) {
      const m = gamutMapOklch(L, C, H);
      assert.ok(isInSrgbGamut(m, 0), `${L} ${C} ${H}`);
    }
  });
});

test('harmony generation invariants', async (t) => {
  await t.test('every mode yields in-gamut canonical hexes', () => {
    const rng = mulberry32(37);
    for (const mode of HARMONY_MODES) {
      const base = { L: 0.3 + rng() * 0.5, C: 0.05 + rng() * 0.2, H: rng() * 360 };
      const out = generateHarmony(base, mode, { count: 5 });
      assert.equal(out.length, 5, mode);
      for (const s of out) {
        assert.match(s.hex, /^#[0-9a-f]{6}$/, `${mode} ${s.hex}`);
        assert.ok(isInSrgbGamut(s.rgb, 0), `${mode} ${s.hex}`);
        assert.ok(s.H >= 0 && s.H < 360, `${mode} H ${s.H}`);
      }
    }
  });
  await t.test('count is honored and clamped', () => {
    assert.equal(generateHarmony({ L: 0.6, C: 0.1, H: 20 }, 'triadic', { count: 1 }).length, 1);
    assert.equal(generateHarmony({ L: 0.6, C: 0.1, H: 20 }, 'triadic', { count: 12 }).length, 12);
    assert.equal(generateHarmony({ L: 0.6, C: 0.1, H: 20 }, 'triadic', { count: 99 }).length, 12);
    assert.equal(generateHarmony({ L: 0.6, C: 0.1, H: 20 }, 'triadic', { count: 0 }).length, 1);
  });
  await t.test('hue anchors hit the documented rotations', () => {
    const base = { L: 0.6, C: 0.1, H: 10 };
    const tri = generateHarmony(base, 'triadic', { count: 3, lightnessSpread: 0, chromaEnvelope: 'flat' });
    const hues = tri.map((s) => Math.round(wrapHue(s.H)));
    assert.deepEqual(hues, [10, 130, 250]);
    const comp = generateHarmony(base, 'complementary', { count: 2, lightnessSpread: 0, chromaEnvelope: 'flat' });
    assert.deepEqual(comp.map((s) => Math.round(wrapHue(s.H))), [10, 190]);
  });
  await t.test('malformed base falls back instead of NaN', () => {
    for (const bad of [null, undefined, {}, { L: NaN, C: NaN, H: NaN }, 'junk']) {
      const out = generateHarmony(bad, 'triadic', { count: 3 });
      assert.ok(out.every((s) => /^#[0-9a-f]{6}$/.test(s.hex) && isInSrgbGamut(s.rgb, 0)));
    }
  });
});

test('median cut properties', async (t) => {
  const makePixels = (colors, counts) => {
    const data = [];
    colors.forEach((c, i) => {
      for (let k = 0; k < counts[i]; k++) data.push(c[0], c[1], c[2], 255);
    });
    return { data: new Uint8ClampedArray(data), px: counts.reduce((a, b) => a + b, 0) };
  };
  await t.test('weights never exceed the pixel count', () => {
    const { data, px } = makePixels([[200, 40, 20], [40, 80, 200], [250, 240, 220]], [50, 30, 20]);
    const out = extractPaletteFromPixels(data, 10, 10, 5);
    const w = out.reduce((s, p) => s + p.weight, 0);
    assert.ok(w <= px, `${w} vs ${px}`);
  });
  await t.test('is deterministic across repeated calls', () => {
    const { data } = makePixels([[200, 40, 20], [40, 80, 200], [250, 240, 220], [10, 10, 10]], [40, 30, 20, 10]);
    const a = extractPaletteFromPixels(data, 10, 10, 4).map((p) => p.hex);
    const b = extractPaletteFromPixels(data, 10, 10, 4).map((p) => p.hex);
    assert.deepEqual(a, b);
  });
  await t.test('never returns more than k colors', () => {
    const { data } = makePixels(
      [[10, 10, 10], [60, 60, 60], [110, 110, 110], [160, 160, 160], [210, 210, 210], [250, 250, 250]],
      [9, 9, 9, 9, 9, 9]
    );
    assert.ok(extractPaletteFromPixels(data, 9, 6, 3).length <= 3);
  });
});

test('state codec and poster determinism properties', async (t) => {
  await t.test('random states survive the hash round-trip', () => {
    const rng = mulberry32(41);
    for (let i = 0; i < 12; i++) {
      const st = {
        seed: `seed ${Math.floor(rng() * 1000)}`,
        mode: MODES[Math.floor(rng() * MODES.length)],
        harmony: HARMONY_MODES[Math.floor(rng() * HARMONY_MODES.length)],
        symmetry: ['p4m', 'p6m', 'p2'][Math.floor(rng() * 3)],
        cvd: ['none', ...CVD_TYPES][Math.floor(rng() * 4)],
        theme: rng() < 0.5 ? 'dark' : 'light',
      };
      const rt = decodeState(encodeState(st), { seed: 'd', mode: 'flow', harmony: 'triadic', symmetry: 'p4m', cvd: 'none', theme: 'light' });
      assert.equal(rt.seed, st.seed);
      assert.equal(rt.mode, st.mode);
      assert.equal(rt.harmony, st.harmony);
      assert.equal(rt.symmetry, st.symmetry);
      assert.equal(rt.cvd, st.cvd);
      assert.equal(rt.theme, st.theme);
    }
  });
  await t.test('every mode emits NaN-free svg for a seed sweep', () => {
    const pal = ['#28324a', '#c8451f', '#e2a926', '#7a8f3f', '#efe6d4'];
    for (const mode of MODES) {
      for (let i = 0; i < 5; i++) {
        const svg = exportPosterSvg(`sweep-${i}`, mode, pal);
        assert.ok(!/NaN|undefined/.test(svg), `${mode} seed ${i}`);
        assert.ok(svg.length > 500, `${mode} seed ${i} too small`);
      }
    }
  });
  await t.test('same inputs give identical svg', () => {
    const pal = ['#111111', '#555555', '#999999'];
    const a = exportPosterSvg('fixed', 'wallpaper', pal, { symmetry: 'p6m' });
    const b = exportPosterSvg('fixed', 'wallpaper', pal, { symmetry: 'p6m' });
    assert.equal(a, b);
  });
});
