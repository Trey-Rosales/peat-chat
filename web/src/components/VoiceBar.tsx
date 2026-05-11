import { useState, Component, type ReactNode } from 'react'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import IconButton from './dtak/IconButton'

// Error boundary to prevent voice UI crashes from blanking the entire app
class VoiceBarErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; errorMsg: string }> {
  state = { hasError: false, errorMsg: '' }
  static getDerivedStateFromError(err: Error) { return { hasError: true, errorMsg: err?.message || 'Unknown' } }
  componentDidCatch(err: Error) { console.warn('VoiceBar crashed:', err) }
  render() {
    if (this.state.hasError) {
      return (
        <div className="border-t border-border-subtle bg-surface-2 px-3 py-2 text-xs text-red-400">
          Voice: {String(this.state.errorMsg || 'Unknown')} - <button onClick={() => this.setState({ hasError: false, errorMsg: '' })} className="underline">retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

interface Props {
  onDisconnect: () => void
  onPTTStart: () => void
  onPTTEnd: () => void
  onMuteToggle?: (muted: boolean) => void
  onModeChange?: (mode: string) => void
}

const VOICE_MODES = ['ptt', 'noise_gate', 'auto'] as const
const MODE_LABELS: Record<string, string> = {
  ptt: 'PTT',
  noise_gate: 'GATE',
  auto: 'AUTO',
}

export function VoiceBar(props: Props) {
  return (
    <VoiceBarErrorBoundary>
      <VoiceBarInner {...props} />
    </VoiceBarErrorBoundary>
  )
}

function VoiceBarInner({ onDisconnect, onPTTStart, onPTTEnd, onMuteToggle, onModeChange }: Props) {
  const activeVoice = useChatStore((s) => s.activeVoice)
  const rooms = useChatStore((s) => s.rooms)
  const voiceState = useChatStore((s) => s.voiceState)
  const localSpeaking = useChatStore((s) => s.localSpeaking)
  const pttKey = useSettingsStore((s) => s.pttKey)
  const voiceMode = useSettingsStore((s) => s.voiceMode)
  const setVoiceMode = useSettingsStore((s) => s.setVoiceMode)
  const [muted, setMuted] = useState(false)

  if (!activeVoice) return null

  const room = rooms[activeVoice.roomId]
  if (!room) return null // Room might not exist yet
  const channels = Array.isArray(voiceState[activeVoice.roomId]) ? voiceState[activeVoice.roomId] : []
  const channel = channels.find((c) => c.id === activeVoice.channelId)
  const memberCount = Array.isArray(channel?.members) ? channel.members.length : 0

  const keyLabel = !pttKey ? 'Space' : pttKey === ' ' ? 'Space' : pttKey.length === 1 ? pttKey.toUpperCase() : pttKey

  const cycleMode = () => {
    const idx = VOICE_MODES.indexOf(voiceMode as any)
    const next = VOICE_MODES[(idx + 1) % VOICE_MODES.length]
    setVoiceMode(next)
    if (window.PeatLinkVoice?.setVoiceMode) {
      window.PeatLinkVoice.setVoiceMode(next)
    }
    onModeChange?.(next)
  }

  const toggleMute = () => {
    const newMuted = !muted
    setMuted(newMuted)
    // Android native mute
    if (window.PeatLinkVoice?.setMicMuted) {
      window.PeatLinkVoice.setMicMuted(newMuted)
    }
    // Web client: mute/unmute WebRTC audio via VoiceManager gain node
    onMuteToggle?.(newMuted)
  }

  return (
    <div className="border-t border-border-subtle bg-surface-2 px-3 py-2 shrink-0">
      <div className="flex items-center gap-2">
        {/* Status indicator */}
        <div className="relative shrink-0">
          <div
            className={`w-3 h-3 rounded-full ${
              muted ? 'bg-red-500' : localSpeaking ? 'bg-brand' : 'bg-brand/50'
            }`}
          />
          {localSpeaking && !muted && (
            <div className="absolute inset-0 w-3 h-3 rounded-full bg-brand animate-ping" />
          )}
        </div>

        {/* Channel info */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-brand truncate">
            {String(channel?.name || 'Voice Connected')}
            {muted && <span className="text-red-400 ml-1">(Muted)</span>}
          </div>
          <div className="text-[10px] text-fg-secondary truncate">
            {String(room?.name || '')} · {memberCount} member{memberCount !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Mic mute button */}
        <IconButton
          onClick={toggleMute}
          label={muted ? 'Unmute mic' : 'Mute mic'}
          toggled={muted}
          className={`shrink-0 ${
            muted
              ? '!bg-red-600/20 !text-red-400 hover:!bg-red-600/30'
              : '!bg-transparent !text-fg-secondary hover:!text-fg-primary hover:!bg-surface-2'
          }`}
          icon={
            muted ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9l4.17 4.18L21 19.73 4.27 3z"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            )
          }
        />

        {/* Voice mode cycle button */}
        <button
          onClick={cycleMode}
          className={`px-2 py-1 rounded-md text-[10px] font-medium transition shrink-0 ${
            voiceMode !== 'ptt'
              ? 'bg-brand/20 text-brand'
              : 'bg-surface-2 text-fg-secondary hover:text-fg-primary'
          }`}
          title={`Voice mode: ${voiceMode} (tap to cycle)`}
        >
          {String(MODE_LABELS[voiceMode as string] || 'PTT')}
        </button>

        {/* PTT hint (desktop only, PTT mode only) */}
        {voiceMode === 'ptt' && (
          <div className="text-[10px] text-fg-secondary/60 shrink-0 hidden md:block">
            <kbd className="px-1 py-0.5 bg-surface-2 rounded text-fg-secondary text-[9px] font-mono">{keyLabel}</kbd>
          </div>
        )}

        {/* Disconnect button */}
        <IconButton
          onClick={onDisconnect}
          label="Disconnect"
          className="shrink-0 !bg-transparent !text-status-critical hover:!bg-status-critical/10"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          }
        />
      </div>
    </div>
  )
}
