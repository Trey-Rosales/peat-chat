# Responsive TAK Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single responsive shell that mirrors ATAK / iTAK / WinTAK — full-bleed map background with overlay TopBar, MapRail, ActiveCallStrip, OverlaySheets, and a `ContextSurface` that adapts host (panel / side sheet / Vaul snap-point drawer) based on breakpoint and orientation.

**Architecture:** A new `<AppShell>` composes six fixed-position slots over `<MapBackground>`. A polymorphic `<ContextSurface>` chooses among `ContextPanel`, `ContextSideSheet`, and `ContextDrawer` via two new hooks (`useBreakpoint`, `useOrientation`). The existing `Sidebar`, `ChatView`, `SettingsPage`, `JoinRoomModal`, `MeshViewer`, `MarkerForm`, `VoiceBar`, `PTTButton`, and `MapViewer` are re-hosted, not rewritten.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 4 + shadcn/ui + Vaul (to install) + Zustand. Tests: Vitest + @testing-library/react.

**Spec:** [`docs/superpowers/specs/2026-05-19-responsive-tak-layout-design.md`](../specs/2026-05-19-responsive-tak-layout-design.md)

---

## Conventions

- **No raw hex.** All colors via DTAK semantic tokens (`bg-surface-1`, `text-fg-primary`, `border-border-subtle`, `bg-brand`, `bg-status-critical`, `bg-status-success`).
- **No commits from the assistant.** The user reviews and commits between tasks. After each task, stop at the verification step.
- **No feature flag — inline replacement.** Task 1.5 deletes the old `App.tsx` return JSX and replaces it with `<AppShell />`. Intermediate phases will render a partially-functional app (e.g., empty shell after Phase 1; map + topbar but no channels after Phase 2). Each commit is a rollback point. The user reviews each commit before the next task; broken intermediate states are acceptable during the refactor.
- **Tests run from:** `cd web && npm test -- --run <pattern>` (one-shot) or `cd web && npm test` (watch).
- **Type-check after every task:** `cd web && npm run build` (or `tsc --noEmit` if exposed).
- **Visual verification:** open the dev server (`cd web && npm run dev`) and verify in three themes (Dark / Light / LD) × three breakpoints (desktop / landscape mobile / portrait mobile). Use Chrome DevTools device toolbar.

---

## File Structure

New files:

```
web/src/components/layout/
├── AppShell.tsx
├── TopBar.tsx
├── MapBackground.tsx
├── MapRail.tsx
├── ContextSurface.tsx
├── ContextDrawer.tsx
├── ContextSideSheet.tsx
├── ContextPanel.tsx
├── ContextStack.tsx
├── ActiveCallStrip.tsx
└── OverlaySheets.tsx

web/src/hooks/
├── useBreakpoint.ts
├── useBreakpoint.test.ts
├── useOrientation.ts
└── useOrientation.test.ts

web/src/components/ui/
└── drawer.tsx                      # shadcn-style Vaul wrapper, added Phase 6
```

Modified files:

```
web/src/App.tsx                     # gated AppShell mount + feature flag
web/src/store/chatStore.ts          # new flags: menuOpen, joinRoomOpen; contextStack slice
web/src/components/MapViewer.tsx    # remove top-left count badge, bottom-right HUD, style switcher
web/src/components/Sidebar.tsx      # strip workspace/identity header (covered by TopBar)
web/src/components/ChatView.tsx     # ensure back-arrow header renders inside ContextStack
web/src/components/VoiceBar.tsx     # extract data flow used by ActiveCallStrip
web/package.json                    # add `vaul`
```

---

# Phase 1 — Hooks + Skeleton

Goal: scaffold layout components and hooks behind a feature flag. No visible behavior change while the flag is off.

## Task 1.1: Add `useBreakpoint` hook

**Files:**
- Create: `web/src/hooks/useBreakpoint.ts`
- Create: `web/src/hooks/useBreakpoint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/useBreakpoint.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBreakpoint } from './useBreakpoint'

function mockMatchMedia(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      // crude parse for `(min-width: Npx)`
      const m = query.match(/min-width:\s*(\d+)px/)
      const minWidth = m ? Number(m[1]) : 0
      return {
        matches: width >= minWidth,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
    }),
  })
}

describe('useBreakpoint', () => {
  beforeEach(() => {
    mockMatchMedia(1280)
  })

  it('returns "desktop" at ≥ 1024px', () => {
    mockMatchMedia(1280)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it('returns "tablet" at 768..1023px', () => {
    mockMatchMedia(900)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('returns "mobile" at < 768px', () => {
    mockMatchMedia(390)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```
cd web && npm test -- --run src/hooks/useBreakpoint.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `web/src/hooks/useBreakpoint.ts`:

```ts
import { useEffect, useState } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

const QUERIES = {
  desktop: '(min-width: 1024px)',
  tablet: '(min-width: 768px)',
} as const

function read(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop'
  if (window.matchMedia(QUERIES.desktop).matches) return 'desktop'
  if (window.matchMedia(QUERIES.tablet).matches) return 'tablet'
  return 'mobile'
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(read)

  useEffect(() => {
    const update = () => setBp(read())
    const desktopMql = window.matchMedia(QUERIES.desktop)
    const tabletMql = window.matchMedia(QUERIES.tablet)
    desktopMql.addEventListener('change', update)
    tabletMql.addEventListener('change', update)
    return () => {
      desktopMql.removeEventListener('change', update)
      tabletMql.removeEventListener('change', update)
    }
  }, [])

  return bp
}
```

- [ ] **Step 4: Run test to confirm it passes**

```
cd web && npm test -- --run src/hooks/useBreakpoint.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check**

```
cd web && npm run build
```
Expected: no errors.

---

## Task 1.2: Add `useOrientation` hook

**Files:**
- Create: `web/src/hooks/useOrientation.ts`
- Create: `web/src/hooks/useOrientation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/useOrientation.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useOrientation } from './useOrientation'

function mockOrientation(portrait: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('portrait') ? portrait : !portrait,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('useOrientation', () => {
  it('returns "portrait" when portrait media query matches', () => {
    mockOrientation(true)
    const { result } = renderHook(() => useOrientation())
    expect(result.current).toBe('portrait')
  })

  it('returns "landscape" when portrait media query does not match', () => {
    mockOrientation(false)
    const { result } = renderHook(() => useOrientation())
    expect(result.current).toBe('landscape')
  })
})
```

- [ ] **Step 2: Run test, expect FAIL (module not found)**

```
cd web && npm test -- --run src/hooks/useOrientation.test.ts
```

- [ ] **Step 3: Implement the hook**

Create `web/src/hooks/useOrientation.ts`:

```ts
import { useEffect, useState } from 'react'

export type Orientation = 'portrait' | 'landscape'

const QUERY = '(orientation: portrait)'

function read(): Orientation {
  if (typeof window === 'undefined') return 'portrait'
  return window.matchMedia(QUERY).matches ? 'portrait' : 'landscape'
}

export function useOrientation(): Orientation {
  const [o, setO] = useState<Orientation>(read)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const update = () => setO(read())
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  return o
}
```

- [ ] **Step 4: Run test, expect PASS**

```
cd web && npm test -- --run src/hooks/useOrientation.test.ts
```

---

## Task 1.3: Extend `chatStore` with menu/join-room flags and context-stack slice

**Files:**
- Modify: `web/src/store/chatStore.ts`

- [ ] **Step 1: Add types and initial state for new flags**

In `web/src/store/chatStore.ts`, add to the `ChatStore` interface near the existing `settingsOpen` / `meshViewerOpen` fields:

```ts
  // Layout overlay sheets
  menuOpen: boolean
  toggleMenu: () => void
  joinRoomOpen: boolean
  setJoinRoomOpen: (open: boolean) => void

  // Context navigation stack (drawer / panel content)
  contextStack: Array<{ route: 'list' } | { route: 'chat'; roomId: string }>
  pushContextRoute: (route: { route: 'chat'; roomId: string }) => void
  popContextRoute: () => void
  resetContextStack: () => void
```

In the store factory (the `create<ChatStore>()((set, get) => ({ ... }))` body), add the corresponding initial state and actions next to the existing `settingsOpen` block:

```ts
  menuOpen: false,
  toggleMenu: () => set({ menuOpen: !get().menuOpen }),
  joinRoomOpen: false,
  setJoinRoomOpen: (open) => set({ joinRoomOpen: open }),

  contextStack: [{ route: 'list' }],
  pushContextRoute: (route) =>
    set({ contextStack: [...get().contextStack, route] }),
  popContextRoute: () => {
    const stack = get().contextStack
    if (stack.length <= 1) return
    set({ contextStack: stack.slice(0, -1) })
  },
  resetContextStack: () => set({ contextStack: [{ route: 'list' }] }),
```

- [ ] **Step 2: Type-check**

```
cd web && npm run build
```
Expected: no errors.

- [ ] **Step 3: Run the full existing test suite to confirm no regressions**

```
cd web && npm test -- --run
```
Expected: all existing tests pass (no new tests added in this step; the slice is small enough that store-level tests aren't required, but if `chatStore.test.ts` exists, all pass).

---

## Task 1.4: Create layout component skeletons

**Files:**
- Create: `web/src/components/layout/AppShell.tsx`
- Create: `web/src/components/layout/TopBar.tsx`
- Create: `web/src/components/layout/MapBackground.tsx`
- Create: `web/src/components/layout/MapRail.tsx`
- Create: `web/src/components/layout/ContextSurface.tsx`
- Create: `web/src/components/layout/ContextDrawer.tsx`
- Create: `web/src/components/layout/ContextSideSheet.tsx`
- Create: `web/src/components/layout/ContextPanel.tsx`
- Create: `web/src/components/layout/ContextStack.tsx`
- Create: `web/src/components/layout/ActiveCallStrip.tsx`
- Create: `web/src/components/layout/OverlaySheets.tsx`

- [ ] **Step 1: Create the skeleton files**

Each file is a minimal placeholder that compiles. Filled in by later phases.

`web/src/components/layout/AppShell.tsx`:
```tsx
import { MapBackground } from './MapBackground'
import { TopBar } from './TopBar'
import { MapRail } from './MapRail'
import { ActiveCallStrip } from './ActiveCallStrip'
import { ContextSurface } from './ContextSurface'
import { ContextStack } from './ContextStack'
import { OverlaySheets } from './OverlaySheets'

export function AppShell() {
  return (
    <MapBackground>
      <TopBar />
      <MapRail />
      <ActiveCallStrip />
      <ContextSurface>
        <ContextStack />
      </ContextSurface>
      <OverlaySheets />
    </MapBackground>
  )
}
```

`web/src/components/layout/MapBackground.tsx`:
```tsx
import type { ReactNode } from 'react'

interface Props { children: ReactNode }

export function MapBackground({ children }: Props) {
  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-surface-canvas">
      {/* Map mounts here in Phase 2 */}
      {children}
    </div>
  )
}
```

`web/src/components/layout/TopBar.tsx`:
```tsx
export function TopBar() {
  return <div data-layout="topbar" />
}
```

`web/src/components/layout/MapRail.tsx`:
```tsx
export function MapRail() {
  return <div data-layout="map-rail" />
}
```

`web/src/components/layout/ActiveCallStrip.tsx`:
```tsx
export function ActiveCallStrip() {
  return null
}
```

`web/src/components/layout/ContextSurface.tsx`:
```tsx
import type { ReactNode } from 'react'

interface Props { children: ReactNode }

export function ContextSurface({ children }: Props) {
  return <>{children}</>
}
```

`web/src/components/layout/ContextDrawer.tsx`:
```tsx
import type { ReactNode } from 'react'
export function ContextDrawer({ children }: { children: ReactNode }) {
  return <>{children}</>
}
```

`web/src/components/layout/ContextSideSheet.tsx`:
```tsx
import type { ReactNode } from 'react'
export function ContextSideSheet({ children }: { children: ReactNode }) {
  return <>{children}</>
}
```

`web/src/components/layout/ContextPanel.tsx`:
```tsx
import type { ReactNode } from 'react'
export function ContextPanel({ children }: { children: ReactNode }) {
  return <>{children}</>
}
```

`web/src/components/layout/ContextStack.tsx`:
```tsx
export function ContextStack() {
  return <div data-layout="context-stack" />
}
```

`web/src/components/layout/OverlaySheets.tsx`:
```tsx
export function OverlaySheets() {
  return null
}
```

- [ ] **Step 2: Type-check**

```
cd web && npm run build
```
Expected: no errors. Skeletons compile.

---

## Task 1.5: Replace `App.tsx` return with `<AppShell />`

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add the AppShell import**

At the top of `web/src/App.tsx`, add to the existing import block:

```tsx
import { AppShell } from './components/layout/AppShell'
```

- [ ] **Step 2: Replace the return JSX**

Inside `export default function App()`, find the existing `return (...)` JSX block and replace it with:

```tsx
  return <AppShell />
```

**Leave all hooks untouched** — keep every `useState`, `useRef`, `useEffect`, `useCallback`, `useTheme`, `useWebSocket`, `usePTT`, `useGeolocation`, etc. The state they own will flow into `AppShell` via props as Phases 3 and 8 wire up PTT and voice handlers. Some local state (`showJoinModal`, `sidebarOpen`, `nameInput`) becomes unreferenced after this change — leave it for now; a later phase sweeps dead state.

- [ ] **Step 3: Build**

```
cd web && npm run build
```
Expected: build succeeds. (TypeScript may warn about unused locals — that's acceptable for this phase.)

- [ ] **Step 4: Smoke test**

Run `cd web && npm run dev`. Expected: a blank dark surface (AppShell is currently an empty `MapBackground`). This is the expected intermediate state — subsequent phases fill it in.

---

# Phase 2 — MapBackground + TopBar

## Task 2.1: Move `MapViewer` into `MapBackground`

**Files:**
- Modify: `web/src/components/layout/MapBackground.tsx`

- [ ] **Step 1: Mount MapViewer inside MapBackground**

Replace `web/src/components/layout/MapBackground.tsx` with:

```tsx
import type { ReactNode } from 'react'
import { MapViewer } from '../MapViewer'

interface Props { children: ReactNode }

export function MapBackground({ children }: Props) {
  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-surface-canvas">
      <div className="absolute inset-0 z-0">
        <MapViewer />
      </div>
      <div className="absolute inset-0 z-10 pointer-events-none">
        <div className="pointer-events-auto">{children}</div>
      </div>
    </div>
  )
}
```

Note: `MapViewer` currently expects no props for this mount; if `web/src/components/MapViewer.tsx` requires props, pass them through. Inspect MapViewer's signature before writing — if it requires args, extend the `MapBackground` props interface and forward them.

- [ ] **Step 2: Type-check + visual smoke test**

```
cd web && npm run build
```
Then flip `USE_NEW_LAYOUT = true`, open the dev server. Expected: full-bleed map renders. Old MapViewer overlays (count badge, HUD, style switcher) still show — they'll be removed in Phase 3.

Flip flag back to `false` when done.

---

## Task 2.2: Build the TopBar

**Files:**
- Modify: `web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Implement TopBar with real data only**

Replace `web/src/components/layout/TopBar.tsx` with:

```tsx
import { Menu } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { cn } from '@/lib/utils'

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatLatLon(lat: number, lon: number): string {
  return `${lat.toFixed(2)}° / ${lon.toFixed(2)}°`
}

export function TopBar() {
  const bp = useBreakpoint()
  const displayName = useChatStore((s) => s.displayName) || 'Operator'
  const selfPosition = useChatStore((s) => s.selfPosition)
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const roomName = useChatStore((s) => (activeRoomId ? s.rooms[activeRoomId]?.name : undefined))
  const toggleMenu = useChatStore((s) => s.toggleMenu)

  const initials = initialsFrom(displayName)
  const geo = selfPosition ? formatLatLon(selfPosition.lat, selfPosition.lon) : null
  const isPortrait = bp === 'mobile' // narrow phones — two-row layout

  return (
    <header
      data-layout="topbar"
      className={cn(
        'absolute inset-x-0 top-0 z-10 flex items-center gap-3 border-b border-border-subtle bg-surface-1/85 backdrop-blur-sm px-3 text-fg-primary',
        isPortrait ? 'h-12 flex-wrap py-1.5' : bp === 'tablet' ? 'h-8 text-xs' : 'h-10',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarFallback className="bg-surface-2 text-xs text-fg-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="truncate font-semibold tracking-wide">{displayName}</span>
      </div>

      <div className={cn('flex min-w-0 items-center gap-3 text-fg-secondary', isPortrait ? 'order-3 w-full text-[11px]' : 'text-xs')}>
        {geo && <span className="truncate font-mono">{geo}</span>}
        {roomName && (
          <>
            <span aria-hidden className="opacity-50">·</span>
            <span className="truncate">{roomName}</span>
          </>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="ml-auto h-11 w-11 shrink-0 text-fg-secondary hover:text-fg-primary"
        aria-label="Open menu"
        onClick={toggleMenu}
      >
        <Menu className="h-5 w-5" />
      </Button>
    </header>
  )
}
```

- [ ] **Step 2: Type-check**

```
cd web && npm run build
```
Expected: no errors. (If `selfPosition` is not in `chatStore` exports, verify the field — spec confirms it exists; `getState().selfPosition` should be `{lat,lon,hae,ce} | null`.)

- [ ] **Step 3: Visual verification**

Flip `USE_NEW_LAYOUT = true`. Open dev server, in DevTools device toolbar test:
- Desktop (1280×800) — 40px row, all slots visible.
- Tablet (900×600) — 32px slim row.
- Phone portrait (390×844) — 48px two-row.
- Phone landscape (844×390) — 32px slim row.

In all three themes (Dark/Light/LD via Settings), confirm:
- No blue on LD (the avatar fallback uses `bg-surface-2`, the menu icon uses `text-fg-secondary`).
- Touch target on `☰` is ≥ 44px (✓ — `h-11 w-11`).

Flip flag back to `false` when done.

---

# Phase 3 — MapRail

## Task 3.1: Build the MapRail with PTT + map-style controls

**Files:**
- Modify: `web/src/components/layout/MapRail.tsx`

- [ ] **Step 1: Read the existing `cycleStyle` and `effectiveStyle` from MapViewer**

Inspect `web/src/components/MapViewer.tsx` to confirm how `cycleStyle` is currently invoked and whether `effectiveStyle` / `availableStyles` are local state or props. If they are local state inside MapViewer, we will lift them to a small Zustand slice in this task (preferred — they belong with other UI state).

If lifted, add to `web/src/store/chatStore.ts` near the existing UI flags:

```ts
  // Map style
  mapStyle: 'dark' | 'light' | 'topo' | 'satellite'
  cycleMapStyle: () => void
```

And in the store factory:

```ts
  mapStyle: 'dark',
  cycleMapStyle: () => {
    const order: Array<'dark' | 'light' | 'topo' | 'satellite'> = ['dark', 'light', 'topo', 'satellite']
    const i = order.indexOf(get().mapStyle)
    const next = order[(i + 1) % order.length]
    set({ mapStyle: next })
  },
```

Then in `MapViewer.tsx`, replace the local `cycleStyle` state with `useChatStore((s) => s.mapStyle)` and `useChatStore((s) => s.cycleMapStyle)`, and remove the inline top-left style switcher button (kept for the in-task removal step, but the source of truth is now the store).

- [ ] **Step 2: Implement MapRail**

Replace `web/src/components/layout/MapRail.tsx` with:

```tsx
import { Mic, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'
import { usePTTContext } from '@/components/layout/AppShell' // see step 3
import { cn } from '@/lib/utils'
import { useBreakpoint } from '@/hooks/useBreakpoint'

export function MapRail() {
  const bp = useBreakpoint()
  const cycleMapStyle = useChatStore((s) => s.cycleMapStyle)
  const { pttActive, onPTTStart, onPTTEnd } = usePTTContext()

  const size = bp === 'mobile' ? 'h-10 w-10' : 'h-11 w-11'

  return (
    <div
      data-layout="map-rail"
      className={cn(
        'absolute z-10 flex flex-col gap-2',
        bp === 'mobile' ? 'left-2 top-16' : 'left-3 top-14',
      )}
    >
      <Button
        variant={pttActive ? 'destructive' : 'secondary'}
        size="icon"
        aria-label="Push to talk"
        className={cn(
          size,
          'rounded-full border border-border-default bg-surface-1/70 backdrop-blur-sm shadow-md',
          pttActive && 'animate-pulse border-status-critical text-status-critical',
        )}
        onTouchStart={(e) => { e.preventDefault(); onPTTStart() }}
        onTouchEnd={(e) => { e.preventDefault(); onPTTEnd() }}
        onMouseDown={onPTTStart}
        onMouseUp={onPTTEnd}
        onMouseLeave={() => { if (pttActive) onPTTEnd() }}
      >
        <Mic className="h-5 w-5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Cycle map style"
        className={cn(size, 'rounded-full border border-border-subtle bg-surface-1/60 backdrop-blur-sm text-fg-secondary hover:text-fg-primary')}
        onClick={cycleMapStyle}
      >
        <Layers className="h-5 w-5" />
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Provide PTT context inside AppShell**

The current PTT wiring in `App.tsx` calls `usePTT(send, voiceManagerRef.current)` and uses local handlers for press/release. We need those handlers reachable from `MapRail`. Add a tiny context in `web/src/components/layout/AppShell.tsx`:

Replace `web/src/components/layout/AppShell.tsx` with:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { MapBackground } from './MapBackground'
import { TopBar } from './TopBar'
import { MapRail } from './MapRail'
import { ActiveCallStrip } from './ActiveCallStrip'
import { ContextSurface } from './ContextSurface'
import { ContextStack } from './ContextStack'
import { OverlaySheets } from './OverlaySheets'

interface PTTContextValue {
  pttActive: boolean
  onPTTStart: () => void
  onPTTEnd: () => void
}

const PTTContext = createContext<PTTContextValue | null>(null)

export function usePTTContext(): PTTContextValue {
  const ctx = useContext(PTTContext)
  if (!ctx) throw new Error('usePTTContext must be used inside <AppShell>')
  return ctx
}

interface Props {
  ptt: PTTContextValue
  children?: ReactNode
}

export function AppShell({ ptt }: Props) {
  const value = useMemo(() => ptt, [ptt.pttActive, ptt.onPTTStart, ptt.onPTTEnd])
  return (
    <PTTContext.Provider value={value}>
      <MapBackground>
        <TopBar />
        <MapRail />
        <ActiveCallStrip />
        <ContextSurface>
          <ContextStack />
        </ContextSurface>
        <OverlaySheets />
      </MapBackground>
    </PTTContext.Provider>
  )
}
```

Update `web/src/App.tsx` so the AppShell receives the PTT props:

```tsx
  return (
    <AppShell
      ptt={{
        pttActive: pttActive,           // existing local state from usePTT
        onPTTStart: handlePTTStart,     // existing handler
        onPTTEnd: handlePTTEnd,         // existing handler
      }}
    />
  )
```

Note: confirm the actual names in `App.tsx`. The current `usePTT(send, voiceManagerRef.current)` hook may return `{ active, start, stop }` or similar; map those to the `ptt` prop names accordingly.

- [ ] **Step 4: Type-check + visual verification**

```
cd web && npm run build
```
Then with `USE_NEW_LAYOUT = true`, verify in dev server: PTT button visible top-left, pulses red when held; Layers button cycles the map style.

Flip flag back to `false`.

---

## Task 3.2: Remove redundant overlays from `MapViewer`

**Files:**
- Modify: `web/src/components/MapViewer.tsx`

- [ ] **Step 1: Remove the bottom-right callsign HUD**

In `web/src/components/MapViewer.tsx` (around lines 287–302 per current source), delete the block beginning with `{/* Bottom-right: callsign HUD (TAK-style), above attribution */}` and ending at the closing `</div>` of that block. The TopBar now displays the same data.

- [ ] **Step 2: Remove the top-left contact-count + style switcher block**

Still in `MapViewer.tsx` (around lines 263–284), delete the block beginning with `{/* Top-left: contact/marker count + style switcher */}` and ending at its closing `</div>`. The style switcher is now in `MapRail`. The contact count is dropped for v1 (see spec — open question resolved: not folding into TopBar, not re-adding elsewhere).

- [ ] **Step 3: Remove the `cycleStyle` / `effectiveStyle` local state**

Also in `MapViewer.tsx`, remove the local `const [style, setStyle] = useState(...)` (or equivalent) and `cycleStyle` function — they were lifted to the store in Task 3.1. Replace the place where the map's style is consumed with `useChatStore((s) => s.mapStyle)`.

- [ ] **Step 4: Type-check + visual verification**

```
cd web && npm run build
```
With `USE_NEW_LAYOUT = true`, confirm:
- Map no longer shows the old top-left badge or bottom-right HUD.
- The map style still updates when the rail Layers button is clicked.

With `USE_NEW_LAYOUT = false`, confirm:
- The old layout no longer shows the bottom-right HUD or top-left badge either (they're gone permanently from MapViewer).
- The old layout's behavior is otherwise unchanged. (Acceptable — the data those overlays showed is also gone from the old layout. If the old layout still ships to users in any phase, this is a regression worth surfacing; otherwise it's fine because the new layout always covers it.)

Flip flag back to `false` when done.

---

# Phase 4 — ContextStack + ContextPanel (Desktop)

## Task 4.1: Strip the workspace/identity header from `Sidebar.tsx`

**Files:**
- Modify: `web/src/components/Sidebar.tsx`

- [ ] **Step 1: Inspect current Sidebar header**

Open `web/src/components/Sidebar.tsx`. Identify the top section that renders the workspace name + display-name pill (or any combination of identity/avatar/workspace metadata at the top). The TopBar covers identity now; the in-drawer/in-panel content should start at search + groups list directly.

- [ ] **Step 2: Remove the redundant header block**

Delete the workspace/identity header JSX. Keep:
- The search input.
- The groups list.
- The DMs list.
- The "join room" trigger button (if it lives here — see Task 4.2 for routing it through `setJoinRoomOpen`).

- [ ] **Step 3: Type-check + verify old layout still works**

```
cd web && npm run build
```
With `USE_NEW_LAYOUT = false`, confirm the existing layout still renders correctly — the old layout previously included the Sidebar header but now does not. Acceptable for this transitional phase since Phase 9 cleanup removes the old layout entirely.

---

## Task 4.2: Build `ContextStack`

**Files:**
- Modify: `web/src/components/layout/ContextStack.tsx`
- Modify: `web/src/components/ChatView.tsx`

- [ ] **Step 1: Implement ContextStack**

Replace `web/src/components/layout/ContextStack.tsx` with:

```tsx
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'
import { Sidebar } from '@/components/Sidebar'
import { ChatView } from '@/components/ChatView'
import { useBreakpoint } from '@/hooks/useBreakpoint'

export function ContextStack() {
  const stack = useChatStore((s) => s.contextStack)
  const popContextRoute = useChatStore((s) => s.popContextRoute)
  const bp = useBreakpoint()

  const top = stack[stack.length - 1]

  if (top.route === 'list') {
    return (
      <div data-layout="context-stack" className="flex h-full flex-col">
        <Sidebar />
      </div>
    )
  }

  // chat route
  return (
    <div data-layout="context-stack" className="flex h-full flex-col">
      {bp !== 'desktop' && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to channel list"
            className="h-11 w-11 text-fg-secondary"
            onClick={popContextRoute}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ChatView roomId={top.roomId} />
      </div>
    </div>
  )
}
```

Note: confirm that `<ChatView roomId={...} />` is the existing signature. If `ChatView` derives the active room from the store instead, drop the prop and ensure tapping a channel sets `activeRoomId` in addition to pushing the route (do that in step 2).

- [ ] **Step 2: Update Sidebar's channel-tap behavior to push the route**

In `web/src/components/Sidebar.tsx`, find the handler that runs when the user taps a channel/room (likely calls `setActiveRoom(id)`). Add a call to `pushContextRoute` so the stack advances:

```ts
const pushContextRoute = useChatStore((s) => s.pushContextRoute)
const setActiveRoom = useChatStore((s) => s.setActiveRoom)

function handleSelectRoom(id: string) {
  setActiveRoom(id)
  pushContextRoute({ route: 'chat', roomId: id })
}
```

- [ ] **Step 3: Type-check**

```
cd web && npm run build
```
Expected: no errors.

---

## Task 4.3: Build `ContextPanel` and wire `ContextSurface`

**Files:**
- Modify: `web/src/components/layout/ContextPanel.tsx`
- Modify: `web/src/components/layout/ContextSurface.tsx`

- [ ] **Step 1: Implement ContextPanel**

Replace `web/src/components/layout/ContextPanel.tsx` with:

```tsx
import type { ReactNode } from 'react'

interface Props { children: ReactNode }

export function ContextPanel({ children }: Props) {
  return (
    <aside
      data-layout="context-panel"
      className="absolute right-3 top-14 bottom-3 z-20 w-[320px] overflow-hidden rounded-lg border border-border-subtle bg-surface-1/90 backdrop-blur-sm shadow-lg"
    >
      {children}
    </aside>
  )
}
```

- [ ] **Step 2: Route ContextSurface by breakpoint/orientation**

Replace `web/src/components/layout/ContextSurface.tsx` with:

```tsx
import type { ReactNode } from 'react'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useOrientation } from '@/hooks/useOrientation'
import { ContextPanel } from './ContextPanel'
import { ContextSideSheet } from './ContextSideSheet'
import { ContextDrawer } from './ContextDrawer'

interface Props { children: ReactNode }

export function ContextSurface({ children }: Props) {
  const bp = useBreakpoint()
  const orientation = useOrientation()

  if (bp === 'desktop' || bp === 'tablet') {
    return <ContextPanel>{children}</ContextPanel>
  }
  if (orientation === 'landscape') {
    return <ContextSideSheet>{children}</ContextSideSheet>
  }
  return <ContextDrawer>{children}</ContextDrawer>
}
```

- [ ] **Step 3: Type-check + visual verification**

```
cd web && npm run build
```
With `USE_NEW_LAYOUT = true` and a desktop viewport, confirm:
- Right-side panel ~320px wide, shows channel list.
- Tapping a channel: list slides to chat view (no animation expected yet; back arrow doesn't render on desktop per `bp !== 'desktop'` guard).
- For desktop, add a back affordance inside `ContextStack` — wait, the spec says desktop doesn't need it because the user has multiple ways to switch channels. Leave as-is.

Flip back to `false` when done.

---

# Phase 5 — ContextSideSheet (Landscape Mobile)

## Task 5.1: Implement `ContextSideSheet`

**Files:**
- Modify: `web/src/components/layout/ContextSideSheet.tsx`

- [ ] **Step 1: Add local open state + always-visible peek strip**

Replace `web/src/components/layout/ContextSideSheet.tsx` with:

```tsx
import { useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'

interface Props { children: ReactNode }

export function ContextSideSheet({ children }: Props) {
  const [open, setOpen] = useState(false)
  const stack = useChatStore((s) => s.contextStack)
  const top = stack[stack.length - 1]
  const roomName = useChatStore((s) =>
    top.route === 'chat' ? s.rooms[top.roomId]?.name : undefined,
  )

  return (
    <>
      {/* Always-visible peek strip on the right edge */}
      <button
        type="button"
        data-layout="context-side-peek"
        className="absolute right-0 top-12 bottom-2 z-20 w-11 rounded-l-lg border border-r-0 border-border-subtle bg-surface-1/85 backdrop-blur-sm text-fg-secondary hover:text-fg-primary"
        aria-label={`Expand ${roomName ?? 'channels'}`}
        onClick={() => setOpen(true)}
      >
        <span className="flex h-full flex-col items-center justify-center gap-2 text-[10px] [writing-mode:vertical-rl]">
          {roomName ?? 'Channels'}
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="z-30 w-[320px] border-l border-border-subtle bg-surface-1/95 p-0 backdrop-blur-sm"
        >
          <div className="flex h-11 items-center gap-2 border-b border-border-subtle px-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Collapse panel"
              className="h-11 w-11 text-fg-secondary"
              onClick={() => setOpen(false)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </div>
          <div className="h-[calc(100%-2.75rem)] overflow-hidden">
            {children}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
```

- [ ] **Step 2: Type-check + visual verification**

```
cd web && npm run build
```
With `USE_NEW_LAYOUT = true` and DevTools device toolbar set to phone landscape (e.g., iPhone 14 rotated, 844×390):

- 44px peek strip visible at right edge.
- Tap it → 320px sheet slides in.
- Tap the back chevron → sheet closes.
- Map still tappable on the left.

Flip flag back to `false`.

---

# Phase 6 — ContextDrawer (Portrait Mobile, Vaul)

## Task 6.1: Install Vaul and add shadcn drawer component

**Files:**
- Modify: `web/package.json`
- Create: `web/src/components/ui/drawer.tsx`

- [ ] **Step 1: Install Vaul**

```
cd web && npm install vaul
```

Expected: `vaul` appears in `package.json` dependencies.

- [ ] **Step 2: Add the shadcn-style Drawer wrapper**

Create `web/src/components/ui/drawer.tsx` (matches the shadcn/ui generator output for the Vaul drawer):

```tsx
'use client'

import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'

import { cn } from '@/lib/utils'

function Drawer({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger(props: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal(props: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose(props: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        'fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out',
        className,
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-2xl border border-border-subtle bg-surface-1/95 backdrop-blur-md',
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-border-default" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="drawer-header" className={cn('grid gap-1 p-3', className)} {...props} />
}

function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="drawer-footer" className={cn('mt-auto flex flex-col gap-2 p-3', className)} {...props} />
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-sm font-semibold text-fg-primary', className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-xs text-fg-secondary', className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
```

- [ ] **Step 3: Type-check**

```
cd web && npm run build
```
Expected: no errors.

---

## Task 6.2: Implement `ContextDrawer` with snap points

**Files:**
- Modify: `web/src/components/layout/ContextDrawer.tsx`

- [ ] **Step 1: Implement the snap-point drawer**

Replace `web/src/components/layout/ContextDrawer.tsx` with:

```tsx
import { useState, type ReactNode } from 'react'
import { Drawer, DrawerContent } from '@/components/ui/drawer'

const SNAP_POINTS = [0.1, 0.5, 0.92] as const
type Snap = (typeof SNAP_POINTS)[number]

interface Props { children: ReactNode }

export function ContextDrawer({ children }: Props) {
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0] as Snap)

  return (
    <Drawer
      open
      snapPoints={[...SNAP_POINTS]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      modal={false}
      dismissible={false}
    >
      <DrawerContent className="data-[state=open]:!translate-y-0">
        <div className="flex-1 overflow-hidden">{children}</div>
      </DrawerContent>
    </Drawer>
  )
}
```

- [ ] **Step 2: Type-check + visual verification**

```
cd web && npm run build
```
With `USE_NEW_LAYOUT = true` and DevTools device toolbar set to phone portrait (e.g., iPhone 14, 390×844):

- Drawer visible at peek (~88px).
- Drag handle visible at top of drawer.
- Drag up → snaps to half (~50%) → snaps to full (~92%).
- Map tappable behind drawer at peek (Vaul's `modal={false}`).
- Composer text input focus → drawer auto-expands? Not yet — that's a follow-up enhancement (see Risks in spec). For v1, leave manual.

Flip flag back to `false`.

---

## Task 6.3: Wire map-tap-to-collapse behavior

**Files:**
- Modify: `web/src/components/layout/ContextDrawer.tsx`
- Modify: `web/src/store/chatStore.ts`

- [ ] **Step 1: Lift the active snap to the store**

In `web/src/store/chatStore.ts`, add to the interface and factory near the existing layout flags:

```ts
  drawerSnap: number
  setDrawerSnap: (snap: number) => void
```

```ts
  drawerSnap: 0.1,
  setDrawerSnap: (snap) => set({ drawerSnap: snap }),
```

- [ ] **Step 2: Consume the store snap inside `ContextDrawer`**

Update `web/src/components/layout/ContextDrawer.tsx` to use the store instead of local state:

```tsx
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { useChatStore } from '@/store/chatStore'
import type { ReactNode } from 'react'

const SNAP_POINTS = [0.1, 0.5, 0.92] as const

interface Props { children: ReactNode }

export function ContextDrawer({ children }: Props) {
  const snap = useChatStore((s) => s.drawerSnap)
  const setSnap = useChatStore((s) => s.setDrawerSnap)

  return (
    <Drawer
      open
      snapPoints={[...SNAP_POINTS]}
      activeSnapPoint={snap}
      setActiveSnapPoint={(value) => {
        if (typeof value === 'number') setSnap(value)
      }}
      modal={false}
      dismissible={false}
    >
      <DrawerContent className="data-[state=open]:!translate-y-0">
        <div className="flex-1 overflow-hidden">{children}</div>
      </DrawerContent>
    </Drawer>
  )
}
```

- [ ] **Step 3: Add tap-on-map → collapse-to-peek**

Update `web/src/components/layout/MapBackground.tsx` so a tap on the map collapses the drawer when it's expanded:

```tsx
import type { ReactNode } from 'react'
import { MapViewer } from '../MapViewer'
import { useChatStore } from '@/store/chatStore'

interface Props { children: ReactNode }

export function MapBackground({ children }: Props) {
  const drawerSnap = useChatStore((s) => s.drawerSnap)
  const setDrawerSnap = useChatStore((s) => s.setDrawerSnap)

  const handleMapClick = () => {
    if (drawerSnap > 0.1) setDrawerSnap(0.1)
  }

  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-surface-canvas">
      <div className="absolute inset-0 z-0" onClickCapture={handleMapClick}>
        <MapViewer />
      </div>
      <div className="absolute inset-0 z-10 pointer-events-none">
        <div className="pointer-events-auto">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Type-check + visual verification**

```
cd web && npm run build
```
With `USE_NEW_LAYOUT = true` on a phone portrait viewport: drag drawer to half/full → tap the map → drawer snaps back to peek.

Flip flag back to `false`.

---

# Phase 7 — OverlaySheets

## Task 7.1: Implement `OverlaySheets`

**Files:**
- Modify: `web/src/components/layout/OverlaySheets.tsx`

- [ ] **Step 1: Implement the sheet host**

Replace `web/src/components/layout/OverlaySheets.tsx` with:

```tsx
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { SettingsPage } from '@/components/SettingsPage'
import { JoinRoomModal } from '@/components/JoinRoomModal'
import { MeshViewer } from '@/components/MeshViewer'

function sheetSideFor(bp: 'mobile' | 'tablet' | 'desktop'): 'right' | 'bottom' {
  return bp === 'mobile' ? 'bottom' : 'right'
}

export function OverlaySheets() {
  const bp = useBreakpoint()
  const side = sheetSideFor(bp)

  const menuOpen = useChatStore((s) => s.menuOpen)
  const toggleMenu = useChatStore((s) => s.toggleMenu)
  const settingsOpen = useChatStore((s) => s.settingsOpen)
  const toggleSettings = useChatStore((s) => s.toggleSettings)
  const joinRoomOpen = useChatStore((s) => s.joinRoomOpen)
  const setJoinRoomOpen = useChatStore((s) => s.setJoinRoomOpen)
  const meshViewerOpen = useChatStore((s) => s.meshViewerOpen)
  const toggleMeshViewer = useChatStore((s) => s.toggleMeshViewer)

  return (
    <>
      <Sheet open={menuOpen} onOpenChange={toggleMenu}>
        <SheetContent side={side} className="z-30 bg-surface-1/95 backdrop-blur-sm p-4">
          <h2 className="mb-3 text-sm font-semibold text-fg-primary">Menu</h2>
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={() => { toggleMenu(); setJoinRoomOpen(true) }}>Join Room</Button>
            <Button variant="secondary" onClick={() => { toggleMenu(); toggleSettings() }}>Settings</Button>
            <Button variant="secondary" onClick={() => { toggleMenu(); toggleMeshViewer() }}>Mesh Viewer</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={settingsOpen} onOpenChange={toggleSettings}>
        <SheetContent side={side} className="z-30 bg-surface-1/95 backdrop-blur-sm p-0">
          <SettingsPage />
        </SheetContent>
      </Sheet>

      <Sheet open={joinRoomOpen} onOpenChange={setJoinRoomOpen}>
        <SheetContent side={side} className="z-30 bg-surface-1/95 backdrop-blur-sm p-0">
          <JoinRoomModal />
        </SheetContent>
      </Sheet>

      <Sheet open={meshViewerOpen} onOpenChange={toggleMeshViewer}>
        <SheetContent side={side} className="z-30 bg-surface-1/95 backdrop-blur-sm p-0">
          <MeshViewer />
        </SheetContent>
      </Sheet>
    </>
  )
}
```

Note: confirm `SettingsPage`, `JoinRoomModal`, `MeshViewer` render correctly without their own outer modal/sheet chrome. If any of them currently render an internal `<Dialog>` or backdrop, strip that internal chrome since the new `<Sheet>` provides it.

- [ ] **Step 2: Type-check + visual verification**

```
cd web && npm run build
```
With `USE_NEW_LAYOUT = true`:
- Tap ☰ in TopBar → menu sheet opens (right on desktop/tablet, bottom on phone).
- Tap "Settings" → menu closes, settings sheet opens.
- Tap "Mesh Viewer" → mesh viewer sheet opens.
- Tap "Join Room" → join room sheet opens.

Verify in all three themes that no blue / white shows in LD.

---

# Phase 8 — ActiveCallStrip

## Task 8.1: Implement `ActiveCallStrip`

**Files:**
- Modify: `web/src/components/layout/ActiveCallStrip.tsx`

- [ ] **Step 1: Implement the strip**

Replace `web/src/components/layout/ActiveCallStrip.tsx` with:

```tsx
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { cn } from '@/lib/utils'

interface Props {
  onMuteToggle?: (muted: boolean) => void
  onHangUp?: () => void
  muted?: boolean
}

// Note: the active voice state lives in chatStore; mute/hang-up handlers are
// provided by App.tsx and passed through AppShell (see Task 8.2 wiring).
export function ActiveCallStrip({ onMuteToggle, onHangUp, muted }: Props) {
  const bp = useBreakpoint()
  const activeVoice = useChatStore((s) => s.activeVoice)
  const voiceState = useChatStore((s) => s.voiceState)
  const localSpeaking = useChatStore((s) => s.localSpeaking)
  const rooms = useChatStore((s) => s.rooms)

  if (!activeVoice) return null

  const channel = voiceState[activeVoice.roomId]?.find((c) => c.id === activeVoice.channelId)
  const channelName = channel?.name ?? 'Voice'
  const roomName = rooms[activeVoice.roomId]?.name ?? ''
  const memberCount = channel?.members.length ?? 0

  const height = bp === 'desktop' ? 'h-10' : 'h-8'

  return (
    <div
      data-layout="active-call-strip"
      className={cn(
        'absolute z-10 flex items-center gap-2 rounded-md border border-status-critical/40 bg-surface-1/90 backdrop-blur-sm px-3 text-xs text-fg-primary',
        height,
        bp === 'desktop'
          ? 'left-16 right-[340px] bottom-3'
          : bp === 'tablet'
            ? 'left-12 right-[336px] bottom-2'
            : 'left-14 right-3 bottom-44',
      )}
    >
      <span
        aria-label={localSpeaking ? 'Speaking' : 'Idle'}
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          localSpeaking ? 'bg-status-success animate-pulse' : 'bg-fg-tertiary',
        )}
      />
      <span className="truncate">
        {channelName}
        {roomName && <span className="opacity-60"> · {roomName}</span>}
      </span>
      <span className="ml-1 opacity-60">· {memberCount}</span>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="h-8 w-8 text-fg-secondary"
          onClick={() => onMuteToggle?.(!muted)}
        >
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hang up"
          className="h-8 w-8 text-status-critical"
          onClick={onHangUp}
        >
          <PhoneOff className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Thread handlers through AppShell**

Update `web/src/components/layout/AppShell.tsx` to accept `voice` handlers alongside the existing `ptt` prop:

```tsx
interface VoiceHandlersValue {
  muted: boolean
  onMuteToggle: (muted: boolean) => void
  onHangUp: () => void
}

interface Props {
  ptt: PTTContextValue
  voice: VoiceHandlersValue
}

export function AppShell({ ptt, voice }: Props) {
  // ... existing PTT provider ...
  return (
    <PTTContext.Provider value={value}>
      <MapBackground>
        <TopBar />
        <MapRail />
        <ActiveCallStrip
          muted={voice.muted}
          onMuteToggle={voice.onMuteToggle}
          onHangUp={voice.onHangUp}
        />
        <ContextSurface>
          <ContextStack />
        </ContextSurface>
        <OverlaySheets />
      </MapBackground>
    </PTTContext.Provider>
  )
}
```

In `web/src/App.tsx`, pass them through alongside the existing `ptt` prop:

```tsx
  return (
    <AppShell
      ptt={{ pttActive, onPTTStart: handlePTTStart, onPTTEnd: handlePTTEnd }}
      voice={{
        muted: voiceMuted, // existing local state
        onMuteToggle: handleMuteToggle,
        onHangUp: leaveVoice,
      }}
    />
  )
```

Note: confirm the existing names in `App.tsx`. The current `handleMuteToggle` and `leaveVoice` are defined; verify `voiceMuted` is exposed or compute it from `voiceManagerRef.current?.muted`.

- [ ] **Step 3: Type-check + visual verification**

```
cd web && npm run build
```
With `USE_NEW_LAYOUT = true` and an active voice channel, confirm the strip appears, the status dot pulses on speak, and mute/hang-up call the existing handlers.

---

# Phase 9 — Cleanup

## Task 9.1: Final sweep — dead state in App.tsx + full regression pass

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Full regression pass**

Perform a complete walk-through across all three themes (Dark, Light, LD via Settings sheet) and all three breakpoints (desktop ≥1024, landscape mobile, portrait mobile). Confirm:

- TopBar shows displayName, GPS (when geolocation enabled), active channel name; ☰ opens menu.
- MapRail PTT + Layers cycle work.
- ContextStack list → chat → back works on all three hosts (Panel / SideSheet / Drawer).
- OverlaySheets open and close from the menu and existing triggers (Settings, Mesh Viewer).
- ActiveCallStrip appears only during voice.
- No blue / white surfaces in LD.

- [ ] **Step 2: Sweep dead state in App.tsx**

Task 1.5 already replaced the return JSX with `<AppShell ... />`. Now remove any local state or callbacks in `App.tsx` that the new shell no longer references. Likely candidates that became dead state when the old return JSX was deleted:

- `const [showJoinModal, setShowJoinModal] = useState(false)` — replaced by `chatStore.joinRoomOpen`
- `const [sidebarOpen, setSidebarOpen] = useState(false)` — drawer state is now managed inside `ContextDrawer` / `ContextSideSheet`
- `const [nameInput, setNameInput] = useState('')` — display-name editing moved into the Settings sheet

Walk each `useState` / `useCallback` / `useRef` declared in `App.tsx`. For each one, search the file with the variable's name — if no remaining references, delete it. Be careful not to delete things still passed to `<AppShell>` via the `ptt` / `voice` props or used by effects (e.g., `voiceManagerRef`, the WebSocket `send` ref).

The final `App.tsx` body should look approximately like:

```tsx
export default function App() {
  useTheme()
  // ... remaining hooks: useWebSocket, useGeolocation, voiceManagerRef, usePTT, etc. ...

  return (
    <AppShell
      ptt={{ pttActive, onPTTStart: handlePTTStart, onPTTEnd: handlePTTEnd }}
      voice={{ muted: voiceMuted, onMuteToggle: handleMuteToggle, onHangUp: leaveVoice }}
    />
  )
}
```

- [ ] **Step 3: Final type-check, test, and visual regression pass**

```
cd web && npm run build && npm test -- --run
```
Expected: build green, all tests pass.

Then visually verify: open the dev server one final time, walk through all three themes × all three breakpoints. Smoke-check:

1. App loads to channel list view (Sidebar) inside the appropriate ContextSurface.
2. Tapping a channel pushes to ChatView.
3. PTT works (keyboard + on-screen).
4. Joining a voice channel makes the ActiveCallStrip appear; leaving hides it.
5. Settings, Mesh Viewer, Join Room all open and close from the ☰ menu.
6. Rotating the phone (landscape ↔ portrait) preserves scroll position, channel selection, and composer text in the chat view.

---

## Self-Review (against spec)

Quick walkthrough of spec sections against tasks:

- **Layout composition** (TopBar/MapBackground/MapRail/ContextSurface/ActiveCallStrip/OverlaySheets) → Tasks 1.4, 2.1, 2.2, 3.1, 4.3, 5.1, 6.2, 7.1, 8.1.
- **Hooks (`useBreakpoint`, `useOrientation`)** → Tasks 1.1, 1.2.
- **State additions (`menuOpen`, `joinRoomOpen`, `contextStack`, `drawerSnap`, `mapStyle`)** → Tasks 1.3, 3.1, 6.3.
- **Vaul snap-point drawer** → Tasks 6.1, 6.2.
- **shadcn Sheet for side-sheet + overlays** → Tasks 5.1, 7.1.
- **TopBar real-data-only** → Task 2.2 (no notification bell, no mesh-peer pill, no connection dot).
- **MapRail real existing actions only** (PTT, map style) → Task 3.1; mesh viewer in menu → Task 7.1.
- **Sidebar header overlap** → Task 4.1.
- **Removing MapViewer redundant overlays** → Task 3.2.
- **Feature-flag gating** → Task 1.5; cleanup → Task 9.1.
- **DTAK token usage, no blue/white in LD** → enforced in every visual-verification step.

No placeholders. No invented APIs. Type signatures consistent across tasks (`pushContextRoute`, `drawerSnap`, `mapStyle`, `setJoinRoomOpen` used identically wherever they appear).

---

## Out of scope (deferred)

- Composer focus auto-expanding drawer to `full` (mentioned in spec as v1-deferred enhancement).
- visualViewport-aware drawer clamping above the soft keyboard on iOS WKWebView (spec-flagged risk; verify only after Capacitor smoke test).
- Marker form re-trigger paths from the rail.
- Contact-count badge new placement on the map.
