# DTAK Component Primitives

Eight primitives in `web/src/components/dtak/`. Each consumes semantic tokens — never raw scale stops. Each is fully tested with `vitest` + `@testing-library/react`.

## Surface

Token-aware container. Replaces ad-hoc `<div className="bg-something">`.

```tsx
<Surface variant="1">cards, panels, sidebars</Surface>
<Surface variant="2">nested cards, popovers</Surface>
<Surface variant="canvas">page background</Surface>
```

Variants: `canvas | 1 | 2 | 3 | overlay`.

## Button

```tsx
<Button variant="primary" size="md">Join Voice</Button>
<Button variant="ghost">Cancel</Button>
<Button variant="destructive">Delete</Button>
```

Variants: `primary | secondary | ghost | destructive`.
Sizes: `sm` (32px), `md` (40px desktop / 44px mobile), `lg` (48px — LD-friendly).

## Input

```tsx
<Input placeholder="Search rooms..." />
<Input multiline placeholder="Message..." />
<Input error="Required" />
```

## IconButton

```tsx
<IconButton icon={<HomeIcon />} label="Home" />
<IconButton icon={<MicIcon />} label="Mute" toggled />
```

`label` is required (a11y). 44px touch target everywhere.

## StatusPill

```tsx
<StatusPill variant="critical">CRITICAL</StatusPill>
<StatusPill variant="cot-hostile">HOSTILE</StatusPill>
<StatusPill variant="transport-ble">BLE</StatusPill>
<StatusPill variant="count">8</StatusPill>
```

Variants cover every `status-*`, `cot-*`, `transport-*` semantic, plus `count` (uses status-critical).

## CalloutBar

```tsx
<CalloutBar variant="active-call" icon={<PhoneIcon />} onDismiss={() => ...}>
  Active call · Dispatch North
</CalloutBar>
```

Variants: `info | success | warning | critical | active-call`. Dismissible when `onDismiss` is provided.

## Toggle

```tsx
<Toggle checked={ldEnabled} onChange={setLdEnabled} label="Low-detection mode" />
```

`role="switch"` + `aria-checked`. Used heavily in Settings.

## CotMarker

```tsx
<CotMarker affiliation="friendly" remarks="Patrol Bravo" />
```

Affiliations: `friendly | hostile | neutral | unknown`. Drives marker color via `cot-*` tokens.

## When to add a new primitive

Promote a feature-local component into `dtak/` only if:

1. It would be used in 3+ feature folders, or
2. It encapsulates a token contract that should be enforced (e.g. ensures consistent focus rings).

Otherwise: keep it in the feature folder; just consume DTAK semantic tokens directly.
