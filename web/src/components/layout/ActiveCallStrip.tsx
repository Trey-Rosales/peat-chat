import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useAppActions } from '@/lib/AppActionsContext'
import { cn } from '@/lib/utils'

export function ActiveCallStrip() {
  const bp = useBreakpoint()
  const activeVoice = useChatStore((s) => s.activeVoice)
  const voiceState = useChatStore((s) => s.voiceState)
  const localSpeaking = useChatStore((s) => s.localSpeaking)
  const rooms = useChatStore((s) => s.rooms)
  const muted = useChatStore((s) => s.voiceMuted)
  const { onMuteToggle, onLeaveVoice, onPTTStart, onPTTEnd } = useAppActions()

  if (!activeVoice) return null

  const channel = voiceState[activeVoice.roomId]?.find((c) => c.id === activeVoice.channelId)
  const channelName = channel?.name ?? 'Voice'
  const roomName = rooms[activeVoice.roomId]?.name ?? ''
  const memberCount = channel?.members.length ?? 0

  return (
    <div
      data-layout="active-call-strip"
      className={cn(
        'absolute z-10 flex flex-col gap-1.5 rounded-md border border-status-critical/40 bg-surface-1/90 backdrop-blur-sm p-2 text-fg-primary',
        bp === 'desktop'
          ? 'left-16 right-[340px] bottom-3'
          : bp === 'tablet'
            ? 'left-12 right-[336px] bottom-2'
            : 'left-14 right-3 bottom-44',
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        <span
          aria-label={localSpeaking ? 'Speaking' : 'Idle'}
          className={cn(
            'inline-block h-2 w-2 rounded-full shrink-0',
            localSpeaking ? 'bg-status-success animate-pulse' : 'bg-fg-tertiary',
          )}
        />
        <span className="truncate">
          {channelName}
          {roomName && <span className="opacity-60"> · {roomName}</span>}
        </span>
        <span className="ml-1 opacity-60 shrink-0">· {memberCount}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="h-8 w-8 text-fg-secondary"
            onClick={() => onMuteToggle(!muted)}
          >
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Hang up"
            className="h-8 w-8 text-status-critical"
            onClick={onLeaveVoice}
          >
            <PhoneOff className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Button
        variant={localSpeaking ? 'destructive' : 'secondary'}
        aria-label="Push to talk"
        className={cn(
          'h-11 w-full rounded-md font-semibold text-sm select-none touch-none',
          localSpeaking && 'animate-pulse',
        )}
        onTouchStart={(e) => { e.preventDefault(); onPTTStart() }}
        onTouchEnd={(e) => { e.preventDefault(); onPTTEnd() }}
        onMouseDown={onPTTStart}
        onMouseUp={onPTTEnd}
        onMouseLeave={() => { if (localSpeaking) onPTTEnd() }}
      >
        <Mic className="mr-2 h-4 w-4" />
        {localSpeaking ? 'TRANSMITTING' : 'Hold to talk'}
      </Button>
    </div>
  )
}
