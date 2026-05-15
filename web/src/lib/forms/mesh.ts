import { z } from 'zod'

export const meshSchema = z.object({
  preferredTransport: z.enum(['tcp', 'wifi-direct', 'btle']),
  backgroundMode: z.boolean(),
})

export type MeshValues = z.infer<typeof meshSchema>
