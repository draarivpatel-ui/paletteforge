# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/paletteforge/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static PaletteForge browser application, including color and image input parsing, URL hash restoration, generated SVG and canvas output, report and design-token exports, local browser storage and browser rendering.

In scope:

- A cross-site scripting or HTML injection path through color input, image metadata, palette state, share links, poster text or generated output.
- A share-link decoder or serialization flaw that bypasses validation, corrupts another palette, or executes attacker-controlled code.
- An SVG, PNG, CSS, JSON, CSV or Markdown export escaping flaw that makes generated output execute a formula or script when opened.
- A dropped-image processing flaw that reads outside the user-selected file or sends image data off the device.
- A browser-storage or state-restoration flaw that crosses origins or persists attacker-controlled markup.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- The documented numerical limits of color conversion, gamut mapping, color-vision simulation or contrast estimation, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
