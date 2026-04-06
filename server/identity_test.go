package main

import (
	"encoding/hex"
	"testing"
)

func TestNewIdentity(t *testing.T) {
	id := NewIdentity()

	if id.PublicKey == nil {
		t.Fatal("PublicKey should not be nil")
	}
	if id.PrivateKey == nil {
		t.Fatal("PrivateKey should not be nil")
	}
	if len(id.ID) == 0 {
		t.Fatal("ID should not be empty")
	}
	if len(id.ShortID) == 0 {
		t.Fatal("ShortID should not be empty")
	}
	if len(id.ShortID) > 12 {
		t.Fatalf("ShortID should be at most 12 chars, got %d", len(id.ShortID))
	}
}

func TestNewIdentity_Unique(t *testing.T) {
	id1 := NewIdentity()
	id2 := NewIdentity()

	if id1.ID == id2.ID {
		t.Fatal("two identities should have different IDs")
	}
}

func TestChatIdFromName_Deterministic(t *testing.T) {
	id1 := ChatIdFromName("general")
	id2 := ChatIdFromName("general")

	if id1 != id2 {
		t.Fatal("same name should produce same ChatId")
	}
}

func TestChatIdFromName_DifferentNames(t *testing.T) {
	id1 := ChatIdFromName("general")
	id2 := ChatIdFromName("random")

	if id1 == id2 {
		t.Fatal("different names should produce different ChatIds")
	}
}

func TestChatIdHex(t *testing.T) {
	id := ChatIdFromName("test")
	h := ChatIdHex(id)

	if len(h) != 64 {
		t.Fatalf("hex should be 64 chars, got %d", len(h))
	}

	// Should be valid hex
	_, err := hex.DecodeString(h)
	if err != nil {
		t.Fatalf("ChatIdHex should produce valid hex: %v", err)
	}
}

func TestChatIdShort(t *testing.T) {
	id := ChatIdFromName("test")
	short := ChatIdShort(id)

	if len(short) != 16 {
		t.Fatalf("short id should be 16 chars, got %d", len(short))
	}

	full := ChatIdHex(id)
	if short != full[:16] {
		t.Fatal("short should be prefix of full hex")
	}
}
