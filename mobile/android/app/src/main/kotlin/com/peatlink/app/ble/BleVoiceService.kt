package com.peatlink.app.ble

import android.annotation.SuppressLint
import android.media.*
import android.util.Log
import kotlinx.coroutines.*
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Native BLE voice service — completely bypasses WebView.
 *
 * Audio path:
 *   Capture: AudioRecord → PCM → MediaCodec Opus 8kbps → queued frames
 *   Send: PeatBleService tick loop reads frames → GATT write (type byte 0xAA + opus data)
 *   Receive: GATT notification with 0xAA prefix → decode Opus → jitter buffer → AudioTrack
 *
 * Half-duplex PTT model. 8kHz mono Opus at 6-8kbps = ~1KB/s, well within BLE budget.
 */
@SuppressLint("MissingPermission")
class BleVoiceService {

    companion object {
        private const val TAG = "BleVoice"
        const val AUDIO_FRAME_PREFIX: Byte = 0xAA.toByte() // distinguishes audio from data
        private const val SAMPLE_RATE = 8000  // 8kHz narrowband — minimum for voice
        private const val FRAME_SIZE_MS = 20
        private const val FRAME_SAMPLES = SAMPLE_RATE * FRAME_SIZE_MS / 1000 // 160 samples
        private const val BITRATE = 8000 // 8kbps Opus — ~1KB/s, leaves headroom for mesh
        private const val FRAMES_PER_BATCH = 3 // batch 3 frames = 60ms per GATT write
        private const val JITTER_BUFFER_MS = 80L
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Capture
    private var audioRecord: AudioRecord? = null
    private var encoder: MediaCodec? = null
    private var captureJob: Job? = null
    @Volatile var transmitting = false
        private set

    // Playback
    private var audioTrack: AudioTrack? = null
    private var decoder: MediaCodec? = null
    private var playbackJob: Job? = null
    private val incomingFrames = ConcurrentLinkedQueue<ByteArray>()

    // Outgoing queue — PeatBleService reads from this
    val outgoingAudioFrames = ConcurrentLinkedQueue<ByteArray>()

    private var running = false

    fun start() {
        if (running) return
        running = true
        initPlayback()
        startPlaybackLoop()
        Log.i(TAG, "BLE voice service started (${SAMPLE_RATE}Hz, ${BITRATE}bps Opus)")
    }

    fun stop() {
        running = false
        stopTransmitting()
        playbackJob?.cancel()
        releasePlayback()
        Log.i(TAG, "BLE voice service stopped")
    }

    fun startTransmitting() {
        if (transmitting) return
        transmitting = true
        initCapture()
        captureJob = scope.launch { captureLoop() }
        Log.i(TAG, "PTT: transmitting")
    }

    fun stopTransmitting() {
        if (!transmitting) return
        transmitting = false
        captureJob?.cancel()
        releaseCapture()
        Log.i(TAG, "PTT: stopped")
    }

    /**
     * Called by PeatBleService when GATT data with AUDIO_FRAME_PREFIX arrives.
     */
    fun onAudioFrameReceived(opusData: ByteArray) {
        incomingFrames.add(opusData)
    }

    // --- Capture ---

    private fun initCapture() {
        val bufSize = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(FRAME_SAMPLES * 2 * 4)

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, bufSize
        )

        encoder = try {
            MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS).apply {
                val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, SAMPLE_RATE, 1)
                fmt.setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
                fmt.setInteger(MediaFormat.KEY_COMPLEXITY, 3) // lower complexity = less CPU
                configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                start()
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Opus encoder unavailable: ${e.message}")
            null
        }

        audioRecord?.startRecording()
    }

    private fun releaseCapture() {
        try { audioRecord?.stop() } catch (_: Throwable) {}
        try { audioRecord?.release() } catch (_: Throwable) {}
        audioRecord = null
        try { encoder?.stop() } catch (_: Throwable) {}
        try { encoder?.release() } catch (_: Throwable) {}
        encoder = null
    }

    private suspend fun captureLoop() {
        val pcmBuf = ShortArray(FRAME_SAMPLES)
        val batchBuffer = mutableListOf<ByteArray>()

        while (transmitting) {
            val read = audioRecord?.read(pcmBuf, 0, FRAME_SAMPLES) ?: -1
            if (read <= 0) { delay(5); continue }

            val enc = encoder
            if (enc != null) {
                val encoded = encodeOpusFrame(enc, pcmBuf, read)
                if (encoded != null) {
                    batchBuffer.add(encoded)
                    if (batchBuffer.size >= FRAMES_PER_BATCH) {
                        // Combine frames with length prefix: [len1(2), data1, len2(2), data2, ...]
                        val packet = buildBatchPacket(batchBuffer)
                        outgoingAudioFrames.add(packet)
                        batchBuffer.clear()
                    }
                }
            } else {
                // No Opus — send raw PCM (higher bandwidth)
                val raw = ByteArray(read * 2)
                for (i in 0 until read) {
                    raw[i * 2] = (pcmBuf[i].toInt() and 0xFF).toByte()
                    raw[i * 2 + 1] = (pcmBuf[i].toInt() shr 8).toByte()
                }
                outgoingAudioFrames.add(raw)
            }
        }
        // Flush remaining
        if (batchBuffer.isNotEmpty()) {
            outgoingAudioFrames.add(buildBatchPacket(batchBuffer))
        }
    }

    private fun buildBatchPacket(frames: List<ByteArray>): ByteArray {
        var totalSize = 0
        for (f in frames) totalSize += 2 + f.size
        val packet = ByteArray(totalSize)
        var offset = 0
        for (f in frames) {
            packet[offset] = (f.size and 0xFF).toByte()
            packet[offset + 1] = (f.size shr 8 and 0xFF).toByte()
            f.copyInto(packet, offset + 2)
            offset += 2 + f.size
        }
        return packet
    }

    private fun encodeOpusFrame(codec: MediaCodec, pcm: ShortArray, count: Int): ByteArray? {
        val inputIdx = codec.dequeueInputBuffer(5000)
        if (inputIdx >= 0) {
            val buf = codec.getInputBuffer(inputIdx) ?: return null
            buf.clear()
            val bytes = ByteArray(count * 2)
            for (i in 0 until count) {
                bytes[i * 2] = (pcm[i].toInt() and 0xFF).toByte()
                bytes[i * 2 + 1] = (pcm[i].toInt() shr 8).toByte()
            }
            buf.put(bytes)
            codec.queueInputBuffer(inputIdx, 0, bytes.size, 0, 0)
        }
        val info = MediaCodec.BufferInfo()
        val outIdx = codec.dequeueOutputBuffer(info, 5000)
        if (outIdx >= 0) {
            val buf = codec.getOutputBuffer(outIdx) ?: return null
            val out = ByteArray(info.size)
            buf.get(out)
            codec.releaseOutputBuffer(outIdx, false)
            return out
        }
        return null
    }

    // --- Playback ---

    private fun initPlayback() {
        val bufSize = AudioTrack.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(FRAME_SAMPLES * 4)

        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setAudioFormat(AudioFormat.Builder()
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setBufferSizeInBytes(bufSize)
            .setTransferMode(AudioTrack.MODE_STREAM).build()

        decoder = try {
            MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS).apply {
                val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, SAMPLE_RATE, 1)
                val csd0 = ByteArray(19)
                "OpusHead".toByteArray().copyInto(csd0)
                csd0[8] = 1; csd0[9] = 1 // version=1, channels=1
                fmt.setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(csd0))
                configure(fmt, null, null, 0)
                start()
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Opus decoder unavailable: ${e.message}")
            null
        }

        audioTrack?.play()
    }

    private fun releasePlayback() {
        try { audioTrack?.stop() } catch (_: Throwable) {}
        try { audioTrack?.release() } catch (_: Throwable) {}
        audioTrack = null
        try { decoder?.stop() } catch (_: Throwable) {}
        try { decoder?.release() } catch (_: Throwable) {}
        decoder = null
    }

    private fun startPlaybackLoop() {
        playbackJob = scope.launch {
            while (running) {
                val frame = incomingFrames.poll()
                if (frame != null) {
                    playBatchPacket(frame)
                } else {
                    delay(5)
                }
            }
        }
    }

    private fun playBatchPacket(packet: ByteArray) {
        val track = audioTrack ?: return
        var offset = 0
        while (offset + 2 <= packet.size) {
            val len = (packet[offset].toInt() and 0xFF) or ((packet[offset + 1].toInt() and 0xFF) shl 8)
            offset += 2
            if (offset + len > packet.size) break
            val opusFrame = packet.copyOfRange(offset, offset + len)
            offset += len

            val dec = decoder
            if (dec != null) {
                val pcm = decodeOpusFrame(dec, opusFrame)
                if (pcm != null) {
                    track.write(pcm, 0, pcm.size)
                }
            } else {
                // Raw PCM fallback
                track.write(opusFrame, 0, opusFrame.size)
            }
        }
    }

    private fun decodeOpusFrame(codec: MediaCodec, opus: ByteArray): ByteArray? {
        val inputIdx = codec.dequeueInputBuffer(5000)
        if (inputIdx >= 0) {
            val buf = codec.getInputBuffer(inputIdx) ?: return null
            buf.clear(); buf.put(opus)
            codec.queueInputBuffer(inputIdx, 0, opus.size, 0, 0)
        }
        val info = MediaCodec.BufferInfo()
        val outIdx = codec.dequeueOutputBuffer(info, 5000)
        if (outIdx >= 0) {
            val buf = codec.getOutputBuffer(outIdx) ?: return null
            val pcm = ByteArray(info.size)
            buf.get(pcm)
            codec.releaseOutputBuffer(outIdx, false)
            return pcm
        }
        return null
    }
}
