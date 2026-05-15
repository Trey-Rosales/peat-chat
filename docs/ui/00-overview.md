# DTAK Interface Guide — Overview

The DTAK Interface Guide is Peat-Chat's adaptation of the **Defense Interface Guide (DIG)** — BESPIN/Skylight's design language for mission-focused defense software. DTAK applies DIG principles to the Peat-Chat product specifically.

**Implementation backing.** As of the Flowbite migration (2026-05-15), reusable primitives live in `web/src/components/ui/`. `Button` and `Toggle` wrap `flowbite-react` components via `web/src/styles/flowbite-theme.ts`; the rest (`IconButton`, `Input`, `Surface`, `StatusPill`, `CotMarker`) stay bespoke because their prop shapes or visual requirements don't map cleanly onto flowbite-react. The three theming modes (dark / light / ld) continue to switch via `<html data-theme>` and CSS variables in `web/src/styles/themes/`.

## The four DIG principles

1. **Minimize exposure time.** Help users find and act on information quickly. The less time the screen is visible, the safer the user.
2. **Prioritize the mission.** Critical information is instantly accessible; everything else takes a back seat.
3. **Design with hardware in mind.** Some device features are allies (OLED black pixels), others are liabilities (IR emissions).
4. **Reduce light emissions.** Control contrast, motion, and how the UI interacts with environmental lighting.

## What DTAK is in this codebase

- **Seven OKLCH color scales** (`gray`, `blue`, `red`, `orange`, `yellow`, `green`, `violet`) — see `01-tokens.md`.
- **32 semantic tokens** that resolve to scales per mode — see `01-tokens.md`.
- **Three theme modes:** Dark (default), Light, Low-Detection — see `02-modes.md`.
- **Eight component primitives** that consume semantic tokens — see `03-components.md`.
- **Mobile-web parity** via Capacitor (same web bundle ships both) — see `04-mobile-vs-web.md`.

## Where things live

| What | Where |
|---|---|
| Token source of truth | `web/src/styles/tokens.json` (generated) |
| Token derivation script | `scripts/generate-tokens.py` |
| Theme stylesheets | `web/src/styles/themes/{dark,light,low-detection}.css` |
| Tailwind config | `web/tailwind.config.js` |
| Component primitives | `web/src/components/ui/` |
| Spec | `docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md` |
| AI entrypoint | `CLAUDE.md` (repo root) |
