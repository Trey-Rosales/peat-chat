import { describe, it, expect } from 'vitest'
import { initialsFor } from './initials'

describe('initialsFor', () => {
  it('uses the first letter of each word, up to 2 letters', () => {
    expect(initialsFor('Alice Rivera', 'a-123')).toBe('AR')
  })

  it('uppercases single-word names', () => {
    expect(initialsFor('alice', 'a-123')).toBe('A')
  })

  it('caps at two letters even with three+ words', () => {
    expect(initialsFor('John Q Public', 'jqp-1')).toBe('JQ')
  })

  it('falls back to first 2 chars of sender id when name is empty', () => {
    expect(initialsFor('', 'xyz-789')).toBe('XY')
  })

  it('falls back to first 2 chars of sender id when name is whitespace', () => {
    expect(initialsFor('   ', 'xyz-789')).toBe('XY')
  })

  it('returns ? when both inputs are empty', () => {
    expect(initialsFor('', '')).toBe('?')
  })
})
