import { useEffect } from 'react'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import type { VoiceManager } from '../voice/VoiceManager'

// Android BLE voice bridge (injected by PeatLink Android app)
declare global {
  interface Window {
    PeatLinkVoice?: {
      startPtt(senderId: string, senderName: string): void
      stopPtt(): void
      isTransmitting(): boolean
      hasBleVoice(): boolean
    }
  }
}

export function usePTT(
  send: (type: string, data: any) => void,
  voiceManager: VoiceManager | null
) {
  const activeVoice = useChatStore((s) => s.activeVoice)
  const pttKey = useSettingsStore((s) => s.pttKey)
  const setLocalSpeaking = useChatStore((s) => s.setLocalSpeaking)
  const userId = useChatStore((s) => s.userId)
  const displayName = useChatStore((s) => s.displayName)

  useEffect(() => {
    if (!activeVoice) return
    // Allow PTT without voiceManager if BLE voice is available
    const hasBleVoice = !!window.PeatLinkVoice?.hasBleVoice()
    if (!voiceManager && !hasBleVoice) return

    let speaking = false

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return
      if (e.key === pttKey && !e.repeat && !speaking) {
        speaking = true
        // WebRTC voice (if available)
        if (voiceManager) {
          voiceManager.setMuted(false)
        }
        // BLE voice (if available on Android)
        if (window.PeatLinkVoice?.hasBleVoice()) {
          window.PeatLinkVoice.startPtt(userId, displayName || 'Android')
        }
        setLocalSpeaking(true)
        send('voice_speaking', {
          room_id: activeVoice.roomId,
          channel_id: activeVoice.channelId,
          speaking: true,
        })
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === pttKey && speaking) {
        speaking = false
        if (voiceManager) {
          voiceManager.setMuted(true)
        }
        if (window.PeatLinkVoice?.hasBleVoice()) {
          window.PeatLinkVoice.stopPtt()
        }
        setLocalSpeaking(false)
        send('voice_speaking', {
          room_id: activeVoice.roomId,
          channel_id: activeVoice.channelId,
          speaking: false,
        })
      }
    }

    // Touch PTT support (for mobile — touch the PTT button area)
    const handleTouchStart = () => {
      if (!speaking) {
        speaking = true
        if (voiceManager) voiceManager.setMuted(false)
        if (window.PeatLinkVoice?.hasBleVoice()) {
          window.PeatLinkVoice.startPtt(userId, displayName || 'Android')
        }
        setLocalSpeaking(true)
        send('voice_speaking', {
          room_id: activeVoice.roomId,
          channel_id: activeVoice.channelId,
          speaking: true,
        })
      }
    }

    const handleTouchEnd = () => {
      if (speaking) {
        speaking = false
        if (voiceManager) voiceManager.setMuted(true)
        if (window.PeatLinkVoice?.hasBleVoice()) {
          window.PeatLinkVoice.stopPtt()
        }
        setLocalSpeaking(false)
        send('voice_speaking', {
          room_id: activeVoice.roomId,
          channel_id: activeVoice.channelId,
          speaking: false,
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    // Expose touch handlers globally for the PTT button component
    ;(window as any).__peatPttTouchStart = handleTouchStart
    ;(window as any).__peatPttTouchEnd = handleTouchEnd

    return () => {
      if (speaking) {
        if (voiceManager) voiceManager.setMuted(true)
        if (window.PeatLinkVoice?.hasBleVoice()) window.PeatLinkVoice.stopPtt()
        setLocalSpeaking(false)
        send('voice_speaking', {
          room_id: activeVoice.roomId,
          channel_id: activeVoice.channelId,
          speaking: false,
        })
      }
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      delete (window as any).__peatPttTouchStart
      delete (window as any).__peatPttTouchEnd
    }
  }, [activeVoice, pttKey, voiceManager, send, setLocalSpeaking, userId, displayName])
}
