package main

import (
	"sync"

	"github.com/google/uuid"
)

const maxMessages = 1000

// VoiceChannel tracks members and speaking state for a voice channel within a room.
type VoiceChannel struct {
	ID       string
	Name     string
	Members  map[*Client]bool
	Speaking map[*Client]bool
	mu       sync.RWMutex
}

func NewVoiceChannel(name string) *VoiceChannel {
	return &VoiceChannel{
		ID:       uuid.New().String(),
		Name:     name,
		Members:  make(map[*Client]bool),
		Speaking: make(map[*Client]bool),
	}
}

type Room struct {
	ID            [32]byte
	Name          string
	Messages      []ChatMessage
	Members       map[*Client]bool
	VoiceChannels map[string]*VoiceChannel
	Markers       map[string]*CotMarker
	mu            sync.RWMutex
}

func NewRoom(name string) *Room {
	defaultVC := NewVoiceChannel("General")
	return &Room{
		ID:            ChatIdFromName(name),
		Name:          name,
		Messages:      make([]ChatMessage, 0),
		Members:       make(map[*Client]bool),
		VoiceChannels: map[string]*VoiceChannel{defaultVC.ID: defaultVC},
		Markers:       make(map[string]*CotMarker),
	}
}

func (r *Room) AddMessage(msg ChatMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()
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

// GetCotContacts returns CoT position data for all members except the excluded client.
func (r *Room) GetCotContacts(exclude *Client) []CotContact {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var contacts []CotContact
	for c := range r.Members {
		if c == exclude {
			continue
		}
		if ct := c.toCotContact(); ct != nil {
			contacts = append(contacts, *ct)
		}
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
