import { useEffect, useState } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

const QUERIES = {
  desktop: '(min-width: 1024px)',
  tablet: '(min-width: 768px)',
} as const

function read(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop'
  if (window.matchMedia(QUERIES.desktop).matches) return 'desktop'
  if (window.matchMedia(QUERIES.tablet).matches) return 'tablet'
  return 'mobile'
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(read)

  useEffect(() => {
    const update = () => setBp(read())
    const desktopMql = window.matchMedia(QUERIES.desktop)
    const tabletMql = window.matchMedia(QUERIES.tablet)
    desktopMql.addEventListener('change', update)
    tabletMql.addEventListener('change', update)
    return () => {
      desktopMql.removeEventListener('change', update)
      tabletMql.removeEventListener('change', update)
    }
  }, [])

  return bp
}
