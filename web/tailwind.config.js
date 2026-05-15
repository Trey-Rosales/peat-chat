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

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...scaleColors,
        ...semanticColors,
      },
    },
  },
  plugins: [flowbitePlugin],
};
