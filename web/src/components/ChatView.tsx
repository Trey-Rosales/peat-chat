import { useEffect, useRef, useState, useMemo } from 'react'
import { useChatStore } from '../store/chatStore'
import { useSend } from '@/lib/WebSocketContext'
import { useAppActions } from '@/lib/AppActionsContext'
import { MessageRow } from './MessageRow'
import { MessageInput } from './MessageInput'
import { PTTBar } from './PTTBar'
import type { AttachKind } from './composer/ComposerAttachMenu'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ChatMessage } from '../types'

export function ChatView() {
  const send = useSend()
  const { onPTTStart, onPTTEnd } = useAppActions()
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const rooms = useChatStore((s) => s.rooms)
  const userId = useChatStore((s) => s.userId)
  const activeVoice = useChatStore((s) => s.activeVoice)
  const localSpeaking = useChatStore((s) => s.localSpeaking)
  const voiceState = useChatStore((s) => s.voiceState)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Reply-to state
  const [replyToId, setReplyToId] = useState<string | null>(null)
  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  const room = activeRoomId ? rooms[activeRoomId] : null

  // Build message lookup for reply parents
  const messageMap = useMemo(() => {
    if (!room) return new Map<string, ChatMessage>()
    const map = new Map<string, ChatMessage>()
    for (const msg of room.messages) {
      map.set(msg.id, msg)
    }
    return map
  }, [room?.messages])

  const visibleMessages = room?.messages ?? []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [room?.messages.length])

  // Clear reply/edit state when switching rooms
  useEffect(() => {
    setReplyToId(null)
    setEditingId(null)
    setEditContent('')
  }, [activeRoomId])

  if (!room) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-canvas">
        <div className="text-center px-4">
          <div className="text-4xl mb-3 opacity-20">&#x1f4ac;</div>
          <p className="text-fg-secondary">Select a room to start chatting</p>
        </div>
      </div>
    )
  }

  const handleSend = (content: string) => {
    if (editingId) {
      send('edit_message', { room_id: room.id, message_id: editingId, content })
      setEditingId(null)
      setEditContent('')
    } else {
      const data: any = { room_id: room.id, content }
      if (replyToId) {
        data.reply_to = replyToId
      }
      send('send_message', data)
      setReplyToId(null)
    }
  }

  const handleReply = (messageId: string) => {
    setReplyToId(messageId)
    setEditingId(null)
    setEditContent('')
  }

  const handleEdit = (messageId: string, content: string) => {
    setEditingId(messageId)
    setEditContent(content)
    setReplyToId(null)
  }

  const handleDelete = (messageId: string) => {
    send('delete_message', { room_id: room.id, message_id: messageId })
  }

  const handleReact = (messageId: string, emoji: string) => {
    send('add_reaction', { room_id: room.id, message_id: messageId, emoji })
  }

  const handleRemoveReact = (messageId: string, emoji: string) => {
    send('remove_reaction', { room_id: room.id, message_id: messageId, emoji })
  }

  const handlePin = (messageId: string) => {
    send('pin_message', { room_id: room.id, message_id: messageId })
  }

  const handleUnpin = (messageId: string) => {
    send('unpin_message', { room_id: room.id, message_id: messageId })
  }

  const handleAttach = (kind: AttachKind) => {
    console.warn(`TODO: attach ${kind} (composer stub)`)
  }

  const handleCancelContext = () => {
    setReplyToId(null)
    setEditingId(null)
    setEditContent('')
  }

  const replyParentMsg = replyToId ? messageMap.get(replyToId) : null

  const inVoice = activeVoice?.roomId === room.id
  const voiceChannels = Array.isArray(voiceState[room.id]) ? voiceState[room.id] : []
  const activeChannel = inVoice
    ? voiceChannels.find((c) => c.id === activeVoice.channelId)
    : null

  return (
    <div className="flex-1 flex flex-col bg-surface-canvas h-full min-w-0">
      {/* Channel sub-header */}
      <div className="px-3 md:px-4 py-2 bg-surface-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-fg-primary truncate">{room.name}</div>
          <div className="text-xs text-fg-secondary">
            {room.members} member{room.members !== 1 ? 's' : ''}
            {activeChannel && (
              <span className="text-brand ml-2">
                &#x1f3a4; {String(activeChannel.name || 'Voice')}
              </span>
            )}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 md:px-4 py-2 space-y-1">
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
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Reply-to bar */}
      {replyParentMsg && (
        <div className="px-3 md:px-4 py-1.5 bg-surface-1 border-t border-border-subtle shrink-0 flex items-center gap-2">
          <div className="flex-1 min-w-0 border-l-2 border-brand pl-2">
            <div className="text-xs font-medium text-brand truncate">
              Replying to {replyParentMsg.sender_name}
            </div>
            <div className="text-xs text-fg-secondary truncate">
              {replyParentMsg.deleted ? 'Message deleted' : replyParentMsg.content}
            </div>
          </div>
          <button
            onClick={() => setReplyToId(null)}
            className="text-fg-secondary hover:text-fg-primary p-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Edit bar */}
      {editingId && (
        <div className="px-3 md:px-4 py-1.5 bg-surface-1 border-t border-border-subtle shrink-0 flex items-center gap-2">
          <div className="flex-1 min-w-0 border-l-2 border-status-warning pl-2">
            <div className="text-xs font-medium text-status-warning">Editing message</div>
          </div>
          <button
            onClick={() => { setEditingId(null); setEditContent('') }}
            className="text-fg-secondary hover:text-fg-primary p-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

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
    </div>
  )
}
