import { Map as MapIcon, MessageSquare, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useOrientation } from '@/hooks/useOrientation'
import { cn } from '@/lib/utils'
import { OnlineIndicator } from './OnlineIndicator'

function formatLatLon(lat: number, lon: number): string {
  return `${lat.toFixed(2)}° / ${lon.toFixed(2)}°`
}

export function TopBar() {
  const bp = useBreakpoint()
  const orientation = useOrientation()
  const displayName = useChatStore((s) => s.displayName) || 'Operator'
  const selfPosition = useChatStore((s) => s.selfPosition)
  const toggleMenu = useChatStore((s) => s.toggleMenu)
  const drawerSnap = useChatStore((s) => s.drawerSnap)
  const setDrawerSnap = useChatStore((s) => s.setDrawerSnap)
  const contextSurfaceHidden = useChatStore((s) => s.contextSurfaceHidden)
  const setContextSurfaceHidden = useChatStore((s) => s.setContextSurfaceHidden)

  const geo = selfPosition ? formatLatLon(selfPosition.lat, selfPosition.lon) : null

  // Drawer is the surface only for mobile-portrait; everything else uses panel/side-sheet.
  const usesDrawer = bp === 'mobile' && orientation !== 'landscape'

  // Active = which surface is currently focused.
  // Drawer mode: chat focused when drawer is >= mid snap; otherwise map focused.
  // Panel/sheet mode: map focused when surface is hidden; otherwise chat focused.
  const chatFocused = usesDrawer ? drawerSnap >= 0.5 : !contextSurfaceHidden
  const mapFocused = !chatFocused

  const focusMap = () => {
    if (usesDrawer) setDrawerSnap(0.25)
    else setContextSurfaceHidden(true)
  }
  const focusChat = () => {
    if (usesDrawer) setDrawerSnap(0.92)
    else setContextSurfaceHidden(false)
  }

  // Heights: keep buttons one step smaller than the bar so hover surfaces stay inside.
  const isCompact = bp === 'tablet'
  const barHeight = isCompact ? 'h-10' : 'h-12'
  const iconBtnSize = isCompact ? 'icon-xs' : 'icon'
  const iconBtnClass = cn(
    'shrink-0 text-fg-secondary hover:text-fg-primary',
    isCompact ? 'h-8 w-8' : 'h-10 w-10',
  )

  return (
    <header
      data-layout="topbar"
      className={cn(
        'absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-border-subtle bg-surface-1/85 backdrop-blur-sm px-2 text-fg-primary',
        barHeight,
      )}
    >
      {/* Online status indicator */}
      <OnlineIndicator />

      {/* Identity: name + geo coords stacked */}
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-semibold tracking-wide">{displayName}</span>
        <span className="truncate font-mono text-[10px] text-fg-secondary">
          {geo ?? 'No fix'}
        </span>
      </div>

      {/* Surface toggles */}
      <Button
        variant="ghost"
        size={iconBtnSize as 'icon' | 'icon-xs'}
        className={cn(
          iconBtnClass,
          mapFocused && 'bg-brand/15 text-brand hover:bg-brand/20 hover:text-brand',
        )}
        aria-label="Focus map"
        aria-pressed={mapFocused}
        onClick={focusMap}
      >
        <MapIcon className="h-5 w-5" />
      </Button>
      <Button
        variant="ghost"
        size={iconBtnSize as 'icon' | 'icon-xs'}
        className={cn(
          iconBtnClass,
          chatFocused && 'bg-brand/15 text-brand hover:bg-brand/20 hover:text-brand',
        )}
        aria-label="Focus chat"
        aria-pressed={chatFocused}
        onClick={focusChat}
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
      <Button
        variant="ghost"
        size={iconBtnSize as 'icon' | 'icon-xs'}
        className={iconBtnClass}
        aria-label="Open menu"
        onClick={toggleMenu}
      >
        <Menu className="h-5 w-5" />
      </Button>
    </header>
  )
}
