import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '../types'

interface Props {
  message: ChatMessage
  isSelf: boolean
  showSender: boolean
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

const QUICK_EMOJIS = ['\u{1F44D}', '\u{1F44E}', '\u{2705}', '\u{274C}', '\u{1F525}', '\u{1F440}']

export function MessageBubble({
  message,
  isSelf,
  showSender,
  replyParent,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onRemoveReact,
  onPin,
  onUnpin,
  userId,
}: Props) {
  const [showMenu, setShowMenu] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu && !showReactions) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        setShowReactions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu, showReactions])

  // Deleted message placeholder
  if (message.deleted) {
    return (
      <div className={`flex ${isSelf ? 'justify-end' : 'justify-start'} ${showSender ? 'mt-2' : 'mt-0.5'}`}>
        <div className="max-w-[85%] md:max-w-[65%] rounded-lg px-3 py-1.5 bg-surface-canvas/50 border border-border-subtle/50">
          <div className="text-xs text-fg-secondary italic">Message deleted</div>
        </div>
      </div>
    )
  }

  const reactions = message.reactions || {}
  const reactionEntries = Object.entries(reactions).filter(([, senders]) => senders.length > 0)

  return (
    <div
      className={`group flex ${isSelf ? 'justify-end' : 'justify-start'} ${showSender ? 'mt-2' : 'mt-0.5'}`}
    >
      <div className="relative max-w-[85%] md:max-w-[65%]" ref={menuRef}>
        {/* Context menu trigger - hover actions */}
        <div
          className={`absolute top-0 ${isSelf ? 'left-0 -translate-x-full' : 'right-0 translate-x-full'} hidden group-hover:flex items-center gap-0.5 px-1`}
        >
          <button
            onClick={() => onReply(message.id)}
            className="p-1 rounded text-fg-secondary hover:text-fg-primary hover:bg-surface-2"
            title="Reply"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 17 4 12 9 7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
          </button>
          <button
            onClick={() => setShowReactions(!showReactions)}
            className="p-1 rounded text-fg-secondary hover:text-fg-primary hover:bg-surface-2"
            title="React"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded text-fg-secondary hover:text-fg-primary hover:bg-surface-2"
            title="More"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        </div>

        {/* Quick reaction picker */}
        {showReactions && (
          <div
            className={`absolute -top-10 ${isSelf ? 'right-0' : 'left-0'} bg-surface-1 border border-border-subtle rounded-lg shadow-lg px-1.5 py-1 flex items-center gap-0.5 z-20`}
          >
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  const alreadyReacted = reactions[emoji]?.includes(userId)
                  if (alreadyReacted) {
                    onRemoveReact(message.id, emoji)
                  } else {
                    onReact(message.id, emoji)
                  }
                  setShowReactions(false)
                }}
                className={`text-base px-1.5 py-0.5 rounded hover:bg-surface-2 transition ${
                  reactions[emoji]?.includes(userId) ? 'bg-brand/20' : ''
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Context menu dropdown */}
        {showMenu && (
          <div
            className={`absolute top-full mt-1 ${isSelf ? 'right-0' : 'left-0'} bg-surface-1 border border-border-subtle rounded-lg shadow-lg py-1 min-w-[140px] z-20`}
          >
            <button
              onClick={() => { onReply(message.id); setShowMenu(false) }}
              className="w-full px-3 py-1.5 text-left text-xs text-fg-primary hover:bg-surface-2 flex items-center gap-2"
            >
              Reply
            </button>
            {message.pinned ? (
              <button
                onClick={() => { onUnpin(message.id); setShowMenu(false) }}
                className="w-full px-3 py-1.5 text-left text-xs text-fg-primary hover:bg-surface-2 flex items-center gap-2"
              >
                Unpin
              </button>
            ) : (
              <button
                onClick={() => { onPin(message.id); setShowMenu(false) }}
                className="w-full px-3 py-1.5 text-left text-xs text-fg-primary hover:bg-surface-2 flex items-center gap-2"
              >
                Pin
              </button>
            )}
            {isSelf && (
              <>
                <button
                  onClick={() => { onEdit(message.id, message.content); setShowMenu(false) }}
                  className="w-full px-3 py-1.5 text-left text-xs text-fg-primary hover:bg-surface-2 flex items-center gap-2"
                >
                  Edit
                </button>
                <button
                  onClick={() => { onDelete(message.id); setShowMenu(false) }}
                  className="w-full px-3 py-1.5 text-left text-xs text-status-critical hover:bg-surface-2 flex items-center gap-2"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}

        {/* Reply preview */}
        {replyParent && (
          <div
            className={`text-xs px-2 py-1 mb-0.5 rounded-t-lg border-l-2 border-brand/60 bg-surface-canvas/50 text-fg-secondary truncate ${
              isSelf ? 'text-right' : 'text-left'
            }`}
          >
            <span className="font-medium text-brand/80">{replyParent.sender_name}</span>
            {': '}
            {replyParent.deleted ? (
              <span className="italic">Message deleted</span>
            ) : (
              replyParent.content.slice(0, 80) + (replyParent.content.length > 80 ? '...' : '')
            )}
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`rounded-lg px-3 py-1.5 ${
            isSelf
              ? 'bg-brand rounded-tr-sm'
              : 'bg-surface-2 rounded-tl-sm'
          } ${replyParent ? 'rounded-t-none' : ''}`}
        >
          {showSender && !isSelf && (
            <div className="text-xs font-medium text-brand mb-0.5">
              {message.sender_name}
            </div>
          )}
          {message.pinned && (
            <div className="text-[10px] text-brand/70 mb-0.5 flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="opacity-60">
                <path d="M16 2H8l-1 7H4l3 7v6h2v-6h6v6h2v-6l3-7h-3z" />
              </svg>
              Pinned
            </div>
          )}
          <div className="text-sm text-fg-primary whitespace-pre-wrap break-words">
            {message.content}
          </div>
          <div className="text-[10px] text-fg-tertiary text-right mt-0.5 -mb-0.5 flex items-center justify-end gap-1">
            {message.edited_at && <span className="italic">edited</span>}
            {time}
          </div>
        </div>

        {/* Reactions display */}
        {reactionEntries.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isSelf ? 'justify-end' : 'justify-start'}`}>
            {reactionEntries.map(([emoji, senders]) => {
              const selfReacted = senders.includes(userId)
              return (
                <button
                  key={emoji}
                  onClick={() => {
                    if (selfReacted) {
                      onRemoveReact(message.id, emoji)
                    } else {
                      onReact(message.id, emoji)
                    }
                  }}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition ${
                    selfReacted
                      ? 'bg-brand/15 border-brand/40 text-fg-primary'
                      : 'bg-surface-canvas/50 border-border-subtle text-fg-secondary hover:border-brand/30'
                  }`}
                >
                  <span>{emoji}</span>
                  <span>{senders.length}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
