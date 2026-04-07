import { useState } from 'react'

const COT_TYPES = [
  { value: 'b-m-p-w', label: 'Waypoint', icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' },
  { value: 'b-m-p-s-m', label: 'Marker', icon: 'M4 15s1-1 4-1 5 2 8 2 4-1V3s-3 1-4 1-5-2-8-2v12' },
  { value: 'b-m-p-s-p-i', label: 'POI', icon: 'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z' },
  { value: 'b-m-p-c-cp', label: 'Contact', icon: 'M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z' },
  { value: 'b-r-.-O', label: 'Objective', icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3' },
] as const

const AFFILIATIONS = [
  { value: 'f', label: 'Friendly', color: '#00a884' },
  { value: 'h', label: 'Hostile', color: '#ea4335' },
  { value: 'n', label: 'Neutral', color: '#3b82f6' },
  { value: 'u', label: 'Unknown', color: '#f59e0b' },
] as const

interface Props {
  lat: number
  lon: number
  onSubmit: (data: { name: string; icon: string; color: string; cot_type: string; remarks: string }) => void
  onCancel: () => void
}

export function MarkerForm({ lat, lon, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('')
  const [cotType, setCotType] = useState('b-m-p-w')
  const [affiliation, setAffiliation] = useState('f')
  const [remarks, setRemarks] = useState('')

  const affiliationColor = AFFILIATIONS.find((a) => a.value === affiliation)?.color ?? '#3b82f6'

  // Map affiliation to legacy color field for backward compat
  const colorMap: Record<string, string> = { f: 'green', h: 'red', n: 'blue', u: 'yellow' }

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit({
      name: trimmed,
      icon: cotType,
      color: colorMap[affiliation] || 'blue',
      cot_type: cotType,
      remarks: remarks.trim(),
    })
  }

  return (
    <div className="bg-pl-sidebar rounded-xl shadow-2xl border border-pl-border p-4 w-72">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-pl-text-sec/70">Place Marker</span>
        <span className="text-[10px] text-pl-text-sec font-mono">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </span>
      </div>

      <input
        type="text"
        placeholder="Marker name / callsign"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        className="w-full bg-pl-input text-pl-text rounded-lg px-3 py-2 text-sm placeholder-pl-text-sec mb-3"
        autoFocus
      />

      {/* CoT type selector */}
      <div className="mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-pl-text-sec/70 block mb-1.5">Type</span>
        <div className="flex gap-1">
          {COT_TYPES.map((ct) => (
            <button
              key={ct.value}
              onClick={() => setCotType(ct.value)}
              className={`flex-1 p-2 rounded-lg transition flex flex-col items-center gap-1 ${
                cotType === ct.value
                  ? 'bg-pl-accent/20 text-pl-accent'
                  : 'text-pl-text-sec hover:bg-pl-hover hover:text-pl-text'
              }`}
              title={ct.label}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d={ct.icon} />
              </svg>
              <span className="text-[8px]">{ct.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Affiliation selector */}
      <div className="mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-pl-text-sec/70 block mb-1.5">Affiliation</span>
        <div className="flex gap-2 justify-center">
          {AFFILIATIONS.map((a) => (
            <button
              key={a.value}
              onClick={() => setAffiliation(a.value)}
              className={`w-8 h-8 rounded-full transition flex items-center justify-center text-[9px] font-bold ${
                affiliation === a.value ? 'ring-2 ring-offset-2 ring-offset-pl-sidebar' : 'opacity-50 hover:opacity-80'
              }`}
              style={{
                backgroundColor: a.color,
                ['--tw-ring-color' as string]: a.color,
                color: a.value === 'u' ? '#111' : '#fff',
              }}
              title={a.label}
            >
              {a.label[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Remarks */}
      <input
        type="text"
        placeholder="Remarks (optional)"
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        className="w-full bg-pl-input text-pl-text rounded-lg px-3 py-2 text-xs placeholder-pl-text-sec mb-3"
      />

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
          className="flex-1 py-2 text-white rounded-lg text-sm font-medium hover:brightness-110 transition disabled:opacity-30"
          style={{ backgroundColor: affiliationColor }}
        >
          Place
        </button>
      </div>
    </div>
  )
}
