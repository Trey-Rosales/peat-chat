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
    // Close any lingering connection before opening a new one
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${proto}//${host}/ws`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      store.getState().setConnected(true)
      const { displayName, rooms } = store.getState()

      // Send callsign if we have one (server also auto-assigns via name_assigned)
      if (displayName) {
        ws.send(JSON.stringify({ type: 'set_name', data: { name: displayName } }))
      }

      // Rejoin rooms (always, regardless of whether displayName is set)
      const roomList = Object.values(rooms)
      if (roomList.length > 0) {
        for (const room of roomList) {
          if (room.isDM) {
            ws.send(JSON.stringify({ type: 'join_dm', data: { room_id: room.id } }))
          } else {
            ws.send(JSON.stringify({ type: 'join_room', data: { name: room.name } }))
          }
        }
      } else {
        ws.send(JSON.stringify({ type: 'join_room', data: { name: 'general' } }))
      }
    }

    ws.onclose = () => {
      store.getState().setConnected(false)
      // Reset all transient state on disconnect
      store.setState({
        meshPeers: {},
        cotContacts: {},
        cotMarkers: {},
        voiceState: {},
        activeVoice: null,
        localSpeaking: false,
        selfPosition: null,
      })
      wsRef.current = null
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onmessage = (event) => {
      let msg: WSMessage
      try {
        msg = JSON.parse(event.data)
      } catch {
        console.warn('Received malformed WebSocket frame')
        return
      }
      if (!msg || typeof msg.type !== 'string') return
      const state = store.getState()

      switch (msg.type) {
        case 'identity':
          state.setIdentity(msg.data.id, msg.data.short_id)
          break
        case 'name_assigned':
          // Server assigned a callsign (from Android prefs) — use it
          if (msg.data.name) {
            state.setDisplayName(msg.data.name)
            // Re-send set_name so the server session is updated
            ws.send(JSON.stringify({ type: 'set_name', data: { name: msg.data.name } }))
          }
          break
        case 'room_joined':
          state.addRoom(msg.data.room_id, msg.data.name, msg.data.members, msg.data.is_dm)
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

        // --- Message editing / deletion / reactions / pins ---
        case 'message_edited':
          state.editMessage(msg.data.room_id, msg.data.message_id, msg.data.content, msg.data.edited_at)
          break
        case 'message_deleted':
          state.deleteMessage(msg.data.room_id, msg.data.message_id)
          break
        case 'reaction_updated':
          state.updateReactions(msg.data.room_id, msg.data.message_id, msg.data.reactions || {})
          break
        case 'message_pinned':
          state.pinMessage(msg.data.room_id, msg.data.message_id)
          break
        case 'message_unpinned':
          state.unpinMessage(msg.data.room_id, msg.data.message_id)
          break

        // --- Direct Messages ---
        case 'dm_opened':
          state.addDMRoom(msg.data.room_id, msg.data.name, msg.data.peer_id, msg.data.peer_name)
          // Auto-switch to the DM conversation
          state.setActiveRoom(msg.data.room_id)
          break

        case 'mesh_state':
          state.setMeshPeers(msg.data.room_id, msg.data.peers || [])
          break
        case 'ble_mesh_state':
          state.mergeMeshPeers(msg.data.room_id, msg.data.peers || [])
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

        // --- CoT / Map messages ---
        case 'cot_state':
          state.setCotContacts(msg.data.room_id, msg.data.contacts || [])
          state.setCotMarkers(msg.data.room_id, msg.data.markers || [])
          break
        case 'marker_created':
          state.addCotMarker(msg.data.room_id, msg.data.marker)
          break
        case 'marker_deleted':
          state.removeCotMarker(msg.data.room_id, msg.data.marker_id)
          break
      }
    }
  }, [signalingRef])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  const send = useCallback((type: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }))
    }
  }, [])

  return { send }
}
