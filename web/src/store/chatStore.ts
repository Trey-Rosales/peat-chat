import { create } from 'zustand'
import type { ChatMessage, MeshPeer, Room, VoiceChannel, VoiceMember } from '../types'

interface ChatStore {
  userId: string
  shortId: string
  displayName: string
  setDisplayName: (name: string) => void

  rooms: Record<string, Room>
  activeRoomId: string | null
  setActiveRoom: (id: string) => void

  setIdentity: (id: string, shortId: string) => void
  addRoom: (id: string, name: string, members: number) => void
  setRoomHistory: (roomId: string, messages: ChatMessage[]) => void
  addMessage: (roomId: string, message: ChatMessage) => void
  updateRoomMembers: (roomId: string, members: number) => void

  connected: boolean
  setConnected: (c: boolean) => void

  // Mesh viewer
  meshPeers: Record<string, MeshPeer[]>
  meshViewerOpen: boolean
  setMeshPeers: (roomId: string, peers: MeshPeer[]) => void
  toggleMeshViewer: () => void

  // Voice
  voiceState: Record<string, VoiceChannel[]>
  activeVoice: { roomId: string; channelId: string } | null
  localSpeaking: boolean
  setVoiceState: (roomId: string, channels: VoiceChannel[]) => void
  setActiveVoice: (roomId: string, channelId: string) => void
  clearActiveVoice: () => void
  setLocalSpeaking: (speaking: boolean) => void
  updateSpeaking: (roomId: string, channelId: string, peerId: string, speaking: boolean) => void
  addVoiceChannel: (roomId: string, channel: { id: string; name: string }) => void
  addVoicePeer: (roomId: string, channelId: string, peer: VoiceMember) => void
  removeVoicePeer: (roomId: string, channelId: string, peerId: string) => void

  // Settings
  settingsOpen: boolean
  toggleSettings: () => void
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

  addRoom: (id, name, members) => {
    const rooms = { ...get().rooms }
    if (!rooms[id]) {
      rooms[id] = { id, name, messages: [], members, unread: 0 }
    } else {
      rooms[id] = { ...rooms[id], members }
    }
    set({ rooms })
  },

  setRoomHistory: (roomId, messages) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      rooms[roomId] = { ...rooms[roomId], messages }
    }
    set({ rooms })
  },

  addMessage: (roomId, message) => {
    const rooms = { ...get().rooms }
    if (rooms[roomId]) {
      const isActive = get().activeRoomId === roomId
      const isSelf = message.sender === get().userId
      rooms[roomId] = {
        ...rooms[roomId],
        messages: [...rooms[roomId].messages, message],
        unread: isActive || isSelf ? rooms[roomId].unread : rooms[roomId].unread + 1,
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

  connected: false,
  setConnected: (c) => set({ connected: c }),

  // Mesh viewer
  meshPeers: {},
  meshViewerOpen: false,
  setMeshPeers: (roomId, peers) => {
    const meshPeers = { ...get().meshPeers }
    meshPeers[roomId] = peers
    set({ meshPeers })
  },
  toggleMeshViewer: () => set({ meshViewerOpen: !get().meshViewerOpen }),

  // Voice
  voiceState: {},
  activeVoice: null,
  localSpeaking: false,

  setVoiceState: (roomId, channels) => {
    const voiceState = { ...get().voiceState }
    voiceState[roomId] = channels
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
    voiceState[roomId] = [...channels, { ...channel, members: [] }]
    set({ voiceState })
  },

  addVoicePeer: (roomId, channelId, peer) => {
    const voiceState = { ...get().voiceState }
    const channels = voiceState[roomId]
    if (!channels) return
    voiceState[roomId] = channels.map((ch) => {
      if (ch.id !== channelId) return ch
      if (ch.members.some((m) => m.id === peer.id)) return ch
      return { ...ch, members: [...ch.members, peer] }
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

  // Settings
  settingsOpen: false,
  toggleSettings: () => set({ settingsOpen: !get().settingsOpen }),
}))
