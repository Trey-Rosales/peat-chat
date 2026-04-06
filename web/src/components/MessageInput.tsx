import { useState, useRef } from 'react'
import { useChatStore } from '../store/chatStore'

interface Props {
  onSend: (content: string) => void
}

export function MessageInput({ onSend }: Props) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const connected = useChatStore((s) => s.connected)

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || !connected) return
    onSend(trimmed)
    setText('')
    inputRef.current?.focus()
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        placeholder={connected ? 'Type a message' : 'Connecting...'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
          }
        }}
        disabled={!connected}
        className="flex-1 bg-pl-input text-pl-text rounded-lg px-4 py-2.5 text-sm placeholder-pl-text-sec disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={!text.trim() || !connected}
        className="bg-pl-accent text-white rounded-full w-10 h-10 flex items-center justify-center hover:brightness-110 transition disabled:opacity-30 shrink-0"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </>
  )
}
