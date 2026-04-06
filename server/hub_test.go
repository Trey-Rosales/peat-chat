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
