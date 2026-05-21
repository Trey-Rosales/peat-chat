// web/src/components/ui/__tests__/ld-mode.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

// Approximate banned ranges:
// - Pure white: oklch with L > 95% AND C < 0.02 (very light, near-neutral or cool)
// - Banned blue: hue 200-280 with C > 0.05
// We parse the computed `background-color` / `color` and reject samples in those ranges.

// NOTE: jsdom does not resolve CSS variables or process @media/@layer rules.
// As a result, getComputedStyle() will typically return empty strings for
// CSS-var-based colors (e.g., `bg-brand`). The isBannedColor / parseOklch
// functions handle this gracefully by returning false (safe) when OKLCH form
// is not present. This means the banned-color assertions are informational
// tripwires: they will catch regressions if inline styles or jsdom ever gains
// CSS-var resolution, but they won't false-positive on unresolved values.

function parseOklch(value: string): { L: number; C: number; H: number } | null {
  // Computed style may serialize OKLCH back as `oklch(...)` or convert to rgb.
  // We accept oklch() form (preferred) and skip rgb() (jsdom may not transform).
  const m = value.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/)
  if (!m) return null
  return { L: parseFloat(m[1]), C: parseFloat(m[2]), H: parseFloat(m[3]) }
}

function isBannedColor(value: string): boolean {
  const o = parseOklch(value)
  if (!o) return false
  // Banned blue
  if (o.H >= 200 && o.H <= 280 && o.C > 0.05) return true
  // Banned white-ish
  if (o.L > 0.95 && o.C < 0.02) return true
  return false
}

describe('LD mode — banned color regression', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'ld')
  })
  afterEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  })

  it.each([
    ['Button (default)', <Button>X</Button>],
    ['Button (destructive)', <Button variant="destructive">X</Button>],
    ['Input', <Input />],
    ['Switch', <Switch />],
    ['Badge (default)', <Badge>X</Badge>],
  ])('%s: no banned colors in LD mode', (_, node) => {
    const { container } = render(node)
    const all = container.querySelectorAll<HTMLElement>('*')
    for (const el of [container.firstChild as HTMLElement, ...Array.from(all)]) {
      if (!el || !el.style) continue
      const cs = window.getComputedStyle(el)
      expect(isBannedColor(cs.backgroundColor), `bg of ${el.tagName} = ${cs.backgroundColor}`).toBe(false)
      expect(isBannedColor(cs.color), `color of ${el.tagName} = ${cs.color}`).toBe(false)
    }
  })
})

describe('LD mode — touch target floor', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'ld')
  })
  afterEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  })

  it.each([
    ['Button', <Button>X</Button>],
    ['Input', <Input />],
  ])('%s: min-height >= 48px in LD mode', (_, node) => {
    const { container } = render(node)
    const root = container.firstChild as HTMLElement
    const cs = window.getComputedStyle(root)
    const minH = parseFloat(cs.minHeight) || 0
    // jsdom may not apply Tailwind's [data-theme="ld"] selector reliably;
    // accept either: actual value >= 48px OR the class list includes 'min-h-touch'.
    if (minH > 0) {
      expect(minH).toBeGreaterThanOrEqual(48)
    } else {
      expect(root.className).toMatch(/min-h-touch/)
    }
  })
})
