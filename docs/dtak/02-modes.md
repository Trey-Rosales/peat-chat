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
