package main

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// ChatMessage mirrors the Rust ChatMessage struct exactly.
type ChatMessage struct {
	ID         string  `json:"id"`
	Sender     string  `json:"sender"`
	SenderName string  `json:"sender_name"`
	Timestamp  uint64  `json:"timestamp"`
	Content    string  `json:"content"`
	ReplyTo    *string `json:"reply_to,omitempty"`
}

func NewChatMessage(senderID, senderName, content string) ChatMessage {
	return ChatMessage{
		ID:         uuid.New().String(),
		Sender:     senderID,
		SenderName: senderName,
		Timestamp:  uint64(time.Now().UnixMilli()),
		Content:    content,
	}
}

// WSMessage is the envelope for all WebSocket communication.
type WSMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// Incoming message data types

type SetNameData struct {
	Name string `json:"name"`
}

type JoinRoomData struct {
	Name string `json:"name"`
}

type SendMessageData struct {
	RoomID  string  `json:"room_id"`
	Content string  `json:"content"`
	ReplyTo *string `json:"reply_to,omitempty"`
}

// Outgoing message data types

type IdentityData struct {
	ID      string `json:"id"`
	ShortID string `json:"short_id"`
}

type RoomJoinedData struct {
	RoomID  string `json:"room_id"`
	Name    string `json:"name"`
	Members int    `json:"members"`
}

type RoomHistoryData struct {
	RoomID   string        `json:"room_id"`
	Messages []ChatMessage `json:"messages"`
}

type MessageData struct {
	RoomID  string      `json:"room_id"`
	Message ChatMessage `json:"message"`
}

type PeerUpdateData struct {
	RoomID  string `json:"room_id"`
	PeerID  string `json:"peer_id"`
	Name    string `json:"name"`
	Event   string `json:"event"` // "joined" or "left"
	Members int    `json:"members"`
}

type ErrorData struct {
	Message string `json:"message"`
}

// Mesh viewer types

type SetTransportData struct {
	Transport string `json:"transport"`
}

type MeshPeerData struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ShortID     string `json:"short_id"`
	Transport   string `json:"transport"`
	LatencyMs   int64  `json:"latency_ms"`
	State       string `json:"state"`
	ConnectedAt uint64 `json:"connected_at"`
}

type MeshStateData struct {
	RoomID string         `json:"room_id"`
	SelfID string         `json:"self_id"`
	Peers  []MeshPeerData `json:"peers"`
}

// --- Voice channel types ---

// Incoming: create_voice_channel
type CreateVoiceChannelData struct {
	RoomID string `json:"room_id"`
	Name   string `json:"name"`
}

// Incoming: join_voice
type JoinVoiceData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
}

// Incoming: leave_voice
type LeaveVoiceData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
}

// Incoming: voice_offer
type VoiceOfferData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	TargetID  string `json:"target_id"`
	SDP       string `json:"sdp"`
}

// Incoming: voice_answer
type VoiceAnswerData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	TargetID  string `json:"target_id"`
	SDP       string `json:"sdp"`
}

// Incoming: voice_ice
type VoiceIceData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	TargetID  string `json:"target_id"`
	Candidate string `json:"candidate"`
}

// Incoming: voice_speaking
type VoiceSpeakingData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	Speaking  bool   `json:"speaking"`
}

// Outgoing: voice_channel_created
type VoiceChannelCreatedData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	Name      string `json:"name"`
}

// Outgoing: voice_state (periodic + on join/leave)
type VoiceStateData struct {
	RoomID   string             `json:"room_id"`
	Channels []VoiceChannelInfo `json:"channels"`
}

type VoiceChannelInfo struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Members []VoiceMemberInfo `json:"members"`
}

type VoiceMemberInfo struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ShortID  string `json:"short_id"`
	Speaking bool   `json:"speaking"`
}

// Outgoing: voice_offer_relay
type VoiceOfferRelayData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	FromID    string `json:"from_id"`
	SDP       string `json:"sdp"`
}

// Outgoing: voice_answer_relay
type VoiceAnswerRelayData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	FromID    string `json:"from_id"`
	SDP       string `json:"sdp"`
}

// Outgoing: voice_ice_relay
type VoiceIceRelayData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	FromID    string `json:"from_id"`
	Candidate string `json:"candidate"`
}

// Outgoing: voice_peer_joined
type VoicePeerJoinedData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	PeerID    string `json:"peer_id"`
	Name      string `json:"name"`
}

// Outgoing: voice_peer_left
type VoicePeerLeftData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	PeerID    string `json:"peer_id"`
}

// Outgoing: voice_speaking_broadcast
type VoiceSpeakingBroadcastData struct {
	RoomID    string `json:"room_id"`
	ChannelID string `json:"channel_id"`
	PeerID    string `json:"peer_id"`
	Speaking  bool   `json:"speaking"`
}

// --- CoT (Cursor on Target) types ---

// Incoming: cot_position
type CotPositionData struct {
	RoomID  string  `json:"room_id"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Hae     float64 `json:"hae"`
	Ce      float64 `json:"ce"`
	CotType string  `json:"cot_type"`
}

// Outgoing: cot_state (periodic broadcast)
type CotStateData struct {
	RoomID   string       `json:"room_id"`
	SelfID   string       `json:"self_id"`
	Contacts []CotContact `json:"contacts"`
	Markers  []CotMarker  `json:"markers"`
}

type CotContact struct {
	UID      string  `json:"uid"`
	Callsign string  `json:"callsign"`
	ShortID  string  `json:"short_id"`
	CotType  string  `json:"cot_type"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Hae      float64 `json:"hae"`
	Ce       float64 `json:"ce"`
	Time     uint64  `json:"time"`
	Stale    uint64  `json:"stale"`
}

// --- Map marker types ---

type CotMarker struct {
	ID          string  `json:"id"`
	CreatorID   string  `json:"creator_id"`
	CreatorName string  `json:"creator_name"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	Hae         float64 `json:"hae"`
	Ce          float64 `json:"ce"`
	Le          float64 `json:"le"`
	Name        string  `json:"name"`
	Icon        string  `json:"icon"`
	Color       string  `json:"color"`
	CotType     string  `json:"cot_type"`
	How         string  `json:"how"`
	CreatedAt   uint64  `json:"created_at"`
	Stale       uint64  `json:"stale"`
	Remarks     string  `json:"remarks"`
}

// Incoming: create_marker
type CreateMarkerData struct {
	RoomID  string  `json:"room_id"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Name    string  `json:"name"`
	Icon    string  `json:"icon"`
	Color   string  `json:"color"`
	CotType string  `json:"cot_type"`
	Remarks string  `json:"remarks"`
}

// Incoming: delete_marker
type DeleteMarkerData struct {
	RoomID   string `json:"room_id"`
	MarkerID string `json:"marker_id"`
}

// Outgoing: marker_created
type MarkerCreatedData struct {
	RoomID string    `json:"room_id"`
	Marker CotMarker `json:"marker"`
}

// Outgoing: marker_deleted
type MarkerDeletedData struct {
	RoomID   string `json:"room_id"`
	MarkerID string `json:"marker_id"`
}
