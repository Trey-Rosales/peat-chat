import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsStore {
  micDeviceId: string
  speakerDeviceId: string
  pttKey: string
  voiceMode: 'ptt' | 'noise_gate' | 'auto'
  noiseGateThreshold: number // dB, typically -60 to -20
  inputVolume: number
  preferredTransport: string
  protomapsApiKey: string
  mapStyle: 'dark' | 'light' | 'topo' | 'satellite'
  locationEnabled: boolean

  setMicDevice: (id: string) => void
  setSpeakerDevice: (id: string) => void
  setPttKey: (key: string) => void
  setVoiceMode: (mode: 'ptt' | 'noise_gate' | 'auto') => void
  setNoiseGateThreshold: (db: number) => void
  setInputVolume: (vol: number) => void
  setPreferredTransport: (t: string) => void
  setProtomapsApiKey: (key: string) => void
  setMapStyle: (style: 'dark' | 'light' | 'topo' | 'satellite') => void
  setLocationEnabled: (enabled: boolean) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      micDeviceId: '',
      speakerDeviceId: '',
      pttKey: ' ',
      voiceMode: 'ptt' as const,
      noiseGateThreshold: -35,
      inputVolume: 1.0,
      preferredTransport: 'tcp',
      protomapsApiKey: '',
      mapStyle: 'dark',
      locationEnabled: false,

      setMicDevice: (id) => set({ micDeviceId: id }),
      setSpeakerDevice: (id) => set({ speakerDeviceId: id }),
      setPttKey: (key) => set({ pttKey: key }),
      setVoiceMode: (mode) => set({ voiceMode: mode }),
      setNoiseGateThreshold: (db) => set({ noiseGateThreshold: db }),
      setInputVolume: (vol) => set({ inputVolume: vol }),
      setPreferredTransport: (t) => set({ preferredTransport: t }),
      setProtomapsApiKey: (key) => set({ protomapsApiKey: key }),
      setMapStyle: (style) => set({ mapStyle: style }),
      setLocationEnabled: (enabled) => set({ locationEnabled: enabled }),
    }),
    {
      name: 'peatlink-settings',
      onRehydrateStorage: () => (state) => {
        // Migrate stale 'open' voiceMode to 'ptt'
        if (state && (state.voiceMode as string) === 'open') {
          state.voiceMode = 'ptt'
        }
      },
    }
  )
)
