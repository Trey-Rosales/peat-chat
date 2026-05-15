# Component Primitives

Primitives live in `web/src/components/ui/` — copied in via the shadcn/ui CLI, then sanitized to consume DTAK semantic tokens. Each is built on Radix UI for behavior + accessibility, styled with `cva` (class-variance-authority) for variants.

DTAK's role at this layer is **token consumption, not component implementation.** shadcn provides the structure; DTAK ensures every color/spacing/touch-target value flows through the semantic token system.

## How they're wired

- shadcn aliases (`bg-primary`, `bg-popover`, `text-muted-foreground`, etc.) are declared in the generated `web/src/styles/tokens.css` `@theme` block, each pointing at a DTAK semantic token (e.g., `--color-primary: var(--color-brand)`).
- Per-theme CSS files (`themes/{dark,light,low-detection}.css`) override the underlying DTAK tokens at the `[data-theme="X"]` selector.
- Result: `<Button>` renders with brand color in dark mode, light-mode brand in light, LD-safe red in LD — automatically.

## Available primitives

| Primitive | File | DTAK alias / notes |
|---|---|---|
| Button | `ui/button.tsx` | `bg-primary` for default; `destructive` variant; `size="icon"` for icon buttons |
| Input | `ui/input.tsx` | Includes `min-h-touch` |
| Label | `ui/label.tsx` | Use with FormField + Switch/RadioGroup rows |
| Textarea | `ui/textarea.tsx` | Auto-grow patterns wired via `useEffect` at call sites |
| Switch | `ui/switch.tsx` | Replaces old DTAK Toggle. Wrap in `min-h-touch flex` row with Label |
| RadioGroup | `ui/radio-group.tsx` | Wrap items in `min-h-touch` row (item itself stays compact) |
| Select | `ui/select.tsx` | **Important:** Radix forbids `value=""` SelectItems — use sentinel pattern (e.g. `__default__`) and translate in `onValueChange` |
| Slider | `ui/slider.tsx` | Root has `min-h-touch`; thumb is 24px |
| Badge | `ui/badge.tsx` | Extended with DTAK status variants: `info`, `success`, `warning`, `critical`, `count`, `cot-friendly`, `cot-hostile`, `cot-neutral`, `cot-unknown`, `transport-wifi`, `transport-ble`, `transport-relay`, `transport-offline` |
| Card | `ui/card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` |
| Avatar | `ui/avatar.tsx` | `Avatar`, `AvatarImage`, `AvatarFallback` |
| Skeleton | `ui/skeleton.tsx` | Loading shimmer; uses `bg-muted` (surface-2) |
| Separator | `ui/separator.tsx` | Replaces ad-hoc divider divs |
| ScrollArea | `ui/scroll-area.tsx` | Custom scrollbar; wraps long lists. Verify on iOS WKWebView |
| Tabs | `ui/tabs.tsx` | TabsTrigger has `min-h-touch` |
| Dialog | `ui/dialog.tsx` | Modal. Overlay is `bg-black/80` (intentional, not themed) |
| Sheet | `ui/sheet.tsx` | Slide-in drawer (mobile sidebar pattern). Overlay also `bg-black/80` |
| Popover | `ui/popover.tsx` | Floating panel anchored to trigger |
| Tooltip | `ui/tooltip.tsx` | `<TooltipProvider>` is mounted high in `main.tsx` |
| DropdownMenu | `ui/dropdown-menu.tsx` | MenuItem has `min-h-touch` |
| ContextMenu | `ui/context-menu.tsx` | Right-click activator. MenuItem has `min-h-touch` |
| Form | `ui/form.tsx` | RHF + zod wrapper: `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`, `FormDescription` |

## Form pattern (RHF + zod)

Per-feature schemas live at `web/src/lib/forms/<feature>.ts`:

```ts
// web/src/lib/forms/voice-settings.ts
import { z } from 'zod'
export const voiceSettingsSchema = z.object({ ... })
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>
```

Component usage:

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { voiceSettingsSchema, type VoiceSettings } from '@/lib/forms/voice-settings'

const form = useForm<VoiceSettings>({
  resolver: zodResolver(voiceSettingsSchema),
  defaultValues: stored,
})

<Form {...form}>
  <form onSubmit={form.handleSubmit(save)}>
    <FormField name="micDeviceId" control={form.control} render={({ field }) => (
      <FormItem>
        <FormLabel>Microphone</FormLabel>
        <FormControl><Select {...field} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
    <Button type="submit" disabled={!form.formState.isDirty}>Save</Button>
  </form>
</Form>
```

## Domain-specific components (not in `ui/`)

- **`web/src/components/map/CotMarker.tsx`** — ATAK CoT marker with affiliation-driven color (`cot-friendly|hostile|neutral|unknown`). Lives outside `ui/` because it's not a generic primitive — it's a map/CoT-specific renderer.

## Adding a new component

- **shadcn primitive missing?** `cd web && npx shadcn@latest add <name>`. Then sanitize: strip `dark:` variants (DTAK uses `data-theme` not `.dark` class), confirm tokens resolve through DTAK aliases (no raw `slate-*`/`zinc-*`).
- **Feature-specific component?** Place under `web/src/components/<area>/` (e.g., `map/`, `feedback/`). Consume DTAK semantic tokens directly. Promote to `ui/` only if it's used in 3+ features AND encapsulates a token/behavior contract worth enforcing.

## Touch targets

- 44px minimum (mobile baseline) via the `min-h-touch` utility (declared in `tokens.css` as `@utility`).
- 48px in LD mode via `[data-theme="ld"] .min-h-touch { min-height: 48px }`.
- Apply to **rows** containing compact controls (Switch, RadioGroup item) — not to the control itself.
