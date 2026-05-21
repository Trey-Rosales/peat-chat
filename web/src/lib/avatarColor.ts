export const AVATAR_HUES = [
  'bg-brand text-fg-on-brand',
  'bg-status-success text-fg-on-brand',
  'bg-status-warning text-fg-primary',
  'bg-status-info text-fg-on-brand',
  'bg-status-danger text-fg-on-brand',
  'bg-surface-3 text-fg-primary',
] as const

export type AvatarHue = (typeof AVATAR_HUES)[number]

function hash(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function colorForSender(senderId: string): AvatarHue {
  return AVATAR_HUES[hash(senderId) % AVATAR_HUES.length]
}
