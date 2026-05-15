import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../store/chatStore'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Send, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  onSend: (content: string) => void
  editContent?: string
}

export function MessageInput({ onSend, editContent }: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const connected = useChatStore((s) => s.connected)

  // When entering edit mode, populate input with existing content
  useEffect(() => {
    if (editContent !== undefined) {
      setText(editContent)
      textareaRef.current?.focus()
    }
  }, [editContent])

  // Auto-grow: adjust height to fit content up to max-h-32
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || !connected) return
    onSend(trimmed)
    setText('')
    // Reset height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isEditing = editContent !== undefined

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); handleSend() }}
      className="flex items-end gap-2 p-2 bg-surface-canvas border-t border-border-subtle"
    >
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={connected ? (isEditing ? 'Edit message...' : 'Type a message') : 'Connecting...'}
        disabled={!connected}
        rows={1}
        className={cn(
          'flex-1 resize-none min-h-touch max-h-32 overflow-y-auto bg-surface-2 text-fg-primary text-sm placeholder:text-fg-tertiary',
          isEditing && 'ring-1 ring-status-warning/50'
        )}
      />
      <Button
        type="submit"
        size="icon"
        disabled={!text.trim() || !connected}
        className={cn(
          'shrink-0 rounded-full',
          isEditing
            ? 'bg-status-warning text-fg-primary'
            : 'bg-brand text-fg-on-brand'
        )}
      >
        {isEditing ? (
          <Check className="h-4 w-4" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </form>
  )
}
