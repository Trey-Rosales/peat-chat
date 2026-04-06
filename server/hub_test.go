package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestNewHub(t *testing.T) {
	hub := NewHub()

	if hub.rooms == nil {
		t.Fatal("rooms should be initialized")
	}
	if hub.clients == nil {
		t.Fatal("clients should be initialized")
	}
	if hub.clientsByID == nil {
		t.Fatal("clientsByID should be initialized")
	}
}

func TestHub_GetOrCreateRoom(t *testing.T) {
	hub := NewHub()

	room1 := hub.getOrCreateRoom("general")
	if room1 == nil {
		t.Fatal("getOrCreateRoom should return a room")
	}
	if room1.Name != "general" {
		t.Fatalf("expected 'general', got '%s'", room1.Name)
	}

	// Same name returns same room
	room2 := hub.getOrCreateRoom("general")
	if room1 != room2 {
		t.Fatal("same name should return same room pointer")
	}

	// Different name returns different room
	room3 := hub.getOrCreateRoom("random")
	if room1 == room3 {
		t.Fatal("different name should return different room")
	}
}

func TestHub_GetRoomByHex(t *testing.T) {
	hub := NewHub()
	room := hub.getOrCreateRoom("test-room")

	hexID := ChatIdHex(room.ID)
	found := hub.getRoomByHex(hexID)
	if found != room {
		t.Fatal("should find room by full hex ID")
	}

	shortID := ChatIdShort(room.ID)
	found = hub.getRoomByHex(shortID)
	if found != room {
		t.Fatal("should find room by short hex ID")
	}

	found = hub.getRoomByHex("nonexistent")
	if found != nil {
		t.Fatal("should return nil for unknown ID")
	}
}

func TestHub_RegisterUnregister(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	client := newTestClient(hub, "Alice")

	hub.register <- client
	time.Sleep(50 * time.Millisecond) // let hub process

	hub.mu.RLock()
	_, exists := hub.clients[client]
	_, byIDExists := hub.clientsByID[client.identity.ID]
	hub.mu.RUnlock()

	if !exists {
		t.Fatal("client should be registered")
	}
	if !byIDExists {
		t.Fatal("client should be in clientsByID")
	}

	hub.unregister <- client
	time.Sleep(50 * time.Millisecond)

	hub.mu.RLock()
	_, exists = hub.clients[client]
	_, byIDExists = hub.clientsByID[client.identity.ID]
	hub.mu.RUnlock()

	if exists {
		t.Fatal("client should be unregistered")
	}
	if byIDExists {
		t.Fatal("client should be removed from clientsByID")
	}
}

func TestHub_JoinRoom(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	client := newTestClient(hub, "Alice")
	hub.register <- client
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(client, "general")

	// Should receive room_joined, room_history, voice_state
	messages := drainClientSend(client, 3)

	types := make(map[string]bool)
	for _, msg := range messages {
		types[msg.Type] = true
	}

	if !types["room_joined"] {
		t.Fatal("should receive room_joined")
	}
	if !types["room_history"] {
		t.Fatal("should receive room_history")
	}
	if !types["voice_state"] {
		t.Fatal("should receive voice_state")
	}
}

func TestHub_JoinRoom_VoiceStateContainsDefault(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	client := newTestClient(hub, "Alice")
	hub.register <- client
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(client, "general")

	messages := drainClientSend(client, 5)

	for _, msg := range messages {
		if msg.Type == "voice_state" {
			var state VoiceStateData
			if err := json.Unmarshal(msg.Data, &state); err != nil {
				t.Fatalf("failed to unmarshal voice_state: %v", err)
			}
			if len(state.Channels) != 1 {
				t.Fatalf("expected 1 voice channel, got %d", len(state.Channels))
			}
			if state.Channels[0].Name != "General" {
				t.Fatalf("expected 'General', got '%s'", state.Channels[0].Name)
			}
			return
		}
	}
	t.Fatal("voice_state message not found")
}

func TestHub_CreateVoiceChannel(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	client := newTestClient(hub, "Alice")
	hub.register <- client
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(client, "general")
	drainClientSend(client, 10) // clear join messages

	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)

	hub.CreateVoiceChannel(client, roomHex, "Tactical")

	messages := drainClientSend(client, 5)

	var foundCreated, foundState bool
	for _, msg := range messages {
		if msg.Type == "voice_channel_created" {
			foundCreated = true
			var data VoiceChannelCreatedData
			json.Unmarshal(msg.Data, &data)
			if data.Name != "Tactical" {
				t.Fatalf("expected 'Tactical', got '%s'", data.Name)
			}
		}
		if msg.Type == "voice_state" {
			foundState = true
			var data VoiceStateData
			json.Unmarshal(msg.Data, &data)
			if len(data.Channels) != 2 {
				t.Fatalf("expected 2 voice channels, got %d", len(data.Channels))
			}
		}
	}

	if !foundCreated {
		t.Fatal("should receive voice_channel_created")
	}
	if !foundState {
		t.Fatal("should receive updated voice_state")
	}
}

func TestHub_JoinLeaveVoice(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(c1, "general")
	hub.JoinRoom(c2, "general")
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)

	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
	}

	// Alice joins voice
	hub.JoinVoice(c1, roomHex, vcID)
	drainClientSend(c1, 5)
	drainClientSend(c2, 5)

	// Bob joins voice -- should get voice_peer_joined for Bob on Alice's side
	hub.JoinVoice(c2, roomHex, vcID)

	aliceMessages := drainClientSend(c1, 5)
	var gotPeerJoined bool
	for _, msg := range aliceMessages {
		if msg.Type == "voice_peer_joined" {
			gotPeerJoined = true
			var data VoicePeerJoinedData
			json.Unmarshal(msg.Data, &data)
			if data.Name != "Bob" {
				t.Fatalf("expected peer 'Bob', got '%s'", data.Name)
			}
		}
	}
	if !gotPeerJoined {
		t.Fatal("Alice should receive voice_peer_joined for Bob")
	}

	// Bob leaves voice
	hub.LeaveVoice(c2, roomHex, vcID)

	aliceMessages = drainClientSend(c1, 5)
	var gotPeerLeft bool
	for _, msg := range aliceMessages {
		if msg.Type == "voice_peer_left" {
			gotPeerLeft = true
			var data VoicePeerLeftData
			json.Unmarshal(msg.Data, &data)
			if data.PeerID != c2.identity.ID {
				t.Fatal("peer_id should match Bob's identity")
			}
		}
	}
	if !gotPeerLeft {
		t.Fatal("Alice should receive voice_peer_left for Bob")
	}
}

func TestHub_VoiceSignalingRelay(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(c1, "general")
	hub.JoinRoom(c2, "general")
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)

	// Relay offer from Alice to Bob
	hub.RelayVoiceOffer(c1, roomHex, "vc1", c2.identity.ID, `{"type":"offer","sdp":"test-sdp"}`)

	bobMessages := drainClientSend(c2, 3)
	var gotOffer bool
	for _, msg := range bobMessages {
		if msg.Type == "voice_offer_relay" {
			gotOffer = true
			var data VoiceOfferRelayData
			json.Unmarshal(msg.Data, &data)
			if data.FromID != c1.identity.ID {
				t.Fatal("from_id should match Alice's identity")
			}
			if data.SDP != `{"type":"offer","sdp":"test-sdp"}` {
				t.Fatal("SDP should be forwarded as-is")
			}
		}
	}
	if !gotOffer {
		t.Fatal("Bob should receive voice_offer_relay")
	}

	// Relay answer from Bob to Alice
	hub.RelayVoiceAnswer(c2, roomHex, "vc1", c1.identity.ID, `{"type":"answer","sdp":"test-answer"}`)

	aliceMessages := drainClientSend(c1, 3)
	var gotAnswer bool
	for _, msg := range aliceMessages {
		if msg.Type == "voice_answer_relay" {
			gotAnswer = true
			var data VoiceAnswerRelayData
			json.Unmarshal(msg.Data, &data)
			if data.FromID != c2.identity.ID {
				t.Fatal("from_id should match Bob's identity")
			}
		}
	}
	if !gotAnswer {
		t.Fatal("Alice should receive voice_answer_relay")
	}

	// Relay ICE
	hub.RelayVoiceIce(c1, roomHex, "vc1", c2.identity.ID, `{"candidate":"test-ice"}`)

	bobMessages = drainClientSend(c2, 3)
	var gotIce bool
	for _, msg := range bobMessages {
		if msg.Type == "voice_ice_relay" {
			gotIce = true
			var data VoiceIceRelayData
			json.Unmarshal(msg.Data, &data)
			if data.Candidate != `{"candidate":"test-ice"}` {
				t.Fatal("candidate should be forwarded as-is")
			}
		}
	}
	if !gotIce {
		t.Fatal("Bob should receive voice_ice_relay")
	}
}

func TestHub_BroadcastVoiceSpeaking(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(c1, "general")
	hub.JoinRoom(c2, "general")
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)

	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
	}

	hub.JoinVoice(c1, roomHex, vcID)
	hub.JoinVoice(c2, roomHex, vcID)
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	hub.BroadcastVoiceSpeaking(c1, roomHex, vcID, true)

	// Both should receive speaking broadcast
	c1Msgs := drainClientSend(c1, 3)
	c2Msgs := drainClientSend(c2, 3)

	allMsgs := append(c1Msgs, c2Msgs...)
	var gotSpeaking bool
	for _, msg := range allMsgs {
		if msg.Type == "voice_speaking_broadcast" {
			gotSpeaking = true
			var data VoiceSpeakingBroadcastData
			json.Unmarshal(msg.Data, &data)
			if data.PeerID != c1.identity.ID {
				t.Fatal("peer_id should be Alice's ID")
			}
			if !data.Speaking {
				t.Fatal("speaking should be true")
			}
		}
	}
	if !gotSpeaking {
		t.Fatal("should receive voice_speaking_broadcast")
	}
}

func TestHub_RelayToNonexistentPeer(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	hub.register <- c1
	time.Sleep(50 * time.Millisecond)

	// Should not panic when relaying to nonexistent peer
	hub.RelayVoiceOffer(c1, "room-hex", "vc1", "nonexistent-peer", "sdp")
	hub.RelayVoiceAnswer(c1, "room-hex", "vc1", "nonexistent-peer", "sdp")
	hub.RelayVoiceIce(c1, "room-hex", "vc1", "nonexistent-peer", "candidate")
	// If we get here without panic, test passes
}

// drainClientSend collects up to n messages from the client's send channel
// with a short timeout per message.
func drainClientSend(client *Client, n int) []WSMessage {
	var messages []WSMessage
	for i := 0; i < n; i++ {
		select {
		case raw := <-client.send:
			var msg WSMessage
			if json.Unmarshal(raw, &msg) == nil {
				messages = append(messages, msg)
			}
		case <-time.After(100 * time.Millisecond):
			return messages
		}
	}
	return messages
}

// --- CoT / marker hub tests ---

func TestHub_CotBroadcast(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	// Set position on c1 before joining
	c1.mu.Lock()
	c1.cotLat = 38.8977
	c1.cotLon = -77.0365
	c1.cotCe = 10.0
	c1.cotType = "a-f-G-U-C"
	c1.cotTime = time.Now()
	c1.mu.Unlock()

	hub.JoinRoom(c1, "general")
	hub.JoinRoom(c2, "general")

	// Drain join messages from both clients
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	// Set position on c2 as well
	c2.mu.Lock()
	c2.cotLat = 40.7128
	c2.cotLon = -74.0060
	c2.cotCe = 5.0
	c2.cotType = "a-f-G-U-C"
	c2.cotTime = time.Now()
	c2.mu.Unlock()

	// Manually trigger a CoT state broadcast
	room := hub.getOrCreateRoom("general")
	hub.broadcastCotState(room)

	// c1 should receive cot_state with c2's contact
	c1Msgs := drainClientSend(c1, 5)
	var foundCotState bool
	for _, msg := range c1Msgs {
		if msg.Type == "cot_state" {
			foundCotState = true
			var data CotStateData
			if err := json.Unmarshal(msg.Data, &data); err != nil {
				t.Fatalf("failed to unmarshal cot_state: %v", err)
			}
			if len(data.Contacts) != 1 {
				t.Fatalf("expected 1 contact for c1, got %d", len(data.Contacts))
			}
			if data.Contacts[0].Callsign != "Bob" {
				t.Fatalf("expected contact 'Bob', got '%s'", data.Contacts[0].Callsign)
			}
		}
	}
	if !foundCotState {
		t.Fatal("c1 should receive cot_state")
	}
}

func TestHub_CreateMarker(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(c1, "general")
	hub.JoinRoom(c2, "general")
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)

	hub.CreateMapMarker(c1, roomHex, CreateMarkerData{
		RoomID: roomHex,
		Lat:    38.8977,
		Lon:    -77.0365,
		Name:   "HQ",
		Icon:   "pin",
		Color:  "#ff0000",
	})

	// Both clients should receive marker_created (broadcast to all, nil exclude)
	c1Msgs := drainClientSend(c1, 5)
	c2Msgs := drainClientSend(c2, 5)

	allMsgs := append(c1Msgs, c2Msgs...)
	var foundCreated bool
	for _, msg := range allMsgs {
		if msg.Type == "marker_created" {
			foundCreated = true
			var data MarkerCreatedData
			json.Unmarshal(msg.Data, &data)
			if data.Marker.Name != "HQ" {
				t.Fatalf("expected marker name 'HQ', got '%s'", data.Marker.Name)
			}
			if data.Marker.CreatorID != c1.identity.ID {
				t.Fatal("marker creator_id should match Alice's identity")
			}
			if data.Marker.CreatorName != "Alice" {
				t.Fatalf("expected creator name 'Alice', got '%s'", data.Marker.CreatorName)
			}
		}
	}
	if !foundCreated {
		t.Fatal("should receive marker_created broadcast")
	}

	// Verify marker is stored in the room
	markers := room.GetMarkers()
	if len(markers) != 1 {
		t.Fatalf("expected 1 marker in room, got %d", len(markers))
	}
}

func TestHub_DeleteMarker(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(c1, "general")
	hub.JoinRoom(c2, "general")
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)

	// Create a marker as Alice
	hub.CreateMapMarker(c1, roomHex, CreateMarkerData{
		RoomID: roomHex,
		Lat:    38.8977,
		Lon:    -77.0365,
		Name:   "HQ",
		Icon:   "pin",
		Color:  "#ff0000",
	})
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	// Get the marker ID
	markers := room.GetMarkers()
	if len(markers) != 1 {
		t.Fatalf("expected 1 marker, got %d", len(markers))
	}
	markerID := markers[0].ID

	// Alice deletes her own marker
	hub.DeleteMapMarker(c1, roomHex, markerID)

	// Should receive marker_deleted broadcast
	c1Msgs := drainClientSend(c1, 5)
	c2Msgs := drainClientSend(c2, 5)

	allMsgs := append(c1Msgs, c2Msgs...)
	var foundDeleted bool
	for _, msg := range allMsgs {
		if msg.Type == "marker_deleted" {
			foundDeleted = true
			var data MarkerDeletedData
			json.Unmarshal(msg.Data, &data)
			if data.MarkerID != markerID {
				t.Fatalf("expected marker_id '%s', got '%s'", markerID, data.MarkerID)
			}
		}
	}
	if !foundDeleted {
		t.Fatal("should receive marker_deleted broadcast")
	}

	// Verify marker is removed from the room
	markers = room.GetMarkers()
	if len(markers) != 0 {
		t.Fatalf("expected 0 markers after deletion, got %d", len(markers))
	}
}

func TestHub_DeleteMarker_OwnershipCheck(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(c1, "general")
	hub.JoinRoom(c2, "general")
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)

	// Alice creates a marker
	hub.CreateMapMarker(c1, roomHex, CreateMarkerData{
		RoomID: roomHex,
		Lat:    38.8977,
		Lon:    -77.0365,
		Name:   "HQ",
		Icon:   "pin",
		Color:  "#ff0000",
	})
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	markers := room.GetMarkers()
	if len(markers) != 1 {
		t.Fatalf("expected 1 marker, got %d", len(markers))
	}
	markerID := markers[0].ID

	// Bob tries to delete Alice's marker
	hub.DeleteMapMarker(c2, roomHex, markerID)

	// Bob should receive an error message
	c2Msgs := drainClientSend(c2, 5)
	var gotError bool
	for _, msg := range c2Msgs {
		if msg.Type == "error" {
			gotError = true
			var data ErrorData
			json.Unmarshal(msg.Data, &data)
			if data.Message != "only the marker creator can delete it" {
				t.Fatalf("expected ownership error message, got '%s'", data.Message)
			}
		}
	}
	if !gotError {
		t.Fatal("Bob should receive error when trying to delete Alice's marker")
	}

	// Marker should still exist
	markers = room.GetMarkers()
	if len(markers) != 1 {
		t.Fatalf("marker should still exist after unauthorized delete, got %d markers", len(markers))
	}
}
