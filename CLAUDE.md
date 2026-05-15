# Peat-Chat — AI working notes

Welcome. This is a defense-oriented mesh chat + tactical-coordination app. The web bundle ships to mobile via Capacitor.

## DTAK Interface Guide (visual / token system)

Peat-Chat's design system is **DTAK** — the Defense Interface Guide adapted for this product. Read **`docs/dtak/00-overview.md`** first if you'll be touching UI.

### Key files

| What | Where |
|---|---|
| Token source of truth | `web/src/styles/tokens.json` (generated) |
| v4 `@theme` block | `web/src/styles/tokens.css` (generated) |
| Token derivation script | `scripts/generate-tokens.py` |
| Theme stylesheets | `web/src/styles/themes/{dark,light,low-detection}.css` |
| Tailwind config | CSS-first via `@theme` in `web/src/styles/tokens.css` (generated) |
| Component primitives | `web/src/components/ui/` (shadcn-based) |
| Spec | `docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-05-01-dtak-interface-guide.md` |

### Hard rules for AI work in this repo

1. **Never write raw color hexes in JSX.** Use semantic tokens (`bg-brand`, `text-fg-primary`, `border-border-subtle`).
2. **`pl-*` migration complete.** The legacy DTAK `pl-*` shim classes (pl-bg, pl-sidebar, etc.) were removed during the shadcn migration. `pl-2`, `pl-4`, etc. are now normal Tailwind padding utilities and are fine.
3. **Test UI changes in all three modes** (dark/light/ld) before declaring done. Open the app, flip the theme toggle in Settings → Theme, look for blue/white in LD specifically (banned per DIG).
4. **Touch targets:** 44px mobile, 48px in LD.
5. **New primitive?** Place under `web/src/components/dtak/` only if reusable across 3+ features. Otherwise feature-local with DTAK tokens.
6. **Changing tokens?** Edit `scripts/generate-tokens.py` (anchors, `SEMANTIC_MAPS`, or the `@theme` block in `write_tokens_css`), run `python3 scripts/generate-tokens.py`, commit the regenerated `tokens.json`, theme CSS files, and `tokens.css`.
7. **Mode switching is via `<html data-theme="dark|light|ld">`.** The `useTheme()` hook (`web/src/hooks/useTheme.ts`) handles user-driven toggling and persistence.

## Stack

- Web: React 18 + TypeScript + Vite + Tailwind 4 + shadcn/ui + Zustand + MapLibre GL
- Mobile: Capacitor wraps the web bundle (iOS WKWebView, Android System WebView)
- Native Android: Kotlin BLE service, embedded Rust server
- Server: Go + Rust crates
- Tests: Vitest + @testing-library/react (test setup at `web/src/test/setup.ts`)

## Where to look

- `docs/ROADMAP.md` — product roadmap
- `docs/one-pager.md` — product overview
- `docs/dtak/` — interface guide (start at `00-overview.md`)
- `docs/superpowers/specs/` — design specs
- `docs/superpowers/plans/` — implementation plans
