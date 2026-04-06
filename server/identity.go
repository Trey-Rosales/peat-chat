package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"

	"lukechampine.com/blake3"
)

type Identity struct {
	PublicKey  ed25519.PublicKey
	PrivateKey ed25519.PrivateKey
	ID         string
	ShortID    string
}

func NewIdentity() *Identity {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic("failed to generate ed25519 key: " + err.Error())
	}
	id := hex.EncodeToString(pub)
	short := id
	if len(short) > 12 {
		short = short[:12]
	}
	return &Identity{
		PublicKey:  pub,
		PrivateKey: priv,
		ID:         id,
		ShortID:    short,
	}
}

// ChatIdFromName produces a deterministic 32-byte room ID from a name,
// identical to the Rust: *blake3::hash(name.as_bytes()).as_bytes()
func ChatIdFromName(name string) [32]byte {
	return blake3.Sum256([]byte(name))
}

func ChatIdHex(id [32]byte) string {
	return hex.EncodeToString(id[:])
}

func ChatIdShort(id [32]byte) string {
	h := ChatIdHex(id)
	if len(h) > 16 {
		return h[:16]
	}
	return h
}
