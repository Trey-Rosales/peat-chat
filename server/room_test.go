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

// --- CoT / marker tests ---

func TestRoom_GetCotContacts(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")

	// Set positions on both clients
	c1.mu.Lock()
	c1.cotLat = 38.8977
	c1.cotLon = -77.0365
	c1.cotCe = 10.0
	c1.cotType = "a-f-G-U-C"
	c1.cotTime = time.Now()
	c1.mu.Unlock()

	c2.mu.Lock()
	c2.cotLat = 40.7128
	c2.cotLon = -74.0060
	c2.cotCe = 5.0
	c2.cotType = "a-f-G-U-C"
	c2.cotTime = time.Now()
	c2.mu.Unlock()

	room.AddMember(c1)
	room.AddMember(c2)

	// Exclude c1 -- should only get c2's contact
	contacts := room.GetCotContacts(c1)
	if len(contacts) != 1 {
		t.Fatalf("expected 1 contact (excluding self), got %d", len(contacts))
	}
	if contacts[0].Callsign != "Bob" {
		t.Fatalf("expected callsign 'Bob', got '%s'", contacts[0].Callsign)
	}
	if contacts[0].Lat != 40.7128 {
		t.Fatalf("expected lat 40.7128, got %f", contacts[0].Lat)
	}
	if contacts[0].Lon != -74.0060 {
		t.Fatalf("expected lon -74.0060, got %f", contacts[0].Lon)
	}

	// Exclude c2 -- should only get c1's contact
	contacts = room.GetCotContacts(c2)
	if len(contacts) != 1 {
		t.Fatalf("expected 1 contact (excluding self), got %d", len(contacts))
	}
	if contacts[0].Callsign != "Alice" {
		t.Fatalf("expected callsign 'Alice', got '%s'", contacts[0].Callsign)
	}
}

func TestRoom_GetCotContacts_IncludesNoPosition(t *testing.T) {
	hub := NewHub()
	room := NewRoom("test")
	c1 := newTestClient(hub, "Alice")
	c2 := newTestClient(hub, "Bob")

	// Only c1 has position set; c2 has no cotTime (zero value)
	c1.mu.Lock()
	c1.cotLat = 38.8977
	c1.cotLon = -77.0365
	c1.cotCe = 10.0
	c1.cotType = "a-f-G-U-C"
	c1.cotTime = time.Now()
	c1.mu.Unlock()

	room.AddMember(c1)
	room.AddMember(c2)

	// Exclude c1 -- c2 has no GPS but should still appear as a contact
	contacts := room.GetCotContacts(c1)
	if len(contacts) != 1 {
		t.Fatalf("expected 1 contact (c2 without GPS), got %d", len(contacts))
	}
	if contacts[0].Callsign != "Bob" {
		t.Fatalf("expected callsign 'Bob', got '%s'", contacts[0].Callsign)
	}
	if contacts[0].Lat != 0 || contacts[0].Lon != 0 {
		t.Fatalf("expected zero lat/lon for no-GPS contact")
	}

	// Exclude c2 -- c1 does have position
	contacts = room.GetCotContacts(c2)
	if len(contacts) != 1 {
		t.Fatalf("expected 1 contact, got %d", len(contacts))
	}
	if contacts[0].Callsign != "Alice" {
		t.Fatalf("expected callsign 'Alice', got '%s'", contacts[0].Callsign)
	}
	if contacts[0].Lat != 38.8977 {
		t.Fatalf("expected lat 38.8977, got %f", contacts[0].Lat)
	}
}

func TestRoom_AddMarker(t *testing.T) {
	room := NewRoom("test")

	marker := &CotMarker{
		ID:          "marker-1",
		CreatorID:   "creator-1",
		CreatorName: "Alice",
		Lat:         38.8977,
		Lon:         -77.0365,
		Name:        "HQ",
		Icon:        "pin",
		Color:       "#ff0000",
		CreatedAt:   uint64(time.Now().UnixMilli()),
	}

	room.AddMarker(marker)

	markers := room.GetMarkers()
	if len(markers) != 1 {
		t.Fatalf("expected 1 marker, got %d", len(markers))
	}
	if markers[0].ID != "marker-1" {
		t.Fatalf("expected marker ID 'marker-1', got '%s'", markers[0].ID)
	}
	if markers[0].Name != "HQ" {
		t.Fatalf("expected marker name 'HQ', got '%s'", markers[0].Name)
	}
	if markers[0].CreatorName != "Alice" {
		t.Fatalf("expected creator name 'Alice', got '%s'", markers[0].CreatorName)
	}
}

func TestRoom_DeleteMarker(t *testing.T) {
	room := NewRoom("test")

	marker := &CotMarker{
		ID:          "marker-1",
		CreatorID:   "creator-1",
		CreatorName: "Alice",
		Lat:         38.8977,
		Lon:         -77.0365,
		Name:        "HQ",
		Icon:        "pin",
		Color:       "#ff0000",
		CreatedAt:   uint64(time.Now().UnixMilli()),
	}

	room.AddMarker(marker)

	ok := room.DeleteMarker("marker-1")
	if !ok {
		t.Fatal("DeleteMarker should return true for existing marker")
	}

	markers := room.GetMarkers()
	if len(markers) != 0 {
		t.Fatalf("expected 0 markers after deletion, got %d", len(markers))
	}
}

func TestRoom_DeleteMarker_NotFound(t *testing.T) {
	room := NewRoom("test")

	ok := room.DeleteMarker("nonexistent-marker")
	if ok {
		t.Fatal("DeleteMarker should return false for nonexistent marker")
	}
}
