import { useState, useRef, useEffect, useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { usePTT } from './hooks/usePTT'
import { useGeolocation } from './hooks/useGeolocation'
import { useChatStore } from './store/chatStore'
import { useSettingsStore } from './store/settingsStore'
import { VoiceManager } from './voice/VoiceManager'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { JoinRoomModal } from './components/JoinRoomModal'
import { SettingsPage } from './components/SettingsPage'
import type { VoiceMember } from './types'

export default function App() {
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const displayName = useChatStore((s) => s.displayName)
  const settingsOpen = useChatStore((s) => s.settingsOpen)
  const toggleSettings = useChatStore((s) => s.toggleSettings)
  const [nameInput, setNameInput] = useState('')

  // VoiceManager ref -- shared between WebSocket hook and voice controls
  const voiceManagerRef = useRef<VoiceManager | null>(null)
  const sendRef = useRef<(type: string, data: any) => void>(() => {})

  // WebSocket with voice signaling
  const { send } = useWebSocket(voiceManagerRef)
  sendRef.current = send

  // Initialize VoiceManager with the real send function
  useEffect(() => {
    voiceManagerRef.current = new VoiceManager((...args) => sendRef.current(...args))
    return () => {
      voiceManagerRef.current?.destroy()
      voiceManagerRef.current = null
    }
  }, [])

  // Push-to-talk (keyboard)
  usePTT(send, voiceManagerRef.current)

  // Geolocation tracking for tactical map
  const selfPositionRef = useGeolocation(send)

  const joinVoice = useCallback(
    async (roomId: string, channelId: string, existingMembers: VoiceMember[]) => {
      if (!voiceManagerRef.current) return
      try {
        await voiceManagerRef.current.joinChannel(roomId, channelId, existingMembers)
        useChatStore.getState().setActiveVoice(roomId, channelId)
        if (voiceManagerRef.current.listenOnly) {
          useChatStore.getState().setVoiceError('No mic — listen-only (HTTPS required for mic on LAN)')
          setTimeout(() => useChatStore.getState().setVoiceError(null), 5000)
        } else if (useSettingsStore.getState().voiceMode === 'open') {
          // Open mic mode — unmute immediately
          voiceManagerRef.current.setMuted(false)
          useChatStore.getState().setLocalSpeaking(true)
          send('voice_speaking', { room_id: roomId, channel_id: channelId, speaking: true })
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
  }, [])

  const handlePTTStart = () => {
    const activeVoice = useChatStore.getState().activeVoice
    if (!activeVoice || !voiceManagerRef.current) return
    voiceManagerRef.current.setMuted(false)
    useChatStore.getState().setLocalSpeaking(true)
    send('voice_speaking', {
      room_id: activeVoice.roomId,
      channel_id: activeVoice.channelId,
      speaking: true,
    })
  }

  const handlePTTEnd = () => {
    const activeVoice = useChatStore.getState().activeVoice
    if (!activeVoice || !voiceManagerRef.current) return
    voiceManagerRef.current.setMuted(true)
    useChatStore.getState().setLocalSpeaking(false)
    send('voice_speaking', {
      room_id: activeVoice.roomId,
      channel_id: activeVoice.channelId,
      speaking: false,
    })
  }

  // Name entry screen
  if (!displayName) {
    return (
      <div className="h-full flex items-center justify-center bg-pl-bg px-4">
        <div className="bg-pl-sidebar rounded-2xl p-8 w-full max-w-xs shadow-2xl">
          <h1 className="text-2xl font-semibold text-pl-text mb-1">PeatLink</h1>
          <p className="text-pl-text-sec text-sm mb-6">Tactical mesh chat</p>
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
            className="w-full bg-pl-input text-pl-text rounded-lg px-4 py-3 text-base placeholder-pl-text-sec"
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
            className="w-full mt-3 bg-pl-accent text-white rounded-lg py-3 text-base font-medium hover:brightness-110 active:brightness-90 transition"
          >
            Join
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex relative">
      {/* Sidebar - always visible on desktop, overlay on mobile */}
      <div
        className={`
          fixed inset-0 z-40 md:relative md:inset-auto
          ${sidebarOpen ? 'block' : 'hidden'} md:block
        `}
      >
        <div
          className="absolute inset-0 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
        <div className="relative z-10 h-full">
          <Sidebar
            onJoinRoom={() => setShowJoinModal(true)}
            onSelectRoom={() => setSidebarOpen(false)}
            onJoinVoice={joinVoice}
            onLeaveVoice={leaveVoice}
            onPTTStart={handlePTTStart}
            onPTTEnd={handlePTTEnd}
            send={send}
          />
        </div>
      </div>

      {/* Chat area */}
      <ChatView
        send={send}
        onOpenSidebar={() => setSidebarOpen(true)}
        onPTTStart={handlePTTStart}
        onPTTEnd={handlePTTEnd}
        selfPosition={selfPositionRef}
      />

      {showJoinModal && (
        <JoinRoomModal
          onJoin={(name) => {
            send('join_room', { name })
            setShowJoinModal(false)
            setSidebarOpen(false)
          }}
          onClose={() => setShowJoinModal(false)}
        />
      )}

      {settingsOpen && <SettingsPage onClose={toggleSettings} send={send} />}
    </div>
  )
}
