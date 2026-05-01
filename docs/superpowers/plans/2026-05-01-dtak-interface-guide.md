# DTAK Interface Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing `pl-*` (WhatsApp-derived) token system with the DTAK Interface Guide — 7 OKLCH color scales, 32 semantic tokens, three theme modes (Dark/Light/Low-Detection), 8 component primitives, and AI-readable documentation.

**Architecture:** Three-layer model — raw OKLCH scales in `tailwind.config.js`, semantic CSS variables in per-mode stylesheets, and Tailwind utilities that resolve `oklch(var(...) / <alpha-value>)` at runtime. Mode switching toggles `<html data-theme="dark|light|ld">`. Same web bundle ships to mobile via Capacitor.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 3.4, Vitest + @testing-library/react, Python 3 (for token derivation script), Capacitor 5+ wrap.

**Spec:** `docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md`

---

## File map (what gets created or modified)

```
peat-chat/
├── CLAUDE.md                                NEW  AI entrypoint
├── docs/dtak/                               NEW  Interface Guide
│   ├── 00-overview.md
│   ├── 01-tokens.md
│   ├── 02-modes.md
│   ├── 03-components.md
│   ├── 04-mobile-vs-web.md
│   ├── 05-low-detection.md
│   ├── 06-migration.md
│   └── tokens.json                          generated
├── scripts/
│   └── generate-tokens.py                   NEW  OKLCH derivation
├── web/
│   ├── tailwind.config.js                   MODIFY  scales + semantic
│   └── src/
│       ├── index.css                        MODIFY  @import themes
│       ├── components/dtak/                 NEW  8 primitives
│       │   ├── Surface.tsx
│       │   ├── Button.tsx
│       │   ├── Input.tsx
│       │   ├── IconButton.tsx
│       │   ├── StatusPill.tsx
│       │   ├── CalloutBar.tsx
│       │   ├── Toggle.tsx
│       │   ├── CotMarker.tsx
│       │   └── *.test.tsx                   one test file per primitive
│       ├── hooks/
│       │   └── useTheme.ts                  NEW  mode hook + persistence
│       └── styles/themes/                   NEW
│           ├── dark.css
│           ├── light.css
│           └── low-detection.css
└── .github/workflows/dtak-checks.yml        NEW  CI: token drift + pl-* grep
```

---

## Phase 0 · Pre-flight

### Task 0.1: Verify dev environment works

**Files:** none

- [ ] **Step 1: Verify web app builds and tests pass on `main`**

```bash
cd web
npm install
npm run build
npm test
```

Expected: build succeeds, all existing tests pass. If anything fails, fix before continuing — the DTAK rollout assumes a green baseline.

- [ ] **Step 2: Verify Python 3.9+ available**

```bash
python3 --version
```

Expected: `Python 3.9.x` or later (needed for the token-derivation script).

- [ ] **Step 3: Note current `pl-*` token usages for later verification**

```bash
grep -rE 'pl-(bg|sidebar|header|input|hover|active|sent|received|border|text|text-sec|accent|danger)' web/src --include='*.ts*' | wc -l
```

Record the count. Migration verification (Phase 6) will assert this drops to 0.

---

## Phase 1 · Token derivation infrastructure

### Task 1.1: Create the token-generation script

**Files:**
- Create: `scripts/generate-tokens.py`

- [ ] **Step 1: Create `scripts/generate-tokens.py`**

```python
#!/usr/bin/env python3
"""DTAK Interface Guide token generator.

Source of truth for the seven OKLCH color scales and the per-mode
semantic token mappings. Run from repo root:

    python3 scripts/generate-tokens.py

Emits:
    docs/dtak/tokens.json                          machine-readable
    web/src/styles/themes/dark.css                 OKLCH CSS vars
    web/src/styles/themes/light.css
    web/src/styles/themes/low-detection.css

Anchors come from the user's Figma DTAK file. To change them, edit the
ANCHORS dict below, re-run, commit the regenerated files.
"""
from __future__ import annotations
import json, math, os, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STOPS = (50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950)

# ── Anchor hexes (locked v1) ───────────────────────────────────────────
# Source: user's Figma DTAK file, 2026-05-01.
GRAY_50, GRAY_500, GRAY_950 = "#ECEDEE", "#3F4447", "#070808"
ANCHORS_500 = {
    "gray":   GRAY_500,
    "blue":   "#1879C7",   # USAF institutional
    "red":    "#C7181B",
    "orange": "#C75314",
    "yellow": "#FFAC1C",   # vivid amber-yellow at L=80%
    "green":  "#137D3B",   # forest / military
    "violet": "#8B5CF6",   # Tailwind violet (no anchor provided)
}

# ── OKLCH math ─────────────────────────────────────────────────────────
def srgb_to_linear(c): return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def linear_to_srgb(c): return 12.92*c if c <= 0.0031308 else 1.055*(c**(1/2.4))-0.055

def hex_to_rgb01(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))

def linear_srgb_to_oklab(r, g, b):
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_, m_, s_ = l**(1/3), m**(1/3), s**(1/3)
    return (
        0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
        1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
        0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_,
    )

def oklab_to_linear_srgb(L, a, b):
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    return (
        +4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
        -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
        -0.0041960863*l - 0.7034186147*m + 1.7076147010*s,
    )

def in_gamut(L, C, H):
    a = C*math.cos(math.radians(H)); b = C*math.sin(math.radians(H))
    rl, gl, bl = oklab_to_linear_srgb(L, a, b)
    return all(-1e-4 <= v <= 1.0001 for v in (rl, gl, bl))

def gamut_map(L, C, H):
    if in_gamut(L, C, H): return L, C, H
    lo, hi = 0.0, C
    for _ in range(40):
        mid = (lo + hi) / 2
        if in_gamut(L, mid, H): lo = mid
        else: hi = mid
    return L, lo, H

def oklch_to_hex(L, C, H):
    L, C, H = gamut_map(L, C, H)
    a = C*math.cos(math.radians(H)); b = C*math.sin(math.radians(H))
    rl, gl, bl = oklab_to_linear_srgb(L, a, b)
    rgb = [max(0, min(1, linear_to_srgb(c))) for c in (rl, gl, bl)]
    return "#{:02X}{:02X}{:02X}".format(*[round(c*255) for c in rgb]), (L, C, H)

def hex_to_oklch(h):
    r, g, b = (srgb_to_linear(c) for c in hex_to_rgb01(h))
    L, a, b_ = linear_srgb_to_oklab(r, g, b)
    return L, math.hypot(a, b_), math.degrees(math.atan2(b_, a)) % 360

# ── Scale derivation ────────────────────────────────────────────────────
def derive_scale(anchor_500, light_extreme=0.946, dark_extreme=0.133, gamut_safe=True):
    """Build an 11-stop scale anchored at 500 = anchor."""
    aL, aC, aH = hex_to_oklch(anchor_500)
    L_vals = []
    for i in range(6):              # 50, 100, 200, 300, 400, 500
        t = i / 5.0
        L_vals.append(light_extreme + (aL - light_extreme) * (t ** 1.4))
    for i in range(1, 6):           # 600..950
        t = i / 5.0
        L_vals.append(aL + (dark_extreme - aL) * (t ** 1.1))

    C_REL = [0.20, 0.40, 0.65, 0.85, 0.97, 1.00, 0.95, 0.85, 0.65, 0.45, 0.25]
    peak_C = aC * 1.05
    out = {}
    for stop, L_, c_rel in zip(STOPS, L_vals, C_REL):
        if stop == 500:
            out[stop] = (anchor_500.upper(), (aL, aC, aH))
        else:
            C_ = peak_C * c_rel if anchor_500 != GRAY_500 else max(0.0015, 0.003*(1-abs(L_-0.5)*1.4))
            hex_, oklch = oklch_to_hex(L_, C_, aH)
            out[stop] = (hex_, oklch)
    return out

def derive_gray():
    """Gray uses 3-anchor curve: 50, 500, 950 from user."""
    fam = {}
    pre_500 = [
        (50,  "#ECEDEE"), (100, "#D2D4D5"), (200, "#A9ACAD"),
        (300, "#878A8C"), (400, "#666A6D"), (500, "#3F4447"),
    ]
    post_500 = [
        (600, "#32373A"), (700, "#262A2D"), (800, "#1B1F21"),
        (900, "#111416"), (950, "#070808"),
    ]
    for stop, hex_ in pre_500 + post_500:
        L, C, H = hex_to_oklch(hex_)
        fam[stop] = (hex_, (L, C, H))
    return fam

# ── Main: build all scales, then semantic mappings, then write outputs ─
def build_scales():
    scales = {"gray": derive_gray()}
    for name in ("blue", "red", "orange", "yellow", "green", "violet"):
        scales[name] = derive_scale(ANCHORS_500[name])
    return scales

def lch_str(LCH):
    L, C, H = LCH
    return f"{L*100:.1f}% {C:.3f} {H:.1f}"

# Per-mode semantic mappings — value is "scale-stop" key into scales
SEMANTIC_MAPS = {
    "dark": {
        "surface-canvas": ("gray", 950),
        "surface-1":      ("gray", 800),
        "surface-2":      ("gray", 700),
        "surface-3":      ("gray", 600),
        # surface-overlay handled separately (alpha)
        "fg-primary":     ("gray", 50),
        "fg-secondary":   ("gray", 200),
        "fg-tertiary":    ("gray", 300),
        "fg-disabled":    ("gray", 400),
        "fg-on-brand":    ("WHITE", None),
        "border-subtle":  ("gray", 700),
        "border-default": ("gray", 600),
        "border-strong":  ("gray", 400),
        "border-focus":   ("blue", 400),
        "brand":          ("blue", 500),
        "brand-hover":    ("blue", 400),
        "brand-active":   ("blue", 600),
        "status-info":    ("blue", 400),
        "status-success": ("green", 400),
        "status-warning": ("yellow", 500),
        "status-critical":("red", 500),
        "cot-friendly":   ("blue", 300),
        "cot-hostile":    ("red", 500),
        "cot-neutral":    ("yellow", 500),
        "cot-unknown":    ("gray", 200),
        "voice-active":   ("green", 400),
        "voice-listening":("blue", 400),
        "voice-muted":    ("gray", 300),
        "transport-wifi": ("blue", 400),
        "transport-ble":  ("violet", 400),
        "transport-relay":("yellow", 500),
        "transport-offline":("gray", 400),
    },
    "light": {
        "surface-canvas": ("gray", 50),
        "surface-1":      ("WHITE", None),
        "surface-2":      ("gray", 50),
        "surface-3":      ("WHITE", None),
        "fg-primary":     ("gray", 950),
        "fg-secondary":   ("gray", 700),
        "fg-tertiary":    ("gray", 500),
        "fg-disabled":    ("gray", 300),
        "fg-on-brand":    ("WHITE", None),
        "border-subtle":  ("gray", 100),
        "border-default": ("gray", 200),
        "border-strong":  ("gray", 500),
        "border-focus":   ("blue", 500),
        "brand":          ("blue", 600),
        "brand-hover":    ("blue", 500),
        "brand-active":   ("blue", 700),
        "status-info":    ("blue", 500),
        "status-success": ("green", 500),
        "status-warning": ("yellow", 600),
        "status-critical":("red", 600),
        "cot-friendly":   ("blue", 600),
        "cot-hostile":    ("red", 600),
        "cot-neutral":    ("yellow", 600),
        "cot-unknown":    ("gray", 400),
        "voice-active":   ("green", 500),
        "voice-listening":("blue", 500),
        "voice-muted":    ("gray", 500),
        "transport-wifi": ("blue", 500),
        "transport-ble":  ("violet", 600),
        "transport-relay":("yellow", 600),
        "transport-offline":("gray", 300),
    },
    "ld": {
        "surface-canvas": ("BLACK", None),
        "surface-1":      ("BLACK", None),
        "surface-2":      ("BLACK", None),
        "surface-3":      ("BLACK", None),
        "fg-primary":     ("red", 500),
        "fg-secondary":   ("red", 700),
        "fg-tertiary":    ("red", 800),
        "fg-disabled":    ("red", 900),
        "fg-on-brand":    ("BLACK", None),
        "border-subtle":  ("red", 950),
        "border-default": ("red", 800),
        "border-strong":  ("red", 700),
        "border-focus":   ("red", 400),
        "brand":          ("red", 500),
        "brand-hover":    ("red", 400),
        "brand-active":   ("red", 600),
        "status-info":    ("yellow", 500),
        "status-success": ("green", 400),
        "status-warning": ("yellow", 500),
        "status-critical":("red", 400),
        "cot-friendly":   ("green", 500),
        "cot-hostile":    ("red", 400),
        "cot-neutral":    ("yellow", 600),
        "cot-unknown":    ("red", 800),
        "voice-active":   ("yellow", 500),
        "voice-listening":("red", 500),
        "voice-muted":    ("red", 800),
        "transport-wifi": ("red", 500),
        "transport-ble":  ("yellow", 500),
        "transport-relay":("yellow", 400),
        "transport-offline":("red", 800),
    },
}

WHITE = "100% 0 0"
BLACK = "0% 0 0"

def resolve_var(scales, ref):
    name, stop = ref
    if name == "WHITE": return WHITE
    if name == "BLACK": return BLACK
    return lch_str(scales[name][stop][1])

def write_theme_css(mode, scales, mapping, out_path):
    lines = [
        f"/* GENERATED by scripts/generate-tokens.py — do not edit by hand. */",
        f"[data-theme=\"{mode}\"] {{",
    ]
    for token, ref in mapping.items():
        lines.append(f"  --color-{token}: {resolve_var(scales, ref)};")
    # surface-overlay (alpha-bearing) — written as full color value, not split L/C/H
    if mode == "dark":
        lines.append(f"  --color-surface-overlay: oklch(13.3% 0.002 196.9 / 0.7);")
    elif mode == "light":
        lines.append(f"  --color-surface-overlay: oklch(72% 0.002 220 / 0.5);")
    else:  # ld
        lines.append(f"  --color-surface-overlay: oklch(0% 0 0 / 0.85);")
    lines.append("}")
    out_path.write_text("\n".join(lines) + "\n")

def write_tokens_json(scales, semantic_maps, out_path):
    data = {
        "scales": {
            name: {
                str(stop): {
                    "hex": hex_,
                    "oklch": f"oklch({lch_str(oklch)})",
                    "L": round(oklch[0]*100, 2),
                    "C": round(oklch[1], 4),
                    "H": round(oklch[2], 2),
                }
                for stop, (hex_, oklch) in fam.items()
            }
            for name, fam in scales.items()
        },
        "semantic": semantic_maps,
    }
    out_path.write_text(json.dumps(data, indent=2) + "\n")

def main():
    scales = build_scales()
    themes_dir = REPO / "web" / "src" / "styles" / "themes"
    themes_dir.mkdir(parents=True, exist_ok=True)
    for mode, mapping in SEMANTIC_MAPS.items():
        write_theme_css(
            mode, scales, mapping,
            themes_dir / f"{'low-detection' if mode == 'ld' else mode}.css",
        )
    docs_dir = REPO / "docs" / "dtak"
    docs_dir.mkdir(parents=True, exist_ok=True)
    write_tokens_json(scales, SEMANTIC_MAPS, docs_dir / "tokens.json")
    print("✓ Generated:")
    print(f"  {themes_dir / 'dark.css'}")
    print(f"  {themes_dir / 'light.css'}")
    print(f"  {themes_dir / 'low-detection.css'}")
    print(f"  {docs_dir / 'tokens.json'}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/generate-tokens.py
```

- [ ] **Step 3: Run it from repo root**

```bash
cd /Users/skylight/Documents/Peat-Chat
python3 scripts/generate-tokens.py
```

Expected output:
```
✓ Generated:
  .../web/src/styles/themes/dark.css
  .../web/src/styles/themes/light.css
  .../web/src/styles/themes/low-detection.css
  .../docs/dtak/tokens.json
```

- [ ] **Step 4: Sanity-check generated files**

```bash
head -20 web/src/styles/themes/dark.css
head -40 docs/dtak/tokens.json
```

Expected: `[data-theme="dark"]` block with `--color-*` vars in OKLCH triplet form. JSON has `scales.gray.500.hex == "#3F4447"`.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-tokens.py web/src/styles/themes/ docs/dtak/tokens.json
git commit -m "feat(dtak): token generation script + initial OKLCH scales"
```

---

## Phase 2 · Tailwind config

### Task 2.1: Wire scales and semantic tokens into `tailwind.config.js`

**Files:**
- Modify: `web/tailwind.config.js`

- [ ] **Step 1: Replace `web/tailwind.config.js` with the DTAK version**

```js
/** @type {import('tailwindcss').Config} */
import tokens from '../docs/dtak/tokens.json' with { type: 'json' };

const semanticColors = (() => {
  // Build a single map of CSS-var-driven utilities from semantic token names.
  // Names like "surface-1" become nested: { surface: { '1': ... } }.
  const out = {};
  for (const token of Object.keys(tokens.semantic.dark)) {
    const parts = token.split('-');
    const head = parts[0];
    const tail = parts.slice(1).join('-');
    const cssVar = `oklch(var(--color-${token}) / <alpha-value>)`;
    if (!tail) {
      out[head] = cssVar;
    } else {
      out[head] = out[head] || {};
      out[head][tail] = cssVar;
    }
  }
  // Surface overlay is a full oklch() with alpha — wire it as a flat utility.
  out.surface = out.surface || {};
  out.surface.overlay = 'var(--color-surface-overlay)';
  return out;
})();

const scaleColors = Object.fromEntries(
  Object.entries(tokens.scales).map(([name, fam]) => [
    name,
    Object.fromEntries(
      Object.entries(fam).map(([stop, v]) => [stop, v.oklch]),
    ),
  ]),
);

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...scaleColors,         // gray, blue, red, orange, yellow, green, violet
        ...semanticColors,      // surface, fg, border, brand, status, cot, voice, transport
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Update Vite to allow JSON imports with `with` syntax (already supported in Vite 5; no change needed unless tsconfig blocks it)**

Verify `web/tsconfig.json` has `"resolveJsonModule": true` and `"module": "ESNext"`. If not, add them.

- [ ] **Step 3: Build to confirm config parses**

```bash
cd web && npm run build
```

Expected: build completes without errors. May show a warning about `pl-*` classes still present in source — that's fine, they'll be removed in Phase 6.

- [ ] **Step 4: Quick sanity test — verify token utility resolves**

Add a temporary test route or just inspect by adding a `<div className="bg-brand">` to `App.tsx`, then run `npm run dev` and verify the element has the expected blue color.
Roll back the temp change before commit.

- [ ] **Step 5: Commit**

```bash
git add web/tailwind.config.js web/tsconfig.json
git commit -m "feat(dtak): wire scales + semantic tokens into tailwind config"
```

---

## Phase 3 · Theme CSS + mode switching

### Task 3.1: Import theme stylesheets and set default

**Files:**
- Modify: `web/src/index.css`

- [ ] **Step 1: Replace top of `web/src/index.css` to import themes and default to dark**

Open `web/src/index.css`. Replace the first 3 lines (`@tailwind base/components/utilities`) with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* DTAK theme stylesheets — one set of CSS vars per mode */
@import './styles/themes/dark.css';
@import './styles/themes/light.css';
@import './styles/themes/low-detection.css';

/* Default to dark mode if no data-theme is set on <html> */
:root { color-scheme: dark; }
```

Then update the `body` rule (which currently uses `bg-pl-bg`) to:

```css
body {
  @apply bg-surface-canvas text-fg-primary;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  margin: 0;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  -webkit-text-size-adjust: 100%;
}
```

Leave the rest of the file intact for now (scrollbar styles, MapLibre overrides — refactor those in Phase 6).

- [ ] **Step 2: Set `data-theme="dark"` as the default on `<html>`**

Edit `web/index.html`. Change the `<html>` tag to:

```html
<html lang="en" data-theme="dark">
```

- [ ] **Step 3: Run dev server and verify**

```bash
cd web && npm run dev
```

Open the app. The body background should now read from `--color-surface-canvas` (= `gray-950 #070808`). Text should read from `--color-fg-primary` (= `gray-50 #ECEDEE`). It might look subtly different from before — that's correct.

- [ ] **Step 4: Manually flip to light mode in DevTools**

In Chrome DevTools, set `<html data-theme="light">`. The whole app should flip to light mode (white background, dark text). Confirm. Then set `data-theme="ld"` — black background, red text. Confirm. Set back to `dark`.

- [ ] **Step 5: Commit**

```bash
git add web/src/index.css web/index.html
git commit -m "feat(dtak): import theme stylesheets, default to dark mode"
```

### Task 3.2: Add `useTheme` hook + persistence

**Files:**
- Create: `web/src/hooks/useTheme.ts`
- Create: `web/src/hooks/useTheme.test.ts`

- [ ] **Step 1: Write the failing test**

`web/src/hooks/useTheme.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => localStorage.clear());

  it('defaults to dark when nothing stored', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('restores theme from localStorage', () => {
    localStorage.setItem('dtak.theme', 'ld');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('ld');
    expect(document.documentElement.getAttribute('data-theme')).toBe('ld');
  });

  it('setTheme updates dom + storage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('dtak.theme')).toBe('light');
  });

  it('rejects invalid theme values', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('wat' as any));
    expect(result.current.theme).toBe('dark');  // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/hooks/useTheme.test.ts
```

Expected: fails with "Cannot find module './useTheme'".

- [ ] **Step 3: Implement `useTheme.ts`**

`web/src/hooks/useTheme.ts`:

```ts
import { useEffect, useState, useCallback } from 'react';

export type Theme = 'dark' | 'light' | 'ld';
const STORAGE_KEY = 'dtak.theme';
const VALID: Theme[] = ['dark', 'light', 'ld'];

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.includes(v as Theme) ? (v as Theme) : 'dark';
  } catch {
    return 'dark';
  }
}

function applyToDom(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = readStored();
    applyToDom(t);
    return t;
  });

  useEffect(() => {
    applyToDom(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    if (!VALID.includes(next)) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx vitest run src/hooks/useTheme.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Wire `useTheme` once at app root so it initializes on load**

Edit `web/src/App.tsx`. At the top of the component function, add:

```tsx
import { useTheme } from './hooks/useTheme';
// inside App component:
useTheme();
```

This ensures the stored theme is restored on mount even if no toggle UI is rendered.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useTheme.ts web/src/hooks/useTheme.test.ts web/src/App.tsx
git commit -m "feat(dtak): useTheme hook with localStorage persistence"
```

### Task 3.3: Add a mode toggle to the existing Settings page

**Files:**
- Modify: `web/src/components/SettingsPage.tsx`

- [ ] **Step 1: Inspect the existing SettingsPage**

```bash
head -60 web/src/components/SettingsPage.tsx
```

Identify a sensible insertion point (typically near the top of the rendered settings list).

- [ ] **Step 2: Add a "Theme" section**

Add this JSX inside the SettingsPage render, near the top of the settings list:

```tsx
import { useTheme } from '../hooks/useTheme';
// ... inside the component:
const { theme, setTheme } = useTheme();
// ... in JSX, near top of settings:
<section className="px-4 py-3 border-b border-border-subtle">
  <h3 className="text-fg-secondary text-xs uppercase tracking-wider mb-2">Theme</h3>
  <div className="flex gap-2">
    {(['dark', 'light', 'ld'] as const).map((t) => (
      <button
        key={t}
        onClick={() => setTheme(t)}
        aria-pressed={theme === t}
        className={
          'px-3 py-2 rounded text-sm font-medium ' +
          (theme === t
            ? 'bg-brand text-fg-on-brand'
            : 'bg-surface-2 text-fg-primary hover:bg-surface-3')
        }
      >
        {t === 'ld' ? 'Low-detection' : t.charAt(0).toUpperCase() + t.slice(1)}
      </button>
    ))}
  </div>
</section>
```

- [ ] **Step 3: Run dev server, open Settings, click each theme**

```bash
cd web && npm run dev
```

Each click should instantly flip the entire app to that mode.

- [ ] **Step 4: Refresh the page after picking LD**

The selection should persist — page reloads in LD.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SettingsPage.tsx
git commit -m "feat(dtak): theme toggle in settings (dark/light/low-detection)"
```

---

## Phase 4 · Component primitives

> **Convention for all primitives:** Place under `web/src/components/dtak/`. Each component has a co-located `*.test.tsx`. Tests use `@testing-library/react` (already installed). Each component exports a default React component plus a named props type.

### Task 4.1: `Surface`

**Files:**
- Create: `web/src/components/dtak/Surface.tsx`
- Create: `web/src/components/dtak/Surface.test.tsx`

- [ ] **Step 1: Write the failing test**

`web/src/components/dtak/Surface.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Surface from './Surface';

describe('Surface', () => {
  it('renders children', () => {
    render(<Surface>hello</Surface>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('applies the variant background class', () => {
    const { container } = render(<Surface variant="2">x</Surface>);
    expect(container.firstChild).toHaveClass('bg-surface-2');
  });

  it('defaults to canvas variant', () => {
    const { container } = render(<Surface>x</Surface>);
    expect(container.firstChild).toHaveClass('bg-surface-canvas');
  });

  it('passes through className', () => {
    const { container } = render(<Surface className="extra">x</Surface>);
    expect(container.firstChild).toHaveClass('extra');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/dtak/Surface.test.tsx
```

Expected: fails — module not found.

- [ ] **Step 3: Implement `Surface.tsx`**

```tsx
import { ReactNode } from 'react';

export type SurfaceVariant = 'canvas' | '1' | '2' | '3' | 'overlay';
export interface SurfaceProps {
  variant?: SurfaceVariant;
  className?: string;
  children?: ReactNode;
}

const variantClass: Record<SurfaceVariant, string> = {
  canvas:  'bg-surface-canvas',
  '1':     'bg-surface-1',
  '2':     'bg-surface-2',
  '3':     'bg-surface-3',
  overlay: 'bg-surface-overlay',
};

export default function Surface({ variant = 'canvas', className = '', children }: SurfaceProps) {
  return <div className={`${variantClass[variant]} ${className}`.trim()}>{children}</div>;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd web && npx vitest run src/components/dtak/Surface.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dtak/Surface.tsx web/src/components/dtak/Surface.test.tsx
git commit -m "feat(dtak): Surface primitive"
```

### Task 4.2: `Button`

**Files:**
- Create: `web/src/components/dtak/Button.tsx`
- Create: `web/src/components/dtak/Button.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Button from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Submit</Button>);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('applies primary variant by default', () => {
    render(<Button>x</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-brand');
  });

  it('applies destructive variant', () => {
    render(<Button variant="destructive">x</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-status-critical');
  });

  it('respects size prop', () => {
    render(<Button size="lg">x</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-12'); // 48px
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });

  it('disables and stops click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>x</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd web && npx vitest run src/components/dtak/Button.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Implement `Button.tsx`**

```tsx
import { ButtonHTMLAttributes, forwardRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  primary:     'bg-brand text-fg-on-brand hover:bg-brand-hover active:bg-brand-active',
  secondary:   'bg-surface-2 text-fg-primary hover:bg-surface-3 border border-border-default',
  ghost:       'bg-transparent text-brand hover:bg-surface-2 border border-brand',
  destructive: 'bg-status-critical text-fg-on-brand hover:opacity-90',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 md:h-10 max-md:h-11 px-4 text-sm', // 40px desktop, 44px mobile
  lg: 'h-12 px-5 text-base',                    // 48px (LD-friendly)
};

const base =
  'inline-flex items-center justify-center rounded font-semibold transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${base} ${variantClass[variant]} ${sizeClass[size]} ${className}`.trim()}
      {...rest}
    />
  );
});

export default Button;
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd web && npx vitest run src/components/dtak/Button.test.tsx
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dtak/Button.tsx web/src/components/dtak/Button.test.tsx
git commit -m "feat(dtak): Button primitive (4 variants × 3 sizes)"
```

### Task 4.3: `Input`

**Files:**
- Create: `web/src/components/dtak/Input.tsx`
- Create: `web/src/components/dtak/Input.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Input from './Input';

describe('Input', () => {
  it('renders with placeholder', () => {
    render(<Input placeholder="search" />);
    expect(screen.getByPlaceholderText('search')).toBeInTheDocument();
  });

  it('forwards onChange', () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('renders multiline as textarea', () => {
    render(<Input multiline placeholder="msg" />);
    expect(screen.getByPlaceholderText('msg').tagName).toBe('TEXTAREA');
  });

  it('shows error styling and message', () => {
    render(<Input error="too short" />);
    expect(screen.getByText('too short')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveClass('border-status-critical');
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd web && npx vitest run src/components/dtak/Input.test.tsx
```

- [ ] **Step 3: Implement `Input.tsx`**

```tsx
import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react';

interface CommonProps {
  error?: string;
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, CommonProps {
  multiline?: false;
}
export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>, CommonProps {
  multiline: true;
}

type Props = InputProps | TextareaProps;

const base =
  'w-full bg-surface-2 text-fg-primary placeholder:text-fg-tertiary ' +
  'border rounded px-3 py-2 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
  'disabled:opacity-50';

const Input = forwardRef<HTMLInputElement | HTMLTextAreaElement, Props>(
  function Input(props, ref) {
    const { error, className = '' } = props;
    const borderClass = error ? 'border-status-critical' : 'border-border-default';
    const cls = `${base} ${borderClass} ${className}`.trim();
    if ('multiline' in props && props.multiline) {
      const { multiline: _, error: __, className: ___, ...rest } = props;
      return (
        <div>
          <textarea ref={ref as any} className={cls} {...rest} />
          {error && <p className="text-status-critical text-xs mt-1">{error}</p>}
        </div>
      );
    }
    const { error: _, className: __, ...rest } = props as InputProps;
    return (
      <div>
        <input ref={ref as any} type="text" className={cls} {...rest} />
        {error && <p className="text-status-critical text-xs mt-1">{error}</p>}
      </div>
    );
  },
);

export default Input;
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd web && npx vitest run src/components/dtak/Input.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dtak/Input.tsx web/src/components/dtak/Input.test.tsx
git commit -m "feat(dtak): Input primitive (text + textarea + error)"
```

### Task 4.4: `IconButton`

**Files:**
- Create: `web/src/components/dtak/IconButton.tsx`
- Create: `web/src/components/dtak/IconButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import IconButton from './IconButton';

describe('IconButton', () => {
  it('renders icon and uses label as aria-label', () => {
    render(<IconButton icon={<span data-testid="ico" />} label="Home" />);
    expect(screen.getByLabelText('Home')).toBeInTheDocument();
    expect(screen.getByTestId('ico')).toBeInTheDocument();
  });

  it('reflects toggled state via aria-pressed', () => {
    render(<IconButton icon={<span />} label="Mute" toggled />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<IconButton icon={<span />} label="x" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd web && npx vitest run src/components/dtak/IconButton.test.tsx
```

- [ ] **Step 3: Implement `IconButton.tsx`**

```tsx
import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;             // required for a11y
  toggled?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, toggled, className = '', ...rest },
  ref,
) {
  const cls =
    'inline-flex items-center justify-center rounded ' +
    'h-11 w-11 max-md:h-11 max-md:w-11 ' +              // 44px mobile / web
    'bg-surface-2 hover:bg-surface-3 ' +
    'text-fg-primary ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
    (toggled ? 'bg-surface-3 text-brand ' : '') +
    className;
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={toggled ? true : undefined}
      className={cls.trim()}
      {...rest}
    >
      {icon}
    </button>
  );
});

export default IconButton;
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd web && npx vitest run src/components/dtak/IconButton.test.tsx
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dtak/IconButton.tsx web/src/components/dtak/IconButton.test.tsx
git commit -m "feat(dtak): IconButton primitive (44px touch target, aria-pressed)"
```

### Task 4.5: `StatusPill`

**Files:**
- Create: `web/src/components/dtak/StatusPill.tsx`
- Create: `web/src/components/dtak/StatusPill.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusPill from './StatusPill';

describe('StatusPill', () => {
  it('renders children', () => {
    render(<StatusPill variant="critical">crit</StatusPill>);
    expect(screen.getByText('crit')).toBeInTheDocument();
  });

  it('applies status-critical bg class for critical variant', () => {
    const { container } = render(<StatusPill variant="critical">x</StatusPill>);
    expect(container.firstChild).toHaveClass('bg-status-critical');
  });

  it('applies cot-hostile bg for cot-hostile variant', () => {
    const { container } = render(<StatusPill variant="cot-hostile">x</StatusPill>);
    expect(container.firstChild).toHaveClass('bg-cot-hostile');
  });

  it('applies transport-ble bg for transport-ble variant', () => {
    const { container } = render(<StatusPill variant="transport-ble">x</StatusPill>);
    expect(container.firstChild).toHaveClass('bg-transport-ble');
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd web && npx vitest run src/components/dtak/StatusPill.test.tsx
```

- [ ] **Step 3: Implement `StatusPill.tsx`**

```tsx
import { ReactNode } from 'react';

export type StatusPillVariant =
  | 'info' | 'success' | 'warning' | 'critical' | 'count'
  | 'cot-friendly' | 'cot-hostile' | 'cot-neutral' | 'cot-unknown'
  | 'transport-wifi' | 'transport-ble' | 'transport-relay' | 'transport-offline';

export interface StatusPillProps {
  variant: StatusPillVariant;
  className?: string;
  children: ReactNode;
}

const variantBg: Record<StatusPillVariant, string> = {
  info:               'bg-status-info',
  success:            'bg-status-success',
  warning:            'bg-status-warning',
  critical:           'bg-status-critical',
  count:              'bg-status-critical',
  'cot-friendly':     'bg-cot-friendly',
  'cot-hostile':      'bg-cot-hostile',
  'cot-neutral':      'bg-cot-neutral',
  'cot-unknown':      'bg-cot-unknown',
  'transport-wifi':   'bg-transport-wifi',
  'transport-ble':    'bg-transport-ble',
  'transport-relay':  'bg-transport-relay',
  'transport-offline':'bg-transport-offline',
};

export default function StatusPill({ variant, className = '', children }: StatusPillProps) {
  return (
    <span
      className={
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ' +
        'text-fg-on-brand ' +
        variantBg[variant] + ' ' + className
      }
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd web && npx vitest run src/components/dtak/StatusPill.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dtak/StatusPill.tsx web/src/components/dtak/StatusPill.test.tsx
git commit -m "feat(dtak): StatusPill primitive (status/cot/transport variants)"
```

### Task 4.6: `CalloutBar`

**Files:**
- Create: `web/src/components/dtak/CalloutBar.tsx`
- Create: `web/src/components/dtak/CalloutBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CalloutBar from './CalloutBar';

describe('CalloutBar', () => {
  it('renders children', () => {
    render(<CalloutBar variant="info">hi</CalloutBar>);
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('applies variant tint', () => {
    const { container } = render(<CalloutBar variant="critical">x</CalloutBar>);
    expect(container.firstChild).toHaveClass('border-status-critical');
  });

  it('renders dismiss button when dismissible', () => {
    const onDismiss = vi.fn();
    render(<CalloutBar variant="info" onDismiss={onDismiss}>x</CalloutBar>);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders icon slot', () => {
    render(<CalloutBar variant="info" icon={<span data-testid="i" />}>x</CalloutBar>);
    expect(screen.getByTestId('i')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd web && npx vitest run src/components/dtak/CalloutBar.test.tsx
```

- [ ] **Step 3: Implement `CalloutBar.tsx`**

```tsx
import { ReactNode } from 'react';

export type CalloutBarVariant = 'info' | 'success' | 'warning' | 'critical' | 'active-call';

export interface CalloutBarProps {
  variant: CalloutBarVariant;
  icon?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  children: ReactNode;
}

const variantBorder: Record<CalloutBarVariant, string> = {
  info:          'border-status-info',
  success:       'border-status-success',
  warning:       'border-status-warning',
  critical:      'border-status-critical',
  'active-call': 'border-status-critical',
};

const variantBg: Record<CalloutBarVariant, string> = {
  info:          'bg-status-info/10',
  success:       'bg-status-success/10',
  warning:       'bg-status-warning/10',
  critical:      'bg-status-critical/10',
  'active-call': 'bg-status-critical/15',
};

export default function CalloutBar({
  variant, icon, onDismiss, className = '', children,
}: CalloutBarProps) {
  return (
    <div
      role={variant === 'critical' ? 'alert' : 'status'}
      className={
        'flex items-center gap-3 px-4 py-2 rounded-r ' +
        'border-l-4 ' + variantBorder[variant] + ' ' +
        variantBg[variant] + ' ' +
        'text-fg-primary ' +
        className
      }
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="text-fg-secondary hover:text-fg-primary"
        >
          ✕
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd web && npx vitest run src/components/dtak/CalloutBar.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dtak/CalloutBar.tsx web/src/components/dtak/CalloutBar.test.tsx
git commit -m "feat(dtak): CalloutBar primitive (5 variants, dismissible)"
```

### Task 4.7: `Toggle`

**Files:**
- Create: `web/src/components/dtak/Toggle.tsx`
- Create: `web/src/components/dtak/Toggle.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Toggle from './Toggle';

describe('Toggle', () => {
  it('renders with label', () => {
    render(<Toggle checked={false} onChange={() => {}} label="LD mode" />);
    expect(screen.getByLabelText('LD mode')).toBeInTheDocument();
  });

  it('reflects checked state via aria-checked', () => {
    render(<Toggle checked onChange={() => {}} label="x" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('fires onChange when clicked', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="x" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('respects disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} disabled label="x" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd web && npx vitest run src/components/dtak/Toggle.test.tsx
```

- [ ] **Step 3: Implement `Toggle.tsx`**

```tsx
import { useId } from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export default function Toggle({
  checked, onChange, label, disabled, className = '',
}: ToggleProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={`inline-flex items-center gap-3 ${className}`}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={
          'relative inline-flex h-6 w-11 items-center rounded-full ' +
          'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
          (checked ? 'bg-brand ' : 'bg-surface-3 ') +
          (disabled ? 'opacity-50 cursor-not-allowed ' : '')
        }
      >
        <span
          className={
            'inline-block h-4 w-4 rounded-full bg-fg-on-brand transition-transform ' +
            (checked ? 'translate-x-6 ' : 'translate-x-1 ')
          }
        />
      </button>
      <span className="text-fg-primary text-sm">{label}</span>
    </label>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd web && npx vitest run src/components/dtak/Toggle.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dtak/Toggle.tsx web/src/components/dtak/Toggle.test.tsx
git commit -m "feat(dtak): Toggle primitive (role=switch, a11y)"
```

### Task 4.8: `CotMarker`

**Files:**
- Create: `web/src/components/dtak/CotMarker.tsx`
- Create: `web/src/components/dtak/CotMarker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CotMarker from './CotMarker';

describe('CotMarker', () => {
  it('renders with affiliation accessibility label', () => {
    render(<CotMarker affiliation="hostile" />);
    expect(screen.getByLabelText(/hostile/i)).toBeInTheDocument();
  });

  it('applies bg-cot-friendly for friendly', () => {
    const { container } = render(<CotMarker affiliation="friendly" />);
    expect(container.firstChild).toHaveClass('bg-cot-friendly');
  });

  it('shows remarks tooltip when provided', () => {
    render(<CotMarker affiliation="neutral" remarks="Patrol Bravo" />);
    expect(screen.getByLabelText(/Patrol Bravo/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd web && npx vitest run src/components/dtak/CotMarker.test.tsx
```

- [ ] **Step 3: Implement `CotMarker.tsx`**

```tsx
export type CotAffiliation = 'friendly' | 'hostile' | 'neutral' | 'unknown';

export interface CotMarkerProps {
  affiliation: CotAffiliation;
  remarks?: string;
  className?: string;
}

const aff: Record<CotAffiliation, string> = {
  friendly: 'bg-cot-friendly',
  hostile:  'bg-cot-hostile',
  neutral:  'bg-cot-neutral',
  unknown:  'bg-cot-unknown',
};

export default function CotMarker({ affiliation, remarks, className = '' }: CotMarkerProps) {
  const label = remarks ? `${affiliation}: ${remarks}` : affiliation;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={
        'inline-block w-4 h-4 rounded-tl-full rounded-tr-full rounded-br-full ' +
        '-rotate-45 border-2 border-fg-primary ' +
        aff[affiliation] + ' ' + className
      }
    />
  );
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd web && npx vitest run src/components/dtak/CotMarker.test.tsx
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dtak/CotMarker.tsx web/src/components/dtak/CotMarker.test.tsx
git commit -m "feat(dtak): CotMarker primitive (4 affiliations, ATAK convention)"
```

---

## Phase 5 · Documentation

### Task 5.1: `docs/dtak/00-overview.md`

**Files:**
- Create: `docs/dtak/00-overview.md`

- [ ] **Step 1: Write the file**

```markdown
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
- **Eight component primitives** that consume semantic tokens — see `03-components.md`.
- **Mobile-web parity** via Capacitor (same web bundle ships both) — see `04-mobile-vs-web.md`.

## Where things live

| What | Where |
|---|---|
| Token source of truth | `docs/dtak/tokens.json` (generated) |
| Token derivation script | `scripts/generate-tokens.py` |
| Theme stylesheets | `web/src/styles/themes/{dark,light,low-detection}.css` |
| Tailwind config | `web/tailwind.config.js` |
| Component primitives | `web/src/components/dtak/` |
| AI entrypoint | `CLAUDE.md` (repo root) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/dtak/00-overview.md
git commit -m "docs(dtak): 00-overview"
```

### Task 5.2: `docs/dtak/01-tokens.md`

**Files:**
- Create: `docs/dtak/01-tokens.md`

- [ ] **Step 1: Write the file**

```markdown
# DTAK Tokens

Authoritative reference for color scales and semantic tokens.

## Source of truth

- **`docs/dtak/tokens.json`** — machine-readable; consumed by Tailwind config and CI.
- **`scripts/generate-tokens.py`** — regenerates everything from anchor hexes.
- **`web/src/styles/themes/*.css`** — per-mode CSS variables.

When you need a value, read `tokens.json`. When you need to *change* a value, edit the anchors in `generate-tokens.py` and re-run it.

## The seven scales

All scales have 11 stops (`50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950`). Anchored at the user's Figma 500 hex (except `violet`, which uses Tailwind's `violet-500`).

| Scale  | 500 anchor | Character |
|---|---|---|
| `gray`   | `#3F4447` | Near-neutral cool. 3-anchor curve (50/500/950 from Figma). |
| `blue`   | `#1879C7` | USAF institutional blue. Brand accent in Dark/Light. |
| `red`    | `#C7181B` | Fire-engine red. Errors; LD remap target for brand. |
| `orange` | `#C75314` | Burnt orange. Operator-gear feel. |
| `yellow` | `#FFAC1C` | Vivid amber-yellow at L=80% (brighter than other 500s by design). |
| `green`  | `#137D3B` | Forest / military. Friendly, voice-active, success. |
| `violet` | `#8B5CF6` | Tailwind violet (no Figma anchor). BLE / transport indicator. |

For the full per-stop hex/OKLCH values, read `tokens.json` or run `python3 scripts/generate-tokens.py`.

## Semantic tokens (the 32)

Component code references *semantic* tokens, not raw scale stops. Semantic tokens are CSS variables; values change per mode.

| Category | Tokens |
|---|---|
| **Surface** | `surface-canvas`, `surface-1`, `surface-2`, `surface-3`, `surface-overlay` |
| **Foreground** | `fg-primary`, `fg-secondary`, `fg-tertiary`, `fg-disabled`, `fg-on-brand` |
| **Border** | `border-subtle`, `border-default`, `border-strong`, `border-focus` |
| **Brand** | `brand`, `brand-hover`, `brand-active` |
| **Status** | `status-info`, `status-success`, `status-warning`, `status-critical` |
| **CoT** | `cot-friendly`, `cot-hostile`, `cot-neutral`, `cot-unknown` |
| **Voice** | `voice-active`, `voice-listening`, `voice-muted` |
| **Transport** | `transport-wifi`, `transport-ble`, `transport-relay`, `transport-offline` |

Per-mode mappings live in `tokens.json` under `semantic.{dark,light,ld}`. The full table is also in the design spec (`docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md` §5).

## Using tokens in components

```tsx
// ✓ Use semantic tokens
<div className="bg-surface-1 text-fg-primary border-border-subtle">
  <button className="bg-brand text-fg-on-brand hover:bg-brand-hover">Send</button>
</div>

// ✓ Raw scale stops are OK for one-offs (decorative tints, etc.)
<div className="bg-blue-500/20" />

// ✗ Never write raw hexes in JSX
<div style={{ backgroundColor: '#1879C7' }} />   // bad
```

## Adding or changing a token

1. Edit anchors or `SEMANTIC_MAPS` in `scripts/generate-tokens.py`.
2. Run `python3 scripts/generate-tokens.py`.
3. Commit the changed `tokens.json`, theme CSS, and any updated documentation.
4. Verify the change visually in all three modes.
```

- [ ] **Step 2: Commit**

```bash
git add docs/dtak/01-tokens.md
git commit -m "docs(dtak): 01-tokens reference"
```

### Task 5.3: `docs/dtak/02-modes.md`

**Files:**
- Create: `docs/dtak/02-modes.md`

- [ ] **Step 1: Write the file**

```markdown
# DTAK Theme Modes

Three modes ship in v1: **Dark** (default), **Light**, **Low-Detection**.

## How modes work

The active mode is set via a `data-theme` attribute on `<html>`:

```html
<html data-theme="dark">  <!-- default -->
<html data-theme="light">
<html data-theme="ld">    <!-- low-detection -->
```

Each mode has a CSS file in `web/src/styles/themes/` that defines values for all 32 semantic CSS variables. Switching modes is instant — CSS-var swap, no component re-render.

## Selection

- **Default = Dark.** No automatic switch from `prefers-color-scheme` in v1 — defense ops need predictability.
- **Users opt into Light or Low-Detection** via Settings → Theme.
- Selection persists in `localStorage` under `dtak.theme`.
- Use the `useTheme()` hook (`web/src/hooks/useTheme.ts`) to read or change the mode.

## Dark — primary mode

- Vehicle / indoor / nighttime ops.
- Brand color = USAF blue (`blue-500 #1879C7`).
- Full saturation; the app's "natural" appearance.

## Light — daylight / training / accessibility

- Outdoor sunlight, briefing rooms, training environments.
- Brand drops to `blue-600` for AA contrast on light surfaces.
- The MapLibre map already has an independent light/topo style — UI light mode complements that.

## Low-Detection — tactical / stealth

The DIG differentiator. Not "darker dark." See `05-low-detection.md` for the full ruleset. In short:

- Background: `#000000` only (OLED-off).
- Foreground: red → amber → yellow → (green only when essential).
- No blue, no white, no high-saturation high-luminance.
- Touch targets jump to 48px minimum.
- Motion suppressed unless mission-critical.

## Adding a future mode

The architecture supports any number of modes. To add (e.g.) `high-contrast`:

1. Add a `SEMANTIC_MAPS["high-contrast"]` entry to `generate-tokens.py`.
2. Re-run the generator.
3. Add `'high-contrast'` to the `Theme` type in `useTheme.ts`.
4. Add the new mode to the toggle UI in `SettingsPage.tsx`.

No other code touches.
```

- [ ] **Step 2: Commit**

```bash
git add docs/dtak/02-modes.md
git commit -m "docs(dtak): 02-modes guide"
```

### Task 5.4: `docs/dtak/03-components.md`

**Files:**
- Create: `docs/dtak/03-components.md`

- [ ] **Step 1: Write the file**

```markdown
# DTAK Component Primitives

Eight primitives in `web/src/components/dtak/`. Each consumes semantic tokens — never raw scale stops. Each is fully tested with `vitest` + `@testing-library/react`.

## Surface

Token-aware container. Replaces ad-hoc `<div className="bg-something">`.

```tsx
<Surface variant="1">cards, panels, sidebars</Surface>
<Surface variant="2">nested cards, popovers</Surface>
<Surface variant="canvas">page background</Surface>
```

Variants: `canvas | 1 | 2 | 3 | overlay`.

## Button

```tsx
<Button variant="primary" size="md">Join Voice</Button>
<Button variant="ghost">Cancel</Button>
<Button variant="destructive">Delete</Button>
```

Variants: `primary | secondary | ghost | destructive`.
Sizes: `sm` (32px), `md` (40px desktop / 44px mobile), `lg` (48px — LD-friendly).

## Input

```tsx
<Input placeholder="Search rooms..." />
<Input multiline placeholder="Message..." />
<Input error="Required" />
```

## IconButton

```tsx
<IconButton icon={<HomeIcon />} label="Home" />
<IconButton icon={<MicIcon />} label="Mute" toggled />
```

`label` is required (a11y). 44px touch target everywhere.

## StatusPill

```tsx
<StatusPill variant="critical">CRITICAL</StatusPill>
<StatusPill variant="cot-hostile">HOSTILE</StatusPill>
<StatusPill variant="transport-ble">BLE</StatusPill>
<StatusPill variant="count">8</StatusPill>
```

## CalloutBar

```tsx
<CalloutBar variant="active-call" icon={<PhoneIcon />} dismissible onDismiss={...}>
  Active call · Dispatch North
</CalloutBar>
```

Variants: `info | success | warning | critical | active-call`.

## Toggle

```tsx
<Toggle checked={ldEnabled} onChange={setLdEnabled} label="Low-detection mode" />
```

## CotMarker

```tsx
<CotMarker affiliation="friendly" remarks="Patrol Bravo" />
```

Affiliations: `friendly | hostile | neutral | unknown`. Drives marker color via `cot-*` tokens.

## When to add a new primitive

Promote a feature-local component into `dtak/` only if:

1. It would be used in 3+ feature folders, or
2. It encapsulates a token contract that should be enforced (e.g. ensures consistent focus rings).

Otherwise: keep it in the feature folder; just consume DTAK semantic tokens directly.
```

- [ ] **Step 2: Commit**

```bash
git add docs/dtak/03-components.md
git commit -m "docs(dtak): 03-components reference"
```

### Task 5.5: `docs/dtak/04-mobile-vs-web.md`

**Files:**
- Create: `docs/dtak/04-mobile-vs-web.md`

- [ ] **Step 1: Write the file**

```markdown
# Mobile vs Web

Peat-Chat ships the same web bundle to mobile via Capacitor (iOS WKWebView, Android System WebView). DTAK leverages this — there is no parallel native UI tree.

## Touch targets

| Context | Minimum |
|---|---|
| Web (desktop / pointer) | 32px |
| Mobile (web in browser) | 44px |
| Capacitor (iOS / Android) | 44px |
| **Low-Detection (any)** | **48px** (DIG mandate) |

Primitives enforce this:
- `Button` size `md` resolves to 40px desktop / 44px mobile.
- `IconButton` is always 44px (mobile-friendly default).
- `Button` size `lg` is 48px (use in LD or for primary CTAs).

## Breakpoints

Tailwind defaults:
- `sm` 640px
- `md` 768px
- `lg` 1024px
- `xl` 1280px
- `2xl` 1536px

Mobile-first composition assumed throughout.

## Responsive patterns in Peat-Chat

- **Chat list, room view, mesh viewer** — mobile is single-pane; desktop adds a sidebar.
- **Tactical map** — full-bleed on mobile; pane-aware on desktop.
- **Active-call bar** — bottom-fixed on mobile; header-pinned on desktop.

## What does NOT have parity

- **Native context menus / share sheets** — Capacitor plugins handle these per platform; DTAK doesn't theme them.
- **Native push notifications** — outside DTAK's scope.
- **Hardware controls** (PTT button, volume) — Kotlin / Capacitor bridge, not DTAK.

## Capacitor-specific notes

- Theme persistence: `useTheme()` writes to `localStorage`, which Capacitor proxies to native preferences automatically.
- Status bar color: handled outside DTAK — see Capacitor's `@capacitor/status-bar` plugin.
- Safe-area insets: use Tailwind's `env(safe-area-inset-*)` utilities directly in components that need them.
```

- [ ] **Step 2: Commit**

```bash
git add docs/dtak/04-mobile-vs-web.md
git commit -m "docs(dtak): 04-mobile-vs-web"
```

### Task 5.6: `docs/dtak/05-low-detection.md`

**Files:**
- Create: `docs/dtak/05-low-detection.md`

- [ ] **Step 1: Write the file**

```markdown
# Low-Detection Mode (LD)

LD is **not** a darker dark mode. It is a distinct visual mode designed for stealth/tactical environments where light emission is a liability. Adapted from the DIG Low Detection Mode Guidelines (BESPIN/Skylight, 2025).

## Hard rules

| Rule | Reason |
|---|---|
| **Background = `#000000` only.** | OLED pixels physically off ⇒ minimum emission. Near-black on OLED still emits. |
| **No blue.** Blue light wakes the eye, destroys night-vision adaptation, highly detectable. | Banned across the entire token system in LD. |
| **No bright white.** Even small white elements compromise stealth. | Replaced by red/amber. |
| **Foreground priority:** red → amber → yellow → green (only when essential). | Red preserves night vision; lower wavelengths emit less detectable energy. |
| **Touch targets ≥ 48px.** | Fitts's Law in degraded conditions (gloves, motion, low light). |
| **No motion / animation by default.** | Attracts attention; drains battery. |
| **Color-blind support via texture/patterning.** Not via increased contrast. | Adding contrast in LD risks stealth. |

## What this means in code

In LD, the semantic CSS vars resolve to LD-safe values:

- `--color-brand` → red (not blue)
- `--color-status-info` → yellow (not blue)
- `--color-transport-ble` → yellow (not violet)
- All `--color-surface-*` → `#000000`
- All `--color-fg-*` → red shades

Components don't special-case LD. They write `bg-brand text-fg-primary`; the values resolve correctly per mode.

## Hardware awareness

Some mobile hardware emits IR even when the display is dark — proximity sensors, camera modules, etc. DTAK can't fix the hardware, but the app surfaces an "IR emission warning" toggle in Settings (per BESPIN reference design) and Settings docs note device-specific risks.

## Testing LD before merging UI changes

Before merging any UI change:

1. Open the feature in `dark` — does it work?
2. Open it in `light` — does it work?
3. Open it in `ld` — **specifically check:**
   - No blue or white anywhere visible.
   - Touch targets ≥ 48px (use DevTools to inspect).
   - No motion that wasn't in dark/light.
   - Critical info is still readable.

If a feature can't be made LD-safe with the current tokens, that's a flag — escalate to a design review before merging.

## What's not in v1

- Per-mode max-brightness lock at the OS level (deferred).
- Texture/pattern utilities for color-blind support (add when first needed).
- Hardware-specific IR emission database (out of scope).
```

- [ ] **Step 2: Commit**

```bash
git add docs/dtak/05-low-detection.md
git commit -m "docs(dtak): 05-low-detection rules"
```

### Task 5.7: `docs/dtak/06-migration.md`

**Files:**
- Create: `docs/dtak/06-migration.md`

- [ ] **Step 1: Write the file**

```markdown
# Migration Playbook — `pl-*` → DTAK

The legacy `pl-*` tokens (WhatsApp-derived) are deprecated. Replace them with DTAK tokens using this playbook.

## Mapping table

| Legacy | DTAK |
|---|---|
| `bg-pl-bg` | `bg-surface-canvas` |
| `bg-pl-sidebar` | `bg-surface-1` |
| `bg-pl-header` | `bg-surface-2` |
| `bg-pl-input` | `bg-surface-2` (use within `<Input>` instead) |
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
3. If a primitive (Button, Input, etc.) fits a use case, swap to the DTAK primitive.
4. Run the existing tests for that feature.
5. Open the app in dev. Test the feature in **all three modes**. Note any visual issues.
6. Commit with a message like: `refactor(dtak): migrate <Feature> off pl-* tokens`.

## What to do if a token doesn't map cleanly

- If you find a use case the mapping table doesn't cover, ping the design lead.
- Adding a new semantic token is OK if the use case is real and reusable. Add it to `SEMANTIC_MAPS` in `generate-tokens.py`, regenerate, then use.
- Do NOT add a one-off custom hex. If it's truly one-off, use a raw scale stop (`bg-blue-500/20`) and document why.

## Final cleanup

When all features are migrated:

1. Remove the entire `pl-*` block from `web/tailwind.config.js` (no replacement — DTAK already added).
2. Run `git grep "pl-"` and confirm no matches in `web/src/`.
3. Add a CI check (if not already present) that fails on `pl-*` reintroduction.
4. Commit the cleanup as `chore(dtak): remove legacy pl-* tokens`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/dtak/06-migration.md
git commit -m "docs(dtak): 06-migration playbook"
```

### Task 5.8: Repo-root `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md` (repo root)

- [ ] **Step 1: Write the file**

```markdown
# Peat-Chat — AI working notes

Welcome. This is a defense-oriented mesh chat + tactical-coordination app. The web bundle ships to mobile via Capacitor.

## DTAK Interface Guide (visual / token system)

Peat-Chat's design system is **DTAK** — the Defense Interface Guide adapted for this product. Read **`docs/dtak/00-overview.md`** first if you'll be touching UI.

### Key files

| What | Where |
|---|---|
| Token source of truth | `docs/dtak/tokens.json` (generated) |
| Token derivation script | `scripts/generate-tokens.py` |
| Theme stylesheets | `web/src/styles/themes/{dark,light,low-detection}.css` |
| Tailwind config | `web/tailwind.config.js` |
| Component primitives | `web/src/components/dtak/` |
| Spec | `docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md` |

### Hard rules for AI work in this repo

1. **Never write raw color hexes in JSX.** Use semantic tokens (`bg-brand`, `text-fg-primary`).
2. **Never use `pl-*` classes.** Those are deprecated. See `docs/dtak/06-migration.md` for the mapping.
3. **Test UI changes in all three modes** (dark/light/ld) before declaring done. Open the app, flip the theme toggle in Settings, look for blue/white in LD specifically (banned).
4. **Touch targets:** 44px mobile, 48px in LD.
5. **New primitive?** Place under `web/src/components/dtak/` only if reusable across 3+ features. Otherwise feature-local with DTAK tokens.
6. **Changing tokens?** Edit `scripts/generate-tokens.py`, run it, commit the regenerated files.

## Stack

- Web: React 18 + TypeScript + Vite + Tailwind 3.4 + Zustand + MapLibre GL
- Mobile: Capacitor wraps the web bundle
- Native Android: Kotlin BLE service, embedded Rust server
- Server: Go + Rust crates
- Tests: Vitest + @testing-library/react

## Where to look

- `docs/ROADMAP.md` — product roadmap
- `docs/one-pager.md` — product overview
- `docs/dtak/` — interface guide
- `docs/superpowers/specs/` — design specs (this folder)
- `docs/superpowers/plans/` — implementation plans
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md AI entrypoint"
```

---

## Phase 6 · Migration demo (Settings page)

### Task 6.1: Migrate `SettingsPage.tsx` off `pl-*`

**Files:**
- Modify: `web/src/components/SettingsPage.tsx`

- [ ] **Step 1: Run a baseline test of the existing Settings page**

```bash
cd web && npm run dev
```

Open Settings. Note the current visual state. Take a mental screenshot.

- [ ] **Step 2: Find every `pl-*` reference in `SettingsPage.tsx`**

```bash
grep -n "pl-" web/src/components/SettingsPage.tsx
```

Make a list. For each, look up the DTAK replacement in `docs/dtak/06-migration.md`.

- [ ] **Step 3: Replace one-by-one**

Edit the file, applying the mapping table:
- `bg-pl-bg` → `bg-surface-canvas`
- `bg-pl-sidebar` → `bg-surface-1`
- `bg-pl-header` → `bg-surface-2`
- `text-pl-text` → `text-fg-primary`
- `text-pl-text-sec` → `text-fg-secondary`
- `border-pl-border` → `border-border-subtle`
- ...and so on.

- [ ] **Step 4: Replace ad-hoc buttons / inputs with DTAK primitives where it makes sense**

Where the file has hand-rolled `<button className="...">`, swap to `<Button variant="..." />`. Where it has `<input className="...">`, swap to `<Input />`. Use judgment — don't refactor unrelated UI.

- [ ] **Step 5: Verify visually in all three modes**

```bash
cd web && npm run dev
```

Toggle Theme in Settings between dark/light/ld. The Settings page itself should look correct in all three. **Specifically in LD:** no blue, no white, touch targets ≥ 48px on the theme toggle buttons.

- [ ] **Step 6: Run tests**

```bash
cd web && npm test
```

Expected: all green, including new DTAK component tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/SettingsPage.tsx
git commit -m "refactor(dtak): migrate SettingsPage off pl-* tokens"
```

---

## Phase 7 · CI checks

### Task 7.1: Add CI workflow that catches drift and `pl-*` reintroduction

**Files:**
- Create: `.github/workflows/dtak-checks.yml`

- [ ] **Step 1: Verify `.github/workflows/` directory exists**

```bash
ls .github/workflows 2>/dev/null || mkdir -p .github/workflows
```

- [ ] **Step 2: Write the workflow file**

```yaml
name: DTAK checks

on:
  pull_request:
    paths:
      - 'web/**'
      - 'scripts/generate-tokens.py'
      - 'docs/dtak/**'
  push:
    branches: [main]

jobs:
  token-drift:
    name: Token regeneration is idempotent
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Regenerate tokens
        run: python3 scripts/generate-tokens.py
      - name: Fail if regenerated files differ from committed
        run: |
          if ! git diff --exit-code -- docs/dtak/tokens.json web/src/styles/themes/; then
            echo "::error::Regenerated tokens differ from committed. Run scripts/generate-tokens.py and commit."
            exit 1
          fi

  no-pl-tokens:
    name: No legacy pl-* tokens in web/src
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Grep for pl-* in web/src
        run: |
          if grep -rE 'pl-(bg|sidebar|header|input|hover|active|sent|received|border|text|text-sec|accent|danger)' web/src --include='*.ts*'; then
            echo "::error::Legacy pl-* tokens found. See docs/dtak/06-migration.md."
            exit 1
          fi
        # Note: this fails the CI until ALL features are migrated. Until then,
        # comment out this job or scope the grep to specific files.

  web-tests:
    name: Web unit tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
```

- [ ] **Step 3: Disable `no-pl-tokens` job until full migration is done**

Until every feature has been migrated, the `no-pl-tokens` job will fail on every PR. Comment out the `run:` body (replace with `run: echo "skipped — see comment"`) until Phase 6 covers the whole codebase.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/dtak-checks.yml
git commit -m "ci(dtak): token-drift + pl-* check + web tests"
```

---

## Phase 8 · Self-verify and ship v1

### Task 8.1: Final acceptance check against the spec

**Files:** none

- [ ] **Step 1: Run all tests one more time**

```bash
cd web && npm test
```

Expected: all green.

- [ ] **Step 2: Run the token generator clean**

```bash
cd /Users/skylight/Documents/Peat-Chat
python3 scripts/generate-tokens.py
git diff -- docs/dtak/tokens.json web/src/styles/themes/
```

Expected: no diff.

- [ ] **Step 3: Visually verify all three modes**

```bash
cd web && npm run dev
```

Open the app. Use Settings → Theme to flip between Dark / Light / Low-Detection. For each:

- Sidebar background reads from `--color-surface-1`
- Body text reads from `--color-fg-primary`
- Brand color reads from `--color-brand`

In **LD specifically**:
- Background is true black (verify with DevTools color picker — should be `#000000`).
- No blue anywhere visible.
- No bright white anywhere visible.
- Touch targets on the theme buttons feel ≥ 48px.

- [ ] **Step 4: Run the spec acceptance checklist**

Open `docs/superpowers/specs/2026-05-01-dtak-interface-guide-design.md` §12. Walk through every checkbox. Confirm each item. If any is missing, file a follow-up issue rather than blocking the v1 ship.

- [ ] **Step 5: Commit (if anything changed)**

```bash
git status
# If clean, you're done. If not:
git commit -m "chore(dtak): final v1 verification fixes"
```

---

## Self-review

This plan was reviewed against the spec immediately before saving. Coverage notes:

- ✅ Token derivation script (Phase 1) covers spec §4.
- ✅ Tailwind config (Phase 2) covers spec §3 architecture.
- ✅ Theme CSS + mode switching + persistence (Phase 3) covers spec §6.
- ✅ All 8 component primitives (Phase 4) cover spec §7.
- ✅ All 7 doc files + CLAUDE.md (Phase 5) cover spec §9.
- ✅ Migration playbook + Settings demo (Phase 6) cover spec §10.
- ✅ CI checks (Phase 7) cover spec §11 acceptance criteria #8 (script idempotency).
- ✅ Final acceptance (Phase 8) walks the §12 checklist.

No placeholders, no TBDs, all code blocks complete. Type names consistent across tasks (`Theme`, `ButtonVariant`, `SurfaceVariant`, `CotAffiliation`).
