# DTAK Interface Guide — Design Spec

**Date:** 2026-05-01
**Author:** Skylight design (zgehin / zack-skylight) with Claude
**Status:** Spec — pending implementation plan
**Repo:** [Trey-Rosales/peat-chat](https://github.com/Trey-Rosales/peat-chat)

---

## 1 · Overview

The DTAK Interface Guide is Peat-Chat's adaptation of the **Defense Interface Guide (DIG)** — a BESPIN/Skylight-led effort to define a shared design language for mission-focused defense software. DTAK ("Dispatch + TAK") establishes the visual, structural, and accessibility standards that the Peat-Chat team builds against — for the chat product specifically, but compatible with broader DIG conventions.

This spec defines **v1**: tokens, theme modes, and a small set of component primitives. It does *not* attempt to be a full design system in one sweep. The goal is to set the team up to build consistently, multi-mode-correctly, and AI-readably from this point forward.

### The four DIG principles (DTAK adopts unchanged)

1. **Minimize exposure time** — design so users can find and act on information quickly. The less time the screen is visible, the safer the user.
2. **Prioritize the mission** — critical information is instantly accessible; everything else takes a back seat.
3. **Design with hardware in mind** — some device features are allies (OLED black pixels), others are liabilities (IR emissions). Account for both.
4. **Reduce light emissions** — control contrast, motion, and how the UI interacts with environmental lighting.

These principles drive every decision below.

---

## 2 · Goals and non-goals

### Goals (v1)

- Replace the existing `pl-*` (WhatsApp-derived) color tokens with a defense-aware DTAK token system.
- Ship three theme modes: **Dark** (default), **Light**, **Low-Detection**.
- Make the system **mobile-first** and **mobile-web parity-correct** (same web bundle ships through Capacitor on iOS/Android).
- Establish the OKLCH-native, CSS-variable-driven token architecture so future modes (high-contrast, training) can be added without retrofitting.
- Define and ship 8 lean component primitives that consume semantic tokens.
- Produce documentation that humans *and* AI agents can pick up cold.

### Non-goals (v1)

- A full component kit (drawers, tabs, complex form widgets, data tables). Add as needed; don't pre-build.
- Storybook or a docs site. `tokens.json` + markdown is the v1 interface.
- Style Dictionary or token build pipelines. Defer until pain shows up.
- Native iOS/Android UI surfaces — Capacitor wraps the web; there is no parallel native UI tree.
- Round-trip Figma sync. Tokens flow Figma → repo manually for v1.
- High-contrast mode. Treat it as a future a11y modifier, not a fourth distinct mode.

### Out of scope, but worth flagging

- **CoT marker icon iconography** — DTAK v1 styles markers via tokens (`cot-friendly` etc.); MIL-STD-2525 symbology is a separate effort.
- **Typography scale** — v1 uses Tailwind's defaults. A dedicated DTAK type scale belongs in v2.
- **Motion/animation tokens** — v1 establishes "reduce motion in LD" as a principle; full motion tokens belong in v2.

---

## 3 · Architecture

### Three-layer token model

```
┌──────────────────────────────────────────────────────────────────┐
│  Component code   bg-brand · text-fg-primary · border-border-subtle  │   ← only ever uses
│                   bg-blue-500 · text-red-700  (raw, for one-offs)    │   semantic tokens
└────────────────────────────┬─────────────────────────────────────┘
                             │  (Tailwind utilities resolve to)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Semantic layer   --color-surface-1, --color-fg-primary,             │   ← CSS variables,
│                   --color-brand, --color-status-critical, ...        │   per-mode overrides
└────────────────────────────┬─────────────────────────────────────┘
                             │  (variables hold OKLCH triplets)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Raw scales       gray-50..950, blue-50..950, red-50..950, ...       │   ← 7 OKLCH scales,
│                   (custom DTAK, except violet)                        │   anchored at Figma 500s
└──────────────────────────────────────────────────────────────────┘
```

### Mode switching

A single `data-theme` attribute on `<html>` selects the active mode. The CSS variable values change; the Tailwind utility classes do not.

```html
<html data-theme="dark">  <!-- default -->
<html data-theme="light">
<html data-theme="ld">    <!-- low-detection -->
```

**Default = `dark`.** No automatic switching from `prefers-color-scheme` in v1 — defense ops need predictability. The user opts into Light or LD via Settings.

### Why this architecture (vs alternatives)

We considered:

| Approach | Verdict |
|---|---|
| **Tailwind variants only** (`dark:` + custom `ld:`) | Rejected. Verbose at every call site (`bg-blue-500 dark:bg-blue-400 ld:bg-red-500`). LD remap logic spreads across the codebase. |
| **Style Dictionary build pipeline** | Rejected for v1. Adds a build step the team has to learn. Wins (Figma round-trip) blocked because Figma access isn't wired up yet. Revisit in v2. |
| **CSS-variable-driven semantic tokens (chosen)** | Clean component code, mode flips in one place, plays well with Tailwind v3 today and v4 tomorrow. |

---

## 4 · Color scales (the 7)

All scales are authored in OKLCH for Tailwind v4 alignment, P3 gamut on capable displays, and perceptually-uniform interpolation. Each scale has 11 stops (`50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950`).

**Six scales are custom DTAK**, anchored at the user's Figma 500 hex. **One (violet) uses Tailwind violet** because no Figma anchor exists yet.

### Anchor summary

| Scale  | Anchor at 500 (hex) | Why |
|---|---|---|
| gray   | `#3F4447` | 3-anchor curve (50/500/950 from Figma). Near-neutral cool. |
| blue   | `#1879C7` | USAF institutional blue. Brand accent. |
| red    | `#C7181B` | Fire-engine red. Errors, hostile, LD remap target. |
| orange | `#C75314` | Burnt orange. Operator-gear feel. |
| yellow | `#FFAC1C` | Vivid amber-yellow. (At L=80% — brighter than other 500s by design.) |
| green  | `#137D3B` | Forest / military. Friendly, voice-active, success. |
| violet | `#8B5CF6` | Tailwind violet. BLE / transport indicator (already used in mesh viewer). |

### Full scales (hex)

```
gray:   50:#ECEDEE 100:#D2D4D5 200:#A9ACAD 300:#878A8C 400:#666A6D
        500:#3F4447 600:#32373A 700:#262A2D 800:#1B1F21 900:#111416 950:#070808

blue:   50:#E8F3FF 100:#D0E7FF 200:#A7D3FF 300:#71B9FF 400:#3F9AEC
        500:#1879C7 600:#0063A9 700:#004B83 800:#00335C 900:#001D37 950:#000816

red:    50:#FFEDEB 100:#FFD9D3 200:#FFB5AC 300:#FF8578 400:#F2483F
        500:#C7181B 600:#A9000C 700:#830007 800:#5E0003 900:#390001 950:#180000

orange: 50:#FFEEE7 100:#FFDCCE 200:#FFBFA4 300:#FF976B 400:#EB7239
        500:#C75314 600:#A74000 700:#812F00 800:#5A1F00 900:#350F00 950:#140200

yellow: 50:#FFF9F2 100:#FFF2E1 200:#FFE5C5 300:#FFD5A0 400:#FFC271
        500:#FFAC1C 600:#D38C00 700:#A06900 800:#6E4700 900:#3E2600 950:#130900

green:  50:#E5F8E8 100:#C9EECF 200:#9EDBAA 300:#70C183 400:#41A25C
        500:#137D3B 600:#00682D 700:#005021 800:#003815 900:#002109 950:#000B02

violet: 50:#F5F3FF 100:#EDE9FE 200:#DDD6FE 300:#C4B5FD 400:#A78BFA
        500:#8B5CF6 600:#7C3AED 700:#6D28D9 800:#5B21B6 900:#4C1D95 950:#2E1065
```

### Derivation method

All non-anchored stops are computed in OKLCH space:
- 50/950 endpoints land at user's gray endpoints (`L=0.946` / `L=0.133`).
- 500 lands at the user's anchor hex exactly.
- Intermediate stops use a smooth lightness curve through those three points and a Tailwind-style chroma curve (peak around 400-500, taper at extremes).
- Hue is locked per scale (extracted from the anchor).
- Out-of-gamut combinations are gamut-mapped by reducing chroma along constant L,H — never clipped raw.

The Python derivation script lives in-repo at **`scripts/generate-tokens.py`**. It emits both hex and OKLCH for every stop, plus a `tokens.json` consumable by tools.

---

## 5 · Semantic tokens (the 32)

Component code references *semantic* tokens, never raw scale stops (with rare exceptions for one-offs). Semantic tokens are CSS variables; their values change per mode.

### Categories

| Category | Tokens | Purpose |
|---|---|---|
| **Surface** | `surface-canvas`, `surface-1`, `surface-2`, `surface-3`, `surface-overlay` | Backgrounds, raised levels, modal scrims |
| **Foreground** | `fg-primary`, `fg-secondary`, `fg-tertiary`, `fg-disabled`, `fg-on-brand` | Text + icons |
| **Border** | `border-subtle`, `border-default`, `border-strong`, `border-focus` | Dividers, component borders, focus rings |
| **Brand** | `brand`, `brand-hover`, `brand-active` | Primary brand color (logo, primary buttons) |
| **Status** | `status-info`, `status-success`, `status-warning`, `status-critical` | Semantic UI states |
| **CoT** | `cot-friendly`, `cot-hostile`, `cot-neutral`, `cot-unknown` | ATAK affiliation convention |
| **Voice** | `voice-active`, `voice-listening`, `voice-muted` | Voice channel state |
| **Transport** | `transport-wifi`, `transport-ble`, `transport-relay`, `transport-offline` | Mesh transport indicators |

### Per-mode mappings

| Token | Dark | Light | Low-Detection |
|---|---|---|---|
| **surface-canvas** | gray-950 | gray-50 | true black `#000` |
| **surface-1** | gray-800 | white | true black |
| **surface-2** | gray-700 | gray-50 | true black |
| **surface-3** | gray-600 | white | true black |
| **surface-overlay** | gray-950 / 70% | gray-300 / 50% | black / 85% |
| **fg-primary** | gray-50 | gray-950 | red-500 |
| **fg-secondary** | gray-200 | gray-700 | red-700 |
| **fg-tertiary** | gray-300 | gray-500 | red-800 |
| **fg-disabled** | gray-400 | gray-300 | red-900 |
| **fg-on-brand** | white | white | black (on red) |
| **border-subtle** | gray-700 | gray-100 | red-950 |
| **border-default** | gray-600 | gray-200 | red-800 |
| **border-strong** | gray-400 | gray-500 | red-700 |
| **border-focus** | blue-400 | blue-500 | red-400 |
| **brand** | blue-500 | blue-600 | **red-500** ← remap |
| **brand-hover** | blue-400 | blue-500 | red-400 |
| **brand-active** | blue-600 | blue-700 | red-600 |
| **status-info** | blue-400 | blue-500 | **yellow-500** ← remap (no blue) |
| **status-success** | green-400 | green-500 | green-400 (sparingly) |
| **status-warning** | yellow-500 | yellow-600 | yellow-500 |
| **status-critical** | red-500 | red-600 | red-400 |
| **cot-friendly** | blue-300 | blue-600 | green-500 (subtle) |
| **cot-hostile** | red-500 | red-600 | red-400 |
| **cot-neutral** | yellow-500 | yellow-600 | yellow-600 |
| **cot-unknown** | gray-200 | gray-400 | red-800 (muted) |
| **voice-active** | green-400 | green-500 | yellow-500 |
| **voice-listening** | blue-400 | blue-500 | red-500 |
| **voice-muted** | gray-300 | gray-500 | red-800 |
| **transport-wifi** | blue-400 | blue-500 | red-500 |
| **transport-ble** | violet-400 | violet-600 | **yellow-500** ← remap (no blue) |
| **transport-relay** | yellow-500 | yellow-600 | yellow-400 |
| **transport-offline** | gray-400 | gray-300 | red-800 |

### Total: 32 tokens

5 surface + 5 foreground + 4 border + 3 brand + 4 status + 4 CoT + 3 voice + 4 transport = **32 semantic tokens**. `fg-on-brand` doubles as the on-status text color in v1 (see CalloutBar §7.6); split into `fg-on-status` if v2 reveals contrast issues.

### LD-specific notes

In Low-Detection mode some semantic distinctions compress (cot-friendly green is the sole non-red-spectrum permission; otherwise all blues and violets remap to red or yellow). This is **deliberate** — operators in LD context know "everything red could be hostile or critical, context tells me which." Don't try to recover full semantic distinction in LD.

---

## 6 · Theme modes

### Dark — default, primary mode

- Vehicle / indoor / nighttime ops.
- Full brand identity. Full saturation in tokens.
- Brand = USAF blue (`blue-500 #1879C7`).
- Today's app is a rough version of this mode.

### Light — daylight / training / accessibility

- Outdoor sunlight, briefing rooms, training environments, accessibility users.
- Brand drops one stop (`blue-600`) for AA contrast on `gray-50`.
- Contrast and AA targets met across the token system.
- The MapLibre tactical map already has an independent light/topo style — UI light mode complements that.

### Low-Detection — tactical / stealth

The differentiator. Not a darker dark mode. A distinct visual mode designed for stealth/tactical environments where light emission is a liability.

**Hard rules (DIG-derived):**

- **Background:** `#000000` only. Near-black breaks OLED's emission savings.
- **Foreground priority:** red → amber → yellow → green (only when semantically required, e.g. CoT "friendly"). Use sparingly and desaturated.
- **Banned:** bright white, any blue, high-saturation high-luminance combos, motion/animation by default.
- **Touch targets:** 48px minimum (Fitts's Law). Mobile UIs in LD enforce this stricter than the 44px web/light default.
- **Color-blind support via texture/patterning**, not increased contrast (would break stealth).
- **OLED-aware:** prefer true black so pixels are off; avoid near-black on OLED for the same reason.
- **IR awareness:** the design system can't fix device hardware emissions, but the app surfaces a warning toggle (per the BESPIN reference design) and the docs note device-specific risks.
- **Brightness cap:** the LD mode UI may include a per-mode max-brightness lock at the OS level (deferred to integration phase).
- **Reduce-motion default:** LD respects `prefers-reduced-motion: reduce` and additionally suppresses non-essential transitions even when the OS preference isn't set.

### Mode selection

- User-controlled toggle in Settings. No auto-switch from `prefers-color-scheme` in v1.
- Selection is persisted to local storage; on Capacitor, also persisted to native preferences.
- The setting reads back via `useTheme()` hook (added in v1).
- Switching modes is instant — CSS-var swap, no re-render of components.

---

## 7 · Component primitives (the 8)

All primitives live in `web/src/components/dtak/`. Each consumes semantic tokens — never raw scale stops. Each ships with an inline TypeScript prop type and JSDoc comment block (no separate `.d.ts`).

### 7.1 Surface

Token-aware container. Replaces ad-hoc `<div className="bg-pl-sidebar">`.

```tsx
<Surface variant="1">                    // surface-1 bg
<Surface variant="2" elevation="raised"> // surface-2 + shadow
<Surface variant="canvas">               // surface-canvas, full-bleed
```

**Variants:** `canvas | 1 | 2 | 3 | overlay`. **Tokens consumed:** `surface-*`, `border-subtle`.

### 7.2 Button

```tsx
<Button variant="primary" size="md">Join Voice</Button>
<Button variant="ghost">Cancel</Button>
<Button variant="destructive">Delete</Button>
```

**Variants:** `primary | secondary | ghost | destructive`. **Sizes:** `sm` (32px), `md` (40px web / 44px mobile), `lg` (48px web / 48px LD).
**Tokens consumed:** `brand`, `brand-hover`, `brand-active`, `fg-on-brand`, `surface-2`, `border-default`, `border-focus`, `status-critical` (for destructive).

### 7.3 Input

Text input + textarea. Owns focus ring, placeholder color, error state.

```tsx
<Input placeholder="Search rooms..." />
<Input error={errorMessage} />
<Input multiline />
```

**Tokens consumed:** `surface-2`, `fg-primary`, `fg-tertiary` (placeholder), `border-default`, `border-focus`, `status-critical` (error).

### 7.4 IconButton

Icon-only button. Touch target ≥ 44px on mobile, 48px in LD.

```tsx
<IconButton icon={<HomeIcon />} label="Home" />
<IconButton icon={<MicIcon />} label="Mute" toggled />
```

`label` is required (a11y). **Tokens consumed:** `surface-2`, `fg-primary`, `fg-secondary`, `border-focus`.

### 7.5 StatusPill

Unread badges, status pills, transport tags, CoT affiliation chips.

```tsx
<StatusPill variant="critical">CRITICAL</StatusPill>
<StatusPill variant="cot-hostile">HOSTILE</StatusPill>
<StatusPill variant="transport-ble">BLE</StatusPill>
<StatusPill variant="count">8</StatusPill>           // unread count
```

**Variants:** every `status-*`, `cot-*`, `transport-*`, plus `count` (uses `status-critical`).

### 7.6 CalloutBar

Active-call bar, alert banner, system message. Edge-anchored, status-tinted, optional dismiss.

```tsx
<CalloutBar variant="active-call" icon={<PhoneIcon />} dismissible>
  Active call · Dispatch North
</CalloutBar>
```

**Variants:** `info | success | warning | critical | active-call`. **Tokens:** `status-*` for the bar tint, `fg-on-brand` or `fg-primary` for text depending on whether the variant uses a filled background or an outlined/tinted treatment. `surface-1` for the underlying card. (`fg-on-brand` doubles as the on-status text color in v1; if status fills need their own contrast token in v2, split.)

### 7.7 Toggle

Switch / checkbox. Used heavily in settings (LD Stealth Settings).

```tsx
<Toggle checked={ldEnabled} onChange={setLdEnabled} label="Low-detection mode" />
```

**Tokens consumed:** `brand`, `surface-2`, `border-default`, `fg-primary`, `fg-disabled`.

### 7.8 CotMarker

Tactical-map marker. Affiliation drives color. Lives in MapLibre layer + lists.

```tsx
<CotMarker affiliation="friendly" remarks="Patrol Bravo" />
<CotMarker affiliation="hostile" />
<CotMarker affiliation="unknown" />
```

**Variants:** `friendly | hostile | neutral | unknown`. **Tokens consumed:** `cot-*` for marker fill; marker outline uses `fg-primary` (light contrast ring) so the marker reads on any map background. (No dedicated `fg-on-cot` in v1; revisit if marker labels become hard to read against varied terrain.)

### What's intentionally absent

- No `Card`, `Modal`, `Drawer`, `Tabs`, `Menu`, `Tooltip` in v1. Use `Surface` + composition.
- No data table primitive. Lists in Peat-Chat are bespoke today; revisit if a real table need emerges.
- No icon component — keep using whatever icon strategy the codebase has now (SVGs in JSX). DTAK doesn't own icons in v1.

---

## 8 · Mobile/web parity

Peat-Chat ships the same web bundle to mobile via Capacitor (iOS WKWebView, Android System WebView). DTAK leverages this — there is no parallel native UI tree to maintain.

### Touch targets

| Mode / context | Minimum touch target |
|---|---|
| Web (desktop / pointer) | 32px |
| Mobile (web in browser) | 44px |
| Capacitor (iOS / Android) | 44px |
| **Low-Detection (any) ** | **48px** (DIG mandate, Fitts's Law) |

Touch target is enforced via primitives (`Button`, `IconButton`, `Toggle`). Component variants like `size="md"` resolve to a different concrete size depending on context. DTAK exposes a `useTouchScale()` hook for components that need it directly.

### Breakpoints

Tailwind defaults are kept (`sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`). Mobile-first composition assumed throughout.

### Responsive strategy

- The chat list, room view, and mesh viewer all adapt from mobile (single pane) to desktop (multi-pane) via Tailwind responsive utilities.
- The tactical map is intentionally full-bleed on mobile and pane-aware on desktop.
- The "active call" bar is bottom-fixed on mobile, header-pinned on desktop.

### What does *not* have parity

- **Native context menus / share sheets** — Capacitor plugins handle these per platform; DTAK doesn't theme them.
- **Native push notifications** — outside DTAK's scope.
- **Hardware controls** (PTT button, volume) — handled in `mobile/android/` Kotlin and the Capacitor bridge; DTAK touches only the in-app indicators.

---

## 9 · Documentation structure

### File layout

```
peat-chat/
├── CLAUDE.md                                ← AI entrypoint, ~150 lines
├── docs/
│   ├── ROADMAP.md                           (existing, untouched)
│   ├── one-pager.md                         (existing, untouched)
│   ├── dtak/                                ← NEW: the Interface Guide
│   │   ├── 00-overview.md                   what DTAK is, four DIG principles
│   │   ├── 01-tokens.md                     scales + semantic tokens (auth ref)
│   │   ├── 02-modes.md                      dark / light / low-detection guide
│   │   ├── 03-components.md                 8 primitives, props, variants, tokens
│   │   ├── 04-mobile-vs-web.md              Capacitor, touch targets, breakpoints
│   │   ├── 05-low-detection.md              DIG rules, OLED, IR, color-blind
│   │   ├── 06-migration.md                  pl-* → DTAK refactor playbook
│   │   └── tokens.json                      machine-readable; generated
│   └── superpowers/specs/
│       └── 2026-05-01-dtak-interface-guide-design.md   (this spec)
├── scripts/
│   └── generate-tokens.py                   ← OKLCH derivation, emits tokens.json + CSS
└── web/src/
    ├── components/dtak/                     ← 8 primitives
    │   ├── Surface.tsx
    │   ├── Button.tsx
    │   ├── Input.tsx
    │   ├── IconButton.tsx
    │   ├── StatusPill.tsx
    │   ├── CalloutBar.tsx
    │   ├── Toggle.tsx
    │   └── CotMarker.tsx
    └── styles/themes/                       ← per-mode CSS vars
        ├── dark.css
        ├── light.css
        └── low-detection.css
```

### `CLAUDE.md` contract (repo root)

The repo-root `CLAUDE.md` is intentionally short. It tells any AI agent:

- DTAK Interface Guide is at `docs/dtak/`.
- Token source of truth: `docs/dtak/tokens.json`.
- Component primitives: `web/src/components/dtak/`.
- Theme stylesheets: `web/src/styles/themes/`.
- **Never write raw scale hexes in JSX.** Use semantic tokens.
- **Never write `bg-pl-*`** (those tokens are deprecated).
- When adding a new component: place under `web/src/components/dtak/` only if it is shared / cross-feature. Feature-specific components stay in their feature folders but still consume DTAK semantic tokens.
- Test in all three modes before merging UI changes.

### Token doc generation

`scripts/generate-tokens.py` is the canonical OKLCH derivation. It reads anchor hexes (locked in v1), computes scales, and writes:

1. `docs/dtak/tokens.json` — machine-readable
2. `web/src/styles/themes/{dark,light,low-detection}.css` — semantic CSS vars per mode
3. `web/tailwind.config.js` (the `theme.extend.colors` block) — partial regeneration via comment markers

The script is idempotent. CI runs it and fails if regenerated files differ from committed (catches drift).

---

## 10 · Migration plan (`pl-*` → DTAK)

The existing `web/tailwind.config.js` defines 13 `pl-*` tokens. These are deleted in v1 and replaced by the DTAK system. The mapping below is the playbook for refactoring each existing usage.

| Existing token | Replace with |
|---|---|
| `pl-bg` `#0b141a` | `bg-surface-canvas` |
| `pl-sidebar` `#111b21` | `bg-surface-1` |
| `pl-header` `#1f2c33` | `bg-surface-2` |
| `pl-input` `#2a3942` | `bg-surface-2` (use within `<Input>`) |
| `pl-hover` `#202c33` | `hover:bg-surface-2` |
| `pl-active` `#2a3942` | `bg-surface-3` or `data-active:bg-surface-3` |
| `pl-sent` `#005c4b` | `bg-brand` (sent message bubbles read as brand-tinted) |
| `pl-received` `#1b2733` | `bg-surface-2` |
| `pl-border` `#2a3942` | `border-border-subtle` |
| `pl-text` `#e9edef` | `text-fg-primary` |
| `pl-text-sec` `#8696a0` | `text-fg-secondary` or `text-fg-tertiary` |
| `pl-accent` `#00a884` | `text-brand` / `bg-brand` |
| `pl-danger` `#ea4335` | `text-status-critical` / `bg-status-critical` |

The migration order:

1. Generate the new tokens, theme CSS, and tailwind config (`scripts/generate-tokens.py`).
2. Add the new DTAK primitives, leave existing components untouched.
3. Refactor one feature folder at a time (chat list → message view → settings → map → mesh viewer). Each folder's PR uses the table above.
4. Once all features are migrated, delete the `pl-*` block from `tailwind.config.js`.
5. Run a CI grep to assert no `pl-*` survives in `web/src/`.

Migration is not blocking for normal feature work — features can ship against either token system during the transition window. New code uses DTAK; old code is refactored opportunistically.

---

## 11 · Open questions and follow-ups

These are explicitly *not* blocking v1, but flagged so they don't go quiet:

1. **Figma access.** The Figma MCP currently fails to read the source file (`P76lNnTw1mjKZcRYhJXktO`). User to grant access (or manually export a tokens artifact) before any automated round-trip is wired up.
2. **Violet anchor.** No Figma 500 was provided for violet; v1 uses Tailwind's `violet`. Once a DTAK violet anchor exists, regenerate via the script — the rest of the system is unaffected.
3. **Typography scale.** Tailwind defaults are used in v1. A DTAK type scale (`display`, `headline`, `body-lg`, `body`, `label`, `caption`) is a v2 candidate.
4. **Motion tokens.** "Reduce motion in LD" is a principle in v1; concrete `motion-*` tokens (durations, easings) are v2.
5. **Storybook / docs site.** Not in v1. Reconsider when (a) the team has 3+ designers, or (b) `docs/dtak/03-components.md` becomes painful to maintain.
6. **High-contrast mode.** Treated as a future a11y modifier on top of any base mode, not a fourth distinct mode. v2.
7. **Native iOS/Android theming.** Outside DTAK scope while Capacitor wraps web. If a native UI surface is introduced (e.g. a native settings screen), DTAK token values must be mirrored there.
8. **CI checks.** A CI job that runs `generate-tokens.py` and asserts no diff is part of v1 implementation. Beyond that, lint rules to forbid raw hexes in JSX (`no-raw-color-hex`) are nice-to-have.

---

## 12 · Acceptance criteria for v1 implementation

The implementation plan (next phase) ships when:

- [ ] All seven scales exist in `tailwind.config.js` as OKLCH literals.
- [ ] All 32 semantic tokens are defined in three theme stylesheets and exposed via Tailwind utilities.
- [ ] `<html data-theme="dark|light|ld">` cycles through all three modes and every primitive looks correct in each.
- [ ] Mode selection is exposed via a Settings toggle and persists.
- [ ] All eight primitives exist under `web/src/components/dtak/` with prop types and a usage comment.
- [ ] `docs/dtak/` tree is in place and complete.
- [ ] `CLAUDE.md` at repo root points the AI at the system.
- [ ] `scripts/generate-tokens.py` runs and produces a clean diff.
- [ ] At least one feature folder (recommend: settings) is migrated off `pl-*` to demonstrate the playbook.
- [ ] LD mode passes a manual review: black backgrounds confirmed, no blue or white in screenshots, 48px touch targets enforced, no auto-motion.
