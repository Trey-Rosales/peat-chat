import type { VoiceMember } from '../types'

interface Props {
  member: VoiceMember
  isSelf: boolean
  isSelfMuted?: boolean
}

export function VoiceMemberItem({ member, isSelf, isSelfMuted }: Props) {
  const muted = isSelf ? isSelfMuted : member.muted

  const name = String(member.name || '?')

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <div className="relative">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
            muted
              ? 'bg-red-600/20 text-red-400'
              : isSelf
                ? 'bg-brand/30 text-brand'
                : 'bg-surface-2 text-fg-secondary'
          }`}
        >
          {name.charAt(0).toUpperCase()}
        </div>
        {member.speaking && !muted && (
          <div className="absolute inset-0 rounded-full border-2 border-voice-active animate-pulse" />
        )}
      </div>
      <span className="text-xs text-fg-secondary truncate flex-1">
        {name}
        {isSelf && <span className="text-fg-secondary/60 ml-1">(you)</span>}
      </span>
      {muted ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-red-400 shrink-0 ml-auto">
          <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9l4.17 4.18L21 19.73 4.27 3z"/>
        </svg>
      ) : member.speaking ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-voice-active shrink-0 ml-auto">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      ) : null}
    </div>
  )
}
