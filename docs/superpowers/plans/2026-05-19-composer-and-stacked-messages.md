# Composer Redesign + Stacked Message Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current chat composer with a shadcn-driven pill layout (attach popover, inline emoji, morphing send/mic) and switch the message feed from left/right bubbles to a single-column Discord/Slack-style stacked layout with avatars.

**Architecture:** Composer becomes a single rounded container holding a textarea plus two popover triggers (`+` and emoji), with the send button outside. Attachments are dispatched via a typed callback to stubs in `ChatView`. The message feed groups consecutive same-sender messages within a 5-minute window, rendering a head row (avatar + name + time + content) followed by continuation rows (content only, indented to the gutter). A deterministic `colorForSender` keeps avatar hues stable per user. PTT moves out of the composer into its own bar above.

**Tech Stack:** React 18 + TypeScript, Tailwind 4 with DTAK semantic tokens, shadcn/ui primitives (`Avatar`, `Popover`, `Button`, `Textarea`, `Tooltip`, `ContextMenu`), lucide-react icons, Vitest + @testing-library/react. Spec lives at `docs/superpowers/specs/2026-05-19-composer-and-stacked-messages-design.md`.

**Commit policy:** The repo owner stages and commits changes themselves. Do **not** run `git commit` between tasks. After each task, leave the working tree dirty for review.

---

## File Structure

| Path | Role |
|---|---|
| `web/src/lib/avatarColor.ts` | NEW. `colorForSender(senderId)` → one of 6 stable hue classnames. Pure, deterministic. |
| `web/src/lib/avatarColor.test.ts` | NEW. Unit tests for determinism + bucket distribution. |
| `web/src/lib/initials.ts` | NEW. `initialsFor(senderName, sender)` helper. |
| `web/src/lib/initials.test.ts` | NEW. Unit tests for initials. |
| `web/src/components/MessageRow.tsx` | NEW. Renders group-head or continuation row. Replaces `MessageBubble`. |
| `web/src/components/MessageRow.test.tsx` | NEW. Tests grouping render branches + reactions + deleted state. |
| `web/src/components/MessageBubble.tsx` | DELETE in final task. |
| `web/src/components/composer/ComposerAttachMenu.tsx` | NEW. Popover content with Image / File / Voice message / Location rows. |
| `web/src/components/composer/ComposerAttachMenu.test.tsx` | NEW. Click each row → callback fires with the right kind. |
| `web/src/components/composer/ComposerEmojiPopover.tsx` | NEW. Popover content with quick-emoji grid. |
| `web/src/components/composer/ComposerEmojiPopover.test.tsx` | NEW. Click emoji → `onPick` called with that emoji. |
| `web/src/components/MessageInput.tsx` | REWRITE. Pill layout, attach + emoji triggers, morphing send/mic. |
| `web/src/components/MessageInput.test.tsx` | NEW. Send disabled when empty, mic morph, Escape cancels, emoji insert. |
| `web/src/components/PTTBar.tsx` | NEW. Wraps existing `PTTButton` with channel label. |
| `web/src/components/PTTBar.test.tsx` | NEW. Renders channel name, forwards PTT events. |
| `web/src/components/ChatView.tsx` | MODIFY. Compute `isGroupHead`, swap `MessageBubble` → `MessageRow`, hoist PTT into `PTTBar`, add attach stubs + `onCancelReplyEdit` for Escape. |

---

## Task 1: `avatarColor` utility

**Files:**
- Create: `web/src/lib/avatarColor.ts`
- Test: `web/src/lib/avatarColor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/avatarColor.test.ts
import { describe, it, expect } from 'vitest'
import { colorForSender, AVATAR_HUES } from './avatarColor'

describe('colorForSender', () => {
  it('returns the same hue for the same sender id', () => {
    expect(colorForSender('alice-123')).toBe(colorForSender('alice-123'))
  })

  it('returns one of the AVATAR_HUES classnames', () => {
    const hue = colorForSender('bob-456')
    expect(AVATAR_HUES).toContain(hue)
  })

  it('distributes across all 6 buckets over many ids', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      seen.add(colorForSender(`user-${i}`))
    }
    expect(seen.size).toBe(6)
  })

  it('handles empty string deterministically', () => {
    expect(colorForSender('')).toBe(colorForSender(''))
    expect(AVATAR_HUES).toContain(colorForSender(''))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/avatarColor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/avatarColor.ts

// Six DTAK-token-driven background classes. Each pairs with a high-contrast
// foreground that works in dark / light / LD modes. Sourced from existing
// token anchors — no new tokens introduced.
export const AVATAR_HUES = [
  'bg-brand text-fg-on-brand',
  'bg-status-success text-fg-on-brand',
  'bg-status-warning text-fg-primary',
  'bg-status-info text-fg-on-brand',
  'bg-status-danger text-fg-on-brand',
  'bg-surface-3 text-fg-primary',
] as const

export type AvatarHue = (typeof AVATAR_HUES)[number]

// djb2 hash — small, fast, deterministic.
function hash(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function colorForSender(senderId: string): AvatarHue {
  return AVATAR_HUES[hash(senderId) % AVATAR_HUES.length]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/avatarColor.test.ts`
Expected: PASS (4 tests).

---

## Task 2: `initialsFor` helper

**Files:**
- Create: `web/src/lib/initials.ts`
- Test: `web/src/lib/initials.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/initials.test.ts
import { describe, it, expect } from 'vitest'
import { initialsFor } from './initials'

describe('initialsFor', () => {
  it('uses the first letter of each word, up to 2 letters', () => {
    expect(initialsFor('Alice Rivera', 'a-123')).toBe('AR')
  })

  it('uppercases single-word names', () => {
    expect(initialsFor('alice', 'a-123')).toBe('A')
  })

  it('caps at two letters even with three+ words', () => {
    expect(initialsFor('John Q Public', 'jqp-1')).toBe('JQ')
  })

  it('falls back to first 2 chars of sender id when name is empty', () => {
    expect(initialsFor('', 'xyz-789')).toBe('XY')
  })

  it('falls back to first 2 chars of sender id when name is whitespace', () => {
    expect(initialsFor('   ', 'xyz-789')).toBe('XY')
  })

  it('returns ? when both inputs are empty', () => {
    expect(initialsFor('', '')).toBe('?')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/initials.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/initials.ts

export function initialsFor(senderName: string, sender: string): string {
  const trimmed = senderName.trim()
  if (trimmed.length > 0) {
    const letters = trimmed
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase()
    if (letters.length > 0) return letters
  }
  if (sender.length > 0) return sender.slice(0, 2).toUpperCase()
  return '?'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/initials.test.ts`
Expected: PASS (6 tests).

---

## Task 3: `MessageRow` component

Replaces `MessageBubble`. Renders avatar + name + timestamp + content when `isGroupHead`; otherwise just content in the gutter indent.

**Files:**
- Create: `web/src/components/MessageRow.tsx`
- Test: `web/src/components/MessageRow.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/MessageRow.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MessageRow } from './MessageRow'
import type { ChatMessage } from '../types'

const baseMsg: ChatMessage = {
  id: 'm1',
  sender: 'alice-1',
  sender_name: 'Alice Rivera',
  timestamp: Date.now(),
  content: 'Hello team',
}

function noop() {}
const handlers = {
  onReply: noop,
  onEdit: noop,
  onDelete: noop,
  onReact: noop,
  onRemoveReact: noop,
  onPin: noop,
  onUnpin: noop,
}

describe('MessageRow', () => {
  afterEach(() => cleanup())

  it('renders sender name and avatar when isGroupHead', () => {
    render(
      <MessageRow
        message={baseMsg}
        isSelf={false}
        isGroupHead={true}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.getByText('Alice Rivera')).toBeInTheDocument()
    // initials in fallback
    expect(screen.getByText('AR')).toBeInTheDocument()
  })

  it('hides sender name and avatar fallback when continuation', () => {
    render(
      <MessageRow
        message={baseMsg}
        isSelf={false}
        isGroupHead={false}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.queryByText('Alice Rivera')).not.toBeInTheDocument()
    expect(screen.queryByText('AR')).not.toBeInTheDocument()
  })

  it('renders message content in both branches', () => {
    const { rerender } = render(
      <MessageRow
        message={baseMsg}
        isSelf={false}
        isGroupHead={true}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.getByText('Hello team')).toBeInTheDocument()
    rerender(
      <MessageRow
        message={baseMsg}
        isSelf={false}
        isGroupHead={false}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.getByText('Hello team')).toBeInTheDocument()
  })

  it('renders deleted placeholder when message.deleted', () => {
    render(
      <MessageRow
        message={{ ...baseMsg, deleted: true }}
        isSelf={false}
        isGroupHead={true}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.getByText(/Message deleted/i)).toBeInTheDocument()
  })

  it('renders reaction pills when present', () => {
    render(
      <MessageRow
        message={{
          ...baseMsg,
          reactions: { '👍': ['u1', 'u2'], '✅': ['me-1'] },
        }}
        isSelf={false}
        isGroupHead={true}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.getByText('👍')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('✅')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/MessageRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `MessageRow`**

```tsx
// web/src/components/MessageRow.tsx
import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '../types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { colorForSender } from '@/lib/avatarColor'
import { initialsFor } from '@/lib/initials'
import { cn } from '@/lib/utils'
import { Reply, SmilePlus, Pin } from 'lucide-react'

interface Props {
  message: ChatMessage
  isSelf: boolean
  isGroupHead: boolean
  replyParent?: ChatMessage
  onReply: (messageId: string) => void
  onEdit: (messageId: string, content: string) => void
  onDelete: (messageId: string) => void
  onReact: (messageId: string, emoji: string) => void
  onRemoveReact: (messageId: string, emoji: string) => void
  onPin: (messageId: string) => void
  onUnpin: (messageId: string) => void
  userId: string
}

const QUICK_EMOJIS = ['\u{1F44D}', '\u{1F44E}', '✅', '❌', '\u{1F525}', '\u{1F440}']

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatFull(ts: number): string {
  return new Date(ts).toLocaleString()
}

export function MessageRow({
  message,
  isGroupHead,
  replyParent,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onRemoveReact,
  onPin,
  onUnpin,
  isSelf,
  userId,
}: Props) {
  const [showReactions, setShowReactions] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showReactions) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowReactions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showReactions])

  if (message.deleted) {
    return (
      <div className={cn('group flex pl-[3.25rem] pr-3', isGroupHead ? 'mt-3' : 'mt-0.5')}>
        <div className="text-xs italic text-fg-tertiary">Message deleted</div>
      </div>
    )
  }

  const reactions = message.reactions || {}
  const reactionEntries = Object.entries(reactions).filter(([, s]) => s.length > 0)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group relative flex gap-3 pr-3 hover:bg-surface-1/40 rounded-md',
            isGroupHead ? 'mt-3 pl-3 pt-1 pb-0.5' : 'pl-3 py-0.5',
          )}
        >
          {/* Avatar gutter — 32px (40px in LD via touch tokens isn't needed here, keep visual constant) */}
          <div className="w-8 shrink-0 flex justify-center">
            {isGroupHead ? (
              <Avatar className="h-8 w-8">
                <AvatarFallback className={cn('text-xs font-medium', colorForSender(message.sender))}>
                  {initialsFor(message.sender_name, message.sender)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div
                className="text-[10px] text-fg-tertiary opacity-0 group-hover:opacity-100 self-start mt-0.5 tabular-nums"
                aria-hidden="true"
              >
                {formatTime(message.timestamp)}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {isGroupHead && (
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-fg-primary truncate">
                  {message.sender_name}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] text-fg-tertiary tabular-nums cursor-default">
                      {formatTime(message.timestamp)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{formatFull(message.timestamp)}</TooltipContent>
                </Tooltip>
                {message.pinned && (
                  <span className="text-[10px] text-fg-tertiary flex items-center gap-1">
                    <Pin className="h-3 w-3" />
                    Pinned
                  </span>
                )}
                {message.edited_at && (
                  <span className="text-[10px] text-fg-tertiary italic">edited</span>
                )}
              </div>
            )}

            {replyParent && (
              <div className="text-xs text-fg-secondary border-l-2 border-brand/60 pl-2 mt-0.5 mb-0.5 truncate">
                <span className="font-medium text-brand/90">{replyParent.sender_name}</span>
                {': '}
                {replyParent.deleted ? (
                  <span className="italic">Message deleted</span>
                ) : (
                  replyParent.content.slice(0, 80) +
                  (replyParent.content.length > 80 ? '…' : '')
                )}
              </div>
            )}

            <div className="text-sm text-fg-primary whitespace-pre-wrap wrap-break-word">
              {message.content}
            </div>

            {reactionEntries.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {reactionEntries.map(([emoji, senders]) => {
                  const selfReacted = senders.includes(userId)
                  return (
                    <button
                      key={emoji}
                      onClick={() =>
                        selfReacted
                          ? onRemoveReact(message.id, emoji)
                          : onReact(message.id, emoji)
                      }
                      className={cn(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition',
                        selfReacted
                          ? 'bg-brand/15 border-brand/40 text-fg-primary'
                          : 'bg-surface-canvas/50 border-border-subtle text-fg-secondary hover:border-brand/30',
                      )}
                    >
                      <span>{emoji}</span>
                      <span>{senders.length}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Floating action chip — top-right on hover */}
          <div
            className="absolute -top-3 right-3 hidden group-hover:flex items-center gap-0.5 bg-surface-1 border border-border-subtle rounded-md shadow-sm px-1 py-0.5 z-10"
            ref={pickerRef}
          >
            <button
              onClick={() => onReply(message.id)}
              className="p-1 rounded text-fg-secondary hover:text-fg-primary hover:bg-surface-2"
              title="Reply"
              aria-label="Reply"
            >
              <Reply className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setShowReactions((v) => !v)}
              className="p-1 rounded text-fg-secondary hover:text-fg-primary hover:bg-surface-2"
              title="React"
              aria-label="React"
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
            {showReactions && (
              <div className="absolute -top-10 right-0 bg-surface-1 border border-border-subtle rounded-lg shadow-lg px-1.5 py-1 flex items-center gap-0.5 z-20">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      const already = reactions[emoji]?.includes(userId)
                      if (already) onRemoveReact(message.id, emoji)
                      else onReact(message.id, emoji)
                      setShowReactions(false)
                    }}
                    className={cn(
                      'text-base px-1.5 py-0.5 rounded hover:bg-surface-2 transition',
                      reactions[emoji]?.includes(userId) && 'bg-brand/20',
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onReply(message.id)}>Reply</ContextMenuItem>
        {message.pinned ? (
          <ContextMenuItem onClick={() => onUnpin(message.id)}>Unpin</ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => onPin(message.id)}>Pin</ContextMenuItem>
        )}
        {isSelf && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onEdit(message.id, message.content)}>
              Edit
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => onDelete(message.id)}
              className="text-destructive focus:text-destructive"
            >
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/MessageRow.test.tsx`
Expected: PASS (5 tests).

---

## Task 4: `ComposerAttachMenu`

**Files:**
- Create: `web/src/components/composer/ComposerAttachMenu.tsx`
- Test: `web/src/components/composer/ComposerAttachMenu.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/composer/ComposerAttachMenu.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerAttachMenu, type AttachKind } from './ComposerAttachMenu'

function renderOpen(onSelect: (kind: AttachKind) => void) {
  return render(<ComposerAttachMenu onSelect={onSelect} defaultOpen />)
}

describe('ComposerAttachMenu', () => {
  afterEach(() => cleanup())

  it('renders all four attach options when open', () => {
    renderOpen(() => {})
    expect(screen.getByRole('menuitem', { name: /image/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /file/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /voice message/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /location/i })).toBeInTheDocument()
  })

  it('fires onSelect with the matching kind for each row', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderOpen(onSelect)

    await user.click(screen.getByRole('menuitem', { name: /image/i }))
    expect(onSelect).toHaveBeenLastCalledWith('image')

    await user.click(screen.getByRole('button', { name: /attach/i }))
    await user.click(screen.getByRole('menuitem', { name: /file/i }))
    expect(onSelect).toHaveBeenLastCalledWith('file')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/composer/ComposerAttachMenu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ComposerAttachMenu`**

```tsx
// web/src/components/composer/ComposerAttachMenu.tsx
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Plus, Image as ImageIcon, FileText, Mic, MapPin } from 'lucide-react'

export type AttachKind = 'image' | 'file' | 'voice' | 'location'

interface Props {
  onSelect: (kind: AttachKind) => void
  disabled?: boolean
  defaultOpen?: boolean
}

const ITEMS: { kind: AttachKind; label: string; Icon: typeof ImageIcon }[] = [
  { kind: 'image', label: 'Image', Icon: ImageIcon },
  { kind: 'file', label: 'File', Icon: FileText },
  { kind: 'voice', label: 'Voice message', Icon: Mic },
  { kind: 'location', label: 'Location', Icon: MapPin },
]

export function ComposerAttachMenu({ onSelect, disabled, defaultOpen }: Props) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Attach"
          className="shrink-0 h-10 w-10 text-fg-secondary hover:text-fg-primary"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-48">
        {ITEMS.map(({ kind, label, Icon }) => (
          <DropdownMenuItem
            key={kind}
            onClick={() => onSelect(kind)}
            className="gap-2"
          >
            <Icon className="h-4 w-4 text-fg-secondary" />
            <span>{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/composer/ComposerAttachMenu.test.tsx`
Expected: PASS (2 tests).

---

## Task 5: `ComposerEmojiPopover`

**Files:**
- Create: `web/src/components/composer/ComposerEmojiPopover.tsx`
- Test: `web/src/components/composer/ComposerEmojiPopover.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/composer/ComposerEmojiPopover.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerEmojiPopover, COMPOSER_EMOJIS } from './ComposerEmojiPopover'

describe('ComposerEmojiPopover', () => {
  afterEach(() => cleanup())

  it('exposes the same quick-set we use elsewhere', () => {
    expect(COMPOSER_EMOJIS).toContain('👍')
    expect(COMPOSER_EMOJIS.length).toBeGreaterThanOrEqual(6)
  })

  it('renders the trigger button', () => {
    render(<ComposerEmojiPopover onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /emoji/i })).toBeInTheDocument()
  })

  it('calls onPick with the chosen emoji', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ComposerEmojiPopover onPick={onPick} defaultOpen />)
    // Each emoji is rendered as its own button
    const btn = screen.getByRole('button', { name: '👍' })
    await user.click(btn)
    expect(onPick).toHaveBeenCalledWith('👍')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/composer/ComposerEmojiPopover.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ComposerEmojiPopover`**

```tsx
// web/src/components/composer/ComposerEmojiPopover.tsx
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Smile } from 'lucide-react'

export const COMPOSER_EMOJIS = ['👍', '👎', '✅', '❌', '🔥', '👀', '🙏', '😂', '🎉', '❤️'] as const

interface Props {
  onPick: (emoji: string) => void
  disabled?: boolean
  defaultOpen?: boolean
}

export function ComposerEmojiPopover({ onPick, disabled, defaultOpen }: Props) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Emoji"
          className="shrink-0 h-9 w-9 text-fg-secondary hover:text-fg-primary"
        >
          <Smile className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-auto p-2"
      >
        <div className="grid grid-cols-5 gap-1">
          {COMPOSER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={emoji}
              onClick={() => {
                onPick(emoji)
                setOpen(false)
              }}
              className="text-lg w-9 h-9 rounded hover:bg-surface-2 transition flex items-center justify-center"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/composer/ComposerEmojiPopover.test.tsx`
Expected: PASS (3 tests).

---

## Task 6: `PTTBar`

Wraps the existing `PTTButton` (`web/src/components/PTTButton.tsx`) with the channel label. Rendered by `ChatView` only when in voice.

**Files:**
- Create: `web/src/components/PTTBar.tsx`
- Test: `web/src/components/PTTBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/PTTBar.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { PTTBar } from './PTTBar'

describe('PTTBar', () => {
  afterEach(() => cleanup())

  it('renders the channel name', () => {
    render(
      <PTTBar
        channelName="Command"
        active={false}
        onPTTStart={() => {}}
        onPTTEnd={() => {}}
      />
    )
    expect(screen.getByText(/Command/i)).toBeInTheDocument()
  })

  it('forwards mouse down/up to PTT handlers', () => {
    const onPTTStart = vi.fn()
    const onPTTEnd = vi.fn()
    render(
      <PTTBar
        channelName="Command"
        active={false}
        onPTTStart={onPTTStart}
        onPTTEnd={onPTTEnd}
      />
    )
    const btn = screen.getByTitle(/hold to talk/i)
    fireEvent.mouseDown(btn)
    expect(onPTTStart).toHaveBeenCalled()
    fireEvent.mouseUp(btn)
    expect(onPTTEnd).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/PTTBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PTTBar`**

```tsx
// web/src/components/PTTBar.tsx
import { PTTButton } from './PTTButton'
import { Radio } from 'lucide-react'

interface Props {
  channelName: string
  active: boolean
  onPTTStart: () => void
  onPTTEnd: () => void
}

export function PTTBar({ channelName, active, onPTTStart, onPTTEnd }: Props) {
  return (
    <div className="px-3 md:px-4 py-2 bg-surface-1 border-t border-border-subtle flex items-center gap-3 shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Radio className="h-4 w-4 text-brand shrink-0" />
        <div className="min-w-0">
          <div className="text-xs text-fg-tertiary">Transmitting on</div>
          <div className="text-sm font-medium text-fg-primary truncate">{channelName}</div>
        </div>
      </div>
      <PTTButton onPTTStart={onPTTStart} onPTTEnd={onPTTEnd} active={active} />
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/PTTBar.test.tsx`
Expected: PASS (2 tests).

---

## Task 7: Rewrite `MessageInput`

Pill layout with attach popover (left), textarea (center), emoji popover + send/mic (right).

**Files:**
- Modify: `web/src/components/MessageInput.tsx` (full rewrite)
- Test: `web/src/components/MessageInput.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/MessageInput.test.tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageInput } from './MessageInput'
import { useChatStore } from '../store/chatStore'

describe('MessageInput', () => {
  beforeEach(() => {
    useChatStore.setState({ connected: true })
  })
  afterEach(() => cleanup())

  it('shows mic icon when textarea is empty and send icon when not', async () => {
    const user = userEvent.setup()
    render(<MessageInput onSend={() => {}} onAttach={() => {}} />)
    expect(screen.getByRole('button', { name: /voice message/i })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox'), 'hi')
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument()
  })

  it('calls onSend with trimmed text and clears the field', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} onAttach={() => {}} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(ta, '  hello  ')
    await user.click(screen.getByRole('button', { name: /send message/i }))
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(ta.value).toBe('')
  })

  it('calls onCancelContext on Escape when reply or edit is active', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <MessageInput
        onSend={() => {}}
        onAttach={() => {}}
        onCancelContext={onCancel}
        contextKind="reply"
      />
    )
    await user.click(screen.getByRole('textbox'))
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not send on Enter when text is whitespace', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} onAttach={() => {}} />)
    await user.type(screen.getByRole('textbox'), '   {Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/MessageInput.test.tsx`
Expected: FAIL — current `MessageInput` has no `onAttach`/`onCancelContext`/`contextKind` props and mic morph isn't implemented.

- [ ] **Step 3: Rewrite `MessageInput`**

Replace the entire file contents with:

```tsx
// web/src/components/MessageInput.tsx
import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../store/chatStore'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Send, Check, Mic } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ComposerAttachMenu, type AttachKind } from './composer/ComposerAttachMenu'
import { ComposerEmojiPopover } from './composer/ComposerEmojiPopover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  onSend: (content: string) => void
  onAttach: (kind: AttachKind) => void
  editContent?: string
  onCancelContext?: () => void
  contextKind?: 'reply' | 'edit' | null
}

export function MessageInput({
  onSend,
  onAttach,
  editContent,
  onCancelContext,
  contextKind,
}: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const connected = useChatStore((s) => s.connected)

  useEffect(() => {
    if (editContent !== undefined) {
      setText(editContent)
      textareaRef.current?.focus()
    }
  }, [editContent])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const isEditing = editContent !== undefined
  const trimmed = text.trim()
  const canSend = trimmed.length > 0 && connected

  const handleSend = () => {
    if (!canSend) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }
    if (e.key === 'Escape' && contextKind && onCancelContext) {
      e.preventDefault()
      onCancelContext()
    }
  }

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current
    if (!el) {
      setText((t) => t + emoji)
      return
    }
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + emoji.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSend()
      }}
      className="flex items-end gap-2"
    >
      <div
        className={cn(
          'flex-1 flex items-end gap-1 rounded-2xl bg-surface-1 border border-border-subtle px-1 py-1 transition',
          'focus-within:ring-1 focus-within:ring-brand/40 focus-within:border-brand/40',
          isEditing && 'ring-1 ring-status-warning/50 border-status-warning/40',
        )}
      >
        <ComposerAttachMenu onSelect={onAttach} disabled={!connected || isEditing} />
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            connected
              ? isEditing
                ? 'Edit message…'
                : 'Type a message'
              : 'Connecting…'
          }
          disabled={!connected}
          rows={1}
          className="flex-1 resize-none border-0 bg-transparent text-sm text-fg-primary placeholder:text-fg-tertiary focus-visible:ring-0 min-h-9 max-h-32 overflow-y-auto px-2 py-2 shadow-none"
        />
        <ComposerEmojiPopover onPick={insertEmoji} disabled={!connected} />
      </div>

      {canSend || isEditing ? (
        <Button
          type="submit"
          size="icon"
          aria-label={isEditing ? 'Save edit' : 'Send message'}
          disabled={!canSend && !isEditing}
          className={cn(
            'shrink-0 rounded-full h-10 w-10',
            isEditing
              ? 'bg-status-warning text-fg-primary hover:bg-status-warning/90'
              : 'bg-brand text-fg-on-brand hover:bg-brand/90',
          )}
        >
          {isEditing ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              aria-label="Voice message"
              variant="ghost"
              className="shrink-0 rounded-full h-10 w-10 bg-surface-2 text-fg-secondary hover:text-fg-primary"
              onClick={(e) => e.preventDefault()}
            >
              <Mic className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Voice messages coming soon</TooltipContent>
        </Tooltip>
      )}
    </form>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/MessageInput.test.tsx`
Expected: PASS (4 tests).

---

## Task 8: Wire `ChatView` to the new components

Compute `isGroupHead`, swap `MessageBubble` → `MessageRow`, move PTT to `PTTBar` above the composer, pass `onAttach` stubs and `onCancelContext` to `MessageInput`.

**Files:**
- Modify: `web/src/components/ChatView.tsx`

- [ ] **Step 1: Open `web/src/components/ChatView.tsx` and replace the imports**

Find:
```tsx
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'
import { PTTButton } from './PTTButton'
```

Replace with:
```tsx
import { MessageRow } from './MessageRow'
import { MessageInput } from './MessageInput'
import { PTTBar } from './PTTBar'
import type { AttachKind } from './composer/ComposerAttachMenu'
```

- [ ] **Step 2: Replace the messages render block**

Find the block beginning at `ChatView.tsx:138` (`{visibleMessages.map((msg, i) => {`) through the closing `})}` and replace with:

```tsx
{visibleMessages.map((msg, i) => {
  const prev = visibleMessages[i - 1]
  const isGroupHead =
    !prev ||
    prev.sender !== msg.sender ||
    msg.timestamp - prev.timestamp > 5 * 60_000
  const replyParent = msg.reply_to ? messageMap.get(msg.reply_to) : undefined
  return (
    <div key={msg.id} id={`msg-${msg.id}`}>
      <MessageRow
        message={msg}
        isSelf={msg.sender === userId}
        isGroupHead={isGroupHead}
        replyParent={replyParent}
        onReply={handleReply}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onReact={handleReact}
        onRemoveReact={handleRemoveReact}
        onPin={handlePin}
        onUnpin={handleUnpin}
        userId={userId}
      />
    </div>
  )
})}
```

- [ ] **Step 3: Replace the composer footer block (and add PTTBar above it)**

Find the entire block starting at `ChatView.tsx:206`:
```tsx
<div className="px-3 md:px-4 py-2 md:py-3 bg-surface-2 border-t border-border-subtle shrink-0">
  <div className="flex items-center gap-2">
    {/* PTT button (visible when in voice) */}
    {inVoice && (
      <PTTButton
        onPTTStart={onPTTStart}
        onPTTEnd={onPTTEnd}
        active={localSpeaking}
      />
    )}
    <MessageInput
      onSend={handleSend}
      editContent={editingId ? editContent : undefined}
    />
  </div>
</div>
```

Replace with:

```tsx
{inVoice && activeChannel && (
  <PTTBar
    channelName={String(activeChannel.name || 'Voice')}
    active={localSpeaking}
    onPTTStart={onPTTStart}
    onPTTEnd={onPTTEnd}
  />
)}
<div className="px-3 md:px-4 py-2 md:py-3 bg-surface-2 border-t border-border-subtle shrink-0">
  <MessageInput
    onSend={handleSend}
    onAttach={handleAttach}
    editContent={editingId ? editContent : undefined}
    onCancelContext={handleCancelContext}
    contextKind={editingId ? 'edit' : replyToId ? 'reply' : null}
  />
</div>
```

- [ ] **Step 4: Add `handleAttach` and `handleCancelContext` near the other handlers**

After `handleUnpin` (around `ChatView.tsx:109`), add:

```tsx
const handleAttach = (kind: AttachKind) => {
  console.warn(`TODO: attach ${kind} (composer stub)`)
}

const handleCancelContext = () => {
  setReplyToId(null)
  setEditingId(null)
  setEditContent('')
}
```

- [ ] **Step 5: Type-check and run the affected test files**

Run:
```bash
cd web && npx tsc --noEmit
```
Expected: no type errors.

Run:
```bash
cd web && npx vitest run src/components/MessageRow.test.tsx src/components/MessageInput.test.tsx src/components/PTTBar.test.tsx src/components/composer
```
Expected: all green.

---

## Task 9: Delete `MessageBubble`

Now that nothing imports it, remove the file.

**Files:**
- Delete: `web/src/components/MessageBubble.tsx`

- [ ] **Step 1: Confirm no references remain**

Run:
```bash
cd web && grep -rn "MessageBubble" src
```
Expected: no output.

- [ ] **Step 2: Delete the file**

Run:
```bash
rm web/src/components/MessageBubble.tsx
```

- [ ] **Step 3: Type-check**

Run:
```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

---

## Task 10: Full test sweep + manual theme verification

- [ ] **Step 1: Run all tests**

Run:
```bash
cd web && npx vitest run
```
Expected: all suites pass. Pay attention to:
- `MessageRow.test.tsx` (5)
- `MessageInput.test.tsx` (4)
- `ComposerAttachMenu.test.tsx` (2)
- `ComposerEmojiPopover.test.tsx` (3)
- `PTTBar.test.tsx` (2)
- `avatarColor.test.ts` (4)
- `initials.test.ts` (6)
- Existing suites should be unchanged.

- [ ] **Step 2: Start the dev server and verify visually**

Run:
```bash
cd web && npm run dev
```

Open the app in a browser. Verify all three of these states:

1. **Dark mode (default):**
   - Composer pill is `surface-1`, border visible.
   - `+` opens dropdown with Image / File / Voice message / Location.
   - Emoji popover opens, picking inserts at cursor.
   - Empty textarea → mic button on the right (tooltip says "coming soon").
   - Typing → mic becomes brand-colored send.
   - Send message → it appears with avatar + name + timestamp.
   - Send a second message immediately → no avatar repeat (continuation).
   - Wait 6 minutes and send again → new group head (avatar repeats).
   - Right-click your own message → Edit / Delete available.
   - Hover any message → reply/react chip appears top-right.
   - Add a reaction → pill appears under content.

2. **Light mode** — Settings → Theme → Light. Walk through the same checks. Confirm no muddy contrast on the pill or avatar fallbacks.

3. **Low-detection (LD)** — Settings → Theme → Low Detection. Walk through the same checks. Confirm:
   - No bright blue or pure white in the composer.
   - Touch targets feel ≥48px.
   - Avatar hues remain readable (the 6 hues are token-driven so they should reskin automatically).

- [ ] **Step 3: Join voice in a room and verify PTT placement**

- Join a voice channel from the sidebar.
- Confirm `PTTBar` appears as a horizontal bar above the composer with channel name + mic button.
- Mouse-hold the PTT button → button enters active/destructive state.
- Composer remains uncluttered (no PTT inside the pill row).

- [ ] **Step 4: Hand off**

Working tree is dirty. Per repo convention, the owner reviews and commits.

---

## Self-Review Notes

Coverage of spec sections:

| Spec section | Implementing task(s) |
|---|---|
| Composer pill layout | Task 7 |
| Attach popover (`+`) | Tasks 4, 7 |
| Emoji popover | Tasks 5, 7 |
| Send/mic morph + edit check | Task 7 |
| Escape cancels reply/edit | Tasks 7, 8 |
| PTT moved out to `PTTBar` | Tasks 6, 8 |
| `MessageRow` group head vs continuation | Tasks 3, 8 |
| Avatar with initials + deterministic color | Tasks 1, 2, 3 |
| 5-minute grouping rule | Task 8 |
| Deleted-message placeholder | Task 3 |
| Reactions + context menu unchanged | Task 3 |
| `MessageBubble` deletion | Task 9 |
| All themes verified | Task 10 |

No placeholders. Types align across tasks (`AttachKind` defined in Task 4, imported in Tasks 7 and 8).
