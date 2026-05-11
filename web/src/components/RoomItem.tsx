import type { Room } from '../types'
import StatusPill from './dtak/StatusPill'

interface Props {
  room: Room
  active: boolean
  onClick: () => void
}

export function RoomItem({ room, active, onClick }: Props) {
  const lastMsg = room.messages[room.messages.length - 1]
  const preview = lastMsg
    ? `${lastMsg.sender_name}: ${lastMsg.content}`
    : 'No messages yet'
  const time = lastMsg ? formatTime(lastMsg.timestamp) : ''

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition ${
        active ? 'bg-surface-3' : 'hover:bg-surface-2'
      }`}
    >
      <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center text-fg-secondary font-semibold text-sm shrink-0">
        {room.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-medium text-fg-primary truncate">{room.name}</span>
          <span className="text-xs text-fg-tertiary ml-2 shrink-0">{time}</span>
        </div>
        <div className="flex justify-between items-center mt-0.5">
          <span className="text-xs text-fg-tertiary truncate">{preview}</span>
          {room.unread > 0 && (
            <StatusPill variant="count" className="ml-2 shrink-0">
              {room.unread}
            </StatusPill>
          )}
        </div>
      </div>
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
