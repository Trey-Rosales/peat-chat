# Tailwind 4 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Peat-Chat from Tailwind 3.4.4 to Tailwind 4.x using v4's CSS-first config (`@theme` block emitted by `scripts/generate-tokens.py`), the native Vite plugin (`@tailwindcss/vite`), and the `tw-animate-css` replacement for `tailwindcss-animate`. DTAK semantic tokens, three-theme story, all 21 shadcn primitives, and all 16 feature components must keep working unchanged.

**Architecture:** The DTAK token system (per-theme `[data-theme="X"] { --color-Y: oklch(...) }` blocks) stays as the runtime source of truth. The shadcn alias layer (`background`, `primary`, `popover`, etc.) moves from `tailwind.config.js`'s `theme.extend.colors` IIFE into a generated `tokens.css` containing v4's `@theme` block + `@utility min-h-touch` rule. PostCSS pipeline is replaced by `@tailwindcss/vite` (handles Tailwind processing AND vendor prefixing via Lightning CSS).

**Tech Stack:** Tailwind CSS 4.x, `@tailwindcss/vite`, `tw-animate-css`, Vite 5, React 18, TypeScript 5.5, Vitest.

**Workflow notes:**
- The user (zgehin) commits manually. Plan does NOT include `git commit` steps. One phase stop at the end where the user reviews and commits the whole v4 migration as one atomic change.
- The user will create the `zgehin/tailwind-4-upgrade` branch off `zgehin/design-system-shadcn` AFTER committing Pass 1-4 work but BEFORE Task 1. The plan starts from "you're on `zgehin/tailwind-4-upgrade` with the prior work committed".
- **First-build expectation:** Some tasks intentionally leave the build broken mid-flight (e.g., after deleting `tailwind.config.js` but before regenerating `tokens.css`). Each task's "Verify" step calls out whether the build is expected to pass or fail at that point.

---

## File-touch summary

**Modified:**
- `web/package.json`, `web/package-lock.json` — dep swap
- `web/vite.config.ts` — add `@tailwindcss/vite` plugin
- `web/src/index.css` — rewrite imports
- `scripts/generate-tokens.py` — emit oklch-wrapped values + new `tokens.css`
- `web/src/styles/themes/{dark,light,low-detection}.css` — regenerated, oklch form
- Many `web/src/**/*.{tsx,ts}` — codemod renames (~15-20 across the tree)
- `CLAUDE.md` — update hard rules #2 and #6

**Created:**
- `web/src/styles/tokens.css` — new generated file containing `@theme` block + `@utility min-h-touch`

**Deleted:**
- `web/postcss.config.js`
- `web/tailwind.config.js`

---

## Task 1: Verify clean starting state

**Files:** none (verification only)

- [ ] **Step 1: Confirm branch + clean working tree**

```bash
cd /Users/skylight/Documents/Peat-Chat
git branch --show-current
git status --short
```

Expected:
- Current branch: `zgehin/tailwind-4-upgrade`
- `git status --short` shows zero modified/untracked files (Pass 1-4 work was committed before branching)

If the branch is wrong or the tree is dirty, STOP and report — the user needs to commit Pass 1-4 and create the v4 branch first.

- [ ] **Step 2: Confirm baseline build + test pass**

```bash
cd web && npm run build && npm run test
```

Expected: clean build, 88/88 tests pass (this is the v3 baseline).

- [ ] **Step 3: Confirm v3 packages currently installed**

```bash
cd web && npm ls tailwindcss tailwindcss-animate autoprefixer 2>&1 | head -10
```

Expected output should show:
- `tailwindcss@3.4.4` (or similar 3.4.x)
- `tailwindcss-animate@1.0.7`
- `autoprefixer@10.4.x`

Document what you saw in your final report so subsequent tasks have ground truth.

---

## Task 2: Install v4 dependencies, remove v3

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`

- [ ] **Step 1: Uninstall v3 packages**

```bash
cd web && npm uninstall tailwindcss tailwindcss-animate autoprefixer
```

`postcss` may stay if other tooling uses it; do not remove it in this step.

- [ ] **Step 2: Install v4 packages at latest**

```bash
cd web && npm install --save-dev tailwindcss@latest @tailwindcss/vite@latest
cd web && npm install tw-animate-css@latest
```

Note: `tailwindcss` and `@tailwindcss/vite` go to `devDependencies` (build tooling). `tw-animate-css` goes to `dependencies` (it's CSS imported at runtime, like a regular library).

- [ ] **Step 3: Verify the installed versions**

```bash
cd web && npm ls tailwindcss @tailwindcss/vite tw-animate-css 2>&1 | head -10
```

Expected:
- `tailwindcss@4.x.x` (some 4.x version, ideally ≥4.0.0)
- `@tailwindcss/vite@4.x.x`
- `tw-animate-css@1.x.x` (or whatever current major is)

If any resolve to surprising versions or have peer-dep warnings, report DONE_WITH_CONCERNS with the version output.

- [ ] **Step 4: Build is expected to FAIL after this task**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: BUILD FAILS. The reason: `tailwindcss` v4 doesn't expose the v3 PostCSS plugin entrypoint; PostCSS pipeline is broken until Task 4 swaps to the Vite plugin. This is intentional — confirm the failure mode is "PostCSS plugin missing" or "tailwindcss is no longer a PostCSS plugin", NOT something else (like a TypeScript error).

Capture the exact error message in your report. **Do not try to fix it in this task.**

---

## Task 3: Delete the v3 config files

**Files:**
- Delete: `web/postcss.config.js`
- Delete: `web/tailwind.config.js`

- [ ] **Step 1: Verify the files exist**

```bash
ls -la web/postcss.config.js web/tailwind.config.js
```

Both should exist.

- [ ] **Step 2: Delete both**

```bash
rm web/postcss.config.js web/tailwind.config.js
```

- [ ] **Step 3: Verify deletion**

```bash
ls web/postcss.config.js web/tailwind.config.js 2>&1
```

Expected: "No such file or directory" for both.

- [ ] **Step 4: Build is still expected to FAIL**

Don't run build here — Task 4 sets up the new Vite plugin, then Task 5/6 finish wiring the new pipeline. We'll run a checkpoint build at the end of Task 7.

---

## Task 4: Add `@tailwindcss/vite` plugin to vite.config.ts

**Files:**
- Modify: `web/vite.config.ts`

The current vite.config.ts (after T1 of the prior refactor) looks like:

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

- [ ] **Step 1: Add the import + register the plugin**

Use Edit to:

a. Add this import line after the existing `react` import:
```ts
import tailwindcss from '@tailwindcss/vite'
```

b. Change the plugins array from `plugins: [react()],` to:
```ts
plugins: [react(), tailwindcss()],
```

Final vite.config.ts shape:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

const certPath = path.resolve(__dirname, '.certs/cert.pem')
const keyPath = path.resolve(__dirname, '.certs/key.pem')
const httpsConfig =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
    : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
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

- [ ] **Step 2: Build is STILL expected to fail**

The Vite plugin is wired but `index.css` still uses the v3 `@tailwind` directives, and there's no `@theme` block defined yet. Skip the build here — Task 7 will run the first end-to-end build that should pass.

---

## Task 5: Extend `generate-tokens.py` to emit `tokens.css` + change theme CSS to oklch form

**Files:**
- Modify: `scripts/generate-tokens.py`

Two distinct changes:
1. Per-theme files emit values like `--color-X: oklch(13.3% 0.002 196.9);` (full oklch function form), not raw `13.3% 0.002 196.9` triplets.
2. New emission of `web/src/styles/tokens.css` containing `@theme` block + `@utility min-h-touch` rule.

- [ ] **Step 1: Change `write_theme_css` to wrap values in `oklch(...)`**

Find this block (around lines 263-282):

```python
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
    # Non-color constants (same value in every theme)
    for key, value in THEME_CONSTANTS.items():
        lines.append(f"  --{key}: {value};")
    lines.append("}")
    out_path.write_text("\n".join(lines) + "\n")
```

Replace with:

```python
def write_theme_css(mode, scales, mapping, out_path):
    lines = [
        f"/* GENERATED by scripts/generate-tokens.py — do not edit by hand. */",
        f"[data-theme=\"{mode}\"] {{",
    ]
    for token, ref in mapping.items():
        lines.append(f"  --color-{token}: oklch({resolve_var(scales, ref)});")
    # surface-overlay (alpha-bearing) — already in full oklch() form
    if mode == "dark":
        lines.append(f"  --color-surface-overlay: oklch(13.3% 0.002 196.9 / 0.7);")
    elif mode == "light":
        lines.append(f"  --color-surface-overlay: oklch(72% 0.002 220 / 0.5);")
    else:  # ld
        lines.append(f"  --color-surface-overlay: oklch(0% 0 0 / 0.85);")
    lines.append("}")
    out_path.write_text("\n".join(lines) + "\n")
```

Two changes:
- Wrapped value in `oklch(...)` on the per-token emission line.
- Removed the `THEME_CONSTANTS` loop (radius now lives in `tokens.css`'s `@theme` block, not per-theme).

- [ ] **Step 2: Add a new function `write_tokens_css`**

Add this function above `def main():` (around line 302):

```python
def write_tokens_css(out_path):
    """Emit the v4 @theme block (shadcn aliases + radius) and @utility rules."""
    lines = [
        "/* GENERATED by scripts/generate-tokens.py — do not edit by hand. */",
        "",
        "@theme {",
        "  /* shadcn aliases: each maps to a DTAK semantic token whose value",
        "     is declared per-theme in themes/{dark,light,low-detection}.css. */",
        "  --color-background:             var(--color-surface-canvas);",
        "  --color-foreground:             var(--color-fg-primary);",
        "  --color-card:                   var(--color-surface-1);",
        "  --color-card-foreground:        var(--color-fg-primary);",
        "  --color-popover:                var(--color-surface-2);",
        "  --color-popover-foreground:     var(--color-fg-primary);",
        "  --color-primary:                var(--color-brand);",
        "  --color-primary-foreground:     var(--color-fg-on-brand);",
        "  --color-secondary:              var(--color-surface-2);",
        "  --color-secondary-foreground:   var(--color-fg-primary);",
        "  --color-muted:                  var(--color-surface-2);",
        "  --color-muted-foreground:       var(--color-fg-tertiary);",
        "  --color-accent:                 var(--color-surface-3);",
        "  --color-accent-foreground:      var(--color-fg-primary);",
        "  --color-destructive:            var(--color-status-critical);",
        "  --color-destructive-foreground: var(--color-fg-on-brand);",
        "  --color-border:                 var(--color-border-default);",
        "  --color-input:                  var(--color-border-default);",
        "  --color-ring:                   var(--color-border-focus);",
        "",
        "  --radius:    0.375rem;",
        "  --radius-lg: var(--radius);",
        "  --radius-md: calc(var(--radius) - 2px);",
        "  --radius-sm: calc(var(--radius) - 4px);",
        "}",
        "",
        "@utility min-h-touch {",
        "  min-height: 44px;",
        "}",
        "",
        "[data-theme=\"ld\"] .min-h-touch {",
        "  min-height: 48px;",
        "}",
    ]
    out_path.write_text("\n".join(lines) + "\n")
```

- [ ] **Step 3: Call `write_tokens_css` from `main()`**

Find `def main():` (around line 302):

```python
def main():
    scales = build_scales()
    styles_dir = REPO / "web" / "src" / "styles"
    themes_dir = styles_dir / "themes"
    themes_dir.mkdir(parents=True, exist_ok=True)
    for mode, mapping in SEMANTIC_MAPS.items():
        write_theme_css(
            mode, scales, mapping,
            themes_dir / f"{'low-detection' if mode == 'ld' else mode}.css",
        )
    write_tokens_json(scales, SEMANTIC_MAPS, styles_dir / "tokens.json")
    print("✓ Generated:")
    print(f"  {themes_dir / 'dark.css'}")
    print(f"  {themes_dir / 'light.css'}")
    print(f"  {themes_dir / 'low-detection.css'}")
    print(f"  {styles_dir / 'tokens.json'}")
```

Add a call to `write_tokens_css` and a print line. The new shape:

```python
def main():
    scales = build_scales()
    styles_dir = REPO / "web" / "src" / "styles"
    themes_dir = styles_dir / "themes"
    themes_dir.mkdir(parents=True, exist_ok=True)
    for mode, mapping in SEMANTIC_MAPS.items():
        write_theme_css(
            mode, scales, mapping,
            themes_dir / f"{'low-detection' if mode == 'ld' else mode}.css",
        )
    write_tokens_json(scales, SEMANTIC_MAPS, styles_dir / "tokens.json")
    write_tokens_css(styles_dir / "tokens.css")
    print("✓ Generated:")
    print(f"  {themes_dir / 'dark.css'}")
    print(f"  {themes_dir / 'light.css'}")
    print(f"  {themes_dir / 'low-detection.css'}")
    print(f"  {styles_dir / 'tokens.json'}")
    print(f"  {styles_dir / 'tokens.css'}")
```

- [ ] **Step 4: Optionally remove the now-unused `THEME_CONSTANTS` constant**

Find (around line 252-255):

```python
# Non-color constants applied to every theme block
THEME_CONSTANTS = {
    "radius": "0.375rem",  # used by shadcn components via rounded-[var(--radius)]
}
```

Delete this block — it's no longer referenced anywhere after Step 1's removal of the loop.

- [ ] **Step 5: Run the script**

```bash
cd /Users/skylight/Documents/Peat-Chat && python3 scripts/generate-tokens.py
```

Expected stdout:
```
✓ Generated:
  /path/.../themes/dark.css
  /path/.../themes/light.css
  /path/.../themes/low-detection.css
  /path/.../tokens.json
  /path/.../tokens.css
```

- [ ] **Step 6: Verify generated files**

```bash
head -5 web/src/styles/themes/dark.css
echo "---"
head -10 web/src/styles/tokens.css
echo "---"
ls -la web/src/styles/tokens.css
```

Expected:
- `dark.css` lines should now look like `  --color-surface-canvas: oklch(13.3% 0.002 196.9);` (NOT raw triplet without the `oklch()` wrapper).
- `tokens.css` exists and starts with `/* GENERATED by ... */` then `@theme {`.

If `--radius` is missing from `dark.css` (it should be — we removed it from per-theme), that's correct.

---

## Task 6: Rewrite `web/src/index.css` for v4

**Files:**
- Modify: `web/src/index.css`

Current content (after Pass 1-4):

```css
/* DTAK theme stylesheets — one set of CSS vars per mode */
@import './styles/themes/dark.css';
@import './styles/themes/light.css';
@import './styles/themes/low-detection.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

/* Default to dark mode if no data-theme is set on <html> */
:root { color-scheme: dark; }

body {
  @apply bg-surface-canvas text-fg-primary;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  margin: 0;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  -webkit-text-size-adjust: 100%;
}

#root {
  height: 100dvh;
  width: 100vw;
}

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #4b5563; }
```

- [ ] **Step 1: Replace the file's contents entirely**

Replace with:

```css
@import "tailwindcss";
@import "tw-animate-css";

/* DTAK theme stylesheets — one set of CSS vars per mode */
@import './styles/themes/dark.css';
@import './styles/themes/light.css';
@import './styles/themes/low-detection.css';

/* Generated @theme block (shadcn aliases + min-h-touch utility) */
@import './styles/tokens.css';

/* Default to dark mode if no data-theme is set on <html> */
:root { color-scheme: dark; }

body {
  @apply bg-surface-canvas text-fg-primary;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  margin: 0;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  -webkit-text-size-adjust: 100%;
}

#root {
  height: 100dvh;
  width: 100vw;
}

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #4b5563; }
```

Three changes from the original:
- `@tailwind base; @tailwind components; @tailwind utilities;` deleted.
- `@import "tailwindcss";` added at the top (replaces the three directives in v4).
- `@import "tw-animate-css";` added immediately after (replaces the `tailwindcss-animate` plugin).
- `@import './styles/tokens.css';` added after the theme imports (loads the new `@theme` block).

The `@apply bg-surface-canvas text-fg-primary` in `body` works in v4 because `bg-surface-canvas` and `text-fg-primary` resolve through the per-theme CSS vars (declared in `themes/dark.css` etc.), which v4 picks up automatically once `tokens.css`'s `@theme` block registers them.

The `::-webkit-scrollbar` raw hex colors stay — these aren't Tailwind utilities, just plain CSS targeting browser-internal pseudo-elements. Optional cleanup for later.

---

## Task 7: First end-to-end build (should now succeed)

**Files:** none (verification only)

This is the first task where the build is EXPECTED to pass.

- [ ] **Step 1: Run the build**

```bash
cd web && npm run build 2>&1 | tail -30
```

Expected: clean build. Output ends with `✓ built in <some-seconds>s`. Chunk-size warning (>500kB) is pre-existing and unrelated.

If build fails, common issues to check:
- `tw-animate-css` not installed (Task 2 should have done it)
- `tokens.css` missing or empty (rerun Task 5 step 5)
- Unrecognized `@theme` or `@utility` syntax → version of `tailwindcss` is wrong, expected ≥4.0.0

Capture the failure output if it occurs. Do not "fix" by reverting changes — the failure points at a specific Task 2/5/6 step that needs revisiting.

- [ ] **Step 2: Run tests**

```bash
cd web && npm run test 2>&1 | tail -10
```

Expected: 88/88 tests pass (the test runner uses Vite, which now uses the v4 plugin). The LD regression test (`web/src/components/ui/__tests__/ld-mode.test.tsx`) should still pass — it queries class presence as a fallback when jsdom can't resolve CSS vars.

- [ ] **Step 3: Smoke-check the dev server**

```bash
cd web && npm run dev
```

Wait for `Local: https://localhost:5173/` (or http if no certs). Open in a browser. Confirm:
- The app renders (no white screen).
- Background and text colors look right (dark mode default).
- Open DevTools → Elements → inspect any element → confirm `background-color` resolves to a real color (not `unset` or `transparent`).

Then `Ctrl+C` to stop the server.

If the page is blank or all-white, the most likely cause is `@theme` not registering. Check the import order in `index.css` (themes must come before tokens.css, both must come after `@import "tailwindcss"`).

---

## Task 8: Run the v4 codemod on TS/TSX files only

**Files:**
- Many `web/src/**/*.{tsx,ts}` (codemod-driven)

The codemod will rename ~15-20 utility classes across the codebase. Common renames documented in the spec.

Because `tailwind.config.js` was deleted in Task 3 and `index.css` was rewritten in Task 6, the codemod has nothing to do for config or directives — its only job is utility renames inside source files.

- [ ] **Step 1: Run the codemod**

```bash
cd web && npx @tailwindcss/upgrade@latest 2>&1 | tee /tmp/tw4-codemod.log
```

The codemod prints what it changed. If it asks any interactive questions, accept defaults UNLESS it asks to modify `tailwind.config.js`, `postcss.config.js`, or `index.css` — those are already handled, decline.

- [ ] **Step 2: Diff review**

```bash
cd /Users/skylight/Documents/Peat-Chat && git diff --stat HEAD web/src/
```

Confirm:
- Modifications limited to `web/src/components/`, `web/src/App.tsx`, etc. NO unexpected modifications to `web/src/styles/themes/*.css` or `web/src/styles/tokens.css` (those are generated; codemod should leave them alone).
- Modifications to `web/src/components/ui/*` (shadcn primitives) are expected — these have the most utility-class density.

Spot-check a sample of the diffs to verify renames look right:

```bash
git diff HEAD web/src/components/ui/button.tsx
git diff HEAD web/src/components/ui/dialog.tsx
git diff HEAD web/src/components/ui/select.tsx
```

Expected kinds of changes:
- `shadow-sm` → `shadow-xs`
- `shadow` → `shadow-sm`
- `outline-none` → `outline-hidden`
- `ring-offset-X` removed entirely or replaced
- `bg-opacity-X` / `text-opacity-X` rewritten as `bg-color/X` / `text-color/X`

Things that should NOT have been changed:
- DTAK token names (`bg-surface-1`, `text-fg-primary`, `border-border-subtle`, `bg-cot-friendly`, etc.) — codemod has no opinion on these custom tokens.
- shadcn alias names (`bg-primary`, `text-foreground`, etc.) — these are still valid in v4.

If you find DTAK or shadcn token renames that look wrong, list them in your report (don't blindly revert; controller decides).

- [ ] **Step 3: Verify build still passes after codemod**

```bash
cd web && npm run build 2>&1 | tail -10
```

Expected: clean build.

If build fails after codemod, the codemod likely renamed a class that doesn't exist in v4 (e.g., turned `ring-3` into something invalid). Check `git diff` for the offending class and revert that specific change.

- [ ] **Step 4: Verify tests pass**

```bash
cd web && npm run test 2>&1 | tail -10
```

Expected: 88/88 pass.

---

## Task 9: Hand-fix any codemod misses

**Files:** as needed (any `web/src/**/*.{tsx,ts}`)

The codemod is good but not perfect. Manual sweep for residual v3-only patterns.

- [ ] **Step 1: Grep for known-deprecated patterns**

```bash
cd web && grep -rEn "shadow-sm\b|outline-none\b|ring-offset-[a-z]|flex-shrink-[0-9]|flex-grow-[0-9]|bg-opacity-[0-9]|text-opacity-[0-9]" src 2>&1 | head -30
```

Expected: 0 matches (codemod handled them). If any remain:
- `shadow-sm` → `shadow-xs`
- `outline-none` → `outline-hidden`
- `ring-offset-X` (where X is a color) → delete the class (v4 ring model differs; offset is now controlled by `ring-inset`/`ring-outset`-like utilities, but most uses can simply be removed)
- `flex-shrink-X` → `shrink-X`
- `flex-grow-X` → `grow-X`
- `bg-opacity-50` / `text-opacity-50` → use `/50` slash notation on the bg/text utility (e.g., `bg-primary/50`)

Fix each remaining match with a targeted Edit.

- [ ] **Step 2: Verify build + tests after hand-fixes**

```bash
cd web && npm run build && npm run test 2>&1 | tail -10
```

Expected: clean build, 88/88 tests pass.

If you made no fixes in this task (codemod was thorough), still run the verify step to confirm no regressions.

---

## Task 10: Visual sweep (manual, controller does this)

**Files:** none (manual verification)

This task is for the CONTROLLER (the user, or you running interactively). It cannot be fully delegated to an implementer subagent because it requires human judgment on visual appearance.

- [ ] **Step 1: Start the dev server**

```bash
cd web && npm run dev
```

- [ ] **Step 2: Open the app in a browser**

Default to `https://localhost:5173/` (or http if no certs). Sign in or use the existing session.

- [ ] **Step 3: Walk every major surface, in dark mode**

- Sidebar (mobile + desktop breakpoints): rooms list, voice section, mesh section, hamburger button on mobile
- ChatView: message list scrolls, MessageInput textarea autogrows, send button enabled when text present
- MessageBubble: hover-shows reply / right-click context menu
- Settings (open from sidebar): scroll through all 7 sections (Theme, Profile, Audio Input, Audio Output, Voice, Network, Map). RadioGroup theme buttons should be small CIRCLES (not pills — the bug fixed earlier in v3). Sliders work, switches toggle.
- JoinRoomModal: open via "Join room" trigger; Dialog animates in; type a room name; submit
- MapViewer: panel renders, controls work, popovers open
- MarkerForm: open via map context; Form fields work; submit closes panel

- [ ] **Step 4: Switch to light mode in DevTools console**

```js
document.documentElement.setAttribute('data-theme', 'light')
```

Walk the same surfaces. Verify all colors update (no leftover dark-mode hardcodes).

- [ ] **Step 5: Switch to LD mode**

```js
document.documentElement.setAttribute('data-theme', 'ld')
```

Verify:
- No blue anywhere in chrome (banned in LD).
- No bright white (use red on black per LD spec).
- Touch targets feel larger (48px floor in LD vs 44px elsewhere).

- [ ] **Step 6: Animation check**

In any theme, open a Dialog (e.g., JoinRoomModal). Verify it fades in / scales in (not a hard cut). Open a Tooltip (hover any tooltipped button). Verify tooltip slides + fades in.

If animations are missing entirely, `tw-animate-css` may not have loaded — check `index.css` import order.

- [ ] **Step 7: Stop the server**

`Ctrl+C` in the terminal running `npm run dev`.

If anything looked wrong, return to that file and fix. Re-run Task 9 step 2 (`npm run build && npm run test`) before proceeding.

---

## Task 11: Update CLAUDE.md hard rules

**Files:**
- Modify: `CLAUDE.md`

Two rules need adjustment after the v4 migration.

- [ ] **Step 1: Read current CLAUDE.md hard rules section**

```bash
sed -n '/Hard rules for AI work in this repo/,/^##/p' CLAUDE.md | head -80
```

Note current text of rules #2 (no `pl-*` classes) and #6 (token changes go through `scripts/generate-tokens.py`).

- [ ] **Step 2: Update rule #2 (the `pl-*` rule)**

The `pl-*` shim was removed when `tailwind.config.js` was deleted. The rule is now obsolete — `pl-2`, `pl-4`, etc. are normal Tailwind padding utilities and are fine to use.

Edit rule #2 from:

```markdown
2. **Never use `pl-*` classes in new code.** Those are deprecated. They still work via a compatibility shim in `tailwind.config.js`, but new code must use DTAK semantic tokens. See `docs/dtak/06-migration.md`.
```

to:

```markdown
2. **`pl-*` migration complete.** The legacy DTAK `pl-*` shim classes (pl-bg, pl-sidebar, etc.) were removed during the shadcn migration. `pl-2`, `pl-4`, etc. are now normal Tailwind padding utilities and are fine.
```

- [ ] **Step 3: Update rule #6 (the token script rule)**

The script now emits an additional file (`tokens.css`) and the per-theme CSS form changed. Edit rule #6 from:

```markdown
6. **Changing tokens?** Edit `scripts/generate-tokens.py` (anchors or `SEMANTIC_MAPS`), run `python3 scripts/generate-tokens.py`, commit the regenerated `tokens.json` + theme CSS files.
```

to:

```markdown
6. **Changing tokens?** Edit `scripts/generate-tokens.py` (anchors, `SEMANTIC_MAPS`, or the `@theme` block in `write_tokens_css`), run `python3 scripts/generate-tokens.py`, commit the regenerated `tokens.json`, theme CSS files, and `tokens.css`.
```

- [ ] **Step 4: Update the "Key files" table to mention tokens.css**

Find the table row for "Token source of truth":

```markdown
| Token source of truth | `web/src/styles/tokens.json` (generated) |
```

Add a new row immediately after for the v4 `@theme` file:

```markdown
| Token source of truth | `web/src/styles/tokens.json` (generated) |
| v4 `@theme` block | `web/src/styles/tokens.css` (generated) |
```

- [ ] **Step 5: Verify CLAUDE.md still parses**

```bash
head -100 CLAUDE.md
```

Confirm the file structure is intact (no broken markdown).

---

## Task 12: Final verification

**Files:** none

End-to-end sanity check before phase stop.

- [ ] **Step 1: Confirm dep state**

```bash
cd web && npm ls tailwindcss @tailwindcss/vite tw-animate-css tailwindcss-animate autoprefixer postcss 2>&1 | head -15
```

Expected:
- `tailwindcss@4.x.x` ✓
- `@tailwindcss/vite@4.x.x` ✓
- `tw-animate-css@*` ✓
- `tailwindcss-animate` — NOT FOUND (uninstalled in T2)
- `autoprefixer` — NOT FOUND (uninstalled in T2)
- `postcss` — may or may not still be a transitive dep (Vite uses it internally)

- [ ] **Step 2: Confirm file state**

```bash
ls web/postcss.config.js 2>&1 || echo "OK postcss.config.js gone"
ls web/tailwind.config.js 2>&1 || echo "OK tailwind.config.js gone"
ls web/src/styles/tokens.css 2>&1 || echo "MISSING tokens.css"
head -3 web/src/styles/tokens.css
head -3 web/src/styles/themes/dark.css
head -3 web/src/index.css
```

Expected:
- `postcss.config.js` and `tailwind.config.js` print "OK ... gone".
- `tokens.css` exists and starts with `/* GENERATED ... */`.
- `dark.css` first content line should look like `[data-theme="dark"] {`, with subsequent lines using `oklch(...)` values.
- `index.css` starts with `@import "tailwindcss";`.

- [ ] **Step 3: Final build + test**

```bash
cd web && npm run build && npm run test 2>&1 | tail -15
```

Expected: clean build, 88/88 tests pass.

- [ ] **Step 4: Capacitor sync (optional but recommended)**

```bash
cd web && npm run build
cd /Users/skylight/Documents/Peat-Chat && npx cap sync ios
cd /Users/skylight/Documents/Peat-Chat && npx cap sync android
```

Sync should complete without errors. Actually opening Xcode/Android Studio simulators is a manual user step (deferred — controller's call).

- [ ] **Step 5: Final git status snapshot**

```bash
git status --short
git diff --stat HEAD | tail -15
```

This output goes to your final report so the user knows exactly what changed before they commit.

---

## PHASE STOP — User commits the v4 migration

After all tasks complete, the controller pauses. The user reviews the diff and commits the v4 migration as one atomic change.

**Suggested commit message:**

```
Upgrade to Tailwind 4 with CSS-first config

- Tailwind 3.4 → 4.x; @tailwindcss/vite plugin replaces PostCSS pipeline
- tailwindcss-animate → tw-animate-css (drop-in replacement, same class names)
- autoprefixer dropped (Lightning CSS handles vendor prefixing)
- tailwind.config.js + postcss.config.js deleted; @theme block lives in
  generated web/src/styles/tokens.css emitted by scripts/generate-tokens.py
- Per-theme CSS files now emit oklch(...) function values (full form), enabling
  v4's native bg-primary/50 opacity syntax
- Codemod-driven utility renames across web/src/ (shadow-sm→xs, outline-none→
  hidden, ring-offset-* removed, etc.)
- CLAUDE.md hard rules #2 and #6 updated; pl-* migration declared complete
```

---

## Spec Coverage Audit

| Spec section | Implemented in task(s) |
|---|---|
| Codemod-first approach | Task 8 |
| CSS-first config (`@theme` in CSS) | Task 5 (script extension), Task 6 (index.css import) |
| Switch to `tw-animate-css` | Task 2 (install), Task 6 (import) |
| `@tailwindcss/vite` plugin | Task 2 (install), Task 4 (vite.config.ts wire) |
| Drop autoprefixer | Task 2 (uninstall) |
| Browser baseline (Safari 16.4+, Chrome 111+) | Implicit — accepted; no action needed |
| Token regen with full `oklch()` form | Task 5 step 1 |
| Generated `tokens.css` with `@theme` block | Task 5 steps 2-3 |
| `@utility min-h-touch` rule | Task 5 step 2 |
| `legacyPlCompat` removal | Implicit (tailwind.config.js deleted in Task 3) |
| index.css restructure | Task 6 |
| Codemod expected changes | Task 8 |
| Files codemod should NOT touch | Task 8 step 2 |
| Per-section verification | Tasks 7, 8 step 3, 9 step 2, 10, 12 |
| End-to-end verification | Task 12 |
| Capacitor verify | Task 12 step 4 |
| Rollback strategy | Implicit — branch isolation enables `git checkout zgehin/design-system-shadcn` |
| CLAUDE.md updates (rules #2 and #6) | Task 11 |
| Out-of-scope items (shadcn CLI v4 reinit, browserslist, LD marker palette) | Documented in spec; not addressed by tasks (correct) |

All spec sections covered.
