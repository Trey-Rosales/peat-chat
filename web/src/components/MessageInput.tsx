import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../store/chatStore'

interface Props {
  onSend: (content: string) => void
  editContent?: string
}

export function MessageInput({ onSend, editContent }: Props) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const connected = useChatStore((s) => s.connected)

  // When entering edit mode, populate input with existing content
  useEffect(() => {
    if (editContent !== undefined) {
      setText(editContent)
      inputRef.current?.focus()
    }
  }, [editContent])

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || !connected) return
    onSend(trimmed)
    setText('')
    inputRef.current?.focus()
  }

  const isEditing = editContent !== undefined

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        placeholder={connected ? (isEditing ? 'Edit message...' : 'Type a message') : 'Connecting...'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
          }
        }}
        disabled={!connected}
        className={`flex-1 bg-surface-2 text-fg-primary rounded-lg px-4 py-2.5 text-sm placeholder:text-fg-tertiary disabled:opacity-50 ${
          isEditing ? 'ring-1 ring-yellow-500/50' : ''
        }`}
      />
      <button
        onClick={handleSend}
        disabled={!text.trim() || !connected}
        className={`rounded-full w-10 h-10 flex items-center justify-center hover:brightness-110 transition disabled:opacity-30 shrink-0 ${
          isEditing ? 'bg-yellow-500 text-white' : 'bg-brand text-white'
        }`}
      >
        {isEditing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        )}
      </button>
    </>
  )
}
