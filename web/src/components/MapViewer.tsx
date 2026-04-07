import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useSettingsStore } from '../store/settingsStore'
import { useChatStore } from '../store/chatStore'
import { MarkerForm } from './MarkerForm'
import { contactHasPosition } from '../types'
import type { CotContact, CotMarker } from '../types'
import type { GeoPosition } from '../hooks/useGeolocation'

const MARKER_COLORS: Record<string, string> = {
  green: '#00a884',
  blue: '#3b82f6',
  red: '#ea4335',
  yellow: '#f59e0b',
  white: '#e9edef',
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
  const setMapStyle = useSettingsStore((s) => s.setMapStyle)
  const userId = useChatStore((s) => s.userId)
  const shortId = useChatStore((s) => s.shortId)
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const reactivePosition = useChatStore((s) => s.selfPosition)

  const [selectedContact, setSelectedContact] = useState<CotContact | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<CotMarker | null>(null)
  const [markerForm, setMarkerForm] = useState<{ lat: number; lon: number } | null>(null)

  // Fall back to satellite if no API key
  const effectiveStyle: MapStyle = (!protomapsApiKey && mapStyle !== 'satellite') ? 'satellite' : mapStyle

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
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Right-click (desktop) to place marker
    map.on('contextmenu', (e) => {
      setMarkerForm({ lat: e.lngLat.lat, lon: e.lngLat.lng })
      setSelectedContact(null)
      setSelectedMarker(null)
    })

    // Long-press (mobile) to place marker
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let longPressPos: { lat: number; lon: number } | null = null
    const canvas = map.getCanvas()

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      const point = map.unproject([touch.clientX - canvas.getBoundingClientRect().left, touch.clientY - canvas.getBoundingClientRect().top])
      longPressPos = { lat: point.lat, lon: point.lng }
      longPressTimer = setTimeout(() => {
        if (longPressPos) {
          setMarkerForm(longPressPos)
          setSelectedContact(null)
          setSelectedMarker(null)
        }
      }, 600)
    })
    canvas.addEventListener('touchmove', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
    })
    canvas.addEventListener('touchend', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
    })

    mapRef.current = map

    return () => {
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

    const positionedContacts = contacts.filter(contactHasPosition)
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

      const el = buildUserMarkerEl(m.name, m.color)
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

  const cycleStyle = () => {
    if (availableStyles.length <= 1) return
    const idx = availableStyles.indexOf(effectiveStyle)
    setMapStyle(availableStyles[(idx + 1) % availableStyles.length])
  }

  const styleLabel: Record<MapStyle, string> = {
    dark: 'Dark', light: 'Light', topo: 'Topo', satellite: 'Satellite',
  }

  const availableStyles: MapStyle[] = protomapsApiKey
    ? ['dark', 'light', 'topo', 'satellite']
    : ['satellite']

  return (
    <div className="flex-1 relative bg-pl-bg overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Top-left: contact/marker count + style switcher */}
      <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
        <div className="bg-pl-sidebar/80 backdrop-blur-sm rounded-lg px-3 py-1.5">
          <span className="text-xs text-pl-text-sec">
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
            {contacts.length > 0 && ` (${contacts.filter(contactHasPosition).length} GPS)`}
            {markers.length > 0 && ` · ${markers.length} marker${markers.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        {availableStyles.length > 1 && (
          <button
            onClick={cycleStyle}
            className="bg-pl-sidebar/80 backdrop-blur-sm rounded-lg px-2.5 py-1.5 text-xs text-pl-text-sec hover:text-pl-text transition"
            title={`Map style: ${effectiveStyle}`}
          >
            {styleLabel[effectiveStyle]}
          </button>
        )}
      </div>

      {/* Bottom-right: callsign HUD (TAK-style), above attribution */}
      <div className="absolute bottom-8 right-3 bg-pl-sidebar/85 backdrop-blur-sm rounded-lg px-3 py-2 z-10 text-right">
        <div className="text-sm font-bold text-pl-accent">{selfName}</div>
        <div className="text-[10px] font-mono text-pl-text-sec">
          {shortId && <span className="text-pl-text-sec/60">{shortId}</span>}
        </div>
        {reactivePosition ? (
          <div className="text-[10px] font-mono text-pl-text-sec mt-0.5">
            <div>{reactivePosition.lat.toFixed(6)}, {reactivePosition.lon.toFixed(6)}</div>
            {reactivePosition.hae !== 0 && (
              <div>ALT {reactivePosition.hae.toFixed(0)}m HAE</div>
            )}
            <div>CE {reactivePosition.ce.toFixed(0)}m</div>
          </div>
        ) : (
          <div className="text-[10px] text-pl-text-sec/50 mt-0.5">No GPS</div>
        )}
      </div>

      {/* Selected contact detail */}
      {selectedContact && (
        <div className="absolute top-3 right-14 bg-pl-sidebar/90 backdrop-blur-sm rounded-xl shadow-2xl border border-pl-border p-3 z-10 w-56">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-pl-text">{selectedContact.callsign}</span>
            <button
              onClick={() => setSelectedContact(null)}
              className="text-pl-text-sec hover:text-pl-text p-0.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-1 text-xs text-pl-text-sec">
            <div>Type: <span className="text-pl-text font-mono">{selectedContact.cot_type}</span></div>
            <div>Position: {selectedContact.lat.toFixed(5)}, {selectedContact.lon.toFixed(5)}</div>
            <div>Altitude: {selectedContact.hae.toFixed(1)}m</div>
            <div>Accuracy: {selectedContact.ce.toFixed(0)}m CE</div>
            <div>
              Status:{' '}
              <span className={Date.now() > selectedContact.stale ? 'text-pl-danger' : 'text-pl-accent'}>
                {Date.now() > selectedContact.stale ? 'Stale' : 'Active'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Selected marker detail */}
      {selectedMarker && (
        <div className="absolute top-3 right-14 bg-pl-sidebar/90 backdrop-blur-sm rounded-xl shadow-2xl border border-pl-border p-3 z-10 w-56">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-pl-text">{selectedMarker.name}</span>
            <button
              onClick={() => setSelectedMarker(null)}
              className="text-pl-text-sec hover:text-pl-text p-0.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-1 text-xs text-pl-text-sec">
            <div>Placed by: <span className="text-pl-text">{selectedMarker.creator_name}</span></div>
            <div>CoT: <span className="text-pl-text font-mono">{selectedMarker.cot_type}</span></div>
            <div>How: <span className="text-pl-text font-mono">{selectedMarker.how}</span></div>
            <div>Position: {selectedMarker.lat.toFixed(5)}, {selectedMarker.lon.toFixed(5)}</div>
            {selectedMarker.remarks && (
              <div>Remarks: <span className="text-pl-text">{selectedMarker.remarks}</span></div>
            )}
          </div>
          {selectedMarker.creator_id === userId && (
            <button
              onClick={() => handleDeleteMarker(selectedMarker.id)}
              className="mt-2 w-full py-1.5 bg-pl-danger/20 text-pl-danger rounded-lg text-xs font-medium hover:bg-pl-danger/30 transition"
            >
              Delete Marker
            </button>
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

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-pl-sidebar/80 backdrop-blur-sm rounded-lg px-3 py-2 z-10">
        <div className="text-[10px] text-pl-text-sec space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#00a884]" />
            <span>Self</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#3b82f6]" />
            <span>Friendly</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ea4335]" />
            <span>Hostile</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#6b7280]" />
            <span>Stale (&gt;30s)</span>
          </div>
          <div className="text-pl-text-sec/50 mt-1">Right-click to place marker</div>
        </div>
      </div>
    </div>
  )
}

// --- Safe marker DOM builders (no innerHTML -- prevents XSS) ---

function buildSelfMarkerEl(name: string): HTMLDivElement {
  const el = document.createElement('div')
  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' })

  const label = document.createElement('span')
  label.textContent = name
  Object.assign(label.style, { fontSize: '10px', color: '#e9edef', background: '#111b21', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap', fontWeight: '600' })

  const dot = document.createElement('div')
  Object.assign(dot.style, { width: '28px', height: '28px', borderRadius: '50%', background: '#00a884', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '3px solid rgba(0,168,132,0.3)', boxShadow: '0 0 12px rgba(0,168,132,0.4)' })
  const youLabel = document.createElement('span')
  youLabel.textContent = 'YOU'
  Object.assign(youLabel.style, { color: 'white', fontSize: '8px', fontWeight: '700' })
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

  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' })

  const label = document.createElement('span')
  label.textContent = callsign
  Object.assign(label.style, { fontSize: '10px', color: '#e9edef', background: '#111b21', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap' })

  const dot = document.createElement('div')
  Object.assign(dot.style, { width: '20px', height: '20px', borderRadius: '50%', background: '#3b82f6', border: '2px solid #60a5fa' })

  wrapper.appendChild(label)
  wrapper.appendChild(dot)
  el.appendChild(wrapper)
  return el
}

function buildUserMarkerEl(name: string, colorKey: string): HTMLDivElement {
  const color = MARKER_COLORS[colorKey] || MARKER_COLORS.blue
  const el = document.createElement('div')
  el.style.cursor = 'pointer'

  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' })

  const label = document.createElement('span')
  label.textContent = name
  Object.assign(label.style, { fontSize: '10px', color: '#e9edef', background: `${color}33`, padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap', border: `1px solid ${color}66` })

  const dot = document.createElement('div')
  Object.assign(dot.style, { width: '16px', height: '16px', borderRadius: '50%', background: color, border: `2px solid ${color}99` })

  wrapper.appendChild(label)
  wrapper.appendChild(dot)
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
    return {
      version: 8,
      glyphs: COMMON_GLYPHS,
      sources: {
        esri: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '&copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
        },
        // Overlay vector labels on satellite
        protomaps: {
          type: 'vector',
          url: `https://api.protomaps.com/tiles/v4.json?key=${apiKey}`,
        },
      },
      layers: [
        { id: 'satellite', type: 'raster', source: 'esri' },
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
      ],
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
