import { useEffect, useRef, useState, useMemo } from 'react'
import { useChatStore } from '../store/chatStore'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'
import { MeshViewer } from './MeshViewer'
import { MapViewer } from './MapViewer'
import { PTTButton } from './PTTButton'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { GeoPosition } from '../hooks/useGeolocation'
import type { ChatMessage } from '../types'

interface Props {
  send: (type: string, data: any) => void
  onOpenSidebar: () => void
  onPTTStart: () => void
  onPTTEnd: () => void
  selfPosition: React.MutableRefObject<GeoPosition | null>
}

export function ChatView({ send, onOpenSidebar, onPTTStart, onPTTEnd, selfPosition }: Props) {
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const rooms = useChatStore((s) => s.rooms)
  const userId = useChatStore((s) => s.userId)
  const displayName = useChatStore((s) => s.displayName)
  const shortId = useChatStore((s) => s.shortId)
  const meshViewerOpen = useChatStore((s) => s.meshViewerOpen)
  const toggleMeshViewer = useChatStore((s) => s.toggleMeshViewer)
  const meshPeers = useChatStore((s) => s.meshPeers)
  const mapViewerOpen = useChatStore((s) => s.mapViewerOpen)
  const toggleMapViewer = useChatStore((s) => s.toggleMapViewer)
  const cotContacts = useChatStore((s) => s.cotContacts)
  const cotMarkers = useChatStore((s) => s.cotMarkers)
  const activeVoice = useChatStore((s) => s.activeVoice)
  const localSpeaking = useChatStore((s) => s.localSpeaking)
  const voiceState = useChatStore((s) => s.voiceState)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Reply-to state
  const [replyToId, setReplyToId] = useState<string | null>(null)
  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  // Search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // Pinned panel state
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false)

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

  // Filtered messages for search
  const filteredMessages = useMemo(() => {
    if (!room) return []
    if (!searchOpen || !searchQuery.trim()) return room.messages
    const q = searchQuery.toLowerCase()
    return room.messages.filter(
      (m) =>
        !m.deleted &&
        (m.content.toLowerCase().includes(q) ||
          m.sender_name.toLowerCase().includes(q))
    )
  }, [room?.messages, searchOpen, searchQuery])

  // Pinned messages
  const pinnedMessages = useMemo(() => {
    if (!room) return []
    return room.messages.filter((m) => m.pinned && !m.deleted)
  }, [room?.messages])

  useEffect(() => {
    if (!meshViewerOpen && !searchOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [room?.messages.length, meshViewerOpen, searchOpen])

  // Clear reply/edit state when switching rooms
  useEffect(() => {
    setReplyToId(null)
    setEditingId(null)
    setEditContent('')
    setSearchOpen(false)
    setSearchQuery('')
    setPinnedPanelOpen(false)
  }, [activeRoomId])

  if (!room) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-canvas">
        <div className="text-center px-4">
          <div className="text-4xl mb-3 opacity-20">&#x1f4ac;</div>
          <p className="text-fg-secondary">Select a room to start chatting</p>
          <button
            onClick={onOpenSidebar}
            className="mt-4 md:hidden text-brand text-sm"
          >
            Open rooms
          </button>
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

  const replyParentMsg = replyToId ? messageMap.get(replyToId) : null

  const peers = meshPeers[room.id] || []
  const inVoice = activeVoice?.roomId === room.id
  const voiceChannels = Array.isArray(voiceState[room.id]) ? voiceState[room.id] : []
  const activeChannel = inVoice
    ? voiceChannels.find((c) => c.id === activeVoice.channelId)
    : null

  return (
    <div className="flex-1 flex flex-col bg-surface-canvas h-full min-w-0">
      {/* Header */}
      <div className="px-3 md:px-4 py-3 bg-surface-2 flex items-center gap-2 md:gap-3 border-b border-border-subtle shrink-0">
        {/* Hamburger - mobile only */}
        <Button
          size="icon"
          variant="ghost"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="md:hidden shrink-0"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </Button>

        <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-surface-3 flex items-center justify-center text-fg-secondary font-semibold text-sm shrink-0">
          {room.name.charAt(0).toUpperCase()}
        </div>
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

        {/* Search toggle */}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => { setSearchOpen(!searchOpen); setSearchQuery(''); setPinnedPanelOpen(false) }}
          aria-label="Search messages"
          aria-pressed={searchOpen ? true : undefined}
          className="shrink-0"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </Button>

        {/* Pinned messages toggle */}
        {pinnedMessages.length > 0 && (
          <button
            onClick={() => { setPinnedPanelOpen(!pinnedPanelOpen); setSearchOpen(false) }}
            className={`p-2 rounded-lg transition shrink-0 relative ${
              pinnedPanelOpen
                ? 'bg-brand/20 text-brand'
                : 'text-fg-secondary hover:text-fg-primary hover:bg-surface-2 active:bg-surface-3'
            }`}
            title="Pinned messages"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 2H8l-1 7H4l3 7v6h2v-6h6v6h2v-6l3-7h-3z" />
            </svg>
            <span className="absolute -top-0.5 -right-0.5 bg-brand text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-medium">
              {pinnedMessages.length}
            </span>
          </button>
        )}

        {/* Map viewer toggle */}
        <Button
          size="icon"
          variant="ghost"
          onClick={toggleMapViewer}
          aria-label="Tactical map"
          aria-pressed={mapViewerOpen ? true : undefined}
          className="shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
        </Button>

        {/* Mesh viewer toggle */}
        <Button
          size="icon"
          variant="ghost"
          onClick={toggleMeshViewer}
          aria-label="Mesh topology"
          aria-pressed={meshViewerOpen ? true : undefined}
          className="shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="5" r="2.5" />
            <circle cx="5" cy="18" r="2.5" />
            <circle cx="19" cy="18" r="2.5" />
            <line x1="12" y1="7.5" x2="5" y2="15.5" />
            <line x1="12" y1="7.5" x2="19" y2="15.5" />
            <line x1="5" y1="18" x2="19" y2="18" />
          </svg>
        </Button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="px-3 md:px-4 py-2 bg-surface-2 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-surface-2 text-fg-primary rounded-lg px-3 py-1.5 text-sm placeholder:text-fg-tertiary"
              autoFocus
            />
            <span className="text-xs text-fg-secondary whitespace-nowrap">
              {searchQuery.trim() ? `${filteredMessages.length} results` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Pinned messages panel */}
      {pinnedPanelOpen && (
        <div className="px-3 md:px-4 py-2 bg-surface-1 border-b border-border-subtle shrink-0 max-h-48 overflow-y-auto">
          <div className="text-xs font-medium text-fg-secondary mb-1.5">
            Pinned Messages ({pinnedMessages.length})
          </div>
          {pinnedMessages.map((msg) => (
            <div
              key={msg.id}
              className="px-2 py-1.5 rounded-lg bg-surface-canvas/50 mb-1 border border-border-subtle/50 cursor-pointer hover:bg-surface-2 transition"
              onClick={() => {
                // Scroll to pinned message
                const el = document.getElementById(`msg-${msg.id}`)
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                setPinnedPanelOpen(false)
              }}
            >
              <div className="text-xs font-medium text-brand">{msg.sender_name}</div>
              <div className="text-xs text-fg-primary truncate">{msg.content}</div>
            </div>
          ))}
        </div>
      )}

      {/* Content area: map, mesh viewer, or chat */}
      {mapViewerOpen ? (
        <MapViewer
          contacts={cotContacts[room.id] || []}
          markers={cotMarkers[room.id] || []}
          selfPosition={selfPosition.current}
          selfName={displayName}
          send={send}
        />
      ) : meshViewerOpen ? (
        <MeshViewer
          peers={peers}
          selfName={displayName}
          selfShortId={shortId}
        />
      ) : (
        <>
          <ScrollArea className="flex-1">
            <div className="px-3 md:px-4 py-2 space-y-1">
              {filteredMessages.map((msg, i) => {
                const prev = filteredMessages[i - 1]
                const showSender = !prev || prev.sender !== msg.sender
                const replyParent = msg.reply_to ? messageMap.get(msg.reply_to) : undefined
                return (
                  <div key={msg.id} id={`msg-${msg.id}`}>
                    <MessageBubble
                      message={msg}
                      isSelf={msg.sender === userId}
                      showSender={showSender}
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
        </>
      )}
    </div>
  )
}
