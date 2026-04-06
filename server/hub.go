package main

import (
	"encoding/json"
	"log"
	"sync"
	"time"
)

type Hub struct {
	rooms       map[[32]byte]*Room
	clients     map[*Client]bool
	clientsByID map[string]*Client // identity.ID -> *Client for O(1) signaling relay
	register    chan *Client
	unregister  chan *Client
	mu          sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		rooms:       make(map[[32]byte]*Room),
		clients:     make(map[*Client]bool),
		clientsByID: make(map[string]*Client),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
	}
}

func (h *Hub) Run() {
	meshTicker := time.NewTicker(5 * time.Second)
	defer meshTicker.Stop()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.clientsByID[client.identity.ID] = client
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				delete(h.clientsByID, client.identity.ID)
				close(client.send)
			}
			h.mu.Unlock()
			h.removeFromAllRooms(client)

		case <-meshTicker.C:
			h.mu.RLock()
			rooms := make([]*Room, 0, len(h.rooms))
			for _, room := range h.rooms {
				rooms = append(rooms, room)
			}
			h.mu.RUnlock()
			for _, room := range rooms {
				h.broadcastMeshState(room)
				h.broadcastVoiceState(room)
			}
		}
	}
}

func (h *Hub) getOrCreateRoom(name string) *Room {
	id := ChatIdFromName(name)
	h.mu.Lock()
	defer h.mu.Unlock()
	if room, ok := h.rooms[id]; ok {
		return room
	}
	room := NewRoom(name)
	h.rooms[id] = room
	log.Printf("created room: %s (%s)", name, ChatIdShort(id))
	return room
}

func (h *Hub) getRoomByHex(hexID string) *Room {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for id, room := range h.rooms {
		if ChatIdHex(id) == hexID || ChatIdShort(id) == hexID {
			return room
		}
	}
	return nil
}

func (h *Hub) JoinRoom(client *Client, roomName string) {
	room := h.getOrCreateRoom(roomName)
	room.AddMember(client)

	client.mu.Lock()
	client.rooms[room.ID] = true
	client.mu.Unlock()

	roomID := ChatIdHex(room.ID)

	client.sendJSON("room_joined", RoomJoinedData{
		RoomID:  roomID,
		Name:    room.Name,
		Members: room.MemberCount(),
	})

	client.sendJSON("room_history", RoomHistoryData{
		RoomID:   roomID,
		Messages: room.GetHistory(),
	})

	// Send current voice channel state
	client.sendJSON("voice_state", VoiceStateData{
		RoomID:   roomID,
		Channels: room.GetVoiceState(),
	})

	data := mustMarshal("peer_update", PeerUpdateData{
		RoomID:  roomID,
		PeerID:  client.identity.ID,
		Name:    client.name,
		Event:   "joined",
		Members: room.MemberCount(),
	})
	room.Broadcast(data, client)

	h.broadcastMeshState(room)
}

func (h *Hub) LeaveRoom(client *Client, room *Room) {
	room.RemoveMember(client)

	client.mu.Lock()
	delete(client.rooms, room.ID)
	client.mu.Unlock()

	roomID := ChatIdHex(room.ID)
	data := mustMarshal("peer_update", PeerUpdateData{
		RoomID:  roomID,
		PeerID:  client.identity.ID,
		Name:    client.name,
		Event:   "left",
		Members: room.MemberCount(),
	})
	room.Broadcast(data, nil)

	h.broadcastMeshState(room)
}

func (h *Hub) BroadcastMessage(client *Client, room *Room, msg ChatMessage) {
	room.AddMessage(msg)
	roomID := ChatIdHex(room.ID)
	data := mustMarshal("message", MessageData{
		RoomID:  roomID,
		Message: msg,
	})
	room.Broadcast(data, nil)
}

func (h *Hub) broadcastMeshState(room *Room) {
	members := room.GetMembers()
	roomID := ChatIdHex(room.ID)
	for _, c := range members {
		peers := room.GetMeshPeers(c)
		c.sendJSON("mesh_state", MeshStateData{
			RoomID: roomID,
			SelfID: c.identity.ID,
			Peers:  peers,
		})
	}
}

// broadcastMeshStateLocked is called when hub.mu.RLock is already held.
func (h *Hub) broadcastMeshStateLocked(room *Room) {
	members := room.GetMembers()
	roomID := ChatIdHex(room.ID)
	for _, c := range members {
		peers := room.GetMeshPeers(c)
		c.sendJSON("mesh_state", MeshStateData{
			RoomID: roomID,
			SelfID: c.identity.ID,
			Peers:  peers,
		})
	}
}

func (h *Hub) removeFromAllRooms(client *Client) {
	client.mu.RLock()
	roomIDs := make([][32]byte, 0, len(client.rooms))
	for id := range client.rooms {
		roomIDs = append(roomIDs, id)
	}
	client.mu.RUnlock()

	h.mu.RLock()
	for _, id := range roomIDs {
		if room, ok := h.rooms[id]; ok {
			h.mu.RUnlock()
			// Leave all voice channels in this room first
			leftChannels := room.LeaveAllVoiceChannels(client)
			roomID := ChatIdHex(room.ID)
			for _, channelID := range leftChannels {
				vcData := mustMarshal("voice_peer_left", VoicePeerLeftData{
					RoomID:    roomID,
					ChannelID: channelID,
					PeerID:    client.identity.ID,
				})
				room.Broadcast(vcData, nil)
			}
			if len(leftChannels) > 0 {
				h.broadcastVoiceState(room)
			}
			h.LeaveRoom(client, room)
			h.mu.RLock()
		}
	}
	h.mu.RUnlock()
}

// --- Voice channel methods ---

func (h *Hub) CreateVoiceChannel(client *Client, roomHexID string, name string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil {
		client.sendJSON("error", ErrorData{Message: "room not found"})
		return
	}
	vc := room.CreateVoiceChannel(name)
	roomID := ChatIdHex(room.ID)

	data := mustMarshal("voice_channel_created", VoiceChannelCreatedData{
		RoomID:    roomID,
		ChannelID: vc.ID,
		Name:      vc.Name,
	})
	room.Broadcast(data, nil)
	h.broadcastVoiceState(room)
}

func (h *Hub) JoinVoice(client *Client, roomHexID, channelID string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil {
		client.sendJSON("error", ErrorData{Message: "room not found"})
		return
	}
	if !room.JoinVoiceChannel(channelID, client) {
		client.sendJSON("error", ErrorData{Message: "voice channel not found"})
		return
	}

	roomID := ChatIdHex(room.ID)
	client.mu.RLock()
	name := client.name
	client.mu.RUnlock()

	// Notify existing voice members that a new peer joined
	data := mustMarshal("voice_peer_joined", VoicePeerJoinedData{
		RoomID:    roomID,
		ChannelID: channelID,
		PeerID:    client.identity.ID,
		Name:      name,
	})
	// Broadcast to all voice channel members except the joiner
	members := room.GetVoiceChannelMembers(channelID)
	for _, m := range members {
		if m != client {
			select {
			case m.send <- data:
			default:
			}
		}
	}

	// Broadcast updated voice state to all room members
	h.broadcastVoiceState(room)
}

func (h *Hub) LeaveVoice(client *Client, roomHexID, channelID string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil {
		return
	}
	room.LeaveVoiceChannel(channelID, client)
	roomID := ChatIdHex(room.ID)

	data := mustMarshal("voice_peer_left", VoicePeerLeftData{
		RoomID:    roomID,
		ChannelID: channelID,
		PeerID:    client.identity.ID,
	})
	// Notify remaining voice channel members
	members := room.GetVoiceChannelMembers(channelID)
	for _, m := range members {
		select {
		case m.send <- data:
		default:
		}
	}

	h.broadcastVoiceState(room)
}

func (h *Hub) RelayVoiceOffer(client *Client, roomHexID, channelID, targetID, sdp string) {
	h.mu.RLock()
	target := h.clientsByID[targetID]
	h.mu.RUnlock()
	if target == nil {
		return
	}
	target.sendJSON("voice_offer_relay", VoiceOfferRelayData{
		RoomID:    roomHexID,
		ChannelID: channelID,
		FromID:    client.identity.ID,
		SDP:       sdp,
	})
}

func (h *Hub) RelayVoiceAnswer(client *Client, roomHexID, channelID, targetID, sdp string) {
	h.mu.RLock()
	target := h.clientsByID[targetID]
	h.mu.RUnlock()
	if target == nil {
		return
	}
	target.sendJSON("voice_answer_relay", VoiceAnswerRelayData{
		RoomID:    roomHexID,
		ChannelID: channelID,
		FromID:    client.identity.ID,
		SDP:       sdp,
	})
}

func (h *Hub) RelayVoiceIce(client *Client, roomHexID, channelID, targetID, candidate string) {
	h.mu.RLock()
	target := h.clientsByID[targetID]
	h.mu.RUnlock()
	if target == nil {
		return
	}
	target.sendJSON("voice_ice_relay", VoiceIceRelayData{
		RoomID:    roomHexID,
		ChannelID: channelID,
		FromID:    client.identity.ID,
		Candidate: candidate,
	})
}

func (h *Hub) BroadcastVoiceSpeaking(client *Client, roomHexID, channelID string, speaking bool) {
	room := h.getRoomByHex(roomHexID)
	if room == nil {
		return
	}
	room.SetSpeaking(channelID, client, speaking)

	data := mustMarshal("voice_speaking_broadcast", VoiceSpeakingBroadcastData{
		RoomID:    roomHexID,
		ChannelID: channelID,
		PeerID:    client.identity.ID,
		Speaking:  speaking,
	})
	// Broadcast to all voice channel members
	members := room.GetVoiceChannelMembers(channelID)
	for _, m := range members {
		select {
		case m.send <- data:
		default:
		}
	}
}

func (h *Hub) broadcastVoiceState(room *Room) {
	members := room.GetMembers()
	roomID := ChatIdHex(room.ID)
	voiceState := room.GetVoiceState()
	for _, c := range members {
		c.sendJSON("voice_state", VoiceStateData{
			RoomID:   roomID,
			Channels: voiceState,
		})
	}
}

func mustMarshal(msgType string, data any) []byte {
	d, _ := json.Marshal(data)
	out, _ := json.Marshal(WSMessage{Type: msgType, Data: d})
	return out
}
