import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '../store/settingsStore'
import { useChatStore } from '../store/chatStore'
import { MarkerForm } from './MarkerForm'
import { contactHasPosition } from '../types'
import type { CotContact, CotMarker } from '../types'
import type { GeoPosition } from '../hooks/useGeolocation'

import { getCotIcon, getCotColorVar } from '@/lib/cot-icons'

const SVG_NS = 'http://www.w3.org/2000/svg'

// Build an inline SVG element for a CoT-type icon. The icon is drawn with
// currentColor so the parent can theme it via `style.color`.
function buildIconSvg(cotType: string, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', getCotIcon(cotType))
  svg.appendChild(path)
  return svg
}

type MapStyle = 'dark' | 'light' | 'topo' | 'satellite'

interface Props {
  contacts: CotContact[]
  markers: CotMarker[]
  selfPosition: GeoPosition | null
  selfName: string
  send: (type: string, data: any) => void
}

export function MapViewer({ contacts, markers, selfPosition, selfName, send }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const contactMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const userMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const selfMarkerRef = useRef<maplibregl.Marker | null>(null)
  const protomapsApiKey = useSettingsStore((s) => s.protomapsApiKey)
  const mapStyle = useSettingsStore((s) => s.mapStyle)
  const userId = useChatStore((s) => s.userId)
  const activeRoomId = useChatStore((s) => s.activeRoomId)

  const [selectedContact, setSelectedContact] = useState<CotContact | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<CotMarker | null>(null)
  const [markerForm, setMarkerForm] = useState<{ lat: number; lon: number } | null>(null)
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null)

  // Available styles depend on whether we have a Protomaps API key
  const availableStyles: MapStyle[] = protomapsApiKey
    ? ['dark', 'light', 'topo', 'satellite']
    : ['satellite']

  const effectiveStyle: MapStyle = availableStyles.includes(mapStyle) ? mapStyle : availableStyles[0]

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(protomapsApiKey, effectiveStyle),
      center: selfPosition ? [selfPosition.lon, selfPosition.lat] : [-98.5795, 39.8283],
      zoom: selfPosition ? 14 : 4,
      attributionControl: false,
    })

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    // Right-click (desktop) to place marker
    map.on('contextmenu', (e) => {
      setMarkerForm({ lat: e.lngLat.lat, lon: e.lngLat.lng })
      setSelectedContact(null)
      setSelectedMarker(null)
    })

    // Prevent native context menu on the map canvas (interferes with marker placement)
    map.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault())

    // Long-press (mobile) to place marker
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let longPressPos: { lat: number; lon: number } | null = null

    map.getCanvas().addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      const rect = map.getCanvas().getBoundingClientRect()
      const point = map.unproject([touch.clientX - rect.left, touch.clientY - rect.top])
      longPressPos = { lat: point.lat, lon: point.lng }
      longPressTimer = setTimeout(() => {
        if (longPressPos) {
          setMarkerForm(longPressPos)
          setSelectedContact(null)
          setSelectedMarker(null)
        }
      }, 600)
    }, { passive: true })
    map.getCanvas().addEventListener('touchmove', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
    }, { passive: true })
    map.getCanvas().addEventListener('touchend', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
    })

    mapRef.current = map

    // Register imperative map actions for the layout shell (MapRail buttons).
    // Use getState() to avoid re-subscribing this effect to store changes.
    useChatStore.getState().setMapControls({
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      centerOnSelf: () => {
        const pos = useChatStore.getState().selfPosition
        if (pos) {
          map.flyTo({ center: [pos.lon, pos.lat], zoom: Math.max(map.getZoom(), 15) })
        }
      },
      openAddMarker: () => {
        const c = map.getCenter()
        setMarkerForm({ lat: c.lat, lon: c.lng })
      },
    })

    // Ensure the map resizes whenever its container does. Maplibre doesn't
    // auto-resize; without this, the canvas may stay at its initial-mount size.
    const resizeObserver = new ResizeObserver(() => {
      map.resize()
    })
    if (containerRef.current) resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      useChatStore.getState().setMapControls(null)
      map.remove()
      mapRef.current = null
      contactMarkersRef.current.clear()
      userMarkersRef.current.clear()
      selfMarkerRef.current = null
    }
  }, [protomapsApiKey, effectiveStyle])

  // Update self marker
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selfPosition) return

    if (!selfMarkerRef.current) {
      const el = buildSelfMarkerEl(selfName)
      selfMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([selfPosition.lon, selfPosition.lat])
        .addTo(map)
    } else {
      selfMarkerRef.current.setLngLat([selfPosition.lon, selfPosition.lat])
    }
  }, [selfPosition, selfName])

  // Update contact markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Filter out self — own position is rendered separately as the "YOU" marker.
    // Match by callsign since uid may differ between local/upstream identity.
    const positionedContacts = contacts
      .filter(contactHasPosition)
      .filter((c) => c.callsign !== selfName)
    const currentIds = new Set(positionedContacts.map((c) => c.uid))

    // Remove stale markers
    for (const [uid, marker] of contactMarkersRef.current) {
      if (!currentIds.has(uid)) {
        marker.remove()
        contactMarkersRef.current.delete(uid)
      }
    }

    // Add/update markers
    const now = Date.now()
    for (const contact of positionedContacts) {
      const isStale = now > contact.stale
      const existing = contactMarkersRef.current.get(contact.uid)

      if (existing) {
        existing.setLngLat([contact.lon, contact.lat])
        const el = existing.getElement()
        el.style.opacity = isStale ? '0.4' : '1'
        // Update callsign text in case name changed
        const label = el.querySelector('span')
        if (label && label.textContent !== contact.callsign) {
          label.textContent = contact.callsign
        }
      } else {
        const el = buildContactMarkerEl(contact.callsign, isStale)
        const uid = contact.uid
        el.addEventListener('click', () => {
          // Look up the latest contact data by UID to avoid stale closure
          const latest = contacts.find((c) => c.uid === uid) || contact
          setSelectedContact(latest)
          setSelectedMarker(null)
          setMarkerForm(null)
        })

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([contact.lon, contact.lat])
          .addTo(map)

        contactMarkersRef.current.set(contact.uid, marker)
      }
    }
  }, [contacts])

  // Update user-placed markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const currentIds = new Set(markers.map((m) => m.id))

    // Remove deleted markers
    for (const [id, marker] of userMarkersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove()
        userMarkersRef.current.delete(id)
      }
    }

    // Add/update markers
    for (const m of markers) {
      if (userMarkersRef.current.has(m.id)) continue

      const el = buildUserMarkerEl(m.name, m.color, m.cot_type)
      el.addEventListener('click', () => {
        setSelectedMarker(m)
        setSelectedContact(null)
        setMarkerForm(null)
      })

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([m.lon, m.lat])
        .addTo(map)

      userMarkersRef.current.set(m.id, marker)
    }
  }, [markers])

  // Track screen position of selected pin so popover sticks to it during pan/zoom
  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      setPopoverPos(null)
      return
    }
    const lngLat: [number, number] | null = selectedContact
      ? [selectedContact.lon, selectedContact.lat]
      : selectedMarker
        ? [selectedMarker.lon, selectedMarker.lat]
        : null
    if (!lngLat) {
      setPopoverPos(null)
      return
    }
    const update = () => {
      const p = map.project(lngLat)
      setPopoverPos({ x: p.x, y: p.y })
    }
    update()
    map.on('move', update)
    return () => {
      map.off('move', update)
    }
  }, [selectedContact, selectedMarker])

  const handlePlaceMarker = useCallback(
    (data: { name: string; icon: string; color: string; cot_type: string; remarks: string }) => {
      if (!markerForm || !activeRoomId) return
      send('create_marker', {
        room_id: activeRoomId,
        lat: markerForm.lat,
        lon: markerForm.lon,
        name: data.name,
        icon: data.icon,
        color: data.color,
        cot_type: data.cot_type,
        remarks: data.remarks,
      })
      setMarkerForm(null)
    },
    [markerForm, activeRoomId, send]
  )

  const handleDeleteMarker = useCallback(
    (markerId: string) => {
      if (!activeRoomId) return
      send('delete_marker', { room_id: activeRoomId, marker_id: markerId })
      setSelectedMarker(null)
    },
    [activeRoomId, send]
  )

  return (
    <div className="h-full w-full relative bg-surface-canvas overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />

      {/* Selected contact detail — anchored above the pin */}
      {selectedContact && popoverPos && (
        <div
          className="absolute bg-surface-1/90 backdrop-blur-sm rounded-xl shadow-2xl border border-border-subtle p-3 z-10 w-56 pointer-events-auto"
          style={{
            left: popoverPos.x,
            top: popoverPos.y,
            transform: 'translate(-50%, calc(-100% - 24px))',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-fg-primary">{selectedContact.callsign}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setSelectedContact(null)}
              className="text-fg-secondary hover:text-fg-primary"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-1 text-xs text-fg-secondary">
            <div>Type: <span className="text-fg-primary font-mono">{selectedContact.cot_type}</span></div>
            <div>Position: {selectedContact.lat.toFixed(5)}, {selectedContact.lon.toFixed(5)}</div>
            <div>Altitude: {selectedContact.hae.toFixed(1)}m</div>
            <div>Accuracy: {selectedContact.ce.toFixed(0)}m CE</div>
            <div>
              Status:{' '}
              <span className={Date.now() > selectedContact.stale ? 'text-status-critical' : 'text-brand'}>
                {Date.now() > selectedContact.stale ? 'Stale' : 'Active'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Selected marker detail — anchored above the pin */}
      {selectedMarker && popoverPos && (
        <div
          className="absolute bg-surface-1/90 backdrop-blur-sm rounded-xl shadow-2xl border border-border-subtle p-3 z-10 w-56 pointer-events-auto"
          style={{
            left: popoverPos.x,
            top: popoverPos.y,
            transform: 'translate(-50%, calc(-100% - 24px))',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-fg-primary">{selectedMarker.name}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setSelectedMarker(null)}
              className="text-fg-secondary hover:text-fg-primary"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-1 text-xs text-fg-secondary">
            <div>Placed by: <span className="text-fg-primary">{selectedMarker.creator_name}</span></div>
            <div>CoT: <span className="text-fg-primary font-mono">{selectedMarker.cot_type}</span></div>
            <div>How: <span className="text-fg-primary font-mono">{selectedMarker.how}</span></div>
            <div>Position: {selectedMarker.lat.toFixed(5)}, {selectedMarker.lon.toFixed(5)}</div>
            {selectedMarker.remarks && (
              <div>Remarks: <span className="text-fg-primary">{selectedMarker.remarks}</span></div>
            )}
          </div>
          {selectedMarker.creator_id === userId && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleDeleteMarker(selectedMarker.id)}
              className="mt-2 w-full text-xs"
            >
              Delete Marker
            </Button>
          )}
        </div>
      )}

      {/* Marker creation form */}
      {markerForm && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
          <MarkerForm
            lat={markerForm.lat}
            lon={markerForm.lon}
            onSubmit={handlePlaceMarker}
            onCancel={() => setMarkerForm(null)}
          />
        </div>
      )}

      {/* Legend — swatch colors driven by cot-* tokens so they adapt per theme */}
      <div className="absolute bottom-3 left-3 bg-surface-1/80 backdrop-blur-sm rounded-lg px-3 py-2 z-10">
        <div className="text-[10px] text-fg-secondary space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-cot-friendly" />
            <span>Friendly</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-cot-hostile" />
            <span>Hostile</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-cot-neutral" />
            <span>Neutral</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-cot-unknown" />
            <span>Unknown</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-fg-secondary/40" />
            <span>Stale (&gt;30s)</span>
          </div>
          <div className="text-fg-secondary/50 mt-1">Right-click to place marker</div>
        </div>
      </div>
    </div>
  )
}

// --- Safe marker DOM builders (no innerHTML -- prevents XSS) ---
//
// Markers use `var(--color-cot-*)` for the disc fill, so the active theme
// (dark / light / low-detection) controls the actual color. The icon glyph
// inside is drawn in white via `color: #fff` on the disc — `currentColor` in
// the SVG resolves to that.

function buildMarkerLabel(text: string): HTMLSpanElement {
  const label = document.createElement('span')
  label.textContent = text
  Object.assign(label.style, {
    fontSize: '10px',
    fontWeight: '500',
    color: 'var(--color-fg-primary)',
    background: 'color-mix(in oklch, var(--color-surface-1) 90%, transparent)',
    padding: '1px 6px',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
    border: '1px solid var(--color-border-subtle)',
  })
  return label
}

function buildMarkerWrapper(): HTMLDivElement {
  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '3px',
  })
  return wrapper
}

function buildSelfMarkerEl(name: string): HTMLDivElement {
  const el = document.createElement('div')
  const wrapper = buildMarkerWrapper()

  const label = buildMarkerLabel(name)
  label.style.fontWeight = '600'

  const dot = document.createElement('div')
  Object.assign(dot.style, {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: 'var(--color-cot-friendly)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    border: '3px solid color-mix(in oklch, var(--color-cot-friendly) 30%, transparent)',
    boxShadow: '0 0 12px color-mix(in oklch, var(--color-cot-friendly) 40%, transparent)',
  })
  const youLabel = document.createElement('span')
  youLabel.textContent = 'YOU'
  Object.assign(youLabel.style, { color: '#fff', fontSize: '8px', fontWeight: '700', letterSpacing: '0.04em' })
  dot.appendChild(youLabel)

  wrapper.appendChild(label)
  wrapper.appendChild(dot)
  el.appendChild(wrapper)
  return el
}

function buildContactMarkerEl(callsign: string, isStale: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cursor = 'pointer'
  el.style.opacity = isStale ? '0.4' : '1'

  const wrapper = buildMarkerWrapper()
  wrapper.appendChild(buildMarkerLabel(callsign))

  const disc = document.createElement('div')
  Object.assign(disc.style, {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    background: 'var(--color-cot-friendly)',
    border: '2px solid color-mix(in oklch, var(--color-cot-friendly) 60%, white)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
  })
  // Contacts use the generic Contact CoT icon so they read as "other operator".
  disc.appendChild(buildIconSvg('b-m-p-c-cp', 12))

  wrapper.appendChild(disc)
  el.appendChild(wrapper)
  return el
}

function buildUserMarkerEl(name: string, colorKey: string, cotType: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cursor = 'pointer'

  const colorVar = getCotColorVar(colorKey)

  const wrapper = buildMarkerWrapper()
  wrapper.appendChild(buildMarkerLabel(name))

  const disc = document.createElement('div')
  Object.assign(disc.style, {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: colorVar,
    border: `2px solid color-mix(in oklch, ${colorVar} 60%, white)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
  })
  disc.appendChild(buildIconSvg(cotType, 15))

  wrapper.appendChild(disc)
  el.appendChild(wrapper)
  return el
}

// --- Map style builders ---

const COMMON_SOURCE = (apiKey: string) => ({
  protomaps: {
    type: 'vector' as const,
    url: `https://api.protomaps.com/tiles/v4.json?key=${apiKey}`,
    attribution:
      '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">OSM</a>',
  },
})

const COMMON_GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf'

function buildStyle(apiKey: string, theme: MapStyle): maplibregl.StyleSpecification {
  if (theme === 'satellite') {
    const hasProtomaps = Boolean(apiKey)
    const sources: maplibregl.StyleSpecification['sources'] = {
      esri: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
      },
    }
    if (hasProtomaps) {
      sources.protomaps = {
        type: 'vector',
        url: `https://api.protomaps.com/tiles/v4.json?key=${apiKey}`,
      }
    }
    const layers: maplibregl.LayerSpecification[] = [
      { id: 'satellite', type: 'raster', source: 'esri' },
    ]
    if (hasProtomaps) {
      layers.push(
        {
          id: 'roads_major', type: 'line', source: 'protomaps', 'source-layer': 'roads',
          filter: ['any', ['==', 'pmap:kind', 'highway'], ['==', 'pmap:kind', 'major_road']],
          paint: { 'line-color': 'rgba(255,255,255,0.25)', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 2] },
        },
        {
          id: 'boundaries', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
          paint: { 'line-color': 'rgba(255,255,0,0.3)', 'line-width': 1, 'line-dasharray': [3, 2] },
        },
        {
          id: 'places', type: 'symbol', source: 'protomaps', 'source-layer': 'places',
          layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 14, 14], 'text-font': ['Noto Sans Regular'] },
          paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 2 },
        },
      )
    }
    return {
      version: 8,
      glyphs: COMMON_GLYPHS,
      sources,
      layers,
    }
  }

  const palettes: Record<string, {
    bg: string; earth: string; water: string; park: string
    roadMajor: string; roadMinor: string; building: string
    boundary: string; textColor: string; textHalo: string
  }> = {
    dark: {
      bg: '#0b141a', earth: '#111b21', water: '#080f14', park: '#0d1f17',
      roadMajor: '#2a3942', roadMinor: '#1f2c33', building: '#1f2c33',
      boundary: '#2a3942', textColor: '#8696a0', textHalo: '#0b141a',
    },
    light: {
      bg: '#f0ede6', earth: '#f5f3ee', water: '#c4daf6', park: '#d4edcf',
      roadMajor: '#ffffff', roadMinor: '#e8e4db', building: '#dfdbd3',
      boundary: '#bbb8b0', textColor: '#444444', textHalo: '#f5f3ee',
    },
    topo: {
      bg: '#1a1a2e', earth: '#16213e', water: '#0a1628', park: '#1a3a2a',
      roadMajor: '#3a4a5e', roadMinor: '#2a3a4e', building: '#2a3a4e',
      boundary: '#4a5a6e', textColor: '#8a9ab0', textHalo: '#16213e',
    },
  }

  const p = palettes[theme]

  return {
    version: 8,
    glyphs: COMMON_GLYPHS,
    sources: COMMON_SOURCE(apiKey),
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': p.bg } },
      { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth', paint: { 'fill-color': p.earth } },
      { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': p.water } },
      {
        id: 'landuse_park', type: 'fill', source: 'protomaps', 'source-layer': 'landuse',
        filter: ['any', ['==', 'pmap:kind', 'park'], ['==', 'pmap:kind', 'forest'], ['==', 'pmap:kind', 'nature_reserve']],
        paint: { 'fill-color': p.park, 'fill-opacity': 0.5 },
      },
      {
        id: 'roads_major', type: 'line', source: 'protomaps', 'source-layer': 'roads',
        filter: ['any', ['==', 'pmap:kind', 'highway'], ['==', 'pmap:kind', 'major_road']],
        paint: { 'line-color': p.roadMajor, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 3] },
      },
      {
        id: 'roads_minor', type: 'line', source: 'protomaps', 'source-layer': 'roads',
        filter: ['any', ['==', 'pmap:kind', 'minor_road'], ['==', 'pmap:kind', 'other']],
        minzoom: 12,
        paint: { 'line-color': p.roadMinor, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 18, 2] },
      },
      {
        id: 'buildings', type: 'fill', source: 'protomaps', 'source-layer': 'buildings',
        minzoom: 14, paint: { 'fill-color': p.building, 'fill-opacity': 0.6 },
      },
      {
        id: 'boundaries', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
        paint: { 'line-color': p.boundary, 'line-width': 1, 'line-dasharray': [3, 2] },
      },
      {
        id: 'places', type: 'symbol', source: 'protomaps', 'source-layer': 'places',
        layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 14, 14], 'text-font': ['Noto Sans Regular'] },
        paint: { 'text-color': p.textColor, 'text-halo-color': p.textHalo, 'text-halo-width': 1.5 },
      },
    ],
  }
}
