import { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { useChatStore } from '../store/chatStore'
import { KeyBindingCapture } from './KeyBindingCapture'
import { VoiceSettings } from './VoiceSettings'

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
    <div className="fixed inset-0 z-50 bg-pl-bg flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 bg-pl-header flex items-center justify-between border-b border-pl-border shrink-0">
        <h1 className="text-lg font-semibold text-pl-text">Settings</h1>
        <button
          onClick={onClose}
          className="text-pl-text-sec hover:text-pl-text transition p-2 rounded-lg hover:bg-pl-hover"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-8">
          {/* Profile */}
          <section>
            <h2 className="text-sm font-semibold text-pl-text-sec uppercase tracking-wider mb-4">
              Profile
            </h2>
            <div className="space-y-2">
              <label className="text-sm text-pl-text">Display Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleNameSave()
                  }}
                  className="flex-1 bg-pl-input text-pl-text rounded-lg px-3 py-2 text-sm placeholder-pl-text-sec"
                />
                <button
                  onClick={handleNameSave}
                  disabled={!nameInput.trim() || nameInput.trim() === displayName}
                  className="px-4 py-2 bg-pl-accent text-white rounded-lg text-sm font-medium hover:brightness-110 transition disabled:opacity-30"
                >
                  Save
                </button>
              </div>
            </div>
          </section>

          {/* Audio Input */}
          <section>
            <h2 className="text-sm font-semibold text-pl-text-sec uppercase tracking-wider mb-4">
              Audio Input
            </h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-pl-text">Microphone</label>
                <select
                  value={micDeviceId}
                  onChange={(e) => setMicDevice(e.target.value)}
                  className="w-full bg-pl-input text-pl-text rounded-lg px-3 py-2 text-sm"
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
                <label className="text-sm text-pl-text">
                  Input Volume ({Math.round(inputVolume * 100)}%)
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={inputVolume}
                  onChange={(e) => setInputVolume(parseFloat(e.target.value))}
                  className="w-full accent-pl-accent"
                />
              </div>
            </div>
          </section>

          {/* Audio Output */}
          <section>
            <h2 className="text-sm font-semibold text-pl-text-sec uppercase tracking-wider mb-4">
              Audio Output
            </h2>
            <div className="space-y-2">
              <label className="text-sm text-pl-text">Speaker</label>
              <select
                value={speakerDeviceId}
                onChange={(e) => setSpeakerDevice(e.target.value)}
                className="w-full bg-pl-input text-pl-text rounded-lg px-3 py-2 text-sm"
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
            <h2 className="text-sm font-semibold text-pl-text-sec uppercase tracking-wider mb-4">
              Voice
            </h2>
            <VoiceSettings />
            <div className="space-y-2 mt-4">
              <label className="text-sm text-pl-text">PTT Key (keyboard)</label>
              <div className="flex items-center gap-3">
                <KeyBindingCapture currentKey={pttKey} onCapture={setPttKey} />
                <span className="text-xs text-pl-text-sec">
                  Hold this key to transmit voice (PTT mode)
                </span>
              </div>
            </div>
          </section>

          {/* Network */}
          <section>
            <h2 className="text-sm font-semibold text-pl-text-sec uppercase tracking-wider mb-4">
              Network
            </h2>
            <div className="space-y-2">
              <label className="text-sm text-pl-text">Preferred Transport</label>
              <select
                value={preferredTransport}
                onChange={(e) => {
                  setPreferredTransport(e.target.value)
                  send('set_transport', { transport: e.target.value })
                }}
                className="w-full bg-pl-input text-pl-text rounded-lg px-3 py-2 text-sm"
              >
                <option value="tcp">TCP</option>
                <option value="quic">QUIC</option>
                <option value="btle">Bluetooth LE</option>
                <option value="wifi">Wi-Fi Direct</option>
                <option value="lan">LAN</option>
                <option value="p2p">P2P</option>
              </select>
              <p className="text-xs text-pl-text-sec/60">
                Preferred network path for mesh connections
              </p>
            </div>
          </section>

          {/* Map */}
          <section>
            <h2 className="text-sm font-semibold text-pl-text-sec uppercase tracking-wider mb-4">
              Map
            </h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-pl-text">Protomaps API Key</label>
                <input
                  type="text"
                  value={protomapsApiKey}
                  onChange={(e) => setProtomapsApiKey(e.target.value)}
                  placeholder="Get a free key at protomaps.com"
                  className="w-full bg-pl-input text-pl-text rounded-lg px-3 py-2 text-sm placeholder-pl-text-sec font-mono"
                />
                <p className="text-xs text-pl-text-sec/60">
                  Required for tactical map tiles
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-pl-text">Share Location</label>
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
                      locationEnabled ? 'bg-pl-accent' : 'bg-pl-input'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                        locationEnabled ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <span className="text-xs text-pl-text-sec">
                    {locationEnabled
                      ? 'Broadcasting position to room'
                      : 'Location sharing off'}
                  </span>
                </div>
                <p className="text-xs text-pl-text-sec/60">
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
