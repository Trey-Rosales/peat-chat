package main

import (
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// newTestClient creates a minimal Client for testing (no real WS connection).
func newTestClient(hub *Hub, name string) *Client {
	id := NewIdentity()
	return &Client{
		hub:         hub,
		conn:        &websocket.Conn{}, // stub -- not used in room tests
		send:        make(chan []byte, 256),
		identity:    id,
		name:        name,
		rooms:       make(map[[32]byte]bool),
		transport:   "tcp",
		connectedAt: time.Now(),
	}
}

// --- Room tests ---

func TestNewRoom(t *testing.T) {
	room := NewRoom("general")

	if room.Name != "general" {
		t.Fatalf("expected name 'general', got '%s'", room.Name)
	}
	expected := ChatIdFromName("general")
	if room.ID != expected {
		t.Fatal("room ID should match ChatIdFromName")
	}
	if len(room.Members) != 0 {
		t.Fatal("new room should have no members")
	}
	if len(room.Messages) != 0 {
		t.Fatal("new room should have no messages")
	}
}

func TestNewRoom_DefaultVoiceChannel(t *testing.T) {
	room := NewRoom("general")

	if len(room.VoiceChannels) != 1 {
		t.Fatalf("new room should have 1 default voice channel, got %d", len(room.VoiceChannels))
	}

	var defaultVC *VoiceChannel
	for _, vc := range room.VoiceChannels {
		defaultVC = vc
	}

	if defaultVC.Name != "General" {
		t.Fatalf("default voice channel should be named 'General', got '%s'", defaultVC.Name)
	}
	if len(defaultVC.Members) != 0 {
		t.Fatal("default voice channel should have no members")
	}
}

func TestRoom_AddMessage(t *testing.T) {
	room := NewRoom("test")
	msg := NewChatMessage("p1", "Alice", "hello")
	room.AddMessage(msg)

	history := room.GetHistory()
	if len(history) != 1 {
		t.Fatalf("expected 1 message, got %d", len(history))
	}
	if history[0].Content != "hello" {
		t.Fatal("message content mismatch")
	}
}

func TestRoom_MessageLimit(t *testing.T) {
	room := NewRoom("test")

	for i := 0; i < 1100; i++ {
		room.AddMessage(NewChatMessage("p1", "A", "msg"))
	}

	history := room.GetHistory()
	if len(history) != maxMessages {
		t.Fatalf("expected %d messages (maxMessages), got %d", maxMessages, len(history))
	}
}

func TestRoom_Members(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")

	room.AddMember(c1)
	room.AddMember(c2)

	if room.MemberCount() != 2 {
		t.Fatalf("expected 2 members, got %d", room.MemberCount())
	}

	room.RemoveMember(c1)
	if room.MemberCount() != 1 {
		t.Fatalf("expected 1 member after removal, got %d", room.MemberCount())
	}

	members := room.GetMembers()
	if len(members) != 1 {
		t.Fatal("GetMembers should return 1")
	}
	if members[0].name != "Bob" {
		t.Fatal("remaining member should be Bob")
	}
}

func TestRoom_Broadcast(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")
	c3 := newTestClient(hub, "Charlie")

	room.AddMember(c1)
	room.AddMember(c2)
	room.AddMember(c3)

	data := []byte(`{"type":"test","data":{}}`)
	room.Broadcast(data, c1) // exclude c1

	// c2 and c3 should receive, c1 should not
	select {
	case msg := <-c2.send:
		if string(msg) != string(data) {
			t.Fatal("c2 received wrong data")
		}
	default:
		t.Fatal("c2 should have received broadcast")
	}

	select {
	case msg := <-c3.send:
		if string(msg) != string(data) {
			t.Fatal("c3 received wrong data")
		}
	default:
		t.Fatal("c3 should have received broadcast")
	}

	select {
	case <-c1.send:
		t.Fatal("c1 should NOT have received broadcast (excluded)")
	default:
		// correct
	}
}

// --- Voice channel tests ---

func TestRoom_CreateVoiceChannel(t *testing.T) {
	room := NewRoom("test")
	vc := room.CreateVoiceChannel("Tactical")

	if vc.Name != "Tactical" {
		t.Fatalf("expected name 'Tactical', got '%s'", vc.Name)
	}
	if vc.ID == "" {
		t.Fatal("voice channel ID should not be empty")
	}
	// 1 default + 1 created
	if len(room.VoiceChannels) != 2 {
		t.Fatalf("expected 2 voice channels, got %d", len(room.VoiceChannels))
	}
}

func TestRoom_JoinVoiceChannel(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")

	// Get the default voice channel ID
	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
	}

	ok := room.JoinVoiceChannel(vcID, c1)
	if !ok {
		t.Fatal("join should succeed")
	}

	vc := room.GetVoiceChannel(vcID)
	if len(vc.Members) != 1 {
		t.Fatalf("expected 1 voice member, got %d", len(vc.Members))
	}
}

func TestRoom_JoinVoiceChannel_InvalidID(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")

	ok := room.JoinVoiceChannel("nonexistent", c1)
	if ok {
		t.Fatal("join with invalid ID should fail")
	}
}

func TestRoom_LeaveVoiceChannel(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")

	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
	}

	room.JoinVoiceChannel(vcID, c1)
	room.LeaveVoiceChannel(vcID, c1)

	vc := room.GetVoiceChannel(vcID)
	if len(vc.Members) != 0 {
		t.Fatal("voice channel should have no members after leave")
	}
}

func TestRoom_LeaveAllVoiceChannels(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")

	// Create a second voice channel
	vc2 := room.CreateVoiceChannel("Ops")

	// Join both channels
	for id := range room.VoiceChannels {
		room.JoinVoiceChannel(id, c1)
	}

	leftIDs := room.LeaveAllVoiceChannels(c1)
	if len(leftIDs) != 2 {
		t.Fatalf("should have left 2 channels, got %d", len(leftIDs))
	}

	// All channels should be empty
	for _, vc := range room.VoiceChannels {
		if len(vc.Members) != 0 {
			t.Fatalf("channel %s should have no members", vc.Name)
		}
	}

	_ = vc2 // used above via room.VoiceChannels iteration
}

func TestRoom_SetSpeaking(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")

	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
	}

	room.JoinVoiceChannel(vcID, c1)
	room.SetSpeaking(vcID, c1, true)

	vc := room.GetVoiceChannel(vcID)
	if !vc.Speaking[c1] {
		t.Fatal("client should be speaking")
	}

	room.SetSpeaking(vcID, c1, false)
	if vc.Speaking[c1] {
		t.Fatal("client should not be speaking after set false")
	}
}

func TestRoom_GetVoiceState(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")

	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
	}

	room.JoinVoiceChannel(vcID, c1)
	room.JoinVoiceChannel(vcID, c2)
	room.SetSpeaking(vcID, c1, true)

	state := room.GetVoiceState()
	if len(state) != 1 {
		t.Fatalf("expected 1 voice channel in state, got %d", len(state))
	}

	ch := state[0]
	if ch.Name != "General" {
		t.Fatalf("expected 'General', got '%s'", ch.Name)
	}
	if len(ch.Members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(ch.Members))
	}

	// Find Alice and verify speaking
	var aliceFound bool
	for _, m := range ch.Members {
		if m.Name == "Alice" {
			aliceFound = true
			if !m.Speaking {
				t.Fatal("Alice should be speaking")
			}
		}
		if m.Name == "Bob" {
			if m.Speaking {
				t.Fatal("Bob should not be speaking")
			}
		}
	}
	if !aliceFound {
		t.Fatal("Alice should be in voice state")
	}
}

func TestRoom_GetVoiceChannelMembers(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")

	var vcID string
	for id := range room.VoiceChannels {
		vcID = id
	}

	room.JoinVoiceChannel(vcID, c1)
	room.JoinVoiceChannel(vcID, c2)

	members := room.GetVoiceChannelMembers(vcID)
	if len(members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(members))
	}

	// Nonexistent channel
	members = room.GetVoiceChannelMembers("fake")
	if members != nil {
		t.Fatal("nonexistent channel should return nil")
	}
}

func TestRoom_GetMeshPeers(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")

	room.AddMember(c1)
	room.AddMember(c2)

	peers := room.GetMeshPeers(c1) // exclude c1
	if len(peers) != 1 {
		t.Fatalf("expected 1 peer (excluding self), got %d", len(peers))
	}
	if peers[0].Name != "Bob" {
		t.Fatalf("expected peer 'Bob', got '%s'", peers[0].Name)
	}
	if peers[0].Transport != "tcp" {
		t.Fatalf("expected transport 'tcp', got '%s'", peers[0].Transport)
	}
}
