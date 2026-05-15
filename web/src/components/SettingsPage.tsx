import { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { useChatStore } from '../store/chatStore'
import { KeyBindingCapture } from './KeyBindingCapture'
import { VoiceSettings } from './VoiceSettings'
import { useTheme } from '../hooks/useTheme'
import IconButton from './ui/IconButton'
import Button from './ui/Button'
import Input from './ui/Input'
import Toggle from './ui/Toggle'
import Select from './ui/Select'
import RangeSlider from './ui/RangeSlider'

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
        <IconButton
          onClick={onClose}
          size="sm"
          variant="ghost"
          label="Close settings"
          title="Close settings"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          }
        />
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
                <Button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  aria-pressed={theme === t}
                  variant={theme === t ? 'primary' : 'secondary'}
                  size="sm"
                >
                  {t === 'ld' ? 'Low-detection' : t.charAt(0).toUpperCase() + t.slice(1)}
                </Button>
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
              <div className="flex gap-2 items-start">
                <div className="flex-1">
                  <Input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleNameSave()
                    }}
                  />
                </div>
                <Button
                  onClick={handleNameSave}
                  disabled={!nameInput.trim() || nameInput.trim() === displayName}
                  size="sm"
                >
                  Save
                </Button>
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
                <Select value={micDeviceId} onChange={(e) => setMicDevice(e.target.value)}>
                  <option value="">System Default</option>
                  {audioInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-fg-primary">
                  Input Volume ({Math.round(inputVolume * 100)}%)
                </label>
                <RangeSlider
                  min={0}
                  max={1}
                  step={0.05}
                  value={inputVolume}
                  onChange={(e) => setInputVolume(parseFloat(e.target.value))}
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
              <Select value={speakerDeviceId} onChange={(e) => setSpeakerDevice(e.target.value)}>
                <option value="">System Default</option>
                {audioOutputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </Select>
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
              <Select
                value={preferredTransport}
                onChange={(e) => {
                  setPreferredTransport(e.target.value)
                  send('set_preferred_transport', { transport: e.target.value })
                }}
              >
                <option value="tcp">TCP &mdash; stable internet connection</option>
                <option value="wifi-direct">WiFi Direct &mdash; peer-to-peer, no internet needed</option>
                <option value="btle">BLE &mdash; lowest power, shortest range</option>
              </Select>
              <p className="text-xs text-fg-secondary/60">
                Preferred network path for mesh connections. Default priority: TCP &gt; WiFi Direct &gt; BLE.
              </p>
            </div>

            <div className="space-y-2">
              <Toggle
                checked={backgroundMode}
                onChange={setBackgroundMode}
                label="Keep Mesh Alive in Background"
              />
              <p className="text-xs text-fg-secondary/60">
                {backgroundMode
                  ? 'Mesh stays active when app is backgrounded.'
                  : 'Mesh stops when app is backgrounded.'}
                {' '}Runs a foreground service to keep BLE, WiFi Direct, and the Rust server alive (Android only).
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
                <Input
                  value={protomapsApiKey}
                  onChange={(e) => setProtomapsApiKey(e.target.value)}
                  placeholder="Get a free key at protomaps.com"
                  className="font-mono"
                />
                <p className="text-xs text-fg-secondary/60">
                  Required for tactical map tiles
                </p>
              </div>

              <div className="space-y-2">
                <Toggle
                  checked={locationEnabled}
                  onChange={(next) => {
                    if (next) {
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
                  label="Share Location"
                />
                <p className="text-xs text-fg-secondary/60">
                  {locationEnabled
                    ? 'Broadcasting position to room. '
                    : 'Location sharing off. '}
                  When enabled, your GPS position is shared with room members on the tactical map.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
