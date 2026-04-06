import type { Room } from '../types'

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
        active ? 'bg-pl-active' : 'hover:bg-pl-hover'
      }`}
    >
      <div className="w-12 h-12 rounded-full bg-pl-header flex items-center justify-center text-pl-text-sec font-semibold text-sm shrink-0">
        {room.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-medium text-pl-text truncate">{room.name}</span>
          <span className="text-xs text-pl-text-sec ml-2 shrink-0">{time}</span>
        </div>
        <div className="flex justify-between items-center mt-0.5">
          <span className="text-xs text-pl-text-sec truncate">{preview}</span>
          {room.unread > 0 && (
            <span className="ml-2 bg-pl-accent text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center shrink-0">
              {room.unread}
            </span>
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
