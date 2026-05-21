import { Plus, Minus, Crosshair, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chatStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { cn } from '@/lib/utils'

export function MapRail() {
  const bp = useBreakpoint()
  const mapControls = useChatStore((s) => s.mapControls)

  const size = bp === 'mobile' ? 'h-10 w-10' : 'h-11 w-11'
  const btnClass = cn(
    size,
    'rounded-full border border-border-subtle bg-surface-1/70 backdrop-blur-sm text-fg-secondary hover:text-fg-primary shadow-md',
  )

  return (
    <div
      data-layout="map-rail"
      className={cn(
        'absolute z-10 flex flex-col gap-2',
        bp === 'mobile' ? 'left-2 top-16' : 'left-3 top-14',
      )}
    >
      <Button variant="ghost" size="icon" aria-label="Zoom in" className={btnClass} onClick={() => mapControls?.zoomIn()}>
        <Plus className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Zoom out" className={btnClass} onClick={() => mapControls?.zoomOut()}>
        <Minus className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Center on me" className={btnClass} onClick={() => mapControls?.centerOnSelf()}>
        <Crosshair className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Add pin at center" className={btnClass} onClick={() => mapControls?.openAddMarker()}>
        <MapPin className="h-5 w-5" />
      </Button>
    </div>
  )
}
