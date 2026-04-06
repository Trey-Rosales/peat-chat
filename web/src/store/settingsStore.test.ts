import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from './settingsStore'

beforeEach(() => {
  useSettingsStore.setState({
    micDeviceId: '',
    speakerDeviceId: '',
    pttKey: ' ',
    inputVolume: 1.0,
    preferredTransport: 'tcp',
  })
})

describe('settingsStore - defaults', () => {
  it('has correct defaults', () => {
    const s = useSettingsStore.getState()
    expect(s.micDeviceId).toBe('')
    expect(s.speakerDeviceId).toBe('')
    expect(s.pttKey).toBe(' ')
    expect(s.inputVolume).toBe(1.0)
    expect(s.preferredTransport).toBe('tcp')
  })
})

describe('settingsStore - mic device', () => {
  it('sets mic device', () => {
    useSettingsStore.getState().setMicDevice('device-123')
    expect(useSettingsStore.getState().micDeviceId).toBe('device-123')
  })

  it('clears mic device to default', () => {
    useSettingsStore.getState().setMicDevice('device-123')
    useSettingsStore.getState().setMicDevice('')
    expect(useSettingsStore.getState().micDeviceId).toBe('')
  })
})

describe('settingsStore - speaker device', () => {
  it('sets speaker device', () => {
    useSettingsStore.getState().setSpeakerDevice('speaker-456')
    expect(useSettingsStore.getState().speakerDeviceId).toBe('speaker-456')
  })
})

describe('settingsStore - PTT key', () => {
  it('sets PTT key', () => {
    useSettingsStore.getState().setPttKey('v')
    expect(useSettingsStore.getState().pttKey).toBe('v')
  })

  it('accepts special keys', () => {
    useSettingsStore.getState().setPttKey('Control')
    expect(useSettingsStore.getState().pttKey).toBe('Control')
  })
})

describe('settingsStore - input volume', () => {
  it('sets input volume', () => {
    useSettingsStore.getState().setInputVolume(0.5)
    expect(useSettingsStore.getState().inputVolume).toBe(0.5)
  })

  it('accepts zero volume', () => {
    useSettingsStore.getState().setInputVolume(0)
    expect(useSettingsStore.getState().inputVolume).toBe(0)
  })

  it('accepts max volume', () => {
    useSettingsStore.getState().setInputVolume(1.0)
    expect(useSettingsStore.getState().inputVolume).toBe(1.0)
  })
})

describe('settingsStore - transport', () => {
  it('sets preferred transport', () => {
    useSettingsStore.getState().setPreferredTransport('btle')
    expect(useSettingsStore.getState().preferredTransport).toBe('btle')
  })

  it('accepts various transport types', () => {
    const transports = ['tcp', 'quic', 'btle', 'wifi', 'lan', 'p2p']
    for (const t of transports) {
      useSettingsStore.getState().setPreferredTransport(t)
      expect(useSettingsStore.getState().preferredTransport).toBe(t)
    }
  })
})
