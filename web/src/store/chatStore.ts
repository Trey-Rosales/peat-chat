import { create } from 'zustand'
import type { ChatMessage, CotContact, CotMarker, MeshPeer, Room, RoomInfoData, VoiceChannel, VoiceMember } from '../types'

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((msg) => [msg.id, msg]))
  for (const msg of incoming) {
    const prev = byId.get(msg.id)
    byId.set(msg.id, prev ? { ...prev, ...msg } : msg)
  }
  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp)
}

function normalizeVoiceMember(member: unknown): VoiceMember | null {
  if (!member || typeof member !== 'object') return null
  const raw = member as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return null

  const shortIdRaw = typeof raw.short_id === 'string' ? raw.short_id.trim() : ''
  const shortId = shortIdRaw || id.slice(0, 12)
  const nameRaw = typeof raw.name === 'string' ? raw.name.trim() : ''

  return {
    id,
    name: nameRaw || shortId || 'Unknown',
    short_id: shortId,
    speaking: Boolean(raw.speaking),
    muted: typeof raw.muted === 'boolean' ? raw.muted : undefined,
  }
}

function normalizeVoiceChannel(channel: unknown): VoiceChannel | null {
  if (!channel || typeof channel !== 'object') return null
  const raw = channel as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return null

  const nameRaw = typeof raw.name === 'string' ? raw.name.trim() : ''
  const members = Array.isArray(raw.members) ? raw.members : []
  const membersById = new Map<string, VoiceMember>()
  for (const member of members) {
    const normalized = normalizeVoiceMember(member)
    if (normalized) {
      membersById.set(normalized.id, normalized)
    }
  }

  return {
    id,
    name: nameRaw || 'Voice',
    members: Array.from(membersById.values()),
  }
}

function normalizeVoiceChannels(channels: unknown): VoiceChannel[] {
  if (!Array.isArray(channels)) return []
  const byId = new Map<string, VoiceChannel>()
  for (const channel of channels) {
    const normalized = normalizeVoiceChannel(channel)
    if (normalized) {
      byId.set(normalized.id, normalized)
    }
  }
  return Array.from(byId.values())
}

interface ChatStore {
  userId: string
  shortId: string
  displayName: string
  setDisplayName: (name: string) => void

  rooms: Record<string, Room>
  activeRoomId: string | null
  setActiveRoom: (id: string) => void

  setIdentity: (id: string, shortId: string) => void
  addRoom: (id: string, name: string, members: number, isDM?: boolean) => void
  setRoomHistory: (roomId: string, messages: ChatMessage[]) => void
  addMessage: (roomId: string, message: ChatMessage) => void
  updateRoomMembers: (roomId: string, members: number) => void

  // Message editing / deletion
  editMessage: (roomId: string, messageId: string, content: string, editedAt: number) => void
  deleteMessage: (roomId: string, messageId: string) => void

  // Reactions
  updateReactions: (roomId: string, messageId: string, reactions: Record<string, string[]>) => void

  // Pinned messages
  pinMessage: (roomId: string, messageId: string) => void
  unpinMessage: (roomId: string, messageId: string) => void

  // DMs
  addDMRoom: (id: string, name: string, peerId: string, peerName: string) => void

  // Room discovery
  availableRooms: RoomInfoData[]
  setAvailableRooms: (rooms: RoomInfoData[]) => void

  connected: boolean
  setConnected: (c: boolean) => void

  // Mesh state
  meshPeers: Record<string, MeshPeer[]>
  setMeshPeers: (roomId: string, peers: MeshPeer[]) => void
  mergeMeshPeers: (roomId: string, blePeers: MeshPeer[]) => void

  // Voice
  voiceState: Record<string, VoiceChannel[]>
  activeVoice: { roomId: string; channelId: string } | null
  localSpeaking: boolean
  voiceMuted: boolean
  setVoiceMuted: (muted: boolean) => void
  setVoiceState: (roomId: string, channels: VoiceChannel[]) => void
  setActiveVoice: (roomId: string, channelId: string) => void
  clearActiveVoice: () => void
  setLocalSpeaking: (speaking: boolean) => void
  updateSpeaking: (roomId: string, channelId: string, peerId: string, speaking: boolean) => void
  addVoiceChannel: (roomId: string, channel: { id: string; name: string }) => void
  addVoicePeer: (roomId: string, channelId: string, peer: VoiceMember) => void
  removeVoicePeer: (roomId: string, channelId: string, peerId: string) => void

  // Self position
  selfPosition: { lat: number; lon: number; hae: number; ce: number } | null
  setSelfPosition: (pos: { lat: number; lon: number; hae: number; ce: number } | null) => void

  // CoT / Map
  cotContacts: Record<string, CotContact[]>
  cotMarkers: Record<string, CotMarker[]>
  mapViewerOpen: boolean
  setCotContacts: (roomId: string, contacts: CotContact[]) => void
  setCotMarkers: (roomId: string, markers: CotMarker[]) => void
  addCotMarker: (roomId: string, marker: CotMarker) => void
  removeCotMarker: (roomId: string, markerId: string) => void
  toggleMapViewer: () => void

  // Voice error
  voiceError: string | null
  setVoiceError: (err: string | null) => void

  // Imperative map actions (registered by MapViewer when its map instance is ready)
  mapControls: {
    zoomIn: () => void
    zoomOut: () => void
    centerOnSelf: () => void
    openAddMarker: () => void
  } | null
  setMapControls: (controls: ChatStore['mapControls']) => void

  // Layout overlay sheets
  menuOpen: boolean
  toggleMenu: () => void
  menuRoute: 'home' | 'settings' | 'join-room' | 'mesh'
  setMenuRoute: (route: 'home' | 'settings' | 'join-room' | 'mesh') => void
  drawerSnap: number
  setDrawerSnap: (snap: number) => void
  contextSurfaceHidden: boolean
  setContextSurfaceHidden: (hidden: boolean) => void

  // Context navigation stack (drawer / panel content)
  contextStack: Array<{ route: 'list' } | { route: 'chat'; roomId: string }>
  pushContextRoute: (route: { route: 'chat'; roomId: string }) => void
  popContextRoute: () => void
  resetContextStack: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  userId: '',
  shortId: '',
  displayName: '',
  setDisplayName: (name) => set({ displayName: name }),

  rooms: {},
  activeRoomId: null,
  setActiveRoom: (id) => {
    const rooms = { ...get().rooms }
    if (rooms[id]) {
      rooms[id] = { ...rooms[id], unread: 0 }
    }
    set({ activeRoomId: id, rooms })
  },

  setIdentity: (id, shortId) => set({ userId: id, shortId }),

  addRoom: (id, name, members, isDM) => {
    const rooms = { ...get().rooms }
    if (!rooms[id]) {
      rooms[id] = { id, name, messages: [], members, unread: 0, isDM: isDM || false }
    } else {
      rooms[id] = { ...rooms[id], members }
    }
    set({ rooms })
  },

  setRoomHistory: (roomId, messages) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      rooms[roomId] = {
        ...rooms[roomId],
        messages: mergeMessages(rooms[roomId].messages, messages),
      }
    }
    set({ rooms })
  },

  addMessage: (roomId, message) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      const isActive = get().activeRoomId === roomId
      const isSelf = message.sender === get().userId
      const alreadyExists = rooms[roomId].messages.some((m) => m.id === message.id)
      rooms[roomId] = {
        ...rooms[roomId],
        messages: mergeMessages(rooms[roomId].messages, [message]),
        unread: alreadyExists || isActive || isSelf ? rooms[roomId].unread : rooms[roomId].unread + 1,
      }
    }
    set({ rooms })
  },

  updateRoomMembers: (roomId, members) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      rooms[roomId] = { ...rooms[roomId], members }
    }
    set({ rooms })
  },

  editMessage: (roomId, messageId, content, editedAt) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      rooms[roomId] = {
        ...rooms[roomId],
        messages: rooms[roomId].messages.map((m) =>
          m.id === messageId ? { ...m, content, edited_at: editedAt } : m
        ),
      }
    }
    set({ rooms })
  },

  deleteMessage: (roomId, messageId) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      rooms[roomId] = {
        ...rooms[roomId],
        messages: rooms[roomId].messages.map((m) =>
          m.id === messageId ? { ...m, deleted: true, content: '', pinned: false } : m
        ),
      }
    }
    set({ rooms })
  },

  updateReactions: (roomId, messageId, reactions) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      rooms[roomId] = {
        ...rooms[roomId],
        messages: rooms[roomId].messages.map((m) =>
          m.id === messageId ? { ...m, reactions } : m
        ),
      }
    }
    set({ rooms })
  },

  pinMessage: (roomId, messageId) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      rooms[roomId] = {
        ...rooms[roomId],
        messages: rooms[roomId].messages.map((m) =>
          m.id === messageId ? { ...m, pinned: true } : m
        ),
      }
    }
    set({ rooms })
  },

  unpinMessage: (roomId, messageId) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      rooms[roomId] = {
        ...rooms[roomId],
        messages: rooms[roomId].messages.map((m) =>
          m.id === messageId ? { ...m, pinned: false } : m
        ),
      }
    }
    set({ rooms })
  },

  addDMRoom: (id, name, peerId, peerName) => {
    const rooms = { ...get().rooms }
    if (!rooms[id]) {
      rooms[id] = { id, name, messages: [], members: 2, unread: 0, isDM: true, dmPeerId: peerId, dmPeerName: peerName }
    }
    set({ rooms })
  },

  // Room discovery
  availableRooms: [],
  setAvailableRooms: (rooms) => set({ availableRooms: rooms }),

  connected: false,
  setConnected: (c) => set({ connected: c }),

  // Mesh state
  meshPeers: {},
  setMeshPeers: (roomId, peers) => {
    const meshPeers = { ...get().meshPeers }
    // Preserve BLE/wifi-direct peers from bridge — they come via ble_mesh_state,
    // not mesh_state. Without this, mesh_state overwrites them every broadcast.
    const existing = meshPeers[roomId] || []
    const bridgePeers = existing.filter((p) => p.transport === 'btle' || p.transport === 'wifi-direct')
    // Dedup: don't re-add bridge peers that are also in the new server peers
    const serverIds = new Set(peers.map((p) => p.id))
    const uniqueBridgePeers = bridgePeers.filter((p) => !serverIds.has(p.id))
    // Filter phantom peers (brief connections, scanners, unnamed) that shouldn't appear in mesh
    const allPeers = [...peers, ...uniqueBridgePeers].filter((p) =>
      p.name && p.id && !p.name.toLowerCase().includes('scanner')
    )
    meshPeers[roomId] = allPeers
    set({ meshPeers })
  },
  mergeMeshPeers: (roomId, blePeers) => {
    const meshPeers = { ...get().meshPeers }
    // Replace stale BTLE entries with the latest BLE snapshot while preserving
    // relayed non-BTLE peers such as TCP clients hanging off a relay node.
    const existing = meshPeers[roomId] || []
    const preserved = existing.filter((p) => p.transport !== 'btle')
    meshPeers[roomId] = [...preserved, ...blePeers]
    set({ meshPeers })
  },
  // Voice
  voiceState: {},
  activeVoice: null,
  localSpeaking: false,
  voiceMuted: false,
  setVoiceMuted: (muted) => set({ voiceMuted: muted }),

  setVoiceState: (roomId, channels) => {
    const voiceState = { ...get().voiceState }
    voiceState[roomId] = normalizeVoiceChannels(channels)
    set({ voiceState })
  },

  setActiveVoice: (roomId, channelId) => set({ activeVoice: { roomId, channelId } }),
  clearActiveVoice: () => set({ activeVoice: null }),
  setLocalSpeaking: (speaking) => set({ localSpeaking: speaking }),

  updateSpeaking: (roomId, channelId, peerId, speaking) => {
    const voiceState = { ...get().voiceState }
    const channels = voiceState[roomId]
    if (!channels) return
    voiceState[roomId] = channels.map((ch) => {
      if (ch.id !== channelId) return ch
      return {
        ...ch,
        members: ch.members.map((m) =>
          m.id === peerId ? { ...m, speaking } : m
        ),
      }
    })
    set({ voiceState })
  },

  addVoiceChannel: (roomId, channel) => {
    const voiceState = { ...get().voiceState }
    const channels = voiceState[roomId] || []
    const normalized = normalizeVoiceChannel({ ...channel, members: [] })
    if (!normalized) return
    if (channels.some((existing) => existing.id === normalized.id)) return
    voiceState[roomId] = [...channels, normalized]
    set({ voiceState })
  },

  addVoicePeer: (roomId, channelId, peer) => {
    const voiceState = { ...get().voiceState }
    const channels = voiceState[roomId]
    if (!channels) return
    const normalizedPeer = normalizeVoiceMember(peer)
    if (!normalizedPeer) return
    voiceState[roomId] = channels.map((ch) => {
      if (ch.id !== channelId) return ch
      if (ch.members.some((m) => m.id === normalizedPeer.id)) return ch
      return { ...ch, members: [...ch.members, normalizedPeer] }
    })
    set({ voiceState })
  },

  removeVoicePeer: (roomId, channelId, peerId) => {
    const voiceState = { ...get().voiceState }
    const channels = voiceState[roomId]
    if (!channels) return
    voiceState[roomId] = channels.map((ch) => {
      if (ch.id !== channelId) return ch
      return { ...ch, members: ch.members.filter((m) => m.id !== peerId) }
    })
    set({ voiceState })
  },

  // Self position
  selfPosition: null,
  setSelfPosition: (pos) => set({ selfPosition: pos }),

  // CoT / Map
  cotContacts: {},
  cotMarkers: {},
  mapViewerOpen: false,

  setCotContacts: (roomId, contacts) => {
    const cotContacts = { ...get().cotContacts }
    // Merge incoming contacts with existing by sender_id to prevent
    // upstream cot_state from wiping locally-injected BLE peer positions.
    // Each source re-sends its known contacts; we keep the latest by ID.
    const byId = new Map<string, any>()
    for (const c of (cotContacts[roomId] || [])) {
      const id = (c as any).sender_id || (c as any).uid || ''
      if (id) byId.set(id, c)
    }
    for (const c of contacts) {
      const id = (c as any).sender_id || (c as any).uid || ''
      if (id) byId.set(id, c)
    }
    cotContacts[roomId] = Array.from(byId.values())
    set({ cotContacts })
  },

  setCotMarkers: (roomId, markers) => {
    const cotMarkers = { ...get().cotMarkers }
    cotMarkers[roomId] = markers
    set({ cotMarkers })
  },

  addCotMarker: (roomId, marker) => {
    const cotMarkers = { ...get().cotMarkers }
    const existing = cotMarkers[roomId] || []
    if (!existing.some((m) => m.id === marker.id)) {
      cotMarkers[roomId] = [...existing, marker]
      set({ cotMarkers })
    }
  },

  removeCotMarker: (roomId, markerId) => {
    const cotMarkers = { ...get().cotMarkers }
    const existing = cotMarkers[roomId]
    if (existing) {
      cotMarkers[roomId] = existing.filter((m) => m.id !== markerId)
      set({ cotMarkers })
    }
  },

  toggleMapViewer: () => set({ mapViewerOpen: !get().mapViewerOpen }),

  // Voice error
  voiceError: null,
  setVoiceError: (err) => set({ voiceError: err }),

  // Imperative map actions (registered by MapViewer when its map instance is ready)
  mapControls: null,
  setMapControls: (controls) => set({ mapControls: controls }),

  // Layout overlay sheets
  menuOpen: false,
  // Closing the menu always resets to the home route so the next open starts fresh.
  toggleMenu: () => {
    const open = !get().menuOpen
    set({ menuOpen: open, menuRoute: open ? get().menuRoute : 'home' })
  },
  menuRoute: 'home',
  setMenuRoute: (route) => set({ menuRoute: route }),
  drawerSnap: 0.25,
  setDrawerSnap: (snap) => set({ drawerSnap: snap }),
  contextSurfaceHidden: false,
  setContextSurfaceHidden: (hidden) => set({ contextSurfaceHidden: hidden }),

  // Context navigation stack (drawer / panel content)
  contextStack: [{ route: 'list' }],
  pushContextRoute: (route) =>
    set({ contextStack: [...get().contextStack, route] }),
  popContextRoute: () => {
    const stack = get().contextStack
    if (stack.length <= 1) return
    set({ contextStack: stack.slice(0, -1) })
  },
  resetContextStack: () => set({ contextStack: [{ route: 'list' }] }),
}))
