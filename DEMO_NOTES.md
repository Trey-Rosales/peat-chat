# PeatLink Demo Notes

## Setup
1. Start Go server: `cd server && ./peatlink-server -port 8090`
2. Start sideload server: `cd mobile/sideload && python3 -m http.server 9090 --bind 0.0.0.0`
3. Open Mac browser: `http://localhost:8090`
4. Install APK on phones: `http://<mac-ip>:9090`

## What Works
- Multi-hop mesh: Mac ↔ WiFi phone ↔ BLE phone
- Chat with correct callsigns across all devices
- DMs between any peers
- CoT/GPS position sharing with correct attribution
- Map markers
- Presence/mesh viewer with hierarchical BLE topology
- Room history sync over BLE
- Reactions, edits, pins
- Voice channels: Mac ↔ WiFi phone (WebRTC)

## Known Limitations
- Voice audio over BLE is PTT clips (not real-time streaming)
- BLE phone voice channel may show limited state
- First few messages on BLE connection may take a moment to stabilize
- Restarting the Go server clears message history
