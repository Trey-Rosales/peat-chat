import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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
  const ref = useRef<HTMLInputElement>(null)

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

  const displayValue = capturing ? 'Press any key...' : keyLabel(currentKey)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Input
          ref={ref}
          readOnly
          value={displayValue}
          onClick={() => setCapturing(true)}
          className={`font-mono cursor-pointer ${
            capturing
              ? 'border-brand ring-2 ring-brand/20 text-brand bg-brand/10'
              : ''
          }`}
        />
      </TooltipTrigger>
      <TooltipContent>Click input, then press a key combination</TooltipContent>
    </Tooltip>
  )
}
