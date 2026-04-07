import type { VoiceMember } from '../types'
import { useSettingsStore } from '../store/settingsStore'

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

export class VoiceManager {
  private peers = new Map<string, RTCPeerConnection>()
  private audioElements = new Map<string, HTMLAudioElement>()
  private localStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private destinationNode: MediaStreamAudioDestinationNode | null = null
  private send: (type: string, data: any) => void
  private roomId: string = ''
  private channelId: string = ''
  private active = false
  private _listenOnly = false

  constructor(send: (type: string, data: any) => void) {
    this.send = send
  }

  get isActive(): boolean {
    return this.active
  }

  get currentRoomId(): string {
    return this.roomId
  }

  get currentChannelId(): string {
    return this.channelId
  }

  get listenOnly(): boolean {
    return this._listenOnly
  }

  async joinChannel(
    roomId: string,
    channelId: string,
    existingMembers: VoiceMember[]
  ): Promise<void> {
    if (this.active) {
      this.leaveChannel()
    }

    this.roomId = roomId
    this.channelId = channelId
    this.active = true
    this._listenOnly = false

    const settings = useSettingsStore.getState()

    // Try to get microphone access; fall back to listen-only if unavailable
    const constraints: MediaStreamConstraints = {
      audio: settings.micDeviceId
        ? { deviceId: { exact: settings.micDeviceId } }
        : true,
    }
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)

      // Set up audio processing chain for volume control
      this.audioContext = new AudioContext()
      this.sourceNode = this.audioContext.createMediaStreamSource(this.localStream)
      this.gainNode = this.audioContext.createGain()
      this.gainNode.gain.value = settings.inputVolume
      this.destinationNode = this.audioContext.createMediaStreamDestination()
      this.sourceNode.connect(this.gainNode)
      this.gainNode.connect(this.destinationNode)

      // Start muted (push-to-talk)
      const processedTrack = this.destinationNode.stream.getAudioTracks()[0]
      processedTrack.enabled = false
    } catch {
      // No mic available — continue in listen-only mode
      this._listenOnly = true
    }

    // Tell the server we're joining
    this.send('join_voice', { room_id: roomId, channel_id: channelId })

    // Create peer connections to all existing members (newcomer sends offers)
    for (const member of existingMembers) {
      await this.createPeerConnection(member.id, true)
    }
  }

  leaveChannel(): void {
    if (!this.active) return

    this.send('leave_voice', {
      room_id: this.roomId,
      channel_id: this.channelId,
    })

    this.cleanup()
  }

  private cleanup(): void {
    this.active = false

    // Close all peer connections
    for (const [id, pc] of this.peers) {
      pc.close()
      this.peers.delete(id)
    }

    // Remove audio elements
    for (const [id, el] of this.audioElements) {
      el.srcObject = null
      el.remove()
      this.audioElements.delete(id)
    }

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
      this.localStream = null
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
      this.sourceNode = null
      this.gainNode = null
      this.destinationNode = null
    }

    this.roomId = ''
    this.channelId = ''
    this._listenOnly = false
  }

  private async createPeerConnection(
    peerId: string,
    createOffer: boolean
  ): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection(ICE_CONFIG)
    this.peers.set(peerId, pc)

    // Add our processed audio track
    if (this.destinationNode) {
      const track = this.destinationNode.stream.getAudioTracks()[0]
      if (track) {
        pc.addTrack(track, this.destinationNode.stream)
      }
    }

    // Handle incoming audio
    pc.ontrack = (event) => {
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.srcObject = event.streams[0]

      const settings = useSettingsStore.getState()
      if (settings.speakerDeviceId && 'setSinkId' in audio) {
        ;(audio as any).setSinkId(settings.speakerDeviceId).catch(() => {})
      }

      this.audioElements.set(peerId, audio)
    }

    // ICE candidate exchange
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send('voice_ice', {
          room_id: this.roomId,
          channel_id: this.channelId,
          target_id: peerId,
          candidate: JSON.stringify(event.candidate),
        })
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.peers.delete(peerId)
        const el = this.audioElements.get(peerId)
        if (el) {
          el.srcObject = null
          el.remove()
          this.audioElements.delete(peerId)
        }
      }
    }

    if (createOffer) {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.send('voice_offer', {
        room_id: this.roomId,
        channel_id: this.channelId,
        target_id: peerId,
        sdp: JSON.stringify(pc.localDescription),
      })
    }

    return pc
  }

  // --- Signaling handlers (called from useWebSocket) ---

  async handleOffer(fromId: string, sdp: string): Promise<void> {
    if (!this.active) return

    const pc = await this.createPeerConnection(fromId, false)
    const desc = JSON.parse(sdp) as RTCSessionDescriptionInit
    await pc.setRemoteDescription(desc)

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    this.send('voice_answer', {
      room_id: this.roomId,
      channel_id: this.channelId,
      target_id: fromId,
      sdp: JSON.stringify(pc.localDescription),
    })
  }

  async handleAnswer(fromId: string, sdp: string): Promise<void> {
    const pc = this.peers.get(fromId)
    if (!pc) return
    const desc = JSON.parse(sdp) as RTCSessionDescriptionInit
    await pc.setRemoteDescription(desc)
  }

  async handleIce(fromId: string, candidate: string): Promise<void> {
    const pc = this.peers.get(fromId)
    if (!pc) return
    const ice = JSON.parse(candidate) as RTCIceCandidateInit
    await pc.addIceCandidate(ice)
  }

  handlePeerJoined(_peerId: string): void {
    // The newcomer will send us an offer; nothing to do here
  }

  handlePeerLeft(peerId: string): void {
    const pc = this.peers.get(peerId)
    if (pc) {
      pc.close()
      this.peers.delete(peerId)
    }
    const el = this.audioElements.get(peerId)
    if (el) {
      el.srcObject = null
      el.remove()
      this.audioElements.delete(peerId)
    }
  }

  // --- PTT ---

  setMuted(muted: boolean): void {
    if (!this.destinationNode) return
    const track = this.destinationNode.stream.getAudioTracks()[0]
    if (track) {
      track.enabled = !muted
    }
  }

  // --- Settings ---

  setInputVolume(vol: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = vol
    }
  }

  async switchMicrophone(deviceId: string): Promise<void> {
    if (!this.active || !this.audioContext || !this.gainNode || !this.destinationNode) return

    // Get new stream
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    })

    // Stop old stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
    }
    this.localStream = newStream

    // Reconnect audio processing chain
    if (this.sourceNode) {
      this.sourceNode.disconnect()
    }
    this.sourceNode = this.audioContext.createMediaStreamSource(newStream)
    this.sourceNode.connect(this.gainNode)

    // Get the current mute state
    const oldTrack = this.destinationNode.stream.getAudioTracks()[0]
    const wasMuted = oldTrack ? !oldTrack.enabled : true

    // Replace track on all peer connections
    const newTrack = this.destinationNode.stream.getAudioTracks()[0]
    if (newTrack) {
      newTrack.enabled = !wasMuted
      for (const pc of this.peers.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
        if (sender) {
          await sender.replaceTrack(newTrack)
        }
      }
    }
  }

  setSpeakerDevice(deviceId: string): void {
    for (const audio of this.audioElements.values()) {
      if ('setSinkId' in audio) {
        ;(audio as any).setSinkId(deviceId).catch(() => {})
      }
    }
  }

  destroy(): void {
    if (this.active) {
      this.leaveChannel()
    }
  }
}
