import { useState, useRef, useEffect, useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { usePTT } from './hooks/usePTT'
import { useGeolocation } from './hooks/useGeolocation'
import { useTheme } from './hooks/useTheme'
import { useChatStore } from './store/chatStore'
import { useSettingsStore } from './store/settingsStore'
import { VoiceManager } from './voice/VoiceManager'
import { AppShell } from './components/layout/AppShell'
import { WebSocketContext } from './lib/WebSocketContext'
import { AppActionsProvider } from './lib/AppActionsContext'
import type { VoiceMember } from './types'

export default function App() {
  useTheme()
  const displayName = useChatStore((s) => s.displayName)
  const [nameInput, setNameInput] = useState('')

  // VoiceManager ref -- shared between WebSocket hook and voice controls
  const voiceManagerRef = useRef<VoiceManager | null>(null)
  const sendRef = useRef<(type: string, data: any) => void>(() => {})

  // WebSocket with voice signaling
  const { send } = useWebSocket(voiceManagerRef)
  sendRef.current = send

  // Initialize VoiceManager — wrapped in try-catch for environments where
  // AudioContext or WebRTC APIs may not be available
  useEffect(() => {
    try {
      voiceManagerRef.current = new VoiceManager((...args) => sendRef.current(...args))
    } catch (err) {
      console.warn('VoiceManager init failed:', err)
      voiceManagerRef.current = null
    }
    return () => {
      voiceManagerRef.current?.destroy()
      voiceManagerRef.current = null
    }
  }, [])

  // Push-to-talk (keyboard)
  usePTT(send, voiceManagerRef.current)

  // Geolocation tracking for tactical map
  useGeolocation(send)

  const joinVoice = useCallback(
    async (roomId: string, channelId: string, existingMembers: VoiceMember[]) => {
      const hasBleVoice = !!window.PeatLinkVoice?.hasBleVoice?.()
      const vm = voiceManagerRef.current

      if (!vm && !hasBleVoice) return

      if (!vm) {
        // BLE-only: just send join_voice — no WebRTC, audio via native BleVoiceService
        send('join_voice', { room_id: roomId, channel_id: channelId })
        useChatStore.getState().setActiveVoice(roomId, channelId)
        return
      }

      try {
        await vm.joinChannel(roomId, channelId, existingMembers)
        useChatStore.getState().setActiveVoice(roomId, channelId)
        if (vm.listenOnly) {
          useChatStore.getState().setVoiceError('No mic — listen-only (HTTPS required for mic on LAN)')
          setTimeout(() => useChatStore.getState().setVoiceError(null), 5000)
        }
        const mode = useSettingsStore.getState().voiceMode
        if (mode === 'noise_gate' || mode === 'auto') {
          const threshold = useSettingsStore.getState().noiseGateThreshold
          vm.startNoiseGate(threshold)
        }
      } catch (err) {
        console.error('Failed to join voice channel:', err)
        useChatStore.getState().setVoiceError('Failed to join voice channel.')
        setTimeout(() => useChatStore.getState().setVoiceError(null), 5000)
      }
    },
    []
  )

  const leaveVoice = useCallback(() => {
    voiceManagerRef.current?.leaveChannel()
    useChatStore.getState().clearActiveVoice()
    useChatStore.getState().setVoiceMuted(false)
  }, [])

  const handleMuteToggle = useCallback((muted: boolean) => {
    voiceManagerRef.current?.setMuted(muted)
    useChatStore.getState().setVoiceMuted(muted)
  }, [])

  const handleModeChange = useCallback((newMode: string) => {
    const vm = voiceManagerRef.current
    if (!vm?.isActive) return
    // Stop any running noise gate/auto detection
    vm.stopNoiseGate()
    // For noise_gate and auto modes, start the noise gate
    if (newMode === 'noise_gate' || newMode === 'auto') {
      const threshold = useSettingsStore.getState().noiseGateThreshold
      vm.startNoiseGate(threshold)
    } else {
      // PTT mode: mute by default (user holds key to talk)
      vm.setMuted(true)
    }
  }, [])

  const handlePTTStart = () => {
    try {
      const activeVoice = useChatStore.getState().activeVoice
      if (!activeVoice) return
      const { userId, displayName } = useChatStore.getState()

      if (voiceManagerRef.current?.isActive) {
        voiceManagerRef.current.setMuted(false)
      }
      if (window.PeatLinkVoice?.hasBleVoice?.()) {
        window.PeatLinkVoice.startPtt(userId, displayName || 'Android')
      }

      useChatStore.getState().setLocalSpeaking(true)
      send('voice_speaking', {
        room_id: activeVoice.roomId,
        channel_id: activeVoice.channelId,
        speaking: true,
      })
    } catch (err) {
      console.warn('PTT start error:', err)
    }
  }

  const handlePTTEnd = () => {
    try {
      const activeVoice = useChatStore.getState().activeVoice
      if (!activeVoice) return

      if (voiceManagerRef.current?.isActive) {
        voiceManagerRef.current.setMuted(true)
      }
      if (window.PeatLinkVoice?.hasBleVoice?.()) {
        window.PeatLinkVoice.stopPtt()
      }

      useChatStore.getState().setLocalSpeaking(false)
      send('voice_speaking', {
        room_id: activeVoice.roomId,
        channel_id: activeVoice.channelId,
        speaking: false,
      })
    } catch (err) {
      console.warn('PTT end error:', err)
    }
  }

  // Name entry screen
  if (!displayName) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-canvas px-4">
        <div className="bg-surface-1 rounded-2xl p-8 w-full max-w-xs shadow-2xl">
          <h1 className="text-2xl font-semibold text-fg-primary mb-1">PeatLink</h1>
          <p className="text-fg-secondary text-sm mb-6">Tactical mesh chat</p>
          <input
            type="text"
            placeholder="Your display name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameInput.trim()) {
                useChatStore.getState().setDisplayName(nameInput.trim())
                send('set_name', { name: nameInput.trim() })
                send('join_room', { name: 'general' })
              }
            }}
            className="w-full bg-surface-2 text-fg-primary rounded-lg px-4 py-3 text-base placeholder:text-fg-secondary"
            autoFocus
          />
          <button
            onClick={() => {
              if (nameInput.trim()) {
                useChatStore.getState().setDisplayName(nameInput.trim())
                send('set_name', { name: nameInput.trim() })
                send('join_room', { name: 'general' })
              }
            }}
            className="w-full mt-3 bg-brand text-white rounded-lg py-3 text-base font-medium hover:brightness-110 active:brightness-90 transition"
          >
            Join
          </button>
        </div>
      </div>
    )
  }

  return (
    <WebSocketContext.Provider value={send}>
      <AppActionsProvider
        value={{
          onJoinVoice: joinVoice,
          onLeaveVoice: leaveVoice,
          onMuteToggle: handleMuteToggle,
          onModeChange: handleModeChange,
          onPTTStart: handlePTTStart,
          onPTTEnd: handlePTTEnd,
        }}
      >
        <AppShell />
      </AppActionsProvider>
    </WebSocketContext.Provider>
  )
}
