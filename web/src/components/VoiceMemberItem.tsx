import type { VoiceMember } from '../types'

interface Props {
  member: VoiceMember
  isSelf: boolean
}

export function VoiceMemberItem({ member, isSelf }: Props) {
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <div className="relative">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
            isSelf ? 'bg-pl-accent/30 text-pl-accent' : 'bg-pl-header text-pl-text-sec'
          }`}
        >
          {member.name.charAt(0).toUpperCase()}
        </div>
        {member.speaking && (
          <div className="absolute inset-0 rounded-full border-2 border-pl-accent animate-pulse" />
        )}
      </div>
      <span className="text-xs text-pl-text-sec truncate">
        {member.name}
        {isSelf && <span className="text-pl-text-sec/60 ml-1">(you)</span>}
      </span>
      {member.speaking && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="text-pl-accent shrink-0 ml-auto"
        >
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      )}
    </div>
  )
}
