import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { useSettingsStore } from '../store/settingsStore'
import { useChatStore } from '../store/chatStore'
import { MarkerForm } from './MarkerForm'
import type { CotContact, CotMarker } from '../types'
import type { GeoPosition } from '../hooks/useGeolocation'

// Register PMTiles protocol once
let protocolRegistered = false
if (!protocolRegistered) {
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
}

const MARKER_COLORS: Record<string, string> = {
  green: '#00a884',
  blue: '#3b82f6',
  red: '#ea4335',
  yellow: '#f59e0b',
  white: '#e9edef',
}

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
  const userId = useChatStore((s) => s.userId)
  const activeRoomId = useChatStore((s) => s.activeRoomId)

  const [selectedContact, setSelectedContact] = useState<CotContact | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<CotMarker | null>(null)
  const [markerForm, setMarkerForm] = useState<{ lat: number; lon: number } | null>(null)

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || !protomapsApiKey) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildDarkStyle(protomapsApiKey),
      center: selfPosition ? [selfPosition.lon, selfPosition.lat] : [-98.5795, 39.8283],
      zoom: selfPosition ? 14 : 4,
      attributionControl: false,
    })

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Right-click to place marker
    map.on('contextmenu', (e) => {
      setMarkerForm({ lat: e.lngLat.lat, lon: e.lngLat.lng })
      setSelectedContact(null)
      setSelectedMarker(null)
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      contactMarkersRef.current.clear()
      userMarkersRef.current.clear()
      selfMarkerRef.current = null
    }
  }, [protomapsApiKey])

  // Update self marker
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selfPosition) return

    if (!selfMarkerRef.current) {
      const el = document.createElement('div')
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
          <span style="font-size:10px;color:#e9edef;background:#111b21;padding:1px 6px;border-radius:4px;white-space:nowrap;font-weight:600">${selfName}</span>
          <div style="width:28px;height:28px;border-radius:50%;background:#00a884;display:flex;align-items:center;justify-content:center;border:3px solid rgba(0,168,132,0.3);box-shadow:0 0 12px rgba(0,168,132,0.4)">
            <span style="color:white;font-size:8px;font-weight:700">YOU</span>
          </div>
        </div>
      `
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

    const currentIds = new Set(contacts.map((c) => c.uid))

    // Remove stale markers
    for (const [uid, marker] of contactMarkersRef.current) {
      if (!currentIds.has(uid)) {
        marker.remove()
        contactMarkersRef.current.delete(uid)
      }
    }

    // Add/update markers
    const now = Date.now()
    for (const contact of contacts) {
      const isStale = now > contact.stale
      const existing = contactMarkersRef.current.get(contact.uid)

      if (existing) {
        existing.setLngLat([contact.lon, contact.lat])
        const el = existing.getElement()
        el.style.opacity = isStale ? '0.4' : '1'
      } else {
        const el = document.createElement('div')
        el.style.cursor = 'pointer'
        el.style.opacity = isStale ? '0.4' : '1'
        el.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
            <span style="font-size:10px;color:#e9edef;background:#111b21;padding:1px 6px;border-radius:4px;white-space:nowrap">${contact.callsign}</span>
            <div style="width:20px;height:20px;border-radius:50%;background:#3b82f6;border:2px solid #60a5fa"></div>
          </div>
        `
        el.addEventListener('click', () => {
          setSelectedContact(contact)
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

      const color = MARKER_COLORS[m.color] || MARKER_COLORS.blue
      const el = document.createElement('div')
      el.style.cursor = 'pointer'
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
          <span style="font-size:10px;color:#e9edef;background:${color}33;padding:1px 6px;border-radius:4px;white-space:nowrap;border:1px solid ${color}66">${m.name}</span>
          <div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid ${color}99"></div>
        </div>
      `
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
    (data: { name: string; icon: string; color: string }) => {
      if (!markerForm || !activeRoomId) return
      send('create_marker', {
        room_id: activeRoomId,
        lat: markerForm.lat,
        lon: markerForm.lon,
        name: data.name,
        icon: data.icon,
        color: data.color,
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

  // No API key state
  if (!protomapsApiKey) {
    return (
      <div className="flex-1 flex items-center justify-center bg-pl-bg">
        <div className="text-center px-4">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto mb-3 text-pl-text-sec/30">
            <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
          <p className="text-pl-text-sec mb-2">Map requires a Protomaps API key</p>
          <p className="text-pl-text-sec/60 text-xs">
            Set your key in Settings &gt; Map
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 relative bg-pl-bg overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Contact count badge */}
      <div className="absolute top-3 left-3 bg-pl-sidebar/80 backdrop-blur-sm rounded-lg px-3 py-1.5 z-10">
        <span className="text-xs text-pl-text-sec">
          {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
          {markers.length > 0 && ` · ${markers.length} marker${markers.length !== 1 ? 's' : ''}`}
        </span>
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
            <div>Accuracy: {selectedContact.ce.toFixed(0)}m</div>
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
            <div>Position: {selectedMarker.lat.toFixed(5)}, {selectedMarker.lon.toFixed(5)}</div>
            <div>Type: {selectedMarker.icon}</div>
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
            <span>You</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#3b82f6]" />
            <span>Peer</span>
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

function buildDarkStyle(apiKey: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://https://api.protomaps.com/tiles/v4.json?key=${apiKey}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">OSM</a>',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0b141a' },
      },
      {
        id: 'earth',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'earth',
        paint: { 'fill-color': '#111b21' },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'water',
        paint: { 'fill-color': '#080f14' },
      },
      {
        id: 'landuse_park',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'landuse',
        filter: [
          'any',
          ['==', 'pmap:kind', 'park'],
          ['==', 'pmap:kind', 'forest'],
          ['==', 'pmap:kind', 'nature_reserve'],
        ],
        paint: { 'fill-color': '#0d1f17', 'fill-opacity': 0.5 },
      },
      {
        id: 'roads_major',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: [
          'any',
          ['==', 'pmap:kind', 'highway'],
          ['==', 'pmap:kind', 'major_road'],
        ],
        paint: {
          'line-color': '#2a3942',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 3],
        },
      },
      {
        id: 'roads_minor',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: [
          'any',
          ['==', 'pmap:kind', 'minor_road'],
          ['==', 'pmap:kind', 'other'],
        ],
        minzoom: 12,
        paint: {
          'line-color': '#1f2c33',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 18, 2],
        },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'buildings',
        minzoom: 14,
        paint: { 'fill-color': '#1f2c33', 'fill-opacity': 0.6 },
      },
      {
        id: 'boundaries',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'boundaries',
        paint: {
          'line-color': '#2a3942',
          'line-width': 1,
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'places',
        type: 'symbol',
        source: 'protomaps',
        'source-layer': 'places',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 14, 14],
          'text-font': ['Noto Sans Regular'],
        },
        paint: {
          'text-color': '#8696a0',
          'text-halo-color': '#0b141a',
          'text-halo-width': 1.5,
        },
      },
    ],
  }
}
