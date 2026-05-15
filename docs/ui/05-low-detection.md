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
