import type { ReactNode } from 'react'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { useChatStore } from '@/store/chatStore'

const SNAP_POINTS = [0.1, 0.25, 0.6, 0.92] as const

interface Props { children: ReactNode }

export function ContextDrawer({ children }: Props) {
  const snap = useChatStore((s) => s.drawerSnap)
  const setSnap = useChatStore((s) => s.setDrawerSnap)

  // Vaul keeps the drawer at full viewport height and slides it via transform.
  // The visible portion is only `snap * 100dvh` from the top of the drawer. To
  // pin children (e.g., a chat composer) to the visible bottom, size the content
  // wrapper to that exact slice. The 1rem buffer accounts for the drag handle.
  const contentHeight = `calc(${snap * 100}dvh - 1rem)`

  return (
    <Drawer
      open
      snapPoints={[...SNAP_POINTS]}
      activeSnapPoint={snap}
      setActiveSnapPoint={(value) => {
        if (typeof value === 'number') setSnap(value)
      }}
      modal={false}
      dismissible={false}
    >
      <DrawerContent>
        <div
          className="flex flex-col overflow-hidden"
          style={{ height: contentHeight }}
        >
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
