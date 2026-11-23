// Gamut lab suite: pure-JS SHA-256 known-answer and cross-validation,
// exact gamut-cusp boundary bisection, the 6x4 harmony x vision comparator,
// Oklab Delta-E separability, audited digest parity across JSON/CSV/Markdown,
// CSV formula-injection safety, canonical-JSON stability, and hostile-input
// hardening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  sha256Hex,
  utf8Bytes,
  canonicalJson,
  gamutBoundaryC,
  gamutSlice,
  projectToSlice,
  oklabOfHex,
  deltaEOK,
  deltaEOKHex,
  visionPalette,
  pairwiseCellStats,
  compareHarmonyGrid,
  buildAuditPayload,
  auditBundle,
  auditDigestOf,
  verifyAudit,
  tamperAuditDemo,
  csvCell,
  csvTable,
  exportAuditJson,
  exportAuditCsv,
  exportAuditMarkdown,
  LAB_VISIONS,
  GAMUT_C_CEILING,
  GAMUT_SLICE_STEPS,
} from '../src/gamut-lab.mjs';
import {
  hexToRgb,
  hexToOklch,
  oklchToSrgb,
  isInSrgbGamut,
  contrastRatio,
  simulateCvdHex,
  generateHarmony,
  HARMONY_MODES,
} from '../src/color-science.mjs';

const realSha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const BASE = hexToOklch('#c8451f');
const AUDIT_KEY = {
  seed: 'first light',
  mode: 'flow',
  harmony: 'triadic',
  symmetry: 'p4m',
  cvd: 'none',
  theme: 'light',
  base: '#c8451f',
  palette: ['#28324a', '#c8451f', '#e2a926', '#7a8f3f', '#efe6d4'],
};

// ---------------------------------------------------------------------------

test('SHA-256 known-answer vectors (FIPS 180-4)', async (t) => {
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'The quick brown fox jumps over the lazy dog',
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ],
    [
      'The quick brown fox jumps over the lazy dog.',
      'ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c',
    ],
  ];
  for (const [msg, want] of vectors) {
    await t.test(`${JSON.stringify(msg.slice(0, 20))}`, () => {
      assert.equal(sha256Hex(msg), want);
    });
  }
  await t.test('one million byte message', () => {
    assert.equal(
      sha256Hex('a'.repeat(1000000)),
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
    );
  });
});

test('SHA-256 agrees with node:crypto on varied inputs', async (t) => {
  const inputs = [
    'paletteforge',
    'oklch(0.55 0.14 28)',
    'cafe \u00e9 \u20ac\u20ac\u20ac',
    'snowman \u2603 emoji \ud83d\ude00',
    'a'.repeat(0),
    'x'.repeat(55),
    'y'.repeat(56),
    'z'.repeat(64),
    'w'.repeat(65),
    'seed orbit study mode flow',
    '#c8451f',
    'line\nbreak\ttab',
    'lone surrogate start \ud800 end',
    'lone surrogate low \udc00 end',
    'null-in-name',
    '0.625 0.255462',
    'pair 4.4996653',
    'unicode boundary \ud7ff\ue000',
    '{"json":"like"}',
    '   ',
  ];
  for (const s of inputs) {
    await t.test(`len ${s.length} ${JSON.stringify(s.slice(0, 14))}`, () => {
      assert.equal(sha256Hex(s), realSha(s));
      assert.match(sha256Hex(s), /^[0-9a-f]{64}$/);
    });
  }
});

test('utf8Bytes encoding', async (t) => {
  await t.test('ascii passthrough', () => {
    assert.deepEqual(utf8Bytes('abc'), [97, 98, 99]);
  });
  await t.test('two-byte euro', () => {
    assert.deepEqual(utf8Bytes('\u20ac'), [0xe2, 0x82, 0xac]);
  });
  await t.test('four-byte emoji surrogate pair', () => {
    assert.deepEqual(utf8Bytes('\ud83d\ude00'), [0xf0, 0x9f, 0x98, 0x80]);
  });
  await t.test('lone surrogates become U+FFFD', () => {
    assert.deepEqual(utf8Bytes('\ud800'), [0xef, 0xbf, 0xbd]);
    assert.deepEqual(utf8Bytes('\udc00'), [0xef, 0xbf, 0xbd]);
    assert.deepEqual(utf8Bytes('\ud800x'), [0xef, 0xbf, 0xbd, 0x78]);
  });
});

test('canonicalJson stability', async (t) => {
  await t.test('key order does not matter', () => {
    assert.equal(
      canonicalJson({ b: 1, a: [3, { z: 1, y: 2 }] }),
      canonicalJson({ a: [3, { y: 2, z: 1 }], b: 1 })
    );
  });
  await t.test('nested output is exact', () => {
    assert.equal(canonicalJson({ b: [true, null], a: 'x' }), '{"a":"x","b":[true,null]}');
  });
  await t.test('non-finite numbers normalize to null', () => {
    assert.equal(canonicalJson({ a: NaN, b: Infinity, c: -Infinity }), '{"a":null,"b":null,"c":null}');
  });
  await t.test('undefined and functions normalize to null', () => {
    assert.equal(canonicalJson({ a: undefined, b: () => 1 }), '{"a":null,"b":null}');
  });
  await t.test('negative zero becomes zero', () => {
    assert.equal(canonicalJson(-0), '0');
    assert.equal(canonicalJson({ a: -0 }), '{"a":0}');
  });
  await t.test('empty containers and literals', () => {
    assert.equal(canonicalJson({}), '{}');
    assert.equal(canonicalJson([]), '[]');
    assert.equal(canonicalJson('s'), '"s"');
    assert.equal(canonicalJson(4.5), '4.5');
  });
  await t.test('a parsed __proto__ key serializes as data', () => {
    const o = JSON.parse('{"__proto__":1,"a":2}');
    assert.equal(canonicalJson(o), '{"__proto__":1,"a":2}');
    assert.equal({}.x, undefined);
  });
  await t.test('circular structures serialize as null not a crash', () => {
    const a = [1];
    a.push(a);
    assert.equal(canonicalJson(a), '[1,null]');
    const o = { x: 1 };
    o.self = o;
    assert.equal(canonicalJson(o), '{"self":null,"x":1}');
  });
  await t.test('shared non-circular references still serialize fully', () => {
    const inner = { v: 1 };
    assert.equal(canonicalJson([inner, inner]), '[{"v":1},{"v":1}]');
  });
});

// ---------------------------------------------------------------------------

test('gamut boundary closes exactly at the achromatic axis', async (t) => {
  for (const H of [0, 28, 60, 90, 140, 200, 260, 330]) {
    await t.test(`H ${H} endpoints are exactly 0`, () => {
      assert.equal(gamutBoundaryC(0, H), 0);
      assert.equal(gamutBoundaryC(1, H), 0);
    });
  }
  for (const H of [0, 45, 90, 140, 200, 260, 320]) {
    await t.test(`H ${H} interior boundary is positive and in gamut`, () => {
      const c = gamutBoundaryC(0.6, H);
      assert.ok(c > 0.005 && c <= GAMUT_C_CEILING, `C ${c}`);
      assert.ok(isInSrgbGamut(oklchToSrgb(0.6, c, H), 0), 'boundary point out of gamut');
    });
  }
  for (const H of [10, 80, 150, 220, 300]) {
    await t.test(`H ${H} just past the boundary is out of gamut`, () => {
      const c = gamutBoundaryC(0.55, H);
      if (c < GAMUT_C_CEILING - 0.01) {
        assert.ok(!isInSrgbGamut(oklchToSrgb(0.55, c + 0.01, H), 0));
      }
    });
  }
});

test('gamut slice hull and cusp', async (t) => {
  for (const H of [0, 60, 120, 180, 240, 300]) {
    await t.test(`H ${H} slice shape`, () => {
      const s = gamutSlice(H);
      assert.equal(s.H, H);
      assert.equal(s.points.length, GAMUT_SLICE_STEPS + 1);
      assert.equal(s.points[0].C, 0);
      assert.equal(s.points[GAMUT_SLICE_STEPS].C, 0);
      assert.ok(s.cusp.C > 0.05 && s.cusp.C < GAMUT_C_CEILING, `cusp C ${s.cusp.C}`);
      assert.ok(s.cusp.L > 0 && s.cusp.L < 1);
      const maxC = Math.max(...s.points.map((p) => p.C));
      assert.ok(Math.abs(s.cusp.C - maxC) < 1e-9, 'cusp is the maximum');
      assert.ok(isInSrgbGamut(oklchToSrgb(s.cusp.L, s.cusp.C, H), 0), 'cusp out of gamut');
    });
  }
  await t.test('cusp lightness matches the lightness row', () => {
    const s = gamutSlice(28);
    const row = s.points.find((p) => Math.abs(p.L - s.cusp.L) < 1e-9);
    assert.ok(row && Math.abs(row.C - s.cusp.C) < 1e-9);
  });
});

test('gamutBoundaryC hostile inputs', async (t) => {
  const cases = [
    [NaN, 30], [Infinity, 30], [-Infinity, 30], [-0.4, 30], [2, 30],
    [0.5, NaN], [0.5, Infinity], [0.5, -Infinity], [undefined, 30], ['x', 30],
  ];
  for (const [L, H] of cases) {
    await t.test(`L ${String(L)} H ${String(H)}`, () => {
      const c = gamutBoundaryC(L, H);
      assert.ok(Number.isFinite(c) && c >= 0, `C ${c}`);
    });
  }
  await t.test('hue wraps into range', () => {
    assert.equal(gamutBoundaryC(0.6, -45), gamutBoundaryC(0.6, 315));
    assert.equal(gamutBoundaryC(0.6, 720), gamutBoundaryC(0.6, 0));
    assert.equal(gamutBoundaryC(0.6, 360 + 28), gamutBoundaryC(0.6, 28));
  });
  await t.test('zero iterations still returns a bounded value', () => {
    const c = gamutBoundaryC(0.6, 30, 0);
    assert.ok(Number.isFinite(c) && c >= 0);
  });
});

test('projectToSlice', async (t) => {
  await t.test('in-gamut point stays put', () => {
    const p = projectToSlice(0.6, 0.08, 30);
    assert.equal(p.inGamut, true);
    assert.ok(Math.abs(p.mapped.C - 0.08) < 1e-9);
    assert.match(p.mapped.hex, /^#[0-9a-f]{6}$/);
  });
  await t.test('out-of-gamut target lands on the boundary', () => {
    const p = projectToSlice(0.72, 0.42, 28);
    assert.equal(p.inGamut, false);
    assert.ok(Math.abs(p.mapped.C - gamutBoundaryC(0.72, 28)) < 1e-4);
    assert.match(p.mapped.hex, /^#[0-9a-f]{6}$/);
  });
  await t.test('non-finite inputs resolve to finite output', () => {
    const p = projectToSlice(NaN, Infinity, -Infinity);
    assert.ok(Number.isFinite(p.L) && Number.isFinite(p.C) && Number.isFinite(p.H));
    assert.match(p.mapped.hex, /^#[0-9a-f]{6}$/);
  });
  await t.test('lightness clamps to the slice', () => {
    assert.equal(projectToSlice(2, 0.1, 30).L, 1);
    assert.equal(projectToSlice(-1, 0.1, 30).L, 0);
    assert.equal(projectToSlice(0.5, -0.2, 30).C, 0);
  });
});

// ---------------------------------------------------------------------------

test('Oklab Delta-E properties', async (t) => {
  await t.test('identical colors have zero distance', () => {
    assert.equal(deltaEOKHex('#c8451f', '#c8451f'), 0);
  });
  await t.test('golden pair distance', () => {
    assert.ok(Math.abs(deltaEOKHex('#c8451f', '#e2a926') - 0.2370789597203967) < 1e-12);
    assert.ok(Math.abs(deltaEOKHex('#000000', '#ffffff') - 0.9999999934735468) < 1e-9);
  });
  await t.test('symmetry on natural pairs', () => {
    for (const [a, b] of [['#c8451f', '#e2a926'], ['#28324a', '#efe6d4'], ['#7a8f3f', '#000000']]) {
      assert.equal(deltaEOKHex(a, b), deltaEOKHex(b, a));
    }
  });
  await t.test('symmetry under all CVD simulations', () => {
    for (const v of ['protanopia', 'deuteranopia', 'tritanopia']) {
      const a = simulateCvdHex('#c8451f', v);
      const b = simulateCvdHex('#e2a926', v);
      assert.equal(deltaEOKHex(a, b), deltaEOKHex(b, a));
    }
  });
  await t.test('distance is non-negative and finite', () => {
    for (const h of ['#c8451f', '#e2a926', '#7a8f3f', '#28324a']) {
      const d = deltaEOKHex(h, '#f6f1e7');
      assert.ok(Number.isFinite(d) && d >= 0);
    }
  });
  await t.test('bad hex input gives NaN not a crash', () => {
    assert.ok(Number.isNaN(deltaEOKHex('garbage', '#ffffff')));
    assert.equal(oklabOfHex('#zzz'), null);
    assert.equal(oklabOfHex(42), null);
    assert.ok(Number.isNaN(deltaEOK(null, { L: 0, a: 0, b: 0 })));
  });
  await t.test('protanopia simulation distance golden', () => {
    const a = simulateCvdHex('#c8451f', 'protanopia');
    const b = simulateCvdHex('#e2a926', 'protanopia');
    assert.ok(Math.abs(deltaEOKHex(a, b) - 0.2590821613848619) < 1e-12);
  });
});

// ---------------------------------------------------------------------------

test('pairwiseCellStats', async (t) => {
  const pal = ['#28324a', '#c8451f', '#e2a926', '#7a8f3f', '#efe6d4'];
  await t.test('five swatches give ten unordered pairs', () => {
    const s = pairwiseCellStats(pal);
    assert.equal(s.pairs, 10);
    assert.ok(s.aa <= 10 && s.aaa <= 10 && s.ui <= 10);
    assert.ok(s.aa <= s.ui, 'AA count cannot exceed the UI count');
    assert.ok(s.aaa <= s.aa, 'AAA count cannot exceed the AA count');
    assert.ok(s.minDelta > 0);
    assert.ok(s.tightest && s.tightest.i >= 0 && s.tightest.j > s.tightest.i);
    assert.equal(s.tightest.a, pal[s.tightest.i]);
    assert.equal(s.tightest.b, pal[s.tightest.j]);
  });
  await t.test('tightest distance matches a direct recompute', () => {
    const s = pairwiseCellStats(pal);
    assert.equal(s.tightest.d, deltaEOKHex(s.tightest.a, s.tightest.b));
  });
  await t.test('counts use unrounded thresholds', () => {
    const s = pairwiseCellStats(['#9f6c33', '#ffffff']);
    assert.equal(s.pairs, 1);
    assert.equal(s.aa, 0);
    assert.equal(s.aaa, 0);
    assert.equal(s.ui, 1);
  });
  await t.test('empty and single palettes', () => {
    assert.deepEqual(pairwiseCellStats([]), { pairs: 0, aa: 0, aaa: 0, ui: 0, minDelta: 0, tightest: null });
    assert.equal(pairwiseCellStats(['#000000']).pairs, 0);
    assert.equal(pairwiseCellStats(undefined).pairs, 0);
  });
  await t.test('malformed hexes are skipped without crashing', () => {
    const s = pairwiseCellStats(['#000000', 'junk', '#ffffff', null, 9]);
    assert.equal(s.pairs, 1);
    assert.equal(s.aaa, 1);
  });
});

test('visionPalette', async (t) => {
  const pal = ['#c8451f', '#e2a926'];
  await t.test('none returns a same-content copy', () => {
    const out = visionPalette(pal, 'none');
    assert.deepEqual(out, pal);
    assert.notEqual(out, pal);
  });
  await t.test('cvd visions simulate through the Machado matrices', () => {
    assert.equal(visionPalette(pal, 'protanopia')[0], simulateCvdHex('#c8451f', 'protanopia'));
    assert.equal(visionPalette(pal, 'deuteranopia')[1], simulateCvdHex('#e2a926', 'deuteranopia'));
    assert.equal(visionPalette(pal, 'tritanopia')[0], simulateCvdHex('#c8451f', 'tritanopia'));
  });
});

test('comparator grid', async (t) => {
  const grid = compareHarmonyGrid(BASE);
  await t.test('six harmonies in canonical order', () => {
    assert.deepEqual(grid.map((r) => r.harmony), HARMONY_MODES);
  });
  await t.test('four vision cells per row in order', () => {
    for (const row of grid) {
      assert.deepEqual(row.cells.map((c) => c.vision), LAB_VISIONS);
    }
  });
  for (const row of grid) {
    await t.test(`${row.harmony}: ten pairs per cell, worst is the cvd minimum`, () => {
      for (const cell of row.cells) {
        assert.equal(cell.pairs, 10);
        assert.ok(cell.aa <= 10 && cell.aaa <= cell.aa && cell.ui >= cell.aa);
        assert.ok(Number.isFinite(cell.minDelta) && cell.minDelta >= 0);
        assert.ok(cell.tightest && cell.tightest.i >= 0);
      }
      const cvdMin = Math.min(...row.cells.filter((c) => c.vision !== 'none').map((c) => c.minDelta));
      assert.equal(row.worst.minDelta, cvdMin);
      assert.equal(row.worst.pair.d, cvdMin);
    });
  }
  await t.test('none cells carry the natural palette', () => {
    for (const row of grid) {
      const none = row.cells.find((c) => c.vision === 'none');
      assert.deepEqual(none.palette, row.natural);
      assert.deepEqual(none.palette, generateHarmony(BASE, row.harmony, { count: 5 }).map((s) => s.hex));
    }
  });
  await t.test('tightest pair distances recompute exactly', () => {
    for (const row of grid) {
      for (const cell of row.cells) {
        const t = cell.tightest;
        assert.equal(t.d, deltaEOKHex(cell.palette[t.i], cell.palette[t.j]));
      }
    }
  });
  await t.test('deterministic across calls', () => {
    const again = compareHarmonyGrid(BASE);
    assert.equal(JSON.stringify(again), JSON.stringify(grid));
  });
  await t.test('hostile base still yields a finite grid', () => {
    const g = compareHarmonyGrid({ L: NaN, C: Infinity, H: undefined });
    assert.equal(g.length, 6);
    for (const row of g) {
      for (const cell of row.cells) {
        assert.ok(Number.isFinite(cell.minDelta) && cell.pairs === 10);
      }
    }
  });
});

// ---------------------------------------------------------------------------

test('audited brief digest parity', async (t) => {
  const bundle = auditBundle(AUDIT_KEY);
  await t.test('golden digest for the canonical fixture', () => {
    assert.equal(bundle.digest, '59714d5959023be641aff3f736a707ff9ab6d2c3b9d898868c87d50020d3ae13');
  });
  await t.test('same digest on all three exports', () => {
    assert.ok(bundle.json.includes(`"digest": "${bundle.digest}"`));
    assert.ok(bundle.csv.includes(`# sha256 ${bundle.digest}`));
    assert.ok(bundle.markdown.includes(`sha256 ${bundle.digest}`));
  });
  await t.test('json round-trips into a verifiable payload', () => {
    const parsed = JSON.parse(bundle.json);
    assert.equal(parsed.digest, bundle.digest);
    assert.ok(verifyAudit(parsed));
    assert.equal(parsed.brief, 'paletteforge-gamut-lab-audit');
    assert.equal(parsed.version, 1);
  });
  await t.test('csv carries a provenance block then rows', () => {
    const lines = bundle.csv.split('\n');
    assert.equal(lines[0], '# paletteforge gamut lab audit');
    assert.equal(lines[1], `# sha256 ${bundle.digest}`);
    assert.ok(lines.includes('section,field,value'));
    assert.ok(bundle.csv.includes('comparator,triadic.protanopia.minDeltaE'));
    assert.ok(bundle.csv.includes('cusp,hue,'));
  });
  await t.test('markdown ends in the digest footer', () => {
    const lines = bundle.markdown.trimEnd().split('\n');
    assert.equal(lines[lines.length - 1], `sha256 ${bundle.digest}`);
    assert.ok(bundle.markdown.includes('| harmony | vision |'));
    assert.ok(bundle.markdown.includes('## Tightest CVD-confusable pairs'));
  });
  await t.test('recomputing the digest over the payload matches', () => {
    assert.equal(auditDigestOf(bundle.payload), bundle.digest);
    const clone = { ...bundle.payload };
    delete clone.digest;
    assert.equal(sha256Hex(canonicalJson(clone)), bundle.digest);
  });
});

test('audit bundle caching', async (t) => {
  await t.test('identical key returns the same bundle object', () => {
    const a = auditBundle(AUDIT_KEY);
    const b = auditBundle(AUDIT_KEY);
    assert.equal(a, b);
  });
  await t.test('equivalent key with different order hits the cache', () => {
    const flipped = {
      palette: AUDIT_KEY.palette, base: AUDIT_KEY.base, theme: AUDIT_KEY.theme,
      cvd: AUDIT_KEY.cvd, symmetry: AUDIT_KEY.symmetry, harmony: AUDIT_KEY.harmony,
      mode: AUDIT_KEY.mode, seed: AUDIT_KEY.seed,
    };
    assert.equal(auditBundle(flipped).digest, auditBundle(AUDIT_KEY).digest);
  });
  await t.test('a different state yields a different digest', () => {
    const other = auditBundle({ ...AUDIT_KEY, seed: 'night studio' });
    assert.notEqual(other.digest, auditBundle(AUDIT_KEY).digest);
  });
  await t.test('json bytes are byte-identical across cache hits', () => {
    assert.equal(auditBundle(AUDIT_KEY).json, auditBundle({ ...AUDIT_KEY }).json);
  });
});

test('verifyAudit and tamper detection', async (t) => {
  const bundle = auditBundle(AUDIT_KEY);
  await t.test('fresh payload verifies', () => {
    assert.ok(verifyAudit(bundle.payload));
  });
  await t.test('rejections', () => {
    assert.equal(verifyAudit(null), false);
    assert.equal(verifyAudit(undefined), false);
    assert.equal(verifyAudit('x'), false);
    assert.equal(verifyAudit({}), false);
    assert.equal(verifyAudit({ ...bundle.payload, digest: 'deadbeef' }), false);
  });
  const mutations = [
    (p) => { p.state.seed = 'tampered'; },
    (p) => { p.state.base = '#ffffff'; },
    (p) => { p.cusp.C = 0.001; },
    (p) => { p.comparator[0].cells[0].aa = 0; },
    (p) => { p.palette.push({ hex: '#000000', oklch: 'oklch(0 0 0)' }); },
    (p) => { p.palette[0].hex = '#000000'; },
    (p) => { p.baseOklch.H = 999; },
    (p) => { delete p.comparator; },
  ];
  for (const [i, mutate] of mutations.entries()) {
    await t.test(`mutation ${i} is detected`, () => {
      const copy = JSON.parse(JSON.stringify(bundle.payload));
      mutate(copy);
      assert.equal(verifyAudit(copy), false);
      assert.equal(verifyAudit({ ...copy, digest: bundle.digest }), false);
    });
  }
  await t.test('tamper demo flips one field and fails verify', () => {
    const d = tamperAuditDemo(bundle.payload);
    assert.equal(d.originalVerified, true);
    assert.equal(d.tamperedVerified, false);
    assert.equal(d.tamperDetected, true);
    assert.equal(typeof d.field, 'string');
  });
  await t.test('tamper demo on a bare object stays safe', () => {
    const d = tamperAuditDemo({ version: 1, digest: 'x' });
    assert.equal(d.originalVerified, false);
    assert.equal(d.tamperedVerified, false);
  });
});

// ---------------------------------------------------------------------------

test('csvCell formula and quoting safety', async (t) => {
  const injections = ['=CMD()', '=1+1', '+SUM(A1)', '-2+3', '@x', '\t lead', '  space', '|pipe'];
  for (const s of injections) {
    await t.test(`${JSON.stringify(s)} is prefixed`, () => {
      const out = csvCell(s);
      assert.ok(out.startsWith("'"), out);
      assert.ok(out.includes(s));
    });
  }
  await t.test('a carriage-return lead is prefixed then quoted', () => {
    const out = csvCell('\r lead');
    assert.equal(out, '"\'\r lead"');
  });
  const quoting = [
    ['a,b', '"a,b"'],
    ['a"b', '"a""b"'],
    ['a\nb', '"a\nb"'],
    ['plain', 'plain'],
    ['4.5', '4.5'],
  ];
  for (const [inp, want] of quoting) {
    await t.test(`${JSON.stringify(inp)} -> ${want}`, () => {
      assert.equal(csvCell(inp), want);
    });
  }
  await t.test('null and undefined are empty', () => {
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });
  await t.test('csvTable joins rows with newlines', () => {
    const out = csvTable([[1, 2], ['a', 'b']]);
    assert.equal(out, '1,2\na,b\n');
  });
  await t.test('a hostile seed never starts a csv line as a formula', () => {
    const key = { ...AUDIT_KEY, seed: '=CMD("calc")' };
    const b = auditBundle(key);
    const bad = b.csv.split('\n').filter((l) => /^[=+\-@]/.test(l));
    assert.deepEqual(bad, []);
    assert.ok(b.csv.includes("'=CMD("), 'escaped seed missing');
  });
});

// ---------------------------------------------------------------------------

test('buildAuditPayload hostile inputs', async (t) => {
  await t.test('empty call still verifies', () => {
    const p = buildAuditPayload();
    assert.equal(p.state.base, '#000000');
    assert.equal(p.palette.length, 5);
    assert.equal(p.comparator.length, 6);
    assert.ok(verifyAudit({ ...p, digest: sha256Hex(canonicalJson(p)) }));
  });
  const hostileKeys = [
    { base: 'garbage' },
    { base: NaN },
    { base: '#12345' },
    { base: 'oklch(0.5 0.1 30)' },
    { palette: 'not-an-array' },
    { palette: [] },
    { palette: ['#zzz', 7, null, '__proto__'] },
    { seed: NaN, mode: Infinity, harmony: -Infinity, cvd: 'bogus', theme: 'purple', symmetry: 'p9' },
    { seed: 'x'.repeat(5000) },
    { seed: '=CMD("evil")' },
  ];
  for (const [i, key] of hostileKeys.entries()) {
    await t.test(`hostile key ${i} builds and verifies`, () => {
      const p = buildAuditPayload(key);
      assert.match(p.state.base, /^#[0-9a-f]{6}$/);
      assert.equal(p.comparator.length, 6);
      assert.equal(p.version, 1);
      const digest = sha256Hex(canonicalJson(p));
      assert.match(digest, /^[0-9a-f]{64}$/);
      assert.ok(verifyAudit({ ...p, digest }));
    });
  }
  await t.test('a __proto__ field cannot pollute the payload', () => {
    const key = JSON.parse('{"__proto__":{"polluted":true},"seed":"s","base":"#123456"}');
    const p = buildAuditPayload(key);
    assert.equal({}.polluted, undefined);
    assert.equal(p.state.base, '#123456');
    assert.ok(verifyAudit({ ...p, digest: sha256Hex(canonicalJson(p)) }));
  });
  await t.test('malformed hex entries drop out of the palette', () => {
    const p = buildAuditPayload({ base: '#123456', palette: ['#zzzzzz', '#abcdef'] });
    assert.deepEqual(p.palette.map((x) => x.hex), ['#abcdef']);
  });
  await t.test('payload is fully JSON-serializable without NaN', () => {
    const p = buildAuditPayload(AUDIT_KEY);
    const s = JSON.stringify(p);
    assert.ok(!/NaN|Infinity|undefined/.test(s));
    assert.equal(s.length, JSON.stringify(JSON.parse(s)).length);
  });
});

test('auditBundle hostile keys stay deterministic', async (t) => {
  await t.test('NaN and Infinity fields still produce one digest', () => {
    const key = { seed: 's', base: '#123456', palette: [], cvd: NaN, theme: Infinity };
    const a = auditBundle(key);
    const b = auditBundle({ ...key });
    assert.equal(a.digest, b.digest);
    assert.match(a.digest, /^[0-9a-f]{64}$/);
    assert.ok(a.json.includes(a.digest));
  });
  await t.test('exports remain non-empty under hostile input', () => {
    const b = auditBundle({ base: 'garbage', palette: [null, 'x'], seed: 42 });
    assert.ok(b.json.length > 500 && b.csv.length > 300 && b.markdown.length > 200);
    assert.ok(verifyAudit(b.payload));
  });
});

test('comparator WCAG counts against a known floor', async (t) => {
  await t.test('monochromatic pale palette cannot fake AA passes', () => {
    const row = compareHarmonyGrid(hexToOklch('#efe6d4')).find((r) => r.harmony === 'monochromatic');
    const none = row.cells.find((c) => c.vision === 'none');
    assert.ok(none.aa <= 10);
    const recomputed = pairwiseCellStats(none.palette);
    assert.equal(none.aa, recomputed.aa);
    assert.equal(none.aaa, recomputed.aaa);
    assert.equal(none.ui, recomputed.ui);
    assert.equal(none.minDelta, recomputed.minDelta);
  });
  await t.test('a 4.4998 pair counts as UI not AA inside a cell', () => {
    const stats = pairwiseCellStats(['#9f6c33', '#ffffff', '#000000']);
    const whiteBlack = contrastRatio(hexToRgb('#ffffff'), hexToRgb('#000000'));
    assert.ok(whiteBlack >= 7);
    assert.equal(stats.aa, 2);
    assert.equal(stats.aaa, 1);
    assert.equal(stats.ui, 3);
  });
});
