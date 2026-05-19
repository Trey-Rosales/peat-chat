import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { MessageInput } from './MessageInput'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useChatStore } from '../store/chatStore'

function renderInput(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('MessageInput', () => {
  beforeEach(() => {
    useChatStore.setState({ connected: true })
  })
  afterEach(() => cleanup())

  it('shows the voice-message (mic) button when textarea is empty', () => {
    renderInput(<MessageInput onSend={() => {}} onAttach={() => {}} />)
    expect(screen.getByRole('button', { name: /voice message/i })).toBeInTheDocument()
  })

  it('swaps the mic for a send button once text is entered', () => {
    renderInput(<MessageInput onSend={() => {}} onAttach={() => {}} />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'hi' } })
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument()
  })

  it('calls onSend with trimmed text and clears the field', () => {
    const onSend = vi.fn()
    renderInput(<MessageInput onSend={onSend} onAttach={() => {}} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '  hello  ' } })
    fireEvent.click(screen.getByRole('button', { name: /send message/i }))
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(ta.value).toBe('')
  })

  it('calls onCancelContext on Escape when reply or edit context is active', () => {
    const onCancel = vi.fn()
    renderInput(
      <MessageInput
        onSend={() => {}}
        onAttach={() => {}}
        onCancelContext={onCancel}
        contextKind="reply"
      />
    )
    const ta = screen.getByRole('textbox')
    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not send when content is whitespace only', () => {
    const onSend = vi.fn()
    renderInput(<MessageInput onSend={onSend} onAttach={() => {}} />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: '   ' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })
})
