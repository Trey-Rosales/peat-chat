<div align="center">

# PeatLink

**Decentralized tactical mesh chat**

P2P messaging over iroh gossip | CRDT persistence | Push-to-talk voice | Tactical map with CoT | Native mobile

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.75+-orange.svg)](https://www.rust-lang.org)
[![Go](https://img.shields.io/badge/go-1.22+-00ADD8.svg)](https://go.dev)
[![React](https://img.shields.io/badge/react-18-61DAFB.svg)](https://react.dev)

---

</div>

## Overview

PeatLink is a decentralized chat platform built for environments where infrastructure can't be relied on. Peers communicate directly over [iroh](https://iroh.computer) gossip, with optional Bluetooth LE mesh transport for fully offline scenarios. Messages are stored locally using [Automerge](https://automerge.org) CRDTs for conflict-free sync.

Three ways to run it:

| Mode | Server | Transport | Storage |
|:-----|:-------|:----------|:--------|
| **CLI** | None (direct P2P) | iroh gossip | Automerge CRDT files |
| **Web** | Go WebSocket relay | TCP / WebSocket | In-memory |
| **Mobile** | Embedded Rust (axum) | WS + optional BLE | In-memory + BLE mesh |

---

## Quick Start

### Prerequisites

| Tool | Version |
|:-----|:--------|
| Rust | 1.75+ |
| Go | 1.22+ |
| Node.js | 18+ |

### Web + Server

The fastest way to try PeatLink:

```bash
make web-install        # install npm deps (first time only)
make web-build          # build the React frontend
make server             # start the Go server on :8090
```

Open **http://localhost:8090** -- enter a name, join a room, start chatting.

For development with hot reload, run in two terminals:

```bash
make server             # Go server on :8090
make web-dev            # Vite dev server on :5173 (HTTPS if certs present)
```

#### LAN / Mobile Testing

Vite binds to all interfaces automatically. For mobile devices to access microphone and geolocation, HTTPS is required:

```bash
# Generate local dev certs (first time)
brew install mkcert
mkcert -install
mkdir -p web/.certs
cd web/.certs && mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 YOUR_LAN_IP

# For iOS: install the CA cert from $(mkcert -CAROOT)/rootCA.pem on the device
# Settings > General > VPN & Device Management > Install profile
# Settings > General > About > Certificate Trust Settings > Enable full trust
```

Then access `https://YOUR_LAN_IP:5173` from your mobile device.

### CLI (peer-to-peer, no server needed)

```bash
# Terminal 1
cargo run -p peatlink-cli -- --name Alice --room general

# Terminal 2 (same LAN -- peers auto-discover via mDNS)
cargo run -p peatlink-cli -- --name Bob --room general
```

Peers discover each other automatically on the LAN via mDNS. Messages persist to `~/.peatlink/` via peat-mesh's AutomergeStore (redb-backed CRDT storage).

---

## Architecture

```
                    +------------------------------------------------------+
                    |                      Clients                         |
                    |                                                      |
                    |   CLI (Rust)     Web (React)       Mobile Apps       |
                    |       |              |             (iOS/Android)     |
                    |       |         +----------+           |            |
                    |       |         | Text     |           |            |
                    |       |         | + Voice  |           |            |
                    |       |         | + Map    |           |            |
                    |       |         +----------+           |            |
                    +-------+--------------+-----------------+------------+
                            |              |                  |
               +------------+--+    +------+------+   +------+-----------+
               |  peatlink     |    |     Go       |   |  peatlink       |
               |   -core       |    |    Server    |   |   -mobile       |
               |               |    |              |   |                 |
               |  peat-mesh    |    |  WS relay +  |   |  axum + UniFFI |
               |  CRDT sync    |    |  voice sig + |   |  optional BLE  |
               |  mDNS disc.   |    |  CoT broker  |   |  (peat-btle)   |
               +---------------+    +--------------+   +-----------------+
```

### Core Components

**`peatlink-core`** -- Rust library at the heart of everything. Built on the [Defense Unicorns PEAT ecosystem](https://github.com/defenseunicorns).

- **Identity** -- Persistent Ed25519 keypair via `peat-mesh::security::DeviceKeypair`. Same key seeds the iroh transport inside peat-mesh.
- **Mesh** -- `PeatMeshBuilder` configures transport (QUIC via iroh), mDNS discovery, and topology. No manual peer bootstrapping needed on LAN.
- **Messages** -- `ChatMessage` structs with UUID, sender, display name, timestamp, content, and optional reply-to.
- **Store** -- `peat-mesh::storage::AutomergeStore` (redb-backed) for CRDT persistence. Chat rooms map to store collections via `blake3(room_name)`. Automatic change notifications drive sync.
- **Security** -- `FormationKey` support wired in for room-level authentication (challenge-response via HMAC-SHA256).

**`peatlink-cli`** -- Interactive terminal client. Connects to rooms, shows message history, displays peer join/leave events.

**`peatlink-mobile`** -- Embeds an axum WebSocket server inside mobile apps. React UI connects to `localhost:{port}` via WebView. Native bindings generated by UniFFI (Kotlin + Swift). Optional BLE mesh via `peat-btle`.

**Go Server** -- WebSocket relay for the web UI. Manages rooms, Ed25519 client sessions, message history (1000 per room), mesh topology broadcasts, **WebRTC voice signaling relay**, and **CoT position/marker brokering**.

**Web UI** -- React 18 + Zustand + Tailwind CSS. Dark-themed chat interface with room sidebar, message threads, unread badges, SVG mesh topology viewer, **push-to-talk voice channels**, **tactical map (MapLibre GL)**, and **settings page**.

**Mobile Shells** -- Kotlin (Android) and Swift (iOS) wrappers that load the React UI in a WebView, handle BLE and microphone permissions, and interface with the embedded Rust server via UniFFI.

---

## Tactical Map

The tactical map uses [MapLibre GL JS](https://maplibre.org) with multiple tile sources:

| Style | Source | Key Required |
|:------|:-------|:-------------|
| **Satellite** | Esri World Imagery | No |
| **Dark** | Protomaps vector tiles | Yes (free) |
| **Light** | Protomaps vector tiles | Yes (free) |
| **Topo** | Protomaps vector tiles | Yes (free) |

The map defaults to satellite view (no API key needed). Add a [Protomaps API key](https://protomaps.com) in Settings to unlock vector tile styles.

### CoT (Cursor on Target) Integration

All positions and markers use standard CoT event types for future ATAK interoperability:

- **Self position** -- `a-f-G-U-C` (Atom-Friend-Ground-Unit-Combat), broadcast every GPS update
- **Markers** -- Proper CoT types (`b-m-p-w` waypoint, `b-m-p-s-m` spot marker, `b-m-p-s-p-i` POI, etc.) with `how`, `ce`, `le`, `hae`, `stale`, and `remarks` fields
- **Contacts** -- All room members appear in the contact list; those with GPS show on the map

### Map Features

- **Position sharing** -- Toggle in Settings; broadcasts GPS to room members
- **Callsign HUD** -- Bottom-right corner shows callsign, coordinates, altitude, and accuracy (TAK-style)
- **Shared markers** -- Right-click (desktop) or long-press (mobile) to place markers with CoT type, affiliation, and remarks
- **Style switching** -- Cycle between map styles via the button in the top-left corner
- **Contact tracking** -- Peer positions update in real-time; stale contacts fade

---

## Voice Channels

Each room has voice channels (a default "General" channel is created automatically). Voice works like Discord/Element -- click to join, hold a key to talk.

### How it works

1. **WebRTC mesh** -- Peers connect directly via WebRTC. The server only relays signaling (SDP offers/answers, ICE candidates), never audio.
2. **Push-to-talk** -- Audio track is created muted on join. Holding the PTT key (default: Space) unmutes the track. No renegotiation per press.
3. **Open mic mode** -- Toggle between PTT and continuous transmission via the VoiceBar.
4. **Listen-only** -- If no microphone is available (or HTTPS is required), users join in listen-only mode and can still hear others.
5. **Speaking indicators** -- `voice_speaking` messages broadcast who's talking. The UI shows animated rings around active speakers.
6. **Newcomer offers** -- When joining a channel with existing members, the newcomer creates WebRTC offers to each existing peer.

### Voice UI

- **Sidebar** -- Voice channels appear below the active room with member lists and speaking indicators
- **Voice Bar** -- Persistent bar at the bottom of the sidebar showing channel info, PTT/Open mic toggle, and disconnect button
- **PTT Button** -- Mic button next to the message input (touch-hold on mobile, keyboard shortcut on desktop)
- **Header** -- Shows which voice channel you're connected to

---

## Settings

Accessible via the gear icon in the sidebar header. Settings persist to `localStorage`.

| Section | Options |
|:--------|:--------|
| **Profile** | Display name |
| **Audio Input** | Microphone device, input volume slider |
| **Audio Output** | Speaker device |
| **Push-to-Talk** | PTT key binding (click to rebind) |
| **Voice Mode** | Push-to-talk or open mic |
| **Network** | Preferred transport (TCP, QUIC, BLE, Wi-Fi, LAN, P2P) |
| **Map** | Protomaps API key, map style, share location toggle |

---

## Project Structure

```
peat-chat/
├── crates/
│   ├── peatlink-core/            # P2P mesh library
│   │   ├── identity.rs           #   peat-mesh Ed25519 identity
│   │   ├── mesh.rs               #   iroh endpoint + gossip
│   │   ├── message.rs            #   chat message types
│   │   ├── node.rs               #   high-level orchestrator
│   │   └── store.rs              #   automerge CRDT persistence
│   ├── peatlink-cli/             # terminal chat client
│   └── peatlink-mobile/          # mobile FFI library
│       ├── ws_server.rs          #   embedded axum WS server
│       ├── ble.rs                #   BLE mesh transport
│       └── peatlink_mobile.udl   #   UniFFI interface definition
├── server/                       # Go WebSocket relay + voice + CoT
│   ├── hub.go                    #   room management, voice, CoT broker
│   ├── client.go                 #   WebSocket client + CoT position tracking
│   ├── room.go                   #   room state + voice channels + markers
│   ├── message.go                #   all message types (chat, voice, CoT)
│   ├── identity.go               #   blake3 room IDs, Ed25519 identity
│   └── *_test.go                 #   server unit tests (48 tests)
├── web/                          # React + TypeScript frontend
│   └── src/
│       ├── components/           #   ChatView, Sidebar, MapViewer,
│       │                         #   MarkerForm, VoiceChannelList,
│       │                         #   VoiceBar, PTTButton, SettingsPage...
│       ├── store/                #   chatStore + settingsStore (Zustand)
│       ├── hooks/                #   useWebSocket, usePTT, useGeolocation
│       ├── voice/                #   VoiceManager (WebRTC engine)
│       └── types/                #   TypeScript interfaces
├── mobile/
│   ├── android/                  # Kotlin shell
│   └── ios/                      # Swift shell
├── scripts/
│   └── build-mobile.sh           # cross-compilation
└── Makefile                      # build + test orchestration
```

---

## WebSocket Protocol

All messages are JSON envelopes: `{ "type": "...", "data": { ... } }`

### Chat Messages

```
  Client -> Server                  Server -> Client
 ------------------                ------------------
  set_name {name}                  identity {id, short_id}
  join_room {name}                 room_joined {room_id, name, members}
  send_message {room_id,           room_history {room_id, messages[]}
    content, reply_to?}            message {room_id, message}
  set_transport {transport}        peer_update {room_id, peer_id, event}
                                   mesh_state {room_id, self_id, peers[]}
                                   error {message}
```

### Voice Messages

```
  Client -> Server                  Server -> Client
 ------------------                ------------------
  create_voice_channel             voice_channel_created
    {room_id, name}                  {room_id, channel_id, name}
  join_voice                       voice_state
    {room_id, channel_id}            {room_id, channels[]}
  leave_voice                      voice_peer_joined
    {room_id, channel_id}            {room_id, channel_id, peer_id, name}
  voice_speaking                   voice_peer_left
    {room_id, channel_id,             {room_id, channel_id, peer_id}
     speaking}                     voice_speaking_broadcast
                                     {room_id, channel_id, peer_id, speaking}

  voice_offer                      voice_offer_relay
    {room_id, channel_id,             {room_id, channel_id, from_id, sdp}
     target_id, sdp}               voice_answer_relay
  voice_answer                       {room_id, channel_id, from_id, sdp}
    {room_id, channel_id,           voice_ice_relay
     target_id, sdp}                 {room_id, channel_id, from_id, candidate}
  voice_ice
    {room_id, channel_id,
     target_id, candidate}
```

### CoT / Map Messages

```
  Client -> Server                  Server -> Client
 ------------------                ------------------
  cot_position {room_id,           cot_state {room_id, self_id,
    lat, lon, hae, ce, cot_type}     contacts[], markers[]}
  create_marker {room_id,          marker_created {room_id, marker}
    lat, lon, name, icon, color,   marker_deleted {room_id, marker_id}
    cot_type, remarks}
  delete_marker {room_id,
    marker_id}
```

---

## How It Works

**Room IDs** are deterministic -- `blake3(room_name)` produces a 32-byte hash used as the room identifier and AutomergeStore collection key.

**Identity** is persistent. On first run, an Ed25519 keypair is generated via `peat-mesh::security::DeviceKeypair` and saved. The same key seeds the iroh transport managed by peat-mesh.

**Messages** are deduplicated by UUID. The P2P path stores them in peat-mesh's `AutomergeStore` (redb-backed Automerge CRDTs) for conflict-free merging and persistent storage. The WebSocket path keeps them in-memory with a 1000-message cap per room.

**Peer discovery** uses mDNS via peat-mesh -- peers on the same LAN automatically find and connect to each other without manual bootstrapping.

**Mesh state** is broadcast every 5 seconds -- peer transport type, latency, and connection health. The web UI renders this as an interactive topology graph.

**Voice channels** use WebRTC for peer-to-peer audio. The server acts as a dumb signaling relay -- it forwards SDP and ICE messages between peers without inspecting them. Push-to-talk or open-mic mode; listen-only fallback when no mic is available.

**CoT positions** are broadcast every 5 seconds to all room members. Markers carry full CoT metadata (type, how, ce, le, hae, stale, remarks) for ATAK plugin interoperability.

**PEAT ecosystem** -- peatlink-core uses `peat-mesh` 0.8 for identity, transport, CRDT storage, and mDNS discovery. `peat-btle` 0.2 provides optional BLE mesh transport for mobile. Future integration planned with `peat-tak-bridge` for native ATAK CoT interop and `peat-gateway` for enterprise enrollment.

---

## Testing

```bash
make test               # run all tests (Go + web)
make test-go            # Go server tests only
make test-web           # web frontend tests only
```

---

## Mobile Build

Requires platform-specific toolchains:

```bash
# Android -- requires Android NDK + cargo-ndk
make mobile-android

# iOS -- requires Xcode
make mobile-ios

# Generate language bindings only
make mobile-bindings-kotlin
make mobile-bindings-swift

# Test the embedded server on desktop
make mobile-server
```

See [`scripts/build-mobile.sh`](scripts/build-mobile.sh) for cross-compilation details.

---

## Make Targets

| Target | Description |
|:-------|:------------|
| `make server` | Build and run the Go WebSocket server |
| `make web-install` | Install npm dependencies |
| `make web-dev` | Start Vite dev server with hot reload |
| `make web-build` | Production build of the React frontend |
| `make dev` | Print full-stack dev instructions |
| `make test` | Run all tests (Go server + web frontend) |
| `make test-go` | Run Go server tests |
| `make test-web` | Run web frontend tests |
| `make mobile-rust` | Build the mobile Rust library |
| `make mobile-android` | Cross-compile for Android + Kotlin bindings |
| `make mobile-ios` | Cross-compile for iOS + XCFramework |
| `make mobile-server` | Run embedded server on desktop |
| `make rust-check` | Check Rust code compiles |
| `make clean` | Remove all build artifacts |

---

## Dependencies

| Component | Libraries |
|:----------|:----------|
| **peatlink-core** | peat-mesh 0.8 (automerge-backend), automerge 0.7, tokio, blake3 |
| **peatlink-cli** | clap 4, tracing |
| **peatlink-mobile** | axum 0.7, uniffi 0.28, peat-mesh 0.7, peat-btle 0.2 (optional) |
| **Go server** | gorilla/websocket, blake3, google/uuid |
| **Web** | React 18, Zustand 4.5, MapLibre GL 5, Tailwind CSS 3.4, Vite 5.4, TypeScript 5.5 |
| **Testing** | Go `testing` (48 tests), Vitest (55 tests), React Testing Library |

---

## License

[Apache-2.0](LICENSE)
