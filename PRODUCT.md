# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: static HTML/CSS/ES modules, zero dependencies, zero external network calls (pinned by the build brief).

## Users

Hackathon judges at InnovArt 2027 (Art and Technology Hack Day) evaluating a solo engineering entry, and designers or developers who want a verifiable color-science workbench. Facts inferred from the build brief: the judging session is short, so the product must demonstrate rigor within about 30 seconds without a file upload or a network connection.

## Product Purpose

PaletteForge is an offline color-science and generative poster studio. It performs exact sRGB to OKLCH conversion with constant hue and lightness gamut mapping, computes WCAG 2.1 contrast across a palette, simulates three color vision deficiencies, extracts palettes from images with a deterministic median cut, and renders seeded generative posters to SVG and PNG. Success means a judge can press one button and see verified mathematics: reproducible artwork, golden-value self-tests, and accessible contrast data.

## Positioning

Every number on screen is reproducible from a seed string and checkable in the page itself. Neighboring palette tools pick colors; this one proves them.

## Capabilities and Constraints

- Exact OKLCH round-trip conversion, chroma-bisection gamut mapping, six harmony generators, WCAG 2.1 contrast matrix, three CVD simulations, deterministic median-cut extraction (all pinned by the brief).
- Four seeded composition modes exported to deterministic SVG and 1400x1800 PNG with a specimen footer (pinned).
- URL hash state sharing with strict validation (pinned).
- Zero dependencies, zero external requests, fully static files (pinned).
- No accounts, no storage, no uploads; dropped images never leave the page.

## Brand Commitments

Museum-gallery editorial aesthetic pinned by the brief: warm archival paper ground, crisp dark ink, optional dark-room gallery toggle, high contrast, no clutter. Title stands alone: no eyebrows, no taglines. No em dashes or en dashes anywhere.

## Product Principles

- Prove, do not claim: every claim ships with an in-page verification.
- Determinism is the product: same seed, same artwork, byte-identical SVG.
- The math stays honest even when it clips: gamut mapping preserves hue and lightness.
- Offline first: nothing on the page requires a network.
