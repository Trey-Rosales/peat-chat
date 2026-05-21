import type { ReactNode } from 'react'
import { MapViewer } from '../MapViewer'
import { useChatStore } from '@/store/chatStore'
import { useSend } from '@/lib/WebSocketContext'

interface Props { children: ReactNode }

export function MapBackground({ children }: Props) {
  const send = useSend()
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const cotContacts = useChatStore((s) => s.cotContacts)
  const cotMarkers = useChatStore((s) => s.cotMarkers)
  const selfPosition = useChatStore((s) => s.selfPosition)
  const displayName = useChatStore((s) => s.displayName)
  const drawerSnap = useChatStore((s) => s.drawerSnap)
  const setDrawerSnap = useChatStore((s) => s.setDrawerSnap)

  const contacts = activeRoomId ? cotContacts[activeRoomId] ?? [] : []
  const markers = activeRoomId ? cotMarkers[activeRoomId] ?? [] : []

  const handleMapClick = () => {
    if (drawerSnap > 0.1) setDrawerSnap(0.1)
  }

  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-surface-canvas">
      <div className="absolute inset-0 z-0" onClickCapture={handleMapClick}>
        <MapViewer
          contacts={contacts}
          markers={markers}
          selfPosition={selfPosition}
          selfName={displayName}
          send={send}
        />
      </div>
      {/* Overlay children render directly into the relative root. Each overlay (TopBar, MapRail, etc.)
          uses `absolute` + its own z-index. The relative root is the positioned ancestor. */}
      {children}
    </div>
  )
}
