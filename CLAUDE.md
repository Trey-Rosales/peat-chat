# Peat-Chat — AI working notes

Welcome. This is a defense-oriented mesh chat + tactical-coordination app. The web bundle ships to mobile via Capacitor.

## DTAK Interface Guide (visual / token system)

Peat-Chat's design system is **DTAK** — the Defense Interface Guide adapted for this product. Component primitives now live in `web/src/components/ui/` and are backed by `flowbite-react` where applicable (Button, Toggle). Read **`docs/ui/00-overview.md`** first if you'll be touching UI.

### Key files

| What | Where |
|---|---|
| Token source of truth | `web/src/styles/tokens.json` (generated) |
| Token derivation script | `scripts/generate-tokens.py` |
| Theme stylesheets | `web/src/styles/themes/{dark,light,low-detection}.css` |
| Tailwind config | `web/tailwind.config.js` |
| Component primitives | `web/src/components/ui/` |
| Flowbite theme overrides | `web/src/styles/flowbite-theme.ts` |
| LD-mode compliance test | `web/src/test/ld-mode-compliance.test.tsx` |
| Spec | `docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-05-01-dtak-interface-guide.md` |

### Hard rules for AI work in this repo

1. **Never write raw color hexes in JSX.** Use semantic tokens (`bg-brand`, `text-fg-primary`, `border-border-subtle`).
2. **Never use the deprecated DTAK `pl-*` semantic classes** (`pl-bg`, `pl-sidebar`, `pl-input`, etc. — note: standard Tailwind padding utilities like `pl-2` are fine). The compatibility shim was removed in the Flowbite migration. Any usage now is a build break.
3. **Test UI changes in all three modes** (dark/light/ld) before declaring done. Open the app, flip the theme toggle in Settings → Theme, look for blue/white in LD specifically (banned per DIG).
4. **Touch targets:** 44px mobile, 48px in LD.
5. **New primitive?** Place under `web/src/components/ui/` only if reusable across 3+ features. Otherwise feature-local with DTAK tokens. When adopting a new `flowbite-react` component, wrap it in `/ui/` first — never import `flowbite-react` directly from feature code.
6. **Changing tokens?** Edit `scripts/generate-tokens.py` (anchors or `SEMANTIC_MAPS`), run `python3 scripts/generate-tokens.py`, commit the regenerated `tokens.json` + theme CSS files.
7. **Mode switching is via `<html data-theme="dark|light|ld">`.** The `useTheme()` hook (`web/src/hooks/useTheme.ts`) handles user-driven toggling and persistence.
8. **Wrap flowbite-react before use.** New flowbite-react components get a thin `/ui/` wrapper that scopes theme overrides via `web/src/styles/flowbite-theme.ts`. Feature code never imports from `flowbite-react` directly.

## Stack

- Web: React 18 + TypeScript + Vite + Tailwind 3.4 + Zustand + MapLibre GL
- Mobile: Capacitor wraps the web bundle (iOS WKWebView, Android System WebView)
- Native Android: Kotlin BLE service, embedded Rust server
- Server: Go + Rust crates
- Tests: Vitest + @testing-library/react (test setup at `web/src/test/setup.ts`)

## Where to look

- `docs/ROADMAP.md` — product roadmap
- `docs/one-pager.md` — product overview
- `docs/ui/` — interface guide (start at `00-overview.md`)
- `docs/superpowers/specs/` — design specs
- `docs/superpowers/plans/` — implementation plans
