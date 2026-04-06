export interface ChatMessage {
  id: string
  sender: string
  sender_name: string
  timestamp: number
  content: string
  reply_to?: string
}

export interface Room {
  id: string
  name: string
  messages: ChatMessage[]
  members: number
  unread: number
}

export interface MeshPeer {
  id: string
  name: string
  short_id: string
  transport: string
  latency_ms: number
  state: 'connected' | 'degraded'
  connected_at: number
}

export interface VoiceMember {
  id: string
  name: string
  short_id: string
  speaking: boolean
}

export interface VoiceChannel {
  id: string
  name: string
  members: VoiceMember[]
}

export interface CotContact {
  uid: string
  callsign: string
  short_id: string
  cot_type: string
  lat: number
  lon: number
  hae: number
  ce: number
  time: number
  stale: number
}

export interface CotMarker {
  id: string
  creator_id: string
  creator_name: string
  lat: number
  lon: number
  name: string
  icon: string
  color: string
  created_at: number
}

export interface WSMessage {
  type: string
  data: any
}
