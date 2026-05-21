import { useEffect, useState } from 'react'

export type Orientation = 'portrait' | 'landscape'

const QUERY = '(orientation: portrait)'

function read(): Orientation {
  if (typeof window === 'undefined') return 'portrait'
  return window.matchMedia(QUERY).matches ? 'portrait' : 'landscape'
}

export function useOrientation(): Orientation {
  const [o, setO] = useState<Orientation>(read)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const update = () => setO(read())
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  return o
}
