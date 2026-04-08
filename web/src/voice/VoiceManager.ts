import type { VoiceMember } from '../types'
import { useSettingsStore } from '../store/settingsStore'

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

const BLE_SAMPLE_RATE = 8000 // must match BleVoiceService.SAMPLE_RATE
const BLE_FRAME_SAMPLES = 320
const BLE_POLL_MS = 20

type BleRelayChain = {
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  silentGain: GainNode
  pendingSamples: number[]
  resampleOffset: number
}

type IncomingBleFrame = {
  sender_id?: string
  sender_name?: string
  pcm?: string
}

declare global {
  interface Window {
    PeatLinkVoice?: {
      startPtt(senderId: string, senderName: string): void
      stopPtt(): void
      isTransmitting(): boolean
      hasBleVoice(): boolean
      setBridgeLocalMic?(enabled: boolean): void
      pollIncomingFrames?(): string
      sendPcmFrame?(base64Pcm: string, senderId: string, senderName: string): void
      setVoiceMode?(mode: string): void
      setNoiseGateThreshold?(db: number): void
      getMicLevelDb?(): number
      isVoiceDetected?(): boolean
      getVoiceMode?(): string
      setMicMuted?(muted: boolean): void
      isMicMuted?(): boolean
    }
  }
}

export class VoiceManager {
  private peers = new Map<string, RTCPeerConnection>()
  private peerNames = new Map<string, string>()
  private audioElements = new Map<string, HTMLAudioElement>()
  private pendingIce = new Map<string, RTCIceCandidateInit[]>()
  private localStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private destinationNode: MediaStreamAudioDestinationNode | null = null
  private bleIncomingGain: GainNode | null = null
  private bleRelayChains = new Map<string, BleRelayChain>()
  private bleBridgeTimer: ReturnType<typeof setInterval> | null = null
  private blePlaybackCursor = 0
  private send: (type: string, data: any) => void
  private roomId = ''
  private channelId = ''
  private active = false
  private _listenOnly = false
  private noiseGateActive = false
  private noiseGateAnalyser: AnalyserNode | null = null
  private noiseGateTimer: ReturnType<typeof setInterval> | null = null
  private localInputVolume = useSettingsStore.getState().inputVolume
  private localMicMuted = true

  constructor(send: (type: string, data: any) => void) {
    this.send = send
  }

  get isActive(): boolean {
    return this.active
  }

  /** Start noise gate monitoring — continuously mute/unmute based on mic level */
  startNoiseGate(thresholdDb: number): void {
    if (!this.active || !this.audioContext || !this.sourceNode) return
    this.stopNoiseGate()

    this.noiseGateAnalyser = this.audioContext.createAnalyser()
    this.noiseGateAnalyser.fftSize = 256
    this.sourceNode.connect(this.noiseGateAnalyser)

    const dataArray = new Float32Array(this.noiseGateAnalyser.fftSize)
    let wasSpeaking = false

    this.noiseGateTimer = setInterval(() => {
      if (!this.noiseGateAnalyser || !this.active) return
      this.noiseGateAnalyser.getFloatTimeDomainData(dataArray)
      let sumSq = 0
      for (let i = 0; i < dataArray.length; i++) sumSq += dataArray[i] * dataArray[i]
      const rms = Math.sqrt(sumSq / dataArray.length)
      const db = rms > 0 ? 20 * Math.log10(rms) : -96

      const isSpeaking = db > thresholdDb
      if (isSpeaking !== wasSpeaking) {
        this.setMuted(!isSpeaking)
        if (isSpeaking) {
          this.send('voice_speaking', {
            room_id: this.roomId, channel_id: this.channelId, speaking: true
          })
        } else {
          // Small delay before stopping (catches word endings)
          setTimeout(() => {
            if (!this.noiseGateAnalyser) return
            this.noiseGateAnalyser.getFloatTimeDomainData(dataArray)
            let sq = 0
            for (let i = 0; i < dataArray.length; i++) sq += dataArray[i] * dataArray[i]
            const r = Math.sqrt(sq / dataArray.length)
            const d = r > 0 ? 20 * Math.log10(r) : -96
            if (d <= thresholdDb) {
              this.send('voice_speaking', {
                room_id: this.roomId, channel_id: this.channelId, speaking: false
              })
            }
          }, 300)
        }
        wasSpeaking = isSpeaking
      }
    }, 20) // 50Hz polling
  }

  stopNoiseGate(): void {
    if (this.noiseGateTimer) {
      clearInterval(this.noiseGateTimer)
      this.noiseGateTimer = null
    }
    if (this.noiseGateAnalyser) {
      this.noiseGateAnalyser.disconnect()
      this.noiseGateAnalyser = null
    }
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
    this.peerNames.clear()
    for (const member of existingMembers) {
      this.peerNames.set(member.id, member.name)
    }

    // Audio setup — wrapped in try-catch for BLE-only devices where
    // AudioContext/getUserMedia may be limited
    try {
      const settings = useSettingsStore.getState()
      const useNativeMicBridge = !!window.PeatLinkVoice?.hasBleVoice?.()
      this.localInputVolume = settings.inputVolume
      this.localMicMuted = true
      this.audioContext = new AudioContext()
      this.gainNode = this.audioContext.createGain()
      this.gainNode.gain.value = 0
      this.destinationNode = this.audioContext.createMediaStreamDestination()
      this.gainNode.connect(this.destinationNode)
      this.bleIncomingGain = this.audioContext.createGain()
      this.bleIncomingGain.connect(this.destinationNode)
      // NOT connected to audioContext.destination — native AudioTrack handles
      // local playback. Connecting to speakers causes feedback (own mic echo).
      this.blePlaybackCursor = this.audioContext.currentTime
      await this.audioContext.resume().catch(() => {})

      if (useNativeMicBridge) {
        // Android relay devices use the native audio stack and feed PCM frames
        // back through the bridge. Avoid double-capturing via WebView mic.
        this.syncNativeMicBridge(true)
      } else {
        const constraints: MediaStreamConstraints = {
          audio: settings.micDeviceId
            ? { deviceId: { exact: settings.micDeviceId } }
            : true,
        }
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia(constraints)
          this.sourceNode = this.audioContext.createMediaStreamSource(this.localStream)
          this.sourceNode.connect(this.gainNode)
        } catch {
          this._listenOnly = true
        }
      }

      const processedTrack = this.destinationNode.stream.getAudioTracks()[0]
      if (processedTrack) {
        processedTrack.enabled = true
      }

      if (!useNativeMicBridge) {
        this.syncNativeMicBridge()
      }
    } catch (err) {
      console.warn('Audio setup failed (BLE voice still available):', err)
      this._listenOnly = true
      this.syncNativeMicBridge()
    }

    this.startBleBridge()

    this.send('join_voice', { room_id: roomId, channel_id: channelId })

    // Create WebRTC peer connections — skip BLE peers (they use BLE audio bridge)
    for (const member of existingMembers) {
      if (member.id.startsWith('ble-')) {
        console.log(`Skipping WebRTC for BLE peer: ${member.name}`)
        continue
      }
      try {
        await this.createPeerConnection(member.id, true)
      } catch (err) {
        console.warn(`WebRTC peer connection to ${member.name} failed:`, err)
      }
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

    for (const [id, pc] of this.peers) {
      pc.close()
      this.peers.delete(id)
    }
    this.pendingIce.clear()
    this.peerNames.clear()
    this.stopBleBridge()

    for (const [id, chain] of this.bleRelayChains) {
      chain.processor.disconnect()
      chain.silentGain.disconnect()
      chain.source.disconnect()
      this.bleRelayChains.delete(id)
    }

    for (const [id, el] of this.audioElements) {
      el.srcObject = null
      el.remove()
      this.audioElements.delete(id)
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
      this.localStream = null
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    this.syncNativeMicBridge(false)
    this.gainNode = null
    this.destinationNode = null
    this.bleIncomingGain = null
    this.blePlaybackCursor = 0

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

    if (this.destinationNode) {
      const track = this.destinationNode.stream.getAudioTracks()[0]
      if (track) {
        pc.addTrack(track, this.destinationNode.stream)
      }
    }

    pc.ontrack = (event) => {
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.srcObject = event.streams[0]

      const settings = useSettingsStore.getState()
      if (settings.speakerDeviceId && 'setSinkId' in audio) {
        ;(audio as any).setSinkId(settings.speakerDeviceId).catch(() => {})
      }

      this.audioElements.set(peerId, audio)
      this.attachRemoteBleRelay(peerId, event.streams[0])
    }

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
        this.detachRemoteBleRelay(peerId)
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

  async handleOffer(fromId: string, sdp: string): Promise<void> {
    if (!this.active) return
    if (fromId.startsWith('ble-')) return // BLE peers use BLE audio, not WebRTC

    try {
      const pc = await this.createPeerConnection(fromId, false)
      const desc = JSON.parse(sdp) as RTCSessionDescriptionInit
      await pc.setRemoteDescription(desc)
      await this.flushPendingIce(fromId, pc)

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      this.send('voice_answer', {
        room_id: this.roomId,
        channel_id: this.channelId,
        target_id: fromId,
        sdp: JSON.stringify(pc.localDescription),
      })
    } catch (err) {
      console.warn(`WebRTC offer handling failed for ${fromId} (may be BLE-only):`, err)
    }
  }

  async handleAnswer(fromId: string, sdp: string): Promise<void> {
    const pc = this.peers.get(fromId)
    if (!pc) return
    const desc = JSON.parse(sdp) as RTCSessionDescriptionInit
    await pc.setRemoteDescription(desc)
    await this.flushPendingIce(fromId, pc)
  }

  async handleIce(fromId: string, candidate: string): Promise<void> {
    const pc = this.peers.get(fromId)
    const ice = JSON.parse(candidate) as RTCIceCandidateInit

    if (!pc || !pc.remoteDescription) {
      const queue = this.pendingIce.get(fromId) || []
      queue.push(ice)
      this.pendingIce.set(fromId, queue)
      return
    }

    await pc.addIceCandidate(ice)
  }

  private async flushPendingIce(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const queued = this.pendingIce.get(peerId)
    if (!queued || queued.length === 0) return
    this.pendingIce.delete(peerId)
    for (const ice of queued) {
      await pc.addIceCandidate(ice)
    }
  }

  handlePeerJoined(peerId: string, name?: string): void {
    if (name) {
      this.peerNames.set(peerId, name)
    }
  }

  handlePeerLeft(peerId: string): void {
    this.pendingIce.delete(peerId)
    this.detachRemoteBleRelay(peerId)
    this.peerNames.delete(peerId)
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

  setMuted(muted: boolean): void {
    this.localMicMuted = muted
    if (this.gainNode) {
      this.gainNode.gain.value = muted ? 0 : this.localInputVolume
    }
  }

  setInputVolume(vol: number): void {
    this.localInputVolume = vol
    if (this.gainNode) {
      this.gainNode.gain.value = this.localMicMuted ? 0 : vol
    }
  }

  async switchMicrophone(deviceId: string): Promise<void> {
    if (!this.active || !this.audioContext || !this.gainNode || !this.destinationNode) return

    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    })

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
    }
    this.localStream = newStream

    if (this.sourceNode) {
      this.sourceNode.disconnect()
    }
    this.sourceNode = this.audioContext.createMediaStreamSource(newStream)
    this.sourceNode.connect(this.gainNode)
    this.gainNode.gain.value = this.localMicMuted ? 0 : this.localInputVolume
    this.syncNativeMicBridge()
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

  private _bleSpeakingState = false

  private startBleBridge(): void {
    if (!window.PeatLinkVoice?.hasBleVoice?.()) return

    this.stopBleBridge()
    if (this.audioContext) {
      this.blePlaybackCursor = this.audioContext.currentTime
    }
    this.bleBridgeTimer = setInterval(() => {
      this.drainIncomingBleFrames()
      this.pollNativeSpeakingState()
    }, BLE_POLL_MS)
  }

  /** Poll native voice detection and send speaking state to server */
  private pollNativeSpeakingState(): void {
    if (!window.PeatLinkVoice?.isVoiceDetected) return
    try {
      const speaking = window.PeatLinkVoice.isVoiceDetected()
      if (speaking !== this._bleSpeakingState) {
        this._bleSpeakingState = speaking
        this.send('voice_speaking', {
          room_id: this.roomId,
          channel_id: this.channelId,
          speaking,
        })
      }
    } catch {}
  }

  private stopBleBridge(): void {
    if (this.bleBridgeTimer) {
      clearInterval(this.bleBridgeTimer)
      this.bleBridgeTimer = null
    }
  }

  private syncNativeMicBridge(force?: boolean): void {
    if (!window.PeatLinkVoice?.setBridgeLocalMic) return
    const enable = force ?? (!this.localStream && !!window.PeatLinkVoice?.hasBleVoice?.())
    try {
      window.PeatLinkVoice.setBridgeLocalMic(enable)
    } catch {}
  }

  private drainIncomingBleFrames(): void {
    if (!window.PeatLinkVoice?.pollIncomingFrames) return
    if (!this.audioContext || !this.bleIncomingGain) return

    let frames: IncomingBleFrame[] = []
    try {
      const raw = window.PeatLinkVoice.pollIncomingFrames()
      frames = raw ? JSON.parse(raw) : []
    } catch {
      return
    }

    for (const frame of frames) {
      if (!frame.pcm) continue
      const pcmBytes = decodeBase64(frame.pcm)
      if (pcmBytes.length < 2) continue
      this.scheduleIncomingBleFrame(pcmBytes)
    }
  }

  private scheduleIncomingBleFrame(pcmBytes: Uint8Array): void {
    if (!this.audioContext || !this.bleIncomingGain) return

    const sampleCount = Math.floor(pcmBytes.length / 2)
    const buffer = this.audioContext.createBuffer(1, sampleCount, BLE_SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < sampleCount; i++) {
      const lo = pcmBytes[i * 2]
      const hi = pcmBytes[i * 2 + 1]
      const sample = (hi << 8) | lo
      const signed = sample >= 0x8000 ? sample - 0x10000 : sample
      channel[i] = signed / 32768
    }

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(this.bleIncomingGain)

    const startAt = Math.max(this.audioContext.currentTime, this.blePlaybackCursor)
    source.start(startAt)
    this.blePlaybackCursor = startAt + buffer.duration
    source.onended = () => source.disconnect()
  }

  private attachRemoteBleRelay(peerId: string, stream: MediaStream): void {
    if (
      !this.audioContext ||
      !window.PeatLinkVoice?.hasBleVoice?.() ||
      !window.PeatLinkVoice.sendPcmFrame
    ) {
      return
    }

    this.detachRemoteBleRelay(peerId)

    const source = this.audioContext.createMediaStreamSource(stream)
    const processor = this.audioContext.createScriptProcessor(1024, 1, 1)
    const silentGain = this.audioContext.createGain()
    silentGain.gain.value = 0

    const chain: BleRelayChain = {
      source,
      processor,
      silentGain,
      pendingSamples: [],
      resampleOffset: 0,
    }

    processor.onaudioprocess = (event) => {
      try {
        if (!this.active || !window.PeatLinkVoice?.sendPcmFrame || !this.audioContext) {
          return
        }

        const input = event.inputBuffer.getChannelData(0)
        appendResampledPcm16(
          chain.pendingSamples,
          input,
          this.audioContext.sampleRate,
          chain
        )

        while (chain.pendingSamples.length >= BLE_FRAME_SAMPLES) {
          const frame = chain.pendingSamples.splice(0, BLE_FRAME_SAMPLES)
          const pcmBytes = int16SamplesToBytes(frame)
          const senderName = this.peerNames.get(peerId) || peerId
          window.PeatLinkVoice.sendPcmFrame(
            encodeBase64(pcmBytes),
            peerId,
            senderName
          )
        }
      } catch (err) {
        console.warn('BLE audio relay error:', err)
      }
    }

    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(this.audioContext.destination)
    this.bleRelayChains.set(peerId, chain)
  }

  private detachRemoteBleRelay(peerId: string): void {
    const chain = this.bleRelayChains.get(peerId)
    if (!chain) return
    chain.processor.disconnect()
    chain.silentGain.disconnect()
    chain.source.disconnect()
    this.bleRelayChains.delete(peerId)
  }
}

function appendResampledPcm16(
  target: number[],
  input: Float32Array,
  inputRate: number,
  chain: BleRelayChain
) {
  const ratio = inputRate / BLE_SAMPLE_RATE
  let pos = chain.resampleOffset
  while (pos < input.length) {
    const idx = Math.floor(pos)
    const next = Math.min(idx + 1, input.length - 1)
    const frac = pos - idx
    const sample = input[idx] * (1 - frac) + input[next] * frac
    target.push(floatToInt16(sample))
    pos += ratio
  }
  chain.resampleOffset = pos - input.length
}

function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0
    ? Math.round(clamped * 32768)
    : Math.round(clamped * 32767)
}

function int16SamplesToBytes(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] < 0 ? samples[i] + 0x10000 : samples[i]
    bytes[i * 2] = value & 0xff
    bytes[i * 2 + 1] = (value >> 8) & 0xff
  }
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
