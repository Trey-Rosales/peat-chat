import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { ComposerAttachMenu, type AttachKind } from './ComposerAttachMenu'

function renderOpen(onSelect: (kind: AttachKind) => void) {
  return render(<ComposerAttachMenu onSelect={onSelect} defaultOpen />)
}

describe('ComposerAttachMenu', () => {
  afterEach(() => cleanup())

  it('renders all four attach options when open', () => {
    renderOpen(() => {})
    expect(screen.getByRole('menuitem', { name: /image/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /file/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /voice message/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /location/i })).toBeInTheDocument()
  })

  it('fires onSelect with the matching kind for each item', () => {
    const onSelect = vi.fn()
    renderOpen(onSelect)

    fireEvent.click(screen.getByRole('menuitem', { name: /image/i }))
    expect(onSelect).toHaveBeenLastCalledWith('image')
  })

  it('renders an Attach trigger button', () => {
    render(<ComposerAttachMenu onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /attach/i })).toBeInTheDocument()
  })
})
