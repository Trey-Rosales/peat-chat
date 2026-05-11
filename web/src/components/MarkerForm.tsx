import { useState } from 'react'
import Button from './dtak/Button'
import Input from './dtak/Input'

const COT_TYPES = [
  { value: 'b-m-p-w', label: 'Waypoint', icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' },
  { value: 'b-m-p-s-m', label: 'Marker', icon: 'M4 15s1-1 4-1 5 2 8 2 4-1V3s-3 1-4 1-5-2-8-2v12' },
  { value: 'b-m-p-s-p-i', label: 'POI', icon: 'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z' },
  { value: 'b-m-p-c-cp', label: 'Contact', icon: 'M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z' },
  { value: 'b-r-.-O', label: 'Objective', icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3' },
] as const

const AFFILIATIONS = [
  { value: 'f', label: 'Friendly', bgClass: 'bg-cot-friendly', textClass: 'text-fg-primary' },
  { value: 'h', label: 'Hostile',  bgClass: 'bg-cot-hostile',  textClass: 'text-fg-on-brand' },
  { value: 'n', label: 'Neutral',  bgClass: 'bg-cot-neutral',  textClass: 'text-fg-on-brand' },
  { value: 'u', label: 'Unknown',  bgClass: 'bg-cot-unknown',  textClass: 'text-fg-primary' },
] as const

// Place button background per affiliation (cot-* tokens)
const affiliationPlaceClass: Record<string, string> = {
  f: 'bg-cot-friendly',
  h: 'bg-cot-hostile',
  n: 'bg-cot-neutral',
  u: 'bg-cot-unknown',
}

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
    <div className="bg-surface-1 rounded-xl shadow-2xl border border-border-subtle p-4 w-72">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-secondary/70">Place Marker</span>
        <span className="text-[10px] text-fg-secondary font-mono">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </span>
      </div>

      <div className="mb-3">
        <Input
          placeholder="Marker name / callsign"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') onCancel()
          }}
          className="text-sm"
          autoFocus
        />
      </div>

      {/* CoT type selector */}
      <div className="mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-secondary/70 block mb-1.5">Type</span>
        <div className="flex gap-1">
          {COT_TYPES.map((ct) => (
            <button
              key={ct.value}
              onClick={() => setCotType(ct.value)}
              className={`flex-1 p-2 rounded-lg transition flex flex-col items-center gap-1 ${
                cotType === ct.value
                  ? 'bg-brand/20 text-brand'
                  : 'text-fg-secondary hover:bg-surface-2 hover:text-fg-primary'
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
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-secondary/70 block mb-1.5">Affiliation</span>
        <div className="flex gap-2 justify-center">
          {AFFILIATIONS.map((a) => (
            <button
              key={a.value}
              onClick={() => setAffiliation(a.value)}
              className={`w-8 h-8 rounded-full transition flex items-center justify-center text-[9px] font-bold ${a.bgClass} ${a.textClass} ${
                affiliation === a.value ? 'ring-2 ring-offset-2 ring-offset-surface-1' : 'opacity-50 hover:opacity-80'
              }`}
              style={affiliation === a.value ? { '--tw-ring-color': 'currentColor' } as React.CSSProperties : undefined}
              title={a.label}
            >
              {a.label[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Remarks */}
      <div className="mb-3">
        <Input
          placeholder="Remarks (optional)"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') onCancel()
          }}
          className="text-xs"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="flex-1"
        >
          Cancel
        </Button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className={`flex-1 py-2 text-fg-on-brand rounded-lg text-sm font-medium hover:brightness-110 transition disabled:opacity-30 ${affiliationPlaceClass[affiliation] ?? 'bg-cot-neutral'}`}
        >
          Place
        </button>
      </div>
    </div>
  )
}
