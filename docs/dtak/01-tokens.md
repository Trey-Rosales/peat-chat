# DTAK Tokens

Authoritative reference for color scales and semantic tokens.

## Source of truth

- **`web/src/styles/tokens.json`** — machine-readable; consumed by Tailwind config and CI.
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

## Legacy `pl-*` shim

Until Phase 6 migration removes them, the legacy `pl-*` classes (e.g. `bg-pl-bg`, `text-pl-text`) are aliased in `tailwind.config.js` to DTAK semantic tokens. Existing components keep rendering correctly *and* are theme-reactive automatically. New code must NOT use `pl-*`. See `06-migration.md`.

## Adding or changing a token

1. Edit anchors or `SEMANTIC_MAPS` in `scripts/generate-tokens.py`.
2. Run `python3 scripts/generate-tokens.py`.
3. Commit the changed `tokens.json`, theme CSS, and any updated documentation.
4. Verify the change visually in all three modes.
