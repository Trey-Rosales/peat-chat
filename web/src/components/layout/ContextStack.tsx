import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'
import { Sidebar } from '@/components/Sidebar'
import { ChatView } from '@/components/ChatView'

export function ContextStack() {
  const stack = useChatStore((s) => s.contextStack)
  const popContextRoute = useChatStore((s) => s.popContextRoute)
  const rooms = useChatStore((s) => s.rooms)

  const top = stack[stack.length - 1]

  if (top.route === 'list') {
    return (
      <div data-layout="context-stack" className="flex h-full flex-col">
        <Sidebar />
      </div>
    )
  }

  // chat route
  const room = rooms[top.roomId]
  const title = room ? (room.isDM ? room.name : `# ${room.name}`) : ''

  return (
    <div data-layout="context-stack" className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to channel list"
          className="h-11 w-11 shrink-0 text-fg-secondary"
          onClick={popContextRoute}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        {title && (
          <span className="truncate text-sm font-semibold text-fg-primary">
            {title}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <ChatView />
      </div>
    </div>
  )
}
