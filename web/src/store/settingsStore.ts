import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsStore {
  micDeviceId: string
  speakerDeviceId: string
  pttKey: string
  inputVolume: number
  preferredTransport: string
  protomapsApiKey: string
  locationEnabled: boolean

  setMicDevice: (id: string) => void
  setSpeakerDevice: (id: string) => void
  setPttKey: (key: string) => void
  setInputVolume: (vol: number) => void
  setPreferredTransport: (t: string) => void
  setProtomapsApiKey: (key: string) => void
  setLocationEnabled: (enabled: boolean) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      micDeviceId: '',
      speakerDeviceId: '',
      pttKey: ' ',
      inputVolume: 1.0,
      preferredTransport: 'tcp',
      protomapsApiKey: '',
      locationEnabled: false,

      setMicDevice: (id) => set({ micDeviceId: id }),
      setSpeakerDevice: (id) => set({ speakerDeviceId: id }),
      setPttKey: (key) => set({ pttKey: key }),
      setInputVolume: (vol) => set({ inputVolume: vol }),
      setPreferredTransport: (t) => set({ preferredTransport: t }),
      setProtomapsApiKey: (key) => set({ protomapsApiKey: key }),
      setLocationEnabled: (enabled) => set({ locationEnabled: enabled }),
    }),
    { name: 'peatlink-settings' }
  )
)
