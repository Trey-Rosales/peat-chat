package main

import (
	"encoding/json"
	"testing"
)

func TestNewChatMessage(t *testing.T) {
	msg := NewChatMessage("sender-id", "Alice", "hello world")

	if msg.ID == "" {
		t.Fatal("message ID should not be empty")
	}
	if msg.Sender != "sender-id" {
		t.Fatalf("expected sender 'sender-id', got '%s'", msg.Sender)
	}
	if msg.SenderName != "Alice" {
		t.Fatalf("expected sender_name 'Alice', got '%s'", msg.SenderName)
	}
	if msg.Content != "hello world" {
		t.Fatalf("expected content 'hello world', got '%s'", msg.Content)
	}
	if msg.Timestamp == 0 {
		t.Fatal("timestamp should not be zero")
	}
	if msg.ReplyTo != nil {
		t.Fatal("reply_to should be nil by default")
	}
}

func TestNewChatMessage_UniqueIDs(t *testing.T) {
	msg1 := NewChatMessage("s", "n", "a")
	msg2 := NewChatMessage("s", "n", "b")

	if msg1.ID == msg2.ID {
		t.Fatal("different messages should have different IDs")
	}
}

func TestWSMessageSerialization(t *testing.T) {
	data, _ := json.Marshal(SetNameData{Name: "Bob"})
	msg := WSMessage{Type: "set_name", Data: data}

	bytes, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal WSMessage: %v", err)
	}

	var decoded WSMessage
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("failed to unmarshal WSMessage: %v", err)
	}

	if decoded.Type != "set_name" {
		t.Fatalf("expected type 'set_name', got '%s'", decoded.Type)
	}

	var nameData SetNameData
	if err := json.Unmarshal(decoded.Data, &nameData); err != nil {
		t.Fatalf("failed to unmarshal SetNameData: %v", err)
	}
	if nameData.Name != "Bob" {
		t.Fatalf("expected name 'Bob', got '%s'", nameData.Name)
	}
}

func TestChatMessageJSON(t *testing.T) {
	msg := NewChatMessage("peer-1", "Alice", "test message")
	replyID := "some-uuid"
	msg.ReplyTo = &replyID

	bytes, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal ChatMessage: %v", err)
	}

	var decoded ChatMessage
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("failed to unmarshal ChatMessage: %v", err)
	}

	if decoded.ID != msg.ID {
		t.Fatal("ID mismatch")
	}
	if decoded.Content != "test message" {
		t.Fatal("content mismatch")
	}
	if decoded.ReplyTo == nil || *decoded.ReplyTo != replyID {
		t.Fatal("reply_to mismatch")
	}
}

func TestVoiceStateDataJSON(t *testing.T) {
	state := VoiceStateData{
		RoomID: "abc123",
		Channels: []VoiceChannelInfo{
			{
				ID:   "vc-1",
				Name: "General",
				Members: []VoiceMemberInfo{
					{ID: "p1", Name: "Alice", ShortID: "p1short", Speaking: true},
					{ID: "p2", Name: "Bob", ShortID: "p2short", Speaking: false},
				},
			},
		},
	}

	bytes, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("failed to marshal VoiceStateData: %v", err)
	}

	var decoded VoiceStateData
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("failed to unmarshal VoiceStateData: %v", err)
	}

	if len(decoded.Channels) != 1 {
		t.Fatalf("expected 1 channel, got %d", len(decoded.Channels))
	}
	ch := decoded.Channels[0]
	if ch.Name != "General" {
		t.Fatalf("expected channel 'General', got '%s'", ch.Name)
	}
	if len(ch.Members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(ch.Members))
	}
	if !ch.Members[0].Speaking {
		t.Fatal("Alice should be speaking")
	}
	if ch.Members[1].Speaking {
		t.Fatal("Bob should not be speaking")
	}
}

func TestMustMarshal(t *testing.T) {
	data := mustMarshal("test_type", ErrorData{Message: "oops"})

	var msg WSMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("mustMarshal should produce valid JSON: %v", err)
	}
	if msg.Type != "test_type" {
		t.Fatalf("expected type 'test_type', got '%s'", msg.Type)
	}
}

func TestCotContactJSON(t *testing.T) {
	contact := CotContact{
		UID:      "uid-123",
		Callsign: "Alpha",
		ShortID:  "abc1",
		CotType:  "a-f-G-U-C",
		Lat:      38.8977,
		Lon:      -77.0365,
		Hae:      100.5,
		Ce:       10.0,
		Time:     1700000000000,
		Stale:    1700000030000,
	}

	bytes, err := json.Marshal(contact)
	if err != nil {
		t.Fatalf("failed to marshal CotContact: %v", err)
	}

	var decoded CotContact
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("failed to unmarshal CotContact: %v", err)
	}

	if decoded.UID != "uid-123" {
		t.Fatalf("expected UID 'uid-123', got '%s'", decoded.UID)
	}
	if decoded.Callsign != "Alpha" {
		t.Fatalf("expected Callsign 'Alpha', got '%s'", decoded.Callsign)
	}
	if decoded.CotType != "a-f-G-U-C" {
		t.Fatalf("expected CotType 'a-f-G-U-C', got '%s'", decoded.CotType)
	}
	if decoded.Lat != 38.8977 {
		t.Fatalf("expected Lat 38.8977, got %f", decoded.Lat)
	}
	if decoded.Lon != -77.0365 {
		t.Fatalf("expected Lon -77.0365, got %f", decoded.Lon)
	}
	if decoded.Hae != 100.5 {
		t.Fatalf("expected Hae 100.5, got %f", decoded.Hae)
	}
	if decoded.Ce != 10.0 {
		t.Fatalf("expected Ce 10.0, got %f", decoded.Ce)
	}
	if decoded.Time != 1700000000000 {
		t.Fatalf("expected Time 1700000000000, got %d", decoded.Time)
	}
	if decoded.Stale != 1700000030000 {
		t.Fatalf("expected Stale 1700000030000, got %d", decoded.Stale)
	}
}

func TestCotMarkerJSON(t *testing.T) {
	marker := CotMarker{
		ID:          "marker-abc",
		CreatorID:   "creator-1",
		CreatorName: "Alice",
		Lat:         40.7128,
		Lon:         -74.0060,
		Name:        "Rally Point",
		Icon:        "flag",
		Color:       "#00ff00",
		CreatedAt:   1700000000000,
	}

	bytes, err := json.Marshal(marker)
	if err != nil {
		t.Fatalf("failed to marshal CotMarker: %v", err)
	}

	var decoded CotMarker
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("failed to unmarshal CotMarker: %v", err)
	}

	if decoded.ID != "marker-abc" {
		t.Fatalf("expected ID 'marker-abc', got '%s'", decoded.ID)
	}
	if decoded.CreatorID != "creator-1" {
		t.Fatalf("expected CreatorID 'creator-1', got '%s'", decoded.CreatorID)
	}
	if decoded.CreatorName != "Alice" {
		t.Fatalf("expected CreatorName 'Alice', got '%s'", decoded.CreatorName)
	}
	if decoded.Lat != 40.7128 {
		t.Fatalf("expected Lat 40.7128, got %f", decoded.Lat)
	}
	if decoded.Lon != -74.0060 {
		t.Fatalf("expected Lon -74.0060, got %f", decoded.Lon)
	}
	if decoded.Name != "Rally Point" {
		t.Fatalf("expected Name 'Rally Point', got '%s'", decoded.Name)
	}
	if decoded.Icon != "flag" {
		t.Fatalf("expected Icon 'flag', got '%s'", decoded.Icon)
	}
	if decoded.Color != "#00ff00" {
		t.Fatalf("expected Color '#00ff00', got '%s'", decoded.Color)
	}
	if decoded.CreatedAt != 1700000000000 {
		t.Fatalf("expected CreatedAt 1700000000000, got %d", decoded.CreatedAt)
	}
}
