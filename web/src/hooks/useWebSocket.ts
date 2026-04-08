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
      const data = msg.data && typeof msg.data === 'object' ? msg.data : {}

      switch (msg.type) {
        case 'identity':
          state.setIdentity(
            typeof (data as any).id === 'string' ? (data as any).id : '',
            typeof (data as any).short_id === 'string' ? (data as any).short_id : ''
          )
          break
        case 'name_assigned':
          // Server assigned a callsign (from Android prefs) — use it
          if (typeof (data as any).name === 'string' && (data as any).name) {
            state.setDisplayName((data as any).name)
            // Re-send set_name so the server session is updated
            ws.send(JSON.stringify({ type: 'set_name', data: { name: (data as any).name } }))
          }
          break
        case 'room_joined':
          if (typeof (data as any).room_id !== 'string' || typeof (data as any).name !== 'string') break
          state.addRoom(
            (data as any).room_id,
            (data as any).name,
            typeof (data as any).members === 'number' ? (data as any).members : 0,
            Boolean((data as any).is_dm)
          )
          if (!state.activeRoomId) {
            state.setActiveRoom((data as any).room_id)
          }
          break
        case 'room_history':
          if (typeof (data as any).room_id !== 'string') break
          state.setRoomHistory((data as any).room_id, Array.isArray((data as any).messages) ? (data as any).messages : [])
          break
        case 'message':
          if (typeof (data as any).room_id !== 'string' || !(data as any).message || typeof (data as any).message !== 'object') break
          state.addMessage((data as any).room_id, (data as any).message)
          break
        case 'peer_update':
          if (typeof (data as any).room_id === 'string' && typeof (data as any).members === 'number') {
            state.updateRoomMembers((data as any).room_id, (data as any).members)
          }
          break

        // --- Message editing / deletion / reactions / pins ---
        case 'message_edited':
          if (typeof (data as any).room_id !== 'string' || typeof (data as any).message_id !== 'string') break
          state.editMessage(
            (data as any).room_id,
            (data as any).message_id,
            typeof (data as any).content === 'string' ? (data as any).content : '',
            typeof (data as any).edited_at === 'number' ? (data as any).edited_at : 0
          )
          break
        case 'message_deleted':
          if (typeof (data as any).room_id !== 'string' || typeof (data as any).message_id !== 'string') break
          state.deleteMessage((data as any).room_id, (data as any).message_id)
          break
        case 'reaction_updated':
          if (typeof (data as any).room_id !== 'string' || typeof (data as any).message_id !== 'string') break
          state.updateReactions(
            (data as any).room_id,
            (data as any).message_id,
            (data as any).reactions && typeof (data as any).reactions === 'object' ? (data as any).reactions : {}
          )
          break
        case 'message_pinned':
          if (typeof (data as any).room_id !== 'string' || typeof (data as any).message_id !== 'string') break
          state.pinMessage((data as any).room_id, (data as any).message_id)
          break
        case 'message_unpinned':
          if (typeof (data as any).room_id !== 'string' || typeof (data as any).message_id !== 'string') break
          state.unpinMessage((data as any).room_id, (data as any).message_id)
          break

        // --- Direct Messages ---
        case 'dm_opened':
          if (
            typeof (data as any).room_id !== 'string' ||
            typeof (data as any).name !== 'string' ||
            typeof (data as any).peer_id !== 'string' ||
            typeof (data as any).peer_name !== 'string'
          ) break
          state.addDMRoom((data as any).room_id, (data as any).name, (data as any).peer_id, (data as any).peer_name)
          // Auto-switch to the DM conversation
          state.setActiveRoom((data as any).room_id)
          break

        case 'mesh_state':
          if (typeof (data as any).room_id !== 'string') break
          state.setMeshPeers((data as any).room_id, Array.isArray((data as any).peers) ? (data as any).peers : [])
          break
        case 'ble_mesh_state':
          if (typeof (data as any).room_id !== 'string') break
          state.mergeMeshPeers((data as any).room_id, Array.isArray((data as any).peers) ? (data as any).peers : [])
          break

        // --- Voice messages ---
        case 'voice_state':
          if (typeof (data as any).room_id !== 'string') break
          state.setVoiceState((data as any).room_id, Array.isArray((data as any).channels) ? (data as any).channels : [])
          break
        case 'voice_channel_created':
          if (typeof (data as any).room_id !== 'string' || typeof (data as any).channel_id !== 'string') break
          state.addVoiceChannel((data as any).room_id, {
            id: (data as any).channel_id,
            name: typeof (data as any).name === 'string' ? (data as any).name : 'Voice',
          })
          break
        case 'voice_peer_joined':
          if (
            typeof (data as any).room_id !== 'string' ||
            typeof (data as any).channel_id !== 'string' ||
            typeof (data as any).peer_id !== 'string'
          ) break
          state.addVoicePeer((data as any).room_id, (data as any).channel_id, {
            id: (data as any).peer_id,
            name: typeof (data as any).name === 'string' ? (data as any).name : '',
            short_id: '',
            speaking: false,
          })
          try { signalingRef?.current?.handlePeerJoined((data as any).peer_id, typeof (data as any).name === 'string' ? (data as any).name : undefined) } catch {}
          break
        case 'voice_peer_left':
          if (
            typeof (data as any).room_id !== 'string' ||
            typeof (data as any).channel_id !== 'string' ||
            typeof (data as any).peer_id !== 'string'
          ) break
          state.removeVoicePeer(
            (data as any).room_id,
            (data as any).channel_id,
            (data as any).peer_id
          )
          try { signalingRef?.current?.handlePeerLeft((data as any).peer_id) } catch {}
          break
        case 'voice_offer_relay':
          if (typeof (data as any).from_id !== 'string' || typeof (data as any).sdp !== 'string') break
          try { signalingRef?.current?.handleOffer((data as any).from_id, (data as any).sdp)?.catch?.(() => {}) } catch {}
          break
        case 'voice_answer_relay':
          if (typeof (data as any).from_id !== 'string' || typeof (data as any).sdp !== 'string') break
          try { signalingRef?.current?.handleAnswer((data as any).from_id, (data as any).sdp)?.catch?.(() => {}) } catch {}
          break
        case 'voice_ice_relay':
          if (typeof (data as any).from_id !== 'string' || typeof (data as any).candidate !== 'string') break
          try { signalingRef?.current?.handleIce((data as any).from_id, (data as any).candidate)?.catch?.(() => {}) } catch {}
          break
        case 'voice_speaking_broadcast':
          if (
            typeof (data as any).room_id !== 'string' ||
            typeof (data as any).channel_id !== 'string' ||
            typeof (data as any).peer_id !== 'string'
          ) break
          state.updateSpeaking(
            (data as any).room_id,
            (data as any).channel_id,
            (data as any).peer_id,
            Boolean((data as any).speaking)
          )
          break

        // --- CoT / Map messages ---
        case 'cot_state':
          if (typeof (data as any).room_id !== 'string') break
          state.setCotContacts((data as any).room_id, Array.isArray((data as any).contacts) ? (data as any).contacts : [])
          state.setCotMarkers((data as any).room_id, Array.isArray((data as any).markers) ? (data as any).markers : [])
          break
        case 'marker_created':
          if (typeof (data as any).room_id !== 'string' || !(data as any).marker || typeof (data as any).marker !== 'object') break
          state.addCotMarker((data as any).room_id, (data as any).marker)
          break
        case 'marker_deleted':
          if (typeof (data as any).room_id !== 'string' || typeof (data as any).marker_id !== 'string') break
          state.removeCotMarker((data as any).room_id, (data as any).marker_id)
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
