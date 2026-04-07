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
    selfPosition: null,
    cotContacts: {},
    cotMarkers: {},
    mapViewerOpen: false,
    voiceError: null,
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

  it('deduplicates room history by message id', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'first' },
    ])
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'updated' },
    ])

    const messages = useChatStore.getState().rooms['r1'].messages
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('updated')
  })

  it('deduplicates addMessage by message id', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().addMessage('r1', {
      id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello',
    })
    useChatStore.getState().addMessage('r1', {
      id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello again',
    })

    const room = useChatStore.getState().rooms['r1']
    expect(room.messages).toHaveLength(1)
    expect(room.messages[0].content).toBe('hello again')
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

describe('chatStore - CoT contacts', () => {
  it('sets CoT contacts', () => {
    useChatStore.getState().setCotContacts('r1', [
      { uid: 'p1', callsign: 'Alice', short_id: 'p1s', cot_type: 'a-f-G-U-C', lat: 38.89, lon: -77.03, hae: 0, ce: 10, time: 1000, stale: 31000 },
    ])
    expect(useChatStore.getState().cotContacts['r1']).toHaveLength(1)
    expect(useChatStore.getState().cotContacts['r1'][0].callsign).toBe('Alice')
  })
})

describe('chatStore - CoT markers', () => {
  it('sets markers', () => {
    useChatStore.getState().setCotMarkers('r1', [
      { id: 'm1', creator_id: 'p1', creator_name: 'Alice', lat: 38.89, lon: -77.03, hae: 0, ce: 999999, le: 999999, name: 'Rally', icon: 'rally', color: 'green', cot_type: 'b-m-p-s-m', how: 'h-e', created_at: 1000, stale: 87400000, remarks: '' },
    ])
    expect(useChatStore.getState().cotMarkers['r1']).toHaveLength(1)
  })

  it('adds a marker', () => {
    useChatStore.getState().setCotMarkers('r1', [])
    useChatStore.getState().addCotMarker('r1', {
      id: 'm1', creator_id: 'p1', creator_name: 'Alice', lat: 38.89, lon: -77.03, hae: 0, ce: 999999, le: 999999, name: 'Rally', icon: 'rally', color: 'green', cot_type: 'b-m-p-s-m', how: 'h-e', created_at: 1000, stale: 87400000, remarks: '',
    })
    expect(useChatStore.getState().cotMarkers['r1']).toHaveLength(1)
  })

  it('does not duplicate markers', () => {
    const marker = { id: 'm1', creator_id: 'p1', creator_name: 'Alice', lat: 38.89, lon: -77.03, hae: 0, ce: 999999, le: 999999, name: 'Rally', icon: 'rally', color: 'green', cot_type: 'b-m-p-s-m', how: 'h-e', created_at: 1000, stale: 87400000, remarks: '' }
    useChatStore.getState().setCotMarkers('r1', [marker])
    useChatStore.getState().addCotMarker('r1', marker)
    expect(useChatStore.getState().cotMarkers['r1']).toHaveLength(1)
  })

  it('removes a marker', () => {
    useChatStore.getState().setCotMarkers('r1', [
      { id: 'm1', creator_id: 'p1', creator_name: 'Alice', lat: 38.89, lon: -77.03, hae: 0, ce: 999999, le: 999999, name: 'Rally', icon: 'rally', color: 'green', cot_type: 'b-m-p-s-m', how: 'h-e', created_at: 1000, stale: 87400000, remarks: '' },
      { id: 'm2', creator_id: 'p2', creator_name: 'Bob', lat: 39.0, lon: -77.1, hae: 0, ce: 999999, le: 999999, name: 'Objective', icon: 'objective', color: 'red', cot_type: 'b-r-.-O', how: 'h-e', created_at: 2000, stale: 87402000, remarks: '' },
    ])
    useChatStore.getState().removeCotMarker('r1', 'm1')
    const markers = useChatStore.getState().cotMarkers['r1']
    expect(markers).toHaveLength(1)
    expect(markers[0].name).toBe('Objective')
  })
})

describe('chatStore - map viewer', () => {
  it('toggles map viewer', () => {
    expect(useChatStore.getState().mapViewerOpen).toBe(false)
    useChatStore.getState().toggleMapViewer()
    expect(useChatStore.getState().mapViewerOpen).toBe(true)
    useChatStore.getState().toggleMapViewer()
    expect(useChatStore.getState().mapViewerOpen).toBe(false)
  })

  it('opening map closes mesh viewer', () => {
    useChatStore.setState({ meshViewerOpen: true })
    useChatStore.getState().toggleMapViewer()
    expect(useChatStore.getState().mapViewerOpen).toBe(true)
    expect(useChatStore.getState().meshViewerOpen).toBe(false)
  })

  it('opening mesh closes map viewer', () => {
    useChatStore.setState({ mapViewerOpen: true })
    useChatStore.getState().toggleMeshViewer()
    expect(useChatStore.getState().meshViewerOpen).toBe(true)
    expect(useChatStore.getState().mapViewerOpen).toBe(false)
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

describe('chatStore - message editing', () => {
  it('edits a message content and edited_at', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello' },
      { id: 'm2', sender: 's2', sender_name: 'Bob', timestamp: 2000, content: 'world' },
    ])

    useChatStore.getState().editMessage('r1', 'm1', 'hello edited', 3000)
    const msgs = useChatStore.getState().rooms['r1'].messages
    expect(msgs[0].content).toBe('hello edited')
    expect(msgs[0].edited_at).toBe(3000)
  })

  it('does not affect other messages in the room', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello' },
      { id: 'm2', sender: 's2', sender_name: 'Bob', timestamp: 2000, content: 'world' },
    ])

    useChatStore.getState().editMessage('r1', 'm1', 'hello edited', 3000)
    const msgs = useChatStore.getState().rooms['r1'].messages
    expect(msgs[1].content).toBe('world')
    expect(msgs[1].edited_at).toBeUndefined()
  })
})

describe('chatStore - message deletion', () => {
  it('deletes a message setting deleted=true and content empty', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello' },
    ])

    useChatStore.getState().deleteMessage('r1', 'm1')
    const msg = useChatStore.getState().rooms['r1'].messages[0]
    expect(msg.deleted).toBe(true)
    expect(msg.content).toBe('')
  })

  it('deleting a pinned message clears pinned flag', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello', pinned: true },
    ])

    useChatStore.getState().deleteMessage('r1', 'm1')
    const msg = useChatStore.getState().rooms['r1'].messages[0]
    expect(msg.deleted).toBe(true)
    expect(msg.pinned).toBe(false)
  })
})

describe('chatStore - reactions', () => {
  it('sets reactions on a message', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello' },
    ])

    useChatStore.getState().updateReactions('r1', 'm1', { '👍': ['s1', 's2'] })
    const msg = useChatStore.getState().rooms['r1'].messages[0]
    expect(msg.reactions).toEqual({ '👍': ['s1', 's2'] })
  })

  it('clears reactions with empty object', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello', reactions: { '👍': ['s1'] } },
    ])

    useChatStore.getState().updateReactions('r1', 'm1', {})
    const msg = useChatStore.getState().rooms['r1'].messages[0]
    expect(msg.reactions).toEqual({})
  })
})

describe('chatStore - pinned messages', () => {
  it('pins a message', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello' },
    ])

    useChatStore.getState().pinMessage('r1', 'm1')
    const msg = useChatStore.getState().rooms['r1'].messages[0]
    expect(msg.pinned).toBe(true)
  })

  it('unpins a message', () => {
    useChatStore.getState().addRoom('r1', 'general', 1)
    useChatStore.getState().setRoomHistory('r1', [
      { id: 'm1', sender: 's1', sender_name: 'Alice', timestamp: 1000, content: 'hello', pinned: true },
    ])

    useChatStore.getState().unpinMessage('r1', 'm1')
    const msg = useChatStore.getState().rooms['r1'].messages[0]
    expect(msg.pinned).toBe(false)
  })
})

describe('chatStore - DM rooms', () => {
  it('adds a DM room with isDM=true and peer info', () => {
    useChatStore.getState().addDMRoom('dm1', 'Alice', 'p1', 'Alice')
    const room = useChatStore.getState().rooms['dm1']
    expect(room).toBeDefined()
    expect(room.isDM).toBe(true)
    expect(room.dmPeerId).toBe('p1')
    expect(room.dmPeerName).toBe('Alice')
    expect(room.members).toBe(2)
    expect(room.messages).toEqual([])
  })

  it('addRoom with isDM=true preserves the flag', () => {
    useChatStore.getState().addRoom('r1', 'dm-room', 2, true)
    const room = useChatStore.getState().rooms['r1']
    expect(room.isDM).toBe(true)
  })

  it('addRoom without isDM defaults to false', () => {
    useChatStore.getState().addRoom('r1', 'general', 3)
    const room = useChatStore.getState().rooms['r1']
    expect(room.isDM).toBe(false)
  })
})
