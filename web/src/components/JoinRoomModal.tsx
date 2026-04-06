import { useState } from 'react'

interface Props {
  onJoin: (name: string) => void
  onClose: () => void
}

export function JoinRoomModal({ onJoin, onClose }: Props) {
  const [name, setName] = useState('')

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-pl-sidebar rounded-2xl p-6 w-80 shadow-2xl">
        <h2 className="text-lg font-semibold text-pl-text mb-4">Join Room</h2>
        <input
          type="text"
          placeholder="Room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onJoin(name.trim())
            if (e.key === 'Escape') onClose()
          }}
          className="w-full bg-pl-input text-pl-text rounded-lg px-4 py-3 text-sm placeholder-pl-text-sec mb-3"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm text-pl-text-sec rounded-lg hover:bg-pl-hover transition"
          >
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onJoin(name.trim())}
            disabled={!name.trim()}
            className="flex-1 bg-pl-accent text-white rounded-lg py-2.5 text-sm font-medium hover:brightness-110 transition disabled:opacity-30"
          >
            Join
          </button>
        </div>
      </div>
    </div>
  )
}
