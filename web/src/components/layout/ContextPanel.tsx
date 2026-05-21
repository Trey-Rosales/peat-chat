import type { ReactNode } from 'react'

interface Props { children: ReactNode }

export function ContextPanel({ children }: Props) {
  return (
    <aside
      data-layout="context-panel"
      className="absolute right-3 top-14 bottom-3 z-20 w-[320px] overflow-hidden rounded-lg border border-border-subtle bg-surface-1/90 backdrop-blur-sm shadow-lg"
    >
      {children}
    </aside>
  )
}
