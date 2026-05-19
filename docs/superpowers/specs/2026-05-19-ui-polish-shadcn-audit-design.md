# UI polish + shadcn audit (responsive TAK layout follow-up)

**Status:** design
**Date:** 2026-05-19
**Owner:** zgehin

## Purpose

The responsive TAK layout shipped a working AppShell (map background + overlays + context surface). Visual inconsistencies remain in the components it composes, and several recent edits use raw HTML where shadcn primitives are available. This spec defines a focused polish pass and shadcn audit. No new features.

## Scope

In scope:

1. shadcn primitive adoption in `Sidebar`, `VoiceChannelList`, `VoiceBar`.
2. `TopBar` gains Map / Chat focus icon buttons.
3. `Sidebar` adds a create-room icon button; fixes Voice Channels header alignment.
4. `ContextStack` chat header shows the room name after the back button.
5. `VoiceBar` swaps custom SVGs for `lucide-react` icons and tightens the mode-cycle control.

Out of scope: new functionality, store refactors beyond a single flag (`contextSurfaceHidden`), map popover migration to Radix `Popover` (anchoring to map coordinates makes Radix the wrong primitive here).

## Changes

### 1. shadcn audit

Replace raw HTML with existing shadcn primitives where a direct equivalent exists. Do not introduce new dependencies.

| Location | Replace | With |
|---|---|---|
| `Sidebar.tsx` Join (discoverable rooms) | `<button>` | `Button` `variant="secondary" size="sm"` |
| `Sidebar.tsx` Create / Cancel (create-room form) | `<button>` | `Button` (`default` / `secondary`) |
| `Sidebar.tsx` New DM trigger (`+`) | `<button>` | `Button size="icon" variant="ghost"` |
| `Sidebar.tsx` DM peer-picker rows | `<button>` | `Button variant="ghost"` (full-width, left-aligned) |
| `VoiceChannelList.tsx` create trigger (`+`) | `<button>` | `Button size="icon" variant="ghost"` |
| `VoiceChannelList.tsx` channel-name input | raw `<input>` | `Input` |
| `VoiceChannelList.tsx` Add button | `<button>` | `Button size="sm"` |
| `VoiceBar.tsx` mic mute toggle SVGs | inline `<svg>` | `Mic` / `MicOff` from `lucide-react` |
| `VoiceBar.tsx` disconnect SVG | inline `<svg>` | `PhoneOff` from `lucide-react` |
| `VoiceBar.tsx` mode cycle | raw `<button>` | `Button variant="ghost" size="sm"` with active state via class |

Pin popovers in `MapViewer.tsx` stay as custom-styled divs. They are anchored to map coordinates with `map.project()`, not to a DOM trigger element, so Radix `Popover` is incompatible.

### 2. TopBar: Map / Chat focus toggles

Add two icon buttons left of the menu button, ordered `Map` then `MessageSquare`. They are two independent buttons (no segmented-toggle active state) per chosen scope.

Behavior:
- **Drawer surface (mobile portrait):** Map → `setDrawerSnap(0.1)`, Chat → `setDrawerSnap(0.92)`.
- **Panel / SideSheet surface (tablet, desktop, mobile landscape):** new chatStore flag `contextSurfaceHidden: boolean` (default `false`). Map → sets `true`, Chat → sets `false`. `ContextSurface` returns `null` when the flag is true.

Wiring:
- Add `contextSurfaceHidden` and `setContextSurfaceHidden(value)` to `chatStore`.
- TopBar imports `useChatStore` for `setDrawerSnap`, `setContextSurfaceHidden`. Resolves the active surface mode via `useBreakpoint()` + `useOrientation()` to decide which to update — mirror the logic already in `ContextSurface`.
- Buttons use `Button size="icon" variant="ghost"` with the same `h-11 w-11` sizing as the existing menu button. On the narrow `tablet` (`h-8`) variant, shrink to `h-8 w-8`.

### 3. Sidebar polish

- **Add create-room button.** Add a `+` icon button to the Rooms section header (right side, mirroring the DMs header pattern at `Sidebar.tsx:210-220`). Click toggles `showCreateRoom`. Use `Button size="icon" variant="ghost"`.
- **Voice Channels label alignment.** `VoiceChannelList.tsx:41` wraps with `px-2`, then `VoiceChannelList.tsx:43` adds another `px-2` — net `px-4`. Other sidebar headers use `px-3`. Change the inner header padding to `px-1` so the label sits at `px-3` from the sidebar edge, matching Rooms / DMs / Discover.
- Apply the Button/Input swaps from §1 within the same file.

### 4. Room-view header: back + room name

`ContextStack.tsx` chat route currently renders only the back button. Add a title element after it:

```tsx
<span className="truncate text-sm font-semibold text-fg-primary">
  {room.isDM ? room.name : `# ${room.name}`}
</span>
```

Pull the active room via `useChatStore` (`rooms[activeRoomId]`). If the room is somehow missing (race), render nothing for the title — the back button still works.

### 5. VoiceBar polish

- Replace the two mute SVGs (`VoiceBar.tsx:131-139`) with `<MicOff />` and `<Mic />` from `lucide-react` at `h-4 w-4`.
- Replace the disconnect SVG (`VoiceBar.tsx:180-183`) with `<PhoneOff className="h-4 w-4" />`.
- Replace the mode cycle button (`VoiceBar.tsx:148-158`) with `Button variant="ghost" size="sm"`. Active styling (`bg-brand/20 text-brand` for non-`ptt` modes) applied via `className`.

## Store additions

`chatStore`:

```ts
contextSurfaceHidden: boolean        // default false
setContextSurfaceHidden: (v: boolean) => void
```

No persistence needed — this is session UI state.

## Out of scope

- Migrating pin popovers to Radix `Popover` (anchoring mismatch).
- Refactoring `Sidebar.tsx` into smaller files (separate concern).
- Touch-target audits beyond what is already in DTAK rules.
- Theme / token changes.

## Risks

- `contextSurfaceHidden` interacts with the existing `drawerSnap`-driven map click handler in `MapBackground`. When the surface is a panel/sheet, the click handler is a no-op. Keep current behavior; the new flag is independent.
- TopBar resolves "current surface mode" by reading breakpoint + orientation, which duplicates the logic in `ContextSurface`. Acceptable for one consumer; if a third consumer appears, hoist into a shared hook.

## Test plan

- Manual: dev server in all three theme modes (dark / light / low-detection); toggle TopBar Map / Chat buttons in mobile, tablet, desktop widths; create a room from the new sidebar button; join a room and verify back button + name; mute / unmute / disconnect from VoiceBar.
- `tsc -b` clean and `vitest` green.
