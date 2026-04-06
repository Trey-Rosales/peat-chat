import { useEffect, useRef } from 'react'
import { useChatStore } from '../store/chatStore'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'
import { MeshViewer } from './MeshViewer'
import { PTTButton } from './PTTButton'

interface Props {
  send: (type: string, data: any) => void
  onOpenSidebar: () => void
  onPTTStart: () => void
  onPTTEnd: () => void
}

export function ChatView({ send, onOpenSidebar, onPTTStart, onPTTEnd }: Props) {
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const rooms = useChatStore((s) => s.rooms)
  const userId = useChatStore((s) => s.userId)
  const displayName = useChatStore((s) => s.displayName)
  const shortId = useChatStore((s) => s.shortId)
  const meshViewerOpen = useChatStore((s) => s.meshViewerOpen)
  const toggleMeshViewer = useChatStore((s) => s.toggleMeshViewer)
  const meshPeers = useChatStore((s) => s.meshPeers)
  const activeVoice = useChatStore((s) => s.activeVoice)
  const localSpeaking = useChatStore((s) => s.localSpeaking)
  const voiceState = useChatStore((s) => s.voiceState)
  const bottomRef = useRef<HTMLDivElement>(null)

  const room = activeRoomId ? rooms[activeRoomId] : null

  useEffect(() => {
    if (!meshViewerOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [room?.messages.length, meshViewerOpen])

  if (!room) {
    return (
      <div className="flex-1 flex items-center justify-center bg-pl-bg">
        <div className="text-center px-4">
          <div className="text-4xl mb-3 opacity-20">&#x1f4ac;</div>
          <p className="text-pl-text-sec">Select a room to start chatting</p>
          <button
            onClick={onOpenSidebar}
            className="mt-4 md:hidden text-pl-accent text-sm"
          >
            Open rooms
          </button>
        </div>
      </div>
    )
  }

  const handleSend = (content: string) => {
    send('send_message', { room_id: room.id, content })
  }

  const peers = meshPeers[room.id] || []
  const inVoice = activeVoice?.roomId === room.id
  const voiceChannels = voiceState[room.id] || []
  const activeChannel = inVoice
    ? voiceChannels.find((c) => c.id === activeVoice.channelId)
    : null

  return (
    <div className="flex-1 flex flex-col bg-pl-bg h-full min-w-0">
      {/* Header */}
      <div className="px-3 md:px-4 py-3 bg-pl-header flex items-center gap-2 md:gap-3 border-b border-pl-border shrink-0">
        {/* Hamburger - mobile only */}
        <button
          onClick={onOpenSidebar}
          className="md:hidden text-pl-text-sec p-1.5 rounded-lg hover:bg-pl-hover active:bg-pl-active shrink-0"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>

        <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-pl-active flex items-center justify-center text-pl-text-sec font-semibold text-sm shrink-0">
          {room.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-pl-text truncate">{room.name}</div>
          <div className="text-xs text-pl-text-sec">
            {room.members} member{room.members !== 1 ? 's' : ''}
            {activeChannel && (
              <span className="text-pl-accent ml-2">
                &#x1f3a4; {activeChannel.name}
              </span>
            )}
          </div>
        </div>

        {/* Mesh viewer toggle */}
        <button
          onClick={toggleMeshViewer}
          className={`p-2 rounded-lg transition shrink-0 ${
            meshViewerOpen
              ? 'bg-pl-accent/20 text-pl-accent'
              : 'text-pl-text-sec hover:text-pl-text hover:bg-pl-hover active:bg-pl-active'
          }`}
          title="Mesh topology"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="5" r="2.5" />
            <circle cx="5" cy="18" r="2.5" />
            <circle cx="19" cy="18" r="2.5" />
            <line x1="12" y1="7.5" x2="5" y2="15.5" />
            <line x1="12" y1="7.5" x2="19" y2="15.5" />
            <line x1="5" y1="18" x2="19" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content area: mesh viewer or chat */}
      {meshViewerOpen ? (
        <MeshViewer
          peers={peers}
          selfName={displayName}
          selfShortId={shortId}
        />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-3 md:px-4 py-2 space-y-1">
            {room.messages.map((msg, i) => {
              const prev = room.messages[i - 1]
              const showSender = !prev || prev.sender !== msg.sender
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isSelf={msg.sender === userId}
                  showSender={showSender}
                />
              )
            })}
            <div ref={bottomRef} />
          </div>
          <div className="px-3 md:px-4 py-2 md:py-3 bg-pl-header border-t border-pl-border shrink-0">
            <div className="flex items-center gap-2">
              {/* PTT button (visible when in voice) */}
              {inVoice && (
                <PTTButton
                  onPTTStart={onPTTStart}
                  onPTTEnd={onPTTEnd}
                  active={localSpeaking}
                />
              )}
              <MessageInput onSend={handleSend} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
