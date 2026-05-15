# Flowbite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **User preference:** Do NOT run `git commit` or `git add`. After each task's verification passes, stop and tell the user the task is ready to commit, including a suggested commit message. The user stages and commits themselves.

**Goal:** Replace the bespoke DTAK primitive library with `flowbite-react`-backed wrappers in `web/src/components/ui/`, preserving three-mode theming (dark/light/ld) and DTAK hard rules (no raw hex, defined touch targets, no blue/white in LD).

**Architecture:** Hybrid theming — CSS variables in `web/src/styles/themes/*.css` continue driving colors via `<html data-theme>`. A new `web/src/styles/flowbite-theme.ts` exports a flowbite-react theme object that maps Flowbite class slots to our Tailwind semantic classes (which themselves resolve to CSS variables). One `/ui/` wrapper per primitive keeps the existing prop surface so the 6 feature consumers only need their import path updated.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 3.4 + `flowbite-react` (new) + Vitest.

**Spec:** `docs/superpowers/specs/2026-05-15-flowbite-migration-design.md`

---

## Task 1: Install flowbite-react and wire the Tailwind plugin

**Files:**
- Modify: `web/package.json`
- Modify: `web/tailwind.config.js`
- Modify: `web/src/main.tsx`

- [ ] **Step 1: Install flowbite-react**

Run from repo root:

```bash
cd web && npm install flowbite-react
```

Expected: `flowbite-react` added to `dependencies` in `web/package.json`. `tailwind-merge` and any peer deps installed automatically.

- [ ] **Step 2: Wire the Flowbite Tailwind plugin (flowbite-react v0.12 API)**

Edit `web/tailwind.config.js`. At the top of the file, after the existing `import tokens from './src/styles/tokens.json' with { type: 'json' };`, add:

```js
import flowbitePlugin from 'flowbite-react/plugin/tailwindcss';
```

Add `flowbitePlugin` to the `plugins` array. **Do not** add anything to the `content` array — flowbite-react v0.12's plugin manages its own content scan via the `flowbite-react/plugin/tailwindcss` subpath. The final export should be:

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...scaleColors,
        ...semanticColors,
        ...legacyPlCompat,
      },
    },
  },
  plugins: [flowbitePlugin],
};
```

Leave the `semanticColors`, `scaleColors`, and `legacyPlCompat` blocks above the `export default` exactly as they are.

- [ ] **Step 3: Import Flowbite styles before theme variables in `main.tsx`**

Edit `web/src/main.tsx`. The current file imports `./index.css` after `App`. Replace the imports section to ensure Flowbite's base styles load before our theme overrides — flowbite-react ships an optional CSS file at `flowbite-react/dist/index.css` only in some versions; if your installed version exposes it as a side-effect of importing components, skip this and proceed (the next step will reveal whether a flash occurs).

Current `web/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

Confirm this file is unchanged after this step — actual `ThemeProvider` wrapping happens in Task 2 so we don't ship a half-configured provider.

- [ ] **Step 4: Verify the build still passes**

Run:

```bash
cd web && npm run build
```

Expected: `tsc -b && vite build` completes with no errors. Bundle output is unchanged (we haven't imported any flowbite-react component yet).

- [ ] **Step 5: Verify tests still pass**

Run:

```bash
cd web && npm test
```

Expected: all existing Vitest tests green.

- [ ] **Step 6: Stop for user commit**

Files staged for review: `web/package.json`, `web/package-lock.json`, `web/tailwind.config.js`.

Suggested commit message:

```
chore: install flowbite-react and wire Tailwind plugin

Preparation for the DTAK → Flowbite migration. No components
adopt flowbite-react yet; bundle is unchanged.
```

Tell the user: "Task 1 complete and ready to commit."

---

## Task 2: Add the flowbite-react theme object and ThemeProvider

**Files:**
- Create: `web/src/styles/flowbite-theme.ts`
- Modify: `web/src/main.tsx`

- [ ] **Step 1: Write the LD-mode smoke test scaffold first (it will pass trivially with zero primitives)**

Create `web/src/test/ld-mode-compliance.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ThemeProvider } from 'flowbite-react';
import { flowbiteTheme } from '../styles/flowbite-theme';

const BANNED_CLASS_PATTERNS = [
  /(^|\s)bg-blue(-\d+)?(\s|$)/,
  /(^|\s)bg-white(\s|$)/,
  /(^|\s)text-blue(-\d+)?(\s|$)/,
  /(^|\s)text-white(\s|$)/,
];

const BANNED_INLINE_STYLES = [
  /#fff(\s|;|$)/i,
  /#ffffff(\s|;|$)/i,
  /rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/i,
];

function findBannedNode(root: HTMLElement): { kind: string; value: string } | null {
  const all = root.querySelectorAll('*');
  for (const el of Array.from(all)) {
    const classAttr = el.getAttribute('class') ?? '';
    for (const re of BANNED_CLASS_PATTERNS) {
      if (re.test(classAttr)) return { kind: 'class', value: classAttr };
    }
    const styleAttr = el.getAttribute('style') ?? '';
    for (const re of BANNED_INLINE_STYLES) {
      if (re.test(styleAttr)) return { kind: 'style', value: styleAttr };
    }
  }
  return null;
}

export function renderInLd(node: React.ReactNode) {
  document.documentElement.setAttribute('data-theme', 'ld');
  return render(<ThemeProvider theme={flowbiteTheme}>{node}</ThemeProvider>);
}

export function assertNoBannedTokens(container: HTMLElement) {
  const hit = findBannedNode(container);
  if (hit) {
    throw new Error(`LD-banned ${hit.kind} found: "${hit.value}"`);
  }
}

describe('LD-mode compliance', () => {
  it('scaffold renders nothing without primitives', () => {
    const { container } = renderInLd(<div />);
    assertNoBannedTokens(container);
    cleanup();
  });
});
```

This file's helpers (`renderInLd`, `assertNoBannedTokens`) are reused by later tasks to verify each primitive in isolation.

- [ ] **Step 2: Run the scaffold test to verify it fails (theme file doesn't exist yet)**

Run:

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: FAIL with `Cannot find module '../styles/flowbite-theme'`.

- [ ] **Step 3: Create the flowbite-react theme file**

Create `web/src/styles/flowbite-theme.ts`:

```ts
import { createTheme } from 'flowbite-react';

// All class strings here use DTAK semantic tokens that resolve to
// CSS variables via tailwind.config.js. Never put raw color names
// (blue, white, gray-700) in this file — they bypass the theme
// system and break low-detection mode.
//
// Touch targets: min-h-touch (44px) for default modes, the LD
// variant in useTheme()-aware code bumps to min-h-touch-ld (48px).
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
      md: 'h-10 md:h-10 max-md:h-11 px-4 text-sm',
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
      base: 'rounded-full transition-colors',
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
});

export type FlowbiteThemeShape = typeof flowbiteTheme;
```

Note: `createTheme` accepts a partial theme. Any slot not overridden falls back to flowbite-react defaults — which is fine *as long as* the component itself is never used without a wrapper that scopes it to DTAK tokens.

- [ ] **Step 4: Wrap the app in ThemeProvider**

Modify `web/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'flowbite-react'
import App from './App'
import { flowbiteTheme } from './styles/flowbite-theme'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={flowbiteTheme}>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
```

- [ ] **Step 5: Run the scaffold test, verify it passes**

Run:

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: PASS — scaffold renders an empty `<div>` under `<ThemeProvider>` with no banned tokens.

- [ ] **Step 6: Run full test suite and build**

Run:

```bash
cd web && npm test && npm run build
```

Expected: all green.

- [ ] **Step 7: Manual three-mode dev check**

Run:

```bash
cd web && npm run dev
```

Open the app. Open Settings → Theme and cycle dark → light → ld. Verify the app still renders correctly in all three (DTAK primitives are still in use; ThemeProvider just wraps without changing anything yet).

- [ ] **Step 8: Stop for user commit**

Files for user to commit: `web/src/styles/flowbite-theme.ts`, `web/src/test/ld-mode-compliance.test.tsx`, `web/src/main.tsx`.

Suggested commit message:

```
feat: add flowbite-react theme object and LD-mode smoke test scaffold

Adds <ThemeProvider> at the app root with DTAK-tokened theme slots
for button, textInput, toggleSwitch, badge, and alert. No components
adopt the theme yet. Adds an LD-mode smoke test helper that scans
rendered output for banned classes (bg-blue-*, bg-white,
text-blue-*, text-white) and inline white styles.
```

Tell the user: "Task 2 complete and ready to commit."

---

## Task 3: Add semantic token aliases for flowbite-react slot compatibility

**Files:**
- Modify: `scripts/generate-tokens.py`
- Regenerated: `web/src/styles/tokens.json`, `web/src/styles/themes/*.css` (do not edit by hand)
- Modify: `web/tailwind.config.js` (only if explicit alias mapping is needed)

- [ ] **Step 1: Inspect the current SEMANTIC_MAPS and look for collisions**

Read `scripts/generate-tokens.py`. Confirm the existing keys: `fg-primary`, `fg-secondary`, `fg-tertiary`, `surface-1`, `surface-2`, `surface-3`, `border-default`, `border-subtle`, `border-strong`, etc.

- [ ] **Step 2: Decide what aliases (if any) are actually needed**

Open `web/src/styles/flowbite-theme.ts` (created in Task 2). All slot strings already use the existing semantic keys (`bg-brand`, `text-fg-on-brand`, `bg-surface-2`, etc.). No flowbite-react slot in Task 2 required a missing token name.

This means **no alias additions are required at this time.** Tasks 5-12 may surface a need (e.g., a flowbite-react slot that defaults to `text-default`), in which case the alias is added at that task and Task 3 is retroactively the source of truth.

Mark this task as "no-op confirmed" and move on. The decision to defer aliases until a real need surfaces is intentional — adds no dead tokens.

- [ ] **Step 3: Stop for user (no commit needed)**

Tell the user: "Task 3 complete (no-op confirmed — no token aliases needed yet; per-task aliases will be added inline as Tasks 5-12 reveal them)."

---

## Task 4: Migrate Button to /ui/

**Files:**
- Create: `web/src/components/ui/Button.tsx`
- Modify: `web/src/components/JoinRoomModal.tsx` (import path)
- Modify: `web/src/components/MarkerForm.tsx` (import path)
- Modify: `web/src/test/ld-mode-compliance.test.tsx` (add Button fixture)
- Delete: `web/src/components/dtak/Button.tsx`
- Delete: `web/src/components/dtak/Button.test.tsx`

- [ ] **Step 1: Add Button to the LD-mode smoke test (fails because /ui/Button.tsx doesn't exist yet)**

Edit `web/src/test/ld-mode-compliance.test.tsx`. Add this `it` block inside the existing `describe`:

```tsx
import Button from '../components/ui/Button';

it('Button — all variants render without banned tokens in LD', () => {
  const { container } = renderInLd(
    <>
      <Button>primary</Button>
      <Button variant="secondary">secondary</Button>
      <Button variant="ghost">ghost</Button>
      <Button variant="destructive">destructive</Button>
      <Button size="sm">sm</Button>
      <Button size="lg">lg</Button>
    </>
  );
  assertNoBannedTokens(container);
  cleanup();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: FAIL with `Cannot find module '../components/ui/Button'`.

- [ ] **Step 3: Create the Button wrapper**

Create `web/src/components/ui/Button.tsx`:

```tsx
import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Button as FlowbiteButton } from 'flowbite-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', children, ...rest },
  ref,
) {
  return (
    <FlowbiteButton
      ref={ref as any}
      color={variant}
      size={size}
      className={className}
      {...rest}
    >
      {children}
    </FlowbiteButton>
  );
});

export default Button;
```

Note: `color` and `size` flow into flowbite-react which looks them up in `flowbiteTheme.button.color[variant]` and `.size[size]` — both populated in Task 2.

- [ ] **Step 4: Run the LD-mode test to verify the new Button passes**

Run:

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: PASS (both scaffold and Button fixture).

- [ ] **Step 5: Update consumer JoinRoomModal**

Edit `web/src/components/JoinRoomModal.tsx`. Change:

```tsx
import Button from './dtak/Button'
```

to:

```tsx
import Button from './ui/Button'
```

No JSX changes — the prop surface is identical.

- [ ] **Step 6: Update consumer MarkerForm**

Edit `web/src/components/MarkerForm.tsx`. Change:

```tsx
import Button from './dtak/Button'
```

to:

```tsx
import Button from './ui/Button'
```

- [ ] **Step 7: Delete the old DTAK Button**

Run:

```bash
rm web/src/components/dtak/Button.tsx web/src/components/dtak/Button.test.tsx
```

- [ ] **Step 8: Run full test suite and build**

Run:

```bash
cd web && npm test && npm run build
```

Expected: all green. `Button.test.tsx` no longer in the test list.

- [ ] **Step 9: Manual three-mode check**

Run `cd web && npm run dev`. Open the app. Trigger the JoinRoomModal (Sidebar → Join Room). Cycle theme dark → light → ld. Verify:
- Primary button is brand-colored in dark and light, drab/non-blue in ld.
- Mobile viewport (390×844 in Chrome devtools): button height ≥ 44px.
- LD viewport: button height ≥ 48px once Task 13 adds the size override; for now, document any LD touch-target gap as a known issue resolved at Task 13.

- [ ] **Step 10: Stop for user commit**

Files for user to commit:
- New: `web/src/components/ui/Button.tsx`
- Modified: `web/src/components/JoinRoomModal.tsx`, `web/src/components/MarkerForm.tsx`, `web/src/test/ld-mode-compliance.test.tsx`
- Deleted: `web/src/components/dtak/Button.tsx`, `web/src/components/dtak/Button.test.tsx`

Suggested commit message:

```
refactor: migrate Button from /dtak/ to /ui/, back with flowbite-react

Wraps flowbite-react's Button with DTAK semantic tokens via the theme
object. Prop surface (variant, size, ButtonHTMLAttributes) unchanged
so consumers only need an import path bump. LD-mode smoke test
extended to cover all variants.
```

Tell the user: "Task 4 complete and ready to commit."

---

## Task 5: Migrate IconButton to /ui/

**Files:**
- Create: `web/src/components/ui/IconButton.tsx`
- Modify: `web/src/components/ChatView.tsx` (import path)
- Modify: `web/src/components/VoiceBar.tsx` (import path)
- Modify: `web/src/test/ld-mode-compliance.test.tsx` (add IconButton fixture)
- Delete: `web/src/components/dtak/IconButton.tsx`
- Delete: `web/src/components/dtak/IconButton.test.tsx`

- [ ] **Step 1: Add IconButton fixture to the LD-mode test**

Edit `web/src/test/ld-mode-compliance.test.tsx`. Add:

```tsx
import IconButton from '../components/ui/IconButton';

it('IconButton — toggled and untoggled render without banned tokens in LD', () => {
  const { container } = renderInLd(
    <>
      <IconButton icon={<span>i</span>} label="info" />
      <IconButton icon={<span>i</span>} label="info" toggled />
    </>
  );
  assertNoBannedTokens(container);
  cleanup();
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: FAIL — `Cannot find module '../components/ui/IconButton'`.

- [ ] **Step 3: Create IconButton wrapper**

Create `web/src/components/ui/IconButton.tsx`:

```tsx
import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  toggled?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, toggled, className = '', ...rest },
  ref,
) {
  const base =
    'inline-flex items-center justify-center rounded ' +
    'h-11 w-11 max-md:h-11 max-md:w-11 ' +
    'bg-surface-2 hover:bg-surface-3 text-fg-primary ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  const toggledCls = toggled ? ' bg-surface-3 text-brand' : '';
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={toggled ? true : undefined}
      className={`${base}${toggledCls} ${className}`.trim()}
      {...rest}
    >
      {icon}
    </button>
  );
});

export default IconButton;
```

Note: IconButton stays a bespoke `<button>` rather than wrapping flowbite-react's Button-with-icon. Flowbite's icon button assumes a label-next-to-icon layout, not a square hit target. Our requirement is a 44px square — simpler to keep this bespoke under `/ui/` and apply DTAK tokens directly. The wrapper still benefits from the unified `/ui/` namespace and the LD smoke test.

- [ ] **Step 4: Run LD test, verify pass**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: PASS.

- [ ] **Step 5: Update ChatView consumer**

Edit `web/src/components/ChatView.tsx`. Change `import IconButton from './dtak/IconButton'` to `import IconButton from './ui/IconButton'`.

- [ ] **Step 6: Update VoiceBar consumer**

Edit `web/src/components/VoiceBar.tsx`. Change `import IconButton from './dtak/IconButton'` to `import IconButton from './ui/IconButton'`.

- [ ] **Step 7: Delete old files**

```bash
rm web/src/components/dtak/IconButton.tsx web/src/components/dtak/IconButton.test.tsx
```

- [ ] **Step 8: Run full suite + build**

```bash
cd web && npm test && npm run build
```

Expected: all green, including the existing `VoiceBar.test.tsx`.

- [ ] **Step 9: Manual three-mode check**

`cd web && npm run dev`. Verify the voice bar icons (mute, deafen, leave, PTT) and chat view icons (send, attach, settings) render correctly across dark/light/ld. Mobile viewport: tap targets ≥ 44px.

- [ ] **Step 10: Stop for user commit**

Suggested commit message:

```
refactor: migrate IconButton from /dtak/ to /ui/

Kept as a bespoke 44px square button (no flowbite-react analog
matches the touch-target shape). LD-mode smoke test covers toggled
and untoggled states. Consumers ChatView and VoiceBar updated.
```

---

## Task 6: Migrate Input to /ui/

**Files:**
- Create: `web/src/components/ui/Input.tsx`
- Modify: `web/src/components/Sidebar.tsx`, `web/src/components/JoinRoomModal.tsx`, `web/src/components/MarkerForm.tsx` (import paths)
- Modify: `web/src/test/ld-mode-compliance.test.tsx`
- Delete: `web/src/components/dtak/Input.tsx`, `web/src/components/dtak/Input.test.tsx`

- [ ] **Step 1: Add Input fixture to LD test**

Add to `web/src/test/ld-mode-compliance.test.tsx`:

```tsx
import Input from '../components/ui/Input';

it('Input — text and textarea render without banned tokens in LD', () => {
  const { container } = renderInLd(
    <>
      <Input placeholder="text" />
      <Input multiline placeholder="area" />
      <Input error="oops" />
    </>
  );
  assertNoBannedTokens(container);
  cleanup();
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: FAIL.

- [ ] **Step 3: Create Input wrapper**

Create `web/src/components/ui/Input.tsx`. Wrapping flowbite-react's `TextInput` is awkward here because the DTAK `Input` carries an `error` prop, a `multiline` discriminated union, and inline error rendering. Cleanest path: keep the bespoke implementation under `/ui/` (consistent with how IconButton stayed bespoke).

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

Note: this file is byte-identical to `web/src/components/dtak/Input.tsx` except for its location. flowbite-react does not add value here; the wrapper exists to live in the `/ui/` namespace.

- [ ] **Step 4: Run LD test, verify pass**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: PASS.

- [ ] **Step 5: Update Sidebar consumer**

Edit `web/src/components/Sidebar.tsx`. Change `import Input from './dtak/Input'` to `import Input from './ui/Input'`.

- [ ] **Step 6: Update JoinRoomModal consumer**

Edit `web/src/components/JoinRoomModal.tsx`. Change `import Input from './dtak/Input'` to `import Input from './ui/Input'`.

- [ ] **Step 7: Update MarkerForm consumer**

Edit `web/src/components/MarkerForm.tsx`. Change `import Input from './dtak/Input'` to `import Input from './ui/Input'`.

- [ ] **Step 8: Delete old files**

```bash
rm web/src/components/dtak/Input.tsx web/src/components/dtak/Input.test.tsx
```

- [ ] **Step 9: Run full suite + build**

```bash
cd web && npm test && npm run build
```

Expected: all green.

- [ ] **Step 10: Manual three-mode check**

Verify Sidebar's room search input, JoinRoomModal's name/code inputs, MarkerForm's remark textarea. Cycle themes.

- [ ] **Step 11: Stop for user commit**

Suggested commit message:

```
refactor: migrate Input from /dtak/ to /ui/

Kept bespoke — flowbite-react's TextInput doesn't model the
discriminated multiline/error union cleanly. Stays in the /ui/
namespace for consistency and LD-mode smoke test coverage.
```

---

## Task 7: Migrate Toggle to /ui/

**Files:**
- Create: `web/src/components/ui/Toggle.tsx`
- Modify: `web/src/components/Sidebar.tsx` (import path)
- Modify: `web/src/test/ld-mode-compliance.test.tsx`
- Delete: `web/src/components/dtak/Toggle.tsx`, `web/src/components/dtak/Toggle.test.tsx`

- [ ] **Step 1: Add Toggle fixture to LD test**

Add to `web/src/test/ld-mode-compliance.test.tsx`:

```tsx
import Toggle from '../components/ui/Toggle';

it('Toggle — on and off render without banned tokens in LD', () => {
  const { container } = renderInLd(
    <>
      <Toggle checked={false} onChange={() => {}} label="off" />
      <Toggle checked={true} onChange={() => {}} label="on" />
    </>
  );
  assertNoBannedTokens(container);
  cleanup();
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: FAIL.

- [ ] **Step 3: Create Toggle wrapper**

Create `web/src/components/ui/Toggle.tsx`. flowbite-react's `ToggleSwitch` has a different prop shape (`onChange` receives the new value; matches ours) and supports a `label` prop. Wrap it:

```tsx
import { ToggleSwitch } from 'flowbite-react';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export default function Toggle({
  checked, onChange, label, disabled, className,
}: ToggleProps) {
  return (
    <ToggleSwitch
      checked={checked}
      onChange={onChange}
      label={label}
      disabled={disabled}
      className={className}
    />
  );
}
```

The flowbite-react ToggleSwitch picks up `bg-brand` (on) / `bg-surface-3` (off) from `flowbiteTheme.toggleSwitch.toggle.checked` configured in Task 2.

- [ ] **Step 4: Run LD test, verify pass**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: PASS. If the test fails on a `bg-blue-*` class, flowbite-react is rendering a slot we didn't override — inspect the error message for the slot name, add it to `flowbiteTheme.toggleSwitch` in `web/src/styles/flowbite-theme.ts`, and re-run.

- [ ] **Step 5: Update Sidebar consumer**

Edit `web/src/components/Sidebar.tsx`. Change `import Toggle from './dtak/Toggle'` to `import Toggle from './ui/Toggle'`.

- [ ] **Step 6: Delete old files**

```bash
rm web/src/components/dtak/Toggle.tsx web/src/components/dtak/Toggle.test.tsx
```

- [ ] **Step 7: Run full suite + build**

```bash
cd web && npm test && npm run build
```

Expected: all green.

- [ ] **Step 8: Manual three-mode check**

In the app, open Sidebar (or wherever the toggle appears). Verify on/off visual states across all three modes. In LD specifically: the "on" state must not be blue or white.

- [ ] **Step 9: Stop for user commit**

Suggested commit message:

```
refactor: migrate Toggle from /dtak/ to /ui/, back with flowbite-react

Wraps flowbite-react's ToggleSwitch. DTAK semantic tokens flow in
via the theme object; LD-mode smoke test confirms no blue/white
in the on or off state.
```

---

## Task 8: Migrate Surface to /ui/

**Files:**
- Create: `web/src/components/ui/Surface.tsx`
- Modify: `web/src/components/JoinRoomModal.tsx` (import path)
- Modify: `web/src/test/ld-mode-compliance.test.tsx`
- Delete: `web/src/components/dtak/Surface.tsx`, `web/src/components/dtak/Surface.test.tsx`

- [ ] **Step 1: Add Surface fixture to LD test**

Add to `web/src/test/ld-mode-compliance.test.tsx`:

```tsx
import Surface from '../components/ui/Surface';

it('Surface — all variants render without banned tokens in LD', () => {
  const { container } = renderInLd(
    <>
      <Surface variant="canvas">canvas</Surface>
      <Surface variant="1">s1</Surface>
      <Surface variant="2">s2</Surface>
      <Surface variant="3">s3</Surface>
      <Surface variant="overlay">overlay</Surface>
    </>
  );
  assertNoBannedTokens(container);
  cleanup();
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: FAIL.

- [ ] **Step 3: Create Surface wrapper**

Create `web/src/components/ui/Surface.tsx`. flowbite-react's `Card` adds shadow, padding, and a border by default — none of which the existing DTAK Surface has. Stays bespoke (a themed `<div>`):

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

Byte-identical to `web/src/components/dtak/Surface.tsx` except for location.

- [ ] **Step 4: Run LD test, verify pass**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: PASS.

- [ ] **Step 5: Update JoinRoomModal consumer**

Edit `web/src/components/JoinRoomModal.tsx`. Change `import Surface from './dtak/Surface'` to `import Surface from './ui/Surface'`.

- [ ] **Step 6: Delete old files**

```bash
rm web/src/components/dtak/Surface.tsx web/src/components/dtak/Surface.test.tsx
```

- [ ] **Step 7: Run full suite + build**

```bash
cd web && npm test && npm run build
```

- [ ] **Step 8: Manual three-mode check**

Open JoinRoomModal. Verify the modal surface renders with the correct background per theme.

- [ ] **Step 9: Stop for user commit**

Suggested commit message:

```
refactor: migrate Surface from /dtak/ to /ui/

Kept bespoke — flowbite-react Card adds opinionated shadow/padding
that we don't want for the canvas/surface variants. Same DTAK
tokens, new location.
```

---

## Task 9: Migrate StatusPill to /ui/

**Files:**
- Create: `web/src/components/ui/StatusPill.tsx`
- Modify: `web/src/components/RoomItem.tsx` (import path)
- Modify: `web/src/test/ld-mode-compliance.test.tsx`
- Delete: `web/src/components/dtak/StatusPill.tsx`, `web/src/components/dtak/StatusPill.test.tsx`

- [ ] **Step 1: Add StatusPill fixture to LD test**

Add to `web/src/test/ld-mode-compliance.test.tsx`:

```tsx
import StatusPill from '../components/ui/StatusPill';

it('StatusPill — all variants render without banned tokens in LD', () => {
  const variants = [
    'info', 'success', 'warning', 'critical', 'count',
    'cot-friendly', 'cot-hostile', 'cot-neutral', 'cot-unknown',
    'transport-wifi', 'transport-ble', 'transport-relay', 'transport-offline',
  ] as const;
  const { container } = renderInLd(
    <>{variants.map((v) => <StatusPill key={v} variant={v}>x</StatusPill>)}</>
  );
  assertNoBannedTokens(container);
  cleanup();
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: FAIL.

- [ ] **Step 3: Create StatusPill wrapper**

Create `web/src/components/ui/StatusPill.tsx`. flowbite-react's `Badge` accepts a `color` prop, but the set is limited (info/success/warning/failure/gray) — far smaller than our 13 variants (CoT affiliations, transport states). Wrapping Badge and overriding `color` per variant would require adding 13 keys to `flowbiteTheme.badge.color` *and* mapping them client-side. Cleaner: stay bespoke under `/ui/`.

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
  info:                'bg-status-info',
  success:             'bg-status-success',
  warning:             'bg-status-warning',
  critical:            'bg-status-critical',
  count:               'bg-status-critical',
  'cot-friendly':      'bg-cot-friendly',
  'cot-hostile':       'bg-cot-hostile',
  'cot-neutral':       'bg-cot-neutral',
  'cot-unknown':       'bg-cot-unknown',
  'transport-wifi':    'bg-transport-wifi',
  'transport-ble':     'bg-transport-ble',
  'transport-relay':   'bg-transport-relay',
  'transport-offline': 'bg-transport-offline',
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

Byte-identical to DTAK source.

- [ ] **Step 4: Run LD test, verify pass**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: PASS.

- [ ] **Step 5: Update RoomItem consumer**

Edit `web/src/components/RoomItem.tsx`. Change `import StatusPill from './dtak/StatusPill'` to `import StatusPill from './ui/StatusPill'`.

- [ ] **Step 6: Delete old files**

```bash
rm web/src/components/dtak/StatusPill.tsx web/src/components/dtak/StatusPill.test.tsx
```

- [ ] **Step 7: Run full suite + build**

```bash
cd web && npm test && npm run build
```

- [ ] **Step 8: Manual three-mode check**

Open Sidebar's room list. Verify status pills (unread count, transport indicators) render. In LD mode confirm none look blue or white — especially the `info` and `transport-wifi` variants which use `--color-status-info` and `--color-transport-wifi` (those tokens shift away from blue in `low-detection.css`).

- [ ] **Step 9: Stop for user commit**

Suggested commit message:

```
refactor: migrate StatusPill from /dtak/ to /ui/

Kept bespoke — 13 semantic variants (status/cot/transport) don't
map cleanly onto flowbite-react Badge's small color set. LD-mode
smoke test covers every variant.
```

---

## Task 10: Migrate CalloutBar to /ui/ (or confirm-and-delete)

**Files:**
- Possibly create: `web/src/components/ui/CalloutBar.tsx`
- Modify: `web/src/test/ld-mode-compliance.test.tsx`
- Delete: `web/src/components/dtak/CalloutBar.tsx`, `web/src/components/dtak/CalloutBar.test.tsx`

- [ ] **Step 1: Re-grep for CalloutBar consumers, including dynamic imports**

Run:

```bash
grep -rn "CalloutBar" web/src --include="*.tsx" --include="*.ts" | grep -v "/dtak/CalloutBar\."
```

If output is empty → confirmed unused; proceed with deletion path (Step 2a).
If output shows real consumers → proceed with migration path (Step 2b).

- [ ] **Step 2a (if unused): Delete the DTAK CalloutBar without replacement**

```bash
rm web/src/components/dtak/CalloutBar.tsx web/src/components/dtak/CalloutBar.test.tsx
```

Run:

```bash
cd web && npm test && npm run build
```

Expected: all green.

Skip to Step 5 (commit).

- [ ] **Step 2b (if used): Add CalloutBar fixture to the LD test**

Add to `web/src/test/ld-mode-compliance.test.tsx`:

```tsx
import CalloutBar from '../components/ui/CalloutBar';

it('CalloutBar — all variants render without banned tokens in LD', () => {
  const { container } = renderInLd(
    <>
      <CalloutBar variant="info">i</CalloutBar>
      <CalloutBar variant="success">s</CalloutBar>
      <CalloutBar variant="warning">w</CalloutBar>
      <CalloutBar variant="critical">c</CalloutBar>
      <CalloutBar variant="active-call">a</CalloutBar>
    </>
  );
  assertNoBannedTokens(container);
  cleanup();
});
```

- [ ] **Step 3 (if used): Create CalloutBar wrapper**

Create `web/src/components/ui/CalloutBar.tsx`. flowbite-react's `Alert` is close in shape but adds dismiss UI we already handle. Stay bespoke:

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

Then update each consumer's import (`./dtak/CalloutBar` → `./ui/CalloutBar`).

- [ ] **Step 4 (if used): Run LD test, full suite, manual check**

```bash
cd web && npm test && npm run build
```

Manual: render the feature that uses CalloutBar across the three modes.

- [ ] **Step 4b (if used): Delete the old DTAK files**

```bash
rm web/src/components/dtak/CalloutBar.tsx web/src/components/dtak/CalloutBar.test.tsx
```

- [ ] **Step 5: Stop for user commit**

Suggested commit message (deletion path):

```
chore: remove unused CalloutBar primitive

No consumers found via static or dynamic grep. Removing rather
than migrating to /ui/.
```

Suggested commit message (migration path):

```
refactor: migrate CalloutBar from /dtak/ to /ui/

Kept bespoke — Alert from flowbite-react adds its own dismiss UI
that conflicts with our onDismiss prop shape. LD-mode smoke test
covers every variant.
```

---

## Task 11: Migrate CotMarker to /ui/

**Files:**
- Create: `web/src/components/ui/CotMarker.tsx`
- Modify: `web/src/test/ld-mode-compliance.test.tsx`
- Delete: `web/src/components/dtak/CotMarker.tsx`, `web/src/components/dtak/CotMarker.test.tsx`

- [ ] **Step 1: Grep for CotMarker consumers**

Run:

```bash
grep -rn "from.*CotMarker\|components/dtak/CotMarker" web/src --include="*.tsx" --include="*.ts"
```

Record the list (likely zero — it may be planned for future map work). If consumers exist, update their imports in Step 5; if zero, the new file still lands in `/ui/` so future map work has it ready.

- [ ] **Step 2: Add CotMarker fixture to LD test**

Add to `web/src/test/ld-mode-compliance.test.tsx`:

```tsx
import CotMarker from '../components/ui/CotMarker';

it('CotMarker — all affiliations render without banned tokens in LD', () => {
  const { container } = renderInLd(
    <>
      <CotMarker affiliation="friendly" />
      <CotMarker affiliation="hostile" />
      <CotMarker affiliation="neutral" />
      <CotMarker affiliation="unknown" />
    </>
  );
  assertNoBannedTokens(container);
  cleanup();
});
```

- [ ] **Step 3: Run test, verify fail**

```bash
cd web && npm test -- ld-mode-compliance
```

Expected: FAIL.

- [ ] **Step 4: Create CotMarker (bespoke — explicitly no Flowbite analog)**

Create `web/src/components/ui/CotMarker.tsx`:

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

- [ ] **Step 5: Update any consumers from Step 1**

For each path returned by Step 1's grep, change the import to `./ui/CotMarker`.

- [ ] **Step 6: Delete old files**

```bash
rm web/src/components/dtak/CotMarker.tsx web/src/components/dtak/CotMarker.test.tsx
```

- [ ] **Step 7: Run LD test + full suite + build**

```bash
cd web && npm test && npm run build
```

Expected: all green.

- [ ] **Step 8: Stop for user commit**

Suggested commit message:

```
refactor: move CotMarker from /dtak/ to /ui/

Bespoke — no flowbite-react analog for a CoT-affiliation map
overlay marker. Same implementation, new location. LD-mode
smoke test covers all four affiliations.
```

---

## Task 12: Remove /dtak/ directory and the legacyPlCompat shim

**Files:**
- Delete: `web/src/components/dtak/` (entire directory)
- Modify: `web/tailwind.config.js`

- [ ] **Step 1: Verify the /dtak/ directory is empty of source files**

Run:

```bash
ls web/src/components/dtak/
```

Expected: empty (or only stray files — if any `.tsx` remain, return to the earlier task that should have removed them).

- [ ] **Step 2: Verify no remaining imports point at /dtak/**

Run:

```bash
grep -rn "components/dtak\|from.*dtak/" web/src --include="*.tsx" --include="*.ts"
```

Expected: zero output.

- [ ] **Step 3: Delete the directory**

```bash
rm -rf web/src/components/dtak
```

- [ ] **Step 4: Verify no remaining `pl-*` class usage**

Run:

```bash
grep -rn "\\bpl-" web/src --include="*.tsx" --include="*.ts"
```

Expected: zero output (the migration plan should have eliminated all `pl-*` usages; if any remain, list them and stop — fix them before removing the shim).

- [ ] **Step 5: Remove the legacyPlCompat shim from tailwind.config.js**

Edit `web/tailwind.config.js`. Delete the entire `legacyPlCompat` declaration block and remove `...legacyPlCompat,` from the `colors` extend. The relevant block currently reads:

```js
// Legacy pl-* compatibility shims. These map old token names to DTAK semantic
// tokens so existing components keep rendering correctly until the Phase 6
// migration replaces them. Theme-reactive (resolves through CSS vars).
// Remove this block after `git grep "pl-" web/src` returns no matches.
const legacyPlCompat = {
  'pl-bg':       'oklch(var(--color-surface-canvas) / <alpha-value>)',
  // … 12 more entries …
};
```

After deletion, the `extend.colors` block should look like:

```js
colors: {
  ...scaleColors,
  ...semanticColors,
},
```

- [ ] **Step 6: Run full suite + build**

```bash
cd web && npm test && npm run build
```

Expected: all green. If a build error names a missing `pl-*` class, return to Step 4 — a usage was missed.

- [ ] **Step 7: Manual three-mode check**

`cd web && npm run dev`. Sanity-check the full app across dark/light/ld:
- Sidebar, ChatView, JoinRoomModal, MarkerForm, VoiceBar, MapViewer, SettingsPage
- Mobile viewport touch targets ≥ 44px
- LD: nothing blue or white

- [ ] **Step 8: Stop for user commit**

Suggested commit message:

```
chore: remove /dtak/ directory and legacy pl-* Tailwind shim

The DTAK primitive library has been fully replaced by /ui/
wrappers backed (where applicable) by flowbite-react. The
pl-* Tailwind compat layer is no longer referenced anywhere
in web/src/.
```

---

## Task 13: Rename docs/dtak/ to docs/ui/ and update CLAUDE.md

**Files:**
- Rename: `docs/dtak/` → `docs/ui/`
- Modify: `docs/ui/00-overview.md`, `docs/ui/03-components.md`, `docs/ui/06-migration.md` (content updates)
- Modify: `CLAUDE.md` (path references and rule text)

- [ ] **Step 1: Move the directory**

```bash
git mv docs/dtak docs/ui
```

- [ ] **Step 2: Update CLAUDE.md path references**

Edit `/Users/skylight/Documents/Peat-Chat/CLAUDE.md`. Change every occurrence of `docs/dtak/` to `docs/ui/` (there are at least 4: in the intro paragraph, the "Key files" table row for "Spec", the "Key files" row for component primitives if listed, and the Hard Rules block).

Also update:

- "Component primitives | `web/src/components/dtak/`" → "Component primitives | `web/src/components/ui/`"
- Rule 5: replace "Place under `web/src/components/dtak/` only if reusable" with "Place under `web/src/components/ui/` only if reusable"
- Rule 2: replace "deprecated. They still work via a compatibility shim in `tailwind.config.js`" with "removed entirely as of the Flowbite migration. Any remaining usage is a bug."
- Add a new Rule 8: "When adopting a new flowbite-react component, wrap it in `web/src/components/ui/` rather than importing flowbite-react directly in feature code."

- [ ] **Step 3: Update docs/ui/00-overview.md**

Edit the intro paragraph to note the system is now backed by flowbite-react primitives where applicable. The DTAK *rules and tokens* remain authoritative; flowbite-react is the implementation choice for a subset of primitives.

- [ ] **Step 4: Update docs/ui/03-components.md**

For each component, add a one-line "Implementation:" note: which flowbite-react component it wraps (Button → flowbite-react Button, Toggle → flowbite-react ToggleSwitch), or "bespoke" (IconButton, Input, Surface, StatusPill, CotMarker, CalloutBar).

- [ ] **Step 5: Update docs/ui/06-migration.md**

Append a new section "Flowbite migration (2026-05-15)" summarizing what changed: directory rename, flowbite-react adoption for Button and Toggle, removal of the legacyPlCompat shim, addition of LD-mode automated compliance test.

- [ ] **Step 6: Verify no stale docs/dtak references in CLAUDE.md or docs/**

```bash
grep -rn "docs/dtak\|components/dtak" CLAUDE.md docs/
```

Expected: zero output.

- [ ] **Step 7: Run a final full check**

```bash
cd web && npm test && npm run build
```

Expected: all green.

- [ ] **Step 8: Stop for user commit**

Suggested commit message:

```
docs: rename docs/dtak → docs/ui and update CLAUDE.md for Flowbite

CLAUDE.md hard rules updated:
- Rule 2: pl-* shim removed, any remaining usage is a bug
- Rule 5: primitives now in /components/ui/, not /components/dtak/
- New Rule 8: wrap flowbite-react in /ui/ before using in features

docs/ui/03-components.md notes per-component implementation source
(flowbite-react wrapper vs bespoke). docs/ui/06-migration.md
appends a section summarizing this migration.
```

Tell the user: "Task 13 complete. Migration finished. Ready to merge `flowbite-migration` into `main`."

---

## Self-review

**Spec coverage:**

- Spec § "Goal" → Task 1 (install), Task 2 (provider), Tasks 4-11 (migration), Task 12 (cleanup), Task 13 (docs).
- Spec § "Theming architecture" — four layers → CSS variables unchanged (no task); Tailwind colors unchanged (no task); flowbite-theme.ts → Task 2 Step 3; useTheme/ld variant — currently handled via inline classes per component (Button size `lg` is the 48px variant; LD-specific structural overrides beyond color are minimal in the current primitive set, no `useTheme()`-aware branching needed yet). **Note:** if a later component (e.g., touch target enforcement at the IconButton level under LD) needs LD-conditional sizing, add an inline `data-theme="ld"` CSS selector or a `useTheme()` read inside that component's wrapper — covered by per-task manual check.
- Spec § "Component mapping" → Tasks 4-11, one per primitive.
- Spec § "Migration order" — 13 steps in spec → maps to Tasks 1-13 in plan (1-to-1 with minor regrouping: spec step 1 = Task 1; spec step 2 = Task 2; spec steps 3-10 = Tasks 4-11; spec step 11 = Task 12; spec step 12 = Task 12 step 5; spec step 13 = Task 13).
- Spec § "Token & rule adjustments" → Task 3 confirms no aliases needed yet; Task 13 updates CLAUDE.md rules.
- Spec § "Test strategy" → LD smoke test created in Task 2, extended in Tasks 4-11; primitive tests deleted alongside source files in each task; VoiceBar.test.tsx untouched.
- Spec § "Risks" — flash of unstyled content addressed in Task 1 Step 3 (CSS order note); touch target risk addressed in per-task manual check; bundle size risk addressed by Task 1 Step 4 build verification (recommend the engineer eyeball gzip output diff after first flowbite-react import in Task 2).

**Placeholder scan:** none. Every step has either a complete code block, an exact command with expected output, or a precise file modification.

**Type consistency:** `ButtonVariant`, `ButtonSize`, `IconButtonProps`, `InputProps`/`TextareaProps`, `ToggleProps`, `SurfaceVariant`, `StatusPillVariant`, `CalloutBarVariant`, `CotAffiliation` — all defined identically in their respective tasks to match the existing DTAK source. `renderInLd` and `assertNoBannedTokens` are defined in Task 2 and reused exactly as defined in Tasks 4-11.

---

## Execution handoff

After the user reviews this plan and approves, two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each subagent gets the task spec and the relevant DTAK source file(s), produces the changes, runs the tests, and stops for user commit.

**2. Inline Execution** — Execute tasks in this session, with checkpoints for user review and commit after each task.

Which approach?
