// URL hash codec: symmetry, validation, tamper resilience.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeState,
  decodeState,
  sanitizeSeed,
  CVD_VALUES,
} from '../src/generative.mjs';

const DEF = { seed: 'default', mode: 'flow', harmony: 'triadic', symmetry: 'p4m', cvd: 'none', theme: 'light' };

test('hash codec round-trips', async (t) => {
  const cases = [
    { seed: 'night studio', mode: 'moire', harmony: 'tetradic', symmetry: 'p6m', cvd: 'deuteranopia', theme: 'dark' },
    { seed: 'a', mode: 'bauhaus', harmony: 'analogous', symmetry: 'p2', cvd: 'tritanopia', theme: 'light' },
    { seed: 'with spaces & symbols!', mode: 'flow', harmony: 'complementary', symmetry: 'p4m', cvd: 'none', theme: 'light' },
    { seed: 'seed', mode: 'wallpaper', harmony: 'monochromatic', symmetry: 'p2', cvd: 'protanopia', theme: 'dark' },
  ];
  for (const [i, st] of cases.entries()) {
    await t.test(`case ${i}`, () => {
      const rt = decodeState(encodeState(st), DEF);
      assert.equal(rt.seed, sanitizeSeed(st.seed));
      assert.equal(rt.mode, st.mode);
      assert.equal(rt.harmony, st.harmony);
      assert.equal(rt.symmetry, st.symmetry);
      assert.equal(rt.cvd, st.cvd);
      assert.equal(rt.theme, st.theme);
    });
  }
});

test('hash codec resilience', async (t) => {
  await t.test('empty hash returns defaults', () => {
    assert.deepEqual(decodeState('#', DEF), DEF);
    assert.deepEqual(decodeState('', DEF), DEF);
  });
  await t.test('missing hash without # works', () => {
    const s = decodeState('mode=moire&seed=x', DEF);
    assert.equal(s.mode, 'moire');
    assert.equal(s.seed, 'x');
  });
  await t.test('bogus mode falls back', () => {
    const s = decodeState('#mode=hax', DEF);
    assert.equal(s.mode, 'flow');
  });
  await t.test('bogus cvd becomes none', () => {
    const s = decodeState('#cvd=zzz', DEF);
    assert.equal(s.cvd, 'none');
  });
  await t.test('bogus theme becomes light', () => {
    const s = decodeState('#theme=rainbow', DEF);
    assert.equal(s.theme, 'light');
  });
  await t.test('bogus symmetry falls back', () => {
    const s = decodeState('#symmetry=p9x', DEF);
    assert.equal(s.symmetry, 'p4m');
  });
  await t.test('injected script seed stays inert text', () => {
    const s = decodeState('#seed=' + encodeURIComponent('<script>alert(1)</script>'), DEF);
    assert.equal(s.seed, '<script>alert(1)</script>');
  });
  await t.test('control chars are stripped from seeds', () => {
    const s = decodeState('#seed=a%00b%0Dc', DEF);
    assert.equal(s.seed, 'abc');
  });
  await t.test('seeds cap at 64 chars', () => {
    const s = decodeState('#seed=' + 'x'.repeat(200), DEF);
    assert.equal(s.seed.length, 64);
  });
  await t.test('empty seed param keeps default', () => {
    const s = decodeState('#seed=', DEF);
    assert.equal(s.seed, 'default');
  });
  await t.test('non-string hash returns null', () => {
    assert.equal(decodeState(null, DEF), null);
    assert.equal(decodeState(undefined, DEF), null);
    assert.equal(decodeState(42, DEF), null);
  });
  await t.test('harmony accepts only lowercase word chars', () => {
    assert.equal(decodeState('#harmony=TRIADIC', DEF).harmony, 'triadic');
    assert.equal(decodeState('#harmony=split-complementary', DEF).harmony, 'split-complementary');
    const s = decodeState('#harmony=' + encodeURIComponent('<img>'), DEF);
    assert.equal(s.harmony, 'triadic');
  });
});

test('encodeState output shape', async (t) => {
  await t.test('hash starts with # and carries seed', () => {
    const h = encodeState({ ...DEF, seed: 'night' });
    assert.ok(h.startsWith('#'));
    assert.ok(h.includes('seed=night'));
  });
  await t.test('default-ish fields are omitted', () => {
    const h = encodeState({ seed: 'x', mode: 'bogus', cvd: 'none', theme: 'light' });
    assert.ok(!h.includes('mode='));
    assert.ok(!h.includes('cvd='));
    assert.ok(!h.includes('theme='));
  });
  await t.test('cvd values list is closed', () => {
    assert.deepEqual(CVD_VALUES, ['none', 'protanopia', 'deuteranopia', 'tritanopia']);
  });
  await t.test('sanitizeSeed handles nullish input', () => {
    assert.equal(sanitizeSeed(null), '');
    assert.equal(sanitizeSeed(undefined), '');
    assert.equal(sanitizeSeed('  kept  '), '  kept  ');
  });
});
