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
