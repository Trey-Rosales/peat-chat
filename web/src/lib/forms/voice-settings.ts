import { z } from 'zod'

/**
 * Zod schema for the VoiceSettings form.
 *
 * Fields mirror what settingsStore persists:
 *   - voiceMode       — activation mode (ptt | noise_gate | auto)
 *   - noiseGateThreshold — dB trigger level (-60 to -10)
 *   - micDeviceId     — MediaDevices deviceId for mic input
 *   - speakerDeviceId — MediaDevices deviceId for audio output
 *   - inputVolume     — gain multiplier (0 – 2.0)
 *
 * Note: isMuted is a transient live-control (not persisted) and is
 * intentionally excluded from this schema.
 */
export const voiceSettingsSchema = z.object({
  voiceMode: z.enum(['ptt', 'noise_gate', 'auto']),
  noiseGateThreshold: z.number().min(-60).max(-10),
  micDeviceId: z.string(),
  speakerDeviceId: z.string(),
  inputVolume: z.number().min(0).max(2),
})

export type VoiceSettingsValues = z.infer<typeof voiceSettingsSchema>
