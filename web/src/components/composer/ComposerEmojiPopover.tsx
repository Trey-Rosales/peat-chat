import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Smile } from 'lucide-react'

export const COMPOSER_EMOJIS = [
  '\u{1F44D}',
  '\u{1F44E}',
  '✅',
  '❌',
  '\u{1F525}',
  '\u{1F440}',
  '\u{1F64F}',
  '\u{1F602}',
  '\u{1F389}',
  '❤️',
] as const

interface Props {
  onPick: (emoji: string) => void
  disabled?: boolean
  defaultOpen?: boolean
}

export function ComposerEmojiPopover({ onPick, disabled, defaultOpen }: Props) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Emoji"
          className="shrink-0 h-9 w-9 text-fg-secondary hover:text-fg-primary"
        >
          <Smile className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-auto p-2">
        <div className="grid grid-cols-5 gap-1">
          {COMPOSER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={emoji}
              onClick={() => {
                onPick(emoji)
                setOpen(false)
              }}
              className="text-lg w-9 h-9 rounded hover:bg-surface-2 transition flex items-center justify-center"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
