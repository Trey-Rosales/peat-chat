package main

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CotEventXml represents a CoT XML event from ATAK.
type CotEventXml struct {
	XMLName xml.Name     `xml:"event"`
	UID     string       `xml:"uid,attr"`
	Type    string       `xml:"type,attr"`
	How     string       `xml:"how,attr"`
	Time    string       `xml:"time,attr"`
	Start   string       `xml:"start,attr"`
	Stale   string       `xml:"stale,attr"`
	Point   CotPointXml  `xml:"point"`
	Detail  CotDetailXml `xml:"detail"`
}

// CotPointXml represents the <point> element in CoT XML.
type CotPointXml struct {
	Lat float64 `xml:"lat,attr"`
	Lon float64 `xml:"lon,attr"`
	Hae float64 `xml:"hae,attr"`
	Ce  float64 `xml:"ce,attr"`
	Le  float64 `xml:"le,attr"`
}

// CotDetailXml represents the <detail> element in CoT XML.
type CotDetailXml struct {
	Contact struct {
		Callsign string `xml:"callsign,attr"`
		Endpoint string `xml:"endpoint,attr"`
	} `xml:"contact"`
	Group struct {
		Name string `xml:"name,attr"`
		Role string `xml:"role,attr"`
	} `xml:"__group"`
	UID struct {
		Droid string `xml:"Droid,attr"`
	} `xml:"uid"`
	Remarks  string `xml:"remarks"`
	Color    struct {
		ARGB string `xml:"argb,attr"`
	} `xml:"color"`
	UserIcon struct {
		IconsetPath string `xml:"iconsetpath,attr"`
	} `xml:"usericon"`
	PrecisionLocation struct {
		GeoPointSrc string `xml:"geopointsrc,attr"`
		AltSrc      string `xml:"altsrc,attr"`
	} `xml:"precisionlocation"`
	Track struct {
		Speed  string `xml:"speed,attr"`
		Course string `xml:"course,attr"`
	} `xml:"track"`
	Status struct {
		Battery string `xml:"battery,attr"`
	} `xml:"status"`
	Takv struct {
		Platform string `xml:"platform,attr"`
		Device   string `xml:"device,attr"`
		OS       string `xml:"os,attr"`
		Version  string `xml:"version,attr"`
	} `xml:"takv"`
	Links []struct {
		UID      string `xml:"uid,attr"`
		Relation string `xml:"relation,attr"`
		Type     string `xml:"type,attr"`
		Point    string `xml:"point,attr"`
		Callsign string `xml:"callsign,attr"`
	} `xml:"link"`
}

// ExternalCotContact holds CoT data for an ATAK peer that has no WebSocket client.
type ExternalCotContact struct {
	UID      string
	Callsign string
	CotType  string
	Lat      float64
	Lon      float64
	Hae      float64
	Ce       float64
	Time     time.Time
}

// CotBridge embeds UDP multicast + TCP CoT listeners directly in the Go server,
// replacing the separate Node.js COP bridge.
type CotBridge struct {
	hub         *Hub
	udpConn     *net.UDPConn
	tcpListener net.Listener
	tcpClients  map[net.Conn]bool
	tcpMu       sync.RWMutex
	running     bool
	stopCh      chan struct{}

	// Echo prevention: track ATAK-originated UIDs with last-seen time
	atakOrigins map[string]time.Time
	originMu    sync.RWMutex

	// Multicast address for outbound
	multicastAddr *net.UDPAddr

	// COP server URL for forwarding CoT to the TUI viewer (e.g., http://localhost:3000)
	copURL string
}

// NewCotBridge creates a new ATAK CoT bridge attached to the given Hub.
func NewCotBridge(hub *Hub) *CotBridge {
	return &CotBridge{
		hub:         hub,
		tcpClients:  make(map[net.Conn]bool),
		stopCh:      make(chan struct{}),
		atakOrigins: make(map[string]time.Time),
	}
}

// Start launches the UDP multicast listener, TCP CoT server, and origin cleanup goroutine.
func (b *CotBridge) Start(udpAddr string, udpPort, tcpPort int) error {
	b.running = true

	// Start UDP multicast listener
	go b.listenUDP(udpAddr, udpPort)

	// Start TCP CoT server
	if tcpPort > 0 {
		go b.listenTCP(tcpPort)
	}

	// Periodic origin cleanup (expire after 60s)
	go b.cleanupOrigins()

	log.Printf("ATAK CoT bridge started (UDP %s:%d, TCP :%d)", udpAddr, udpPort, tcpPort)
	return nil
}

// Stop shuts down the bridge.
func (b *CotBridge) Stop() {
	b.running = false
	close(b.stopCh)
	if b.udpConn != nil {
		b.udpConn.Close()
	}
	if b.tcpListener != nil {
		b.tcpListener.Close()
	}
	b.tcpMu.Lock()
	for conn := range b.tcpClients {
		conn.Close()
	}
	b.tcpMu.Unlock()
}

// listenUDP joins the multicast group and reads incoming CoT packets.
func (b *CotBridge) listenUDP(addr string, port int) {
	group := net.ParseIP(addr)
	if group == nil {
		log.Printf("ATAK bridge: invalid multicast address %s", addr)
		return
	}

	b.multicastAddr = &net.UDPAddr{IP: group, Port: port}

	listenAddr := &net.UDPAddr{IP: net.IPv4zero, Port: port}
	conn, err := net.ListenMulticastUDP("udp4", nil, &net.UDPAddr{IP: group, Port: port})
	if err != nil {
		// Fallback: try plain UDP if multicast join fails
		var err2 error
		var plainConn *net.UDPConn
		plainConn, err2 = net.ListenUDP("udp4", listenAddr)
		if err2 != nil {
			log.Printf("ATAK bridge: UDP listen failed: %v (multicast: %v)", err2, err)
			return
		}
		conn = plainConn
		log.Printf("ATAK bridge: multicast join failed (%v), using plain UDP on :%d", err, port)
	}
	b.udpConn = conn

	buf := make([]byte, 65536)
	for b.running {
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		n, _, err := conn.ReadFromUDP(buf)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			if !b.running {
				return
			}
			log.Printf("ATAK bridge: UDP read error: %v", err)
			continue
		}
		if n == 0 {
			continue
		}
		b.handlePacket(buf[:n])
	}
}

// listenTCP accepts CoT XML connections (events delimited by </event>).
func (b *CotBridge) listenTCP(port int) {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		log.Printf("ATAK bridge: TCP listen on :%d failed: %v", port, err)
		return
	}
	b.tcpListener = ln
	log.Printf("ATAK bridge: TCP CoT server listening on :%d", port)

	for b.running {
		conn, err := ln.Accept()
		if err != nil {
			if !b.running {
				return
			}
			log.Printf("ATAK bridge: TCP accept error: %v", err)
			continue
		}
		b.tcpMu.Lock()
		b.tcpClients[conn] = true
		b.tcpMu.Unlock()
		log.Printf("ATAK bridge: TCP client connected from %s", conn.RemoteAddr())
		go b.handleTCPConn(conn)
	}
}

func (b *CotBridge) handleTCPConn(conn net.Conn) {
	defer func() {
		b.tcpMu.Lock()
		delete(b.tcpClients, conn)
		b.tcpMu.Unlock()
		conn.Close()
		log.Printf("ATAK bridge: TCP client disconnected: %s", conn.RemoteAddr())
	}()

	var buf bytes.Buffer
	readBuf := make([]byte, 4096)
	for b.running {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		n, err := conn.Read(readBuf)
		if err != nil {
			if !b.running {
				return
			}
			return
		}
		buf.Write(readBuf[:n])

		// Extract complete events delimited by </event>
		for {
			data := buf.String()
			idx := strings.Index(data, "</event>")
			if idx < 0 {
				break
			}
			eventStr := data[:idx+len("</event>")]
			buf.Reset()
			buf.WriteString(data[idx+len("</event>"):])

			// Find the start of the <event tag
			start := strings.Index(eventStr, "<event")
			if start < 0 {
				continue
			}
			b.handleXmlCot([]byte(eventStr[start:]))
		}
	}
}

// handlePacket dispatches a raw packet (UDP) as either XML CoT or TAK protobuf.
func (b *CotBridge) handlePacket(data []byte) {
	if len(data) == 0 {
		return
	}
	if data[0] == '<' {
		b.handleXmlCot(data)
	} else if len(data) >= 3 && data[0] == 0xBF && data[1] == 0x01 && data[2] == 0xBF {
		b.handleProtoCot(data)
	}
}

func (b *CotBridge) handleXmlCot(data []byte) {
	var ev CotEventXml
	if err := xml.Unmarshal(data, &ev); err != nil {
		return
	}
	if ev.UID == "" {
		return
	}

	// Extract callsign: prefer Droid attribute, then contact callsign, then UID
	callsign := ev.Detail.UID.Droid
	if callsign == "" {
		callsign = ev.Detail.Contact.Callsign
	}
	if callsign == "" {
		callsign = ev.UID
	}

	// Extract remarks
	remarks := strings.TrimSpace(ev.Detail.Remarks)

	// Extract color (ARGB signed int -> hex)
	color := parseATAKColor(ev.Detail.Color.ARGB)

	b.ingestCot(ev.UID, callsign, ev.Type, ev.How,
		ev.Point.Lat, ev.Point.Lon, ev.Point.Hae, ev.Point.Ce,
		remarks, color)
}

func (b *CotBridge) handleProtoCot(data []byte) {
	ev := DecodeTakProto(data)
	if ev == nil || ev.UID == "" {
		return
	}
	callsign := ev.Callsign
	if callsign == "" {
		callsign = ev.UID
	}
	b.ingestCot(ev.UID, callsign, ev.Type, ev.How,
		ev.Lat, ev.Lon, ev.Hae, ev.Ce, "", "")
}

// ingestCot processes a decoded CoT event from ATAK into the peat-chat room system.
func (b *CotBridge) ingestCot(uid, callsign, cotType, how string, lat, lon, hae, ce float64, remarks, color string) {
	if callsign == "" {
		callsign = uid
	}
	if cotType == "" {
		cotType = "a-f-G-U-C"
	}

	// Echo prevention: skip if this UID matches a peat-chat WebSocket client
	b.hub.mu.RLock()
	_, isLocalClient := b.hub.clientsByID[uid]
	b.hub.mu.RUnlock()
	if isLocalClient {
		return
	}

	// Record as ATAK origin
	b.originMu.Lock()
	b.atakOrigins[uid] = time.Now()
	b.originMu.Unlock()

	// Find the "general" room (first public non-DM room, or create one)
	room := b.findGeneralRoom()
	if room == nil {
		return
	}

	if strings.HasPrefix(cotType, "b-") {
		// MARKER: b-m-p-s-m (spot), b-m-p-w (waypoint), b-r-f-h-c (casevac), etc.
		icon := cotTypeToIcon(cotType)
		if color == "" {
			color = "#ffff00" // default yellow for markers
		}

		marker := &CotMarker{
			ID:          uid,
			CreatorID:   "atak",
			CreatorName: callsign,
			Lat:         lat,
			Lon:         lon,
			Hae:         hae,
			Ce:          ce,
			Le:          9999999,
			Name:        callsign,
			Icon:        icon,
			Color:       color,
			CotType:     cotType,
			How:         how,
			Remarks:     remarks,
			CreatedAt:   uint64(time.Now().UnixMilli()),
			Stale:       uint64(time.Now().Add(24 * time.Hour).UnixMilli()),
		}

		room.mu.Lock()
		room.Markers[uid] = marker
		room.mu.Unlock()

		// Broadcast marker to room
		roomID := ChatIdHex(room.ID)
		data := mustMarshal("marker_created", MarkerCreatedData{
			RoomID: roomID,
			Marker: *marker,
		})
		room.Broadcast(data, nil)

		// Forward to COP
		cotXml := markerToXml(marker)
		b.forwardToCOP(cotXml, "atak")
	} else {
		// POSITION: a-f-G-U-C (friendly), a-h-G (hostile), etc.
		pos := &CotPosition{
			Lat:  lat,
			Lon:  lon,
			Hae:  hae,
			Ce:   ce,
			Time: time.Now(),
		}
		room.SetExternalCotPosition(uid, callsign, cotType, pos)
		b.hub.broadcastCotState(room)

		cotXml := contactToXml(uid, callsign, cotType, lat, lon, hae, ce)
		b.forwardToCOP(cotXml, "atak")
	}
}

// findGeneralRoom returns the first public non-DM room, or nil if none exist.
func (b *CotBridge) findGeneralRoom() *Room {
	b.hub.mu.RLock()
	defer b.hub.mu.RUnlock()
	for _, room := range b.hub.rooms {
		room.mu.RLock()
		isPublic := room.IsPublic
		isDM := room.IsDM
		room.mu.RUnlock()
		if isPublic && !isDM {
			return room
		}
	}
	return nil
}

// BroadcastToATAK sends a CotContact as CoT XML to all ATAK endpoints (UDP multicast + TCP).
// Skips contacts that originated from ATAK (echo prevention).
func (b *CotBridge) BroadcastToATAK(contact *CotContact) {
	if contact == nil {
		return
	}
	// Echo prevention: skip if this UID came from ATAK
	b.originMu.RLock()
	_, fromATAK := b.atakOrigins[contact.UID]
	b.originMu.RUnlock()
	if fromATAK {
		return
	}

	xmlData := contactToXml(contact.UID, contact.Callsign, contact.CotType,
		contact.Lat, contact.Lon, contact.Hae, contact.Ce)
	b.sendCotRaw([]byte(xmlData))

	// Also forward to COP TUI viewer
	b.forwardToCOP(xmlData, "peatlink")
}

// BroadcastMarkerToATAK sends a CotMarker as CoT XML to all ATAK endpoints.
func (b *CotBridge) BroadcastMarkerToATAK(marker *CotMarker) {
	if marker == nil {
		return
	}
	xmlData := markerToXml(marker)
	b.sendCotRaw([]byte(xmlData))

	// Also forward to COP TUI viewer
	b.forwardToCOP(xmlData, "peatlink")
}

// sendCotRaw sends raw CoT bytes to UDP multicast and all TCP clients.
func (b *CotBridge) sendCotRaw(data []byte) {
	// UDP multicast
	if b.udpConn != nil && b.multicastAddr != nil {
		_, err := b.udpConn.WriteToUDP(data, b.multicastAddr)
		if err != nil {
			log.Printf("ATAK bridge: UDP send error: %v", err)
		}
	}

	// TCP clients
	b.tcpMu.RLock()
	clients := make([]net.Conn, 0, len(b.tcpClients))
	for conn := range b.tcpClients {
		clients = append(clients, conn)
	}
	b.tcpMu.RUnlock()

	for _, conn := range clients {
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if _, err := conn.Write(data); err != nil {
			log.Printf("ATAK bridge: TCP send error to %s: %v", conn.RemoteAddr(), err)
			conn.Close()
			b.tcpMu.Lock()
			delete(b.tcpClients, conn)
			b.tcpMu.Unlock()
		}
	}
}

// cleanupOrigins periodically removes stale ATAK origin entries (older than 60s).
func (b *CotBridge) cleanupOrigins() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-b.stopCh:
			return
		case <-ticker.C:
			cutoff := time.Now().Add(-60 * time.Second)
			b.originMu.Lock()
			for uid, t := range b.atakOrigins {
				if t.Before(cutoff) {
					delete(b.atakOrigins, uid)
				}
			}
			b.originMu.Unlock()
		}
	}
}

// isATAKOrigin returns true if the given UID originated from ATAK.
func (b *CotBridge) isATAKOrigin(uid string) bool {
	b.originMu.RLock()
	defer b.originMu.RUnlock()
	_, ok := b.atakOrigins[uid]
	return ok
}

// --- CoT XML builders ---

func contactToXml(uid, callsign, cotType string, lat, lon, hae, ce float64) string {
	if cotType == "" {
		cotType = "a-f-G-U-C"
	}
	now := time.Now().UTC().Format(time.RFC3339)
	stale := time.Now().Add(90 * time.Second).UTC().Format(time.RFC3339)
	return fmt.Sprintf(
		`<event version="2.0" uid="%s" type="%s" how="h-e" time="%s" start="%s" stale="%s">`+
			`<point lat="%.6f" lon="%.6f" hae="%.1f" ce="%.1f" le="9999999.0"/>`+
			`<detail><contact callsign="%s"/><__group name="Cyan" role="Team Member"/>`+
			`<precisionlocation geopointsrc="USER" altsrc="???"/></detail></event>`,
		uid, cotType, now, now, stale, lat, lon, hae, ce, callsign,
	)
}

func markerToXml(marker *CotMarker) string {
	cotType := marker.CotType
	if cotType == "" {
		cotType = "b-m-p-s-m"
	}
	how := marker.How
	if how == "" {
		how = "h-e"
	}
	now := time.Now().UTC().Format(time.RFC3339)
	stale := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)

	remarksXml := ""
	if marker.Remarks != "" {
		remarksXml = fmt.Sprintf(`<remarks>%s</remarks>`, marker.Remarks)
	}

	colorXml := ""
	if marker.Color != "" {
		argb := colorToATAKArgb(marker.Color)
		if argb != "" {
			colorXml = fmt.Sprintf(`<color argb="%s"/>`, argb)
		}
	}

	return fmt.Sprintf(
		`<event version="2.0" uid="%s" type="%s" how="%s" time="%s" start="%s" stale="%s">`+
			`<point lat="%.6f" lon="%.6f" hae="%.1f" ce="%.1f" le="%.1f"/>`+
			`<detail><contact callsign="%s"/>%s%s`+
			`<precisionlocation geopointsrc="USER" altsrc="???"/>`+
			`<archive/></detail></event>`,
		marker.ID, cotType, how, now, now, stale,
		marker.Lat, marker.Lon, marker.Hae, marker.Ce, marker.Le,
		marker.Name, remarksXml, colorXml,
	)
}

// --- CoT type / color helpers ---

func cotTypeToIcon(cotType string) string {
	switch {
	case strings.HasPrefix(cotType, "b-m-p-w"):
		return "waypoint"
	case strings.HasPrefix(cotType, "b-m-p-s-p-i"):
		return "info"
	case strings.HasPrefix(cotType, "b-m-p-c"):
		return "checkpoint"
	case strings.HasPrefix(cotType, "b-r-f-h-c"):
		return "casevac"
	case strings.HasPrefix(cotType, "b-m-p-s-m"):
		return "marker"
	case strings.HasPrefix(cotType, "b-m-r"):
		return "route"
	default:
		return "rally"
	}
}

func parseATAKColor(argbStr string) string {
	if argbStr == "" {
		return ""
	}
	val, err := strconv.ParseInt(argbStr, 10, 64)
	if err != nil {
		return ""
	}
	// Convert signed int to unsigned 32-bit
	u := uint32(val)
	r := (u >> 16) & 0xFF
	g := (u >> 8) & 0xFF
	b := u & 0xFF
	return fmt.Sprintf("#%02x%02x%02x", r, g, b)
}

func colorToATAKArgb(hexColor string) string {
	hexColor = strings.TrimPrefix(hexColor, "#")
	if len(hexColor) != 6 {
		return ""
	}
	r, _ := strconv.ParseUint(hexColor[0:2], 16, 8)
	g, _ := strconv.ParseUint(hexColor[2:4], 16, 8)
	b, _ := strconv.ParseUint(hexColor[4:6], 16, 8)
	argb := int32(0xFF000000 | (uint32(r) << 16) | (uint32(g) << 8) | uint32(b))
	return strconv.FormatInt(int64(argb), 10)
}

// --- COP TUI Integration ---

// forwardToCOP sends CoT XML to the COP server's POST /cot endpoint
// so the TUI viewer displays it. Non-blocking (fires in goroutine).
func (b *CotBridge) forwardToCOP(cotXml string, source string) {
	if b.copURL == "" {
		return
	}
	go func() {
		url := b.copURL + "/cot"
		req, err := http.NewRequest("POST", url, strings.NewReader(cotXml))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/xml")
		req.Header.Set("X-CoT-Source", source)
		client := &http.Client{Timeout: 2 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return // COP server not running — silently skip
		}
		resp.Body.Close()
	}()
}
