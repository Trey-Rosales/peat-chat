# Tailwind 4 Upgrade — Design

**Date:** 2026-05-15
**Branch (target):** `zgehin/tailwind-4-upgrade` (new, off `zgehin/design-system-shadcn`)
**Status:** Approved, ready for implementation planning

## Goal

Upgrade Peat-Chat from Tailwind 3.4.4 to Tailwind 4.x. Use v4's CSS-first config, native Vite plugin, and the `tw-animate-css` replacement for `tailwindcss-animate`. Preserve the DTAK design token system, the three-theme story, and all 21 shadcn primitives + 16 feature components.

## Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| Migration approach | **Codemod first, hand-fix the rest** — `npx @tailwindcss/upgrade@latest` handles utility renames; we hand-fix DTAK config nuances |
| Config style | **Full CSS-first** — extend `scripts/generate-tokens.py` to emit a generated `tokens.css` containing the `@theme` block; delete `tailwind.config.js` |
| Animate plugin | **Switch to `tw-animate-css`** — drop-in replacement, no class name changes |
| Build pipeline | **`@tailwindcss/vite`** — drop `autoprefixer` and `postcss.config.js` (Lightning CSS handles prefixing) |
| Browser baseline | **Accept v4's baseline** (Safari 16.4+, Chrome 111+) — Capacitor on iOS 16+ ships modern WKWebView; Android System WebView auto-updates |

## Architecture

### CSS-first config (`@theme` block)

The load-bearing change. `tailwind.config.js`'s `theme.extend.colors` map (the shadcn alias layer + DTAK semantic tokens) becomes a `@theme` block in CSS. Tokens are split across two files:

- `web/src/styles/themes/{dark,light,low-detection}.css` (generated, per-theme): each contains `[data-theme="X"] { --color-Y: oklch(...) }` blocks. v4 form uses full `oklch()` function values (not raw L/C/H triplets) so v4's opacity syntax (`bg-primary/50`) works directly.
- `web/src/styles/tokens.css` (generated, theme-agnostic): contains the `@theme` block declaring shadcn aliases as references to DTAK var names, plus radius and the `min-h-touch` `@utility`.

**Generated `tokens.css` structure:**
```css
@theme {
  /* DTAK semantic tokens are declared per-theme in themes/*.css.
     v4 looks up var() refs at render time, so the aliases below resolve
     to the active theme's value automatically. */
  --color-background:           var(--color-surface-canvas);
  --color-foreground:           var(--color-fg-primary);
  --color-card:                 var(--color-surface-1);
  --color-card-foreground:      var(--color-fg-primary);
  --color-popover:              var(--color-surface-2);
  --color-popover-foreground:   var(--color-fg-primary);
  --color-primary:              var(--color-brand);
  --color-primary-foreground:   var(--color-fg-on-brand);
  --color-secondary:            var(--color-surface-2);
  --color-secondary-foreground: var(--color-fg-primary);
  --color-muted:                var(--color-surface-2);
  --color-muted-foreground:     var(--color-fg-tertiary);
  --color-accent:               var(--color-surface-3);
  --color-accent-foreground:    var(--color-fg-primary);
  --color-destructive:          var(--color-status-critical);
  --color-destructive-foreground: var(--color-fg-on-brand);
  --color-border:               var(--color-border-default);
  --color-input:                var(--color-border-default);
  --color-ring:                 var(--color-border-focus);

  --radius:    0.375rem;
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}

@utility min-h-touch {
  min-height: 44px;
}
[data-theme="ld"] .min-h-touch {
  min-height: 48px;
}
```

The `legacyPlCompat` block from `tailwind.config.js` is dropped (Pass 1-4 finished migrating off `pl-*`).

### Build pipeline

`web/postcss.config.js` is **deleted**. `web/vite.config.ts` adds the v4 Vite plugin:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// ...

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ... rest unchanged
})
```

`autoprefixer` is removed from `package.json`. `postcss` may stay if other tooling uses it; otherwise removed.

### `web/src/index.css` restructure

Replaces three `@tailwind` directives with one `@import "tailwindcss"`:

```css
@import "tailwindcss";
@import "tw-animate-css";

@import './styles/themes/dark.css';
@import './styles/themes/light.css';
@import './styles/themes/low-detection.css';
@import './styles/tokens.css';

:root { color-scheme: dark; }

body {
  @apply bg-surface-canvas text-fg-primary;
  /* ... */
}

/* ::-webkit-scrollbar styles unchanged */
```

`@apply` still works in v4. Existing `@apply` in `body` is preserved.

## Foundation (Wave 0)

**Dependencies removed from `web/package.json`:**
- `tailwindcss@^3.4.4`
- `tailwindcss-animate@^1.0.7`
- `autoprefixer@^10.4.19`
- `postcss@^8.4.38` (only if no other tool needs it — verify)

**Dependencies added:**
- `tailwindcss@^4.0.0` (latest 4.x)
- `@tailwindcss/vite@^4.0.0`
- `tw-animate-css` (latest)

**Files deleted:**
- `web/postcss.config.js`
- `web/tailwind.config.js`

**Files added:**
- `web/src/styles/tokens.css` (generated)

**Files modified:**
- `web/vite.config.ts` (add Vite plugin)
- `web/src/index.css` (new imports, structure)
- `web/src/styles/themes/{dark,light,low-detection}.css` (regenerated with full `oklch()` values)
- `scripts/generate-tokens.py` (extended to emit tokens.css + new theme CSS form)

## Migration steps (high-level — full breakdown in writing-plans)

1. **Branch** — fresh worktree off `zgehin/design-system-shadcn`: `zgehin/tailwind-4-upgrade`.
2. **Foundation swap** — package.json deps, delete postcss.config.js + tailwind.config.js, modify vite.config.ts.
3. **Token regen** — extend `scripts/generate-tokens.py` to emit:
   - Per-theme CSS files with `oklch()` function form (not raw triplets).
   - New `tokens.css` with `@theme` block + `@utility min-h-touch` + LD override rule.
   - Run script, commit regenerated files.
4. **index.css rewrite** — new imports (`tailwindcss`, `tw-animate-css`, themes, tokens). Remove old `@tailwind` directives.
5. **Codemod** — `npx @tailwindcss/upgrade@latest` from `web/` directory. Codemod runs across all `web/src/**/*.{tsx,ts}`. Because `tailwind.config.js` was deleted in step 2 and `index.css` was rewritten in step 4, the codemod's job reduces to safe utility-class renames inside React/TS files. Review diff carefully; revert any false-positive renames of DTAK tokens (`bg-surface-canvas` should NOT become anything else).
6. **Hand-fix utility renames** the codemod missed (rare).
7. **Verify** build + tests. Visual sweep across the live app (Sidebar, Settings, all three themes, dialogs animate, popovers slide).
8. **CLAUDE.md update** — hard rule #6 references the new tokens.css emission; hard rule #2 (no `pl-*`) can be relaxed/removed.
9. **Capacitor verification** — `cap sync ios && cap sync android`, smoke-test simulators.

## Codemod expected changes

The codemod handles ~15-20 utility renames automatically across the codebase. Common ones:

| v3 | v4 |
|---|---|
| `shadow-sm` | `shadow-xs` |
| `shadow` | `shadow-sm` |
| `shadow-md` | `shadow` |
| `outline-none` | `outline-hidden` |
| `ring` (no value) | `ring-3` |
| `ring-offset-X` | (removed; v4 ring model differs) |
| `bg-opacity-50` | `bg-X/50` |
| `flex-shrink-X` | `shrink-X` |
| `flex-grow-X` | `grow-X` |

Codemod also attempts:
- Convert `tailwind.config.js` to `@theme` block in a CSS file. **Mitigation:** delete `tailwind.config.js` BEFORE running the codemod (Foundation step 2 already deletes it; codemod runs after, so it sees no config to port). Our `@theme` block comes from the script-emitted `tokens.css` instead.
- Rewrite `@tailwind base/components/utilities` → `@import "tailwindcss"`. **Mitigation:** rewrite `index.css` BEFORE running the codemod (Foundation step 4 handles this). Codemod sees the new form already and skips.

The codemod's main remaining job is then just utility-class renames inside `web/src/**/*.{tsx,ts}` files. That's the safe, mechanical work it's best at.

**Files codemod should NOT touch:**
- `web/src/styles/themes/{dark,light,low-detection}.css` (generated; manual oklch form change handled by script extension)
- `web/src/styles/tokens.json` (data file)
- DTAK custom token names anywhere (`bg-surface-canvas`, `text-fg-primary`, `border-border-subtle`, etc.)

After the codemod runs, a careful `git diff` review catches any false positives.

## Verification

**Per-section:**
- After foundation swap: `cd web && npm run build` clean (initially expected to fail — token wiring incomplete; this is intentional, the next step fixes it).
- After token regen + index.css: `npm run build` clean. App renders with DTAK colors in dev (`npm run dev`).
- After codemod: `npm run build && npm run test` clean. Visual sweep — Settings page, all three themes, primitives.
- After CLAUDE.md update: doc accuracy check.

**End-to-end:**
- `npm run test` — all 88 tests pass (the LD regression test in `__tests__/ld-mode.test.tsx` should still tripwire correctly under v4).
- `npm run build` — clean, no new warnings.
- Manual app sweep: open Settings, scroll through every section, verify Theme toggle works (dark/light/ld), open Dialog (animates), open Popover (animates), open ContextMenu in MessageBubble (animates).
- Capacitor verify on iOS sim + Android emulator.

## Rollback

Work on `zgehin/tailwind-4-upgrade` branch. If migration breaks something we can't fix:
- `git checkout zgehin/design-system-shadcn` returns to pre-v4 state.
- Pass 1-4 work must be committed on `zgehin/design-system-shadcn` BEFORE branching for v4 (otherwise we lose it on rollback).

## Out of scope

- shadcn CLI v4 reinit — `components.json` schema differs slightly in v4. Existing `components.json` keeps working; new components added via shadcn CLI may need light adjustment but no existing primitive needs touching.
- Browserslist config — Vite uses sensible defaults; no custom config needed.
- LD-mode marker color audit — `MARKER_COLORS.blue` violates LD rules but is a separate tactical-color refactor.
- T46 final verification of v3 work — the v3 branch is committed before this work begins; v3-side T46 is moot once v4 is merged.

## References

- Tailwind 4 official upgrade guide: https://tailwindcss.com/docs/upgrade-guide
- shadcn/ui v4 docs: https://ui.shadcn.com/docs/tailwind-v4
- `tw-animate-css`: https://github.com/Wombosvideo/tw-animate-css
- `scripts/generate-tokens.py` — token derivation script (gets extended)
- `web/src/styles/tokens.json` — token data source (unchanged)
- `web/src/styles/themes/{dark,light,low-detection}.css` — regenerated with new oklch form
- CLAUDE.md hard rules #2 and #6 — both updated post-migration
