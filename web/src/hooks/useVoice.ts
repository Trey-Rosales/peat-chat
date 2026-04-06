import { useEffect, useRef, useCallback } from 'react'
import { VoiceManager } from '../voice/VoiceManager'
import { useChatStore } from '../store/chatStore'
import type { VoiceMember } from '../types'

export function useVoice(send: (type: string, data: any) => void) {
  const managerRef = useRef<VoiceManager | null>(null)

  useEffect(() => {
    managerRef.current = new VoiceManager(send)
    return () => {
      managerRef.current?.destroy()
      managerRef.current = null
    }
  }, [send])

  const joinVoice = useCallback(
    async (roomId: string, channelId: string, existingMembers: VoiceMember[]) => {
      if (!managerRef.current) return
      try {
        await managerRef.current.joinChannel(roomId, channelId, existingMembers)
        useChatStore.getState().setActiveVoice(roomId, channelId)
      } catch (err) {
        console.error('Failed to join voice channel:', err)
      }
    },
    []
  )

  const leaveVoice = useCallback(() => {
    managerRef.current?.leaveChannel()
    useChatStore.getState().clearActiveVoice()
  }, [])

  return { joinVoice, leaveVoice, managerRef }
}
