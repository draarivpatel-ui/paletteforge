# PaletteForge

A zero-dependency OKLCH color-science and seeded generative poster studio, built as a single static
site. Open `index.html` over any static file server and everything runs locally in the page: no
build step, no packages, no external network requests of any kind.

## What it does

- Converts colors exactly between sRGB, linear sRGB, Oklab, and OKLCH (Bjorn Ottosson's matrices).
- Clips out-of-gamut OKLCH colors by binary-searching chroma at constant hue and lightness, so
  clipped colors stay the same hue instead of muddying.
- Generates six geometric harmonies (complementary, split complementary, triadic, analogous,
  tetradic, monochromatic tonal) with adjustable lightness curve and chroma envelope.
- Computes WCAG 2.1 relative luminance and contrast ratios across the whole palette as an N x N
  matrix, with AA, AAA, and large-text badges.
- Exports a WCAG proof report that recomputes every pairwise AA, AAA, large-text, and non-text
  ratio under full vision and under all three color-vision simulations, and ships the same
  palette as CSS custom properties, a Tailwind color config, and Figma-ready design tokens in
  the W3C DTCG color-object format (sRGB color space plus normalized channel components).
- Simulates protanopia, deuteranopia, and tritanopia with the Machado, Oliveira and Fernandes
  (2009) matrices at severity 1.0, applied to the swatches, the matrix, and the poster itself.
- Takes the base color as hex or as a typed OKLCH triple (gamut-mapped at constant hue and
  lightness), flags malformed input inline, and announces every recovery politely.
- Navigates entirely by keyboard: single-select groups work as radio groups with a roving Tab
  stop and arrow, Home, and End keys, and every state change is announced in a live region.
- Extracts dominant colors from any dropped image, or from three built-in sample artworks, with a
  deterministic weighted median cut.
- Renders four seeded composition modes (flow ribbons, wallpaper symmetry, bauhaus grid, moire
  superformula) to canvas, deterministic SVG, and a 1400 x 1800 PNG with a specimen footer.
- Stores the whole state in the URL hash so any poster can be shared or restored exactly.
- Verifies itself: an in-page button runs deterministic golden-value checks in the browser.

## The math

sRGB to OKLCH follows Ottosson: linearize each channel (IEC 61966-2-1), map to LMS cone response,
take cube roots, and combine into lightness L and opponents a and b. Chroma C is `sqrt(a^2 + b^2)`
and hue H is `atan2(b, a)`. Gamut mapping holds L and H fixed and bisects C until every sRGB channel
lands inside `[0, 1]`, which takes at most 32 iterations and preserves the perceived hue exactly.

WCAG contrast is `(L1 + 0.05) / (L2 + 0.05)` over relative luminance
`Y = 0.2126 R + 0.7152 G + 0.0722 B` computed on linearized channels. Black on white is exactly
21:1; identical colors are 1:1. Every pass or fail flag and badge in the proof report compares
the unrounded ratio against its threshold, because WCAG forbids rounding up to reach it: a pair
at 4.499888 fails AA even though it displays as 4.5.

Posters are deterministic: the seed string is hashed with FNV-1a and expanded by a mulberry32
PRNG, so the same seed always produces byte-identical SVG. The hash `seed`, `mode`, `harmony`,
`symmetry`, `cvd`, `theme`, and `base` parameters are validated on load and anything malformed
falls back to safe defaults.

## Layout

```
index.html          the page
styles.css          museum-gallery theme (light paper and dark room)
app.mjs             state, rendering, extraction, export wiring
src/color-science.mjs   OKLCH, gamut map, harmonies, WCAG, CVD, median cut, OKLCH parser
src/generative.mjs      PRNG, noise, four composers, SVG export, hash codec
src/report.mjs          contrast proof report and token exporters (css, tailwind, figma)
src/self-tests.mjs      in-page verification checks
tests/                  node --test suite
tools/verify.mjs        headless browser verification script
```

## Tests

The suite currently reports 516 passing checks with zero failures:

```
npm test
```

which is `node --test tests/`. The suite covers round-trip accuracy, gamut-bisection invariants,
WCAG golden values, CVD matrix algebra and monotonicity, median-cut edges, NaN hardening, PRNG
goldens, byte-identical SVG output, SVG validity and escaping, URL hash tampering, OKLCH input
parsing, proof-report structure, token-export determinism, and static hygiene on the shipped
files.

## Run

Any static server works; from this directory:

```
python3 -m http.server 8000
```

then open `http://localhost:8000/`. Everything is offline: it also works with the network cable
unplugged, which is the point.
