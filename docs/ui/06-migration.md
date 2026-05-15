# Migration Playbook — `pl-*` → DTAK

The legacy `pl-*` tokens (WhatsApp-derived) are deprecated. They are currently aliased via a compatibility shim in `web/tailwind.config.js` so existing UI keeps working *and* is theme-reactive automatically. Replace them with proper DTAK semantic tokens using this playbook.

## Mapping table

| Legacy | DTAK |
|---|---|
| `bg-pl-bg` | `bg-surface-canvas` |
| `bg-pl-sidebar` | `bg-surface-1` |
| `bg-pl-header` | `bg-surface-2` |
| `bg-pl-input` | `bg-surface-2` (or use within `<Input>`) |
| `bg-pl-hover` | `hover:bg-surface-2` |
| `bg-pl-active` | `bg-surface-3` or `data-active:bg-surface-3` |
| `bg-pl-sent` | `bg-brand` |
| `bg-pl-received` | `bg-surface-2` |
| `border-pl-border` | `border-border-subtle` |
| `text-pl-text` | `text-fg-primary` |
| `text-pl-text-sec` | `text-fg-secondary` (use `fg-tertiary` for very faint text) |
| `text-pl-accent` / `bg-pl-accent` | `text-brand` / `bg-brand` |
| `text-pl-danger` / `bg-pl-danger` | `text-status-critical` / `bg-status-critical` |

## Rollout order (recommended)

1. **Settings** — small surface, easy first migration.
2. **Sidebar / room list** — high-traffic; gives the most visible dark→DTAK delta.
3. **Chat view** — heaviest, save for after the pattern is solid.
4. **Voice bar / call UI** — small surface but high-stakes (active-call states).
5. **Mesh viewer** — uses transport tokens that are new; verify visually.
6. **Map / markers** — uses CoT tokens; verify in all three modes.

## Per-feature workflow

1. Read every line of `web/src/components/<Feature>.tsx` and apply the mapping table.
2. If the component uses inline hex values, replace them with the appropriate token.
3. If a primitive (Button, Input, etc.) fits a use case, swap to the DTAK primitive from `web/src/components/ui/`.
4. Run the existing tests for that feature.
5. Open the app in dev. Test the feature in **all three modes**. Note any visual issues.
6. Commit with a message like: `refactor(dtak): migrate <Feature> off pl-* tokens`.

## What to do if a token doesn't map cleanly

- If you find a use case the mapping table doesn't cover, ping the design lead.
- Adding a new semantic token is OK if the use case is real and reusable. Add it to `SEMANTIC_MAPS` in `generate-tokens.py`, regenerate, then use.
- Do NOT add a one-off custom hex. If it's truly one-off, use a raw scale stop (`bg-blue-500/20`) and document why.

## Final cleanup

When all features are migrated:

1. Remove the entire `legacyPlCompat` block from `web/tailwind.config.js`.
2. Run `git grep "pl-"` and confirm no matches in `web/src/`.
3. Add a CI check (if not already present) that fails on `pl-*` reintroduction.
4. Commit the cleanup as `chore(dtak): remove legacy pl-* tokens and shim`.

## Flowbite migration (2026-05-15)

Second migration since DTAK was established. The bespoke DTAK primitive library moved from `web/src/components/dtak/` to `web/src/components/ui/`. Button and Toggle now wrap `flowbite-react` components via a custom theme object at `web/src/styles/flowbite-theme.ts` that maps Flowbite's slot system to DTAK semantic tokens. The rest of the primitives (`IconButton`, `Input`, `Surface`, `StatusPill`, `CotMarker`) stayed bespoke.

Removed:

- `web/src/components/dtak/` directory.
- The `legacyPlCompat` Tailwind shim from `web/tailwind.config.js`. The deprecated DTAK `pl-*` classes (`pl-bg`, `pl-sidebar`, etc.) had zero remaining usages; only standard Tailwind padding utilities (`pl-2`, `pl-4`) remain.
- `CalloutBar` primitive (no consumers in the codebase).

Added:

- `<ThemeProvider>` at the React app root (`web/src/main.tsx`).
- `web/src/styles/flowbite-theme.ts` with overrides for `button`, `textInput`, `toggleSwitch`, `badge`, `alert` slots.
- `web/src/test/ld-mode-compliance.test.tsx` — automated regression guard that renders every `/ui/` primitive under `<html data-theme="ld">` and asserts no banned color classes (any of `bg/text/border/ring/divide/fill/stroke/placeholder/from/to/via`-`blue|white`) or inline white styles (`#fff`, `rgb/rgba/hsl(0,0%,100%)`) appear in the DOM.

Migration plan: `docs/superpowers/plans/2026-05-15-flowbite-migration.md`.  
Migration spec: `docs/superpowers/specs/2026-05-15-flowbite-migration-design.md`.
