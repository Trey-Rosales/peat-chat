/** @type {import('tailwindcss').Config} */
import tokens from './src/styles/tokens.json' with { type: 'json' };
import animate from 'tailwindcss-animate';

const semanticColors = (() => {
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

// Legacy pl-* compatibility shims. Remove after Phase 6 migration.
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

// shadcn vocabulary aliased to DTAK semantic tokens. shadcn components
// copied in from upstream consume these names; the alias layer routes them
// through CSS vars that resolve per-theme via [data-theme="..."].
const shadcnAliases = {
  background:  'oklch(var(--color-surface-canvas) / <alpha-value>)',
  foreground:  'oklch(var(--color-fg-primary) / <alpha-value>)',
  card: {
    DEFAULT:    'oklch(var(--color-surface-1) / <alpha-value>)',
    foreground: 'oklch(var(--color-fg-primary) / <alpha-value>)',
  },
  popover: {
    DEFAULT:    'oklch(var(--color-surface-2) / <alpha-value>)',
    foreground: 'oklch(var(--color-fg-primary) / <alpha-value>)',
  },
  primary: {
    DEFAULT:    'oklch(var(--color-brand) / <alpha-value>)',
    foreground: 'oklch(var(--color-fg-on-brand) / <alpha-value>)',
  },
  secondary: {
    DEFAULT:    'oklch(var(--color-surface-2) / <alpha-value>)',
    foreground: 'oklch(var(--color-fg-primary) / <alpha-value>)',
  },
  muted: {
    DEFAULT:    'oklch(var(--color-surface-2) / <alpha-value>)',
    foreground: 'oklch(var(--color-fg-tertiary) / <alpha-value>)',
  },
  accent: {
    DEFAULT:    'oklch(var(--color-surface-3) / <alpha-value>)',
    foreground: 'oklch(var(--color-fg-primary) / <alpha-value>)',
  },
  destructive: {
    DEFAULT:    'oklch(var(--color-status-critical) / <alpha-value>)',
    foreground: 'oklch(var(--color-fg-on-brand) / <alpha-value>)',
  },
};

const shadcnSingles = {
  'input':         'oklch(var(--color-border-default) / <alpha-value>)',
  'ring':          'oklch(var(--color-border-focus) / <alpha-value>)',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...scaleColors,
        ...semanticColors,
        ...legacyPlCompat,
        ...shadcnAliases,
        ...shadcnSingles,
        border: {
          ...(semanticColors.border || {}),
          DEFAULT: 'oklch(var(--color-border-default) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
      },
      minHeight: {
        touch: '44px',
      },
    },
  },
  plugins: [
    animate,
    function ({ addUtilities }) {
      addUtilities({
        '[data-theme="ld"] .min-h-touch': { minHeight: '48px' },
      });
    },
  ],
};
