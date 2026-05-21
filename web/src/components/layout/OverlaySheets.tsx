import { ChevronLeft, MapPinned, Network, Settings as SettingsIcon } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { cn } from '@/lib/utils'
import { SettingsPage } from '@/components/SettingsPage'
import { JoinRoomModal } from '@/components/JoinRoomModal'
import { MeshViewer } from '@/components/MeshViewer'

type MenuRoute = ReturnType<typeof useChatStore.getState>['menuRoute']

function sheetSideFor(bp: 'mobile' | 'tablet' | 'desktop'): 'right' | 'bottom' {
  return bp === 'mobile' ? 'bottom' : 'right'
}

function routeTitle(route: MenuRoute): string {
  switch (route) {
    case 'settings':  return 'Settings'
    case 'join-room': return 'Join Room'
    case 'mesh':      return 'Mesh Viewer'
    default:          return 'Menu'
  }
}

export function OverlaySheets() {
  const bp = useBreakpoint()
  const side = sheetSideFor(bp)
  const menuOpen = useChatStore((s) => s.menuOpen)
  const toggleMenu = useChatStore((s) => s.toggleMenu)
  const menuRoute = useChatStore((s) => s.menuRoute)
  const setMenuRoute = useChatStore((s) => s.setMenuRoute)
  const mapStyle = useSettingsStore((s) => s.mapStyle)
  const cycleMapStyle = useSettingsStore((s) => s.cycleMapStyle)

  const isHome = menuRoute === 'home'

  return (
    <Sheet open={menuOpen} onOpenChange={toggleMenu}>
      <SheetContent
        side={side}
        className={cn(
          'flex flex-col gap-0 bg-surface-1/95 p-0 backdrop-blur-sm',
          // Bottom sheet (mobile) needs an explicit height — shadcn's variant
          // sets only inset-x and bottom-0, so children with h-full collapse.
          side === 'bottom' && 'h-[85dvh] max-h-[85dvh] rounded-t-2xl',
          side === 'right' && 'w-full max-w-sm',
        )}
      >
        {/* Header — back button (non-home routes) + title */}
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
          {!isHome && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Back to menu"
              className="text-fg-secondary hover:text-fg-primary"
              onClick={() => setMenuRoute('home')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <span className="text-sm font-semibold text-fg-primary">{routeTitle(menuRoute)}</span>
        </header>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {menuRoute === 'home' && (
            <nav className="flex flex-col p-2">
              <Button
                variant="ghost"
                className="h-11 justify-start gap-3 text-fg-primary"
                onClick={() => setMenuRoute('join-room')}
              >
                <MapPinned className="h-4 w-4 text-fg-secondary" />
                Join Room
              </Button>
              <Button
                variant="ghost"
                className="h-11 justify-start gap-3 text-fg-primary"
                onClick={() => setMenuRoute('settings')}
              >
                <SettingsIcon className="h-4 w-4 text-fg-secondary" />
                Settings
              </Button>
              <Button
                variant="ghost"
                className="h-11 justify-start gap-3 text-fg-primary"
                onClick={() => setMenuRoute('mesh')}
              >
                <Network className="h-4 w-4 text-fg-secondary" />
                Mesh Viewer
              </Button>
              <Separator className="my-1" />
              <Button
                variant="ghost"
                className="h-11 justify-between text-fg-primary"
                onClick={cycleMapStyle}
              >
                <span>Map Style</span>
                <span className="text-xs text-fg-secondary">{mapStyle}</span>
              </Button>
            </nav>
          )}

          {menuRoute === 'settings' && <SettingsPage />}
          {menuRoute === 'join-room' && <JoinRoomModal />}
          {menuRoute === 'mesh' && <MeshViewer />}
        </div>
      </SheetContent>
    </Sheet>
  )
}
