import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useOrientation } from './useOrientation'

function mockOrientation(portrait: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('portrait') ? portrait : !portrait,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('useOrientation', () => {
  it('returns "portrait" when portrait media query matches', () => {
    mockOrientation(true)
    const { result } = renderHook(() => useOrientation())
    expect(result.current).toBe('portrait')
  })

  it('returns "landscape" when portrait media query does not match', () => {
    mockOrientation(false)
    const { result } = renderHook(() => useOrientation())
    expect(result.current).toBe('landscape')
  })
})
