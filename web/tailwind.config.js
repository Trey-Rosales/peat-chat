/** @type {import('tailwindcss').Config} */
import tokens from './src/styles/tokens.json' with { type: 'json' };
import flowbitePlugin from 'flowbite-react/plugin/tailwindcss';

const semanticColors = (() => {
  // Build a single map of CSS-var-driven utilities from semantic token names.
  // Names like "surface-1" become nested: { surface: { '1': ... } }.
  // When a key is both a flat token (e.g. "brand") and a group prefix
  // (e.g. "brand-hover"), promote the flat value to DEFAULT so both
  // bg-brand and bg-brand-hover resolve correctly.
  const out = {};
  for (const token of Object.keys(tokens.semantic.dark)) {
    const parts = token.split('-');
    const head = parts[0];
    const tail = parts.slice(1).join('-');
    const cssVar = `oklch(var(--color-${token}) / <alpha-value>)`;
    if (!tail) {
      if (out[head] && typeof out[head] === 'object') {
        out[head]['DEFAULT'] = cssVar;
      } else {
        out[head] = cssVar;
      }
    } else {
      if (typeof out[head] === 'string') {
        out[head] = { DEFAULT: out[head] };
      } else {
        out[head] = out[head] || {};
      }
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

// Legacy pl-* compatibility shims. These map old token names to DTAK semantic
// tokens so existing components keep rendering correctly until the Phase 6
// migration replaces them. Theme-reactive (resolves through CSS vars).
// Remove this block after `git grep "pl-" web/src` returns no matches.
const legacyPlCompat = {
  'pl-bg':       'oklch(var(--color-surface-canvas) / <alpha-value>)',
  'pl-sidebar':  'oklch(var(--color-surface-1) / <alpha-value>)',
  'pl-header':   'oklch(var(--color-surface-2) / <alpha-value>)',
  'pl-input':    'oklch(var(--color-surface-2) / <alpha-value>)',
  'pl-hover':    'oklch(var(--color-surface-2) / <alpha-value>)',
  'pl-active':   'oklch(var(--color-surface-3) / <alpha-value>)',
  'pl-sent':     'oklch(var(--color-brand) / <alpha-value>)',
  'pl-received': 'oklch(var(--color-surface-2) / <alpha-value>)',
  'pl-border':   'oklch(var(--color-border-subtle) / <alpha-value>)',
  'pl-text':     'oklch(var(--color-fg-primary) / <alpha-value>)',
  'pl-text-sec': 'oklch(var(--color-fg-secondary) / <alpha-value>)',
  'pl-accent':   'oklch(var(--color-brand) / <alpha-value>)',
  'pl-danger':   'oklch(var(--color-status-critical) / <alpha-value>)',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...scaleColors,         // gray, blue, red, orange, yellow, green, violet
        ...semanticColors,      // surface, fg, border, brand, status, cot, voice, transport
        ...legacyPlCompat,      // pl-* shim — remove after Phase 6 migration
      },
    },
  },
  plugins: [flowbitePlugin],
};
