import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { ComposerEmojiPopover, COMPOSER_EMOJIS } from './ComposerEmojiPopover'

describe('ComposerEmojiPopover', () => {
  afterEach(() => cleanup())

  it('exposes a quick-set of at least 6 emojis', () => {
    expect(COMPOSER_EMOJIS).toContain('\u{1F44D}')
    expect(COMPOSER_EMOJIS.length).toBeGreaterThanOrEqual(6)
  })

  it('renders the trigger button', () => {
    render(<ComposerEmojiPopover onPick={() => {}} />)
    expect(screen.getByRole('button', { name: /emoji/i })).toBeInTheDocument()
  })

  it('calls onPick with the chosen emoji', () => {
    const onPick = vi.fn()
    render(<ComposerEmojiPopover onPick={onPick} defaultOpen />)
    const btn = screen.getByRole('button', { name: '\u{1F44D}' })
    fireEvent.click(btn)
    expect(onPick).toHaveBeenCalledWith('\u{1F44D}')
  })
})
