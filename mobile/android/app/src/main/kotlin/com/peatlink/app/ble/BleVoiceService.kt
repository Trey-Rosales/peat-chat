package com.peatlink.app.ble

import android.annotation.SuppressLint
import android.media.*
import android.util.Log
import com.konovalov.vad.Vad
import com.konovalov.vad.config.FrameSize
import com.konovalov.vad.config.Mode
import com.konovalov.vad.config.SampleRate
import com.konovalov.vad.models.VadModel
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

    enum class VoiceMode { PTT, NOISE_GATE, AUTO }

    companion object {
        private const val TAG = "BleVoice"
        const val AUDIO_FRAME_PREFIX: Byte = 0xAA.toByte()
        private const val SAMPLE_RATE = 8000
        private const val FRAME_SIZE_MS = 20
        private const val FRAME_SAMPLES = SAMPLE_RATE * FRAME_SIZE_MS / 1000 // 160 samples
        private const val BITRATE = 8000
        private const val FRAMES_PER_BATCH = 1
        private const val SILENCE_TIMEOUT_MS = 300L // stop sending after 300ms of silence
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Voice mode settings
    var voiceMode: VoiceMode = VoiceMode.PTT
    var noiseGateThresholdDb: Float = -40f // dB threshold for noise gate mode
    @Volatile var currentMicLevelDb: Float = -96f // current mic level for UI meter
        private set
    @Volatile var voiceDetected: Boolean = false
        private set

    // Capture
    private var audioRecord: AudioRecord? = null
    private var noiseSuppressor: android.media.audiofx.NoiseSuppressor? = null
    private var encoder: MediaCodec? = null
    private var captureJob: Job? = null
    private var continuousCaptureJob: Job? = null
    @Volatile var transmitting = false
        private set
    @Volatile var muted = false // mic mute

    // Playback
    private var audioTrack: AudioTrack? = null
    private var decoder: MediaCodec? = null
    private var playbackJob: Job? = null
    private val incomingFrames = ConcurrentLinkedQueue<ByteArray>()

    // Outgoing queue — PeatBleService reads from this and sends via GATT
    val outgoingAudioFrames = ConcurrentLinkedQueue<ByteArray>()

    // Decoded PCM queue for JS bridge (WiFi phone feeds this into WebRTC for Mac)
    private val decodedPcmForBridge = ConcurrentLinkedQueue<ByteArray>()
    private val MAX_BRIDGE_FRAMES = 50

    // Also queue local mic PCM for WebRTC (WiFi phone's own voice → Mac)
    var bridgeLocalMic = false // set true when WiFi phone needs local mic in WebRTC

    // PCM frames from WebRTC (Mac audio → encode → send via BLE)
    private var bridgeEncoder: MediaCodec? = null

    // WebRTC VAD for auto mode
    private var vad: VadModel? = null

    private var running = false

    fun start() {
        if (running) return
        running = true
        try { initPlayback() } catch (e: Throwable) { Log.e(TAG, "Playback init failed: ${e.message}") }
        try { initBridgeEncoder() } catch (e: Throwable) { Log.e(TAG, "Bridge encoder init failed: ${e.message}") }
        // VAD init is lazy — only when continuous mode is activated
        try { startPlaybackLoop() } catch (e: Throwable) { Log.e(TAG, "Playback loop failed: ${e.message}") }
        Log.i(TAG, "BLE voice service started (${SAMPLE_RATE}Hz, ${BITRATE}bps Opus)")
    }

    fun stop() {
        running = false
        try { stopTransmitting() } catch (_: Throwable) {}
        try { stopContinuous() } catch (_: Throwable) {}
        try { playbackJob?.cancel() } catch (_: Throwable) {}
        try { releasePlayback() } catch (_: Throwable) {}
        try { releaseBridgeEncoder() } catch (_: Throwable) {}
        try { releaseVad() } catch (_: Throwable) {}
        Log.i(TAG, "BLE voice service stopped")
    }

    private fun initVad() {
        vad = try {
            // Probe if the Vad native library loads successfully.
            // Class.forName triggers static initialization which loads libvad_jni.so.
            Class.forName("com.konovalov.vad.Vad")
            // If we get here, the native library loaded successfully.
            Vad.builder()
                .setModel(com.konovalov.vad.config.Model.WEB_RTC_GMM)
                .setSampleRate(SampleRate.SAMPLE_RATE_8K)
                .setFrameSize(FrameSize.FRAME_SIZE_160)
                .setMode(Mode.NORMAL)
                .build()
        } catch (e: Throwable) {
            Log.w(TAG, "WebRTC VAD unavailable: ${e.javaClass.simpleName}: ${e.message}")
            null
        }
    }

    private fun releaseVad() {
        try { vad?.close() } catch (_: Throwable) {}
        vad = null
    }

    // --- JS Bridge methods (WiFi phone only — feeds WebRTC) ---

    /** Get decoded PCM frames for the VoiceManager to inject into WebRTC */
    fun drainDecodedPcm(): List<ByteArray> {
        val frames = mutableListOf<ByteArray>()
        while (true) {
            val frame = decodedPcmForBridge.poll() ?: break
            frames.add(frame)
        }
        return frames
    }

    /** Receive PCM from WebRTC (Mac audio), encode to Opus, queue for BLE */
    fun ingestPcmFromWebRTC(pcmBytes: ByteArray) {
        if (pcmBytes.isEmpty()) return
        val sampleCount = pcmBytes.size / 2
        val pcm = ShortArray(sampleCount)
        for (i in 0 until sampleCount) {
            pcm[i] = ((pcmBytes[i * 2].toInt() and 0xFF) or
                       (pcmBytes[i * 2 + 1].toInt() shl 8)).toShort()
        }
        synchronized(this) {
            val enc = bridgeEncoder ?: return
            val encoded = encodeOpusFrame(enc, pcm, sampleCount)
            if (encoded != null) {
                // Send as single frame (from WebRTC, no batching needed)
                val batch = buildBatchPacket(listOf(encoded))
                outgoingAudioFrames.add(batch)
            }
        }
    }

    private fun initBridgeEncoder() {
        bridgeEncoder = try {
            MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS).apply {
                val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, SAMPLE_RATE, 1)
                fmt.setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
                fmt.setInteger(MediaFormat.KEY_COMPLEXITY, 3)
                configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                start()
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Bridge Opus encoder unavailable: ${e.message}")
            null
        }
    }

    private fun releaseBridgeEncoder() {
        try { bridgeEncoder?.stop() } catch (_: Throwable) {}
        try { bridgeEncoder?.release() } catch (_: Throwable) {}
        bridgeEncoder = null
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

    /** Start continuous voice-activated transmission (noise gate or auto mode) */
    fun startContinuous() {
        if (continuousCaptureJob != null) return
        try { initCapture() } catch (e: Throwable) { Log.e(TAG, "Capture init failed: ${e.message}"); return }
        // Lazy VAD init — only load native library when actually needed
        if (vad == null && voiceMode == VoiceMode.AUTO) {
            try { initVad() } catch (e: Throwable) { Log.w(TAG, "VAD init failed, using energy gate: ${e.message}") }
        }
        continuousCaptureJob = scope.launch { continuousCaptureLoop() }
        Log.i(TAG, "Continuous capture started (mode=$voiceMode, threshold=${noiseGateThresholdDb}dB)")
    }

    fun stopContinuous() {
        continuousCaptureJob?.cancel()
        continuousCaptureJob = null
        releaseCapture()
        voiceDetected = false
        Log.i(TAG, "Continuous capture stopped")
    }

    private suspend fun continuousCaptureLoop() {
        val pcmBuf = ShortArray(FRAME_SAMPLES)
        val batchBuffer = mutableListOf<ByteArray>()
        var silenceSince = 0L

        while (true) {
            val read = audioRecord?.read(pcmBuf, 0, FRAME_SAMPLES) ?: -1
            if (read <= 0) { delay(5); continue }

            // Compute RMS energy in dB
            var sumSq = 0.0
            for (i in 0 until read) {
                val s = pcmBuf[i].toDouble()
                sumSq += s * s
            }
            val rms = Math.sqrt(sumSq / read)
            val db = if (rms > 0) (20 * Math.log10(rms / 32768.0)).toFloat() else -96f
            currentMicLevelDb = db

            if (muted) { voiceDetected = false; continue }

            // Determine if voice is active
            val isVoice = when (voiceMode) {
                VoiceMode.NOISE_GATE -> db > noiseGateThresholdDb
                VoiceMode.AUTO -> {
                    // Use WebRTC VAD if available, fall back to energy-based
                    val vadResult = try { vad?.isSpeech(pcmBuf) } catch (_: Throwable) { null }
                    vadResult ?: (db > noiseGateThresholdDb)
                }
                VoiceMode.PTT -> transmitting
            }

            if (isVoice) {
                voiceDetected = true
                silenceSince = 0L

                // Queue raw PCM for WebRTC bridge (WiFi phone's own mic → Mac)
                if (bridgeLocalMic) {
                    val pcmBytes = ByteArray(read * 2)
                    for (i in 0 until read) {
                        pcmBytes[i * 2] = (pcmBuf[i].toInt() and 0xFF).toByte()
                        pcmBytes[i * 2 + 1] = (pcmBuf[i].toInt() shr 8).toByte()
                    }
                    decodedPcmForBridge.add(pcmBytes)
                    while (decodedPcmForBridge.size > MAX_BRIDGE_FRAMES) {
                        decodedPcmForBridge.poll()
                    }
                }

                val enc = encoder
                if (enc != null) {
                    val encoded = encodeOpusFrame(enc, pcmBuf, read)
                    if (encoded != null) {
                        batchBuffer.add(encoded)
                        if (batchBuffer.size >= FRAMES_PER_BATCH) {
                            outgoingAudioFrames.add(buildBatchPacket(batchBuffer))
                            batchBuffer.clear()
                        }
                    }
                }
            } else {
                if (voiceDetected) {
                    if (silenceSince == 0L) silenceSince = System.currentTimeMillis()
                    if (System.currentTimeMillis() - silenceSince > SILENCE_TIMEOUT_MS) {
                        // Flush remaining frames
                        if (batchBuffer.isNotEmpty()) {
                            outgoingAudioFrames.add(buildBatchPacket(batchBuffer))
                            batchBuffer.clear()
                        }
                        voiceDetected = false
                    } else {
                        // Keep sending during grace period
                        val enc = encoder
                        if (enc != null) {
                            val encoded = encodeOpusFrame(enc, pcmBuf, read)
                            if (encoded != null) {
                                batchBuffer.add(encoded)
                                if (batchBuffer.size >= FRAMES_PER_BATCH) {
                                    outgoingAudioFrames.add(buildBatchPacket(batchBuffer))
                                    batchBuffer.clear()
                                }
                            }
                        }
                    }
                }
            }
        }
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

        // Enable platform noise suppression (free, OEM-provided)
        val sessionId = audioRecord?.audioSessionId ?: 0
        if (android.media.audiofx.NoiseSuppressor.isAvailable()) {
            noiseSuppressor = try {
                android.media.audiofx.NoiseSuppressor.create(sessionId).also {
                    it.enabled = true
                    Log.i(TAG, "Platform NoiseSuppressor enabled")
                }
            } catch (e: Throwable) {
                Log.w(TAG, "NoiseSuppressor failed: ${e.message}")
                null
            }
        }
    }

    private fun releaseCapture() {
        try { noiseSuppressor?.release() } catch (_: Throwable) {}
        noiseSuppressor = null
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
            if (muted) continue

            // Queue raw PCM for WebRTC bridge
            if (bridgeLocalMic) {
                val pcmBytes = ByteArray(read * 2)
                for (i in 0 until read) {
                    pcmBytes[i * 2] = (pcmBuf[i].toInt() and 0xFF).toByte()
                    pcmBytes[i * 2 + 1] = (pcmBuf[i].toInt() shr 8).toByte()
                }
                decodedPcmForBridge.add(pcmBytes)
                while (decodedPcmForBridge.size > MAX_BRIDGE_FRAMES) {
                    decodedPcmForBridge.poll()
                }
            }

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
            val jitterMs = 60L
            var lastFrameTime = 0L

            while (running) {
                val frame = incomingFrames.poll()
                if (frame != null) {
                    val now = System.currentTimeMillis()
                    if (lastFrameTime == 0L) {
                        // First frame — wait for jitter buffer to fill
                        delay(jitterMs)
                    }
                    lastFrameTime = now
                    playBatchPacket(frame)
                } else {
                    if (lastFrameTime > 0L && System.currentTimeMillis() - lastFrameTime > 500L) {
                        // Extended silence — reset jitter state
                        lastFrameTime = 0L
                    }
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
                    // Also queue for JS bridge (WiFi phone → WebRTC → Mac)
                    decodedPcmForBridge.add(pcm)
                    while (decodedPcmForBridge.size > MAX_BRIDGE_FRAMES) {
                        decodedPcmForBridge.poll()
                    }
                }
            } else {
                // Opus decoder unavailable — cannot play locally, but still bridge
                // raw frames for WebRTC decode on the other end
                decodedPcmForBridge.add(opusFrame)
                while (decodedPcmForBridge.size > MAX_BRIDGE_FRAMES) {
                    decodedPcmForBridge.poll()
                }
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
