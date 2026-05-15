# DTAK Component Primitives

Primitives live in `web/src/components/ui/`. Each consumes semantic tokens — never raw scale stops. Each is fully tested with `vitest` + `@testing-library/react`. `Button` and `Toggle` wrap `flowbite-react`; the rest are bespoke.

## Surface

Token-aware container. Replaces ad-hoc `<div className="bg-something">`.

```tsx
<Surface variant="1">cards, panels, sidebars</Surface>
<Surface variant="2">nested cards, popovers</Surface>
<Surface variant="canvas">page background</Surface>
```

Variants: `canvas | 1 | 2 | 3 | overlay`.

Implementation: bespoke themed `<div>` (`flowbite-react`'s `Card` adds opinionated styling we don't want).

## Button

```tsx
<Button variant="primary" size="md">Join Voice</Button>
<Button variant="ghost">Cancel</Button>
<Button variant="destructive">Delete</Button>
```

Variants: `primary | secondary | ghost | destructive`.
Sizes: `sm` (32px), `md` (40px desktop / 44px mobile), `lg` (48px — LD-friendly).

Implementation: wraps `flowbite-react`'s `Button` via `flowbite-theme.ts` `button` slot.

## Input

```tsx
<Input placeholder="Search rooms..." />
<Input multiline placeholder="Message..." />
<Input error="Required" />
```

Implementation: bespoke (discriminated `multiline` / `error` union doesn't map onto `flowbite-react`'s `TextInput`).

## IconButton

```tsx
<IconButton icon={<HomeIcon />} label="Home" />
<IconButton icon={<MicIcon />} label="Mute" toggled />
```

`label` is required (a11y). 44px touch target everywhere.

Implementation: bespoke (no `flowbite-react` analog for 44px square hit target).

## StatusPill

```tsx
<StatusPill variant="critical">CRITICAL</StatusPill>
<StatusPill variant="cot-hostile">HOSTILE</StatusPill>
<StatusPill variant="transport-ble">BLE</StatusPill>
<StatusPill variant="count">8</StatusPill>
```

Variants cover every `status-*`, `cot-*`, `transport-*` semantic, plus `count` (uses status-critical).

Implementation: bespoke (13 semantic variants don't map onto `flowbite-react`'s `Badge` small color set).

## CalloutBar

*CalloutBar was removed in the Flowbite migration (2026-05-15) due to having no consumers. If you need a callout/alert primitive, wrap `flowbite-react`'s `Alert` under `/ui/` following the pattern of `Button`.*

## Toggle

```tsx
<Toggle checked={ldEnabled} onChange={setLdEnabled} label="Low-detection mode" />
```

`role="switch"` + `aria-checked`. Used heavily in Settings.

Implementation: wraps `flowbite-react`'s `ToggleSwitch` via `flowbite-theme.ts` `toggleSwitch` slot.

## CotMarker

```tsx
<CotMarker affiliation="friendly" remarks="Patrol Bravo" />
```

Affiliations: `friendly | hostile | neutral | unknown`. Drives marker color via `cot-*` tokens.

Implementation: bespoke (CoT-affiliation map overlay, no `flowbite-react` analog).

## When to add a new primitive

Promote a feature-local component into `ui/` only if:

1. It would be used in 3+ feature folders, or
2. It encapsulates a token contract that should be enforced (e.g. ensures consistent focus rings).

Otherwise: keep it in the feature folder; just consume DTAK semantic tokens directly.

When adopting a new `flowbite-react` component, wrap it in `/ui/` first — never import `flowbite-react` directly from feature code.
