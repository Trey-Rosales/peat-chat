import { useState } from 'react'
import Button from './dtak/Button'
import Input from './dtak/Input'
import Surface from './dtak/Surface'

interface Props {
  onJoin: (name: string) => void
  onClose: () => void
}

export function JoinRoomModal({ onJoin, onClose }: Props) {
  const [name, setName] = useState('')

  return (
    <div
      className="fixed inset-0 bg-surface-overlay flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <Surface variant="1" className="rounded-2xl p-6 w-80 shadow-2xl">
        <h2 className="text-lg font-semibold text-fg-primary mb-4">Join Room</h2>
        <Input
          placeholder="Room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onJoin(name.trim())
            if (e.key === 'Escape') onClose()
          }}
          className="mb-3"
          autoFocus
        />
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => name.trim() && onJoin(name.trim())}
            disabled={!name.trim()}
            className="flex-1"
          >
            Join
          </Button>
        </div>
      </Surface>
    </div>
  )
}
