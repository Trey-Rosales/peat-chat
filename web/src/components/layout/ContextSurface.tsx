import type { ReactNode } from 'react'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useOrientation } from '@/hooks/useOrientation'
import { useChatStore } from '@/store/chatStore'
import { ContextPanel } from './ContextPanel'
import { ContextSideSheet } from './ContextSideSheet'
import { ContextDrawer } from './ContextDrawer'

interface Props { children: ReactNode }

export function ContextSurface({ children }: Props) {
  const bp = useBreakpoint()
  const orientation = useOrientation()
  const hidden = useChatStore((s) => s.contextSurfaceHidden)

  // The mobile-portrait drawer can't be fully dismissed (snap 0.1 keeps a handle visible),
  // so the hide flag only applies to the panel and side-sheet surfaces.
  if (bp === 'desktop' || bp === 'tablet') {
    if (hidden) return null
    return <ContextPanel>{children}</ContextPanel>
  }
  if (orientation === 'landscape') {
    if (hidden) return null
    return <ContextSideSheet>{children}</ContextSideSheet>
  }
  return <ContextDrawer>{children}</ContextDrawer>
}
