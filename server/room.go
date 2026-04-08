package main

import (
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
)

const maxMessages = 1000

// VoiceChannel tracks members and speaking state for a voice channel within a room.
type VoiceChannel struct {
	ID          string
	Name        string
	Members     map[*Client]bool
	Speaking    map[*Client]bool
	BleMembers  map[string]*BlePeer
	BleSpeaking map[string]bool
	mu          sync.RWMutex
}

func NewVoiceChannel(name string) *VoiceChannel {
	return &VoiceChannel{
		ID:          uuid.New().String(),
		Name:        name,
		Members:     make(map[*Client]bool),
		Speaking:    make(map[*Client]bool),
		BleMembers:  make(map[string]*BlePeer),
		BleSpeaking: make(map[string]bool),
	}
}

// CotPosition holds a client's GPS position, scoped to a specific room.
type CotPosition struct {
	Lat  float64
	Lon  float64
	Hae  float64
	Ce   float64
	Time time.Time
}

type Room struct {
	ID                   [32]byte
	Name                 string
	Messages             []ChatMessage
	Members              map[*Client]bool
	VoiceChannels        map[string]*VoiceChannel
	Markers              map[string]*CotMarker
	CotPositions         map[*Client]*CotPosition
	BleCotPositions      map[string]*BleCotContact      // BLE peer CoT (sender_id -> contact)
	ExternalCotPositions map[string]*ExternalCotContact  // ATAK peer CoT (uid -> contact)
	PinnedMessages       map[string]bool                 // message ID -> true
	IsDM                 bool
	IsPublic             bool      // whether this room is visible in room discovery
	DMParticipants       [2]string // two client identity IDs (only for DM rooms)
	mu                   sync.RWMutex
}

// BleCotContact is a CoT contact for a BLE peer routed through a relay.
type BleCotContact struct {
	SenderID   string
	SenderName string
	Position   *CotPosition
}

func NewRoom(name string) *Room {
	defaultVC := NewVoiceChannel("General")
	return &Room{
		ID:                   ChatIdFromName(name),
		Name:                 name,
		Messages:             make([]ChatMessage, 0),
		Members:              make(map[*Client]bool),
		VoiceChannels:        map[string]*VoiceChannel{defaultVC.ID: defaultVC},
		Markers:              make(map[string]*CotMarker),
		CotPositions:         make(map[*Client]*CotPosition),
		BleCotPositions:      make(map[string]*BleCotContact),
		ExternalCotPositions: make(map[string]*ExternalCotContact),
		PinnedMessages:       make(map[string]bool),
		IsPublic:             true, // rooms are public by default
	}
}

func (r *Room) AddMessage(msg ChatMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.Messages {
		if r.Messages[i].ID == msg.ID {
			return
		}
	}
	r.Messages = append(r.Messages, msg)
	if len(r.Messages) > maxMessages {
		r.Messages = r.Messages[len(r.Messages)-maxMessages:]
	}
}

func (r *Room) GetHistory() []ChatMessage {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]ChatMessage, len(r.Messages))
	copy(out, r.Messages)
	return out
}

// EditMessage updates the content of a message. Only the original sender can edit.
// Returns true if the message was found and edited.
func (r *Room) EditMessage(messageID, senderID, newContent string) (uint64, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.Messages {
		if r.Messages[i].ID == messageID {
			if r.Messages[i].Sender != senderID {
				return 0, false
			}
			if r.Messages[i].Deleted {
				return 0, false
			}
			editedAt := uint64(time.Now().UnixMilli())
			r.Messages[i].Content = newContent
			r.Messages[i].EditedAt = &editedAt
			return editedAt, true
		}
	}
	return 0, false
}

// DeleteMessage marks a message as deleted. Only the original sender can delete.
func (r *Room) DeleteMessage(messageID, senderID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.Messages {
		if r.Messages[i].ID == messageID {
			if r.Messages[i].Sender != senderID {
				return false
			}
			r.Messages[i].Deleted = true
			r.Messages[i].Content = ""
			// Remove from pinned if it was pinned
			delete(r.PinnedMessages, messageID)
			r.Messages[i].Pinned = false
			return true
		}
	}
	return false
}

// AddReaction adds a reaction to a message. Returns the updated reactions map.
func (r *Room) AddReaction(messageID, senderID, emoji string) (map[string][]string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.Messages {
		if r.Messages[i].ID == messageID {
			if r.Messages[i].Deleted {
				return nil, false
			}
			if r.Messages[i].Reactions == nil {
				r.Messages[i].Reactions = make(map[string][]string)
			}
			// Check if sender already reacted with this emoji
			for _, id := range r.Messages[i].Reactions[emoji] {
				if id == senderID {
					return r.Messages[i].Reactions, true
				}
			}
			r.Messages[i].Reactions[emoji] = append(r.Messages[i].Reactions[emoji], senderID)
			// Return a copy
			out := make(map[string][]string, len(r.Messages[i].Reactions))
			for k, v := range r.Messages[i].Reactions {
				out[k] = append([]string{}, v...)
			}
			return out, true
		}
	}
	return nil, false
}

// RemoveReaction removes a reaction from a message. Returns the updated reactions map.
func (r *Room) RemoveReaction(messageID, senderID, emoji string) (map[string][]string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.Messages {
		if r.Messages[i].ID == messageID {
			if r.Messages[i].Reactions == nil {
				return nil, false
			}
			senders := r.Messages[i].Reactions[emoji]
			for j, id := range senders {
				if id == senderID {
					r.Messages[i].Reactions[emoji] = append(senders[:j], senders[j+1:]...)
					if len(r.Messages[i].Reactions[emoji]) == 0 {
						delete(r.Messages[i].Reactions, emoji)
					}
					out := make(map[string][]string, len(r.Messages[i].Reactions))
					for k, v := range r.Messages[i].Reactions {
						out[k] = append([]string{}, v...)
					}
					return out, true
				}
			}
			return r.Messages[i].Reactions, false
		}
	}
	return nil, false
}

// PinMessage pins a message in the room. Returns true if successful.
func (r *Room) PinMessage(messageID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.Messages {
		if r.Messages[i].ID == messageID && !r.Messages[i].Deleted {
			r.Messages[i].Pinned = true
			r.PinnedMessages[messageID] = true
			return true
		}
	}
	return false
}

// UnpinMessage unpins a message in the room. Returns true if successful.
func (r *Room) UnpinMessage(messageID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.Messages {
		if r.Messages[i].ID == messageID {
			r.Messages[i].Pinned = false
			delete(r.PinnedMessages, messageID)
			return true
		}
	}
	return false
}

// GetPinnedMessages returns all pinned messages in the room.
func (r *Room) GetPinnedMessages() []ChatMessage {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var pinned []ChatMessage
	for _, msg := range r.Messages {
		if msg.Pinned && !msg.Deleted {
			pinned = append(pinned, msg)
		}
	}
	return pinned
}

func (r *Room) HasMember(c *Client) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.Members[c]
}

func (r *Room) AddMember(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Members[c] = true
}

func (r *Room) RemoveMember(c *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.Members, c)
}

func (r *Room) MemberCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.Members)
}

func (r *Room) Broadcast(data []byte, exclude *Client) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for c := range r.Members {
		if c != exclude {
			select {
			case c.send <- data:
			default:
				// drop if buffer full
				log.Printf("WARNING: dropped message for client %s (send buffer full)", c.identity.ShortID)
			}
		}
	}
}

// GetMeshPeers returns mesh peer data for all members except the excluded client.
func (r *Room) GetMeshPeers(exclude *Client) []MeshPeerData {
	r.mu.RLock()
	defer r.mu.RUnlock()
	peers := make([]MeshPeerData, 0, len(r.Members))
	for c := range r.Members {
		if c != exclude {
			peers = append(peers, c.toMeshPeer())
		}
	}
	return peers
}

// GetMembers returns all member clients.
func (r *Room) GetMembers() []*Client {
	r.mu.RLock()
	defer r.mu.RUnlock()
	members := make([]*Client, 0, len(r.Members))
	for c := range r.Members {
		members = append(members, c)
	}
	return members
}

// --- Voice channel methods ---

func (r *Room) CreateVoiceChannel(name string) *VoiceChannel {
	r.mu.Lock()
	defer r.mu.Unlock()
	vc := NewVoiceChannel(name)
	r.VoiceChannels[vc.ID] = vc
	return vc
}

func (r *Room) GetVoiceChannel(id string) *VoiceChannel {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.VoiceChannels[id]
}

func (r *Room) VoiceChannelHasMember(channelID string, client *Client) bool {
	r.mu.RLock()
	vc, ok := r.VoiceChannels[channelID]
	r.mu.RUnlock()
	if !ok {
		return false
	}
	vc.mu.RLock()
	defer vc.mu.RUnlock()
	return vc.Members[client]
}

func (r *Room) JoinVoiceChannel(channelID string, client *Client) bool {
	r.mu.RLock()
	vc, ok := r.VoiceChannels[channelID]
	r.mu.RUnlock()
	if !ok {
		return false
	}
	vc.mu.Lock()
	defer vc.mu.Unlock()
	vc.Members[client] = true
	return true
}

func (r *Room) LeaveVoiceChannel(channelID string, client *Client) {
	r.mu.RLock()
	vc, ok := r.VoiceChannels[channelID]
	r.mu.RUnlock()
	if !ok {
		return
	}
	vc.mu.Lock()
	defer vc.mu.Unlock()
	delete(vc.Members, client)
	delete(vc.Speaking, client)
}

func (r *Room) JoinBleVoiceChannel(channelID string, peer *BlePeer) bool {
	r.mu.RLock()
	vc, ok := r.VoiceChannels[channelID]
	r.mu.RUnlock()
	if !ok || peer == nil {
		return false
	}
	vc.mu.Lock()
	defer vc.mu.Unlock()
	vc.BleMembers[peer.PeerID] = peer
	return true
}

func (r *Room) LeaveBleVoiceChannel(channelID, peerID string) {
	r.mu.RLock()
	vc, ok := r.VoiceChannels[channelID]
	r.mu.RUnlock()
	if !ok {
		return
	}
	vc.mu.Lock()
	defer vc.mu.Unlock()
	delete(vc.BleMembers, peerID)
	delete(vc.BleSpeaking, peerID)
}

func (r *Room) VoiceChannelHasBleMember(channelID, peerID string) bool {
	r.mu.RLock()
	vc, ok := r.VoiceChannels[channelID]
	r.mu.RUnlock()
	if !ok {
		return false
	}
	vc.mu.RLock()
	defer vc.mu.RUnlock()
	_, exists := vc.BleMembers[peerID]
	return exists
}

func (r *Room) SetBleSpeaking(channelID, peerID string, speaking bool) {
	r.mu.RLock()
	vc, ok := r.VoiceChannels[channelID]
	r.mu.RUnlock()
	if !ok {
		return
	}
	vc.mu.Lock()
	defer vc.mu.Unlock()
	if speaking {
		vc.BleSpeaking[peerID] = true
	} else {
		delete(vc.BleSpeaking, peerID)
	}
}

// LeaveAllVoiceChannels removes the client from every voice channel in this room.
// Returns the channel IDs they were in.
func (r *Room) LeaveAllVoiceChannels(client *Client) []string {
	r.mu.RLock()
	channels := make([]*VoiceChannel, 0, len(r.VoiceChannels))
	for _, vc := range r.VoiceChannels {
		channels = append(channels, vc)
	}
	r.mu.RUnlock()

	var leftIDs []string
	for _, vc := range channels {
		vc.mu.Lock()
		if vc.Members[client] {
			delete(vc.Members, client)
			delete(vc.Speaking, client)
			leftIDs = append(leftIDs, vc.ID)
		}
		vc.mu.Unlock()
	}
	return leftIDs
}

// LeaveAllBleVoiceChannels removes all BLE peers with matching peerIDs from every
// voice channel in this room. Returns the channel IDs any of them were in.
func (r *Room) LeaveAllBleVoiceChannels(peerIDs []string) []string {
	if len(peerIDs) == 0 {
		return nil
	}
	r.mu.RLock()
	channels := make([]*VoiceChannel, 0, len(r.VoiceChannels))
	for _, vc := range r.VoiceChannels {
		channels = append(channels, vc)
	}
	r.mu.RUnlock()

	idSet := make(map[string]bool, len(peerIDs))
	for _, id := range peerIDs {
		idSet[id] = true
	}

	var leftIDs []string
	for _, vc := range channels {
		vc.mu.Lock()
		removed := false
		for id := range idSet {
			if _, ok := vc.BleMembers[id]; ok {
				delete(vc.BleMembers, id)
				delete(vc.BleSpeaking, id)
				removed = true
			}
		}
		if removed {
			leftIDs = append(leftIDs, vc.ID)
		}
		vc.mu.Unlock()
	}
	return leftIDs
}

func (r *Room) SetSpeaking(channelID string, client *Client, speaking bool) {
	r.mu.RLock()
	vc, ok := r.VoiceChannels[channelID]
	r.mu.RUnlock()
	if !ok {
		return
	}
	vc.mu.Lock()
	defer vc.mu.Unlock()
	if speaking {
		vc.Speaking[client] = true
	} else {
		delete(vc.Speaking, client)
	}
}

// GetVoiceState returns serializable voice state for all channels in this room.
func (r *Room) GetVoiceState() []VoiceChannelInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	infos := make([]VoiceChannelInfo, 0, len(r.VoiceChannels))
	for _, vc := range r.VoiceChannels {
		vc.mu.RLock()
		members := make([]VoiceMemberInfo, 0, len(vc.Members))
		for c := range vc.Members {
			c.mu.RLock()
			members = append(members, VoiceMemberInfo{
				ID:       c.identity.ID,
				Name:     c.name,
				ShortID:  c.identity.ShortID,
				Speaking: vc.Speaking[c],
			})
			c.mu.RUnlock()
		}
		for peerID, peer := range vc.BleMembers {
			members = append(members, VoiceMemberInfo{
				ID:       peerID,
				Name:     peer.PeerName,
				ShortID:  peer.PeerID[:min(12, len(peer.PeerID))],
				Speaking: vc.BleSpeaking[peerID],
			})
		}
		infos = append(infos, VoiceChannelInfo{
			ID:      vc.ID,
			Name:    vc.Name,
			Members: members,
		})
		vc.mu.RUnlock()
	}
	return infos
}

// GetVoiceChannelMembers returns all clients in a voice channel.
func (r *Room) GetVoiceChannelMembers(channelID string) []*Client {
	r.mu.RLock()
	vc, ok := r.VoiceChannels[channelID]
	r.mu.RUnlock()
	if !ok {
		return nil
	}
	vc.mu.RLock()
	defer vc.mu.RUnlock()
	members := make([]*Client, 0, len(vc.Members))
	for c := range vc.Members {
		members = append(members, c)
	}
	return members
}

// --- CoT methods ---

func (r *Room) SetCotPosition(client *Client, pos *CotPosition) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.CotPositions[client] = pos
}

func (r *Room) ClearCotPosition(client *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.CotPositions, client)
}

func (r *Room) ClearBleCotPosition(senderID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.BleCotPositions, senderID)
}

// UpdateBlePeerName updates the name of a BLE peer in all voice channels.
func (r *Room) UpdateBlePeerName(peerID, newName string) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, vc := range r.VoiceChannels {
		vc.mu.Lock()
		if peer, ok := vc.BleMembers[peerID]; ok {
			peer.PeerName = newName
		}
		vc.mu.Unlock()
	}
}

// PromoteBlePeer rewrites any provisional BLE peer membership/state to the final peer ID.
func (r *Room) PromoteBlePeer(oldPeerID string, peer *BlePeer) {
	if oldPeerID == "" || peer == nil || oldPeerID == peer.PeerID {
		return
	}

	r.mu.RLock()
	channels := make([]*VoiceChannel, 0, len(r.VoiceChannels))
	for _, vc := range r.VoiceChannels {
		channels = append(channels, vc)
	}
	r.mu.RUnlock()

	for _, vc := range channels {
		vc.mu.Lock()
		if existing, ok := vc.BleMembers[oldPeerID]; ok {
			if peer.PeerName == "" && existing.PeerName != "" {
				peer.PeerName = existing.PeerName
			}
			delete(vc.BleMembers, oldPeerID)
			vc.BleMembers[peer.PeerID] = peer
		}
		if speaking := vc.BleSpeaking[oldPeerID]; speaking {
			delete(vc.BleSpeaking, oldPeerID)
			vc.BleSpeaking[peer.PeerID] = true
		} else {
			delete(vc.BleSpeaking, oldPeerID)
		}
		vc.mu.Unlock()
	}

	r.mu.Lock()
	if contact, ok := r.BleCotPositions[oldPeerID]; ok {
		delete(r.BleCotPositions, oldPeerID)
		contact.SenderID = peer.PeerID
		if peer.PeerName != "" {
			contact.SenderName = peer.PeerName
		}
		r.BleCotPositions[peer.PeerID] = contact
	}
	r.mu.Unlock()
}

func (r *Room) SetBleCotPosition(senderID, senderName string, pos *CotPosition) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.BleCotPositions[senderID] = &BleCotContact{
		SenderID:   senderID,
		SenderName: senderName,
		Position:   pos,
	}
}

// SetExternalCotPosition stores a CoT position for an ATAK peer (no WebSocket client).
func (r *Room) SetExternalCotPosition(uid, callsign, cotType string, pos *CotPosition) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ExternalCotPositions[uid] = &ExternalCotContact{
		UID:      uid,
		Callsign: callsign,
		CotType:  cotType,
		Lat:      pos.Lat,
		Lon:      pos.Lon,
		Hae:      pos.Hae,
		Ce:       pos.Ce,
		Time:     pos.Time,
	}
}

// GetCotContacts returns CoT position data for all members except the excluded client.
// Includes both direct WebSocket clients and BLE relay peers.
func (r *Room) GetCotContacts(exclude *Client) []CotContact {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var contacts []CotContact
	for c := range r.Members {
		if c == exclude {
			continue
		}
		pos := r.CotPositions[c]
		if ct := c.toCotContact(pos); ct != nil {
			contacts = append(contacts, *ct)
		}
	}
	// Include BLE peer CoT positions
	for _, bp := range r.BleCotPositions {
		if bp.Position != nil {
			t := uint64(bp.Position.Time.UnixMilli())
			contacts = append(contacts, CotContact{
				UID:      bp.SenderID,
				Callsign: bp.SenderName,
				ShortID:  bp.SenderID[:min(12, len(bp.SenderID))],
				CotType:  "a-f-G-U-C",
				Lat:      bp.Position.Lat,
				Lon:      bp.Position.Lon,
				Hae:      bp.Position.Hae,
				Ce:       bp.Position.Ce,
				Time:     t,
				Stale:    t + 30000,
			})
		}
	}
	// Include external ATAK peer CoT positions
	for _, ext := range r.ExternalCotPositions {
		t := uint64(ext.Time.UnixMilli())
		contacts = append(contacts, CotContact{
			UID:      ext.UID,
			Callsign: ext.Callsign,
			ShortID:  ext.UID[:min(12, len(ext.UID))],
			CotType:  ext.CotType,
			Lat:      ext.Lat,
			Lon:      ext.Lon,
			Hae:      ext.Hae,
			Ce:       ext.Ce,
			Time:     t,
			Stale:    t + 60000,
		})
	}
	return contacts
}

// --- Marker methods ---

func (r *Room) AddMarker(marker *CotMarker) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Markers[marker.ID] = marker
}

func (r *Room) DeleteMarker(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.Markers[id]; ok {
		delete(r.Markers, id)
		return true
	}
	return false
}

func (r *Room) GetMarkers() []CotMarker {
	r.mu.RLock()
	defer r.mu.RUnlock()
	markers := make([]CotMarker, 0, len(r.Markers))
	for _, m := range r.Markers {
		markers = append(markers, *m)
	}
	return markers
}
