# Responsive TAK Layout — Design Spec

**Date:** 2026-05-19
**Status:** Draft — pending review
**Related:** [`2026-05-01-dtak-interface-guide-design.md`](./2026-05-01-dtak-interface-guide-design.md), [`2026-05-15-shadcn-dtak-refactor-design.md`](./2026-05-15-shadcn-dtak-refactor-design.md)

## Summary

Replace the current ad-hoc `App.tsx` layout with a single responsive shell that mirrors ATAK / iTAK / WinTAK: full-bleed map background with overlay surfaces (top bar, floating map controls, active-call strip) and a context container that adapts host based on breakpoint and orientation.

Goal: bring mobile (especially portrait) much closer to the design intent, while keeping the desktop experience and unifying both behind one component tree. Everything is built from existing shadcn primitives and DTAK semantic tokens.

## Motivation

The post-shadcn refactor left the layout intact: portrait mobile is still a 50/50 stack of map and chat, which is the wrong pattern for a tactical-awareness app where the map must always be the primary surface. The desktop screenshot shows the target pattern — a map-as-background composition with a right-anchored content panel — and the goal is to extend that pattern down to landscape and portrait mobile with the same component tree.

## Design Decisions (validated during brainstorming)

| Decision | Choice |
|---|---|
| Scope | Unified responsive shell across desktop, landscape mobile, portrait mobile |
| Portrait drawer behavior | Snap-point bottom sheet (Vaul) — peek / half / full |
| Landscape drawer behavior | Right-side slide-in sheet |
| Drawer navigation model | Single nav stack inside drawer (channel list → chat → back); peripheral surfaces as full-screen modal sheets |
| Top bar data | Real app data only — no invented indicators |

## Layout Composition

A single `<AppShell>` composes six fixed-position slots over a full-bleed map:

```
TopBar             (z-10, overlay, blurred)
MapBackground      (z-0, fills viewport)
MapRail            (z-10, left edge, floating)
ContextSurface     (z-20, varies by breakpoint — see below)
ActiveCallStrip    (z-10, floats above ContextSurface)
OverlaySheets      (z-30, triggered surfaces)
```

`ContextSurface` is the polymorphic host:

| Breakpoint | Host | Mechanics |
|---|---|---|
| Desktop (≥1024px) | `ContextPanel` | Absolutely-positioned right slab, persistent, ~320px wide |
| Landscape mobile | `ContextSideSheet` | shadcn `Sheet side="right"`, width snap: 44px peek / ~320px expanded |
| Portrait mobile | `ContextDrawer` | Vaul `Drawer` with `snapPoints={[0.1, 0.5, 0.92]}`, `modal={false}`, `dismissible={false}` |

The same `<ContextStack>` (the nav tree) mounts inside whichever host is active. Mounting is stable across breakpoint/orientation changes so scroll position, channel selection, and composer text survive rotation.

## Component Architecture

New files under `web/src/components/layout/`:

```
AppShell.tsx           — responsive composition root (replaces App.tsx body)
TopBar.tsx             — callsign · workspace · GPS · menu, overlay
MapBackground.tsx      — thin wrapper around MapViewer for full-bleed positioning
MapRail.tsx            — left floating button column (PTT + map style)
ContextSurface.tsx     — branches to Panel | SideSheet | Drawer by breakpoint
ContextDrawer.tsx      — Vaul snap-point drawer (portrait)
ContextSideSheet.tsx   — shadcn Sheet side="right" (landscape mobile)
ContextPanel.tsx       — plain absolute-positioned panel (desktop)
ContextStack.tsx       — nav stack hosted inside any of the three surfaces
ActiveCallStrip.tsx    — voice status overlay
OverlaySheets.tsx      — mounts Settings / JoinRoom / MeshViewer / MarkerForm / Menu Sheets
```

New hooks under `web/src/hooks/`:

```
useBreakpoint.ts       — 'mobile' | 'tablet' | 'desktop' via matchMedia
useOrientation.ts      — 'portrait' | 'landscape'
```

Existing components are re-hosted, not rewritten:

- `Sidebar.tsx` → root route of `ContextStack` (channel list)
- `ChatView.tsx` → pushed route of `ContextStack`, gains a back-arrow header on mobile
- `SettingsPage.tsx`, `JoinRoomModal.tsx`, `MeshViewer.tsx`, `MarkerForm.tsx` → wrapped as `Sheet` contents inside `OverlaySheets`
- `VoiceBar.tsx` → contents reskinned into `ActiveCallStrip`
- `PTTButton.tsx`, `MapViewer.tsx` → unchanged contents, repositioned

The new `App.tsx` body becomes:

```tsx
<MapBackground>
  <TopBar />
  <MapRail />
  <ActiveCallStrip />
  <ContextSurface>
    <ContextStack />
  </ContextSurface>
  <OverlaySheets />
</MapBackground>
```

## TopBar

**Contents — real app data only:**

| Slot | Source |
|---|---|
| Avatar | initials derived from `chatStore.displayName` |
| Callsign | `chatStore.displayName` |
| Geo location | `chatStore.selfPosition.{lat,lon}` — hidden when `null` |
| Active channel | `chatStore.rooms[activeRoomId].name` |
| Menu trigger (☰) | opens primary menu OverlaySheet |

**No connection dot, mesh-peer pill, or notification bell** — none correspond to existing app state.

**Densities:**

| Breakpoint | Height | Layout |
|---|---|---|
| Desktop | 40px | All slots one row |
| Landscape mobile | 32px | One row, GPS abbreviated, icons only |
| Portrait mobile | 48px | Two rows — identity + ☰; GPS + active channel |

Always semi-transparent overlay with `backdrop-blur-sm`. Touch targets: 44px mobile, 48px when `data-theme="ld"` (44px landscape icons use pseudo-element hit-area extension).

## MapRail

Left-edge floating column. Contains only real existing actions:

| Position | Control | Source |
|---|---|---|
| Top | PTT | existing `PTTButton.tsx` |
| Below | Map style | `cycleStyle` from current `MapViewer.tsx` |

Mesh viewer is **not** in the rail — it lives in the ☰ menu OverlaySheet.

Sizes: 44px desktop, 36–40px landscape, 40px portrait. Always floats over the map; never overlaps the ContextSurface.

`MapViewer.tsx` loses its top-left contact-count badge + style switcher (style moves to the rail; the contact count can either move to a smaller corner badge or be dropped — to be decided in the implementation plan). The bottom-right callsign HUD is removed entirely — the TopBar covers that data now.

## ContextStack (drawer / panel content)

Single navigation stack hosted by whichever ContextSurface is active.

- **Root route:** channel list (current `Sidebar` content) with workspace name header, search input, groups list, DMs.
- **Pushed route:** chat (current `ChatView`) with back-arrow + channel name header.
- **Future routes** can push here (e.g., channel info, member list) without changing the host.

A small `useContextStack()` hook lives in `chatStore` (or a slice) and exposes `stack`, `push`, `pop`. Deep links can drive it. Settings / JoinRoom / etc. are **not** stack routes — they are OverlaySheets.

## ContextDrawer (portrait — Vaul snap-point sheet)

```tsx
<Drawer
  open
  snapPoints={[0.1, 0.5, 0.92]}      // peek ≈ 88px, half ≈ 50%, full ≈ 92%
  activeSnapPoint={snap}
  setActiveSnapPoint={setSnap}
  modal={false}                       // map remains tappable
  dismissible={false}                 // peek is the floor
>
```

Snap definitions:

| Snap | Size | What shows |
|---|---|---|
| peek | ~88px | drag handle, current route title, unread badge, optional 1-row preview |
| half | 50% | title + ~5 message rows + composer (chat) or ~6 list rows (channels) |
| full | 92% | full scroll; map peeks ~8% at top to preserve orientation |

Interactions:

- Drag the handle / drawer top → between snaps (Vaul native).
- Tap the drawer header → cycle peek → half → peek.
- Tap on map when `snap !== 'peek'` → collapse to `peek`.
- Composer focus → auto-expand to `full`.
- Soft keyboard appears (visualViewport API) → drawer top clamps above keyboard.
- New unread message → pulse the badge; do **not** auto-expand (DTAK reduced-motion guidance).

## ContextSideSheet (landscape mobile)

shadcn `<Sheet side="right">` with two width states:

- **Peek strip** (default) — always-visible 44px-wide vertical strip anchored to the right edge, shows drag-handle bar + collapsed unread badge.
- **Expanded** — ~320px wide overlay, slides in over the peek strip; map remains visible to the left.

Tap the peek strip → expand. Tap the map → collapse. The peek strip is rendered as a sibling to the `Sheet` (not inside it) so it stays present whether the sheet is open or closed. No drag-from-edge gesture (avoids competing with map-pan).

## ContextPanel (desktop)

Plain absolutely-positioned div, ~320px wide, anchored right with 12px gutters. Always at "expanded" — no snap states.

## ActiveCallStrip

Renders only when `chatStore.activeVoice !== null`. Contents:

| Item | Source |
|---|---|
| Status dot (pulses on speak) | `chatStore.localSpeaking` |
| Channel name | `chatStore.activeVoice` + `chatStore.voiceState` |
| Member count | `voiceState[room][channel].members.length` |
| Mute toggle | existing `handleMuteToggle` |
| Hang up | existing `leaveVoice` |

Heights: 40px desktop / 32px landscape / 32px portrait. Floats with 8–12px margin. In portrait, sits above the drawer peek band; at `half` / `full` the drawer covers it (voice remains active).

This replaces the layout role of `VoiceBar.tsx`; its logic and state are reused.

## OverlaySheets

A single component mounts all five `<Sheet>` instances at the AppShell root. Each subscribes to its own open flag.

| Surface | Open flag | Sheet side | Underlying component |
|---|---|---|---|
| Primary menu | `chatStore.menuOpen` (new) | right | new list (Join Room, Settings, Mesh Viewer, Theme toggle, Display Name editor) |
| Settings | `chatStore.settingsOpen` (exists) | right (desktop) / bottom-full (mobile) | `SettingsPage.tsx` |
| Join Room | `chatStore.joinRoomOpen` (new) | right / bottom-full | `JoinRoomModal.tsx` content |
| Mesh Viewer | `chatStore.meshViewerOpen` (exists) | right / bottom-full | `MeshViewer.tsx` |
| Marker form | existing trigger | bottom-full mobile / right desktop | `MarkerForm.tsx` |

The menu trigger surfaces the real existing toggles — no invented entries. Mobile sheets default to bottom-full because right-anchored sheets are unreadably narrow on a phone.

## Tokens, Theming, DTAK Rules

- **No raw hex anywhere.** All colors via DTAK semantic tokens (`bg-surface-1`, `text-fg-primary`, `border-border-subtle`, `bg-brand`, etc.).
- **No `bg-black`, `bg-white`, or blue accents** in overlay backgrounds — use `bg-surface-1/{opacity}` so the LD theme can swap to its low-luminance palette without surface-level edits.
- **Touch targets:** 44px on mobile, 48px when `data-theme="ld"`. Landscape 32px top-row icons get hit-area extension via `before:` pseudo-elements.
- **`backdrop-blur-sm` only** — heavier blur is unreliable on Android WebView.
- **Reduced motion:** drawer snap animation respects `prefers-reduced-motion` (Vaul honors this). No automatic drawer expansion on new messages.
- **All three themes (`dark`, `light`, `ld`) must be visually tested** across all three breakpoints before declaring done.

## Z-index Layering

A single Tailwind scale, defined in `tokens.css` if not already:

```
z-0   map
z-10  topbar / map-rail / active-call-strip
z-20  context surface (panel / sheet / drawer)
z-30  overlay sheets
```

## State

No new state library, no router. Additions:

- `chatStore`: `menuOpen`, `joinRoomOpen` flags; `useContextStack` slice (`stack`, `push`, `pop`).

Everything else reuses existing state (`activeRoomId`, `selfPosition`, `connected`, `displayName`, `voiceState`, `activeVoice`, `meshViewerOpen`, `settingsOpen`).

## Implementation Phasing

Sequenced so the app stays usable throughout. Each phase is a separate small PR, gated behind a feature flag until the final cleanup phase.

1. **Hooks + skeleton.** Add `useBreakpoint`, `useOrientation`. Create empty layout components. No behavior change.
2. **MapBackground + TopBar.** Wrap `MapViewer`, build TopBar. Old Sidebar/ChatView still render. Verify three breakpoints look right.
3. **MapRail.** Extract PTT + style switcher. Remove old top-left badge + bottom-right HUD from `MapViewer`.
4. **ContextStack + ContextPanel** (desktop first). Verify desktop works.
5. **ContextSideSheet** (landscape mobile).
6. **ContextDrawer** (portrait mobile, Vaul snap-points).
7. **OverlaySheets.** Re-host SettingsPage, JoinRoomModal, MeshViewer, MarkerForm; wire menu trigger.
8. **ActiveCallStrip.** Re-skin VoiceBar.
9. **Cleanup.** Remove feature flag and old App.tsx layout code; visual regression pass in all 3 themes × 3 breakpoints.

## Out of Scope

- Map controls beyond PTT and style cycle (no "center on self" button, no rail-launched marker form — current marker flow is preserved as-is).
- Adding a notification system or global unread store.
- New search affordances beyond the existing channel-list search.
- Visual regression test tooling — manual verification per phase.
- Desktop redesign beyond the layout shell — the existing internal styling of Sidebar/ChatView stays put.

## Risks / Open Questions

- **Vaul `modal={false}` + `dismissible={false}` snap combination** — needs verification that map taps register through the drawer at `peek` without dismissing it. Spike during phase 6.
- **Capacitor + visualViewport** — iOS WKWebView's keyboard behavior may need `Keyboard.setResizeMode` adjustments so the drawer clamps correctly above the keyboard.
- **Contact-count badge placement** — currently top-left of map; with the rail taking the left edge, options are top-right of map below the topbar, or fold into the TopBar. Resolve during phase 3.
- **`Sidebar.tsx` header overlap** — the current `Sidebar` renders a workspace / identity header that becomes redundant once `TopBar` displays the same data. Phase 4 should strip the redundant header from `Sidebar` so the channel-list root inside `ContextStack` starts directly at the search input + groups.

## File / Path Index

| What | Where |
|---|---|
| New layout components | `web/src/components/layout/` |
| New hooks | `web/src/hooks/useBreakpoint.ts`, `web/src/hooks/useOrientation.ts` |
| Existing primitives consumed | `web/src/components/ui/{drawer,sheet,button,avatar,dropdown-menu}.tsx` |
| Existing components re-hosted | `Sidebar.tsx`, `ChatView.tsx`, `SettingsPage.tsx`, `JoinRoomModal.tsx`, `MeshViewer.tsx`, `MarkerForm.tsx`, `VoiceBar.tsx`, `PTTButton.tsx`, `MapViewer.tsx` |
| Tokens / themes | `web/src/styles/tokens.css`, `web/src/styles/themes/{dark,light,low-detection}.css` |
