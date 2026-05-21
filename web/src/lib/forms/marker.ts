import { z } from 'zod'

/**
 * Zod schema for the MarkerForm.
 *
 * Fields mirror what the marker store receives via onSubmit:
 *   - name        — marker display name / callsign (required, 1–64 chars)
 *   - cotType     — CoT type string (one of the five recognised values)
 *   - affiliation — NATO affiliation shortcode (f=friendly, h=hostile, n=neutral, u=unknown)
 *   - remarks     — free-text remarks (optional, max 500 chars)
 *
 * The computed fields `icon`, `color`, and `cot_type` sent to onSubmit are
 * derived from cotType / affiliation at submit time and are not part of the
 * form state.
 */

export const COT_TYPE_VALUES = ['b-m-p-w', 'b-m-p-s-m', 'b-m-p-s-p-i', 'b-m-p-c-cp', 'b-r-.-O'] as const
export type CotTypeValue = (typeof COT_TYPE_VALUES)[number]

export const AFFILIATION_VALUES = ['f', 'h', 'n', 'u'] as const
export type AffiliationValue = (typeof AFFILIATION_VALUES)[number]

export const markerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(64, 'Name must be 64 characters or fewer'),
  cotType: z.enum(COT_TYPE_VALUES),
  affiliation: z.enum(AFFILIATION_VALUES),
  remarks: z.string().max(500, 'Remarks must be 500 characters or fewer').optional(),
})

export type MarkerInput = z.infer<typeof markerSchema>
