import { z } from 'zod'

/**
 * Zod schema for the JoinRoom form.
 *
 * Fields:
 *   - name — the room name to join (non-empty, trimmed by the submit handler)
 */
export const joinRoomSchema = z.object({
  name: z.string().min(1, 'Room name is required').max(64, 'Room name too long'),
})

export type JoinRoomInput = z.infer<typeof joinRoomSchema>
