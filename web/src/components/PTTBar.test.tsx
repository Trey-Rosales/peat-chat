import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { PTTBar } from './PTTBar'

describe('PTTBar', () => {
  afterEach(() => cleanup())

  it('renders the channel name', () => {
    render(
      <PTTBar
        channelName="Command"
        active={false}
        onPTTStart={() => {}}
        onPTTEnd={() => {}}
      />
    )
    expect(screen.getByText(/Command/i)).toBeInTheDocument()
  })

  it('forwards mouse down/up to PTT handlers', () => {
    const onPTTStart = vi.fn()
    const onPTTEnd = vi.fn()
    render(
      <PTTBar
        channelName="Command"
        active={false}
        onPTTStart={onPTTStart}
        onPTTEnd={onPTTEnd}
      />
    )
    const btn = screen.getByTitle(/hold to talk/i)
    fireEvent.mouseDown(btn)
    expect(onPTTStart).toHaveBeenCalled()
    fireEvent.mouseUp(btn)
    expect(onPTTEnd).toHaveBeenCalled()
  })
})
