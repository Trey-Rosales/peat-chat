import { useState, useEffect, useRef } from 'react'

interface Props {
  currentKey: string
  onCapture: (key: string) => void
}

function keyLabel(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  return key
}

export function KeyBindingCapture({ currentKey, onCapture }: Props) {
  const [capturing, setCapturing] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!capturing) return

    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onCapture(e.key)
      setCapturing(false)
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [capturing, onCapture])

  // Close on click outside
  useEffect(() => {
    if (!capturing) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setCapturing(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [capturing])

  return (
    <button
      ref={ref}
      onClick={() => setCapturing(true)}
      className={`px-4 py-2 rounded-lg text-sm font-mono transition ${
        capturing
          ? 'bg-brand/20 text-brand border border-brand'
          : 'bg-surface-2 text-fg-primary border border-border-subtle hover:border-fg-secondary'
      }`}
    >
      {capturing ? 'Press any key...' : keyLabel(currentKey)}
    </button>
  )
}
