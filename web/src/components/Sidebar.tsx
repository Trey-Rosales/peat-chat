import { useState } from 'react'
import { useChatStore } from '../store/chatStore'
import { RoomItem } from './RoomItem'
import { VoiceChannelList } from './VoiceChannelList'
import { VoiceBar } from './VoiceBar'
import Input from './ui/Input'
import Toggle from './ui/Toggle'
import type { VoiceMember, RoomInfoData } from '../types'

interface Props {
  onJoinRoom: () => void
  onSelectRoom: () => void
  onJoinVoice: (roomId: string, channelId: string, members: VoiceMember[]) => void
  onLeaveVoice: () => void
  onPTTStart: () => void
  onPTTEnd: () => void
  onMuteToggle?: (muted: boolean) => void
  onModeChange?: (mode: string) => void
  send: (type: string, data: any) => void
}

export function Sidebar({ onJoinRoom, onSelectRoom, onJoinVoice, onLeaveVoice, onPTTStart, onPTTEnd, onMuteToggle, onModeChange, send }: Props) {
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
  const availableRooms = useChatStore((s) => s.availableRooms)

  const [showDMPicker, setShowDMPicker] = useState(false)
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomPublic, setNewRoomPublic] = useState(true)
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

  // Public rooms the user hasn't joined yet
  const joinedRoomIds = new Set(Object.keys(rooms))
  const discoverableRooms = availableRooms.filter(
    (r: RoomInfoData) => !joinedRoomIds.has(r.room_id)
  )

  const handleStartDM = (targetId: string) => {
    send('start_dm', { target_id: targetId })
    setShowDMPicker(false)
    onSelectRoom()
  }

  const handleCreateRoom = () => {
    const name = newRoomName.trim()
    if (!name) return
    send('create_room', { name, is_public: newRoomPublic })
    setNewRoomName('')
    setNewRoomPublic(true)
    setShowCreateRoom(false)
    onSelectRoom()
  }

  const handleJoinDiscoveredRoom = (roomName: string) => {
    send('join_room', { name: roomName })
    onSelectRoom()
  }

  return (
    <div className="w-80 max-w-[85vw] bg-surface-1 flex flex-col border-r border-border-subtle h-full">
      {/* Header */}
      <div className="px-4 py-3 bg-surface-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-white font-semibold text-sm shrink-0">
            {safeDisplayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-fg-primary truncate">{safeDisplayName}</div>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-brand' : 'bg-status-critical'}`} />
              <span className="text-xs text-fg-secondary">{shortId}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Settings */}
          <button
            onClick={toggleSettings}
            className="text-fg-secondary hover:text-fg-primary transition p-2 rounded-lg hover:bg-surface-2 active:bg-surface-3"
            title="Settings"
            aria-label="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {/* Create room */}
          <button
            onClick={() => setShowCreateRoom(!showCreateRoom)}
            className="text-fg-secondary hover:text-fg-primary transition p-2 rounded-lg hover:bg-surface-2 active:bg-surface-3"
            title="Create room"
            aria-label="Create room"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 8v8M8 12h8" />
            </svg>
          </button>
          {/* Join room */}
          <button
            onClick={onJoinRoom}
            className="text-fg-secondary hover:text-fg-primary transition p-2 rounded-lg hover:bg-surface-2 active:bg-surface-3"
            title="Join room"
            aria-label="Join room"
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
          <div className="text-[10px] font-semibold text-fg-secondary uppercase tracking-wider">Rooms</div>
        </div>
        {regularRooms.length === 0 && (
          <div className="p-4 text-center text-fg-secondary text-sm">
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

        {/* Discover public rooms */}
        {discoverableRooms.length > 0 && (
          <>
            <div className="px-3 pt-4 pb-1">
              <div className="text-[10px] font-semibold text-fg-secondary uppercase tracking-wider">Discover</div>
            </div>
            <div className="space-y-0.5">
              {discoverableRooms.map((r: RoomInfoData) => (
                <div
                  key={r.room_id}
                  className="mx-2 px-3 py-2 rounded-lg flex items-center justify-between hover:bg-surface-2 transition"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-fg-secondary truncate"># {r.name}</div>
                    <div className="text-[10px] text-fg-secondary">{r.members} member{r.members !== 1 ? 's' : ''}</div>
                  </div>
                  <button
                    onClick={() => handleJoinDiscoveredRoom(r.name)}
                    className="text-[10px] font-medium text-brand hover:text-brand/80 px-2 py-1 rounded bg-brand/10 hover:bg-brand/20 transition shrink-0"
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Create room dialog */}
        {showCreateRoom && (
          <div className="mx-2 mb-2 mt-2 bg-surface-canvas rounded-lg border border-border-subtle p-3">
            <div className="text-xs font-medium text-fg-primary mb-2">Create Room</div>
            <Input
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateRoom() }}
              placeholder="Room name"
              className="mb-2 text-sm py-1.5 px-2"
              autoFocus
            />
            <div className="flex items-center gap-2 mb-2">
              <Toggle
                checked={newRoomPublic}
                onChange={setNewRoomPublic}
                label={newRoomPublic ? 'Public' : 'Private'}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateRoom}
                disabled={!newRoomName.trim()}
                className="flex-1 text-xs py-1.5 rounded bg-brand text-white font-medium disabled:opacity-40 hover:bg-brand/90 transition"
              >
                Create
              </button>
              <button
                onClick={() => { setShowCreateRoom(false); setNewRoomName(''); setNewRoomPublic(true) }}
                className="flex-1 text-xs py-1.5 rounded bg-surface-2 text-fg-secondary font-medium hover:bg-surface-3 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* DMs section */}
        <div className="px-3 pt-4 pb-1 flex items-center justify-between">
          <div className="text-[10px] font-semibold text-fg-secondary uppercase tracking-wider">Direct Messages</div>
          <button
            onClick={() => setShowDMPicker(!showDMPicker)}
            className="text-fg-secondary hover:text-fg-primary p-1 rounded hover:bg-surface-2"
            title="New DM"
            aria-label="New DM"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        {/* DM peer picker */}
        {showDMPicker && (
          <div className="mx-2 mb-2 bg-surface-canvas rounded-lg border border-border-subtle overflow-hidden">
            {onlinePeers.length === 0 ? (
              <div className="p-3 text-xs text-fg-secondary text-center">No peers online</div>
            ) : (
              <div className="max-h-40 overflow-y-auto">
                {onlinePeers.map((peer) => (
                  <button
                    key={peer.id}
                    onClick={() => handleStartDM(peer.id)}
                    className="w-full px-3 py-2 flex items-center gap-2 hover:bg-surface-2 transition text-left"
                  >
                    <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center text-fg-secondary font-semibold text-[10px] shrink-0">
                      {peer.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-fg-primary truncate">{peer.name}</div>
                      <div className="text-[10px] text-fg-secondary">{peer.short_id}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {dmRooms.length === 0 && !showDMPicker && (
          <div className="px-4 py-2 text-xs text-fg-secondary">
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
        <div className="mx-2 mb-2 px-3 py-2 bg-status-critical/15 border border-status-critical/30 rounded-lg text-xs text-status-critical">
          {String(voiceError)}
        </div>
      )}

      {/* Voice bar */}
      <VoiceBar onDisconnect={onLeaveVoice} onPTTStart={onPTTStart} onPTTEnd={onPTTEnd} onMuteToggle={onMuteToggle} onModeChange={onModeChange} />
    </div>
  )
}
