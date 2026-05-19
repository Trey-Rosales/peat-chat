# Composer Redesign + Stacked Message Layout

**Date:** 2026-05-19
**Status:** Design approved, pending plan

## Goal

Modernize the chat composer and restructure the message feed for multi-user rooms.

Two problems today:

1. The composer (`web/src/components/MessageInput.tsx`) is a bare textarea + send button. It doesn't expose any of the attachment surfaces we need (image, file, voice message, location) and feels visually unfinished next to the rest of the shadcn-migrated UI.
2. The message feed (`web/src/components/MessageBubble.tsx`) uses left/right bubbles keyed on `isSelf`. That model breaks down in rooms with many speakers — readers must track per-sender bubble colors and alignment instead of scanning a single column.

## Non-goals

- Real image/file upload pipeline.
- Real voice-message recording or playback.
- Full searchable emoji picker (we keep the existing quick set).
- Avatar uploads — initials only.
- Changes to `VoiceMemberItem`, `MeshViewer`, or any non-chat surface.

## Design

### Composer (`MessageInput`)

A single pill-shaped container holds the input and inline icons; the send button sits outside on the right.

Layout, left → right:

| Element | Notes |
|---|---|
| `+` attach trigger | Ghost icon button, 40px (44px touch / 48px LD). Opens shadcn `Popover`. |
| Textarea | Auto-grows; transparent background so the pill is the visual container. |
| Emoji trigger | Ghost icon button inside the pill on the right. Opens shadcn `Popover`. |
| Send button | Outside the pill. Circular, `bg-brand`. Morphs to a mic icon when text is empty. When editing, becomes the warning-styled check (preserves current edit affordance). |

Focus state: focus inside the textarea lifts the whole pill with `ring-1 ring-brand/40`.

Keyboard:

- `Enter` sends, `Shift+Enter` newline (unchanged).
- `Escape` cancels reply or edit context (new).

Touch targets: ≥44px mobile, ≥48px in LD mode.

### Attach popover (`ComposerAttachMenu`)

Popover content is a vertical list of icon + label rows:

- Image
- File
- Voice message
- Location

Each row dispatches `onSelect(kind)`. For this pass, the receiver in `ChatView` wires these to stubs (`console.warn('TODO: <kind>')`). The visual is real so we can ship the composer without blocking on the attachment pipelines.

### Emoji popover (`ComposerEmojiPopover`)

A small grid using the existing `QUICK_EMOJIS` set from `MessageBubble.tsx:27`. Picking an emoji inserts it at the cursor in the textarea.

### Mic / voice message

When the textarea is empty, the send button shows a mic icon. Tap-and-hold is wired to UI states (idle / holding / recording / sending), but the real MediaRecorder integration is out of scope. Holding the mic in this pass shows a tooltip: "Voice messages coming soon."

### PTT placement

The PTT button currently lives inside the composer row (`ChatView.tsx:209-215`). It moves to a dedicated `PTTBar` rendered above the composer when `inVoice` is true. The bar shows the channel name and a prominent PTT control. This decouples PTT from the composer's icon density and gives transmit a more obvious presence.

### Message feed (`MessageRow`)

Replace `MessageBubble` with `MessageRow`. The bubble file is deleted in the same change.

All messages render left-aligned in a single column. Self messages look identical to others — identity comes from the avatar, not alignment.

**Group head** (first message from a sender in a run, or any message ≥5min after the previous from the same sender):

- 32px avatar (40px in LD) in a left gutter.
- Sender name + timestamp on the same line above the content.
- Content below.
- Reactions row below content.

**Continuation** (same sender, within 5min of previous):

- Avatar gutter is empty (no repeat).
- No sender name or timestamp in the layout.
- Timestamp appears on the right edge on row hover.
- Content sits in the same indent as the group-head content.

Grouping rule, computed in `ChatView`:

```
isGroupHead = !prev
            || prev.sender !== msg.sender
            || (msg.timestamp - prev.timestamp) > 5 * 60_000
```

Vertical rhythm: ~4px between continuations, ~12px before a new group head.

Row hover: subtle `bg-surface-1/40` tint; action chip (reply / react) appears top-right of the row, replacing the current absolute-positioned cluster that translates outside the bubble.

Reply preview: stays inline above the content, but aligned in the new gutter indent.

Deleted messages: slim italic "Message deleted" line, in-place, no avatar repeat.

Context menu (right-click / long-press): unchanged — Reply / Pin / Edit / Delete.

Mobile width: content fills available row width minus gutters (no `max-w-[85%]` cap).

### Avatars

`web/src/lib/avatarColor.ts` exports `colorForSender(senderId: string): string`.

- Deterministic hash (e.g. djb2 over the string) modulo 6.
- Maps to one of 6 stable hues sourced from existing token anchors. No new tokens.
- Same sender → same color across the app.
- Reused later by `VoiceMemberItem` (not in this change).

Initials: first letter of each word in `sender_name`, up to 2 letters, uppercase. Falls back to first 2 chars of `sender` if `sender_name` is empty.

## Files

| File | Change |
|---|---|
| `web/src/components/MessageInput.tsx` | Rewrite to pill layout + new triggers. |
| `web/src/components/composer/ComposerAttachMenu.tsx` | New. Popover content for the `+` menu. |
| `web/src/components/composer/ComposerEmojiPopover.tsx` | New. Popover content for the emoji picker. |
| `web/src/components/MessageRow.tsx` | New. Replaces `MessageBubble`. |
| `web/src/components/MessageBubble.tsx` | Deleted. |
| `web/src/components/ChatView.tsx` | Swap to `MessageRow`; compute `isGroupHead`; move PTT to `PTTBar`. |
| `web/src/components/PTTBar.tsx` | New. Renders when `inVoice`. Wraps existing `PTTButton`. |
| `web/src/lib/avatarColor.ts` | New. Deterministic sender → hue mapping. |

## Theming

- All colors via DTAK tokens. No raw hex.
- Pill: `bg-surface-1` + `border-border-subtle`.
- Send: `bg-brand`.
- Verified in dark / light / LD before merge (per CLAUDE.md rule 3).
- LD touch targets bumped to 48px.

## Testing

Unit tests:

- `colorForSender`: determinism (same input → same output) and bucket distribution.
- `MessageRow`: renders avatar + name + timestamp when `isGroupHead`; hides them otherwise.
- `MessageInput`: send disabled when empty; icon morphs to mic when empty; textarea refocuses after send; `Escape` cancels reply/edit.
- `ComposerAttachMenu`: opens on `+` click; fires `onSelect` with the right kind for each row.

Manual:

- Visual sweep in dark / light / LD.
- Verify in a populated room that grouping breaks at sender change and at 5min gap.

## Open questions

None. Stubs for attach handlers and voice-message recording are explicitly accepted as part of this scope.
