import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'

interface Props {
  onDisconnect: () => void
}

export function VoiceBar({ onDisconnect }: Props) {
  const activeVoice = useChatStore((s) => s.activeVoice)
  const rooms = useChatStore((s) => s.rooms)
  const voiceState = useChatStore((s) => s.voiceState)
  const localSpeaking = useChatStore((s) => s.localSpeaking)
  const pttKey = useSettingsStore((s) => s.pttKey)

  if (!activeVoice) return null

  const room = rooms[activeVoice.roomId]
  const channels = voiceState[activeVoice.roomId] || []
  const channel = channels.find((c) => c.id === activeVoice.channelId)

  const keyLabel = pttKey === ' ' ? 'Space' : pttKey.length === 1 ? pttKey.toUpperCase() : pttKey

  return (
    <div className="border-t border-pl-border bg-pl-header px-3 py-2 shrink-0">
      <div className="flex items-center gap-2">
        {/* Status indicator */}
        <div className="relative shrink-0">
          <div
            className={`w-3 h-3 rounded-full ${
              localSpeaking ? 'bg-pl-accent' : 'bg-pl-accent/50'
            }`}
          />
          {localSpeaking && (
            <div className="absolute inset-0 w-3 h-3 rounded-full bg-pl-accent animate-ping" />
          )}
        </div>

        {/* Channel info */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-pl-accent truncate">
            {channel?.name || 'Voice Connected'}
          </div>
          <div className="text-[10px] text-pl-text-sec truncate">
            {room?.name} · {channel?.members.length || 0} member{(channel?.members.length || 0) !== 1 ? 's' : ''}
          </div>
        </div>

        {/* PTT hint */}
        <div className="text-[10px] text-pl-text-sec/60 shrink-0 hidden md:block">
          Hold <kbd className="px-1 py-0.5 bg-pl-input rounded text-pl-text-sec text-[9px] font-mono">{keyLabel}</kbd>
        </div>

        {/* Disconnect button */}
        <button
          onClick={onDisconnect}
          className="p-1.5 rounded-lg text-pl-danger hover:bg-pl-danger/10 transition shrink-0"
          title="Disconnect"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </button>
      </div>
    </div>
  )
}
