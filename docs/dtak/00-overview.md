# DTAK Interface Guide — Overview

The DTAK Interface Guide is Peat-Chat's adaptation of the **Defense Interface Guide (DIG)** — BESPIN/Skylight's design language for mission-focused defense software. DTAK applies DIG principles to the Peat-Chat product specifically.

## The four DIG principles

1. **Minimize exposure time.** Help users find and act on information quickly. The less time the screen is visible, the safer the user.
2. **Prioritize the mission.** Critical information is instantly accessible; everything else takes a back seat.
3. **Design with hardware in mind.** Some device features are allies (OLED black pixels), others are liabilities (IR emissions).
4. **Reduce light emissions.** Control contrast, motion, and how the UI interacts with environmental lighting.

## What DTAK is in this codebase

- **Seven OKLCH color scales** (`gray`, `blue`, `red`, `orange`, `yellow`, `green`, `violet`) — see `01-tokens.md`.
- **32 semantic tokens** that resolve to scales per mode — see `01-tokens.md`.
- **Three theme modes:** Dark (default), Light, Low-Detection — see `02-modes.md`.
- **shadcn/ui primitive layer** at `web/src/components/ui/` (21 primitives) — restyled to consume DTAK semantic tokens via Tailwind 4's `@theme` block. See `03-components.md`.
- **Forms via react-hook-form + zod** — feature-specific schemas live at `web/src/lib/forms/`.
- **Mobile-web parity** via Capacitor (same web bundle ships both) — see `04-mobile-vs-web.md`.

## Where things live

| What | Where |
|---|---|
| Token source of truth | `web/src/styles/tokens.json` (generated) |
| v4 `@theme` block | `web/src/styles/tokens.css` (generated) |
| Token derivation script | `scripts/generate-tokens.py` |
| Theme stylesheets | `web/src/styles/themes/{dark,light,low-detection}.css` (generated) |
| Tailwind config | CSS-first via `@theme` in `tokens.css` (no `tailwind.config.js`) |
| Vite plugin | `@tailwindcss/vite` registered in `web/vite.config.ts` |
| Animations | `tw-animate-css` (imported in `web/src/index.css`) |
| Component primitives | `web/src/components/ui/` (shadcn/ui, 21 components) |
| Form schemas | `web/src/lib/forms/*.ts` (zod) |
| Map markers (special) | `web/src/components/map/CotMarker.tsx` |
| Original DTAK spec | `docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md` |
| shadcn migration | `docs/superpowers/specs/2026-05-15-shadcn-dtak-refactor-design.md` |
| Tailwind 4 upgrade | `docs/superpowers/specs/2026-05-15-tailwind-4-upgrade-design.md` |
| AI entrypoint | `CLAUDE.md` (repo root) |
