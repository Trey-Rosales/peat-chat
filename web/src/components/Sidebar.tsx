import { useState } from 'react'
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
  onMuteToggle?: (muted: boolean) => void
  send: (type: string, data: any) => void
}

export function Sidebar({ onJoinRoom, onSelectRoom, onJoinVoice, onLeaveVoice, onPTTStart, onPTTEnd, onMuteToggle, send }: Props) {
  const displayName = useChatStore((s) => s.displayName)
  const shortId = useChatStore((s) => s.shortId)
  const connected = useChatStore((s) => s.connected)
  const rooms = useChatStore((s) => s.rooms)
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const setActiveRoom = useChatStore((s) => s.setActiveRoom)
  const voiceState = useChatStore((s) => s.voiceState)
  const toggleSettings = useChatStore((s) => s.toggleSettings)
  const voiceError = useChatStore((s) => s.voiceError)
  const meshPeers = useChatStore((s) => s.meshPeers)

  const [showDMPicker, setShowDMPicker] = useState(false)
  const safeDisplayName = String(displayName || '?')

  const allRooms = Object.values(rooms)
  const regularRooms = allRooms.filter((r) => !r.isDM).sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1]?.timestamp ?? 0
    const bLast = b.messages[b.messages.length - 1]?.timestamp ?? 0
    return bLast - aLast
  })
  const dmRooms = allRooms.filter((r) => r.isDM).sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1]?.timestamp ?? 0
    const bLast = b.messages[b.messages.length - 1]?.timestamp ?? 0
    return bLast - aLast
  })

  // Collect online peers from mesh state (deduplicated across rooms)
  const onlinePeers = (() => {
    const seen = new Set<string>()
    const peers: { id: string; name: string; short_id: string }[] = []
    for (const peerList of Object.values(meshPeers)) {
      for (const p of peerList) {
        if (!seen.has(p.id)) {
          seen.add(p.id)
          peers.push({ id: p.id, name: p.name, short_id: p.short_id })
        }
      }
    }
    return peers.sort((a, b) => a.name.localeCompare(b.name))
  })()

  const handleStartDM = (targetId: string) => {
    send('start_dm', { target_id: targetId })
    setShowDMPicker(false)
    onSelectRoom()
  }

  return (
    <div className="w-80 max-w-[85vw] bg-pl-sidebar flex flex-col border-r border-pl-border h-full">
      {/* Header */}
      <div className="px-4 py-3 bg-pl-header flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-pl-accent flex items-center justify-center text-white font-semibold text-sm shrink-0">
            {safeDisplayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-pl-text truncate">{safeDisplayName}</div>
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
        {/* Rooms section */}
        <div className="px-3 pt-3 pb-1">
          <div className="text-[10px] font-semibold text-pl-text-sec uppercase tracking-wider">Rooms</div>
        </div>
        {regularRooms.length === 0 && (
          <div className="p-4 text-center text-pl-text-sec text-sm">
            No rooms yet
          </div>
        )}
        {regularRooms.map((room) => (
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
                channels={Array.isArray(voiceState[room.id]) ? voiceState[room.id] : []}
                onJoinChannel={(channelId) => {
                  const channels = Array.isArray(voiceState[room.id]) ? voiceState[room.id] : []
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

        {/* DMs section */}
        <div className="px-3 pt-4 pb-1 flex items-center justify-between">
          <div className="text-[10px] font-semibold text-pl-text-sec uppercase tracking-wider">Direct Messages</div>
          <button
            onClick={() => setShowDMPicker(!showDMPicker)}
            className="text-pl-text-sec hover:text-pl-text p-1 rounded hover:bg-pl-hover"
            title="New DM"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        {/* DM peer picker */}
        {showDMPicker && (
          <div className="mx-2 mb-2 bg-pl-bg rounded-lg border border-pl-border overflow-hidden">
            {onlinePeers.length === 0 ? (
              <div className="p-3 text-xs text-pl-text-sec text-center">No peers online</div>
            ) : (
              <div className="max-h-40 overflow-y-auto">
                {onlinePeers.map((peer) => (
                  <button
                    key={peer.id}
                    onClick={() => handleStartDM(peer.id)}
                    className="w-full px-3 py-2 flex items-center gap-2 hover:bg-pl-hover transition text-left"
                  >
                    <div className="w-7 h-7 rounded-full bg-pl-active flex items-center justify-center text-pl-text-sec font-semibold text-[10px] shrink-0">
                      {peer.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-pl-text truncate">{peer.name}</div>
                      <div className="text-[10px] text-pl-text-sec">{peer.short_id}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {dmRooms.length === 0 && !showDMPicker && (
          <div className="px-4 py-2 text-xs text-pl-text-sec">
            No conversations yet
          </div>
        )}
        {dmRooms.map((room) => (
          <RoomItem
            key={room.id}
            room={room}
            active={room.id === activeRoomId}
            onClick={() => {
              setActiveRoom(room.id)
              onSelectRoom()
            }}
          />
        ))}
      </div>

      {/* Voice error toast */}
      {voiceError && (
        <div className="mx-2 mb-2 px-3 py-2 bg-pl-danger/15 border border-pl-danger/30 rounded-lg text-xs text-pl-danger">
          {String(voiceError)}
        </div>
      )}

      {/* Voice bar */}
      <VoiceBar onDisconnect={onLeaveVoice} onPTTStart={onPTTStart} onPTTEnd={onPTTEnd} onMuteToggle={onMuteToggle} />
    </div>
  )
}
