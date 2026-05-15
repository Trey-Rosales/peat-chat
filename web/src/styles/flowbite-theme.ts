import { createTheme } from 'flowbite-react';

// All class strings here use DTAK semantic tokens that resolve to
// CSS variables via tailwind.config.js. Never put raw color names
// (blue, white, gray-700) in this file — they bypass the theme
// system and break low-detection mode.
//
// Touch targets: the size variants (md=44px on mobile via max-md:h-11,
// lg=48px) handle DTAK rule 4. When useTheme() returns 'ld', consumers
// should opt into the larger `lg` variant explicitly — there is no
// automatic LD upgrade at this layer.
//
// Add new component slots incrementally as each Task N adds a wrapper.
export const flowbiteTheme = createTheme({
  button: {
    base:
      'inline-flex items-center justify-center rounded font-semibold transition-colors ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
      'disabled:opacity-50 disabled:pointer-events-none',
    color: {
      primary: 'bg-brand text-fg-on-brand hover:bg-brand-hover active:bg-brand-active',
      secondary: 'bg-surface-2 text-fg-primary hover:bg-surface-3 border border-border-default',
      ghost: 'bg-transparent text-brand hover:bg-surface-2 border border-brand',
      destructive: 'bg-status-critical text-fg-on-brand hover:opacity-90',
    },
    size: {
      sm: 'h-8 px-3 text-sm',
      md: 'h-10 max-md:h-11 px-4 text-sm',
      lg: 'h-12 px-5 text-base',
      icon: 'h-11 w-11',
    },
  },
  textInput: {
    field: {
      input: {
        base:
          'w-full bg-surface-2 text-fg-primary placeholder:text-fg-tertiary ' +
          'rounded px-3 py-2 ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
          'disabled:opacity-50',
      },
    },
  },
  toggleSwitch: {
    toggle: {
      // after:bg-fg-on-brand suppresses default `after:bg-white` (banned in LD mode)
      base: 'rounded-full transition-colors after:bg-fg-on-brand',
      checked: {
        on: 'bg-brand',
        off: 'bg-surface-3',
      },
    },
  },
  badge: {
    root: {
      base: 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold text-fg-on-brand',
    },
  },
  alert: {
    base: 'flex items-center gap-3 px-4 py-2 rounded-r border-l-4 text-fg-primary',
  },
  select: {
    field: {
      select: {
        base:
          'block w-full appearance-none rounded-lg bg-arrow-down-icon bg-[length:0.75em_0.75em] ' +
          'bg-[position:right_12px_center] bg-no-repeat pr-10 ' +
          'bg-surface-2 text-fg-primary border border-border-default ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
          'disabled:cursor-not-allowed disabled:opacity-50',
        sizes: {
          sm: 'p-2 text-xs',
          md: 'p-2.5 text-sm',
          lg: 'p-4 text-base',
        },
        colors: {
          gray: '',
        },
      },
    },
  },
  rangeSlider: {
    field: {
      input: {
        base: 'w-full cursor-pointer appearance-none rounded-lg bg-surface-3 accent-brand',
      },
    },
  },
});

export type FlowbiteThemeShape = typeof flowbiteTheme;
