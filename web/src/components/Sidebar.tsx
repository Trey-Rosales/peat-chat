import { useChatStore } from '../store/chatStore'
import { RoomItem } from './RoomItem'
import { VoiceChannelList } from './VoiceChannelList'
import { VoiceBar } from './VoiceBar'
import type { VoiceMember } from '../types'

interface Props {
  onJoinRoom: () => void
  onSelectRoom: () => void
  onJoinVoice: (roomId: string, channelId: string, members: VoiceMember[]) => void
  onLeaveVoice: () => void
  onPTTStart: () => void
  onPTTEnd: () => void
  send: (type: string, data: any) => void
}

export function Sidebar({ onJoinRoom, onSelectRoom, onJoinVoice, onLeaveVoice, onPTTStart, onPTTEnd, send }: Props) {
  const displayName = useChatStore((s) => s.displayName)
  const shortId = useChatStore((s) => s.shortId)
  const connected = useChatStore((s) => s.connected)
  const rooms = useChatStore((s) => s.rooms)
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const setActiveRoom = useChatStore((s) => s.setActiveRoom)
  const voiceState = useChatStore((s) => s.voiceState)
  const toggleSettings = useChatStore((s) => s.toggleSettings)
  const voiceError = useChatStore((s) => s.voiceError)

  const sortedRooms = Object.values(rooms).sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1]?.timestamp ?? 0
    const bLast = b.messages[b.messages.length - 1]?.timestamp ?? 0
    return bLast - aLast
  })

  return (
    <div className="w-80 max-w-[85vw] bg-pl-sidebar flex flex-col border-r border-pl-border h-full">
      {/* Header */}
      <div className="px-4 py-3 bg-pl-header flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-pl-accent flex items-center justify-center text-white font-semibold text-sm shrink-0">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-pl-text truncate">{displayName}</div>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-pl-accent' : 'bg-pl-danger'}`} />
              <span className="text-xs text-pl-text-sec">{shortId}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Settings */}
          <button
            onClick={toggleSettings}
            className="text-pl-text-sec hover:text-pl-text transition p-2 rounded-lg hover:bg-pl-hover active:bg-pl-active"
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {/* Join room */}
          <button
            onClick={onJoinRoom}
            className="text-pl-text-sec hover:text-pl-text transition p-2 rounded-lg hover:bg-pl-hover active:bg-pl-active"
            title="Join room"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Room list */}
      <div className="flex-1 overflow-y-auto">
        {sortedRooms.length === 0 && (
          <div className="p-4 text-center text-pl-text-sec text-sm">
            No rooms yet
          </div>
        )}
        {sortedRooms.map((room) => (
          <div key={room.id}>
            <RoomItem
              room={room}
              active={room.id === activeRoomId}
              onClick={() => {
                setActiveRoom(room.id)
                onSelectRoom()
              }}
            />
            {/* Voice channels for active room */}
            {room.id === activeRoomId && voiceState[room.id] && (
              <VoiceChannelList
                roomId={room.id}
                channels={voiceState[room.id]}
                onJoinChannel={(channelId) => {
                  const channels = voiceState[room.id] || []
                  const channel = channels.find((c) => c.id === channelId)
                  onJoinVoice(room.id, channelId, channel?.members || [])
                }}
                onLeaveChannel={onLeaveVoice}
                onCreateChannel={(name) => {
                  send('create_voice_channel', { room_id: room.id, name })
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Voice error toast */}
      {voiceError && (
        <div className="mx-2 mb-2 px-3 py-2 bg-pl-danger/15 border border-pl-danger/30 rounded-lg text-xs text-pl-danger">
          {voiceError}
        </div>
      )}

      {/* Voice bar */}
      <VoiceBar onDisconnect={onLeaveVoice} onPTTStart={onPTTStart} onPTTEnd={onPTTEnd} />
    </div>
  )
}
