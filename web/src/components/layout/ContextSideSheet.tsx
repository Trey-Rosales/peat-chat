import { useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'

interface Props { children: ReactNode }

export function ContextSideSheet({ children }: Props) {
  const [open, setOpen] = useState(false)
  const stack = useChatStore((s) => s.contextStack)
  const top = stack[stack.length - 1]
  const roomName = useChatStore((s) =>
    top.route === 'chat' ? s.rooms[top.roomId]?.name : undefined,
  )

  return (
    <>
      {/* Always-visible peek strip on the right edge */}
      <button
        type="button"
        data-layout="context-side-peek"
        className="absolute right-0 top-12 bottom-2 z-20 w-11 rounded-l-lg border border-r-0 border-border-subtle bg-surface-1/85 backdrop-blur-sm text-fg-secondary hover:text-fg-primary"
        aria-label={`Expand ${roomName ?? 'channels'}`}
        onClick={() => setOpen(true)}
      >
        <span className="flex h-full flex-col items-center justify-center gap-2 text-[10px] [writing-mode:vertical-rl]">
          {roomName ?? 'Channels'}
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="z-30 w-[320px] border-l border-border-subtle bg-surface-1/95 p-0 backdrop-blur-sm"
        >
          <div className="flex h-11 items-center gap-2 border-b border-border-subtle px-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Collapse panel"
              className="h-11 w-11 text-fg-secondary"
              onClick={() => setOpen(false)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </div>
          <div className="h-[calc(100%-2.75rem)] overflow-hidden">
            {children}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
