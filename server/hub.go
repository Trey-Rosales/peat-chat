package main

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
)

// BlePeer represents a BLE-connected device reachable through a relay client.
type BlePeer struct {
	PeerID   string
	PeerName string
	Relay    *Client // the relay client that registered this peer
}

type Hub struct {
	rooms       map[[32]byte]*Room
	clients     map[*Client]bool
	clientsByID map[string]*Client  // identity.ID -> *Client for O(1) signaling relay
	blePeers    map[string]*BlePeer // peer_id -> BlePeer (BLE peers reachable via relay)
	register    chan *Client
	unregister  chan *Client
	mu          sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		rooms:       make(map[[32]byte]*Room),
		clients:     make(map[*Client]bool),
		clientsByID: make(map[string]*Client),
		blePeers:    make(map[string]*BlePeer),
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
			// Remove from all rooms BEFORE closing send channel
			// to prevent broadcast goroutines from sending on a closed channel
			h.removeFromAllRooms(client)
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				delete(h.clientsByID, client.identity.ID)
				close(client.send)
			}
			h.mu.Unlock()

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
				h.broadcastCotState(room)
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

	// Block non-participants from joining DM rooms
	room.mu.RLock()
	isDM := room.IsDM
	participants := room.DMParticipants
	room.mu.RUnlock()
	if isDM {
		if client.identity.ID != participants[0] && client.identity.ID != participants[1] {
			client.sendJSON("error", ErrorData{Message: "cannot join private conversation"})
			return
		}
	}

	room.AddMember(client)

	client.mu.Lock()
	client.rooms[room.ID] = true
	client.mu.Unlock()

	roomID := ChatIdHex(room.ID)

	client.sendJSON("room_joined", RoomJoinedData{
		RoomID:  roomID,
		Name:    room.Name,
		Members: room.MemberCount(),
		IsDM:    isDM,
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

	// Send current CoT positions and markers
	contacts := room.GetCotContacts(client)
	markers := room.GetMarkers()
	if len(contacts) > 0 || len(markers) > 0 {
		client.sendJSON("cot_state", CotStateData{
			RoomID:   roomID,
			SelfID:   client.identity.ID,
			Contacts: contacts,
			Markers:  markers,
		})
	}

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

func (h *Hub) BroadcastMessageFromRelay(relay *Client, room *Room, peerID, peerName, messageID, content string, replyTo *string) bool {
	h.mu.RLock()
	peer := h.resolveBlePeer(relay, peerID)
	h.mu.RUnlock()
	if peer == nil {
		return false
	}

	if messageID == "" {
		messageID = uuid.New().String()
	}
	msg := ChatMessage{
		ID:         messageID,
		Sender:     peer.PeerID,
		SenderName: peerName,
		Timestamp:  uint64(time.Now().UnixMilli()),
		Content:    content,
		ReplyTo:    replyTo,
	}
	if msg.SenderName == "" {
		msg.SenderName = peer.PeerName
	}

	room.AddMessage(msg)
	roomID := ChatIdHex(room.ID)
	data := mustMarshal("message", MessageData{
		RoomID:  roomID,
		Message: msg,
	})
	room.Broadcast(data, nil)
	return true
}

func (h *Hub) broadcastMeshState(room *Room) {
	h.mu.RLock()
	blePeers := h.getBlePeerMeshData()
	h.mu.RUnlock()

	members := room.GetMembers()
	roomID := ChatIdHex(room.ID)
	for _, c := range members {
		peers := room.GetMeshPeers(c)
		peers = append(peers, blePeers...)
		c.sendJSON("mesh_state", MeshStateData{
			RoomID: roomID,
			SelfID: c.identity.ID,
			Peers:  peers,
		})
	}
}

// broadcastMeshStateLocked is called when hub.mu.RLock is already held.
func (h *Hub) broadcastMeshStateLocked(room *Room) {
	blePeers := h.getBlePeerMeshData()

	members := room.GetMembers()
	roomID := ChatIdHex(room.ID)
	for _, c := range members {
		peers := room.GetMeshPeers(c)
		peers = append(peers, blePeers...)
		c.sendJSON("mesh_state", MeshStateData{
			RoomID: roomID,
			SelfID: c.identity.ID,
			Peers:  peers,
		})
	}
}

func (h *Hub) getBlePeerMeshData() []MeshPeerData {
	var peers []MeshPeerData
	for _, bp := range h.blePeers {
		peers = append(peers, MeshPeerData{
			ID:           bp.PeerID,
			Name:         bp.PeerName,
			ShortID:      bp.PeerID[:min(12, len(bp.PeerID))],
			Transport:    "btle",
			State:        "connected",
			ConnectedVia: bp.Relay.identity.ID,
		})
	}
	return peers
}

func (h *Hub) resolveBlePeer(relay *Client, peerID string) *BlePeer {
	if relay == nil || peerID == "" {
		return nil
	}
	peer := h.blePeers[peerID]
	if peer == nil || peer.Relay != relay {
		return nil
	}
	return peer
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// RegisterBlePeer makes a BLE peer visible to other clients via the relay.
func (h *Hub) RegisterBlePeer(relay *Client, peerID, peerName string) {
	h.mu.Lock()
	h.blePeers[peerID] = &BlePeer{
		PeerID:   peerID,
		PeerName: peerName,
		Relay:    relay,
	}
	// Also register in clientsByID so DMs can target this peer
	// DMs to this peer will be routed through the relay
	h.mu.Unlock()
	log.Printf("BLE peer registered: %s (%s) via %s", peerName, peerID[:min(12, len(peerID))], relay.name)

	// Broadcast updated mesh state
	relay.mu.RLock()
	for roomID := range relay.rooms {
		h.mu.RLock()
		if room, ok := h.rooms[roomID]; ok {
			h.broadcastMeshStateLocked(room)
		}
		h.mu.RUnlock()
	}
	relay.mu.RUnlock()
}

// UnregisterBlePeer removes a BLE peer.
func (h *Hub) UnregisterBlePeer(relay *Client, peerID string) {
	h.mu.Lock()
	peer := h.resolveBlePeer(relay, peerID)
	if peer != nil {
		delete(h.blePeers, peerID)
	}
	h.mu.Unlock()
	log.Printf("BLE peer unregistered: %s", peerID[:min(12, len(peerID))])

	if peer == nil {
		return
	}

	relay.mu.RLock()
	roomIDs := make([][32]byte, 0, len(relay.rooms))
	for roomID := range relay.rooms {
		roomIDs = append(roomIDs, roomID)
	}
	relay.mu.RUnlock()

	for _, roomID := range roomIDs {
		h.mu.RLock()
		room := h.rooms[roomID]
		h.mu.RUnlock()
		if room == nil {
			continue
		}
		for channelID := range room.VoiceChannels {
			room.LeaveBleVoiceChannel(channelID, peerID)
		}
		room.ClearBleCotPosition(peerID)
		h.broadcastVoiceState(room)
		h.broadcastCotState(room)
		h.broadcastMeshState(room)
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
				room.Broadcast(vcData, client)
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
	if room == nil || !room.HasMember(client) {
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
	if room == nil || !room.HasMember(client) {
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

func (h *Hub) JoinVoiceFromRelay(relay *Client, roomHexID, channelID, peerID, peerName string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(relay) {
		return
	}
	h.mu.RLock()
	peer := h.resolveBlePeer(relay, peerID)
	h.mu.RUnlock()
	if peer == nil {
		return
	}
	if peerName != "" {
		peer.PeerName = peerName
	}
	if !room.JoinBleVoiceChannel(channelID, peer) {
		return
	}

	roomID := ChatIdHex(room.ID)
	data := mustMarshal("voice_peer_joined", VoicePeerJoinedData{
		RoomID:    roomID,
		ChannelID: channelID,
		PeerID:    peer.PeerID,
		Name:      peer.PeerName,
	})
	members := room.GetVoiceChannelMembers(channelID)
	for _, m := range members {
		if m != relay {
			select {
			case m.send <- data:
			default:
			}
		}
	}

	h.broadcastVoiceState(room)
}

func (h *Hub) LeaveVoice(client *Client, roomHexID, channelID string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil {
		return
	}
	// Only leave if actually a member of this voice channel
	if !room.VoiceChannelHasMember(channelID, client) {
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

func (h *Hub) LeaveVoiceFromRelay(relay *Client, roomHexID, channelID, peerID string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.VoiceChannelHasBleMember(channelID, peerID) {
		return
	}
	room.LeaveBleVoiceChannel(channelID, peerID)

	data := mustMarshal("voice_peer_left", VoicePeerLeftData{
		RoomID:    roomHexID,
		ChannelID: channelID,
		PeerID:    peerID,
	})
	members := room.GetVoiceChannelMembers(channelID)
	for _, m := range members {
		if m != relay {
			select {
			case m.send <- data:
			default:
			}
		}
	}

	h.broadcastVoiceState(room)
}

func (h *Hub) RelayVoiceOffer(client *Client, roomHexID, channelID, targetID, sdp string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) || !room.VoiceChannelHasMember(channelID, client) {
		return
	}
	h.mu.RLock()
	target := h.clientsByID[targetID]
	h.mu.RUnlock()
	if target == nil || !room.VoiceChannelHasMember(channelID, target) {
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
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) || !room.VoiceChannelHasMember(channelID, client) {
		return
	}
	h.mu.RLock()
	target := h.clientsByID[targetID]
	h.mu.RUnlock()
	if target == nil || !room.VoiceChannelHasMember(channelID, target) {
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
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) || !room.VoiceChannelHasMember(channelID, client) {
		return
	}
	h.mu.RLock()
	target := h.clientsByID[targetID]
	h.mu.RUnlock()
	if target == nil || !room.VoiceChannelHasMember(channelID, target) {
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
	if room == nil || !room.HasMember(client) || !room.VoiceChannelHasMember(channelID, client) {
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

func (h *Hub) BroadcastVoiceSpeakingFromRelay(relay *Client, roomHexID, channelID, peerID string, speaking bool) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(relay) || !room.VoiceChannelHasBleMember(channelID, peerID) {
		return
	}
	room.SetBleSpeaking(channelID, peerID, speaking)

	data := mustMarshal("voice_speaking_broadcast", VoiceSpeakingBroadcastData{
		RoomID:    roomHexID,
		ChannelID: channelID,
		PeerID:    peerID,
		Speaking:  speaking,
	})
	members := room.GetVoiceChannelMembers(channelID)
	for _, m := range members {
		if m != relay {
			select {
			case m.send <- data:
			default:
			}
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

// --- CoT / map methods ---

// --- Message editing / deletion / reactions / pins ---

func (h *Hub) EditMessage(client *Client, roomHexID, messageID, content string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) {
		client.sendJSON("error", ErrorData{Message: "room not found"})
		return
	}
	editedAt, ok := room.EditMessage(messageID, client.identity.ID, content)
	if !ok {
		client.sendJSON("error", ErrorData{Message: "cannot edit message"})
		return
	}
	data := mustMarshal("message_edited", MessageEditedData{
		RoomID:    roomHexID,
		MessageID: messageID,
		Content:   content,
		EditedAt:  editedAt,
	})
	room.Broadcast(data, nil)
}

func (h *Hub) DeleteMessage(client *Client, roomHexID, messageID string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) {
		client.sendJSON("error", ErrorData{Message: "room not found"})
		return
	}
	if !room.DeleteMessage(messageID, client.identity.ID) {
		client.sendJSON("error", ErrorData{Message: "cannot delete message"})
		return
	}
	data := mustMarshal("message_deleted", MessageDeletedData{
		RoomID:    roomHexID,
		MessageID: messageID,
	})
	room.Broadcast(data, nil)
}

func (h *Hub) AddReaction(client *Client, roomHexID, messageID, emoji string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) {
		return
	}
	reactions, ok := room.AddReaction(messageID, client.identity.ID, emoji)
	if !ok {
		return
	}
	data := mustMarshal("reaction_updated", ReactionUpdatedData{
		RoomID:    roomHexID,
		MessageID: messageID,
		Reactions: reactions,
	})
	room.Broadcast(data, nil)
}

func (h *Hub) RemoveReaction(client *Client, roomHexID, messageID, emoji string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) {
		return
	}
	reactions, ok := room.RemoveReaction(messageID, client.identity.ID, emoji)
	if !ok {
		return
	}
	data := mustMarshal("reaction_updated", ReactionUpdatedData{
		RoomID:    roomHexID,
		MessageID: messageID,
		Reactions: reactions,
	})
	room.Broadcast(data, nil)
}

func (h *Hub) PinMessage(client *Client, roomHexID, messageID string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) {
		return
	}
	if !room.PinMessage(messageID) {
		return
	}
	data := mustMarshal("message_pinned", MessagePinnedData{
		RoomID:    roomHexID,
		MessageID: messageID,
	})
	room.Broadcast(data, nil)
}

func (h *Hub) UnpinMessage(client *Client, roomHexID, messageID string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) {
		return
	}
	if !room.UnpinMessage(messageID) {
		return
	}
	data := mustMarshal("message_unpinned", MessageUnpinnedData{
		RoomID:    roomHexID,
		MessageID: messageID,
	})
	room.Broadcast(data, nil)
}

// --- Direct Messages ---

func (h *Hub) StartDM(client *Client, targetID string) {
	h.mu.RLock()
	target := h.clientsByID[targetID]
	h.mu.RUnlock()
	if target == nil {
		client.sendJSON("error", ErrorData{Message: "user not found"})
		return
	}

	id1, id2 := client.identity.ID, target.identity.ID

	// Check if a DM room already exists between these two participants
	room := h.findExistingDM(id1, id2)

	if room == nil {
		// Create with opaque UUID name — not guessable from peer IDs
		dmName := "dm:" + uuid.New().String()
		room = h.getOrCreateRoom(dmName)
		room.mu.Lock()
		room.IsDM = true
		if id1 < id2 {
			room.DMParticipants = [2]string{id1, id2}
		} else {
			room.DMParticipants = [2]string{id2, id1}
		}
		room.mu.Unlock()
	}

	// Join both participants if not already in the room
	if !room.HasMember(client) {
		room.AddMember(client)
		client.mu.Lock()
		client.rooms[room.ID] = true
		client.mu.Unlock()
	}
	if !room.HasMember(target) {
		room.AddMember(target)
		target.mu.Lock()
		target.rooms[room.ID] = true
		target.mu.Unlock()
	}

	roomID := ChatIdHex(room.ID)

	target.mu.RLock()
	targetName := target.name
	target.mu.RUnlock()

	client.mu.RLock()
	clientName := client.name
	client.mu.RUnlock()

	// Send dm_opened to initiator
	client.sendJSON("dm_opened", DMOpenedData{
		RoomID:   roomID,
		Name:     targetName,
		PeerID:   target.identity.ID,
		PeerName: targetName,
	})

	// Send room_joined + history to initiator
	client.sendJSON("room_joined", RoomJoinedData{
		RoomID:  roomID,
		Name:    targetName,
		Members: room.MemberCount(),
		IsDM:    true,
	})
	client.sendJSON("room_history", RoomHistoryData{
		RoomID:   roomID,
		Messages: room.GetHistory(),
	})

	// Send dm_opened to target
	target.sendJSON("dm_opened", DMOpenedData{
		RoomID:   roomID,
		Name:     clientName,
		PeerID:   client.identity.ID,
		PeerName: clientName,
	})

	// Send room_joined + history to target
	target.sendJSON("room_joined", RoomJoinedData{
		RoomID:  roomID,
		Name:    clientName,
		Members: room.MemberCount(),
		IsDM:    true,
	})
	target.sendJSON("room_history", RoomHistoryData{
		RoomID:   roomID,
		Messages: room.GetHistory(),
	})
}

// findExistingDM looks for an existing DM room between two peer IDs.
func (h *Hub) findExistingDM(id1, id2 string) *Room {
	// Normalize participant order for comparison
	if id1 > id2 {
		id1, id2 = id2, id1
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, room := range h.rooms {
		room.mu.RLock()
		isDM := room.IsDM
		p := room.DMParticipants
		room.mu.RUnlock()
		if isDM && p[0] == id1 && p[1] == id2 {
			return room
		}
	}
	return nil
}

// JoinDM allows a participant to rejoin their DM room by hex room ID (used on reconnect).
func (h *Hub) JoinDM(client *Client, roomHexID string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil {
		client.sendJSON("error", ErrorData{Message: "DM room not found"})
		return
	}

	room.mu.RLock()
	isDM := room.IsDM
	participants := room.DMParticipants
	room.mu.RUnlock()

	if !isDM {
		client.sendJSON("error", ErrorData{Message: "not a DM room"})
		return
	}
	if client.identity.ID != participants[0] && client.identity.ID != participants[1] {
		client.sendJSON("error", ErrorData{Message: "cannot join private conversation"})
		return
	}

	if !room.HasMember(client) {
		room.AddMember(client)
		client.mu.Lock()
		client.rooms[room.ID] = true
		client.mu.Unlock()
	}

	roomID := ChatIdHex(room.ID)

	// Determine peer name for the DM display
	var peerName string
	members := room.GetMembers()
	for _, m := range members {
		if m.identity.ID != client.identity.ID {
			m.mu.RLock()
			peerName = m.name
			m.mu.RUnlock()
			break
		}
	}
	if peerName == "" {
		peerName = "DM"
	}

	client.sendJSON("room_joined", RoomJoinedData{
		RoomID:  roomID,
		Name:    peerName,
		Members: room.MemberCount(),
		IsDM:    true,
	})
	client.sendJSON("room_history", RoomHistoryData{
		RoomID:   roomID,
		Messages: room.GetHistory(),
	})
}

func (h *Hub) broadcastCotState(room *Room) {
	members := room.GetMembers()
	roomID := ChatIdHex(room.ID)
	markers := room.GetMarkers()

	for _, c := range members {
		contacts := room.GetCotContacts(c)
		c.sendJSON("cot_state", CotStateData{
			RoomID:   roomID,
			SelfID:   c.identity.ID,
			Contacts: contacts,
			Markers:  markers,
		})
	}
}

func (h *Hub) CreateMapMarker(client *Client, roomHexID string, d CreateMarkerData) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) {
		client.sendJSON("error", ErrorData{Message: "room not found"})
		return
	}

	client.mu.RLock()
	name := client.name
	client.mu.RUnlock()

	cotType := d.CotType
	if cotType == "" {
		switch d.Icon {
		case "rally":
			cotType = "b-m-p-s-m"
		case "objective":
			cotType = "b-m-p-s-p-i"
		case "hazard":
			cotType = "b-m-p-s-m"
		case "waypoint":
			cotType = "b-m-p-w"
		case "info":
			cotType = "b-m-p-s-p-i"
		default:
			cotType = "b-m-p-s-m"
		}
	}

	createdAt := uint64(time.Now().UnixMilli())

	marker := &CotMarker{
		ID:          uuid.New().String(),
		CreatorID:   client.identity.ID,
		CreatorName: name,
		Lat:         d.Lat,
		Lon:         d.Lon,
		Hae:         0,
		Ce:          999999,
		Le:          999999,
		Name:        d.Name,
		Icon:        d.Icon,
		Color:       d.Color,
		CotType:     cotType,
		How:         "h-e",
		CreatedAt:   createdAt,
		Stale:       createdAt + 86400000,
		Remarks:     d.Remarks,
	}

	room.AddMarker(marker)

	data := mustMarshal("marker_created", MarkerCreatedData{
		RoomID: roomHexID,
		Marker: *marker,
	})
	room.Broadcast(data, nil)
}

func (h *Hub) CreateMapMarkerFromRelay(relay *Client, roomHexID string, d CreateMarkerData) bool {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(relay) || d.SenderID == "" {
		return false
	}

	cotType := d.CotType
	if cotType == "" {
		switch d.Icon {
		case "rally":
			cotType = "b-m-p-s-m"
		case "objective":
			cotType = "b-m-p-s-p-i"
		case "hazard":
			cotType = "b-m-p-s-m"
		case "waypoint":
			cotType = "b-m-p-w"
		case "info":
			cotType = "b-m-p-s-p-i"
		default:
			cotType = "b-m-p-s-m"
		}
	}

	createdAt := uint64(time.Now().UnixMilli())
	creatorName := d.SenderName
	if creatorName == "" {
		creatorName = "BLE Peer"
	}
	marker := &CotMarker{
		ID:          uuid.New().String(),
		CreatorID:   d.SenderID,
		CreatorName: creatorName,
		Lat:         d.Lat,
		Lon:         d.Lon,
		Hae:         0,
		Ce:          999999,
		Le:          999999,
		Name:        d.Name,
		Icon:        d.Icon,
		Color:       d.Color,
		CotType:     cotType,
		How:         "h-e",
		CreatedAt:   createdAt,
		Stale:       createdAt + 86400000,
		Remarks:     d.Remarks,
	}

	room.AddMarker(marker)
	data := mustMarshal("marker_created", MarkerCreatedData{
		RoomID: roomHexID,
		Marker: *marker,
	})
	room.Broadcast(data, nil)
	return true
}

func (h *Hub) DeleteMapMarker(client *Client, roomHexID string, markerID string) {
	room := h.getRoomByHex(roomHexID)
	if room == nil || !room.HasMember(client) {
		return
	}

	// Only the creator can delete (check before removing)
	room.mu.RLock()
	marker, exists := room.Markers[markerID]
	room.mu.RUnlock()
	if !exists {
		return
	}
	if marker.CreatorID != client.identity.ID {
		client.sendJSON("error", ErrorData{Message: "only the marker creator can delete it"})
		return
	}

	if room.DeleteMarker(markerID) {
		data := mustMarshal("marker_deleted", MarkerDeletedData{
			RoomID:   roomHexID,
			MarkerID: markerID,
		})
		room.Broadcast(data, nil)
	}
}

func mustMarshal(msgType string, data any) []byte {
	d, _ := json.Marshal(data)
	out, _ := json.Marshal(WSMessage{Type: msgType, Data: d})
	return out
}
