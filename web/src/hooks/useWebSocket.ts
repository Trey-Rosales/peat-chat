import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '../store/chatStore'
import type { VoiceManager } from '../voice/VoiceManager'
import type { WSMessage } from '../types'

export function useWebSocket(
  signalingRef?: React.MutableRefObject<VoiceManager | null>
) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const store = useChatStore

  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${proto}//${host}/ws`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      store.getState().setConnected(true)
      const name = store.getState().displayName
      if (name) {
        ws.send(JSON.stringify({ type: 'set_name', data: { name } }))
      }
    }

    ws.onclose = () => {
      store.getState().setConnected(false)
      wsRef.current = null
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onmessage = (event) => {
      const msg: WSMessage = JSON.parse(event.data)
      const state = store.getState()

      switch (msg.type) {
        case 'identity':
          state.setIdentity(msg.data.id, msg.data.short_id)
          break
        case 'room_joined':
          state.addRoom(msg.data.room_id, msg.data.name, msg.data.members)
          if (!state.activeRoomId) {
            state.setActiveRoom(msg.data.room_id)
          }
          break
        case 'room_history':
          state.setRoomHistory(msg.data.room_id, msg.data.messages || [])
          break
        case 'message':
          state.addMessage(msg.data.room_id, msg.data.message)
          break
        case 'peer_update':
          state.updateRoomMembers(msg.data.room_id, msg.data.members)
          break
        case 'mesh_state':
          state.setMeshPeers(msg.data.room_id, msg.data.peers || [])
          break

        // --- Voice messages ---
        case 'voice_state':
          state.setVoiceState(msg.data.room_id, msg.data.channels || [])
          break
        case 'voice_channel_created':
          state.addVoiceChannel(msg.data.room_id, {
            id: msg.data.channel_id,
            name: msg.data.name,
          })
          break
        case 'voice_peer_joined':
          state.addVoicePeer(msg.data.room_id, msg.data.channel_id, {
            id: msg.data.peer_id,
            name: msg.data.name,
            short_id: '',
            speaking: false,
          })
          signalingRef?.current?.handlePeerJoined(msg.data.peer_id)
          break
        case 'voice_peer_left':
          state.removeVoicePeer(
            msg.data.room_id,
            msg.data.channel_id,
            msg.data.peer_id
          )
          signalingRef?.current?.handlePeerLeft(msg.data.peer_id)
          break
        case 'voice_offer_relay':
          signalingRef?.current?.handleOffer(msg.data.from_id, msg.data.sdp)
          break
        case 'voice_answer_relay':
          signalingRef?.current?.handleAnswer(msg.data.from_id, msg.data.sdp)
          break
        case 'voice_ice_relay':
          signalingRef?.current?.handleIce(msg.data.from_id, msg.data.candidate)
          break
        case 'voice_speaking_broadcast':
          state.updateSpeaking(
            msg.data.room_id,
            msg.data.channel_id,
            msg.data.peer_id,
            msg.data.speaking
          )
          break
      }
    }
  }, [signalingRef])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((type: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }))
    }
  }, [])

  return { send }
}
