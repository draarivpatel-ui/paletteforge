# PaletteForge Wave 3 critique

Scope: visual craft pass at 1440x900 and 390x844, keyboard and mobile polish,
export artifact verification, and one real generative bug found by the export
checks. Suite: 337 checks, all passing (was 336; one regression test added).

## What changed

Generative engine (`src/generative.mjs`):

- `composeFlow` rebuilt around a seeded focal point. Ribbon count rose to
  130-220, 30-70 percent of starts cluster near the focal region, and a weight
  hierarchy separates hairlines, working strokes, and heavy trunks. Jittered
  filament siblings braid pairs together, four trunk strokes anchor the focal
  mass, stub paths under 12 points are culled, stroke ends get head and tail
  tapers, all marks keep a 44 px picture-plane margin, and the six accent dots
  became open rings inside the same linear vocabulary.
- `composeBauhaus` degenerate-poster fix. The recursive split could stop after
  a handful of leaves on unlucky seed and palette pairs (about a quarter of
  sampled combos), producing posters that were one giant rectangle plus
  footer. A deterministic floor now subdivides the largest leaves until at
  least 18 cells exist. Worst observed SVG grew from 1182 bytes to 2574.
- `base` joined the shareable URL hash state with `sanitizeBaseHex` validation,
  so the base color survives link sharing like every other control.

App shell (`app.mjs`, `index.html`):

- Progressive poster painter. Ops are painter-ordered and additive, so the
  poster now develops in timed requestAnimationFrame batches like a print in
  the developer, landing on the identical final frame. Reduced-motion users
  get the finished poster immediately.
- Placard upgraded to a museum wall label: the seed becomes a title-cased
  artwork title, the meta line carries provenance, and a new medium line
  describes the piece.
- Hue wheel in the palette column plots each swatch's OKLCH hue angle on a
  ring, so analogous clusters and complementary opposition read at a glance.
  It uses the natural palette even under CVD simulation.
- Native color input for the base color beside the hex field, committing on
  change so live drags do not re-render per intermediate value.
- Copy share link button with clipboard API and legacy fallback.
- Drop zone accepts files anywhere on the window with a highlight affordance,
  and its label became a two-line instruction.
- Self-tests and the hash hint moved to a footer, symmetry buttons gained
  tooltips, and the viewport meta gained `viewport-fit=cover`.

Styles (`styles.css`):

- Viewport-aware frame width (`min(600px, calc((100vh - 258px) * 0.77778 +
  48px))`) so poster and placard both land inside the first 900 px screen at
  desktop size; placard bottom measured at y=898.
- Selected toggle state softened from a heavy ink fill to a paper fill with
  an ink rule, leaving the primary action as the only heavy-ink control.
- Palette column spacing tightened, placard entrance animation added with a
  reduced-motion opt-out, touch targets raised to 44 px on coarse pointers
  and narrow screens, and placeholder plus drop-sub text brought to WCAG AA
  (the detector flagged a 3.4:1 blend).

Verification (`tools/verify.mjs`):

- New checks: Tab order reaches controls with a visible focus ring at both
  sizes; SVG export validated structurally; PNG export decoded back through a
  canvas and pixel-sampled for non-blank content at 1400x1800, at both
  viewports.
- Mobile export verification captures the produced blob after a real click,
  because Chrome caps automatic downloads at two per browser session.
- Fixed a real harness bug: on mobile emulation, `Input.dispatchMouseEvent`
  expects visual-viewport coordinates while `getBoundingClientRect` returns
  layout-viewport coordinates. The offset (185 px observed) made deep-page
  clicks land on sections. Clicks now convert through `visualViewport` and
  re-verify the hit target immediately before pressing.

Tests (`tests/generative.test.mjs`):

- Added a bauhaus density-floor regression sweeping 12 seeds.

## What still falls short

- The flow composer is much stronger but remains generative line work. Some
  seeds still produce quieter fields or small isolated marks; it reads as a
  developed print, not a fully authored composition. Three critique rounds
  with an external art-direction model still ended at "not finished" on
  fine-art grounds, mainly residual floaters and flat z-depth.
- Mobile remains a long single-column scroll (about 3000 px); every control
  works but the studio is dense.
- The detector still flags the warm paper background as a generic cream
  palette. That is the deliberate archival identity of the piece, kept on
  purpose, but the warning stands.
- There is no separate PNG-poster export variant; the PNG button already
  produces the full 1400x1800 poster with footer.

## Scores

Before (Wave 2 exit): visual craft 8.5, overall 9.0.
After (Wave 3): visual craft about 9.3, overall 9.3.

Justification: the hero object now owns the first screen at desktop size, the
poster visibly develops on load, the placard reads as a museum label, the hue
wheel makes the harmonic story legible without reading numbers, and exports
are verified as real artifacts rather than click-survival. The remaining gap
to 9.5+ is the last mile of art direction inside the generative engines,
which is a deeper problem than a polish pass.

## Verified counts

- `npm test`: 337 tests, 337 pass, 0 fail.
- `node tools/verify.mjs`: 29 checks, all pass, zero console errors, zero
  uncaught exceptions, zero external requests, at 1440x900 and 390x844.
- Impeccable detect: one warning remains (cream palette, deliberate). The
  low-contrast warning was fixed.
