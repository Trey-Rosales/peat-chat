import { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { useChatStore } from '../store/chatStore'
import { KeyBindingCapture } from './KeyBindingCapture'
import { VoiceSettings } from './VoiceSettings'
import { useTheme } from '../hooks/useTheme'

interface Props {
  onClose: () => void
  send: (type: string, data: any) => void
}

interface DeviceInfo {
  deviceId: string
  label: string
}

export function SettingsPage({ onClose, send }: Props) {
  const displayName = useChatStore((s) => s.displayName)
  const setDisplayName = useChatStore((s) => s.setDisplayName)

  const micDeviceId = useSettingsStore((s) => s.micDeviceId)
  const speakerDeviceId = useSettingsStore((s) => s.speakerDeviceId)
  const pttKey = useSettingsStore((s) => s.pttKey)
  const inputVolume = useSettingsStore((s) => s.inputVolume)
  const preferredTransport = useSettingsStore((s) => s.preferredTransport)
  const setMicDevice = useSettingsStore((s) => s.setMicDevice)
  const setSpeakerDevice = useSettingsStore((s) => s.setSpeakerDevice)
  const setPttKey = useSettingsStore((s) => s.setPttKey)
  const setInputVolume = useSettingsStore((s) => s.setInputVolume)
  const setPreferredTransport = useSettingsStore((s) => s.setPreferredTransport)
  const protomapsApiKey = useSettingsStore((s) => s.protomapsApiKey)
  const setProtomapsApiKey = useSettingsStore((s) => s.setProtomapsApiKey)
  const locationEnabled = useSettingsStore((s) => s.locationEnabled)
  const setLocationEnabled = useSettingsStore((s) => s.setLocationEnabled)
  const backgroundMode = useSettingsStore((s) => s.backgroundMode)
  const setBackgroundMode = useSettingsStore((s) => s.setBackgroundMode)

  const { theme, setTheme } = useTheme()

  const [nameInput, setNameInput] = useState(displayName)
  const [audioInputs, setAudioInputs] = useState<DeviceInfo[]>([])
  const [audioOutputs, setAudioOutputs] = useState<DeviceInfo[]>([])

  // Enumerate audio devices
  useEffect(() => {
    async function loadDevices() {
      try {
        // Request permission first so labels are populated
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())

        const devices = await navigator.mediaDevices.enumerateDevices()
        setAudioInputs(
          devices
            .filter((d) => d.kind === 'audioinput')
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
            }))
        )
        setAudioOutputs(
          devices
            .filter((d) => d.kind === 'audiooutput')
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
            }))
        )
      } catch {
        // Mic permission denied -- show empty lists
      }
    }
    loadDevices()
  }, [])

  const handleNameSave = () => {
    const trimmed = nameInput.trim()
    if (trimmed && trimmed !== displayName) {
      setDisplayName(trimmed)
      send('set_name', { name: trimmed })
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-surface-canvas flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 bg-surface-2 flex items-center justify-between border-b border-border-subtle shrink-0">
        <h1 className="text-lg font-semibold text-fg-primary">Settings</h1>
        <button
          onClick={onClose}
          className="text-fg-secondary hover:text-fg-primary transition p-2 rounded-lg hover:bg-surface-2"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-8">
          {/* Theme — DTAK Interface Guide */}
          <section>
            <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider mb-4">
              Theme
            </h2>
            <div className="flex gap-2">
              {(['dark', 'light', 'ld'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  aria-pressed={theme === t}
                  className={
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors ' +
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ' +
                    (theme === t
                      ? 'bg-brand text-fg-on-brand'
                      : 'bg-surface-2 text-fg-primary hover:bg-surface-3 border border-border-default')
                  }
                >
                  {t === 'ld' ? 'Low-detection' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-fg-tertiary text-xs mt-2">
              Persists across sessions. Low-detection follows DIG stealth-mode rules (red on black, no blue).
            </p>
          </section>

          {/* Profile */}
          <section>
            <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider mb-4">
              Profile
            </h2>
            <div className="space-y-2">
              <label className="text-sm text-fg-primary">Display Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleNameSave()
                  }}
                  className="flex-1 bg-surface-2 text-fg-primary rounded-lg px-3 py-2 text-sm placeholder:text-fg-tertiary"
                />
                <button
                  onClick={handleNameSave}
                  disabled={!nameInput.trim() || nameInput.trim() === displayName}
                  className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:brightness-110 transition disabled:opacity-30"
                >
                  Save
                </button>
              </div>
            </div>
          </section>

          {/* Audio Input */}
          <section>
            <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider mb-4">
              Audio Input
            </h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-fg-primary">Microphone</label>
                <select
                  value={micDeviceId}
                  onChange={(e) => setMicDevice(e.target.value)}
                  className="w-full bg-surface-2 text-fg-primary rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">System Default</option>
                  {audioInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-fg-primary">
                  Input Volume ({Math.round(inputVolume * 100)}%)
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={inputVolume}
                  onChange={(e) => setInputVolume(parseFloat(e.target.value))}
                  className="w-full accent-brand"
                />
              </div>
            </div>
          </section>

          {/* Audio Output */}
          <section>
            <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider mb-4">
              Audio Output
            </h2>
            <div className="space-y-2">
              <label className="text-sm text-fg-primary">Speaker</label>
              <select
                value={speakerDeviceId}
                onChange={(e) => setSpeakerDevice(e.target.value)}
                className="w-full bg-surface-2 text-fg-primary rounded-lg px-3 py-2 text-sm"
              >
                <option value="">System Default</option>
                {audioOutputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Push-to-Talk */}
          <section>
            <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider mb-4">
              Voice
            </h2>
            <VoiceSettings />
            <div className="space-y-2 mt-4">
              <label className="text-sm text-fg-primary">PTT Key (keyboard)</label>
              <div className="flex items-center gap-3">
                <KeyBindingCapture currentKey={pttKey} onCapture={setPttKey} />
                <span className="text-xs text-fg-secondary">
                  Hold this key to transmit voice (PTT mode)
                </span>
              </div>
            </div>
          </section>

          {/* Network */}
          <section>
            <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider mb-4">
              Network
            </h2>
            <div className="space-y-2">
              <label className="text-sm text-fg-primary">Preferred Transport</label>
              <select
                value={preferredTransport}
                onChange={(e) => {
                  setPreferredTransport(e.target.value)
                  send('set_preferred_transport', { transport: e.target.value })
                }}
                className="w-full bg-surface-2 text-fg-primary rounded-lg px-3 py-2 text-sm"
              >
                <option value="tcp">TCP &mdash; stable internet connection</option>
                <option value="wifi-direct">WiFi Direct &mdash; peer-to-peer, no internet needed</option>
                <option value="btle">BLE &mdash; lowest power, shortest range</option>
              </select>
              <p className="text-xs text-fg-secondary/60">
                Preferred network path for mesh connections. Default priority: TCP &gt; WiFi Direct &gt; BLE.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-fg-primary">Keep Mesh Alive in Background</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setBackgroundMode(!backgroundMode)}
                  className={`w-12 h-6 rounded-full transition-colors relative ${
                    backgroundMode ? 'bg-brand' : 'bg-surface-3'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                      backgroundMode ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <span className="text-xs text-fg-secondary">
                  {backgroundMode
                    ? 'Mesh stays active when app is backgrounded'
                    : 'Mesh stops when app is backgrounded'}
                </span>
              </div>
              <p className="text-xs text-fg-secondary/60">
                Runs a foreground service to keep BLE, WiFi Direct, and the Rust server alive (Android only)
              </p>
            </div>
          </section>

          {/* Map */}
          <section>
            <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider mb-4">
              Map
            </h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-fg-primary">Protomaps API Key</label>
                <input
                  type="text"
                  value={protomapsApiKey}
                  onChange={(e) => setProtomapsApiKey(e.target.value)}
                  placeholder="Get a free key at protomaps.com"
                  className="w-full bg-surface-2 text-fg-primary rounded-lg px-3 py-2 text-sm placeholder:text-fg-tertiary font-mono"
                />
                <p className="text-xs text-fg-secondary/60">
                  Required for tactical map tiles
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-fg-primary">Share Location</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      if (!locationEnabled) {
                        // Trigger geolocation from user gesture so iOS prompts
                        navigator.geolocation.getCurrentPosition(
                          () => setLocationEnabled(true),
                          (err) => {
                            console.warn('Geolocation denied:', err.message)
                            alert('Location access denied. Enable location in your browser/OS settings.')
                          },
                          { enableHighAccuracy: true, timeout: 10000 }
                        )
                      } else {
                        setLocationEnabled(false)
                      }
                    }}
                    className={`w-12 h-6 rounded-full transition-colors relative ${
                      locationEnabled ? 'bg-brand' : 'bg-surface-3'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                        locationEnabled ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <span className="text-xs text-fg-secondary">
                    {locationEnabled
                      ? 'Broadcasting position to room'
                      : 'Location sharing off'}
                  </span>
                </div>
                <p className="text-xs text-fg-secondary/60">
                  When enabled, your GPS position is shared with room members on the tactical map
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
