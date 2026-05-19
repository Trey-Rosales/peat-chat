import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MessageRow } from './MessageRow'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ChatMessage } from '../types'

function renderRow(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

const baseMsg: ChatMessage = {
  id: 'm1',
  sender: 'alice-1',
  sender_name: 'Alice Rivera',
  timestamp: Date.now(),
  content: 'Hello team',
}

const noop = () => {}
const handlers = {
  onReply: noop,
  onEdit: noop,
  onDelete: noop,
  onReact: noop,
  onRemoveReact: noop,
  onPin: noop,
  onUnpin: noop,
}

describe('MessageRow', () => {
  afterEach(() => cleanup())

  it('renders sender name and avatar initials when isGroupHead', () => {
    renderRow(
      <MessageRow
        message={baseMsg}
        isSelf={false}
        isGroupHead={true}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.getByText('Alice Rivera')).toBeInTheDocument()
    expect(screen.getByText('AR')).toBeInTheDocument()
  })

  it('hides sender name and avatar fallback when continuation', () => {
    renderRow(
      <MessageRow
        message={baseMsg}
        isSelf={false}
        isGroupHead={false}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.queryByText('Alice Rivera')).not.toBeInTheDocument()
    expect(screen.queryByText('AR')).not.toBeInTheDocument()
  })

  it('renders message content in both branches', () => {
    const { rerender } = renderRow(
      <MessageRow
        message={baseMsg}
        isSelf={false}
        isGroupHead={true}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.getByText('Hello team')).toBeInTheDocument()
    rerender(
      <TooltipProvider>
        <MessageRow
          message={baseMsg}
          isSelf={false}
          isGroupHead={false}
          userId="me-1"
          {...handlers}
        />
      </TooltipProvider>
    )
    expect(screen.getByText('Hello team')).toBeInTheDocument()
  })

  it('renders deleted placeholder when message.deleted', () => {
    renderRow(
      <MessageRow
        message={{ ...baseMsg, deleted: true }}
        isSelf={false}
        isGroupHead={true}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.getByText(/Message deleted/i)).toBeInTheDocument()
  })

  it('renders reaction pills when present', () => {
    renderRow(
      <MessageRow
        message={{
          ...baseMsg,
          reactions: { '\u{1F44D}': ['u1', 'u2'], '✅': ['me-1'] },
        }}
        isSelf={false}
        isGroupHead={true}
        userId="me-1"
        {...handlers}
      />
    )
    expect(screen.getByText('\u{1F44D}')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('✅')).toBeInTheDocument()
  })
})
