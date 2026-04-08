import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { VoiceBar } from './VoiceBar'
import { useChatStore } from '../store/chatStore'

describe('VoiceBar', () => {
  beforeEach(() => {
    useChatStore.setState({
      rooms: {},
      voiceState: {},
      activeVoice: null,
      localSpeaking: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not error when joining and leaving voice repeatedly', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <VoiceBar
        onDisconnect={() => {}}
        onPTTStart={() => {}}
        onPTTEnd={() => {}}
      />
    )

    act(() => {
      useChatStore.setState({
        rooms: {
          r1: { id: 'r1', name: 'General', messages: [], members: 2, unread: 0 },
        },
        voiceState: {
          r1: [{ id: 'vc1', name: 'Command', members: [] }],
        },
        activeVoice: { roomId: 'r1', channelId: 'vc1' },
      })
    })
    expect(screen.getByText('Command')).toBeInTheDocument()

    act(() => {
      useChatStore.setState({ activeVoice: null })
    })
    expect(screen.queryByText('Command')).not.toBeInTheDocument()

    act(() => {
      useChatStore.setState({
        activeVoice: { roomId: 'r1', channelId: 'vc1' },
      })
    })
    expect(screen.getByText('Command')).toBeInTheDocument()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('renders fallback labels instead of crashing on malformed voice state', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <VoiceBar
        onDisconnect={() => {}}
        onPTTStart={() => {}}
        onPTTEnd={() => {}}
      />
    )

    act(() => {
      useChatStore.setState({
        rooms: {
          r1: { id: 'r1', name: 'General', messages: [], members: 2, unread: 0 },
        },
        voiceState: {
          r1: {} as any,
        },
        activeVoice: { roomId: 'r1', channelId: 'vc1' },
      })
    })

    expect(screen.getByText('Voice Connected')).toBeInTheDocument()
    expect(consoleError).not.toHaveBeenCalled()
  })
})
