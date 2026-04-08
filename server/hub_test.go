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

	// Get actual voice channel ID and join both clients
	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
	}
	hub.JoinVoice(c1, roomHex, vcID)
	hub.JoinVoice(c2, roomHex, vcID)
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	// Relay offer from Alice to Bob
	hub.RelayVoiceOffer(c1, roomHex, vcID, c2.identity.ID, `{"type":"offer","sdp":"test-sdp"}`)

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
	hub.RelayVoiceAnswer(c2, roomHex, vcID, c1.identity.ID, `{"type":"answer","sdp":"test-answer"}`)

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
	hub.RelayVoiceIce(c1, roomHex, vcID, c2.identity.ID, `{"candidate":"test-ice"}`)

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

func TestHub_BroadcastMessageFromRelay_PreservesIdentity(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	relay := newTestClient(hub, "Relay")
	observer := newTestClient(hub, "Observer")
	hub.register <- relay
	hub.register <- observer
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(relay, "general")
	hub.JoinRoom(observer, "general")
	drainClientSend(relay, 20)
	drainClientSend(observer, 20)

	hub.RegisterBlePeer(relay, "ble-peer-1", "Charlie", "")

	room := hub.getOrCreateRoom("general")
	replyTo := "parent-1"
	if ok := hub.BroadcastMessageFromRelay(relay, room, "ble-peer-1", "", "msg-1", "hello from BLE", &replyTo); !ok {
		t.Fatal("expected relay chat message to be accepted")
	}

	msgs := drainClientSend(observer, 5)
	for _, msg := range msgs {
		if msg.Type == "message" {
			var data MessageData
			if err := json.Unmarshal(msg.Data, &data); err != nil {
				t.Fatalf("failed to unmarshal message: %v", err)
			}
			if data.Message.ID != "msg-1" {
				t.Fatalf("expected preserved message id, got %q", data.Message.ID)
			}
			if data.Message.Sender != "ble-peer-1" {
				t.Fatalf("expected BLE sender id, got %q", data.Message.Sender)
			}
			if data.Message.SenderName != "Charlie" {
				t.Fatalf("expected BLE sender name, got %q", data.Message.SenderName)
			}
			if data.Message.ReplyTo == nil || *data.Message.ReplyTo != "parent-1" {
				t.Fatal("expected reply_to to be preserved")
			}
			return
		}
	}

	t.Fatal("observer should receive relayed BLE message")
}

func TestHub_CreateMapMarkerFromRelay_PreservesCreator(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	relay := newTestClient(hub, "Relay")
	observer := newTestClient(hub, "Observer")
	hub.register <- relay
	hub.register <- observer
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(relay, "general")
	hub.JoinRoom(observer, "general")
	drainClientSend(relay, 20)
	drainClientSend(observer, 20)

	hub.RegisterBlePeer(relay, "ble-peer-1", "Charlie", "")
	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)

	ok := hub.CreateMapMarkerFromRelay(relay, roomHex, CreateMarkerData{
		RoomID:     roomHex,
		Lat:        38.89,
		Lon:        -77.03,
		Name:       "Relay Point",
		Icon:       "rally",
		Color:      "green",
		SenderID:   "ble-peer-1",
		SenderName: "Charlie",
	})
	if !ok {
		t.Fatal("expected relay marker to be accepted")
	}

	msgs := drainClientSend(observer, 5)
	for _, msg := range msgs {
		if msg.Type == "marker_created" {
			var data MarkerCreatedData
			if err := json.Unmarshal(msg.Data, &data); err != nil {
				t.Fatalf("failed to unmarshal marker_created: %v", err)
			}
			if data.Marker.CreatorID != "ble-peer-1" {
				t.Fatalf("expected BLE creator id, got %q", data.Marker.CreatorID)
			}
			if data.Marker.CreatorName != "Charlie" {
				t.Fatalf("expected BLE creator name, got %q", data.Marker.CreatorName)
			}
			return
		}
	}

	t.Fatal("observer should receive relayed marker")
}

func TestHub_JoinVoiceFromRelay_ShowsSeparateBleMember(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	relay := newTestClient(hub, "Relay")
	observer := newTestClient(hub, "Observer")
	hub.register <- relay
	hub.register <- observer
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(relay, "general")
	hub.JoinRoom(observer, "general")
	drainClientSend(relay, 20)
	drainClientSend(observer, 20)

	hub.RegisterBlePeer(relay, "ble-peer-1", "Charlie", "")
	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)
	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
		break
	}
	hub.JoinVoice(observer, roomHex, vcID)
	drainClientSend(observer, 10)

	hub.JoinVoiceFromRelay(relay, roomHex, vcID, "ble-peer-1", "Charlie")

	msgs := drainClientSend(observer, 10)
	var sawJoin bool
	var sawState bool
	for _, msg := range msgs {
		switch msg.Type {
		case "voice_peer_joined":
			var data VoicePeerJoinedData
			if err := json.Unmarshal(msg.Data, &data); err != nil {
				t.Fatalf("failed to unmarshal voice_peer_joined: %v", err)
			}
			if data.PeerID == "ble-peer-1" && data.Name == "Charlie" {
				sawJoin = true
			}
		case "voice_state":
			var data VoiceStateData
			if err := json.Unmarshal(msg.Data, &data); err != nil {
				t.Fatalf("failed to unmarshal voice_state: %v", err)
			}
			for _, ch := range data.Channels {
				for _, member := range ch.Members {
					if member.ID == "ble-peer-1" && member.Name == "Charlie" {
						sawState = true
					}
				}
			}
		}
	}

	if !sawJoin {
		t.Fatal("observer should receive voice_peer_joined for BLE member")
	}
	if !sawState {
		t.Fatal("voice_state should include BLE member separately from relay")
	}
}

func TestHub_RegisterBlePeer_PromotesVoiceMemberFromProvisionalID(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	relay := newTestClient(hub, "Relay")
	observer := newTestClient(hub, "Observer")
	hub.register <- relay
	hub.register <- observer
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(relay, "general")
	hub.JoinRoom(observer, "general")
	drainClientSend(relay, 20)
	drainClientSend(observer, 20)

	room := hub.getOrCreateRoom("general")
	roomHex := ChatIdHex(room.ID)
	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
		break
	}

	hub.RegisterBlePeer(relay, "mac-aa-bb", "Temp", "")
	hub.JoinVoiceFromRelay(relay, roomHex, vcID, "mac-aa-bb", "Temp")
	drainClientSend(observer, 10)

	hub.RegisterBlePeer(relay, "ble-node-1", "Charlie", "")

	msgs := drainClientSend(observer, 20)
	var sawFinal bool
	var sawProvisional bool
	for _, msg := range msgs {
		if msg.Type != "voice_state" {
			continue
		}
		var data VoiceStateData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			t.Fatalf("failed to unmarshal voice_state: %v", err)
		}
		for _, ch := range data.Channels {
			for _, member := range ch.Members {
				if member.ID == "ble-node-1" && member.Name == "Charlie" {
					sawFinal = true
				}
				if member.ID == "mac-aa-bb" {
					sawProvisional = true
				}
			}
		}
	}

	if !sawFinal {
		t.Fatal("voice_state should promote provisional BLE voice member to final node id")
	}
	if sawProvisional {
		t.Fatal("voice_state should not keep provisional BLE voice member after promotion")
	}
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

	hub.JoinRoom(c1, "general")
	hub.JoinRoom(c2, "general")

	// Drain join messages from both clients
	drainClientSend(c1, 20)
	drainClientSend(c2, 20)

	// Set room-scoped positions
	room := hub.getOrCreateRoom("general")
	room.SetCotPosition(c1, &CotPosition{Lat: 38.8977, Lon: -77.0365, Ce: 10.0, Time: time.Now()})
	room.SetCotPosition(c2, &CotPosition{Lat: 40.7128, Lon: -74.0060, Ce: 5.0, Time: time.Now()})

	// Manually trigger a CoT state broadcast
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

// --- Edit / Delete / Reaction / Pin hub tests ---

func TestHub_EditMessage(t *testing.T) {
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

	msg := NewChatMessage(c1.identity.ID, "Alice", "original")
	hub.BroadcastMessage(c1, room, msg)
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	hub.EditMessage(c1, roomHex, msg.ID, "edited")

	c1Msgs := drainClientSend(c1, 5)
	c2Msgs := drainClientSend(c2, 5)

	allMsgs := append(c1Msgs, c2Msgs...)
	var foundEdited bool
	for _, m := range allMsgs {
		if m.Type == "message_edited" {
			foundEdited = true
			var data MessageEditedData
			json.Unmarshal(m.Data, &data)
			if data.MessageID != msg.ID {
				t.Fatalf("expected message_id '%s', got '%s'", msg.ID, data.MessageID)
			}
			if data.Content != "edited" {
				t.Fatalf("expected content 'edited', got '%s'", data.Content)
			}
			if data.EditedAt == 0 {
				t.Fatal("edited_at should be non-zero")
			}
		}
	}
	if !foundEdited {
		t.Fatal("should receive message_edited broadcast")
	}
}

func TestHub_EditMessage_WrongSender(t *testing.T) {
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

	msg := NewChatMessage(c1.identity.ID, "Alice", "original")
	hub.BroadcastMessage(c1, room, msg)
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	// Bob tries to edit Alice's message
	hub.EditMessage(c2, roomHex, msg.ID, "hacked")

	c2Msgs := drainClientSend(c2, 5)
	var gotError bool
	for _, m := range c2Msgs {
		if m.Type == "error" {
			gotError = true
			var data ErrorData
			json.Unmarshal(m.Data, &data)
			if data.Message != "cannot edit message" {
				t.Fatalf("expected 'cannot edit message', got '%s'", data.Message)
			}
		}
	}
	if !gotError {
		t.Fatal("Bob should receive error when editing Alice's message")
	}
}

func TestHub_DeleteMessage(t *testing.T) {
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

	msg := NewChatMessage(c1.identity.ID, "Alice", "to delete")
	hub.BroadcastMessage(c1, room, msg)
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	hub.DeleteMessage(c1, roomHex, msg.ID)

	c1Msgs := drainClientSend(c1, 5)
	c2Msgs := drainClientSend(c2, 5)

	allMsgs := append(c1Msgs, c2Msgs...)
	var foundDeleted bool
	for _, m := range allMsgs {
		if m.Type == "message_deleted" {
			foundDeleted = true
			var data MessageDeletedData
			json.Unmarshal(m.Data, &data)
			if data.MessageID != msg.ID {
				t.Fatalf("expected message_id '%s', got '%s'", msg.ID, data.MessageID)
			}
		}
	}
	if !foundDeleted {
		t.Fatal("should receive message_deleted broadcast")
	}
}

func TestHub_AddReaction(t *testing.T) {
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

	msg := NewChatMessage(c1.identity.ID, "Alice", "react to me")
	hub.BroadcastMessage(c1, room, msg)
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	hub.AddReaction(c2, roomHex, msg.ID, "👍")

	c1Msgs := drainClientSend(c1, 5)
	c2Msgs := drainClientSend(c2, 5)

	allMsgs := append(c1Msgs, c2Msgs...)
	var foundReaction bool
	for _, m := range allMsgs {
		if m.Type == "reaction_updated" {
			foundReaction = true
			var data ReactionUpdatedData
			json.Unmarshal(m.Data, &data)
			if data.MessageID != msg.ID {
				t.Fatalf("expected message_id '%s', got '%s'", msg.ID, data.MessageID)
			}
			if len(data.Reactions["👍"]) != 1 {
				t.Fatalf("expected 1 reactor for 👍, got %d", len(data.Reactions["👍"]))
			}
		}
	}
	if !foundReaction {
		t.Fatal("should receive reaction_updated broadcast")
	}
}

func TestHub_RemoveReaction(t *testing.T) {
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

	msg := NewChatMessage(c1.identity.ID, "Alice", "react then remove")
	hub.BroadcastMessage(c1, room, msg)
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	hub.AddReaction(c2, roomHex, msg.ID, "👍")
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	hub.RemoveReaction(c2, roomHex, msg.ID, "👍")

	c1Msgs := drainClientSend(c1, 5)
	c2Msgs := drainClientSend(c2, 5)

	allMsgs := append(c1Msgs, c2Msgs...)
	var foundReaction bool
	for _, m := range allMsgs {
		if m.Type == "reaction_updated" {
			foundReaction = true
			var data ReactionUpdatedData
			json.Unmarshal(m.Data, &data)
			if data.MessageID != msg.ID {
				t.Fatalf("expected message_id '%s', got '%s'", msg.ID, data.MessageID)
			}
			if _, exists := data.Reactions["👍"]; exists {
				t.Fatal("👍 should be removed from reactions map")
			}
		}
	}
	if !foundReaction {
		t.Fatal("should receive reaction_updated broadcast after removal")
	}
}

func TestHub_PinMessage(t *testing.T) {
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

	msg := NewChatMessage(c1.identity.ID, "Alice", "pin me")
	hub.BroadcastMessage(c1, room, msg)
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	hub.PinMessage(c1, roomHex, msg.ID)

	c1Msgs := drainClientSend(c1, 5)
	c2Msgs := drainClientSend(c2, 5)

	allMsgs := append(c1Msgs, c2Msgs...)
	var foundPinned bool
	for _, m := range allMsgs {
		if m.Type == "message_pinned" {
			foundPinned = true
			var data MessagePinnedData
			json.Unmarshal(m.Data, &data)
			if data.MessageID != msg.ID {
				t.Fatalf("expected message_id '%s', got '%s'", msg.ID, data.MessageID)
			}
		}
	}
	if !foundPinned {
		t.Fatal("should receive message_pinned broadcast")
	}
}

func TestHub_UnpinMessage(t *testing.T) {
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

	msg := NewChatMessage(c1.identity.ID, "Alice", "unpin me")
	hub.BroadcastMessage(c1, room, msg)
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	hub.PinMessage(c1, roomHex, msg.ID)
	drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	hub.UnpinMessage(c1, roomHex, msg.ID)

	c1Msgs := drainClientSend(c1, 5)
	c2Msgs := drainClientSend(c2, 5)

	allMsgs := append(c1Msgs, c2Msgs...)
	var foundUnpinned bool
	for _, m := range allMsgs {
		if m.Type == "message_unpinned" {
			foundUnpinned = true
			var data MessageUnpinnedData
			json.Unmarshal(m.Data, &data)
			if data.MessageID != msg.ID {
				t.Fatalf("expected message_id '%s', got '%s'", msg.ID, data.MessageID)
			}
		}
	}
	if !foundUnpinned {
		t.Fatal("should receive message_unpinned broadcast")
	}
}

// --- DM hub tests ---

func TestHub_StartDM(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.StartDM(c1, c2.identity.ID)

	c1Msgs := drainClientSend(c1, 10)
	c2Msgs := drainClientSend(c2, 10)

	// c1 should get dm_opened and room_joined with is_dm=true
	var c1DmOpened, c1RoomJoined bool
	for _, m := range c1Msgs {
		if m.Type == "dm_opened" {
			c1DmOpened = true
			var data DMOpenedData
			json.Unmarshal(m.Data, &data)
			if data.PeerName != "Bob" {
				t.Fatalf("expected peer_name 'Bob', got '%s'", data.PeerName)
			}
		}
		if m.Type == "room_joined" {
			c1RoomJoined = true
			var data RoomJoinedData
			json.Unmarshal(m.Data, &data)
			if !data.IsDM {
				t.Fatal("room_joined for DM should have is_dm=true")
			}
		}
	}
	if !c1DmOpened {
		t.Fatal("c1 should receive dm_opened")
	}
	if !c1RoomJoined {
		t.Fatal("c1 should receive room_joined")
	}

	// c2 should get dm_opened and room_joined with is_dm=true
	var c2DmOpened, c2RoomJoined bool
	for _, m := range c2Msgs {
		if m.Type == "dm_opened" {
			c2DmOpened = true
			var data DMOpenedData
			json.Unmarshal(m.Data, &data)
			if data.PeerName != "Alice" {
				t.Fatalf("expected peer_name 'Alice', got '%s'", data.PeerName)
			}
		}
		if m.Type == "room_joined" {
			c2RoomJoined = true
			var data RoomJoinedData
			json.Unmarshal(m.Data, &data)
			if !data.IsDM {
				t.Fatal("room_joined for DM should have is_dm=true")
			}
		}
	}
	if !c2DmOpened {
		t.Fatal("c2 should receive dm_opened")
	}
	if !c2RoomJoined {
		t.Fatal("c2 should receive room_joined")
	}
}

func TestHub_StartDM_FindExisting(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.StartDM(c1, c2.identity.ID)
	c1Msgs1 := drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	// Extract room_id from first DM
	var firstRoomID string
	for _, m := range c1Msgs1 {
		if m.Type == "room_joined" {
			var data RoomJoinedData
			json.Unmarshal(m.Data, &data)
			firstRoomID = data.RoomID
		}
	}
	if firstRoomID == "" {
		t.Fatal("should have received room_joined with room_id")
	}

	// Start DM again — should return the same room
	hub.StartDM(c2, c1.identity.ID)
	c2Msgs := drainClientSend(c2, 10)
	drainClientSend(c1, 10)

	var secondRoomID string
	for _, m := range c2Msgs {
		if m.Type == "room_joined" {
			var data RoomJoinedData
			json.Unmarshal(m.Data, &data)
			secondRoomID = data.RoomID
		}
	}
	if secondRoomID == "" {
		t.Fatal("should have received room_joined with room_id on second StartDM")
	}
	if firstRoomID != secondRoomID {
		t.Fatalf("starting DM twice should return same room: got '%s' and '%s'", firstRoomID, secondRoomID)
	}
}

func TestHub_JoinRoom_BlocksDM(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.StartDM(c1, c2.identity.ID)
	c1Msgs := drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	// Extract the DM room name
	var dmRoomName string
	for _, m := range c1Msgs {
		if m.Type == "dm_opened" {
			var data DMOpenedData
			json.Unmarshal(m.Data, &data)
			// We need the room name, but dm_opened gives us room_id (hex).
			// We'll use the room_id to find the room and get its name.
			room := hub.getRoomByHex(data.RoomID)
			if room != nil {
				dmRoomName = room.Name
			}
		}
	}
	if dmRoomName == "" {
		t.Fatal("could not find DM room name")
	}

	// Register a third client and try to join the DM room
	c3 := newTestClient(hub, "Charlie")
	hub.register <- c3
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(c3, dmRoomName)

	c3Msgs := drainClientSend(c3, 5)
	var gotError bool
	for _, m := range c3Msgs {
		if m.Type == "error" {
			gotError = true
			var data ErrorData
			json.Unmarshal(m.Data, &data)
			if data.Message != "cannot join private conversation" {
				t.Fatalf("expected 'cannot join private conversation', got '%s'", data.Message)
			}
		}
	}
	if !gotError {
		t.Fatal("third client should be blocked from joining a DM room")
	}
}

func TestHub_JoinDM(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	hub.register <- c1
	hub.register <- c2
	time.Sleep(50 * time.Millisecond)

	hub.StartDM(c1, c2.identity.ID)
	c1Msgs := drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	// Extract room hex ID
	var roomHexID string
	for _, m := range c1Msgs {
		if m.Type == "room_joined" {
			var data RoomJoinedData
			json.Unmarshal(m.Data, &data)
			roomHexID = data.RoomID
		}
	}
	if roomHexID == "" {
		t.Fatal("should have room_id from StartDM")
	}

	// Participant can rejoin via JoinDM
	hub.JoinDM(c1, roomHexID)

	c1Msgs = drainClientSend(c1, 10)
	var gotRoomJoined bool
	for _, m := range c1Msgs {
		if m.Type == "room_joined" {
			gotRoomJoined = true
			var data RoomJoinedData
			json.Unmarshal(m.Data, &data)
			if !data.IsDM {
				t.Fatal("JoinDM room_joined should have is_dm=true")
			}
		}
	}
	if !gotRoomJoined {
		t.Fatal("participant should receive room_joined on JoinDM")
	}
}

func TestHub_JoinDM_Unauthorized(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	c3 := newTestClient(hub, "Charlie")
	hub.register <- c1
	hub.register <- c2
	hub.register <- c3
	time.Sleep(50 * time.Millisecond)

	hub.StartDM(c1, c2.identity.ID)
	c1Msgs := drainClientSend(c1, 10)
	drainClientSend(c2, 10)

	// Extract room hex ID
	var roomHexID string
	for _, m := range c1Msgs {
		if m.Type == "room_joined" {
			var data RoomJoinedData
			json.Unmarshal(m.Data, &data)
			roomHexID = data.RoomID
		}
	}
	if roomHexID == "" {
		t.Fatal("should have room_id from StartDM")
	}

	// Non-participant tries JoinDM
	hub.JoinDM(c3, roomHexID)

	c3Msgs := drainClientSend(c3, 5)
	var gotError bool
	for _, m := range c3Msgs {
		if m.Type == "error" {
			gotError = true
			var data ErrorData
			json.Unmarshal(m.Data, &data)
			if data.Message != "cannot join private conversation" {
				t.Fatalf("expected 'cannot join private conversation', got '%s'", data.Message)
			}
		}
	}
	if !gotError {
		t.Fatal("non-participant should be rejected from JoinDM")
	}
}

// --- Transport priority / dedup / WiFi Direct tests ---

func TestTransportPriority_DefaultOrder(t *testing.T) {
	// TCP < wifi-direct < btle (lower number = higher priority)
	if transportPriority("tcp", "") >= transportPriority("wifi-direct", "") {
		t.Error("tcp should have higher priority than wifi-direct")
	}
	if transportPriority("wifi-direct", "") >= transportPriority("btle", "") {
		t.Error("wifi-direct should have higher priority than btle")
	}
}

func TestTransportPriority_UserOverride(t *testing.T) {
	// User prefers btle -- should rank highest
	if transportPriority("btle", "btle") >= transportPriority("tcp", "btle") {
		t.Error("user-preferred btle should outrank tcp")
	}
}

func TestDeduplicatePeers(t *testing.T) {
	peers := []MeshPeerData{
		{ID: "peer1", Name: "Alice", Transport: "btle"},
		{ID: "peer1", Name: "Alice", Transport: "tcp"},
		{ID: "peer2", Name: "Bob", Transport: "wifi-direct"},
	}
	result := deduplicatePeers(peers, "")
	if len(result) != 2 {
		t.Fatalf("expected 2 unique peers, got %d", len(result))
	}
	// peer1 should be TCP (higher priority)
	for _, p := range result {
		if p.ID == "peer1" && p.Transport != "tcp" {
			t.Errorf("peer1 should prefer tcp, got %s", p.Transport)
		}
	}
}

func TestHub_RegisterWifiDirectPeer(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	relay := newTestClient(hub, "RelayPhone")
	hub.register <- relay
	time.Sleep(50 * time.Millisecond)

	hub.JoinRoom(relay, "general")
	drainClientSend(relay, 10)

	observer := newTestClient(hub, "MacBrowser")
	hub.register <- observer
	time.Sleep(50 * time.Millisecond)
	hub.JoinRoom(observer, "general")
	drainClientSend(observer, 10)

	// Register a WiFi Direct peer through the relay
	hub.RegisterBlePeer(relay, "wd-peer-1", "WDPhone", "wifi-direct")
	time.Sleep(50 * time.Millisecond)

	// Observer should receive mesh_state with the wifi-direct peer
	msgs := drainClientSend(observer, 10)
	found := false
	for _, raw := range msgs {
		if raw.Type == "mesh_state" {
			var data MeshStateData
			json.Unmarshal(raw.Data, &data)
			for _, peer := range data.Peers {
				if peer.ID == "wd-peer-1" && peer.Transport == "wifi-direct" {
					found = true
					if peer.ConnectedVia != relay.identity.ID {
						t.Errorf("expected connected_via=%s, got %s", relay.identity.ID, peer.ConnectedVia)
					}
				}
			}
		}
	}
	if !found {
		t.Error("wifi-direct peer not found in mesh_state")
	}
}

func TestHub_CallsignPropagation(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	// TCP client with callsign
	client := newTestClient(hub, "Alpha")
	hub.register <- client
	time.Sleep(50 * time.Millisecond)
	hub.JoinRoom(client, "general")
	drainClientSend(client, 10)

	// Relay with BLE peer
	relay := newTestClient(hub, "Bravo")
	hub.register <- relay
	time.Sleep(50 * time.Millisecond)
	hub.JoinRoom(relay, "general")
	drainClientSend(relay, 10)

	// Register BLE peer with callsign
	hub.RegisterBlePeer(relay, "ble-1", "Charlie", "btle")
	time.Sleep(50 * time.Millisecond)

	// Register WiFi Direct peer with callsign
	hub.RegisterBlePeer(relay, "wd-1", "Delta", "wifi-direct")
	time.Sleep(50 * time.Millisecond)

	// Check mesh_state received by client includes all callsigns
	msgs := drainClientSend(client, 20)
	names := make(map[string]string) // id -> name
	for _, raw := range msgs {
		if raw.Type == "mesh_state" {
			var data MeshStateData
			json.Unmarshal(raw.Data, &data)
			for _, peer := range data.Peers {
				names[peer.ID] = peer.Name
			}
		}
	}

	// Verify all callsigns present
	if names["ble-1"] != "Charlie" {
		t.Errorf("BLE peer callsign: expected Charlie, got %s", names["ble-1"])
	}
	if names["wd-1"] != "Delta" {
		t.Errorf("WiFi Direct peer callsign: expected Delta, got %s", names["wd-1"])
	}
	// Relay should appear with callsign Bravo
	if name, ok := names[relay.identity.ID]; ok && name != "Bravo" {
		t.Errorf("Relay callsign: expected Bravo, got %s", name)
	}
}

func TestHub_BlePeerCleanupOnRelayDisconnect(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	relay := newTestClient(hub, "Relay")
	hub.register <- relay
	time.Sleep(50 * time.Millisecond)
	hub.JoinRoom(relay, "general")
	drainClientSend(relay, 10)

	observer := newTestClient(hub, "Observer")
	hub.register <- observer
	time.Sleep(50 * time.Millisecond)
	hub.JoinRoom(observer, "general")
	drainClientSend(observer, 10)

	// Register BLE and WiFi Direct peers
	hub.RegisterBlePeer(relay, "ble-1", "BLEPhone", "btle")
	hub.RegisterBlePeer(relay, "wd-1", "WDPhone", "wifi-direct")
	time.Sleep(50 * time.Millisecond)
	drainClientSend(observer, 20)

	// Disconnect relay
	hub.unregister <- relay
	time.Sleep(100 * time.Millisecond)

	// Verify BLE peers cleaned up
	hub.mu.RLock()
	blePeerCount := len(hub.blePeers)
	hub.mu.RUnlock()

	if blePeerCount != 0 {
		t.Errorf("expected 0 BLE peers after relay disconnect, got %d", blePeerCount)
	}
}

func TestDeduplicatePeers_WithPreference(t *testing.T) {
	peers := []MeshPeerData{
		{ID: "peer1", Name: "Alice", Transport: "tcp"},
		{ID: "peer1", Name: "Alice", Transport: "btle"},
	}
	// User prefers btle
	result := deduplicatePeers(peers, "btle")
	if len(result) != 1 {
		t.Fatalf("expected 1 peer, got %d", len(result))
	}
	if result[0].Transport != "btle" {
		t.Errorf("user prefers btle, got %s", result[0].Transport)
	}
}
