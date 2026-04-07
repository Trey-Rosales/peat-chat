package main

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 5 * time.Second // also drives mesh state updates
	maxMsgSize = 64 * 1024
)

type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte
	identity *Identity
	name     string
	rooms    map[[32]byte]bool
	mu       sync.RWMutex

	// Mesh transport metadata
	transport    string
	connectedAt  time.Time
	lastPingSent time.Time
	latencyMs    int64

	// CoT default type
	cotType string
}

func NewClient(hub *Hub, conn *websocket.Conn, name string) *Client {
	id := NewIdentity()
	if name == "" {
		name = "anon-" + id.ShortID
	}
	return &Client{
		hub:         hub,
		conn:        conn,
		send:        make(chan []byte, 256),
		identity:    id,
		name:        name,
		rooms:       make(map[[32]byte]bool),
		transport:   "tcp",
		connectedAt: time.Now(),
		cotType:     "a-f-G-U-C",
	}
}

// toCotContact builds a CotContact from the client identity and an optional
// room-scoped position. Position is nil if the client hasn't shared location
// in that specific room.
func (c *Client) toCotContact(pos *CotPosition) *CotContact {
	c.mu.RLock()
	defer c.mu.RUnlock()
	contact := &CotContact{
		UID:      c.identity.ID,
		Callsign: c.name,
		ShortID:  c.identity.ShortID,
		CotType:  c.cotType,
		Time:     uint64(c.connectedAt.UnixMilli()),
		Stale:    uint64(c.connectedAt.UnixMilli()) + 86400000,
	}
	if pos != nil {
		t := uint64(pos.Time.UnixMilli())
		contact.Lat = pos.Lat
		contact.Lon = pos.Lon
		contact.Hae = pos.Hae
		contact.Ce = pos.Ce
		contact.Time = t
		contact.Stale = t + 30000
	}
	return contact
}

func (c *Client) toMeshPeer() MeshPeerData {
	c.mu.RLock()
	defer c.mu.RUnlock()
	state := "connected"
	if c.latencyMs > 2000 {
		state = "degraded"
	}
	return MeshPeerData{
		ID:          c.identity.ID,
		Name:        c.name,
		ShortID:     c.identity.ShortID,
		Transport:   c.transport,
		LatencyMs:   c.latencyMs,
		State:       state,
		ConnectedAt: uint64(c.connectedAt.UnixMilli()),
	}
}

func (c *Client) sendJSON(msgType string, data any) {
	d, err := json.Marshal(data)
	if err != nil {
		return
	}
	out, err := json.Marshal(WSMessage{Type: msgType, Data: d})
	if err != nil {
		return
	}
	select {
	case c.send <- out:
	default:
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMsgSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		c.mu.Lock()
		if !c.lastPingSent.IsZero() {
			c.latencyMs = time.Since(c.lastPingSent).Milliseconds()
		}
		c.mu.Unlock()
		return nil
	})

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			c.sendJSON("error", ErrorData{Message: "invalid message format"})
			continue
		}

		switch msg.Type {
		case "set_name":
			var d SetNameData
			if json.Unmarshal(msg.Data, &d) == nil && d.Name != "" {
				c.mu.Lock()
				c.name = d.Name
				c.mu.Unlock()
			}

		case "join_room":
			var d JoinRoomData
			if json.Unmarshal(msg.Data, &d) == nil && d.Name != "" {
				c.hub.JoinRoom(c, d.Name)
			}

		case "send_message":
			var d SendMessageData
			if json.Unmarshal(msg.Data, &d) != nil || d.Content == "" {
				continue
			}
			room := c.hub.getRoomByHex(d.RoomID)
			if room == nil || !room.HasMember(c) {
				c.sendJSON("error", ErrorData{Message: "room not found"})
				continue
			}
			c.mu.RLock()
			name := c.name
			c.mu.RUnlock()
			chatMsg := NewChatMessage(c.identity.ID, name, d.Content)
			if d.ReplyTo != nil {
				chatMsg.ReplyTo = d.ReplyTo
			}
			c.hub.BroadcastMessage(c, room, chatMsg)

		case "set_transport":
			var d SetTransportData
			if json.Unmarshal(msg.Data, &d) == nil && d.Transport != "" {
				c.mu.Lock()
				c.transport = d.Transport
				c.mu.Unlock()
				c.broadcastMeshToMyRooms()
			}

		// --- CoT / map messages ---

		case "cot_position":
			var d CotPositionData
			if json.Unmarshal(msg.Data, &d) == nil {
				room := c.hub.getRoomByHex(d.RoomID)
				if room == nil || !room.HasMember(c) {
					continue
				}
				if d.CotType != "" {
					c.mu.Lock()
					c.cotType = d.CotType
					c.mu.Unlock()
				}
				room.SetCotPosition(c, &CotPosition{
					Lat:  d.Lat,
					Lon:  d.Lon,
					Hae:  d.Hae,
					Ce:   d.Ce,
					Time: time.Now(),
				})
			}

		case "create_marker":
			var d CreateMarkerData
			if json.Unmarshal(msg.Data, &d) == nil && d.Name != "" {
				c.hub.CreateMapMarker(c, d.RoomID, d)
			}

		case "delete_marker":
			var d DeleteMarkerData
			if json.Unmarshal(msg.Data, &d) == nil && d.MarkerID != "" {
				c.hub.DeleteMapMarker(c, d.RoomID, d.MarkerID)
			}

		// --- Voice channel messages ---

		case "create_voice_channel":
			var d CreateVoiceChannelData
			if json.Unmarshal(msg.Data, &d) == nil && d.Name != "" {
				c.hub.CreateVoiceChannel(c, d.RoomID, d.Name)
			}

		case "join_voice":
			var d JoinVoiceData
			if json.Unmarshal(msg.Data, &d) == nil && d.ChannelID != "" {
				c.hub.JoinVoice(c, d.RoomID, d.ChannelID)
			}

		case "leave_voice":
			var d LeaveVoiceData
			if json.Unmarshal(msg.Data, &d) == nil && d.ChannelID != "" {
				c.hub.LeaveVoice(c, d.RoomID, d.ChannelID)
			}

		case "voice_offer":
			var d VoiceOfferData
			if json.Unmarshal(msg.Data, &d) == nil && d.TargetID != "" {
				c.hub.RelayVoiceOffer(c, d.RoomID, d.ChannelID, d.TargetID, d.SDP)
			}

		case "voice_answer":
			var d VoiceAnswerData
			if json.Unmarshal(msg.Data, &d) == nil && d.TargetID != "" {
				c.hub.RelayVoiceAnswer(c, d.RoomID, d.ChannelID, d.TargetID, d.SDP)
			}

		case "voice_ice":
			var d VoiceIceData
			if json.Unmarshal(msg.Data, &d) == nil && d.TargetID != "" {
				c.hub.RelayVoiceIce(c, d.RoomID, d.ChannelID, d.TargetID, d.Candidate)
			}

		case "voice_speaking":
			var d VoiceSpeakingData
			if json.Unmarshal(msg.Data, &d) == nil && d.ChannelID != "" {
				c.hub.BroadcastVoiceSpeaking(c, d.RoomID, d.ChannelID, d.Speaking)
			}

		// --- Message editing / deletion ---

		case "edit_message":
			var d EditMessageData
			if json.Unmarshal(msg.Data, &d) == nil && d.MessageID != "" && d.Content != "" {
				c.hub.EditMessage(c, d.RoomID, d.MessageID, d.Content)
			}

		case "delete_message":
			var d DeleteMessageData
			if json.Unmarshal(msg.Data, &d) == nil && d.MessageID != "" {
				c.hub.DeleteMessage(c, d.RoomID, d.MessageID)
			}

		// --- Reactions ---

		case "add_reaction":
			var d AddReactionData
			if json.Unmarshal(msg.Data, &d) == nil && d.MessageID != "" && d.Emoji != "" {
				c.hub.AddReaction(c, d.RoomID, d.MessageID, d.Emoji)
			}

		case "remove_reaction":
			var d RemoveReactionData
			if json.Unmarshal(msg.Data, &d) == nil && d.MessageID != "" && d.Emoji != "" {
				c.hub.RemoveReaction(c, d.RoomID, d.MessageID, d.Emoji)
			}

		// --- Pinned messages ---

		case "pin_message":
			var d PinMessageData
			if json.Unmarshal(msg.Data, &d) == nil && d.MessageID != "" {
				c.hub.PinMessage(c, d.RoomID, d.MessageID)
			}

		case "unpin_message":
			var d UnpinMessageData
			if json.Unmarshal(msg.Data, &d) == nil && d.MessageID != "" {
				c.hub.UnpinMessage(c, d.RoomID, d.MessageID)
			}

		// --- Direct Messages ---

		case "start_dm":
			var d StartDMData
			if json.Unmarshal(msg.Data, &d) == nil && d.TargetID != "" {
				c.hub.StartDM(c, d.TargetID)
			}

		case "join_dm":
			var d JoinDMData
			if json.Unmarshal(msg.Data, &d) == nil && d.RoomID != "" {
				c.hub.JoinDM(c, d.RoomID)
			}

		default:
			c.sendJSON("error", ErrorData{Message: "unknown message type: " + msg.Type})
		}
	}
}

func (c *Client) broadcastMeshToMyRooms() {
	c.mu.RLock()
	roomIDs := make([][32]byte, 0, len(c.rooms))
	for id := range c.rooms {
		roomIDs = append(roomIDs, id)
	}
	c.mu.RUnlock()

	c.hub.mu.RLock()
	defer c.hub.mu.RUnlock()
	for _, id := range roomIDs {
		if room, ok := c.hub.rooms[id]; ok {
			c.hub.broadcastMeshStateLocked(room)
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			c.mu.Lock()
			c.lastPingSent = time.Now()
			c.mu.Unlock()
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func serveWs(hub *Hub, w any, r any, conn *websocket.Conn, defaultName string) {
	client := NewClient(hub, conn, defaultName)
	hub.register <- client

	client.sendJSON("identity", IdentityData{
		ID:      client.identity.ID,
		ShortID: client.identity.ShortID,
	})

	log.Printf("client connected: %s (%s)", client.name, client.identity.ShortID)

	go client.writePump()
	go client.readPump()
}
