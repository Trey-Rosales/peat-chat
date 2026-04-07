# PeatLink Roadmap

> Living document — updated as priorities shift and features land.

## Completed

- [x] Decentralized text chat with room system
- [x] WebRTC voice channels with push-to-talk
- [x] Open mic / listen-only voice modes
- [x] Tactical map (MapLibre GL) with satellite, dark, light, topo styles
- [x] CoT-compliant position sharing and shared markers
- [x] Callsign HUD (TAK-style)
- [x] Marker placement with CoT type, affiliation, and remarks
- [x] Mesh topology viewer
- [x] Migration to peat-mesh 0.8 (AutomergeStore, mDNS discovery, PeatMeshBuilder)
- [x] Mobile web support (HTTPS, LAN access, touch PTT, long-press markers)
- [x] BLE mesh transport (peat-btle) for mobile
- [x] Persistent Ed25519 identity via peat-mesh DeviceKeypair
- [x] Android app with embedded Rust server, upstream WS relay, and LAN auto-discovery
- [x] Go server mDNS service registration (`_peatlink._tcp`) via zeroconf

---

## Phase 1 — Core Messaging

### Direct Messages (DMs)
- [x] Private 1:1 channels between any two mesh members
- [ ] End-to-end encrypted via X25519 key exchange (peat-mesh already has this)
- [x] DM threads in sidebar separate from room list
- [x] Unread indicators and notifications
- [ ] Message delivery receipts (sent/delivered/read)

### File Sharing
- [ ] Send images, videos, documents, and voice notes in chat
- [ ] peat-mesh streaming blob transfer with checkpoint/resume for large files
- [ ] Thumbnail previews for images/videos inline in chat
- [ ] Progress indicator for transfers in progress
- [ ] Configurable max file size per room/formation
- [ ] Files persist in AutomergeStore with TTL (auto-expire on low storage)

### Message Improvements
- [x] Message editing and deletion (CRDT tombstones via AutomergeStore)
- [x] Threaded replies (reply-to with visual nesting)
- [x] Reactions / emoji responses
- [x] Message search across rooms
- [x] Pinned messages per room

---

## Phase 2 — Media & Streaming

### Video Streams
- [ ] On-demand video streams — not pushed to all peers by default
- [ ] Camera feed published as a named stream in the room
- [ ] Other users tap to subscribe (pull model, bandwidth-conscious)
- [ ] WebRTC-based, reuses existing voice infrastructure
- [ ] Quality auto-negotiation based on available bandwidth
- [ ] Picture-in-picture overlay on tactical map
- [ ] Snapshot capture from stream → shared as image in chat

### Voice Improvements
- [ ] VOX (voice-activated transmission) with adjustable threshold
- [ ] Per-channel volume controls
- [ ] Noise suppression (WebAudio API or RNNoise WASM)
- [ ] Audio recording / voice notes
- [ ] Channel-specific permissions (who can transmit)

---

## Phase 3 — Transport & Interop

### LoRa / Meshtastic Bridge
- [ ] `peat-meshtastic-bridge` crate — connects to Meshtastic radio via BLE or serial
- [ ] Translate Meshtastic position packets ↔ CoT contacts on tactical map
- [ ] Translate Meshtastic text messages ↔ PeatLink chat messages
- [ ] Bridge node appears as a peer in mesh viewer
- [ ] Handle Meshtastic's bandwidth constraints (short messages, low duty cycle)
- [ ] Support multiple Meshtastic channels mapped to PeatLink rooms
- [ ] Radio status indicators in mesh viewer (RSSI, SNR, hop count)

### ATAK Plugin
- [ ] Android plugin that registers PeatLink as a TAK data source
- [ ] Bidirectional CoT sync — PeatLink markers/positions visible in ATAK and vice versa
- [ ] Leverage `peat-tak-bridge` crate from Defense Unicorns PEAT workspace
- [ ] Chat messages bridged to ATAK's messaging system
- [ ] Marker CRUD operations synced both directions
- [ ] Support TAK Server multicast and direct TCP connections
- [ ] Plugin distributed as APK via ATAK marketplace or sideload

### WinTAK / iTAK Support
- [ ] Desktop/iOS TAK client interop via same CoT bridge
- [ ] TAK Server relay mode for non-mesh TAK clients

### Transport Hardening
- [ ] Full peat-mesh AutomergeSyncCoordinator integration (delta sync, negentropy reconciliation)
- [ ] Multi-transport failover (QUIC + BLE + LoRa simultaneously)
- [ ] FormationKey-based room authentication (challenge-response join)
- [ ] Offline message queue — store-and-forward when peers reconnect
- [ ] Bandwidth estimation and adaptive sync frequency

---

## Phase 4 — Tactical Features

### Enhanced Tactical Map
- [ ] Drawing tools (lines, polygons, circles) for area markers
- [ ] Route planning with waypoint sequencing
- [ ] Elevation profile along routes
- [ ] Offline map tiles (download regions for disconnected ops)
- [ ] MGRS / UTM coordinate display toggle
- [ ] Geofence alerts (notify when a contact enters/leaves an area)
- [ ] Bearing and distance tool between two points
- [ ] Map layer toggles (contacts, markers, routes, geofences)

### Situational Awareness
- [ ] Contact history trails (breadcrumb paths on map)
- [ ] Speed and heading indicators on contact markers
- [ ] Automatic stale contact cleanup with configurable TTL
- [ ] Sensor integration — bridge external sensor data as CoT events
- [ ] Weather overlay (wind, precipitation, visibility) from open APIs or local sensors

### Alerts & Notifications
- [ ] Configurable alert rules (proximity, geofence breach, peer disconnect)
- [ ] Push notifications on mobile (via service worker)
- [ ] Audio alerts for incoming messages / voice channel activity
- [ ] Priority message flag (bypass normal notification settings)
- [ ] Dead man's switch — alert when a contact stops reporting for configurable duration

---

## Phase 5 — Common Operating Picture (COP)

The COP is a shared, synchronized tactical view across all nodes in a formation.
Every participant sees the same picture — positions, markers, routes, boundaries,
and overlays — with no central server required.

### COP Architecture
- [ ] COP defined as a named CRDT document collection in AutomergeStore
- [ ] Each formation has one or more COP layers that sync via peat-mesh
- [ ] Layers are composable: base map + contacts + markers + drawings + routes + sensor feeds
- [ ] Conflict-free merge — two operators can edit the same COP offline and sync cleanly
- [ ] peat-mesh hierarchical aggregation: cell-level COPs roll up into formation-level COP
  - Leaf nodes report raw positions and observations
  - Cell leaders aggregate and filter (reduce bandwidth 90%+)
  - Formation HQ sees a consolidated picture without polling every node

### COP Data Model
- [ ] **Contacts layer** — all CoT positions (friendly, hostile, neutral, unknown)
- [ ] **Markers layer** — shared waypoints, POIs, objectives, hazards
- [ ] **Drawings layer** — lines, polygons, circles, free-draw (area markers, boundaries, sectors)
- [ ] **Routes layer** — sequenced waypoints with timing, phase lines, checkpoints
- [ ] **Sensor layer** — telemetry from IoT/peat-lite devices, camera feeds, environmental data
- [ ] **Intel layer** — reports, images, documents attached to map locations
- [ ] Each layer is independently toggleable, has its own TTL and sync priority

### COP Sync & Federation
- [ ] Real-time sync across all mesh transports (QUIC, BLE, LoRa bridge)
- [ ] Bandwidth-aware sync — prioritize contacts and markers over drawings on constrained links
- [ ] COP snapshots — point-in-time captures for AAR (After Action Review)
- [ ] COP playback — timeline scrubbing to replay how the picture evolved
- [ ] COP export to standard formats (KML/KMZ, GeoJSON, GPX, CoT XML package)
- [ ] COP import from TAK data packages (.zip with CoT + attachments)
- [ ] Federation — share COP between separate formations via peat-gateway or TAK Server relay
- [ ] Selective sharing — expose only specific layers to federated partners

### COP Permissions
- [ ] View-only vs edit roles per layer
- [ ] Layer ownership — creator can lock, archive, or transfer
- [ ] Formation key required to subscribe to COP (leverages FormationKey auth)
- [ ] Audit trail — who placed/edited/deleted each element, with timestamps

### COP Integration Points
- [ ] **ATAK plugin** — COP layers appear as TAK overlays; TAK drawings sync back to PeatLink
- [ ] **Meshtastic bridge** — LoRa contacts appear on COP contact layer automatically
- [ ] **Video streams** — camera feeds pinned to COP locations, viewable from the map
- [ ] **Chat** — COP elements linkable in chat messages ("look at marker Alpha on COP")
- [ ] **External COP systems** — adapter pattern for JBC-P, CPOF, C2 systems via CoT/OGC standards

---

## Phase 6 — Platform & Scale

> Phases 1–5 are the core product. Phase 6 extends reach.

### Native Mobile Apps
- [x] Android app (Kotlin shell + embedded Rust server via peatlink-mobile)
  - [x] Cross-compilation for arm64-v8a / x86_64 via cargo-ndk
  - [x] UniFFI Kotlin bindings for MobileNode interface
  - [x] React UI bundled into APK assets, served from localhost WebView
  - [x] Upstream WS relay to Go server with bidirectional message bridging and echo suppression
  - [x] Passthrough/downstream channels for all message types (chat, voice, CoT, DMs, reactions, edits, pins)
  - [x] mDNS/NSD auto-discovery of Go servers on LAN (`_peatlink._tcp`)
  - [x] Settings persistence (callsign, identity, upstream URL) via SharedPreferences
  - [x] Connection status bar with settings dialog
  - [x] Sideload page for APK distribution
- [ ] iOS app (Swift shell + embedded Rust server)
- [ ] Background BLE mesh operation
- [ ] Native push notifications
- [ ] Hardware PTT button support (Bluetooth HID)

### Desktop App
- [ ] Tauri or Electron wrapper for standalone desktop use
- [ ] System tray with notification badges
- [ ] Global PTT hotkey

### Enterprise / Formation Management
- [ ] peat-gateway integration for multi-org enrollment
- [ ] Certificate-based device authentication
- [ ] Role-based access control (admin, operator, observer)
- [ ] Audit logging
- [ ] Formation hierarchy — cells auto-organize based on capabilities

### Embedded / IoT
- [ ] peat-lite bridge for ESP32 sensors
- [ ] Sensor telemetry displayed on tactical map
- [ ] Remote device status monitoring
- [ ] OTA firmware updates via peat-mesh

---

## Technical Debt & Quality

- [ ] Fix settingsStore test suite (localStorage mock in jsdom)
- [ ] Add WebSocket integration tests (Go server)
- [ ] Add end-to-end tests (Playwright or Cypress)
- [ ] CI/CD pipeline (GitHub Actions — build, test, lint)
- [ ] Production Docker build (Go server + web dist)
- [ ] Performance profiling for large rooms (100+ members)
- [ ] Accessibility audit (keyboard nav, screen readers)

---

## Non-Goals (for now)

- Replacing TAK/ATAK — PeatLink complements TAK, it doesn't replace it
- Cloud-hosted SaaS — PeatLink is designed for edge/tactical deployment
- Social media features — no profiles, feeds, or algorithmic content
- Video conferencing (multi-party video) — voice + optional 1:1 streams only
