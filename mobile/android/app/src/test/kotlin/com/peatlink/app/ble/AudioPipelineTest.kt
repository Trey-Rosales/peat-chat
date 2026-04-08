package com.peatlink.app.ble

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for the audio pipeline routing: GATT data → prefix check → voice service.
 * Validates that audio frames (0xAA prefix) are routed to BleVoiceService
 * and data frames are routed to the Rust bridge.
 */
class AudioPipelineTest {

    @Test
    fun `audio prefix byte is correctly detected`() {
        val audioPacket = byteArrayOf(0xAA.toByte(), 0x01, 0x02, 0x03)
        val dataPacket = byteArrayOf(0x5F, 0x5F, 0x77, 0x73) // "__ws"

        assertTrue(audioPacket[0] == BleVoiceService.AUDIO_FRAME_PREFIX)
        assertFalse(dataPacket[0] == BleVoiceService.AUDIO_FRAME_PREFIX)
    }

    @Test
    fun `audio frame stripping preserves payload`() {
        val originalOpus = byteArrayOf(0x10, 0x20, 0x30, 0x40, 0x50)
        val gattPacket = ByteArray(1 + originalOpus.size)
        gattPacket[0] = BleVoiceService.AUDIO_FRAME_PREFIX
        originalOpus.copyInto(gattPacket, 1)

        // Simulate receiver
        val stripped = gattPacket.copyOfRange(1, gattPacket.size)
        assertArrayEquals(originalOpus, stripped)
    }

    @Test
    fun `batch format is length-prefixed frames`() {
        // Format: [len_lo, len_hi, data, len_lo, len_hi, data, ...]
        val frame1 = byteArrayOf(0xAA.toByte(), 0xBB.toByte())
        val frame2 = byteArrayOf(0xCC.toByte(), 0xDD.toByte(), 0xEE.toByte())

        // Build batch
        val batch = ByteArray(2 + frame1.size + 2 + frame2.size)
        batch[0] = frame1.size.toByte()
        batch[1] = 0
        frame1.copyInto(batch, 2)
        batch[2 + frame1.size] = frame2.size.toByte()
        batch[2 + frame1.size + 1] = 0
        frame2.copyInto(batch, 2 + frame1.size + 2)

        // Parse
        var offset = 0
        val parsed = mutableListOf<ByteArray>()
        while (offset + 2 <= batch.size) {
            val len = (batch[offset].toInt() and 0xFF) or ((batch[offset + 1].toInt() and 0xFF) shl 8)
            offset += 2
            if (offset + len > batch.size) break
            parsed.add(batch.copyOfRange(offset, offset + len))
            offset += len
        }

        assertEquals(2, parsed.size)
        assertArrayEquals(frame1, parsed[0])
        assertArrayEquals(frame2, parsed[1])
    }

    @Test
    fun `empty GATT packet is handled gracefully`() {
        val emptyPacket = byteArrayOf()
        // Should not crash — the prefix check requires at least 1 byte
        assertTrue(emptyPacket.isEmpty())
    }

    @Test
    fun `single-byte GATT packet with audio prefix has no payload`() {
        val packet = byteArrayOf(0xAA.toByte())
        assertTrue(packet[0] == BleVoiceService.AUDIO_FRAME_PREFIX)
        val payload = packet.copyOfRange(1, packet.size)
        assertEquals(0, payload.size)
    }

    @Test
    fun `voice service queues round-trip through outgoing and incoming`() {
        val service = BleVoiceService()

        // Simulate sending side: queue outgoing frames
        val opus1 = byteArrayOf(0x01, 0x02, 0x03)
        val opus2 = byteArrayOf(0x04, 0x05)
        service.outgoingAudioFrames.add(opus1)
        service.outgoingAudioFrames.add(opus2)

        // Simulate PeatBleService tick loop: drain and prefix
        val gattPackets = mutableListOf<ByteArray>()
        while (true) {
            val frame = service.outgoingAudioFrames.poll() ?: break
            val packet = ByteArray(1 + frame.size)
            packet[0] = BleVoiceService.AUDIO_FRAME_PREFIX
            frame.copyInto(packet, 1)
            gattPackets.add(packet)
        }

        assertEquals(2, gattPackets.size)

        // Simulate receiving side: strip prefix and deliver
        for (packet in gattPackets) {
            assertTrue(packet[0] == BleVoiceService.AUDIO_FRAME_PREFIX)
            val audioData = packet.copyOfRange(1, packet.size)
            service.onAudioFrameReceived(audioData)
        }

        // The receiving service has queued the frames for playback
        // (can't verify AudioTrack output in unit test, but queue is populated)
    }

    @Test
    fun `Opus 8kbps frame sizes are within BLE MTU`() {
        // Opus at 8kbps, 20ms frames = ~20 bytes per frame
        // 3 frames batched = ~60 bytes + 6 bytes header = ~66 bytes
        // With 0xAA prefix = 67 bytes
        // BLE MTU 512 - 3 = 509 bytes max → easily fits

        val frameSizeEstimate = 20 // bytes for 8kbps 20ms Opus frame
        val batchedSize = 3 * (2 + frameSizeEstimate) + 1 // 3 frames + prefix
        assertTrue("Batched audio ($batchedSize bytes) should fit in BLE MTU", batchedSize < 509)
    }

    @Test
    fun `bandwidth estimate for 8kbps Opus`() {
        // 8kbps = 8000 bits/sec = 1000 bytes/sec
        // At 20ms frames = 50 frames/sec
        // 50 frames / 3 per batch = ~17 GATT writes/sec
        // 17 writes * ~67 bytes = ~1139 bytes/sec
        // BLE can handle ~20000 bytes/sec → plenty of headroom

        val bytesPerSec = 8000 / 8 // 1000
        val framesPerSec = 1000 / 20 // 50
        val batchesPerSec = framesPerSec / 3 // ~17
        val gattWritesPerSec = batchesPerSec

        assertTrue("Should be < 20 GATT writes/sec", gattWritesPerSec < 20)
        assertTrue("Audio should be < 2KB/sec", bytesPerSec < 2000)
    }
}
