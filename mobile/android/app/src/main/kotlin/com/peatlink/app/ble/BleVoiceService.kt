package com.peatlink.app.ble

import android.annotation.SuppressLint
import android.media.*
import android.util.Log
import com.peatlink.ffi.MobileNode
import kotlinx.coroutines.*

/**
 * BLE voice audio service — captures audio via AudioRecord, encodes with
 * Android's MediaCodec (Opus), sends frames over BLE mesh via MobileNode.
 * Receives Opus frames from BLE peers and plays via AudioTrack.
 *
 * PTT model: call startTransmitting() when PTT pressed, stopTransmitting() when released.
 * Playback runs continuously, playing any frames received from BLE peers.
 */
@SuppressLint("MissingPermission")
class BleVoiceService(private val node: MobileNode) {

    companion object {
        private const val TAG = "BleVoice"
        private const val SAMPLE_RATE = 16000 // 16kHz — good balance of quality vs bandwidth
        private const val FRAME_SIZE_MS = 20  // 20ms frames — standard Opus frame size
        private const val FRAME_SAMPLES = SAMPLE_RATE * FRAME_SIZE_MS / 1000 // 320 samples
        private const val BITRATE = 24000 // 24kbps — good voice quality, ~3KB/s
        private const val PLAYBACK_POLL_MS = 10L
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var captureJob: Job? = null
    private var playbackJob: Job? = null

    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private var encoder: MediaCodec? = null
    private var decoder: MediaCodec? = null

    private var transmitting = false
    private var running = false

    /**
     * Start the playback loop (runs continuously to play received BLE audio).
     */
    fun start() {
        if (running) return
        running = true
        initPlayback()
        startPlaybackLoop()
        Log.i(TAG, "BLE voice service started")
    }

    fun stop() {
        if (!running) return
        running = false
        stopTransmitting()
        captureJob?.cancel()
        playbackJob?.cancel()
        releasePlayback()
        Log.i(TAG, "BLE voice service stopped")
    }

    /**
     * Start transmitting (PTT pressed).
     * Captures audio from mic, encodes as Opus, sends via BLE.
     */
    fun startTransmitting(senderId: String, senderName: String) {
        if (transmitting) return
        transmitting = true
        initCapture()
        captureJob = scope.launch {
            captureLoop(senderId, senderName)
        }
        Log.i(TAG, "Transmitting started")
    }

    /**
     * Stop transmitting (PTT released).
     */
    fun stopTransmitting() {
        if (!transmitting) return
        transmitting = false
        captureJob?.cancel()
        captureJob = null
        releaseCapture()
        Log.i(TAG, "Transmitting stopped")
    }

    val isTransmitting: Boolean get() = transmitting

    // --- Capture (mic → Opus → BLE) ---

    private fun initCapture() {
        val bufSize = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(FRAME_SAMPLES * 2) // at least one frame

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufSize
        )

        // Use MediaCodec for Opus encoding
        try {
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS)
            val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, SAMPLE_RATE, 1)
            format.setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
            format.setInteger(MediaFormat.KEY_COMPLEXITY, 5)
            encoder?.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder?.start()
        } catch (e: Throwable) {
            Log.w(TAG, "MediaCodec Opus encoder not available: ${e.message}")
            encoder = null
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

    private suspend fun captureLoop(senderId: String, senderName: String) {
        val pcmBuffer = ShortArray(FRAME_SAMPLES)
        val record = audioRecord ?: return

        while (transmitting) {
            val read = record.read(pcmBuffer, 0, FRAME_SAMPLES)
            if (read <= 0) {
                delay(5)
                continue
            }

            val enc = encoder
            if (enc != null) {
                // Encode with MediaCodec
                val encoded = encodeFrame(enc, pcmBuffer, read)
                if (encoded != null) {
                    node.sendVoiceFrame(encoded.map { it.toUByte() }, senderId, senderName)
                }
            } else {
                // Fallback: send raw PCM (higher bandwidth but always works)
                val rawBytes = ByteArray(read * 2)
                for (i in 0 until read) {
                    rawBytes[i * 2] = (pcmBuffer[i].toInt() and 0xFF).toByte()
                    rawBytes[i * 2 + 1] = (pcmBuffer[i].toInt() shr 8 and 0xFF).toByte()
                }
                node.sendVoiceFrame(rawBytes.map { it.toUByte() }, senderId, senderName)
            }
        }
    }

    private fun encodeFrame(codec: MediaCodec, pcm: ShortArray, sampleCount: Int): ByteArray? {
        // Feed PCM to encoder
        val inputIdx = codec.dequeueInputBuffer(5000)
        if (inputIdx >= 0) {
            val inputBuf = codec.getInputBuffer(inputIdx) ?: return null
            inputBuf.clear()
            val byteArray = ByteArray(sampleCount * 2)
            for (i in 0 until sampleCount) {
                byteArray[i * 2] = (pcm[i].toInt() and 0xFF).toByte()
                byteArray[i * 2 + 1] = (pcm[i].toInt() shr 8 and 0xFF).toByte()
            }
            inputBuf.put(byteArray)
            codec.queueInputBuffer(inputIdx, 0, byteArray.size, 0, 0)
        }

        // Get encoded output
        val info = MediaCodec.BufferInfo()
        val outputIdx = codec.dequeueOutputBuffer(info, 5000)
        if (outputIdx >= 0) {
            val outputBuf = codec.getOutputBuffer(outputIdx) ?: return null
            val encoded = ByteArray(info.size)
            outputBuf.get(encoded)
            codec.releaseOutputBuffer(outputIdx, false)
            return encoded
        }

        return null
    }

    // --- Playback (BLE → Opus decode → speaker) ---

    private fun initPlayback() {
        val bufSize = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(FRAME_SAMPLES * 4)

        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
            )
            .setBufferSizeInBytes(bufSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        // Try to create Opus decoder
        try {
            decoder = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS)
            val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, SAMPLE_RATE, 1)
            // Opus decoder needs CSD (codec-specific data) — provide minimal header
            val csd0 = ByteArray(19) // OpusHead
            csd0[0] = 'O'.code.toByte(); csd0[1] = 'p'.code.toByte()
            csd0[2] = 'u'.code.toByte(); csd0[3] = 's'.code.toByte()
            csd0[4] = 'H'.code.toByte(); csd0[5] = 'e'.code.toByte()
            csd0[6] = 'a'.code.toByte(); csd0[7] = 'd'.code.toByte()
            csd0[8] = 1 // version
            csd0[9] = 1 // channels
            // rest is zeros (pre-skip, sample rate, gain, mapping)
            format.setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(csd0))
            decoder?.configure(format, null, null, 0)
            decoder?.start()
        } catch (e: Throwable) {
            Log.w(TAG, "MediaCodec Opus decoder not available: ${e.message}")
            decoder = null
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
            while (isActive && running) {
                val frames = node.recvVoiceFrames()
                for (frame in frames) {
                    val audioBytes = ByteArray(frame.data.size) { frame.data[it].toByte() }
                    playFrame(audioBytes)
                }
                delay(PLAYBACK_POLL_MS)
            }
        }
    }

    private fun playFrame(data: ByteArray) {
        val track = audioTrack ?: return
        val dec = decoder

        if (dec != null) {
            // Decode Opus frame
            val pcm = decodeFrame(dec, data)
            if (pcm != null) {
                track.write(pcm, 0, pcm.size)
            }
        } else {
            // Raw PCM fallback
            track.write(data, 0, data.size)
        }
    }

    private fun decodeFrame(codec: MediaCodec, opus: ByteArray): ByteArray? {
        val inputIdx = codec.dequeueInputBuffer(5000)
        if (inputIdx >= 0) {
            val inputBuf = codec.getInputBuffer(inputIdx) ?: return null
            inputBuf.clear()
            inputBuf.put(opus)
            codec.queueInputBuffer(inputIdx, 0, opus.size, 0, 0)
        }

        val info = MediaCodec.BufferInfo()
        val outputIdx = codec.dequeueOutputBuffer(info, 5000)
        if (outputIdx >= 0) {
            val outputBuf = codec.getOutputBuffer(outputIdx) ?: return null
            val pcm = ByteArray(info.size)
            outputBuf.get(pcm)
            codec.releaseOutputBuffer(outputIdx, false)
            return pcm
        }

        return null
    }
}
