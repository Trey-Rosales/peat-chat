import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { useSend } from '@/lib/WebSocketContext'
import { useAppActions } from '@/lib/AppActionsContext'
import { RoomItem } from './RoomItem'
import { VoiceChannelList } from './VoiceChannelList'
import { VoiceBar } from './VoiceBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { RoomInfoData } from '../types'

interface SidebarBodyProps {
  displayName: string
  shortId: string
  connected: boolean
  rooms: ReturnType<typeof useChatStore.getState>['rooms']
  activeRoomId: string | null
  setActiveRoom: (id: string) => void
  voiceState: ReturnType<typeof useChatStore.getState>['voiceState']
  voiceError: string | null
  meshPeers: ReturnType<typeof useChatStore.getState>['meshPeers']
  availableRooms: RoomInfoData[]
}

function SidebarBody({
  rooms,
  activeRoomId,
  setActiveRoom,
  voiceState,
  meshPeers,
  availableRooms,
}: SidebarBodyProps) {
  const send = useSend()
  const actions = useAppActions()
  const pushContextRoute = useChatStore((s) => s.pushContextRoute)
  const [showDMPicker, setShowDMPicker] = useState(false)

  const handleSelectRoom = (roomId: string) => {
    setActiveRoom(roomId)
    pushContextRoute({ route: 'chat', roomId })
  }
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomPublic, setNewRoomPublic] = useState(true)

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
  }

  const handleCreateRoom = () => {
    const name = newRoomName.trim()
    if (!name) return
    send('create_room', { name, is_public: newRoomPublic })
    setNewRoomName('')
    setNewRoomPublic(true)
    setShowCreateRoom(false)
  }

  const handleJoinDiscoveredRoom = (roomName: string) => {
    send('join_room', { name: roomName })
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex-1 flex flex-col overflow-hidden">
        <ScrollArea className="h-full">
          <div className="py-1">
            {/* Rooms section */}
            <div className="px-3 pt-3 pb-1 flex items-center justify-between">
              <div className="text-[10px] font-semibold text-fg-secondary uppercase tracking-wider">Rooms</div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-fg-secondary hover:text-fg-primary"
                onClick={() => setShowCreateRoom((v) => !v)}
                aria-label="Create room"
                title="Create room"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
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
                    handleSelectRoom(room.id)
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
                      actions.onJoinVoice(room.id, channelId, channel?.members || [])
                    }}
                    onLeaveChannel={actions.onLeaveVoice}
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
                      className="mx-2 px-3 py-2 rounded-lg flex items-center justify-between hover:bg-accent transition"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-fg-secondary truncate"># {r.name}</div>
                        <div className="text-[10px] text-fg-secondary">{r.members} member{r.members !== 1 ? 's' : ''}</div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleJoinDiscoveredRoom(r.name)}
                        className="h-7 px-2 text-[10px] font-medium text-brand bg-brand/10 hover:bg-brand/20 shrink-0"
                      >
                        Join
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Create room dialog */}
            {showCreateRoom && (
              <div className="mx-2 mb-2 mt-2 bg-background rounded-lg border border-border p-3">
                <div className="text-xs font-medium text-fg-primary mb-2">Create Room</div>
                <Input
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateRoom() }}
                  placeholder="Room name"
                  className="mb-2 text-sm py-1.5 px-2"
                  autoFocus
                />
                <div className="flex items-center justify-between min-h-touch mb-2">
                  <Label htmlFor="sidebar-toggle-room-public">{newRoomPublic ? 'Public' : 'Private'}</Label>
                  <Switch
                    id="sidebar-toggle-room-public"
                    checked={newRoomPublic}
                    onCheckedChange={setNewRoomPublic}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleCreateRoom}
                    disabled={!newRoomName.trim()}
                    size="sm"
                    className="flex-1 text-xs"
                  >
                    Create
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setShowCreateRoom(false); setNewRoomName(''); setNewRoomPublic(true) }}
                    className="flex-1 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* DMs section */}
            <div className="px-3 pt-4 pb-1 flex items-center justify-between">
              <div className="text-[10px] font-semibold text-fg-secondary uppercase tracking-wider">Direct Messages</div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-fg-secondary hover:text-fg-primary"
                onClick={() => setShowDMPicker(!showDMPicker)}
                aria-label="New DM"
                title="New DM"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* DM peer picker */}
            {showDMPicker && (
              <div className="mx-2 mb-2 bg-background rounded-lg border border-border overflow-hidden">
                {onlinePeers.length === 0 ? (
                  <div className="p-3 text-xs text-fg-secondary text-center">No peers online</div>
                ) : (
                  <div className="max-h-40 overflow-y-auto">
                    {onlinePeers.map((peer) => (
                      <Button
                        key={peer.id}
                        variant="ghost"
                        onClick={() => handleStartDM(peer.id)}
                        className="w-full h-auto justify-start gap-2 px-3 py-2 rounded-none"
                      >
                        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-fg-secondary font-semibold text-[10px] shrink-0">
                          {peer.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 text-left">
                          <div className="text-xs text-fg-primary truncate">{peer.name}</div>
                          <div className="text-[10px] text-fg-secondary">{peer.short_id}</div>
                        </div>
                      </Button>
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
                  handleSelectRoom(room.id)
                }}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Voice bar — persists across all tabs */}
      <VoiceBar
        onDisconnect={actions.onLeaveVoice}
        onPTTStart={actions.onPTTStart}
        onPTTEnd={actions.onPTTEnd}
        onMuteToggle={actions.onMuteToggle}
        onModeChange={actions.onModeChange}
      />
    </div>
  )
}

export function Sidebar() {
  const displayName = useChatStore((s) => s.displayName)
  const shortId = useChatStore((s) => s.shortId)
  const connected = useChatStore((s) => s.connected)
  const rooms = useChatStore((s) => s.rooms)
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const setActiveRoom = useChatStore((s) => s.setActiveRoom)
  const voiceState = useChatStore((s) => s.voiceState)
  const voiceError = useChatStore((s) => s.voiceError)
  const meshPeers = useChatStore((s) => s.meshPeers)
  const availableRooms = useChatStore((s) => s.availableRooms)

  const bodyProps: SidebarBodyProps = {
    displayName: String(displayName || '?'),
    shortId: String(shortId || ''),
    connected: Boolean(connected),
    rooms,
    activeRoomId,
    setActiveRoom,
    voiceState,
    voiceError,
    meshPeers,
    availableRooms,
  }

  return <SidebarBody {...bodyProps} />
}
