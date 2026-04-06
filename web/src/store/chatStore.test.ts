import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from './chatStore'

// Reset store between tests
beforeEach(() => {
  useChatStore.setState({
    userId: '',
    shortId: '',
    displayName: '',
    rooms: {},
    activeRoomId: null,
    connected: false,
    meshPeers: {},
    meshViewerOpen: false,
    voiceState: {},
    activeVoice: null,
    localSpeaking: false,
    settingsOpen: false,
  })
})

describe('chatStore - identity', () => {
  it('sets identity', () => {
    useChatStore.getState().setIdentity('abc123', 'abc1')
    const s = useChatStore.getState()
    expect(s.userId).toBe('abc123')
    expect(s.shortId).toBe('abc1')
  })

  it('sets display name', () => {
    useChatStore.getState().setDisplayName('Alice')
    expect(useChatStore.getState().displayName).toBe('Alice')
  })
})

describe('chatStore - rooms', () => {
  it('adds a room', () => {
    useChatStore.getState().addRoom('r1', 'general', 3)
    const rooms = useChatStore.getState().rooms
    expect(rooms['r1']).toBeDefined()
    expect(rooms['r1'].name).toBe('general')
    expect(rooms['r1'].members).toBe(3)
    expect(rooms['r1'].messages).toEqual([])
    expect(rooms['r1'].unread).toBe(0)
  })

  it('updates existing room members', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().addRoom('r1', 'general', 5)
    expect(useChatStore.getState().rooms['r1'].members).toBe(5)
  })

  it('sets active room and clears unread', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    // Simulate unread
    const rooms = { ...useChatStore.getState().rooms }
    rooms['r1'] = { ...rooms['r1'], unread: 5 }
    useChatStore.setState({ rooms })

    useChatStore.getState().setActiveRoom('r1')
    expect(useChatStore.getState().activeRoomId).toBe('r1')
    expect(useChatStore.getState().rooms['r1'].unread).toBe(0)
  })

  it('sets room history', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    const msgs = [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hi' },
    ]
    useChatStore.getState().setRoomHistory('r1', msgs)
    expect(useChatStore.getState().rooms['r1'].messages).toHaveLength(1)
    expect(useChatStore.getState().rooms['r1'].messages[0].content).toBe('hi')
  })

  it('adds message and increments unread when not active', () => {
    useChatStore.getState().setIdentity('self', 'self')
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().addRoom('r2', 'other', 1)
    useChatStore.getState().setActiveRoom('r1')

    // Message to non-active room
    useChatStore.getState().addMessage('r2', {
      id: 'm1', sender: 'other', sender_name: 'Bob', timestamp: 1000, content: 'hey',
    })
    expect(useChatStore.getState().rooms['r2'].unread).toBe(1)
  })

  it('does not increment unread for self messages', () => {
    useChatStore.getState().setIdentity('self', 's')
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().addRoom('r2', 'other', 1)
    useChatStore.getState().setActiveRoom('r1')

    useChatStore.getState().addMessage('r2', {
      id: 'm1', sender: 'self', sender_name: 'Me', timestamp: 1000, content: 'hey',
    })
    expect(useChatStore.getState().rooms['r2'].unread).toBe(0)
  })
})

describe('chatStore - connection', () => {
  it('sets connected state', () => {
    useChatStore.getState().setConnected(true)
    expect(useChatStore.getState().connected).toBe(true)
    useChatStore.getState().setConnected(false)
    expect(useChatStore.getState().connected).toBe(false)
  })
})

describe('chatStore - mesh', () => {
  it('sets mesh peers', () => {
    useChatStore.getState().setMeshPeers('r1', [
      { id: 'p1', name: 'Alice', short_id: 'p1s', transport: 'tcp', latency_ms: 10, state: 'connected', connected_at: 1000 },
    ])
    expect(useChatStore.getState().meshPeers['r1']).toHaveLength(1)
  })

  it('toggles mesh viewer', () => {
    expect(useChatStore.getState().meshViewerOpen).toBe(false)
    useChatStore.getState().toggleMeshViewer()
    expect(useChatStore.getState().meshViewerOpen).toBe(true)
    useChatStore.getState().toggleMeshViewer()
    expect(useChatStore.getState().meshViewerOpen).toBe(false)
  })
})

describe('chatStore - voice', () => {
  it('sets voice state', () => {
    useChatStore.getState().setVoiceState('r1', [
      { id: 'vc1', name: 'General', members: [] },
    ])
    const vs = useChatStore.getState().voiceState['r1']
    expect(vs).toHaveLength(1)
    expect(vs[0].name).toBe('General')
  })

  it('sets and clears active voice', () => {
    useChatStore.getState().setActiveVoice('r1', 'vc1')
    const av = useChatStore.getState().activeVoice
    expect(av).toEqual({ roomId: 'r1', channelId: 'vc1' })

    useChatStore.getState().clearActiveVoice()
    expect(useChatStore.getState().activeVoice).toBeNull()
  })

  it('sets local speaking', () => {
    useChatStore.getState().setLocalSpeaking(true)
    expect(useChatStore.getState().localSpeaking).toBe(true)
    useChatStore.getState().setLocalSpeaking(false)
    expect(useChatStore.getState().localSpeaking).toBe(false)
  })

  it('updates speaking state for a peer', () => {
    useChatStore.getState().setVoiceState('r1', [
      {
        id: 'vc1',
        name: 'General',
        members: [
          { id: 'p1', name: 'Alice', short_id: 'p1s', speaking: false },
          { id: 'p2', name: 'Bob', short_id: 'p2s', speaking: false },
        ],
      },
    ])

    useChatStore.getState().updateSpeaking('r1', 'vc1', 'p1', true)
    const ch = useChatStore.getState().voiceState['r1'][0]
    expect(ch.members[0].speaking).toBe(true)
    expect(ch.members[1].speaking).toBe(false)
  })

  it('adds a voice channel', () => {
    useChatStore.getState().setVoiceState('r1', [
      { id: 'vc1', name: 'General', members: [] },
    ])

    useChatStore.getState().addVoiceChannel('r1', { id: 'vc2', name: 'Tactical' })
    const channels = useChatStore.getState().voiceState['r1']
    expect(channels).toHaveLength(2)
    expect(channels[1].name).toBe('Tactical')
    expect(channels[1].members).toEqual([])
  })

  it('adds a voice peer', () => {
    useChatStore.getState().setVoiceState('r1', [
      { id: 'vc1', name: 'General', members: [] },
    ])

    useChatStore.getState().addVoicePeer('r1', 'vc1', {
      id: 'p1', name: 'Alice', short_id: 'p1s', speaking: false,
    })
    const members = useChatStore.getState().voiceState['r1'][0].members
    expect(members).toHaveLength(1)
    expect(members[0].name).toBe('Alice')
  })

  it('does not duplicate voice peer', () => {
    useChatStore.getState().setVoiceState('r1', [
      { id: 'vc1', name: 'General', members: [{ id: 'p1', name: 'Alice', short_id: 'p1s', speaking: false }] },
    ])

    useChatStore.getState().addVoicePeer('r1', 'vc1', {
      id: 'p1', name: 'Alice', short_id: 'p1s', speaking: false,
    })
    expect(useChatStore.getState().voiceState['r1'][0].members).toHaveLength(1)
  })

  it('removes a voice peer', () => {
    useChatStore.getState().setVoiceState('r1', [
      {
        id: 'vc1',
        name: 'General',
        members: [
          { id: 'p1', name: 'Alice', short_id: 'p1s', speaking: false },
          { id: 'p2', name: 'Bob', short_id: 'p2s', speaking: false },
        ],
      },
    ])

    useChatStore.getState().removeVoicePeer('r1', 'vc1', 'p1')
    const members = useChatStore.getState().voiceState['r1'][0].members
    expect(members).toHaveLength(1)
    expect(members[0].name).toBe('Bob')
  })
})

describe('chatStore - settings', () => {
  it('toggles settings', () => {
    expect(useChatStore.getState().settingsOpen).toBe(false)
    useChatStore.getState().toggleSettings()
    expect(useChatStore.getState().settingsOpen).toBe(true)
    useChatStore.getState().toggleSettings()
    expect(useChatStore.getState().settingsOpen).toBe(false)
  })
})
