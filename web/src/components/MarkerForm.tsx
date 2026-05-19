import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { markerSchema, type MarkerInput, AFFILIATION_VALUES } from '@/lib/forms/marker'
import { COT_TYPES, AFFILIATION_TO_LEGACY } from '@/lib/cot-icons'

// ── Static lookup tables ──────────────────────────────────────────────────────

const AFFILIATIONS: {
  value: (typeof AFFILIATION_VALUES)[number]
  label: string
  bgClass: string
  textClass: string
}[] = [
  { value: 'f', label: 'Friendly', bgClass: 'bg-cot-friendly', textClass: 'text-fg-primary' },
  { value: 'h', label: 'Hostile',  bgClass: 'bg-cot-hostile',  textClass: 'text-fg-on-brand' },
  { value: 'n', label: 'Neutral',  bgClass: 'bg-cot-neutral',  textClass: 'text-fg-on-brand' },
  { value: 'u', label: 'Unknown',  bgClass: 'bg-cot-unknown',  textClass: 'text-fg-primary' },
]

// Place button background per affiliation (cot-* tokens)
const affiliationPlaceClass: Record<string, string> = {
  f: 'bg-cot-friendly',
  h: 'bg-cot-hostile',
  n: 'bg-cot-neutral',
  u: 'bg-cot-unknown',
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  lat: number
  lon: number
  onSubmit: (data: { name: string; icon: string; color: string; cot_type: string; remarks: string }) => void
  onCancel: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MarkerForm({ lat, lon, onSubmit, onCancel }: Props) {
  const form = useForm<MarkerInput>({
    resolver: zodResolver(markerSchema),
    defaultValues: {
      name: '',
      cotType: 'b-m-p-w',
      affiliation: 'f',
      remarks: '',
    },
  })

  const handleSubmit = (values: MarkerInput) => {
    onSubmit({
      name: values.name.trim(),
      icon: values.cotType,
      color: AFFILIATION_TO_LEGACY[values.affiliation] ?? 'blue',
      cot_type: values.cotType,
      remarks: (values.remarks ?? '').trim(),
    })
  }

  // Current affiliation for dynamic Place button color
  const affiliation = form.watch('affiliation')
  const cotType = form.watch('cotType')

  return (
    <div className="bg-surface-1 rounded-xl shadow-2xl border border-border-subtle p-4 w-72">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-secondary/70">Place Marker</span>
        <span className="text-[10px] text-fg-secondary font-mono">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </span>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        >
          {/* Name / callsign */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="mb-3">
                <FormLabel className="sr-only">Marker name / callsign</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Marker name / callsign"
                    className="text-sm"
                    autoFocus
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* CoT type selector — custom icon-button grid, controlled via RHF */}
          <FormField
            control={form.control}
            name="cotType"
            render={({ field }) => (
              <FormItem className="mb-3">
                <FormLabel className="text-[10px] font-semibold uppercase tracking-wider text-fg-secondary/70 block mb-1.5">
                  Type
                </FormLabel>
                <FormControl>
                  <div className="flex gap-1">
                    {COT_TYPES.map((ct) => (
                      <button
                        key={ct.value}
                        type="button"
                        onClick={() => field.onChange(ct.value)}
                        className={`flex-1 p-2 rounded-lg transition flex flex-col items-center gap-1 ${
                          cotType === ct.value
                            ? 'bg-brand/20 text-brand'
                            : 'text-fg-secondary hover:bg-surface-2 hover:text-fg-primary'
                        }`}
                        title={ct.label}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d={ct.icon} />
                        </svg>
                        <span className="text-[8px]">{ct.label}</span>
                      </button>
                    ))}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Affiliation selector — custom circle buttons, controlled via RHF */}
          <FormField
            control={form.control}
            name="affiliation"
            render={({ field }) => (
              <FormItem className="mb-3">
                <FormLabel className="text-[10px] font-semibold uppercase tracking-wider text-fg-secondary/70 block mb-1.5">
                  Affiliation
                </FormLabel>
                <FormControl>
                  <div className="flex gap-2 justify-center">
                    {AFFILIATIONS.map((a) => (
                      <button
                        key={a.value}
                        type="button"
                        onClick={() => field.onChange(a.value)}
                        className={`w-8 h-8 rounded-full transition flex items-center justify-center text-[9px] font-bold ${a.bgClass} ${a.textClass} ${
                          affiliation === a.value ? 'ring-2' : 'opacity-50 hover:opacity-80'
                        }`}
                        style={affiliation === a.value ? ({ '--tw-ring-color': 'currentColor' } as React.CSSProperties) : undefined}
                        title={a.label}
                      >
                        {a.label[0]}
                      </button>
                    ))}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Remarks */}
          <FormField
            control={form.control}
            name="remarks"
            render={({ field }) => (
              <FormItem className="mb-3">
                <FormLabel className="sr-only">Remarks</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder="Remarks (optional)"
                    className="text-xs resize-none"
                    rows={2}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="flex-1"
            >
              Cancel
            </Button>
            <button
              type="submit"
              disabled={!form.formState.isValid}
              className={`flex-1 py-2 text-fg-on-brand rounded-lg text-sm font-medium hover:brightness-110 transition disabled:opacity-30 ${affiliationPlaceClass[affiliation] ?? 'bg-cot-neutral'}`}
            >
              Place
            </button>
          </div>
        </form>
      </Form>
    </div>
  )
}
