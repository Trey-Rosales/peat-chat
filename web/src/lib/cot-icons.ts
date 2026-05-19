// Shared CoT type registry and color mapping.
//
// Used by MarkerForm (when placing a marker) and MapViewer (when rendering
// markers on the map). Keep these in sync — the legacy color strings flow
// through the marker payload and back to render code, so adding a new entry
// requires updating COT_TYPES, LEGACY_TO_COT, and the affiliation map in
// MarkerForm.

import type { COT_TYPE_VALUES, AFFILIATION_VALUES } from './forms/marker'

export type CotTypeValue = (typeof COT_TYPE_VALUES)[number]
export type AffiliationValue = (typeof AFFILIATION_VALUES)[number]

export interface CotTypeEntry {
  value: CotTypeValue
  label: string
  icon: string  // SVG path "d" attribute, drawn against viewBox 0 0 24 24
}

export const COT_TYPES: readonly CotTypeEntry[] = [
  { value: 'b-m-p-w',     label: 'Waypoint',  icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' },
  { value: 'b-m-p-s-m',   label: 'Marker',    icon: 'M4 15s1-1 4-1 5 2 8 2 4-1V3s-3 1-4 1-5-2-8-2v12' },
  { value: 'b-m-p-s-p-i', label: 'POI',       icon: 'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z' },
  { value: 'b-m-p-c-cp',  label: 'Contact',   icon: 'M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z' },
  { value: 'b-r-.-O',     label: 'Objective', icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3' },
] as const

const COT_TYPE_BY_VALUE = new Map(COT_TYPES.map((t) => [t.value as string, t]))

// Default fallback used when a marker's cot_type doesn't match a known entry
// (e.g., markers placed by an older client, or types we don't render yet).
const FALLBACK_TYPE = COT_TYPES[0]

export function getCotType(cotType: string | undefined | null): CotTypeEntry {
  if (!cotType) return FALLBACK_TYPE
  return COT_TYPE_BY_VALUE.get(cotType) ?? FALLBACK_TYPE
}

/** Convenience: return just the SVG path "d" for a given CoT type. */
export function getCotIcon(cotType: string | undefined | null): string {
  return getCotType(cotType).icon
}

// Affiliation ↔ legacy color string. The marker payload still uses the
// legacy color field for backward compatibility with older servers.
export const AFFILIATION_TO_LEGACY: Record<AffiliationValue, string> = {
  f: 'green',
  h: 'red',
  n: 'blue',
  u: 'yellow',
}

// Reverse: legacy color → CoT design token suffix.
// Anything unrecognized falls back to "unknown".
const LEGACY_TO_COT_TOKEN: Record<string, 'friendly' | 'hostile' | 'neutral' | 'unknown'> = {
  green:  'friendly',
  red:    'hostile',
  blue:   'neutral',
  yellow: 'unknown',
  white:  'unknown',
}

/**
 * Return a CSS `var()` expression for the cot-affiliation color matching the
 * given legacy color string. Resolves at paint time so the marker recolors
 * automatically when the active theme changes.
 */
export function getCotColorVar(legacyColor: string | undefined | null): string {
  const token = LEGACY_TO_COT_TOKEN[legacyColor ?? ''] ?? 'unknown'
  return `var(--color-cot-${token})`
}
