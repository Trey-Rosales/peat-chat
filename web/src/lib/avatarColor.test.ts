import { describe, it, expect } from 'vitest'
import { colorForSender, AVATAR_HUES } from './avatarColor'

describe('colorForSender', () => {
  it('returns the same hue for the same sender id', () => {
    expect(colorForSender('alice-123')).toBe(colorForSender('alice-123'))
  })

  it('returns one of the AVATAR_HUES classnames', () => {
    const hue = colorForSender('bob-456')
    expect(AVATAR_HUES).toContain(hue)
  })

  it('distributes across all 6 buckets over many ids', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      seen.add(colorForSender(`user-${i}`))
    }
    expect(seen.size).toBe(6)
  })

  it('handles empty string deterministically', () => {
    expect(colorForSender('')).toBe(colorForSender(''))
    expect(AVATAR_HUES).toContain(colorForSender(''))
  })
})
