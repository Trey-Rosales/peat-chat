import { MapBackground } from './MapBackground'
import { TopBar } from './TopBar'
import { MapRail } from './MapRail'
import { ActiveCallStrip } from './ActiveCallStrip'
import { ContextSurface } from './ContextSurface'
import { ContextStack } from './ContextStack'
import { OverlaySheets } from './OverlaySheets'

export function AppShell() {
  return (
    <MapBackground>
      <TopBar />
      <MapRail />
      <ActiveCallStrip />
      <ContextSurface>
        <ContextStack />
      </ContextSurface>
      <OverlaySheets />
    </MapBackground>
  )
}
