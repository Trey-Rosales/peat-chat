import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Mic } from 'lucide-react'

interface Props {
  onPTTStart: () => void
  onPTTEnd: () => void
  active: boolean
}

export function PTTButton({ onPTTStart, onPTTEnd, active }: Props) {
  return (
    <Button
      variant={active ? 'destructive' : 'default'}
      size="lg"
      onTouchStart={(e) => {
        e.preventDefault()
        onPTTStart()
      }}
      onTouchEnd={(e) => {
        e.preventDefault()
        onPTTEnd()
      }}
      onMouseDown={onPTTStart}
      onMouseUp={onPTTEnd}
      onMouseLeave={() => {
        if (active) onPTTEnd()
      }}
      className={cn(
        'h-16 w-10 shrink-0 rounded-full transition',
        active && 'scale-110 animate-pulse',
      )}
      title="Hold to talk"
    >
      <Mic className="h-5 w-5" />
    </Button>
  )
}
