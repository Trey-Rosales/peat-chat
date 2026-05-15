# Flowbite Migration — Design

**Date:** 2026-05-15
**Branch:** `flowbite-migration`
**Status:** Design approved, awaiting implementation plan

## Goal

Replace the bespoke DTAK primitive library (`web/src/components/dtak/`) with `flowbite-react` as the foundation for shared UI primitives, while preserving the three-mode theming (dark / light / low-detection) and DTAK's hard rules (no raw hex, defined touch targets, no blue/white in LD). Reorganize the components folder so primitives live in `web/src/components/ui/` and the `/dtak/` subdirectory is removed.

## Non-goals

- Redesigning the app's information architecture or feature UX.
- Changing the token *system* — `tokens.json` + `themes/*.css` stay the source of truth; only the *Tailwind binding* changes shape to fit flowbite-react's theme contract.
- Migrating native Android UI or anything outside the web bundle.
- Removing LD mode or relaxing its rules — rules adapt, they don't disappear.
- Changing `scripts/generate-tokens.py` semantics. A few semantic token aliases are added to align with Flowbite naming, but the generator stays the source of truth.

## Architectural decisions

| Decision | Choice |
|---|---|
| Library flavor | `flowbite-react` (React bindings, theming via `ThemeProvider`) |
| Strategy | Incremental, one primitive per commit; app runnable throughout |
| Folder | `web/src/components/ui/` for primitives; feature components stay at `/components/` root |
| Tests | Drop primitive tests; keep feature-level tests; add one LD-banned-class smoke test |
| Theming model | Hybrid: CSS variables drive colors (existing `data-theme` switching), flowbite-react theme object handles structure (sizing, touch targets, LD structural overrides) |

## Theming architecture

**Layer 1 — CSS variables stay.** `web/src/styles/themes/{dark,light,low-detection}.css` remain the source of truth for *colors* per mode. `<html data-theme="…">` continues to drive the switch via `useTheme()`. No re-renders for theme changes.

**Layer 2 — Tailwind colors stay token-mapped.** `web/tailwind.config.js` keeps the `semanticColors` block that maps `bg-brand`, `text-fg-primary`, `border-border-subtle`, etc. to `oklch(var(--color-…))`. The `legacyPlCompat` shim is deleted at the end of this migration.

**Layer 3 — flowbite-react theme object (new).** A single `web/src/styles/flowbite-theme.ts` exports a `createTheme(...)` object that:

- References Tailwind classes that resolve through CSS variables (e.g., `bg-brand text-fg-on-brand`, never `bg-blue-600`).
- Encodes touch-target sizing (`min-h-touch` = 44px default, `min-h-touch-ld` = 48px) as size variants.
- Provides an `ld` variant per component for any LD-specific structural change beyond color (thicker borders, larger hit area, removed blur/elevation).

**Layer 4 — `useTheme()` selects LD structural variant** when `data-theme="ld"`. Color switching stays pure CSS; only LD structural overrides flow through the theme object.

**LD guarantee.** A Vitest smoke test renders each primitive under `data-theme="ld"` and asserts the rendered tree contains no Tailwind class from a banned list (`bg-blue-*`, `bg-white`, `text-blue-*`, `text-white`) and no `#fff` / `#ffffff` / `rgb(255,255,255)` inline styles.

**Provider.** `<ThemeProvider theme={flowbiteTheme}>` wraps the app at its root in `web/src/main.tsx`.

## Component mapping & folder layout

```
web/src/components/
  ui/
    Button.tsx           wraps flowbite-react Button
    IconButton.tsx       wraps flowbite-react Button size=icon
    Input.tsx            wraps flowbite-react TextInput
    Toggle.tsx           wraps flowbite-react ToggleSwitch
    Surface.tsx          wraps flowbite-react Card (or thin themed div)
    StatusPill.tsx       wraps flowbite-react Badge
    CalloutBar.tsx       wraps flowbite-react Alert
    CotMarker.tsx        bespoke (no Flowbite analog) — moved for consistency
  ChatView.tsx           feature components stay at root
  Sidebar.tsx
  VoiceBar.tsx
  …
docs/ui/                 renamed from docs/dtak/ at end of migration
```

Each DTAK primitive maps to one wrapper file that:

1. Imports the flowbite-react component.
2. Applies theme overrides (sizes, LD variant).
3. Re-exports a typed component with the same prop shape consumers expect.

The 6 consumer files only need to change their import path (`./dtak/Button` → `./ui/Button`), not their JSX.

`CotMarker` has no Flowbite analog; it moves to `/ui/` for consistency but its internals don't change beyond imports.

## Migration order

One commit per step; app runnable after each.

1. Install `flowbite-react` + the Flowbite Tailwind plugin in `tailwind.config.js`.
2. Add `web/src/styles/flowbite-theme.ts` and wrap app in `<ThemeProvider>`.
3. `Button` → `/ui/Button.tsx`, update consumers (JoinRoomModal, MarkerForm).
4. `IconButton` → `/ui/IconButton.tsx`, update consumers (ChatView, VoiceBar).
5. `Input` → `/ui/Input.tsx`, update consumers (Sidebar, JoinRoomModal, MarkerForm).
6. `Toggle` → `/ui/Toggle.tsx`, update consumer (Sidebar).
7. `Surface` → `/ui/Surface.tsx`, update consumer (JoinRoomModal).
8. `StatusPill` → `/ui/StatusPill.tsx`, update consumer (RoomItem).
9. `CalloutBar` → `/ui/CalloutBar.tsx`. Survey found no consumers; before this step, grep harder for usages including dynamic imports. If genuinely unused, delete instead of migrate.
10. `CotMarker` → `/ui/CotMarker.tsx` (bespoke, just move + reimport).
11. Delete `web/src/components/dtak/` entirely.
12. Delete the `legacyPlCompat` shim in `tailwind.config.js`.
13. Rename `docs/dtak/` → `docs/ui/`, update `CLAUDE.md` references.

## Token & rule adjustments

**Token additions** (in `scripts/generate-tokens.py`). Additions and aliases only — no destructive renames. Existing class names keep working.

- `text-default` alias to `fg-primary` so flowbite-react's `color="default"` resolves naturally.
- `surface` DEFAULT alongside `surface-1/2/3` for components that use bare `bg-surface`.
- `border-DEFAULT` alongside `border-default`.

Final alias list is confirmed during step 2 of the implementation plan when the flowbite-react theme object is written.

**Rule updates to `CLAUDE.md` and `docs/ui/`.**

1. Rule 1 (no raw hex) — unchanged.
2. Rule 2 (no `pl-*` classes) — promoted from "compat shim" to "deleted entirely" at step 12.
3. Rule 3 (test all three modes) — unchanged, augmented by the automated LD-banned-class smoke test.
4. Rule 4 (touch targets 44/48) — unchanged, enforced via `min-h-touch` / `min-h-touch-ld` utilities exposed in the theme object.
5. Rule 5 (new primitives go under `/components/dtak/`) — rewritten to `/components/ui/`, "reusable across 3+ features" bar stays.
6. Rule 6 (token edit workflow) — unchanged.
7. Rule 7 (`<html data-theme>` + `useTheme()`) — unchanged.

**New rule added.** "Wrap flowbite-react components in a thin `/ui/` wrapper before using them in features. Never import directly from `flowbite-react` in feature code." This gives one chokepoint for theme overrides and prevents accidental adoption of un-themed Flowbite components.

**Docs.** `docs/dtak/06-migration.md` gets a successor section noting this is the second migration (pl-* → DTAK → Flowbite). `docs/dtak/03-components.md` is rewritten as `docs/ui/03-components.md` referencing flowbite-react component names alongside the wrapper.

## Test strategy & verification

**Drop.** All eight `/dtak/*.test.tsx` files are deleted alongside their source files in the same step that replaces each component. They mostly assert Tailwind class strings — brittle and re-tests what flowbite-react covers upstream.

**Keep.** `web/src/components/VoiceBar.test.tsx` stays. Spot-check after migrating `IconButton` that it still passes.

**Add — LD-banned-class smoke test.** `web/src/test/ld-mode-compliance.test.tsx`:

- Sets `<html data-theme="ld">` in the test harness.
- Renders each `/ui/` primitive in a small fixture (default state + one variant).
- Asserts the rendered DOM contains no element with `bg-blue-*`, `bg-white`, `text-blue-*`, `text-white`, or raw `#fff` / `#ffffff` / `rgb(255,255,255)` inline styles.
- Runs as part of `npm test`. Build fails if Flowbite defaults sneak through.

**Manual verification per migrated component:**

- `npm run dev`, flip Settings → Theme through dark / light / ld.
- Hit the feature that consumes the migrated primitive.
- Eyeball touch target sizes on the mobile viewport (Chrome devtools, 390×844).

**CI / type safety.** `tsc -b && vite build` must pass after each migration commit. `vitest run` must pass. No `// @ts-ignore` introduced to make flowbite-react types fit.

**Definition of done for each component step:**

1. Wrapper exists in `/ui/`, types match old DTAK component's prop surface.
2. All consumers updated.
3. Old `/dtak/<Name>.tsx` and `.test.tsx` deleted.
4. `npm test` green.
5. `npm run build` green.
6. Manual three-mode check completed.

## Risks & rollback

1. **Flowbite styles leak past our theme.** Baseline styles may render before our theme overrides apply, causing a flash of blue on first paint. *Mitigation:* import flowbite-react's CSS *before* `themes/*.css` in `main.tsx`. LD smoke test catches the static case; manual check on cold load covers the flash.
2. **Touch target regression.** flowbite-react defaults to ~40px button heights. *Mitigation:* per-component manual check at 390×844; optional automated `clientHeight >= 44` assertion in fixture.
3. **Bundle size growth.** flowbite-react + `tailwind-merge` adds weight. *Mitigation:* compare `vite build` output before and after; if growth is >50KB gzipped, audit imports.
4. **Token rename breakage.** Typo or collision with a Tailwind built-in renders components colorless. *Mitigation:* run `python3 scripts/generate-tokens.py` and verify before each commit; alias additions stay small and reviewed inline.
5. **DTAK rule drift in docs.** If `docs/dtak/` is renamed without updating `CLAUDE.md`, future AI work reads stale rules. *Mitigation:* `CLAUDE.md` update is its own atomic commit at the end, explicitly called out in the implementation plan.
6. **`CalloutBar` may have zero consumers.** *Mitigation:* before step 9, grep harder including dynamic imports. If genuinely unused, delete instead of migrate.

**Rollback.** Each step is a self-contained commit on the `flowbite-migration` branch.

- Per-component: `git revert <commit>` for that step. Wrapper, consumer changes, and test deletions revert together.
- Whole-migration: abandon the branch. `main` is untouched. Nothing released to mobile/Capacitor yet.

## Out-of-scope follow-ups

- Adopting additional flowbite-react components DTAK doesn't currently expose (Modal, Tabs, Dropdown, Datepicker). Add as wrappers in `/ui/` after this migration lands.
- A Storybook or component gallery for `/ui/`.
- Visual regression testing (e.g., Playwright snapshots) for the three themes.
