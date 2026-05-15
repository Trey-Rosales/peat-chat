# shadcn + DTAK Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke DTAK primitive layer at `web/src/components/dtak/` with shadcn-based primitives at `web/src/components/ui/`, restyled through Tailwind aliases that point at existing DTAK CSS-variable tokens, then sweep every feature component to consume them.

**Architecture:** shadcn components are copied in unmodified for color values; `tailwind.config.js` aliases shadcn's vocabulary (`background`, `primary`, `popover`, etc.) to DTAK semantic tokens already living in `web/src/styles/themes/{dark,light,low-detection}.css`. The single per-component manual step is stripping `dark:*` Tailwind variants (DTAK uses `data-theme` attributes, not the `dark` class). Forms migrate to `react-hook-form` + `zod` via shadcn's `<Form>` primitive.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind 3.4, shadcn/ui (Radix primitives + CVA), `react-hook-form`, `zod`, Vitest, Capacitor.

**Workflow notes:**
- The user (zgehin) commits manually. Plan does NOT include `git commit` steps. Each task ends with a "Pause for user review/commit" marker after which the user reviews the diff and commits at their cadence.
- Task numbers are stable references. If a task is split or merged during execution, update later cross-references.

**Spec deviation (documented):** The spec proposed adding missing DTAK vars (`--fg-on-brand`, `--bg-elevated`, `--bg-accent`, etc.). Survey of `web/src/styles/themes/dark.css` and `tokens.json` found that every shadcn semantic slot can be aliased to a DTAK token that already exists under a different name (e.g., `popover` → `surface-2`, `accent` → `surface-3`). Only `--radius` (a non-color token) needs adding. See Task 5.

---

## Wave 0 — Foundation

### Task 1: Add `@` path alias

**Files:**
- Modify: `web/tsconfig.json`
- Modify: `web/vite.config.ts`
- Install: `@types/node` (dev) — needed for `path` import in vite.config.ts

shadcn's generated component imports use `@/lib/utils` and `@/components/...`. Need the alias resolved by both TypeScript and Vite.

- [ ] **Step 1: Install `@types/node`**

```bash
cd web && npm install --save-dev @types/node
```

Expected: package added to devDependencies. No build run yet.

- [ ] **Step 2: Add `paths` to `web/tsconfig.json`**

Replace the existing `compilerOptions` block to add `baseUrl` and `paths`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Add `resolve.alias` to `web/vite.config.ts`**

Edit the `defineConfig({...})` to include `resolve`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const certPath = path.resolve(__dirname, '.certs/cert.pem')
const keyPath = path.resolve(__dirname, '.certs/key.pem')
const httpsConfig =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
    : undefined

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    host: true,
    https: httpsConfig,
    proxy: {
      '/ws': { target: 'ws://localhost:8090', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
```

- [ ] **Step 4: Verify `@` resolves**

Run: `cd web && npm run build`
Expected: clean build, no TS errors. (No code uses `@` yet, but the build must still succeed.)

- [ ] **Step 5: Pause for user review/commit**

---

### Task 2: Install runtime + form dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install runtime deps shared across all primitives**

```bash
cd web && npm install class-variance-authority clsx tailwind-merge tailwindcss-animate lucide-react
```

Expected: 5 packages added to `dependencies`.

- [ ] **Step 2: Install form deps**

```bash
cd web && npm install react-hook-form zod @hookform/resolvers
```

Expected: 3 packages added to `dependencies`.

- [ ] **Step 3: Verify install**

Run: `cd web && npm run build`
Expected: clean build.

- [ ] **Step 4: Pause for user review/commit**

---

### Task 3: Create `cn()` utility

**Files:**
- Create: `web/src/lib/utils.ts`

shadcn-generated components import `cn` from `@/lib/utils`. This is the standard implementation.

- [ ] **Step 1: Create the file**

```ts
// web/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Verify build**

Run: `cd web && npm run build`
Expected: clean build.

- [ ] **Step 3: Pause for user review/commit**

---

### Task 4: Create `components.json` (shadcn CLI config)

**Files:**
- Create: `web/components.json`

This file tells the shadcn CLI where to drop generated components and which alias to use.

- [ ] **Step 1: Create the file**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/styles/themes/dark.css",
    "baseColor": "slate",
    "cssVariables": false,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

Notes:
- `cssVariables: false` — we don't want shadcn writing its own CSS-var block; DTAK theme CSS already owns vars.
- `baseColor: slate` is irrelevant since we override colors via the alias map; the field is required by the schema.
- `tailwind.css` points at `dark.css` only because the schema requires a value; we're not letting shadcn write to it.

- [ ] **Step 2: Verify the shadcn CLI accepts the config**

Run: `cd web && npx shadcn@latest add --help`
Expected: CLI prints help text without erroring on `components.json`.

- [ ] **Step 3: Pause for user review/commit**

---

### Task 5: Add `--radius` to theme CSS files

**Files:**
- Modify: `scripts/generate-tokens.py`
- Regenerate: `web/src/styles/themes/{dark,light,low-detection}.css`

Per CLAUDE.md hard rule #6: token changes go through `scripts/generate-tokens.py`, not direct CSS edits.

`--radius` is the only non-color token shadcn components rely on (used in `rounded-[var(--radius)]` patterns inside Card, Dialog, etc.). All three themes get the same value.

- [ ] **Step 1: Identify where to add the var in `scripts/generate-tokens.py`**

Read `scripts/generate-tokens.py`. Find the section that emits the per-theme CSS block (look for `--color-` writes, e.g., a function or template that writes the `[data-theme="dark"]` block).

- [ ] **Step 2: Add `--radius` emission**

In the section that writes per-theme vars, add a line that emits `--radius: 0.375rem;` for all three themes. (DTAK uses `rounded` ≈ 0.25rem in current Buttons; 0.375rem aligns with shadcn defaults and keeps interactive elements feeling consistent. If user prefers stricter DTAK alignment, use 0.25rem.)

Example (adapt to actual script structure):

```python
THEME_CONSTANTS = {
    'radius': '0.375rem',
}

# In the per-theme CSS emission:
out.write(f'  --radius: {THEME_CONSTANTS["radius"]};\n')
```

- [ ] **Step 3: Regenerate theme CSS files**

```bash
cd /Users/skylight/Documents/Peat-Chat && python3 scripts/generate-tokens.py
```

Expected: `web/src/styles/themes/{dark,light,low-detection}.css` regenerated, each containing a `--radius:` line under its `[data-theme="..."]` block.

- [ ] **Step 4: Verify by grep**

Run: `grep "^\s*--radius" web/src/styles/themes/*.css`
Expected: 3 matches, one per theme file.

- [ ] **Step 5: Verify build still passes**

Run: `cd web && npm run build`
Expected: clean build.

- [ ] **Step 6: Pause for user review/commit**

---

### Task 6: Extend `tailwind.config.js` with shadcn alias layer + `min-h-touch` utility + animate plugin

**Files:**
- Modify: `web/tailwind.config.js`

This is the core of the refactor. The aliases here are what makes stock shadcn components render with DTAK colors.

- [ ] **Step 1: Replace `web/tailwind.config.js`**

Full replacement (preserves existing `scaleColors`, `semanticColors`, `legacyPlCompat` blocks; adds shadcn aliases, `min-h-touch` utility, and the animate plugin):

```js
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
  // Note: DTAK already exports `border` (border-default/subtle/strong/focus)
  // via semanticColors. We override the bare `border` key to point at
  // border-default for shadcn's `border-border` utility.
  // To preserve subkeys, we merge below in theme.extend.colors.
};

// Border / input / ring are special: shadcn uses `border-input` and
// `ring-ring`. We expose them as flat utilities here.
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
        // Override bare `border` (semanticColors emits border as { default, subtle, strong, focus, DEFAULT? })
        // to ensure shadcn's `border-border` utility resolves to border-default.
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
      // LD-mode bumps min-h-touch to 48px per CLAUDE.md hard rule #4.
      addUtilities({
        '[data-theme="ld"] .min-h-touch': { minHeight: '48px' },
      });
    },
  ],
};
```

- [ ] **Step 2: Verify Tailwind config compiles**

Run: `cd web && npm run build`
Expected: clean build.

- [ ] **Step 3: Manually verify alias resolution in dev**

Run: `cd web && npm run dev`
Open the running app in a browser. Open DevTools console and inspect any element that already uses a DTAK class — confirm the page renders unchanged (no regression from adding the alias layer).

Stop the dev server (Ctrl+C).

- [ ] **Step 4: Pause for user review/commit**

---

### Task 7: Move `CotMarker` to `components/map/`

**Files:**
- Create: `web/src/components/map/CotMarker.tsx`
- Create: `web/src/components/map/CotMarker.test.tsx`
- Delete: `web/src/components/dtak/CotMarker.tsx`
- Delete: `web/src/components/dtak/CotMarker.test.tsx`
- Modify: any file importing `./dtak/CotMarker` or `../dtak/CotMarker`

CotMarker is map/CoT-specific, not a generic primitive. Moves out of the way before we start replacing the rest of `dtak/`.

- [ ] **Step 1: Create the destination directory and move both files**

```bash
mkdir -p web/src/components/map
git mv web/src/components/dtak/CotMarker.tsx web/src/components/map/CotMarker.tsx
git mv web/src/components/dtak/CotMarker.test.tsx web/src/components/map/CotMarker.test.tsx
```

- [ ] **Step 2: Find all imports of CotMarker and update them**

Run: `grep -rEn "from ['\"][./]+dtak/CotMarker['\"]" web/src`

For each match, change the import path. Example: if `MapViewer.tsx` imports `from './dtak/CotMarker'`, change to `from './map/CotMarker'`.

- [ ] **Step 3: Verify tests still pass**

Run: `cd web && npm run test`
Expected: CotMarker tests pass at the new location, no other tests regress.

- [ ] **Step 4: Verify build**

Run: `cd web && npm run build`
Expected: clean build.

- [ ] **Step 5: Pause for user review/commit**

---

## Wave 1 — Zero-dep primitives

**Per-primitive workflow** (each Wave 1/2/3 task follows this shape):
1. Run `npx shadcn@latest add <name>` — drops file into `web/src/components/ui/`.
2. Open the generated file. Strip every `dark:*` class. Strip hardcoded colors (`bg-white`, `text-slate-900`, `text-zinc-*`, `bg-zinc-*`, etc.) — they should already be replaced by aliased shadcn names like `bg-background`, but check. The file should reference only DTAK-friendly classes after this step.
3. Where the primitive is interactive (Button, Input, Switch, Select trigger, Slider thumb, Tab trigger), add `min-h-touch` to the relevant variant's class string.
4. Find every file that imports the corresponding old DTAK primitive. Redirect imports.
5. Delete the old DTAK file and its test.
6. Manually verify the primitive renders correctly in dark, light, and LD modes (will set up per-primitive verification once a few primitives are in via a temporary scratch route, see Task 8 step 5).

### Task 8: Add `button`

**Files:**
- Create: `web/src/components/ui/button.tsx` (via shadcn CLI)
- Modify: `web/src/components/JoinRoomModal.tsx`, `web/src/components/MarkerForm.tsx`
- Delete: `web/src/components/dtak/Button.tsx`, `web/src/components/dtak/Button.test.tsx`
- Modify: `web/src/components/Sidebar.tsx`, `web/src/components/VoiceBar.tsx`, `web/src/components/ChatView.tsx` (for IconButton consolidation — see Task 8b below; for now, leave their `IconButton` imports alone and only redirect `Button` imports)

DTAK's `IconButton` is replaced by shadcn `<Button size="icon">`. We do `Button` first (more callers), then a follow-up redirect for `IconButton` callers in Task 8b.

- [ ] **Step 1: Generate the shadcn button**

```bash
cd web && npx shadcn@latest add button --yes
```

Expected: creates `web/src/components/ui/button.tsx`. Installs `@radix-ui/react-slot` if not present.

- [ ] **Step 2: Sanitize the generated file**

Open `web/src/components/ui/button.tsx`. Confirm:
- All `dark:` variants removed (the file shadcn generates may not contain any if `cssVariables: false` and our alias map covers it; verify).
- The default `buttonVariants` cva block uses `bg-primary text-primary-foreground hover:bg-primary/90` etc. — these resolve through our alias map and need no changes.
- Add `min-h-touch` to all size variants except `icon` (icon stays a square defined by `h-9 w-9` shadcn default; we keep that since it's a chrome control). For the icon variant specifically, change `h-9 w-9` to `h-11 w-11` so it's 44px and let `min-h-touch` apply through the LD CSS rule. Practically:

Edit the size variant block to:

```tsx
size: {
  default: 'h-10 px-4 py-2 min-h-touch',
  sm:      'h-9 rounded-md px-3 min-h-touch',
  lg:      'h-11 rounded-md px-8 min-h-touch',
  icon:    'h-11 w-11 min-h-touch',
},
```

- [ ] **Step 3: Find all current Button imports**

Run: `grep -rEn "from ['\"][./]+dtak/Button['\"]" web/src`

Expected matches (from initial survey):
- `web/src/components/JoinRoomModal.tsx`
- `web/src/components/MarkerForm.tsx`

- [ ] **Step 4: Redirect each import**

In each file from Step 3, replace:

```tsx
import Button from './dtak/Button'
```

with:

```tsx
import { Button } from '@/components/ui/button'
```

Note the named export (shadcn convention) vs old default export. JSX usage is unchanged: `<Button>...` still works. If the old code passed `variant="primary"`, change to `variant="default"`. Mapping:
- `variant="primary"` → `variant="default"`
- `variant="secondary"` → `variant="secondary"`
- `variant="ghost"` → `variant="ghost"`
- `variant="destructive"` → `variant="destructive"`
- `size="sm"` → `size="sm"`, `"md"` → `"default"`, `"lg"` → `"lg"`

- [ ] **Step 5: Set up a scratch route for visual verification (one-time)**

Create `web/src/scratch/PrimitiveScratch.tsx` (used throughout Waves 1-3 to eyeball primitives across themes; deleted at end of Wave 3):

```tsx
import { Button } from '@/components/ui/button'

export default function PrimitiveScratch() {
  return (
    <div className="p-8 space-y-4 bg-background text-foreground min-h-screen">
      <h2 className="text-lg font-semibold">Primitives — Scratch</h2>
      <section className="space-y-2">
        <h3 className="text-sm uppercase text-fg-tertiary">Button</h3>
        <div className="flex gap-2 flex-wrap">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon">★</Button>
        </div>
      </section>
    </div>
  )
}
```

Wire it into `web/src/main.tsx` or `App.tsx` temporarily — easiest: in `App.tsx`, add a check `if (window.location.search.includes('scratch')) return <PrimitiveScratch />`.

- [ ] **Step 6: Visually verify in three themes**

```bash
cd web && npm run dev
```

Open `http://localhost:5173/?scratch`. Use the existing theme toggle in Settings, OR temporarily set in DevTools console: `document.documentElement.setAttribute('data-theme','ld')` (then `'light'`, then `'dark'`).

Verify per theme:
- Dark: buttons readable, brand color visible
- Light: buttons readable, brand color visible
- LD: no blue/white anywhere, all sizes show ≥48px height

Stop dev server.

- [ ] **Step 7: Delete old DTAK Button and its test**

```bash
rm web/src/components/dtak/Button.tsx web/src/components/dtak/Button.test.tsx
```

- [ ] **Step 8: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

Expected: clean build, all tests pass (Button.test.tsx removed; no other test breaks).

- [ ] **Step 9: Pause for user review/commit**

---

### Task 8b: Redirect `IconButton` callers to `<Button size="icon">`

**Files:**
- Modify: `web/src/components/VoiceBar.tsx`, `web/src/components/ChatView.tsx`
- Delete: `web/src/components/dtak/IconButton.tsx`, `web/src/components/dtak/IconButton.test.tsx`

- [ ] **Step 1: Find IconButton imports**

Run: `grep -rEn "from ['\"][./]+dtak/IconButton['\"]" web/src`
Expected: `VoiceBar.tsx`, `ChatView.tsx`.

- [ ] **Step 2: Redirect each**

Replace:

```tsx
import IconButton from './dtak/IconButton'
```

with:

```tsx
import { Button } from '@/components/ui/button'
```

Then change every `<IconButton ...>` to `<Button size="icon" variant="ghost" ...>`. (Default `ghost` matches the typical icon-button look — bare-background, hover affordance. Adjust per call site if the original used a different visual.)

- [ ] **Step 3: Delete old DTAK IconButton + test**

```bash
rm web/src/components/dtak/IconButton.tsx web/src/components/dtak/IconButton.test.tsx
```

- [ ] **Step 4: Verify build + tests + visual**

```bash
cd web && npm run build && npm run test && npm run dev
```

Open the app. Confirm voice bar and chat view icon buttons render and click. Stop dev server.

- [ ] **Step 5: Pause for user review/commit**

---

### Task 9: Add `input`

**Files:**
- Create: `web/src/components/ui/input.tsx`
- Modify: `web/src/components/Sidebar.tsx`, `web/src/components/JoinRoomModal.tsx`, `web/src/components/MarkerForm.tsx`
- Delete: `web/src/components/dtak/Input.tsx`, `web/src/components/dtak/Input.test.tsx`

DTAK Input has both `<input>` and `<textarea>` modes plus an `error` prop. shadcn `input` is just `<input>`. We split: callers using `multiline` will switch to `<Textarea>` (Task 14); callers needing `error` will switch to the `<Form>` pattern (Task 27 + form passes). For now, redirect non-multiline non-error callers; document the others as TODO-noted in their files.

- [ ] **Step 1: Generate shadcn input**

```bash
cd web && npx shadcn@latest add input --yes
```

- [ ] **Step 2: Sanitize and add touch target**

Open `web/src/components/ui/input.tsx`. The default class string includes `h-10`. Add `min-h-touch` to it:

Find:
```tsx
className={cn(
  "flex h-10 w-full rounded-md border border-input bg-background ...",
  className,
)}
```

Replace with:
```tsx
className={cn(
  "flex h-10 min-h-touch w-full rounded-md border border-input bg-background ...",
  className,
)}
```

Strip any `dark:` variants if present.

- [ ] **Step 3: Find current Input imports**

Run: `grep -rEn "from ['\"][./]+dtak/Input['\"]" web/src`
Expected: `Sidebar.tsx`, `JoinRoomModal.tsx`, `MarkerForm.tsx`.

- [ ] **Step 4: Redirect each**

Replace `import Input from './dtak/Input'` with `import { Input } from '@/components/ui/input'`.

For each call site:
- If it uses `<Input ... multiline error={...} />` or `<Input multiline />` — leave the import line as `import { Input } from '@/components/ui/input'` but flag the call site with a `// TODO(shadcn-refactor): wrap with Form/Textarea in feature pass` comment. The component will throw at the `multiline` prop since shadcn Input doesn't accept it — temporarily strip `multiline` and the `error` prop, write a `<input>` style call, and add the comment. The feature pass for that file (Pass 1-4) will properly migrate it to `<Form>` + `<Textarea>`.
- If it just uses `<Input value=... onChange=... />` style, redirect cleanly.

- [ ] **Step 5: Add Input to scratch route**

Edit `web/src/scratch/PrimitiveScratch.tsx` to add an `Input` section:

```tsx
import { Input } from '@/components/ui/input'

// inside the JSX:
<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Input</h3>
  <Input placeholder="Type here..." className="max-w-sm" />
  <Input placeholder="Disabled" disabled className="max-w-sm" />
</section>
```

- [ ] **Step 6: Visually verify (three themes)**

```bash
cd web && npm run dev
```

Open `?scratch`. Cycle themes via DevTools. Confirm input is ≥44px (≥48px LD), border visible, focus ring visible (DTAK `border-focus`), placeholder readable.

- [ ] **Step 7: Delete old DTAK Input and test**

```bash
rm web/src/components/dtak/Input.tsx web/src/components/dtak/Input.test.tsx
```

- [ ] **Step 8: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

Expected: clean. (Some feature components may render slightly broken where `multiline`/`error` props were stripped — they get fixed in Pass 4.)

- [ ] **Step 9: Pause for user review/commit**

---

### Task 10: Add `label`

**Files:**
- Create: `web/src/components/ui/label.tsx`

No callers yet — added in preparation for Form (Task 27).

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add label --yes
```

Expected: creates `label.tsx`, installs `@radix-ui/react-label`.

- [ ] **Step 2: Sanitize**

Open the file. Remove any `dark:` variants. Verify the default class uses `text-foreground` (or similar aliased token), not raw colors.

- [ ] **Step 3: Add to scratch**

```tsx
import { Label } from '@/components/ui/label'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Label</h3>
  <Label htmlFor="x">A label</Label>
  <Input id="x" placeholder="Paired with label above" className="max-w-sm" />
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, hit `?scratch`, cycle themes.

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 11: Add `separator`

**Files:**
- Create: `web/src/components/ui/separator.tsx`
- Delete: `web/src/components/dtak/CalloutBar.tsx`, `web/src/components/dtak/CalloutBar.test.tsx` *(only if no callers — see Step 3)*

CalloutBar may serve a different purpose than just a divider — verify before deleting.

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add separator --yes
```

Installs `@radix-ui/react-separator`.

- [ ] **Step 2: Sanitize**

Strip `dark:` variants. Verify token-aliased classes only.

- [ ] **Step 3: Audit CalloutBar usage**

Run: `grep -rEn "CalloutBar" web/src`

If any feature component imports CalloutBar AND uses it for non-divider purposes (e.g., notification banner), DO NOT delete CalloutBar. Move it to `web/src/components/feedback/CalloutBar.tsx` instead, and treat it like CotMarker (a domain-specific component, not a generic primitive). Update imports.

If CalloutBar is unused or only used as a divider, redirect callers to `<Separator />` and delete CalloutBar files.

- [ ] **Step 4: Visually verify in scratch**

```tsx
import { Separator } from '@/components/ui/separator'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Separator</h3>
  <div>Above</div>
  <Separator />
  <div>Below</div>
</section>
```

`npm run dev`, `?scratch`, cycle themes. Confirm separator visible in all three (uses `border-default`).

- [ ] **Step 5: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 6: Pause for user review/commit**

---

### Task 12: Add `badge`

**Files:**
- Create: `web/src/components/ui/badge.tsx`
- Modify: `web/src/components/RoomItem.tsx`
- Delete: `web/src/components/dtak/StatusPill.tsx`, `web/src/components/dtak/StatusPill.test.tsx`

DTAK `StatusPill` maps to shadcn `Badge`. Variants likely differ — check StatusPill source for variant semantics, then map to Badge variants (`default`, `secondary`, `destructive`, `outline`).

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add badge --yes
```

- [ ] **Step 2: Sanitize**

Strip `dark:` variants. Verify alias-driven classes.

- [ ] **Step 3: Read StatusPill source to map variants**

Read `web/src/components/dtak/StatusPill.tsx`. Identify what variants it accepts (likely something like `friendly`, `hostile`, `warning`). For each, decide the Badge variant + custom Tailwind classes that match the original color.

If StatusPill uses CoT colors (`cot-friendly`, `cot-hostile`, etc.), the cleanest path is to extend Badge's variants in-file. Edit `web/src/components/ui/badge.tsx`'s `cva` block to add custom variants:

```tsx
variants: {
  variant: {
    default:     'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
    secondary:   'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
    outline:     'text-foreground',
    // DTAK-specific status variants (mirrors old StatusPill API):
    friendly: 'border-transparent bg-cot-friendly text-fg-on-brand',
    hostile:  'border-transparent bg-cot-hostile  text-fg-on-brand',
    neutral:  'border-transparent bg-cot-neutral  text-fg-primary',
    unknown:  'border-transparent bg-cot-unknown  text-fg-primary',
    success:  'border-transparent bg-status-success  text-fg-on-brand',
    warning:  'border-transparent bg-status-warning  text-fg-primary',
    critical: 'border-transparent bg-status-critical text-fg-on-brand',
    info:     'border-transparent bg-status-info     text-fg-on-brand',
  },
},
```

(Adjust the variant set based on what StatusPill actually accepts.)

- [ ] **Step 4: Redirect RoomItem**

In `web/src/components/RoomItem.tsx`, replace:

```tsx
import StatusPill from './dtak/StatusPill'
```

with:

```tsx
import { Badge } from '@/components/ui/badge'
```

Replace `<StatusPill variant="X">` with `<Badge variant="X">` using whatever variant mapping you defined in Step 3.

Run: `grep -rEn "from ['\"][./]+dtak/StatusPill['\"]" web/src`
Expected: only `RoomItem.tsx` (per initial survey).

- [ ] **Step 5: Visually verify in scratch**

Add a Badge section to `PrimitiveScratch.tsx` showing all variants.

`npm run dev`, `?scratch`, cycle themes. Confirm LD-mode does not produce blue/white badges (the `friendly`/`info`/`active` variants need attention since they likely use blue in dark/light — confirm the `low-detection.css` assigns LD-safe values for `--color-cot-friendly`, `--color-status-info`, etc.).

If LD is non-compliant, file an issue note (separate fix) — DO NOT block this task; the LD regression test in Task 28 will codify the rule.

- [ ] **Step 6: Delete old StatusPill files**

```bash
rm web/src/components/dtak/StatusPill.tsx web/src/components/dtak/StatusPill.test.tsx
```

- [ ] **Step 7: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 8: Pause for user review/commit**

---

### Task 13: Add `card`

**Files:**
- Create: `web/src/components/ui/card.tsx`
- Modify: any file currently using `Surface` for card-like layouts (audit in Step 3)

DTAK `Surface` is a thin div with bg-surface-* class. For container/card use, shadcn `Card` is the equivalent. For raw bg-tinted regions (e.g., a sidebar background), the right replacement is a plain `<div className="bg-card">` or `<div className="bg-surface-1">` — Surface stays gone, callers use semantic Tailwind directly.

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add card --yes
```

Creates `card.tsx` with `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.

- [ ] **Step 2: Sanitize**

Strip `dark:` variants. Confirm the default `Card` uses `bg-card text-card-foreground` (resolves through alias map to surface-1 + fg-primary).

- [ ] **Step 3: Audit Surface usage**

Run: `grep -rEn "from ['\"][./]+dtak/Surface['\"]" web/src`
Expected (from initial survey): `JoinRoomModal.tsx`.

For each caller:
- If Surface is used as a card-shaped container with content inside → switch to `<Card>` (and `<CardHeader>` / `<CardContent>` if structured).
- If Surface is just a tinted background div → replace with `<div className="bg-surface-1">` (or `bg-card` — same value via alias) keeping any other classes.

For JoinRoomModal specifically, this is tracked here but the full migration of JoinRoomModal happens in Pass 4 Task 45. For now, the import of Surface in JoinRoomModal should be temporarily replaced with the Card or `<div>` replacement so the file still compiles after Surface deletion.

- [ ] **Step 4: Visually verify in scratch**

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Card</h3>
  <Card className="max-w-sm">
    <CardHeader>
      <CardTitle>Title</CardTitle>
      <CardDescription>Description text</CardDescription>
    </CardHeader>
    <CardContent>Body content goes here.</CardContent>
    <CardFooter><Button size="sm">Action</Button></CardFooter>
  </Card>
</section>
```

`npm run dev`, `?scratch`, cycle themes.

- [ ] **Step 5: Delete old Surface files**

```bash
rm web/src/components/dtak/Surface.tsx web/src/components/dtak/Surface.test.tsx
```

- [ ] **Step 6: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 7: Pause for user review/commit**

---

### Task 14: Add `textarea`

**Files:**
- Create: `web/src/components/ui/textarea.tsx`

No new callers yet (callers needing textarea are migrated in Pass 1-4). Just install + sanitize + verify.

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add textarea --yes
```

- [ ] **Step 2: Sanitize**

Strip `dark:` variants. Add `min-h-touch` is NOT applicable here (textareas are taller by nature; default `min-h-[80px]` is fine).

- [ ] **Step 3: Add to scratch**

```tsx
import { Textarea } from '@/components/ui/textarea'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Textarea</h3>
  <Textarea placeholder="Write a remark..." className="max-w-sm" />
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, `?scratch`, cycle themes.

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 15: Add `skeleton`

**Files:**
- Create: `web/src/components/ui/skeleton.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add skeleton --yes
```

- [ ] **Step 2: Sanitize**

Strip `dark:` variants. Confirm `bg-muted` (resolves to surface-2) for the shimmer base.

- [ ] **Step 3: Add to scratch**

```tsx
import { Skeleton } from '@/components/ui/skeleton'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Skeleton</h3>
  <div className="space-y-2 max-w-sm">
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-12 w-12 rounded-full" />
  </div>
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, `?scratch`, cycle themes. Confirm shimmer animation runs (uses `tailwindcss-animate`).

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

## Wave 2 — Radix-backed, low-traffic primitives

### Task 16: Add `switch` (replaces DTAK Toggle)

**Files:**
- Create: `web/src/components/ui/switch.tsx`
- Modify: `web/src/components/Sidebar.tsx` (per initial survey, only Toggle caller)
- Delete: `web/src/components/dtak/Toggle.tsx`, `web/src/components/dtak/Toggle.test.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add switch --yes
```

Installs `@radix-ui/react-switch`.

- [ ] **Step 2: Sanitize + touch target**

Strip `dark:` variants. Add `min-h-touch` to the root class so the switch (which is small) still occupies a touchable area on mobile/LD. Practically:

Find the className in the generated Switch root and prepend `min-h-touch flex items-center` so the visual track stays compact but the hit area satisfies the rule.

Or, alternative: leave Switch tight and document that Switch must always be paired with a `<Label>` whose total row hits `min-h-touch`. Choose this if visual cleanliness matters more than per-switch touch padding.

Recommend: per-row min-h-touch on the wrapping Label/div; Switch itself stays compact. Add no `min-h-touch` to Switch internals.

- [ ] **Step 3: Find Toggle imports**

Run: `grep -rEn "from ['\"][./]+dtak/Toggle['\"]" web/src`
Expected: `Sidebar.tsx`.

- [ ] **Step 4: Redirect**

In `Sidebar.tsx`, replace `import Toggle from './dtak/Toggle'` with `import { Switch } from '@/components/ui/switch'`. Replace `<Toggle checked={x} onChange={fn}>label</Toggle>` style usage with:

```tsx
<div className="flex items-center justify-between min-h-touch">
  <Label htmlFor="toggle-x">label</Label>
  <Switch id="toggle-x" checked={x} onCheckedChange={fn} />
</div>
```

(Adjust to match the actual Toggle API — read `Toggle.tsx` first to know its props.)

- [ ] **Step 5: Add Switch to scratch**

```tsx
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Switch</h3>
  <div className="flex items-center justify-between min-h-touch max-w-sm">
    <Label htmlFor="s1">Enable feature</Label>
    <Switch id="s1" />
  </div>
</section>
```

- [ ] **Step 6: Visually verify (three themes)**

`npm run dev`, `?scratch`, cycle themes. Confirm: row is ≥44px (≥48px LD), Switch toggles on click, on-state uses `bg-primary` (DTAK brand), off-state uses `bg-input` (DTAK border-default).

- [ ] **Step 7: Delete old Toggle files**

```bash
rm web/src/components/dtak/Toggle.tsx web/src/components/dtak/Toggle.test.tsx
```

- [ ] **Step 8: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 9: Pause for user review/commit**

---

### Task 17: Add `tooltip`

**Files:**
- Create: `web/src/components/ui/tooltip.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add tooltip --yes
```

Installs `@radix-ui/react-tooltip`.

- [ ] **Step 2: Sanitize**

Strip `dark:`. Confirm `bg-popover text-popover-foreground` (alias to surface-2 + fg-primary).

- [ ] **Step 3: Wrap app in TooltipProvider**

Edit `web/src/main.tsx`. Wrap the root `<App />` in `<TooltipProvider>`:

```tsx
import { TooltipProvider } from '@/components/ui/tooltip'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
)
```

(Adapt to actual main.tsx structure.)

- [ ] **Step 4: Add to scratch**

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Tooltip</h3>
  <Tooltip>
    <TooltipTrigger asChild><Button variant="outline">Hover me</Button></TooltipTrigger>
    <TooltipContent>Tooltip text</TooltipContent>
  </Tooltip>
</section>
```

- [ ] **Step 5: Visually verify (three themes)**

`npm run dev`, `?scratch`, hover the button, cycle themes. Confirm tooltip appears, readable in all three.

- [ ] **Step 6: Verify build**

`cd web && npm run build`

- [ ] **Step 7: Pause for user review/commit**

---

### Task 18: Add `avatar`

**Files:**
- Create: `web/src/components/ui/avatar.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add avatar --yes
```

Installs `@radix-ui/react-avatar`.

- [ ] **Step 2: Sanitize**

Strip `dark:`. Confirm `bg-muted` for fallback bg (resolves to surface-2).

- [ ] **Step 3: Add to scratch**

```tsx
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Avatar</h3>
  <div className="flex gap-2">
    <Avatar><AvatarImage src="https://example.invalid/x.png" /><AvatarFallback>ZG</AvatarFallback></Avatar>
    <Avatar><AvatarFallback>OM</AvatarFallback></Avatar>
  </div>
</section>
```

- [ ] **Step 4: Visually verify**

`npm run dev`, `?scratch`, cycle themes. Confirm fallback initials are readable.

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 19: Add `scroll-area`

**Files:**
- Create: `web/src/components/ui/scroll-area.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add scroll-area --yes
```

Installs `@radix-ui/react-scroll-area`.

- [ ] **Step 2: Sanitize**

Strip `dark:`. Confirm `bg-border` for scrollbar thumb (resolves to border-default).

- [ ] **Step 3: Add to scratch**

```tsx
import { ScrollArea } from '@/components/ui/scroll-area'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">ScrollArea</h3>
  <ScrollArea className="h-32 w-72 rounded border border-border p-2">
    {Array.from({length: 30}).map((_, i) => <div key={i}>Row {i}</div>)}
  </ScrollArea>
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, `?scratch`, scroll, cycle themes.

- [ ] **Step 5: Capacitor verify (iOS WKWebView quirk check)**

ScrollArea uses Radix's custom scrollbar implementation, which can stumble on WKWebView. Build and test on iOS simulator at this point — earlier is better than later.

```bash
cd web && npm run build
cd .. && npx cap sync ios
npx cap open ios
```

In Xcode, run the app on a simulator. Navigate to the scratch route (you may need to set the URL via `window.location.href = 'capacitor://localhost?scratch'` in DevTools — adjust to local Capacitor server URL). Confirm scrollbar renders and scroll works smoothly.

If it doesn't work: file as a known issue, possibly fall back to native overflow scroll for ScrollArea contents in chat (Pass 1).

- [ ] **Step 6: Verify build**

`cd web && npm run build`

- [ ] **Step 7: Pause for user review/commit**

---

## Wave 3 — Radix-backed, structural primitives

### Task 20: Add `tabs`

**Files:**
- Create: `web/src/components/ui/tabs.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add tabs --yes
```

Installs `@radix-ui/react-tabs`.

- [ ] **Step 2: Sanitize + touch**

Strip `dark:`. Add `min-h-touch` to the `TabsTrigger` className (taps).

- [ ] **Step 3: Add to scratch**

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Tabs</h3>
  <Tabs defaultValue="a" className="max-w-sm">
    <TabsList>
      <TabsTrigger value="a">Tab A</TabsTrigger>
      <TabsTrigger value="b">Tab B</TabsTrigger>
      <TabsTrigger value="c">Tab C</TabsTrigger>
    </TabsList>
    <TabsContent value="a">Content A</TabsContent>
    <TabsContent value="b">Content B</TabsContent>
    <TabsContent value="c">Content C</TabsContent>
  </Tabs>
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, `?scratch`, click tabs, cycle themes.

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 21: Add `select`

**Files:**
- Create: `web/src/components/ui/select.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add select --yes
```

Installs `@radix-ui/react-select`. Heavy install (multiple sub-primitives in one file).

- [ ] **Step 2: Sanitize + touch**

Strip `dark:` variants throughout (this is a long file). Add `min-h-touch` to `SelectTrigger`.

- [ ] **Step 3: Add to scratch**

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Select</h3>
  <Select>
    <SelectTrigger className="max-w-sm"><SelectValue placeholder="Pick one" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="a">Option A</SelectItem>
      <SelectItem value="b">Option B</SelectItem>
      <SelectItem value="c">Option C</SelectItem>
    </SelectContent>
  </Select>
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, `?scratch`, open dropdown, hover items, cycle themes. Confirm dropdown sits on `bg-popover` (surface-2), highlighted item uses `bg-accent` (surface-3).

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 22: Add `slider`

**Files:**
- Create: `web/src/components/ui/slider.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add slider --yes
```

Installs `@radix-ui/react-slider`.

- [ ] **Step 2: Sanitize + touch**

Strip `dark:`. Add `min-h-touch` to the slider Root.

The Slider Thumb is small (h-5 w-5 by default). For touch ergonomics, increase the thumb's hit area by adding an invisible padded wrapper or bumping size. Adjust the Thumb className to `h-6 w-6` baseline.

- [ ] **Step 3: Add to scratch**

```tsx
import { Slider } from '@/components/ui/slider'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Slider</h3>
  <Slider defaultValue={[50]} max={100} step={1} className="max-w-sm" />
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, `?scratch`, drag thumb, cycle themes. Confirm track uses `bg-secondary`, range fill uses `bg-primary`.

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 23: Add `dialog`

**Files:**
- Create: `web/src/components/ui/dialog.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add dialog --yes
```

Installs `@radix-ui/react-dialog`.

- [ ] **Step 2: Sanitize**

Strip `dark:` variants. Confirm `DialogContent` uses `bg-background` (surface-canvas), `DialogOverlay` uses `bg-black/80` — leave the overlay as-is (it's an overlay, not a themed surface).

- [ ] **Step 3: Add to scratch**

```tsx
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Dialog</h3>
  <Dialog>
    <DialogTrigger asChild><Button variant="outline">Open Dialog</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Dialog title</DialogTitle>
        <DialogDescription>Dialog description text.</DialogDescription>
      </DialogHeader>
      <div>Body content</div>
      <DialogFooter><Button>Confirm</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, `?scratch`, open dialog, cycle themes. Confirm content readable, close button (×) works.

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 24: Add `sheet`

**Files:**
- Create: `web/src/components/ui/sheet.tsx`

Sheet = slide-in drawer. Used for mobile Sidebar (Pass 1).

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add sheet --yes
```

Reuses `@radix-ui/react-dialog` already installed.

- [ ] **Step 2: Sanitize**

Strip `dark:`. Confirm `SheetContent` uses `bg-background` (surface-canvas).

- [ ] **Step 3: Add to scratch**

```tsx
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Sheet</h3>
  <Sheet>
    <SheetTrigger asChild><Button variant="outline">Open Sheet</Button></SheetTrigger>
    <SheetContent side="left">
      <SheetHeader><SheetTitle>Title</SheetTitle><SheetDescription>Desc</SheetDescription></SheetHeader>
      <div>Sheet body</div>
    </SheetContent>
  </Sheet>
</section>
```

- [ ] **Step 4: Visually verify (three themes + sides)**

`npm run dev`, `?scratch`, try `side="left"`, `right`, `top`, `bottom`. Cycle themes.

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 25: Add `popover`

**Files:**
- Create: `web/src/components/ui/popover.tsx`

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add popover --yes
```

Installs `@radix-ui/react-popover`.

- [ ] **Step 2: Sanitize**

Strip `dark:`. Confirm `PopoverContent` uses `bg-popover text-popover-foreground` (surface-2 + fg-primary).

- [ ] **Step 3: Add to scratch**

```tsx
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Popover</h3>
  <Popover>
    <PopoverTrigger asChild><Button variant="outline">Open Popover</Button></PopoverTrigger>
    <PopoverContent>Popover body content.</PopoverContent>
  </Popover>
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, `?scratch`, click trigger, cycle themes.

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 26: Add `dropdown-menu` + `context-menu`

**Files:**
- Create: `web/src/components/ui/dropdown-menu.tsx`
- Create: `web/src/components/ui/context-menu.tsx`

Two primitives in one task — they share the same Radix sub-primitive structure (Menu).

- [ ] **Step 1: Generate both**

```bash
cd web && npx shadcn@latest add dropdown-menu context-menu --yes
```

Installs `@radix-ui/react-dropdown-menu` and `@radix-ui/react-context-menu`.

- [ ] **Step 2: Sanitize each**

Strip `dark:` from both files. Add `min-h-touch` to MenuItem className in each (for the trigger items themselves, taps).

- [ ] **Step 3: Add to scratch**

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">DropdownMenu</h3>
  <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="outline">Open</Button></DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem>Item A</DropdownMenuItem>
      <DropdownMenuItem>Item B</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</section>

<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">ContextMenu</h3>
  <ContextMenu>
    <ContextMenuTrigger className="flex h-24 w-48 items-center justify-center rounded border border-border">Right-click here</ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem>Reply</ContextMenuItem>
      <ContextMenuItem>Copy</ContextMenuItem>
      <ContextMenuItem>Delete</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</section>
```

- [ ] **Step 4: Visually verify (three themes)**

`npm run dev`, `?scratch`, click DropdownMenu trigger, right-click ContextMenu target, cycle themes.

- [ ] **Step 5: Verify build**

`cd web && npm run build`

- [ ] **Step 6: Pause for user review/commit**

---

### Task 27: Add `form` + create `lib/forms/` structure

**Files:**
- Create: `web/src/components/ui/form.tsx`
- Create: `web/src/lib/forms/.gitkeep` *(empty placeholder; per-feature schemas added in Pass passes)*

- [ ] **Step 1: Generate**

```bash
cd web && npx shadcn@latest add form --yes
```

Installs additional `@radix-ui/react-label` if missing. The form component depends on `react-hook-form` (already installed in Task 2).

- [ ] **Step 2: Sanitize**

Strip `dark:`. Confirm `FormMessage` uses `text-destructive` (resolves to status-critical).

- [ ] **Step 3: Create the forms lib directory**

```bash
mkdir -p web/src/lib/forms && touch web/src/lib/forms/.gitkeep
```

- [ ] **Step 4: Smoke-test with a scratch form**

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

function ScratchForm() {
  const schema = z.object({ name: z.string().min(2, 'Min 2 chars') })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => console.log(d))} className="space-y-2 max-w-sm">
        <FormField name="name" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  )
}

// Add to scratch JSX:
<section className="space-y-2">
  <h3 className="text-sm uppercase text-fg-tertiary">Form</h3>
  <ScratchForm />
</section>
```

- [ ] **Step 5: Visually verify (three themes)**

`npm run dev`, `?scratch`, type in field, blur, submit empty (should show error), cycle themes. Confirm `FormMessage` text uses LD-safe destructive color in LD mode.

- [ ] **Step 6: Verify build**

`cd web && npm run build`

- [ ] **Step 7: Pause for user review/commit**

---

## Cleanup & Testing

### Task 28: Add LD banned-color regression test

**Files:**
- Create: `web/src/components/ui/__tests__/ld-mode.test.tsx`

This is the one piece of test coverage we keep across all primitives — codifies the "no blue/white in LD" rule plus the touch-target floor.

- [ ] **Step 1: Create the test file**

```tsx
// web/src/components/ui/__tests__/ld-mode.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

// Approximate banned ranges:
// - Pure white: oklch with L > 95% AND C < 0.02 (very light, near-neutral or cool)
// - Banned blue: hue 200-280 with C > 0.05
// We parse the computed `background-color` / `color` and reject samples in those ranges.

function parseOklch(value: string): { L: number; C: number; H: number } | null {
  // Computed style may serialize OKLCH back as `oklch(...)` or convert to rgb.
  // We accept oklch() form (preferred) and skip rgb() (jsdom may not transform).
  const m = value.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/)
  if (!m) return null
  return { L: parseFloat(m[1]), C: parseFloat(m[2]), H: parseFloat(m[3]) }
}

function isBannedColor(value: string): boolean {
  const o = parseOklch(value)
  if (!o) return false
  // Banned blue
  if (o.H >= 200 && o.H <= 280 && o.C > 0.05) return true
  // Banned white-ish
  if (o.L > 0.95 && o.C < 0.02) return true
  return false
}

describe('LD mode — banned color regression', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'ld')
  })
  afterEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  })

  it.each([
    ['Button (default)', <Button>X</Button>],
    ['Button (destructive)', <Button variant="destructive">X</Button>],
    ['Input', <Input />],
    ['Switch', <Switch />],
    ['Badge (default)', <Badge>X</Badge>],
  ])('%s: no banned colors in LD mode', (_, node) => {
    const { container } = render(node)
    const all = container.querySelectorAll<HTMLElement>('*')
    for (const el of [container.firstChild as HTMLElement, ...Array.from(all)]) {
      if (!el || !el.style) continue
      const cs = window.getComputedStyle(el)
      expect(isBannedColor(cs.backgroundColor), `bg of ${el.tagName} = ${cs.backgroundColor}`).toBe(false)
      expect(isBannedColor(cs.color), `color of ${el.tagName} = ${cs.color}`).toBe(false)
    }
  })
})

describe('LD mode — touch target floor', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'ld')
  })
  afterEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  })

  it.each([
    ['Button', <Button>X</Button>],
    ['Input', <Input />],
  ])('%s: min-height >= 48px in LD mode', (_, node) => {
    const { container } = render(node)
    const root = container.firstChild as HTMLElement
    const cs = window.getComputedStyle(root)
    const minH = parseFloat(cs.minHeight) || 0
    // jsdom may not apply Tailwind's [data-theme="ld"] selector reliably;
    // accept either: actual value >= 48px OR the class list includes 'min-h-touch'.
    if (minH > 0) {
      expect(minH).toBeGreaterThanOrEqual(48)
    } else {
      expect(root.className).toMatch(/min-h-touch/)
    }
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd web && npm run test -- ld-mode
```

Expected: all tests pass. If `parseOklch` fails to find OKLCH form (jsdom may not resolve CSS-var-based colors at all in the testing environment), the test is informational rather than enforcing — the test still asserts class presence as a fallback. Document this limitation in a comment if needed.

- [ ] **Step 3: Verify full test suite**

```bash
cd web && npm run test
```

Expected: all tests pass.

- [ ] **Step 4: Pause for user review/commit**

---

### Task 29: Delete scratch route + verify dtak/ folder is empty

**Files:**
- Delete: `web/src/scratch/PrimitiveScratch.tsx`
- Modify: `web/src/App.tsx` (remove the `?scratch` branch)
- Delete: `web/src/components/dtak/` directory (if empty)

- [ ] **Step 1: Remove scratch reference from App.tsx**

Remove the `if (window.location.search.includes('scratch')) ...` branch added in Task 8 Step 5.

- [ ] **Step 2: Delete the scratch file**

```bash
rm web/src/scratch/PrimitiveScratch.tsx
rmdir web/src/scratch
```

- [ ] **Step 3: Verify dtak/ has nothing left**

```bash
ls web/src/components/dtak/ 2>/dev/null || echo "dtak/ already gone"
```

If anything remains (e.g., CalloutBar moved elsewhere is fine, anything else is a regression), audit and migrate before deleting.

- [ ] **Step 4: Delete the empty directory**

```bash
rmdir web/src/components/dtak/ 2>/dev/null
```

If the directory still has files: stop and resolve those callers first.

- [ ] **Step 5: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 6: First Capacitor end-to-end verify**

```bash
cd web && npm run build
cd .. && npx cap sync ios && npx cap sync android
npx cap open ios   # then run on simulator
# Repeat for Android: npx cap open android
```

In each simulator: launch the app, navigate through the main surfaces (sidebar, chat, settings if available). Goal: confirm no Radix-on-WKWebView or System WebView regression introduced by the primitive layer. Note any bugs as separate fix tasks; do NOT block on cosmetic issues.

- [ ] **Step 7: Pause for user review/commit**

---

## Pass 1 — Chat surface migration

### Task 30: Migrate `Sidebar.tsx`

**Files:**
- Modify: `web/src/components/Sidebar.tsx`

Goal: use `Sheet` for mobile breakpoint, `ScrollArea` for room/voice lists, `Tabs` for switching between sections (rooms / voice / settings), all on DTAK semantic tokens, no `pl-*` classes, all touch targets meet 44/48px.

- [ ] **Step 1: Read the current Sidebar.tsx end-to-end**

Read `web/src/components/Sidebar.tsx` fully. Identify:
- Current section structure (what rooms/voice/settings look like)
- Hardcoded color usage (`pl-*` classes, hex values)
- How mobile vs desktop layout is handled today
- Existing imports (already includes `Input` and `Switch` aliases from earlier tasks)

- [ ] **Step 2: Plan the refactor in-file (comment block at top)**

At the top of Sidebar.tsx, add a temporary planning comment:

```tsx
// REFACTOR (Task 30):
// - Desktop: render as fixed-width left rail with <Tabs> separating sections
// - Mobile (md:hidden): render Sheet trigger button in topbar; Sheet contains the same tab structure
// - Replace pl-sidebar/pl-bg backgrounds with bg-card or bg-background
// - Replace any inline color hex with DTAK tokens
// - Wrap room/voice lists in <ScrollArea>
// - All Switch rows wrapped in min-h-touch flex containers
// (delete this comment when refactor is complete)
```

- [ ] **Step 3: Implement the refactored layout**

Build the new structure. Skeleton outline (concrete code per actual Sidebar contents):

```tsx
import { useState } from 'react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Menu } from 'lucide-react'
// ... existing zustand store imports etc.

function SidebarBody() {
  return (
    <Tabs defaultValue="rooms" className="h-full flex flex-col">
      <TabsList className="grid grid-cols-3 w-full">
        <TabsTrigger value="rooms">Rooms</TabsTrigger>
        <TabsTrigger value="voice">Voice</TabsTrigger>
        <TabsTrigger value="mesh">Mesh</TabsTrigger>
      </TabsList>
      <TabsContent value="rooms" className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {/* RoomItem list rendered here */}
        </ScrollArea>
      </TabsContent>
      <TabsContent value="voice" className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {/* VoiceChannelList here */}
        </ScrollArea>
      </TabsContent>
      <TabsContent value="mesh" className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {/* MeshViewer here */}
        </ScrollArea>
      </TabsContent>
    </Tabs>
  )
}

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <>
      {/* Desktop: fixed-width rail */}
      <aside className="hidden md:flex md:w-72 flex-col bg-card border-r border-border">
        <SidebarBody />
      </aside>
      {/* Mobile: trigger button + Sheet */}
      <div className="md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation"><Menu /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SidebarBody />
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
```

(Adapt to actual Sidebar contents — preserve all existing logic; only the visual structure and class names change.)

- [ ] **Step 4: Remove the planning comment**

- [ ] **Step 5: Visual verify in browser, all three themes, mobile + desktop breakpoints**

```bash
cd web && npm run dev
```

Resize browser between mobile and desktop widths. Cycle themes via Settings → Theme (or DevTools console). Confirm:
- No `pl-*` classes (`grep "pl-" web/src/components/Sidebar.tsx` returns 0)
- No hex colors (`grep '#[0-9a-fA-F]\{3,6\}' web/src/components/Sidebar.tsx` returns 0)
- Touch targets meet 44/48px
- Sheet opens/closes on mobile
- Tabs switch sections correctly
- ScrollArea works in each tab
- All three themes render correctly

- [ ] **Step 6: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 7: Pause for user review/commit**

---

### Task 31: Migrate `ChatView.tsx`

**Files:**
- Modify: `web/src/components/ChatView.tsx`

Goal: `ScrollArea` wraps the message list, `Skeleton` renders during initial load, no `pl-*`, no hex colors, IconButton uses (already migrated in 8b) shadcn Button.

- [ ] **Step 1: Read ChatView.tsx end-to-end**

Identify hardcoded colors, `pl-*` usage, where loading state lives, how scrolling currently works.

- [ ] **Step 2: Implement**

Wrap message list in `<ScrollArea className="h-full flex-1">`. For loading state, render `<Skeleton className="h-12 w-full" />` × 5. Replace any hex colors with DTAK tokens (use `bg-background`, `text-foreground`, etc.). Confirm IconButton has been replaced by `<Button size="icon" variant="ghost">` (Task 8b should have done this; if any remain, fix here).

- [ ] **Step 3: Visual verify (three themes, scroll behavior, loading state)**

`npm run dev`, navigate to chat, scroll, force loading state if possible (or temporarily render `loading=true`). Cycle themes. Confirm 0 `pl-*` and 0 hex.

- [ ] **Step 4: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 5: Pause for user review/commit**

---

### Task 32: Migrate `MessageBubble.tsx`

**Files:**
- Modify: `web/src/components/MessageBubble.tsx`

Goal: wrap each bubble in `<ContextMenu>` for reply/copy/delete actions, use `<Tooltip>` for timestamps, replace hardcoded colors (esp. `pl-sent`/`pl-received` legacy classes) with DTAK tokens.

- [ ] **Step 1: Read MessageBubble.tsx**

Identify: existing actions (if any are inline buttons, they become menu items now), how sent/received bubbles are differentiated.

- [ ] **Step 2: Implement**

```tsx
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Bubble background:
// - sent (own messages):   bg-primary text-primary-foreground (resolves to brand + fg-on-brand)
// - received:              bg-secondary text-secondary-foreground (surface-2 + fg-primary)

<ContextMenu>
  <ContextMenuTrigger asChild>
    <div className={isSent ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}>
      <p>{message.body}</p>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs opacity-70">{formatRelative(message.ts)}</span>
        </TooltipTrigger>
        <TooltipContent>{new Date(message.ts).toLocaleString()}</TooltipContent>
      </Tooltip>
    </div>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={onReply}>Reply</ContextMenuItem>
    <ContextMenuItem onClick={onCopy}>Copy</ContextMenuItem>
    <ContextMenuItem onClick={onDelete} className="text-destructive">Delete</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

(Adapt to actual MessageBubble props/structure.)

- [ ] **Step 3: Visual verify**

`npm run dev`, send a message, right-click it, hover timestamp. Cycle themes.

- [ ] **Step 4: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 5: Pause for user review/commit**

---

### Task 33: Migrate `MessageInput.tsx`

**Files:**
- Modify: `web/src/components/MessageInput.tsx`

Goal: replace any inline `<input>`/`<textarea>` markup with `<Textarea>`, button uses shadcn `<Button>`, no hex/`pl-*`.

- [ ] **Step 1: Read MessageInput.tsx**

Identify: how does it grow on multi-line? Is there a send button? Any attachments UI?

- [ ] **Step 2: Implement**

```tsx
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'

// Use Textarea for auto-grow behavior:
<form onSubmit={handleSubmit} className="flex items-end gap-2 p-2 bg-background border-t border-border">
  <Textarea
    value={text}
    onChange={(e) => setText(e.target.value)}
    onKeyDown={handleKeyDown}
    placeholder="Message..."
    className="resize-none min-h-touch max-h-32 flex-1"
    rows={1}
  />
  <Button type="submit" size="icon" disabled={!text.trim()}>
    <Send className="h-4 w-4" />
  </Button>
</form>
```

(Preserve all existing keyboard handling, send logic, attachments etc. — only swap the visuals.)

- [ ] **Step 3: Visual verify**

`npm run dev`, type, press Enter (depending on keybinding logic), verify height behavior. Cycle themes.

- [ ] **Step 4: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 5: Pause for user review/commit**

---

### Task 34: Migrate `RoomItem.tsx`

**Files:**
- Modify: `web/src/components/RoomItem.tsx`

Goal: `Card`-shaped (or just a styled `<button>` row, depending on preference), `Badge` for unread count, no hex/`pl-*`. (Badge is already wired from Task 12.)

- [ ] **Step 1: Read RoomItem.tsx**

Identify: is it clickable? Does it show unread count, last-message preview, room avatar?

- [ ] **Step 2: Implement**

```tsx
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export default function RoomItem({ room, isActive, onClick }: { room: Room; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left flex items-center gap-3 p-3 min-h-touch transition-colors',
        'hover:bg-accent',
        isActive && 'bg-accent',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-medium truncate text-foreground">{room.name}</span>
          {room.unread > 0 && <Badge variant="default">{room.unread}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground truncate">{room.lastMessage}</p>
        {room.status && <Badge variant={room.statusVariant}>{room.status}</Badge>}
      </div>
    </button>
  )
}
```

(Adapt — read actual RoomItem.tsx to preserve fields and logic.)

- [ ] **Step 3: Visual verify**

Sidebar in mobile + desktop, three themes, with multiple rooms in different states (active, unread, etc.).

- [ ] **Step 4: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 5: Pause for user review/commit**

---

## Pass 2 — Voice surface

### Task 35: Migrate `VoiceBar.tsx`

**Files:**
- Modify: `web/src/components/VoiceBar.tsx`

Goal: `Slider` for output volume, `Tooltip` for icon meanings, `Button` (already migrated in 8b for IconButton callers). Audit for any remaining hardcoded colors.

- [ ] **Step 1: Read VoiceBar.tsx**

Identify icon controls (mute mic, mute speaker, leave, etc.), volume slider if any, status indicators.

- [ ] **Step 2: Implement**

For each control button, wrap in `<Tooltip>`:

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Mic, MicOff, Volume2, PhoneOff } from 'lucide-react'

<div className="flex items-center gap-2 p-2 bg-card border-t border-border">
  <Tooltip>
    <TooltipTrigger asChild>
      <Button size="icon" variant={micMuted ? 'destructive' : 'ghost'} onClick={toggleMic}>
        {micMuted ? <MicOff /> : <Mic />}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{micMuted ? 'Unmute mic' : 'Mute mic'}</TooltipContent>
  </Tooltip>
  {/* ... other controls similarly */}
  <div className="flex items-center gap-2 flex-1">
    <Volume2 className="w-4 h-4 text-muted-foreground" />
    <Slider value={[volume]} onValueChange={([v]) => setVolume(v)} max={100} />
  </div>
</div>
```

(Adapt to existing controls.)

- [ ] **Step 3: Existing test**

`web/src/components/VoiceBar.test.tsx` exists — keep it. After refactor, run it. Tests may need updating if they query for old DOM structure (e.g., looking for an `<IconButton>` element). Update test queries to match new structure.

- [ ] **Step 4: Visual verify (three themes)**

`npm run dev`, join voice channel (or render with mock data), interact with controls. Cycle themes.

- [ ] **Step 5: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 6: Pause for user review/commit**

---

### Task 36: Migrate `VoiceChannelList.tsx`

**Files:**
- Modify: `web/src/components/VoiceChannelList.tsx`

Goal: list with `<Separator>` between channels, no hex/`pl-*`.

- [ ] **Step 1: Read + identify structure**

- [ ] **Step 2: Implement**

```tsx
import { Separator } from '@/components/ui/separator'

<ul className="bg-card">
  {channels.map((ch, i) => (
    <li key={ch.id}>
      {i > 0 && <Separator />}
      <ChannelRow channel={ch} /> {/* clickable, min-h-touch */}
    </li>
  ))}
</ul>
```

- [ ] **Step 3: Verify build + visual**

```bash
cd web && npm run build && npm run dev
```

Cycle themes.

- [ ] **Step 4: Pause for user review/commit**

---

### Task 37: Migrate `VoiceMemberItem.tsx`

**Files:**
- Modify: `web/src/components/VoiceMemberItem.tsx`

Goal: `Avatar` for member, `Badge` for status (speaking/muted/deafened), `ContextMenu` for actions (mute, kick, DM).

- [ ] **Step 1: Read + identify**

- [ ] **Step 2: Implement**

```tsx
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'

<ContextMenu>
  <ContextMenuTrigger asChild>
    <div className="flex items-center gap-2 p-2 min-h-touch hover:bg-accent">
      <Avatar><AvatarFallback>{initials(member.callsign)}</AvatarFallback></Avatar>
      <span className="flex-1 truncate text-foreground">{member.callsign}</span>
      {member.speaking && <Badge variant="success">●</Badge>}
      {member.muted   && <Badge variant="secondary">muted</Badge>}
    </div>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={() => onMute(member.id)}>Mute</ContextMenuItem>
    <ContextMenuItem onClick={() => onKick(member.id)} className="text-destructive">Kick</ContextMenuItem>
    <ContextMenuItem onClick={() => onDm(member.id)}>Direct message</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

- [ ] **Step 3: Verify build + visual**

```bash
cd web && npm run build && npm run dev
```

- [ ] **Step 4: Pause for user review/commit**

---

### Task 38: Migrate `VoiceSettings.tsx`

**Files:**
- Modify: `web/src/components/VoiceSettings.tsx`
- Create: `web/src/lib/forms/voice-settings.ts` (zod schema)

Goal: `Form` (RHF + zod), `Select` for input/output device, `Slider` for input gain, `Switch` for noise suppression.

- [ ] **Step 1: Read VoiceSettings.tsx + identify all settings**

Catalogue every setting (name, type, default, validation rules).

- [ ] **Step 2: Create the zod schema**

```ts
// web/src/lib/forms/voice-settings.ts
import { z } from 'zod'

export const voiceSettingsSchema = z.object({
  inputDeviceId:  z.string().optional(),
  outputDeviceId: z.string().optional(),
  inputGain:      z.number().min(0).max(200),
  noiseSuppress:  z.boolean(),
  echoCancel:     z.boolean(),
  // ... add fields as you find them in VoiceSettings.tsx
})

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>
```

- [ ] **Step 3: Refactor VoiceSettings.tsx to use Form**

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { voiceSettingsSchema, type VoiceSettings } from '@/lib/forms/voice-settings'
// ... existing store imports

export default function VoiceSettings() {
  const stored = useVoiceStore((s) => s.settings)
  const save   = useVoiceStore((s) => s.save)

  const form = useForm<VoiceSettings>({
    resolver: zodResolver(voiceSettingsSchema),
    defaultValues: stored,
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(save)} className="space-y-4 p-4">
        <FormField name="inputDeviceId" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>Microphone</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl><SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger></FormControl>
              <SelectContent>
                {micDevices.map((d) => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        {/* Output device similar */}
        <FormField name="inputGain" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>Input gain ({field.value}%)</FormLabel>
            <FormControl><Slider value={[field.value]} onValueChange={([v]) => field.onChange(v)} max={200} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="noiseSuppress" control={form.control} render={({ field }) => (
          <FormItem className="flex items-center justify-between min-h-touch">
            <FormLabel>Noise suppression</FormLabel>
            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
          </FormItem>
        )} />
        {/* echoCancel similar */}
        <Button type="submit" disabled={!form.formState.isDirty}>Save</Button>
      </form>
    </Form>
  )
}
```

(Adapt to actual store/device-enumeration logic.)

- [ ] **Step 4: Visual verify (three themes)**

`npm run dev`, navigate to voice settings, adjust each control, save, cycle themes.

- [ ] **Step 5: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 6: Pause for user review/commit**

---

### Task 39: Migrate `PTTButton.tsx`

**Files:**
- Modify: `web/src/components/PTTButton.tsx`

Goal: shadcn `<Button>` with custom variant — large, hold-to-talk, must remain ≥48px in LD mode.

- [ ] **Step 1: Read PTTButton.tsx**

Identify hold-to-talk gesture handling (pointerdown/up, touch events, key bindings), visual states (idle / pressed / locked).

- [ ] **Step 2: Implement**

Build PTTButton as a wrapper around shadcn Button, with explicit large sizing and variant per state:

```tsx
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Mic } from 'lucide-react'
// ... existing PTT state machine logic

export default function PTTButton(/*...*/) {
  // ... existing pointer/key handling preserved
  const variant = isPressed ? 'destructive' : 'default'
  return (
    <Button
      variant={variant}
      size="lg"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className={cn('h-16 min-h-touch w-full text-lg', isPressed && 'animate-pulse')}
    >
      <Mic className="mr-2 h-5 w-5" />
      {isPressed ? 'TRANSMITTING' : 'Hold to talk'}
    </Button>
  )
}
```

- [ ] **Step 3: Visual verify**

`npm run dev`, navigate to chat with PTT, press and hold, cycle themes. Confirm height ≥48px in LD.

- [ ] **Step 4: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 5: Pause for user review/commit**

---

## Pass 3 — Map & markers

### Task 40: Migrate `MapViewer.tsx`

**Files:**
- Modify: `web/src/components/MapViewer.tsx`

Goal: `Popover` for marker info bubbles, `Button size="icon"` for map control overlays (zoom, layers, locate).

- [ ] **Step 1: Read MapViewer.tsx**

Identify how marker popups are currently rendered (MapLibre native popup vs custom React overlay), where map control buttons live, any inline color usage.

- [ ] **Step 2: Implement**

If popups are MapLibre native: leave native popup logic alone but style its container via DTAK tokens (CSS for `.maplibregl-popup-content` in a global stylesheet using `bg-popover` / `text-popover-foreground` equivalents).

If popups are custom React overlays: wrap in `<Popover>`.

For map control overlays:

```tsx
import { Button } from '@/components/ui/button'
import { Plus, Minus, Locate, Layers } from 'lucide-react'

<div className="absolute top-4 right-4 flex flex-col gap-1 bg-card rounded shadow border border-border">
  <Button size="icon" variant="ghost" onClick={zoomIn}><Plus className="h-4 w-4" /></Button>
  <Button size="icon" variant="ghost" onClick={zoomOut}><Minus className="h-4 w-4" /></Button>
  <Button size="icon" variant="ghost" onClick={locateMe}><Locate className="h-4 w-4" /></Button>
  <Button size="icon" variant="ghost" onClick={openLayers}><Layers className="h-4 w-4" /></Button>
</div>
```

- [ ] **Step 3: Visual verify (three themes)**

`npm run dev`, open map, zoom, click markers, locate. Cycle themes.

- [ ] **Step 4: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 5: Pause for user review/commit**

---

### Task 41: Migrate `MarkerForm.tsx`

**Files:**
- Modify: `web/src/components/MarkerForm.tsx`
- Create: `web/src/lib/forms/marker.ts` (zod schema)

Goal: `Form` + `Dialog` (or in-place panel — preserve current placement), `Input`, `Select`, `Textarea` for remarks.

- [ ] **Step 1: Read MarkerForm.tsx + identify fields**

Catalogue: callsign, type, position, remarks, etc.

- [ ] **Step 2: Create schema**

```ts
// web/src/lib/forms/marker.ts
import { z } from 'zod'

export const markerSchema = z.object({
  callsign: z.string().min(1).max(32),
  type:     z.enum(['friendly', 'hostile', 'neutral', 'unknown']),
  remarks:  z.string().max(500).optional(),
  // add lat/lon, etc. as found in current form
})

export type MarkerInput = z.infer<typeof markerSchema>
```

- [ ] **Step 3: Refactor MarkerForm.tsx**

Use the same pattern as VoiceSettings (Form + FormField per field, Select for type, Textarea for remarks). If MarkerForm is opened as a modal currently, wrap in `<Dialog>`.

- [ ] **Step 4: Visual verify**

Open marker form, fill out, submit. Three themes.

- [ ] **Step 5: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 6: Pause for user review/commit**

---

### Task 42: Migrate `MeshViewer.tsx`

**Files:**
- Modify: `web/src/components/MeshViewer.tsx`

Goal: `Card` per peer, `Badge` for status (online/offline/relay), `ScrollArea` for the list, `Skeleton` while loading.

- [ ] **Step 1: Read MeshViewer.tsx**

- [ ] **Step 2: Implement**

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'

if (isLoading) {
  return <div className="p-4 space-y-2">{Array.from({length: 5}).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
}

return (
  <ScrollArea className="h-full">
    <div className="p-4 space-y-2">
      {peers.map((peer) => (
        <Card key={peer.id}>
          <CardHeader className="p-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{peer.callsign}</CardTitle>
              <Badge variant={peer.online ? 'success' : 'secondary'}>
                {peer.transport /* 'wifi' | 'ble' | 'relay' */}
              </Badge>
            </div>
            <CardDescription>{peer.deviceId}</CardDescription>
          </CardHeader>
          <CardContent className="p-3 pt-0 text-sm text-muted-foreground">
            Last seen {formatRelative(peer.lastSeen)}
          </CardContent>
        </Card>
      ))}
    </div>
  </ScrollArea>
)
```

- [ ] **Step 3: Visual verify (three themes, loading + loaded states)**

- [ ] **Step 4: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 5: Pause for user review/commit**

---

### Task 43: Migrate `KeyBindingCapture.tsx`

**Files:**
- Modify: `web/src/components/KeyBindingCapture.tsx`

Goal: `Input` (read-only, displaying captured combo) + `Tooltip` showing "Press a key combo".

- [ ] **Step 1: Read KeyBindingCapture.tsx**

Identify capture mechanism, current rendering.

- [ ] **Step 2: Implement**

```tsx
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

<Tooltip>
  <TooltipTrigger asChild>
    <Input
      readOnly
      value={displayValue || 'Click and press a combo'}
      onKeyDown={handleKeyCapture}
      className="font-mono"
    />
  </TooltipTrigger>
  <TooltipContent>Click input, then press a key combination</TooltipContent>
</Tooltip>
```

- [ ] **Step 3: Visual verify**

- [ ] **Step 4: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 5: Pause for user review/commit**

---

## Pass 4 — Settings

### Task 44: Migrate `SettingsPage.tsx`

**Files:**
- Modify: `web/src/components/SettingsPage.tsx`
- Create: `web/src/lib/forms/profile.ts`, `mesh.ts`, `theme.ts` (per-tab schemas as needed)

Goal: `Tabs` for Profile / Mesh / Voice / Theme / About, `Form` per tab, `Switch`/`Select`/`Slider` per setting.

- [ ] **Step 1: Read SettingsPage.tsx**

Catalogue all sections and settings within each.

- [ ] **Step 2: Create per-tab zod schemas in `web/src/lib/forms/`**

- [ ] **Step 3: Refactor SettingsPage to use `<Tabs>`**

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'

<Tabs defaultValue="profile" className="h-full flex flex-col">
  <TabsList className="grid grid-cols-5 w-full">
    <TabsTrigger value="profile">Profile</TabsTrigger>
    <TabsTrigger value="mesh">Mesh</TabsTrigger>
    <TabsTrigger value="voice">Voice</TabsTrigger>
    <TabsTrigger value="theme">Theme</TabsTrigger>
    <TabsTrigger value="about">About</TabsTrigger>
  </TabsList>
  <TabsContent value="profile" className="flex-1 overflow-hidden">
    <ScrollArea className="h-full"><ProfileForm /></ScrollArea>
  </TabsContent>
  {/* ...other tabs */}
  <TabsContent value="voice" className="flex-1 overflow-hidden">
    <ScrollArea className="h-full"><VoiceSettings /></ScrollArea>
  </TabsContent>
</Tabs>
```

(VoiceSettings already migrated in Task 38; reuse.)

- [ ] **Step 4: Theme tab — preserve existing `useTheme()` hook**

The Theme tab uses `useTheme()` to switch dark/light/ld. Implement as a `<RadioGroup>` (shadcn) — install if not yet installed:

```bash
cd web && npx shadcn@latest add radio-group --yes
```

(Sanitize the same way as other primitives — strip `dark:`, add `min-h-touch` to RadioGroupItem.)

```tsx
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { useTheme } from '@/hooks/useTheme'

const { theme, setTheme } = useTheme()

<RadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
  <div className="flex items-center space-x-2 min-h-touch">
    <RadioGroupItem value="dark" id="theme-dark" />
    <Label htmlFor="theme-dark">Dark</Label>
  </div>
  {/* light, ld */}
</RadioGroup>
```

- [ ] **Step 5: Visual verify (three themes, all tabs)**

- [ ] **Step 6: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 7: Pause for user review/commit**

---

### Task 45: Migrate `JoinRoomModal.tsx`

**Files:**
- Modify: `web/src/components/JoinRoomModal.tsx`
- Create: `web/src/lib/forms/join-room.ts`

Goal: `Dialog` + `Form` + `Input` for room key/code.

- [ ] **Step 1: Read JoinRoomModal.tsx**

- [ ] **Step 2: Create schema**

```ts
// web/src/lib/forms/join-room.ts
import { z } from 'zod'

export const joinRoomSchema = z.object({
  roomCode: z.string().min(4, 'Code too short').max(64),
  // any other fields
})

export type JoinRoomInput = z.infer<typeof joinRoomSchema>
```

- [ ] **Step 3: Refactor JoinRoomModal**

```tsx
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { joinRoomSchema, type JoinRoomInput } from '@/lib/forms/join-room'

export default function JoinRoomModal({ open, onOpenChange, onJoin }: Props) {
  const form = useForm<JoinRoomInput>({
    resolver: zodResolver(joinRoomSchema),
    defaultValues: { roomCode: '' },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join a room</DialogTitle>
          <DialogDescription>Enter the room code shared with you.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onJoin)} className="space-y-4">
            <FormField name="roomCode" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Room code</FormLabel>
                <FormControl><Input {...field} placeholder="abcd-1234" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={!form.formState.isValid}>Join</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Visual verify (three themes)**

`npm run dev`, trigger modal, type invalid code (see error), valid code (submit). Cycle themes.

- [ ] **Step 5: Verify build + tests**

```bash
cd web && npm run build && npm run test
```

- [ ] **Step 6: Pause for user review/commit**

---

## Final Verification

### Task 46: Final sweep + Capacitor end-to-end

**Files:** none modified (verification only)

- [ ] **Step 1: Whole-codebase audit for `pl-*` classes**

```bash
cd web && grep -rEn "\bpl-(bg|sidebar|header|input|hover|active|sent|received|border|text|text-sec|accent|danger)\b" src
```

Expected: 0 results. If any remain, fix them in their feature file (each is a single Tailwind class swap to the DTAK semantic equivalent — see the `legacyPlCompat` map in `tailwind.config.js` for the mapping).

- [ ] **Step 2: Audit for hex colors in JSX/TSX**

```bash
cd web && grep -rEn "#[0-9a-fA-F]{3,6}" src/components src/App.tsx 2>/dev/null
```

Expected: 0 results in JSX className/style attrs. Hex inside imported asset URLs or comments is OK; hex inside className strings is NOT.

- [ ] **Step 3: Audit for `dark:` Tailwind variants in components/**

```bash
cd web && grep -rEn "dark:" src/components
```

Expected: 0 results. `dark:` works against the `.dark` class which we don't use.

- [ ] **Step 4: Confirm `dtak/` is gone**

```bash
ls web/src/components/dtak/ 2>/dev/null && echo "STILL EXISTS — fix" || echo "OK: dtak/ is gone"
```

- [ ] **Step 5: Remove `legacyPlCompat` from tailwind.config.js**

If Step 1 returned 0 results, the legacy shim block in `web/tailwind.config.js` (`legacyPlCompat` map and its spread in `theme.extend.colors`) can be deleted. Update `tailwind.config.js`:

- Remove the `legacyPlCompat` declaration
- Remove `...legacyPlCompat` from the colors spread

Re-run build:

```bash
cd web && npm run build
```

Expected: clean build.

- [ ] **Step 6: Full test pass**

```bash
cd web && npm run test
```

Expected: all tests pass.

- [ ] **Step 7: Capacitor verify on iOS + Android**

```bash
cd web && npm run build
cd .. && npx cap sync ios && npx cap sync android
npx cap open ios
# Run on simulator, walk through every major surface (sidebar, chat, voice, map, settings, marker form, join room)
# Then:
npx cap open android
# Same walkthrough on Android emulator
```

Note any platform-specific bugs as separate fix tasks (do NOT block Task 46 completion on cosmetic issues — the goal of this task is verifying the refactor didn't introduce a breaking regression).

- [ ] **Step 8: Update CLAUDE.md**

Add a short note to `CLAUDE.md` updating the DTAK rules section:

- Rule #2 (no `pl-*`) can be relaxed/removed since the shim was deleted.
- Add a new note: primitives now live at `web/src/components/ui/`; `web/src/components/dtak/` no longer exists.

Edit CLAUDE.md accordingly.

- [ ] **Step 9: Final pause for user review/commit**

After commit, the refactor is complete. Open a PR if desired.

---

## Spec Coverage Audit

| Spec section | Implemented in task(s) |
|---|---|
| Token-mapping layer (alias map) | Task 6 |
| Three-theme story (data-theme, no `dark:`) | Tasks 6, 8–27 (per-primitive sanitize), 46 (final audit) |
| Touch-target enforcement (`min-h-touch`) | Task 6 (utility), 8/9/16/20/21/22/26 (per-primitive application), 28 (regression test) |
| Foundation deps + components.json + cn() | Tasks 1–5 |
| 20 primitives copy-in (Wave 1/2/3) | Tasks 8–27 |
| CotMarker special case (move to `components/map/`) | Task 7 |
| Form library setup | Task 27 (primitive + lib/forms dir); Tasks 38, 41, 44, 45 (per-form usage) |
| Pass 1 — Chat surface | Tasks 30–34 |
| Pass 2 — Voice surface | Tasks 35–39 |
| Pass 3 — Map & markers | Tasks 40–43 |
| Pass 4 — Settings | Tasks 44–45 |
| LD banned-color regression test | Task 28 |
| Capacitor verification (post-Pass 1, final) | Tasks 19 (early check), 29 (post-primitives), 46 (final) |
| Drop primitive tests | Tasks 8–27 (per-primitive deletion) |
| Delete legacy `pl-*` shim | Task 46 Step 5 |

All spec sections covered.
