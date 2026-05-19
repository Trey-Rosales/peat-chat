import { useState, Component, type ReactNode } from 'react'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Error boundary to prevent voice UI crashes from blanking the entire app
class VoiceBarErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; errorMsg: string }> {
  state = { hasError: false, errorMsg: '' }
  static getDerivedStateFromError(err: Error) { return { hasError: true, errorMsg: err?.message || 'Unknown' } }
  componentDidCatch(err: Error) { console.warn('VoiceBar crashed:', err) }
  render() {
    if (this.state.hasError) {
      return (
        <div className="border-t border-border-subtle bg-surface-2 px-3 py-2 text-xs text-status-critical">
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
    <TooltipProvider>
    <div className="border-t border-border-subtle bg-surface-2 px-3 py-2 shrink-0">
      <div className="flex items-center gap-2">
        {/* Status indicator */}
        <div className="relative shrink-0">
          <div
            className={`w-3 h-3 rounded-full ${
              muted ? 'bg-status-critical' : localSpeaking ? 'bg-brand' : 'bg-brand/50'
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
            {muted && <span className="text-status-critical ml-1">(Muted)</span>}
          </div>
          <div className="text-[10px] text-fg-secondary truncate">
            {String(room?.name || '')} · {memberCount} member{memberCount !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Mic mute button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute mic' : 'Mute mic'}
              aria-pressed={muted ? true : undefined}
              className={`shrink-0 ${
                muted
                  ? 'bg-status-critical/20! text-status-critical! hover:bg-status-critical/30!'
                  : 'bg-transparent! text-fg-secondary! hover:text-fg-primary! hover:bg-surface-2!'
              }`}
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{muted ? 'Unmute mic' : 'Mute mic'}</TooltipContent>
        </Tooltip>

        {/* Voice mode cycle button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={cycleMode}
              aria-label={`Voice mode: ${voiceMode} (tap to cycle)`}
              className={cn(
                'h-7 px-2 text-[10px] font-medium shrink-0',
                voiceMode !== 'ptt'
                  ? 'bg-brand/20 text-brand hover:bg-brand/30 hover:text-brand'
                  : 'text-fg-secondary hover:text-fg-primary',
              )}
            >
              {String(MODE_LABELS[voiceMode as string] || 'PTT')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Voice mode: {voiceMode} (tap to cycle)</TooltipContent>
        </Tooltip>

        {/* PTT hint (desktop only, PTT mode only) */}
        {voiceMode === 'ptt' && (
          <div className="text-[10px] text-fg-secondary/60 shrink-0 hidden md:block">
            <kbd className="px-1 py-0.5 bg-surface-2 rounded text-fg-secondary text-[9px] font-mono">{keyLabel}</kbd>
          </div>
        )}

        {/* Disconnect button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={onDisconnect}
              aria-label="Disconnect"
              className="shrink-0 bg-transparent! text-status-critical! hover:bg-status-critical/10!"
            >
              <PhoneOff className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Disconnect from voice</TooltipContent>
        </Tooltip>
      </div>
    </div>
    </TooltipProvider>
  )
}
