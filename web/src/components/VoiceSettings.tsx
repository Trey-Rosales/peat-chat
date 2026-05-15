import { useState, useEffect, useRef, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import { useSettingsStore } from '../store/settingsStore'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { voiceSettingsSchema, type VoiceSettingsValues } from '@/lib/forms/voice-settings'

/**
 * Voice settings panel with mode selector, noise gate threshold, and mic level meter.
 * Works on both web clients (WebAudio) and Android (PeatLinkVoice JS bridge).
 */
export function VoiceSettings() {
  // Persisted settings from store
  const voiceMode = useSettingsStore((s) => s.voiceMode)
  const threshold = useSettingsStore((s) => s.noiseGateThreshold)
  const micDeviceId = useSettingsStore((s) => s.micDeviceId)
  const speakerDeviceId = useSettingsStore((s) => s.speakerDeviceId)
  const inputVolume = useSettingsStore((s) => s.inputVolume)

  const setVoiceMode = useSettingsStore((s) => s.setVoiceMode)
  const setThreshold = useSettingsStore((s) => s.setNoiseGateThreshold)
  const setMicDevice = useSettingsStore((s) => s.setMicDevice)
  const setSpeakerDevice = useSettingsStore((s) => s.setSpeakerDevice)
  const setInputVolume = useSettingsStore((s) => s.setInputVolume)

  // Transient live-control — not persisted in store
  const [isMuted, setIsMuted] = useState(false)

  // Mic level meter state
  const [micLevel, setMicLevel] = useState(-96)
  const [isActive, setIsActive] = useState(false)

  // Enumerated audio devices
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([])
  const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceInfo[]>([])

  // WebAudio refs
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)

  // RHF form wired to zod schema
  const form = useForm<VoiceSettingsValues>({
    resolver: zodResolver(voiceSettingsSchema),
    defaultValues: {
      voiceMode,
      noiseGateThreshold: threshold,
      micDeviceId: micDeviceId ?? '',
      speakerDeviceId: speakerDeviceId ?? '',
      inputVolume,
    },
  })

  // Watch voiceMode within the form so the meter / helper text reacts live
  const watchedVoiceMode = form.watch('voiceMode')
  const watchedThreshold = form.watch('noiseGateThreshold')

  // Enumerate audio devices on mount (requests permission implicitly via getUserMedia)
  useEffect(() => {
    const enumerate = async () => {
      try {
        // Trigger permission prompt so labels are populated
        await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        // Permission denied — proceed anyway; labels will be empty strings
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setMicDevices(devices.filter((d) => d.kind === 'audioinput'))
        setSpeakerDevices(devices.filter((d) => d.kind === 'audiooutput'))
      } catch {
        // enumerateDevices not available (e.g. SSR/test env)
      }
    }
    enumerate()
  }, [])

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
        // Compare against the live form value so the indicator is always in sync
        setIsActive(db > watchedThreshold)
        rafRef.current = requestAnimationFrame(poll)
      }
      rafRef.current = requestAnimationFrame(poll)
    } catch (err) {
      console.warn('Mic monitor failed:', err)
    }
  }, [watchedThreshold])

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

  // Start/stop monitor based on watched (not-yet-saved) voiceMode
  useEffect(() => {
    if (watchedVoiceMode === 'noise_gate' || watchedVoiceMode === 'auto') {
      startMicMonitor()
      if (window.PeatLinkVoice?.setVoiceMode) {
        window.PeatLinkVoice.setVoiceMode(watchedVoiceMode)
      }
    } else {
      stopMicMonitor()
      if (window.PeatLinkVoice?.setVoiceMode) {
        window.PeatLinkVoice.setVoiceMode(watchedVoiceMode)
      }
    }
    return stopMicMonitor
  }, [watchedVoiceMode, startMicMonitor, stopMicMonitor])

  // Sync threshold to Android whenever the form value changes
  useEffect(() => {
    if (window.PeatLinkVoice?.setNoiseGateThreshold) {
      window.PeatLinkVoice.setNoiseGateThreshold(watchedThreshold)
    }
  }, [watchedThreshold])

  // Normalize dB to 0–100% for the meter (-96 to 0 dB range)
  const meterPercent = Math.max(0, Math.min(100, ((micLevel + 96) / 96) * 100))
  const thresholdPercent = Math.max(
    0,
    Math.min(100, ((watchedThreshold + 96) / 96) * 100)
  )

  // Persist all form values to the store on submit
  const onSubmit = (values: VoiceSettingsValues) => {
    setVoiceMode(values.voiceMode)
    setThreshold(values.noiseGateThreshold)
    setMicDevice(values.micDeviceId)
    setSpeakerDevice(values.speakerDeviceId)
    setInputVolume(values.inputVolume)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-4">

        {/* ── Voice Mode ─────────────────────────────────────────── */}
        <FormField
          name="voiceMode"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-medium text-fg-secondary uppercase tracking-wider">
                Voice Mode
              </FormLabel>
              <FormControl>
                {/* Segmented-button row — matches original design */}
                <div className="flex gap-1">
                  {(['ptt', 'noise_gate', 'auto'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => field.onChange(mode)}
                      className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition ${
                        field.value === mode
                          ? 'bg-brand text-fg-on-brand'
                          : 'bg-surface-2 text-fg-secondary hover:text-fg-primary'
                      }`}
                    >
                      {mode === 'ptt'
                        ? 'Push to Talk'
                        : mode === 'noise_gate'
                        ? 'Noise Gate'
                        : 'Auto'}
                    </button>
                  ))}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Noise gate: threshold slider + mic meter ────────────── */}
        {(watchedVoiceMode === 'noise_gate' || watchedVoiceMode === 'auto') && (
          <FormField
            name="noiseGateThreshold"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-fg-secondary">
                  Sensitivity: {field.value} dB
                </FormLabel>
                <FormControl>
                  <div className="space-y-2">
                    {/* Mic level meter with threshold indicator */}
                    <div className="relative h-6 bg-surface-1 rounded overflow-hidden">
                      {/* Mic level bar */}
                      <div
                        className={`absolute left-0 top-0 h-full transition-all duration-75 ${
                          isActive ? 'bg-brand' : 'bg-fg-secondary/30'
                        }`}
                        style={{ width: `${meterPercent}%` }}
                      />
                      {/* Threshold line */}
                      <div
                        className="absolute top-0 h-full w-0.5 bg-status-warning z-10"
                        style={{ left: `${thresholdPercent}%` }}
                      />
                      {/* Label */}
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-fg-on-brand/60 z-20">
                        {isActive ? 'Voice Detected' : 'Silent'}
                      </div>
                    </div>

                    {/* Threshold slider */}
                    <Slider
                      min={-60}
                      max={-10}
                      step={1}
                      value={[field.value]}
                      onValueChange={([val]) => field.onChange(val)}
                    />
                    <div className="flex justify-between text-xs text-fg-secondary">
                      <span>Sensitive</span>
                      <span>Aggressive</span>
                    </div>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* ── PTT helper text ─────────────────────────────────────── */}
        {watchedVoiceMode === 'ptt' && (
          <p className="text-xs text-fg-secondary">
            Hold the mic button or press Space to talk
          </p>
        )}

        {/* ── Microphone device ───────────────────────────────────── */}
        <FormField
          name="micDeviceId"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Microphone</FormLabel>
              <Select
                onValueChange={(v) => field.onChange(v === '__default__' ? '' : v)}
                value={field.value || '__default__'}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__default__">Default</SelectItem>
                  {micDevices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Speaker / output device ─────────────────────────────── */}
        <FormField
          name="speakerDeviceId"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Speaker</FormLabel>
              <Select
                onValueChange={(v) => field.onChange(v === '__default__' ? '' : v)}
                value={field.value || '__default__'}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__default__">Default</SelectItem>
                  {speakerDevices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || `Speaker (${d.deviceId.slice(0, 8)}…)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Input volume (gain) ─────────────────────────────────── */}
        <FormField
          name="inputVolume"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-fg-secondary">
                Input Gain: {Math.round(field.value * 100)}%
              </FormLabel>
              <FormControl>
                <Slider
                  min={0}
                  max={2}
                  step={0.05}
                  value={[field.value]}
                  onValueChange={([val]) => field.onChange(val)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Save button ─────────────────────────────────────────── */}
        <Button
          type="submit"
          disabled={!form.formState.isDirty}
          className="w-full"
        >
          Save
        </Button>

        {/* ── Mic Mute Toggle (transient, not persisted) ──────────── */}
        <div className="pt-2 border-t border-border-subtle">
          <button
            type="button"
            onClick={() => {
              const newMuted = !isMuted
              setIsMuted(newMuted)
              if (window.PeatLinkVoice?.setMicMuted) {
                window.PeatLinkVoice.setMicMuted(newMuted)
              }
            }}
            className={`w-full py-2 rounded text-sm font-medium transition ${
              isMuted
                ? 'bg-status-danger text-fg-on-brand'
                : 'bg-surface-2 text-fg-secondary hover:text-fg-primary'
            }`}
          >
            {isMuted ? 'Mic Muted' : 'Mic Active'}
          </button>
        </div>
      </form>
    </Form>
  )
}
