import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VoiceManager } from './VoiceManager'

// Mock getUserMedia
const mockTrack = {
  enabled: true,
  stop: vi.fn(),
  kind: 'audio',
}

const mockStream = {
  getTracks: () => [mockTrack],
  getAudioTracks: () => [mockTrack],
}

// Mock AudioContext
const mockGainNode = {
  gain: { value: 1.0 },
  connect: vi.fn(),
  disconnect: vi.fn(),
}

const mockDestinationStream = {
  getAudioTracks: () => [{ ...mockTrack, enabled: true }],
}

const mockDestinationNode = {
  stream: mockDestinationStream,
}

const mockSourceNode = {
  connect: vi.fn(),
  disconnect: vi.fn(),
}

const mockBuffer = {
  duration: 0.02,
  getChannelData: vi.fn().mockReturnValue(new Float32Array(320)),
}

const mockBufferSource = {
  buffer: null as any,
  connect: vi.fn(),
  disconnect: vi.fn(),
  start: vi.fn(),
  onended: null as any,
}

const mockScriptProcessor = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  onaudioprocess: null as any,
}

vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => ({
  currentTime: 0,
  createMediaStreamSource: vi.fn().mockReturnValue(mockSourceNode),
  createGain: vi.fn().mockReturnValue(mockGainNode),
  createMediaStreamDestination: vi.fn().mockReturnValue(mockDestinationNode),
  createScriptProcessor: vi.fn().mockReturnValue(mockScriptProcessor),
  createBuffer: vi.fn().mockReturnValue(mockBuffer),
  createBufferSource: vi.fn().mockReturnValue(mockBufferSource),
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
})))

vi.stubGlobal('navigator', {
  mediaDevices: {
    getUserMedia: vi.fn().mockResolvedValue(mockStream),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  },
})

// Mock RTCPeerConnection
const mockPC = {
  addTrack: vi.fn(),
  createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'test-offer' }),
  createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'test-answer' }),
  setLocalDescription: vi.fn(),
  setRemoteDescription: vi.fn(),
  addIceCandidate: vi.fn(),
  close: vi.fn(),
  getSenders: vi.fn().mockReturnValue([]),
  localDescription: { type: 'offer', sdp: 'test-offer' },
  connectionState: 'connected',
  ontrack: null as any,
  onicecandidate: null as any,
  onconnectionstatechange: null as any,
}

vi.stubGlobal('RTCPeerConnection', vi.fn().mockImplementation(() => ({
  ...mockPC,
  ontrack: null,
  onicecandidate: null,
  onconnectionstatechange: null,
})))

describe('VoiceManager', () => {
  let manager: VoiceManager
  let sendFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).window = {}
    sendFn = vi.fn()
    manager = new VoiceManager(sendFn)
  })

  it('initializes as inactive', () => {
    expect(manager.isActive).toBe(false)
    expect(manager.currentRoomId).toBe('')
    expect(manager.currentChannelId).toBe('')
  })

  it('joins a channel', async () => {
    await manager.joinChannel('r1', 'vc1', [])

    expect(manager.isActive).toBe(true)
    expect(manager.currentRoomId).toBe('r1')
    expect(manager.currentChannelId).toBe('vc1')
    expect(sendFn).toHaveBeenCalledWith('join_voice', {
      room_id: 'r1',
      channel_id: 'vc1',
    })
  })

  it('requests microphone on join', async () => {
    await manager.joinChannel('r1', 'vc1', [])

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: true,
    })
  })

  it('uses native bridge instead of WebView mic when BLE voice is available', async () => {
    ;(globalThis as any).window = {
      PeatLinkVoice: {
        hasBleVoice: vi.fn().mockReturnValue(true),
        setBridgeLocalMic: vi.fn(),
      },
    }

    await manager.joinChannel('r1', 'vc1', [])

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect((globalThis as any).window.PeatLinkVoice.setBridgeLocalMic).toHaveBeenCalledWith(true)
  })

  it('creates offers to existing members', async () => {
    const members = [
      { id: 'p1', name: 'Alice', short_id: 'p1s', speaking: false },
      { id: 'p2', name: 'Bob', short_id: 'p2s', speaking: false },
    ]

    await manager.joinChannel('r1', 'vc1', members)

    // Should send voice_offer for each existing member
    const offerCalls = sendFn.mock.calls.filter(
      (c: any[]) => c[0] === 'voice_offer'
    )
    expect(offerCalls).toHaveLength(2)
    expect(offerCalls[0][1].target_id).toBe('p1')
    expect(offerCalls[1][1].target_id).toBe('p2')
  })

  it('leaves a channel', async () => {
    await manager.joinChannel('r1', 'vc1', [])
    manager.leaveChannel()

    expect(manager.isActive).toBe(false)
    expect(sendFn).toHaveBeenCalledWith('leave_voice', {
      room_id: 'r1',
      channel_id: 'vc1',
    })
  })

  it('leaves previous channel when joining new one', async () => {
    await manager.joinChannel('r1', 'vc1', [])
    await manager.joinChannel('r2', 'vc2', [])

    // Should have sent leave_voice for vc1
    const leaveCalls = sendFn.mock.calls.filter(
      (c: any[]) => c[0] === 'leave_voice'
    )
    expect(leaveCalls).toHaveLength(1)
    expect(leaveCalls[0][1].channel_id).toBe('vc1')

    expect(manager.currentChannelId).toBe('vc2')
  })

  it('setMuted does nothing when not active', () => {
    // Should not throw
    manager.setMuted(true)
    manager.setMuted(false)
  })

  it('setInputVolume updates gain node', async () => {
    await manager.joinChannel('r1', 'vc1', [])
    manager.setInputVolume(0.5)
    // Gain node value is set internally -- we check it doesn't throw
  })

  it('handlePeerLeft cleans up', async () => {
    await manager.joinChannel('r1', 'vc1', [
      { id: 'p1', name: 'Alice', short_id: 'p1s', speaking: false },
    ])

    // Should not throw
    manager.handlePeerLeft('p1')
    manager.handlePeerLeft('nonexistent')
  })

  it('handlePeerJoined is a no-op', async () => {
    await manager.joinChannel('r1', 'vc1', [])
    // Newcomer sends offers, so existing peers just wait
    manager.handlePeerJoined('p1')
    // No voice_offer should be sent for this
    const offerCalls = sendFn.mock.calls.filter(
      (c: any[]) => c[0] === 'voice_offer' && c[1].target_id === 'p1'
    )
    expect(offerCalls).toHaveLength(0)
  })

  it('destroy cleans up', async () => {
    await manager.joinChannel('r1', 'vc1', [])
    manager.destroy()
    expect(manager.isActive).toBe(false)
  })

  it('destroy is safe when not active', () => {
    manager.destroy() // should not throw
  })
})
