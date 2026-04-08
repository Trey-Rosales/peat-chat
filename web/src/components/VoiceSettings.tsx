import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettingsStore } from '../store/settingsStore'

/**
 * Voice settings panel with mode selector, noise gate threshold, and mic level meter.
 * Works on both web clients (WebAudio) and Android (PeatLinkVoice JS bridge).
 */
export function VoiceSettings() {
  const voiceMode = useSettingsStore((s) => s.voiceMode)
  const threshold = useSettingsStore((s) => s.noiseGateThreshold)
  const setVoiceMode = useSettingsStore((s) => s.setVoiceMode)
  const setThreshold = useSettingsStore((s) => s.setNoiseGateThreshold)

  const [micLevel, setMicLevel] = useState(-96)
  const [isActive, setIsActive] = useState(false)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)

  // Start mic monitoring for the visual meter
  const startMicMonitor = useCallback(async () => {
    // Android native path
    if (window.PeatLinkVoice?.hasBleVoice?.()) {
      const poll = () => {
        if (!rafRef.current) return
        try {
          const db = window.PeatLinkVoice!.getMicLevelDb!()
          setMicLevel(db)
          setIsActive(window.PeatLinkVoice!.isVoiceDetected!())
        } catch {}
        rafRef.current = requestAnimationFrame(poll)
      }
      rafRef.current = requestAnimationFrame(poll)
      return
    }

    // Web client path — WebAudio AnalyserNode
    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Float32Array(analyser.fftSize)
      const poll = () => {
        if (!analyserRef.current) return
        analyser.getFloatTimeDomainData(dataArray)
        let sumSq = 0
        for (let i = 0; i < dataArray.length; i++) {
          sumSq += dataArray[i] * dataArray[i]
        }
        const rms = Math.sqrt(sumSq / dataArray.length)
        const db = rms > 0 ? 20 * Math.log10(rms) : -96
        setMicLevel(db)
        setIsActive(db > threshold)
        rafRef.current = requestAnimationFrame(poll)
      }
      rafRef.current = requestAnimationFrame(poll)
    } catch (err) {
      console.warn('Mic monitor failed:', err)
    }
  }, [threshold])

  const stopMicMonitor = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    analyserRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
  }, [])

  // Start monitor when in noise_gate or auto mode
  useEffect(() => {
    if (voiceMode === 'noise_gate' || voiceMode === 'auto') {
      startMicMonitor()
      // Sync to Android native
      if (window.PeatLinkVoice?.setVoiceMode) {
        window.PeatLinkVoice.setVoiceMode(voiceMode)
      }
    } else {
      stopMicMonitor()
      if (window.PeatLinkVoice?.setVoiceMode) {
        window.PeatLinkVoice.setVoiceMode(voiceMode)
      }
    }
    return stopMicMonitor
  }, [voiceMode, startMicMonitor, stopMicMonitor])

  // Sync threshold to Android
  useEffect(() => {
    if (window.PeatLinkVoice?.setNoiseGateThreshold) {
      window.PeatLinkVoice.setNoiseGateThreshold(threshold)
    }
  }, [threshold])

  // Normalize dB to 0-100% for the meter (-96 to 0 dB range)
  const meterPercent = Math.max(0, Math.min(100, ((micLevel + 96) / 96) * 100))
  const thresholdPercent = Math.max(0, Math.min(100, ((threshold + 96) / 96) * 100))

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-pl-text-sec uppercase tracking-wider">
        Voice Mode
      </div>

      {/* Mode selector */}
      <div className="flex gap-1">
        {(['ptt', 'noise_gate', 'auto'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setVoiceMode(mode)}
            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition ${
              voiceMode === mode
                ? 'bg-pl-accent text-white'
                : 'bg-pl-input text-pl-text-sec hover:text-pl-text'
            }`}
          >
            {mode === 'ptt' ? 'Push to Talk' : mode === 'noise_gate' ? 'Noise Gate' : 'Auto'}
          </button>
        ))}
      </div>

      {/* Threshold slider + mic meter (shown for noise_gate and auto modes) */}
      {(voiceMode === 'noise_gate' || voiceMode === 'auto') && (
        <div className="space-y-2">
          <div className="text-xs text-pl-text-sec">
            Sensitivity: {threshold} dB
          </div>

          {/* Mic level meter with threshold indicator */}
          <div className="relative h-6 bg-pl-deep rounded overflow-hidden">
            {/* Mic level bar */}
            <div
              className={`absolute left-0 top-0 h-full transition-all duration-75 ${
                isActive ? 'bg-pl-accent' : 'bg-pl-text-sec/30'
              }`}
              style={{ width: `${meterPercent}%` }}
            />
            {/* Threshold line */}
            <div
              className="absolute top-0 h-full w-0.5 bg-yellow-400 z-10"
              style={{ left: `${thresholdPercent}%` }}
            />
            {/* Label */}
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60 z-20">
              {isActive ? 'Voice Detected' : 'Silent'}
            </div>
          </div>

          {/* Threshold slider */}
          <input
            type="range"
            min={-60}
            max={-10}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full accent-pl-accent"
          />

          <div className="flex justify-between text-xs text-pl-text-sec">
            <span>Sensitive</span>
            <span>Aggressive</span>
          </div>
        </div>
      )}

      {voiceMode === 'ptt' && (
        <div className="text-xs text-pl-text-sec">
          Hold the mic button or press Space to talk
        </div>
      )}
    </div>
  )
}
