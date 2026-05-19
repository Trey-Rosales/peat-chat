import { PTTButton } from './PTTButton'
import { Radio } from 'lucide-react'

interface Props {
  channelName: string
  active: boolean
  onPTTStart: () => void
  onPTTEnd: () => void
}

export function PTTBar({ channelName, active, onPTTStart, onPTTEnd }: Props) {
  return (
    <div className="px-3 md:px-4 py-2 bg-surface-1 border-t border-border-subtle flex items-center gap-3 shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Radio className="h-4 w-4 text-brand shrink-0" />
        <div className="min-w-0">
          <div className="text-xs text-fg-tertiary">Transmitting on</div>
          <div className="text-sm font-medium text-fg-primary truncate">{channelName}</div>
        </div>
      </div>
      <PTTButton onPTTStart={onPTTStart} onPTTEnd={onPTTEnd} active={active} />
    </div>
  )
}
