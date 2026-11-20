# Design

Direction pinned by the build brief: museum gallery editorial. An archival print room, not a
dashboard. The poster hangs in a matted frame on warm paper; the measurements sit beside it like a
conservator's notes.

## World

Archival paper ground (`#f2ecdd`), mat board (`#faf6ea`), ink (`#1d1912`), hairline rules, one
oxide accent (`#8f3a1d`). A dark-room variant inverts to near-black paper with warm bone ink. The
system serif stack (Iowan Old Style, Palatino, Georgia) is the display voice; the system mono stack
carries every measurement (hex, OKLCH coordinates, ratios) because numbers are data here.

## Rules

- The title stands alone. No eyebrows, no taglines, no small caps labels above headings.
- No em dashes or en dashes anywhere, including code comments and poster text.
- The contrast matrix demonstrates rather than decorates: each cell renders ink-on-ground in the
  actual pair it measures; the diagonal carries a neutral chip since 1:1 text is invisible.
- Depth is one offset mat shadow on the frame. No glass, no gradients, no icon costumes; controls
  are labeled text buttons.
- Zero external requests: no webfonts, no CDNs, no images. Everything draws itself.

## Signatures

- The framed poster with a museum object placard under it (seed, mode, harmony metadata).
- The specimen footer printed inside the artwork itself, like a numbered print edition.
- Verified-math posture: self-tests, goldens, and the matrix shown on the surface, not in docs.

## Modes

Operate (a workbench). Ambition shows as precision: exact conversions, deterministic output,
verified accessibility, and restraint in chrome.
