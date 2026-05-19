import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../store/chatStore'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Send, Check, Mic } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ComposerAttachMenu, type AttachKind } from './composer/ComposerAttachMenu'
import { ComposerEmojiPopover } from './composer/ComposerEmojiPopover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  onSend: (content: string) => void
  onAttach: (kind: AttachKind) => void
  editContent?: string
  onCancelContext?: () => void
  contextKind?: 'reply' | 'edit' | null
}

export function MessageInput({
  onSend,
  onAttach,
  editContent,
  onCancelContext,
  contextKind,
}: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const connected = useChatStore((s) => s.connected)

  useEffect(() => {
    if (editContent !== undefined) {
      setText(editContent)
      textareaRef.current?.focus()
    }
  }, [editContent])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const isEditing = editContent !== undefined
  const trimmed = text.trim()
  const canSend = trimmed.length > 0 && connected

  const handleSend = () => {
    if (!canSend) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }
    if (e.key === 'Escape' && contextKind && onCancelContext) {
      e.preventDefault()
      onCancelContext()
    }
  }

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current
    if (!el) {
      setText((t) => t + emoji)
      return
    }
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + emoji.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSend()
      }}
      className="flex items-end gap-2"
    >
      <div
        className={cn(
          'flex-1 flex items-end gap-1 rounded-2xl bg-surface-1 border border-border-subtle px-1 py-1 transition',
          'focus-within:ring-1 focus-within:ring-brand/40 focus-within:border-brand/40',
          isEditing && 'ring-1 ring-status-warning/50 border-status-warning/40',
        )}
      >
        <ComposerAttachMenu onSelect={onAttach} disabled={!connected || isEditing} />
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            connected
              ? isEditing
                ? 'Edit message…'
                : 'Type a message'
              : 'Connecting…'
          }
          disabled={!connected}
          rows={1}
          className="flex-1 resize-none border-0 bg-transparent text-sm text-fg-primary placeholder:text-fg-tertiary focus-visible:ring-0 min-h-9 max-h-32 overflow-y-auto px-2 py-2 shadow-none"
        />
        <ComposerEmojiPopover onPick={insertEmoji} disabled={!connected} />
      </div>

      {canSend || isEditing ? (
        <Button
          type="submit"
          size="icon"
          aria-label={isEditing ? 'Save edit' : 'Send message'}
          disabled={!canSend && !isEditing}
          className={cn(
            'shrink-0 rounded-full h-10 w-10',
            isEditing
              ? 'bg-status-warning text-fg-primary hover:bg-status-warning/90'
              : 'bg-brand text-fg-on-brand hover:bg-brand/90',
          )}
        >
          {isEditing ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              aria-label="Voice message"
              variant="ghost"
              className="shrink-0 rounded-full h-10 w-10 bg-surface-2 text-fg-secondary hover:text-fg-primary"
              onClick={(e) => e.preventDefault()}
            >
              <Mic className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Voice messages coming soon</TooltipContent>
        </Tooltip>
      )}
    </form>
  )
}
