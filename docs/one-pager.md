<div align="center">

# PeatLink

### Decentralized Tactical Mesh Chat

*Secure peer-to-peer communication when infrastructure fails*

---

</div>

## The Problem

Traditional communication tools depend on centralized servers and reliable internet. In field operations, disaster response, remote deployments, and contested environments, that infrastructure is the first thing to go. Teams need a way to communicate that works regardless of network availability.

## The Solution

PeatLink is a **decentralized mesh communication platform** that enables text and voice chat between peers without requiring centralized infrastructure. Devices form an ad-hoc mesh network, relaying messages to reach every participant -- even when there is no internet connection.

<br>

| Capability | How It Works |
|:-----------|:-------------|
| **Text Chat** | Encrypted peer-to-peer messaging with conflict-free sync (CRDTs). Messages persist locally and merge automatically when peers reconnect. |
| **Voice Channels** | Push-to-talk voice over WebRTC. Audio flows directly between peers -- the server never touches it. Join a channel, hold a key, talk. |
| **Mesh Networking** | Built on [iroh](https://iroh.computer) gossip protocol. Devices relay data to extend range. Optional Bluetooth LE for fully offline mesh. |
| **Tactical Map** | Shared map powered by MapLibre + Protomaps. Live CoT (Cursor on Target) position syncing. Drop and share markers (rally points, objectives, hazards). |
| **Real-Time Topology** | Live visualization of the mesh network -- see every connected peer, their transport type, and latency at a glance. |

<br>

## Tech Stack

```
┌─────────────────────────────────────────────┐
│  Frontend        React 18 · TypeScript      │
│                  Zustand · Tailwind CSS      │
│                  WebRTC (voice)              │
│                  MapLibre GL JS · Protomaps  │
├─────────────────────────────────────────────┤
│  Server          Go (WebSocket relay +      │
│                  voice signaling)            │
├─────────────────────────────────────────────┤
│  Core Engine     Rust · iroh P2P · blake3   │
│                  Automerge CRDTs            │
│                  peat-mesh (Ed25519 identity)│
├─────────────────────────────────────────────┤
│  Mobile          Android (Kotlin) · iOS     │
│                  (Swift) · UniFFI bindings   │
│                  Optional BLE mesh           │
└─────────────────────────────────────────────┘
```

## Deployment Modes

| Mode | Use Case | Connectivity Required |
|:-----|:---------|:---------------------|
| **Web** | Command post, ops center | LAN or internet |
| **CLI** | Headless nodes, scripting | Any IP network |
| **Mobile** | Field personnel | None (BLE mesh) |

## Key Differentiators

- **No single point of failure** -- fully decentralized, no cloud dependency
- **Works offline** -- Bluetooth LE mesh for zero-infrastructure environments
- **Conflict-free sync** -- Automerge CRDTs guarantee message consistency without coordination
- **Persistent identity** -- Ed25519 keypairs provide cryptographic identity across sessions
- **Voice without servers** -- WebRTC peer-to-peer audio, server only relays signaling metadata
- **Cross-platform** -- Web, desktop CLI, Android, iOS from a single codebase

## Current Status

| Component | Status |
|:----------|:-------|
| Core mesh library (Rust) | Complete |
| WebSocket server (Go) | Complete |
| Web UI + voice channels | Complete |
| Settings & configuration | Complete |
| Mobile shells (Android/iOS) | Functional (BLE integration in progress) |
| Tactical map + CoT sync | Complete |
| Test suite | 102 tests passing (47 Go + 55 Web) |

## What's Next

- **End-to-end encryption** for all message content
- **File sharing** over the mesh network
- **BLE mesh integration** on native Android/iOS
- **SFU mode** for larger voice groups (10+ participants)
- **Relay nodes** for bridging disconnected mesh segments

---

<div align="center">

**Apache-2.0** · Built with Rust, Go, React, and WebRTC

</div>
