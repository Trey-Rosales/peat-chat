import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Plus, Image as ImageIcon, FileText, Mic, MapPin } from 'lucide-react'

export type AttachKind = 'image' | 'file' | 'voice' | 'location'

interface Props {
  onSelect: (kind: AttachKind) => void
  disabled?: boolean
  defaultOpen?: boolean
}

const ITEMS: { kind: AttachKind; label: string; Icon: typeof ImageIcon }[] = [
  { kind: 'image', label: 'Image', Icon: ImageIcon },
  { kind: 'file', label: 'File', Icon: FileText },
  { kind: 'voice', label: 'Voice message', Icon: Mic },
  { kind: 'location', label: 'Location', Icon: MapPin },
]

export function ComposerAttachMenu({ onSelect, disabled, defaultOpen }: Props) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Attach"
          className="shrink-0 h-10 w-10 text-fg-secondary hover:text-fg-primary"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-48">
        {ITEMS.map(({ kind, label, Icon }) => (
          <DropdownMenuItem
            key={kind}
            onClick={() => onSelect(kind)}
            className="gap-2"
          >
            <Icon className="h-4 w-4 text-fg-secondary" />
            <span>{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
