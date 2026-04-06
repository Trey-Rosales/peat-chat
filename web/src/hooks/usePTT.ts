import { useEffect } from 'react'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import type { VoiceManager } from '../voice/VoiceManager'

export function usePTT(
  send: (type: string, data: any) => void,
  voiceManager: VoiceManager | null
) {
  const activeVoice = useChatStore((s) => s.activeVoice)
  const pttKey = useSettingsStore((s) => s.pttKey)
  const setLocalSpeaking = useChatStore((s) => s.setLocalSpeaking)

  useEffect(() => {
    if (!activeVoice || !voiceManager) return

    let speaking = false

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture PTT when typing in input fields
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return
      if (e.key === pttKey && !e.repeat && !speaking) {
        speaking = true
        voiceManager.setMuted(false)
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
        voiceManager.setMuted(true)
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
    return () => {
      // Ensure we stop speaking on cleanup
      if (speaking) {
        voiceManager.setMuted(true)
        setLocalSpeaking(false)
        send('voice_speaking', {
          room_id: activeVoice.roomId,
          channel_id: activeVoice.channelId,
          speaking: false,
        })
      }
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [activeVoice, pttKey, voiceManager, send, setLocalSpeaking])
}
