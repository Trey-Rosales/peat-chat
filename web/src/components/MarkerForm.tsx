import { useState } from 'react'

const ICONS = [
  { value: 'rally', label: 'Rally', svg: 'M4 15s1-1 4-1 5 2 8 2 4-1V3s-3 1-4 1-5-2-8-2v12' },
  { value: 'objective', label: 'Objective', svg: 'M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z' },
  { value: 'hazard', label: 'Hazard', svg: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' },
  { value: 'waypoint', label: 'Waypoint', svg: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' },
  { value: 'info', label: 'Info', svg: 'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z' },
] as const

const COLORS = [
  { value: 'green', hex: '#00a884' },
  { value: 'blue', hex: '#3b82f6' },
  { value: 'red', hex: '#ea4335' },
  { value: 'yellow', hex: '#f59e0b' },
  { value: 'white', hex: '#e9edef' },
] as const

interface Props {
  lat: number
  lon: number
  onSubmit: (data: { name: string; icon: string; color: string }) => void
  onCancel: () => void
}

export function MarkerForm({ lat, lon, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('waypoint')
  const [color, setColor] = useState('blue')

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit({ name: trimmed, icon, color })
  }

  return (
    <div className="bg-pl-sidebar rounded-xl shadow-2xl border border-pl-border p-4 w-72">
      <div className="text-xs text-pl-text-sec mb-3">
        {lat.toFixed(5)}, {lon.toFixed(5)}
      </div>

      <input
        type="text"
        placeholder="Marker name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        className="w-full bg-pl-input text-pl-text rounded-lg px-3 py-2 text-sm placeholder-pl-text-sec mb-3"
        autoFocus
      />

      {/* Icon selector */}
      <div className="flex gap-1 mb-3">
        {ICONS.map((ic) => (
          <button
            key={ic.value}
            onClick={() => setIcon(ic.value)}
            className={`flex-1 p-2 rounded-lg transition flex items-center justify-center ${
              icon === ic.value
                ? 'bg-pl-accent/20 text-pl-accent'
                : 'text-pl-text-sec hover:bg-pl-hover hover:text-pl-text'
            }`}
            title={ic.label}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d={ic.svg} />
            </svg>
          </button>
        ))}
      </div>

      {/* Color selector */}
      <div className="flex gap-2 mb-4 justify-center">
        {COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => setColor(c.value)}
            className={`w-7 h-7 rounded-full transition ${
              color === c.value ? 'ring-2 ring-offset-2 ring-offset-pl-sidebar' : ''
            }`}
            style={{
              backgroundColor: c.hex,
              ['--tw-ring-color' as string]: c.hex,
            }}
            title={c.value}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-sm text-pl-text-sec hover:bg-pl-hover transition"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className="flex-1 py-2 bg-pl-accent text-white rounded-lg text-sm font-medium hover:brightness-110 transition disabled:opacity-30"
        >
          Place
        </button>
      </div>
    </div>
  )
}
