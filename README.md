<div align="center">

# PeatLink

**Decentralized tactical mesh chat**

P2P mesh networking via peat-mesh | CRDT sync & persistence | Push-to-talk voice | Tactical map with CoT | Native mobile

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
| **CLI** | None (direct P2P) | peat-mesh (QUIC + mDNS) | AutomergeStore (redb) |
| **Web** | Go WebSocket relay | TCP / WebSocket | In-memory |
| **Mobile** | Embedded Rust (axum) | WS + WiFi Direct P2P + BLE mesh | In-memory + BLE mesh |

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

**`peatlink-mobile`** -- Embeds an axum WebSocket server inside mobile apps. React UI connects to `localhost:{port}` via WebView. Native bindings generated by UniFFI (Kotlin + Swift). BLE mesh via `peat-btle` with a full BLE-to-WS bridge (`bridge.rs`) that tunnels all message types over BLE using `__ws:`-prefixed JSON envelopes.

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
3. **Three voice modes** -- PTT (push-to-talk), Noise Gate (energy-based dB threshold), and Auto (WebRTC VAD). Cycle modes live via VoiceBar button. Mode switching properly tears down the old audio pipeline before starting the new one.
4. **Listen-only** -- If no microphone is available (or HTTPS is required), users join in listen-only mode and can still hear others.
5. **Speaking indicators** -- `voice_speaking` messages broadcast who's talking. The UI shows animated rings around active speakers.
6. **Newcomer offers** -- When joining a channel with existing members, the newcomer creates WebRTC offers to each existing peer.
7. **BLE voice relay** -- Native Opus 8kbps at 8kHz over BLE GATT for phones without WiFi. 20ms audio drain loop with dual priority queues (audio first, Serval VoMP-inspired). 60ms jitter buffer on playback.

### Voice UI

- **Sidebar** -- Voice channels appear below the active room with member lists and speaking indicators
- **Voice Bar** -- Persistent bar at the bottom of the sidebar showing channel info, PTT/Open mic toggle, and disconnect button
- **PTT Button** -- Mic button next to the message input (touch-hold on mobile, keyboard shortcut on desktop)
- **Header** -- Shows which voice channel you're connected to

---

## BLE Mesh Transport

PeatLink supports Bluetooth Low Energy as a full mesh transport for scenarios where WiFi/internet is unavailable. The BLE layer carries all message types -- chat, DMs, reactions, edits, pins, CoT/GPS, voice, and markers -- not just a subset.

### Architecture

The BLE mesh uses a three-layer design:

1. **BLE Platform Layer** (`PeatBleService.kt`) -- Dual-role Android BLE driver that acts as both scanner and advertiser simultaneously. Runs a GATT server with a sync characteristic (read/write/notify) and a GATT client with auto-connect and MTU 512 negotiation. A 3-second tick loop drives the `peat-btle` state machine. A separate 20ms audio+bridge drain loop handles real-time voice and message forwarding with dual priority queues (audio first, data second). MTU-aware fragmentation for large messages with 4-byte chunk headers.

2. **BLE-WS Bridge** (`bridge.rs`) -- Bridges the BLE mesh and the embedded WebSocket server. Full WS JSON envelopes are sent over the BLE chat channel prefixed with `__ws:`, enabling every message type to traverse BLE without a dedicated handler per type. Subscribes to room broadcasts, downstream, and passthrough channels. Shared dedup with the upstream relay prevents message loops. Voice-aware mesh backoff (Serval Rhizome pattern): mesh sync pauses during active voice to free BLE bandwidth.

3. **Hierarchical Mesh View** -- BLE peers appear in the mesh topology viewer alongside direct WS/QUIC peers. The `connected_via` field on `MeshPeerData` distinguishes transport type. The `MeshViewer` renders a tree topology: direct peers in an inner ring, relay peers in an outer ring near their parent node. BLE transport is colored purple (#8b5cf6), WiFi Direct is amber (#f59e0b).

---

## WiFi Direct P2P Transport

PeatLink supports WiFi Direct as a peer-to-peer transport for medium-range offline communication (~200m). WiFi Direct provides orders of magnitude more bandwidth than BLE (~250 Mbps vs ~2 Mbps) with lower latency (~10ms vs ~50ms), making it ideal for voice and high-throughput data sync.

### Architecture

WiFi Direct creates a standard IP network (192.168.49.x subnet). The device with internet connectivity becomes the Group Owner (GO), and other devices connect as clients. The GO's embedded WebSocket server handles WiFi Direct clients identically to local WebView connections -- no new protocol needed.

```
Mac Browser ←WebRTC→ Go Server (:8090/:8091)
                        ↕ WebSocket (normal WiFi)
              WiFi Relay Phone (Group Owner)
                        ↕ WebSocket (WiFi Direct, ws://192.168.49.1:PORT)
              WiFi Direct Phone (client, runs BLE bridge)
                        ↕ BLE GATT
              BLE-only Phone
```

### Multi-Hop Relay Chain

Each hop reuses the existing `upstream_relay.rs` WebSocket relay code:

- **Hop 1**: WiFi relay → Go server (normal WiFi upstream relay)
- **Hop 2**: WiFi Direct phone → GO's WS server (WiFi Direct upstream relay with `transport_label: "wifi-direct"`)
- **Hop 3**: BLE phone → WiFi Direct phone (BLE bridge, existing `bridge.rs`)

All message types (chat, CoT, voice, markers, DMs, reactions, pins) propagate through the full chain.

### Service Discovery

Uses Android DNS-SD (`_peatlink._tcp`) with TXT record advertising node_id, port, callsign, and `has_upstream` flag. Devices with `has_upstream=true` (connected to Go server) get `groupOwnerIntent=15` to become GO. Discovery runs in 30s on / 60s off duty cycles.

### Transport Priority Matrix

When a peer is reachable via multiple transports, the server deduplicates using a priority matrix (user settings can override):

| Priority | Transport | Bandwidth | Latency | Range |
|:---------|:----------|:----------|:--------|:------|
| 1 (best) | TCP | Unlimited | ~1ms | Unlimited |
| 2 | WiFi Direct | ~250 Mbps | ~10ms | ~200m |
| 3 | BLE | ~2 Mbps | ~50ms | ~30m |

The `deduplicatePeers()` function in `hub.go` ensures each peer appears only once in mesh state, using the best available transport. Users can override via Settings → Preferred Transport.

### BLE Voice Relay

Voice works over BLE without WebRTC via a native Opus codec path:

- **Capture**: `BleVoiceService.kt` uses Android `AudioRecord` (8kHz mono) to capture PCM audio, encodes to Opus via `MediaCodec` (8kbps, 20ms frames, single-frame batching), and queues for BLE transmission.
- **Transport**: 20ms audio drain loop with dual priority queues (audio first). `WRITE_TYPE_NO_RESPONSE` for audio frames (no ACK round-trip). ~1 KB/s per active speaker, using only 3-8% of available BLE bandwidth.
- **Playback**: 60ms jitter buffer with silence-reset. Incoming Opus frames decoded via `MediaCodec` and played through `AudioTrack`. Skips local playback when decoder is unavailable (bridges raw frames for remote WebRTC decode instead of producing garbage audio).
- **PTT**: `PeatLinkVoice` JavaScript bridge (`WebView.addJavascriptInterface`) exposes PTT controls, voice mode cycling (PTT/Noise Gate/Auto), and mute to the React UI.
- **Mesh backoff**: Mesh sync pauses during active voice (Serval Rhizome pattern) to free BLE bandwidth for audio frames.

### Message Flow

```
  WebView (React)
       |
   WS (localhost)
       |
  axum server (peatlink-mobile)
       |
  bridge.rs ── __ws: prefix ──> peat-btle chat channel
       |                              |
  upstream WS relay              BLE GATT (PeatBleService.kt)
  (Go server on LAN)                 |
                               Remote BLE peers
```

---

## Settings

Accessible via the gear icon in the sidebar header. Settings persist to `localStorage`.

| Section | Options |
|:--------|:--------|
| **Profile** | Display name |
| **Audio Input** | Microphone device, input volume slider |
| **Audio Output** | Speaker device |
| **Push-to-Talk** | PTT key binding (click to rebind) |
| **Voice Mode** | Push-to-talk, Noise Gate, or Auto (WebRTC VAD) |
| **Network** | Preferred transport (TCP, WiFi Direct, BLE) |
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
│       ├── upstream_relay.rs     #   WS client relay to Go server
│       ├── bridge.rs             #   BLE ↔ WS bridge (__ws: envelope protocol)
│       ├── ble.rs                #   BLE mesh transport
│       └── peatlink_mobile.udl   #   UniFFI interface definition
├── server/                       # Go WebSocket relay + voice + CoT
│   ├── hub.go                    #   room management, voice, CoT broker
│   ├── client.go                 #   WebSocket client + CoT position tracking
│   ├── room.go                   #   room state + voice channels + markers
│   ├── message.go                #   all message types (chat, voice, CoT)
│   ├── identity.go               #   blake3 room IDs, Ed25519 identity
│   └── *_test.go                 #   server unit tests (55+ tests)
├── web/                          # React + TypeScript frontend
│   └── src/
│       ├── components/           #   ChatView, Sidebar, MapViewer,
│       │                         #   MarkerForm, VoiceChannelList, VoiceBar,
│       │                         #   PTTButton, MeshViewer, SettingsPage...
│       ├── store/                #   chatStore + settingsStore (Zustand)
│       ├── hooks/                #   useWebSocket, usePTT, useGeolocation
│       ├── voice/                #   VoiceManager (WebRTC engine)
│       └── types/                #   TypeScript interfaces
├── mobile/
│   ├── android/                  # Kotlin shell + upstream relay + NSD discovery
│   │   └── app/src/main/kotlin/
│   │       ├── MainActivity.kt   #   WebView + UniFFI integration
│   │       ├── PeatLinkPrefs.kt  #   settings persistence (SharedPreferences)
│   │       ├── ble/
│   │       │   ├── PeatBleService.kt   # dual-role BLE driver (scan + advertise + GATT)
│   │       │   └── BleVoiceService.kt  # Opus voice capture/playback over BLE
│   │       ├── p2p/
│   │       │   └── PeatWifiDirectService.kt  # WiFi Direct discovery + group formation
│   │       └── net/
│   │           └── ServerDiscovery.kt  # mDNS/NSD Go server discovery
│   ├── sideload/                 # APK download page for sideloading
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
  set_preferred_transport          mesh_state {room_id, self_id, peers[]}
    {transport}                    error {message}
  register_ble_peer                ble_mesh_state {room_id, peers[]}
    {peer_id, peer_name,             (merges BLE/WiFi Direct peers)
     transport?}
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

### BLE Mesh Messages

```
  Client -> Server                  Server -> Client
 ------------------                ------------------
  voice_audio {room_id,            ble_mesh_state {room_id, peers[]}
    channel_id, audio}               (merges BLE peers into mesh view)
    (base64-encoded Opus frames)   peer_update {room_id, peer_id, event,
                                     connected_via}
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

**Mesh state** is broadcast every 5 seconds -- peer transport type, latency, connection health, and `connected_via` field (direct, ble_relay). The web UI renders this as a hierarchical topology graph with direct peers in an inner ring and BLE relay peers in an outer ring.

**Voice channels** use WebRTC for peer-to-peer audio. The server acts as a dumb signaling relay -- it forwards SDP and ICE messages between peers without inspecting them. Push-to-talk or open-mic mode; listen-only fallback when no mic is available.

**CoT positions** are broadcast every 5 seconds to all room members. Markers carry full CoT metadata (type, how, ce, le, hae, stale, remarks) for ATAK plugin interoperability.

**BLE mesh** -- On Android, `PeatBleService.kt` provides dual-role BLE (scan + advertise + GATT) with dual priority queues and 20ms audio drain. `bridge.rs` tunnels full WS JSON envelopes over the `peat-btle` chat channel using a `__ws:` prefix protocol. `BleVoiceService.kt` adds Opus 8kbps voice relay over BLE (~1KB/s per speaker) with 60ms jitter buffer. BLE peers are merged into the mesh view via `ble_mesh_state` messages with MAC→callsign promotion via `ble_hello` handshake.

**WiFi Direct** -- `PeatWifiDirectService.kt` handles Android WiFi Direct P2P discovery (DNS-SD `_peatlink._tcp`), group formation, and connection management. WiFi Direct clients connect to the Group Owner's embedded WS server and start an upstream relay, reusing the same relay code used for Go server connections. Multi-hop chains (Go Server → WiFi Relay → WiFi Direct Phone → BLE Phone) work transparently with all data types syncing through the relay chain.

**Transport priority** -- The server deduplicates peers reachable via multiple transports, preferring TCP > WiFi Direct > BLE by default. Users can override via `set_preferred_transport`. Implemented in `hub.go` via `transportPriority()` and `deduplicatePeers()`.

**PEAT ecosystem** -- peatlink-core uses `peat-mesh` 0.8 for identity, transport, CRDT storage, and mDNS discovery. `peat-btle` 0.2 provides BLE mesh transport for mobile with full WS bridge. The upstream Hive/peat-mesh defines `TransportType::WifiDirect` with pre-configured capabilities (250Mbps, 10ms, 200m) and PACE failover policy. Future integration planned with `peat-tak-bridge` for native ATAK CoT interop and `peat-gateway` for enterprise enrollment.

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

### Android

The Android app embeds the full PeatLink stack -- Rust server (axum WS), React UI, BLE mesh, and BLE voice relay -- in a single APK.

**What's inside:**
- `peatlink-mobile` cross-compiled for `arm64-v8a` and `x86_64` via `cargo-ndk`
- UniFFI-generated Kotlin bindings for the `MobileNode` interface
- React web dist bundled into APK assets, extracted to `filesDir` at runtime
- Embedded axum WS server starts on a random port, serves React UI from localhost via WebView
- **Upstream WS relay** -- connects to a Go server on the LAN, bidirectionally bridges all message types (chat, voice, CoT, DMs, reactions, edits, pins) with echo suppression
- **Passthrough channel** -- messages the local server doesn't handle (`start_dm`, `join_dm`, voice commands, CoT) forwarded to upstream
- **Downstream channel** -- upstream responses (`dm_opened`, `peer_update`, `mesh_state`) forwarded directly to WebView
- **BLE mesh** -- `PeatBleService.kt` runs a dual-role BLE driver (scanner + advertiser + GATT server/client). `bridge.rs` tunnels all WS message types over BLE using `__ws:`-prefixed JSON envelopes. Auto-starts when both WS server and BLE mesh are running.
- **BLE voice relay** -- `BleVoiceService.kt` captures audio via `AudioRecord`, encodes to Opus (16kHz mono, 24kbps, 20ms frames) via `MediaCodec`, and sends base64-encoded frames over BLE mesh. PTT exposed to React UI via `PeatLinkVoice` JavaScript bridge.
- **mDNS/NSD discovery** -- Android NSD discovers Go servers advertising `_peatlink._tcp` on LAN
- **Settings persistence** -- callsign, identity, and upstream URL saved to SharedPreferences and synced between React UI, local server, and upstream Go server
- **Connection status bar** -- tap to open settings; green/yellow/grey indicator shows upstream relay state

**Building:**

```bash
# Prerequisites
rustup target add aarch64-linux-android x86_64-linux-android
cargo install cargo-ndk
# Set ANDROID_NDK_HOME to your NDK path

# Build APK
make mobile-android

# The APK lands in mobile/android/app/build/outputs/apk/
```

**Sideloading:**

A self-contained sideload page is available at `mobile/sideload/index.html`. Host it on any web server alongside the APK for easy device installation. The Go server also registers itself via mDNS (`_peatlink._tcp`) so Android devices can auto-discover it on LAN.

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
| **peatlink-mobile** | axum 0.7, uniffi 0.28, tokio-tungstenite, futures-util, peat-mesh 0.8, peat-btle 0.2 (optional) |
| **Go server** | gorilla/websocket, blake3, google/uuid, grandcat/zeroconf (mDNS) |
| **Web** | React 18, Zustand 4.5, MapLibre GL 5, Tailwind CSS 3.4, Vite 5.4, TypeScript 5.5 |
| **Testing** | Go `testing` (55+ tests), Vitest, React Testing Library |

---

## License

[Apache-2.0](LICENSE)
