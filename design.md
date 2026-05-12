# design.md — Peat-Chat DTAK Quick Reference

Single-file design system reference for AI work. Distilled from `docs/dtak/` (read those for full detail). Pair this with `CLAUDE.md`.

## The design system

**DTAK** = Peat-Chat's adaptation of the **Defense Interface Guide (DIG)**. Four principles drive every decision:

1. **Minimize exposure time** — find and act fast; less screen-on = safer user.
2. **Prioritize the mission** — critical info instant; everything else recedes.
3. **Design with hardware in mind** — OLED off-pixels are allies, IR/blue light are liabilities.
4. **Reduce light emissions** — control contrast, motion, and environmental coupling.

## Three modes

Active mode toggled via `<html data-theme="dark|light|ld">`. CSS-var swap, no re-render. Read/write via `useTheme()` in `web/src/hooks/useTheme.ts`. Persists in `localStorage` under `dtak.theme`.

| Mode | Use | Brand color | Notes |
|---|---|---|---|
| `dark` (default) | Vehicle, indoor, night ops | `blue-500` `#1879C7` | "Natural" appearance |
| `light` | Daylight, training, briefings | `blue-600` (AA contrast) | Map has independent light/topo style |
| `ld` (low-detection) | Tactical / stealth | red (not blue) | See LD rules below |

No `prefers-color-scheme` auto-switch in v1 — defense ops need predictability.

## Tokens

**Source of truth:** `web/src/styles/tokens.json` (generated). **To change:** edit anchors / `SEMANTIC_MAPS` in `scripts/generate-tokens.py`, run `python3 scripts/generate-tokens.py`, commit regenerated files.

### Seven OKLCH scales

Each has 11 stops (`50…950`). Anchored to Figma 500 hex (except violet = Tailwind violet-500).

| Scale | 500 | Role |
|---|---|---|
| `gray` | `#3F4447` | Near-neutral cool, 3-anchor curve |
| `blue` | `#1879C7` | USAF blue; brand in dark/light; **banned in LD** |
| `red` | `#C7181B` | Errors; brand in LD |
| `orange` | `#C75314` | Operator-gear feel |
| `yellow` | `#FFAC1C` | Vivid amber at L=80% |
| `green` | `#137D3B` | Friendly / voice-active / success |
| `violet` | `#8B5CF6` | BLE / transport indicator |

### 32 semantic tokens (use these, not raw stops)

| Category | Tokens |
|---|---|
| Surface | `surface-canvas`, `surface-1`, `surface-2`, `surface-3`, `surface-overlay` |
| Foreground | `fg-primary`, `fg-secondary`, `fg-tertiary`, `fg-disabled`, `fg-on-brand` |
| Border | `border-subtle`, `border-default`, `border-strong`, `border-focus` |
| Brand | `brand`, `brand-hover`, `brand-active` |
| Status | `status-info`, `status-success`, `status-warning`, `status-critical` |
| CoT | `cot-friendly`, `cot-hostile`, `cot-neutral`, `cot-unknown` |
| Voice | `voice-active`, `voice-listening`, `voice-muted` |
| Transport | `transport-wifi`, `transport-ble`, `transport-relay`, `transport-offline` |

### Usage

```tsx
// ✓ Semantic tokens
<div className="bg-surface-1 text-fg-primary border-border-subtle">
  <button className="bg-brand text-fg-on-brand hover:bg-brand-hover">Send</button>
</div>

// ✓ Raw scale stops OK for one-off decorative tints
<div className="bg-blue-500/20" />

// ✗ NEVER raw hexes in JSX
<div style={{ backgroundColor: '#1879C7' }} />
```

## Component primitives

Live in `web/src/components/dtak/`. All consume semantic tokens only. All tested with vitest + @testing-library/react.

| Primitive | Variants / sizes | Notes |
|---|---|---|
| `Surface` | `canvas \| 1 \| 2 \| 3 \| overlay` | Token-aware container |
| `Button` | `primary \| secondary \| ghost \| destructive` × `sm(32) \| md(40/44) \| lg(48)` | `lg` is LD-friendly |
| `Input` | text / `multiline` / `error` | |
| `IconButton` | toggled support | `label` required (a11y); 44px always |
| `StatusPill` | all `status-*`, `cot-*`, `transport-*`, plus `count` | |
| `CalloutBar` | `info \| success \| warning \| critical \| active-call` | Dismissible w/ `onDismiss` |
| `Toggle` | — | `role="switch"` + `aria-checked` |
| `CotMarker` | `friendly \| hostile \| neutral \| unknown` | Map markers |

**New primitive?** Only promote into `dtak/` if used in 3+ feature folders OR encapsulates a token contract worth enforcing. Otherwise keep feature-local and consume tokens directly.

## Touch targets

| Context | Min |
|---|---|
| Web (pointer) | 32px |
| Mobile / Capacitor | 44px |
| **Low-Detection (any platform)** | **48px** |

## Low-Detection (LD) — the strict mode

**LD is not "darker dark."** It is a distinct stealth mode. Adapted from DIG Low Detection Mode Guidelines (BESPIN/Skylight, 2025).

### Hard rules

| Rule | Reason |
|---|---|
| Background = `#000000` **only** | OLED pixels physically off = minimum emission |
| **No blue** anywhere | Wakes the eye, destroys night vision, highly detectable |
| **No bright white** | Compromises stealth; replaced by red/amber |
| FG priority: **red → amber → yellow → green** (green only when essential) | Lower wavelengths emit less detectable energy |
| Touch targets ≥ **48px** | Fitts's Law under degraded conditions (gloves, motion, low light) |
| No motion / animation by default | Attracts attention, drains battery |
| Color-blind support via texture, **not** added contrast | Added contrast in LD risks stealth |

In LD, semantic vars resolve LD-safe: `brand` → red, `status-info` → yellow, `transport-ble` → yellow, all `surface-*` → `#000000`, all `fg-*` → red shades. Components don't special-case — they just write `bg-brand text-fg-primary` and the values resolve correctly.

## Mobile parity (Capacitor)

Same web bundle ships to iOS (WKWebView) and Android (System WebView). No parallel native UI tree. Theme persistence proxied to native preferences automatically.

**Responsive patterns:**
- Chat list / room view / mesh viewer: single-pane mobile, sidebar desktop
- Tactical map: full-bleed mobile, pane-aware desktop
- Active-call bar: bottom-fixed mobile, header-pinned desktop

**Not DTAK-themed:** native context menus / share sheets, push notifications, hardware controls (PTT, volume).

## Hard rules for any UI work in this repo

1. **Never** write raw color hexes in JSX. Use semantic tokens.
2. **Never** use `pl-*` classes in new code (deprecated — shim only). Use DTAK tokens. See `docs/dtak/06-migration.md`.
3. **Test every UI change in all three modes** before declaring done. Flip Settings → Theme. In LD specifically: scan for blue/white (banned).
4. Touch targets: 44px mobile, **48px in LD**.
5. New primitive only if reusable across 3+ features.
6. Changing a token? Edit `scripts/generate-tokens.py`, regenerate, commit regenerated files.
7. Mode switching is always via `<html data-theme>` — use `useTheme()`.

## Legacy `pl-*` migration

Old `pl-*` Tailwind classes (WhatsApp-derived) are aliased via shim in `web/tailwind.config.js`. They render and theme-react correctly, but **all new code must use DTAK tokens**. Key remappings:

- `bg-pl-bg` → `bg-surface-canvas`
- `bg-pl-sidebar` → `bg-surface-1`
- `bg-pl-header` → `bg-surface-2`
- `bg-pl-hover` → `hover:bg-surface-2`
- `bg-pl-sent` → `bg-brand`
- `border-pl-border` → `border-border-subtle`
- `text-pl-text` / `text-pl-text-sec` → `text-fg-primary` / `text-fg-secondary`
- `text-pl-accent` → `text-brand`
- `text-pl-danger` → `text-status-critical`

Full table + rollout order in `docs/dtak/06-migration.md`.

## Where to read more

| Topic | File |
|---|---|
| Overview / principles | `docs/dtak/00-overview.md` |
| Tokens (full) | `docs/dtak/01-tokens.md` |
| Modes (full) | `docs/dtak/02-modes.md` |
| Components (full) | `docs/dtak/03-components.md` |
| Mobile vs web | `docs/dtak/04-mobile-vs-web.md` |
| Low-Detection (full) | `docs/dtak/05-low-detection.md` |
| `pl-*` migration | `docs/dtak/06-migration.md` |
| Spec | `docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-05-01-dtak-interface-guide.md` |
