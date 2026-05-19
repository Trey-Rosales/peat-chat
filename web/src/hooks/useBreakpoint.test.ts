import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBreakpoint } from './useBreakpoint'

function mockMatchMedia(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      // crude parse for `(min-width: Npx)`
      const m = query.match(/min-width:\s*(\d+)px/)
      const minWidth = m ? Number(m[1]) : 0
      return {
        matches: width >= minWidth,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
    }),
  })
}

describe('useBreakpoint', () => {
  beforeEach(() => {
    mockMatchMedia(1280)
  })

  it('returns "desktop" at ≥ 1024px', () => {
    mockMatchMedia(1280)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it('returns "tablet" at 768..1023px', () => {
    mockMatchMedia(900)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('returns "mobile" at < 768px', () => {
    mockMatchMedia(390)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
  })
})
