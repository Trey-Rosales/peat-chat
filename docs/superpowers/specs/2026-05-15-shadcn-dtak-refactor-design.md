# shadcn + DTAK Refactor — Design

**Date:** 2026-05-15
**Branch:** `zgehin/design-system-shadcn`
**Status:** Approved, ready for implementation planning

## Goal

Replace the current DTAK primitive layer with shadcn-based components, restyled to consume the existing DTAK design tokens, and sweep every feature component to use the new primitives. End state: every UI surface in the app is built from `web/src/components/ui/` (shadcn) consuming DTAK semantic tokens — no hardcoded colors, no `pl-*` legacy classes, no bespoke primitives outside `ui/`.

## Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| DTAK primitives vs shadcn | **Replace** — delete current DTAK Button/Input/Toggle/Surface/StatusPill/CalloutBar/IconButton, copy in shadcn versions, restyle with DTAK tokens |
| Migration scope | **Full sweep** — every feature file in `web/src/components/` is migrated |
| shadcn surface | **What's needed + obvious gaps** — audit feature files, install per-component; skip Form/Calendar/Carousel/Command/Chart unless required |
| Directory layout | **`web/src/components/ui/`** (shadcn standard); old `web/src/components/dtak/` deleted |
| Primitive tests | **Drop** — rely on Radix upstream + visual verification + LD regression test only |
| Form library | **react-hook-form + zod** — adopt shadcn `<Form>` pattern across all forms |
| Sequencing | **Approach A** — foundation → primitives → features, incremental, trunk green throughout |
| Token mapping | **Alias in `tailwind.config.js`** — shadcn vocabulary (`background`, `primary`, etc.) points at DTAK CSS variables; shadcn components copy in unmodified for color values |

## Architecture

### Token-mapping layer (the core mechanism)

`tailwind.config.js` extends `theme.colors` with shadcn's vocabulary aliased to DTAK CSS variables defined in `web/src/styles/themes/{dark,light,low-detection}.css`:

```js
colors: {
  background: 'var(--bg-primary)',
  foreground: 'var(--fg-primary)',
  card: { DEFAULT: 'var(--bg-elevated)', foreground: 'var(--fg-primary)' },
  popover: { DEFAULT: 'var(--bg-elevated)', foreground: 'var(--fg-primary)' },
  primary: { DEFAULT: 'var(--brand)', foreground: 'var(--fg-on-brand)' },
  secondary: { DEFAULT: 'var(--bg-secondary)', foreground: 'var(--fg-primary)' },
  muted: { DEFAULT: 'var(--bg-muted)', foreground: 'var(--fg-muted)' },
  accent: { DEFAULT: 'var(--bg-accent)', foreground: 'var(--fg-primary)' },
  destructive: { DEFAULT: 'var(--danger)', foreground: 'var(--fg-on-danger)' },
  border: 'var(--border-subtle)',
  input: 'var(--border-input)',
  ring: 'var(--focus-ring)',
}
```

Plus border-radius alias (`--radius`) and `tailwindcss-animate` plugin.

Any DTAK var referenced above that doesn't exist (`--fg-on-brand`, `--fg-on-danger`, `--bg-accent`, `--bg-elevated`, `--bg-muted`, `--bg-secondary`, `--border-input`, `--focus-ring`) is added to `scripts/generate-tokens.py` (anchors or `SEMANTIC_MAPS`), regenerated, and committed across all three theme CSS files. This satisfies CLAUDE.md hard rule #6.

### Three-theme story

- Theme switching: `<html data-theme="dark|light|ld">`, controlled by existing `useTheme()` hook (unchanged).
- shadcn's default `class="dark"` toggle is **not** used — would conflict with DTAK's three-mode system.
- All `dark:*` Tailwind variants in copied-in shadcn components are **stripped** during copy-in (the one unavoidable manual step per primitive). Hardcoded color classes (`bg-white`, `text-slate-900`) likewise stripped.
- LD-mode color compliance is automatic: aliased vars resolve to LD-safe values when `data-theme="ld"`. Section 2 audit confirms each var has an LD-safe assignment in `low-detection.css`.

### Touch-target enforcement

Custom Tailwind utility `min-h-touch` defined in `tailwind.config.js`:

```css
.min-h-touch { min-height: 44px; }
[data-theme="ld"] .min-h-touch { min-height: 48px; }
```

Applied to interactive primitive variants: Button (all sizes), Input, Switch, Select trigger, Slider thumb, Tab trigger.

## Foundation (Wave 0)

**Dependencies added to `web/package.json`:**

Runtime:
- `class-variance-authority`
- `clsx`
- `tailwind-merge`
- `tailwindcss-animate`
- `lucide-react`
- `react-hook-form`
- `zod`
- `@hookform/resolvers`

Radix runtimes (added per-component as primitives are copied in):
- `@radix-ui/react-dialog`, `react-popover`, `react-dropdown-menu`, `react-context-menu`, `react-tooltip`, `react-tabs`, `react-scroll-area`, `react-select`, `react-slider`, `react-switch`, `react-separator`, `react-avatar`, `react-label`, `react-slot`

**Files added:**
- `web/components.json` — shadcn CLI config (style: default, alias `@/*` → `web/src/*`, components dir `components/ui`)
- `web/src/lib/utils.ts` — exports `cn()` (clsx + tailwind-merge)
- Path alias `@` confirmed/added in `tsconfig.json` and `vite.config.ts`

**One-time setup command:** `npx shadcn@latest init` accepting outputs but overriding generated theme CSS (DTAK already owns themes).

**Out of scope:** CI changes, Capacitor build changes, Vitest config changes.

## Primitive inventory & copy-in order

20 primitives across 19 numbered entries (`dropdown-menu` and `context-menu` land together as item 19), ordered so dependencies land before dependents:

**Wave 1 — zero-dep building blocks:**
1. `button` — replaces DTAK Button + IconButton (use `size="icon"` variant)
2. `input` — replaces DTAK Input
3. `label` — new (forms need it)
4. `separator` — replaces DTAK CalloutBar dividers
5. `badge` — replaces DTAK StatusPill
6. `card` — wraps what DTAK Surface did
7. `textarea` — new
8. `skeleton` — new (loading states)

**Wave 2 — Radix-backed, low-traffic:**
9. `switch` — replaces DTAK Toggle
10. `tooltip`
11. `avatar` — for VoiceMemberItem
12. `scroll-area` — for ChatView, Sidebar, MeshViewer

**Wave 3 — Radix-backed, structural:**
13. `tabs` — for SettingsPage
14. `select` — for VoiceSettings, MarkerForm
15. `slider` — for VoiceBar, VoiceSettings
16. `dialog` — for JoinRoomModal, MarkerForm modals
17. `sheet` — for mobile Sidebar
18. `popover` — for MapViewer marker popups
19. `dropdown-menu` + `context-menu` — for MessageBubble, VoiceMemberItem
20. `form` — wraps RHF + zod (depends on Input/Select/Switch/Label being in)

**Special case — DTAK CotMarker:** stays. Not a generic primitive — map-specific marker renderer with ATAK CoT semantics. Moves to `web/src/components/map/CotMarker.tsx`. Its test moves with it. Not part of the shadcn surface.

**Per-primitive copy-in checklist:**
- [ ] `npx shadcn@latest add <name>` to drop the file into `components/ui/`
- [ ] Strip `dark:*` variants and any hardcoded color classes
- [ ] Add `min-h-touch` to interactive variants where applicable
- [ ] Visual check in browser: dark, light, LD modes
- [ ] Redirect any feature import from old DTAK primitive to `@/components/ui/<name>`
- [ ] Delete corresponding `web/src/components/dtak/<Name>.tsx` + `.test.tsx`
- [ ] For LD-relevant primitives (Button, Input, Switch, Select, Badge): include in the LD banned-color regression test

**End state:** `web/src/components/dtak/` deleted; everything in `components/ui/` restyled, LD-compliant, visually verified.

## Form library setup

- `web/src/lib/forms/` — directory for shared zod schemas
- shadcn's `form` primitive (Wave 3, item 20) provides `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormDescription>`, `<FormMessage>`
- Per-form pattern: `useForm({ resolver: zodResolver(schema) })` + `<FormField name="..." control={form.control} render={...}>`
- Inline `<FormMessage>` for field errors, color via aliased `--danger` (LD-safe value confirmed in Section 2 audit)
- Submit button disabled while `!form.formState.isValid`

**Out of scope for this refactor:**
- Async/server-side validation (e.g., room name uniqueness against the mesh) — adopt later via `.refine()` + RHF async validators
- Multi-step forms — none currently exist
- Custom error toast surface — `<FormMessage>` inline is sufficient

## Feature component sweep order

**Pass 1 — Chat surface (most-used, biggest blast radius):**
- `Sidebar.tsx` — `Sheet` (mobile breakpoint) + `ScrollArea` + `Tabs`; rooms/voice/settings sections become Tab panels
- `ChatView.tsx` — `ScrollArea` for message list, `Skeleton` for loading
- `MessageBubble.tsx` — `ContextMenu` (reply/copy/delete), `Tooltip` (timestamps)
- `MessageInput.tsx` — `Textarea` (auto-grow), `Button`
- `RoomItem.tsx` — `Card` shell, `Badge` for unread count

**Pass 2 — Voice surface:**
- `VoiceBar.tsx` — `Button`, `Slider` for volume, `Tooltip` for icon meanings
- `VoiceChannelList.tsx` — flat list with `Separator`
- `VoiceMemberItem.tsx` — `Avatar`, `Badge`, `ContextMenu` (mute/kick/dm)
- `VoiceSettings.tsx` — `Form`, `Select` (devices), `Slider` (gain), `Switch` (noise suppression)
- `PTTButton.tsx` — `Button` with custom oversized hold-to-talk variant; LD floor 48px

**Pass 3 — Map & markers:**
- `MapViewer.tsx` — `Popover` for marker info, `Button`/`IconButton` for map controls
- `MarkerForm.tsx` — `Form` + `Dialog`, `Input`, `Select`, `Textarea`
- `MeshViewer.tsx` — `Card` per peer, `Badge` for status, `ScrollArea`, `Skeleton`
- `KeyBindingCapture.tsx` — `Input` (read-only) + `Tooltip`

**Pass 4 — Settings:**
- `SettingsPage.tsx` — `Tabs` (Profile / Mesh / Voice / Theme / About), `Form` per tab, `Switch`/`Select`/`Slider` per setting
- `JoinRoomModal.tsx` — `Dialog` + `Form` + `Input`

**Definition of "done" per pass (CLAUDE.md hard rules):**
- No raw color hex anywhere (rule #1)
- No `pl-*` classes (rule #2)
- All three themes visually verified (rule #3)
- Touch targets meet 44px / 48px LD floor (rule #4)
- File compiles, app boots, feature works in browser

**End of Pass 4:** every file in `web/src/components/` outside `ui/` and `map/` is fully shadcn + DTAK-tokenized.

## Testing & verification

**Removed:** 8 DTAK primitive tests (`Button`, `Input`, `Toggle`, `Surface`, `StatusPill`, `IconButton`, `CalloutBar` test files) — deleted with their corresponding primitives.

**Kept:** `CotMarker.test.tsx` (moves with file to `components/map/`), `VoiceBar.test.tsx` (feature-level).

**Added:** `web/src/components/ui/__tests__/ld-mode.test.tsx`
- Renders Button/Input/Switch/Select/Badge under `data-theme="ld"`, queries computed styles, asserts no color matches the banned blue/white range
- Asserts interactive primitives have computed `min-height >= 44px` default, `>= 48px` under `data-theme="ld"`

**Per-pass verification (Section 6):**
- `npm run test` after each pass — all existing feature tests pass
- `npm run build` after each pass — zero TypeScript errors
- Manual browser check per pass, all three themes

**Capacitor verification:**
- Single end-to-end Capacitor build after Pass 1 (chat surface) — confirms bundle works on iOS WKWebView and Android System WebView. Sheet animations and ScrollArea behavior are the most likely WebView-quirk surfaces.
- If Pass 1 succeeds, verify only again at the end. If Pass 1 surfaces a Radix-on-WKWebView issue, investigate before continuing.

**Out of scope:**
- Visual regression testing (Chromatic/Percy)
- E2E tests (Playwright) — none exist today

## Out-of-scope (deferred or rejected)

- Adopting shadcn's `dark` class toggle — incompatible with DTAK three-mode system
- Migrating `CotMarker` to a generic primitive — it's map/CoT-specific; stays bespoke under `components/map/`
- Async form validators in this refactor — adopt later as needed
- Multi-step forms (no current usage)
- Visual regression / E2E tooling (separate decision)
- CI pipeline changes
- Capacitor build pipeline changes

## References

- `docs/dtak/00-overview.md` — DTAK design system overview
- `docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md` — DTAK interface guide spec
- `scripts/generate-tokens.py` — token derivation script (must be edited for new vars)
- `web/src/styles/tokens.json` — generated token source of truth
- `web/src/styles/themes/{dark,light,low-detection}.css` — theme CSS files
- `web/tailwind.config.js` — Tailwind config (gets the alias layer)
- CLAUDE.md hard rules #1–#7 — all must be honored throughout the refactor
