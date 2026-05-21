import { z } from 'zod'

export const profileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required').max(64, 'Display name is too long'),
})

export type ProfileValues = z.infer<typeof profileSchema>
