# Mobile vs Web

Peat-Chat ships the same web bundle to mobile via Capacitor (iOS WKWebView, Android System WebView). DTAK leverages this — there is no parallel native UI tree.

## Touch targets

| Context | Minimum |
|---|---|
| Web (desktop / pointer) | 32px |
| Mobile (web in browser) | 44px |
| Capacitor (iOS / Android) | 44px |
| **Low-Detection (any)** | **48px** (DIG mandate) |

Primitives enforce this:
- `Button` size `md` resolves to 40px desktop / 44px mobile.
- `IconButton` is always 44px (mobile-friendly default).
- `Button` size `lg` is 48px (use in LD or for primary CTAs).

## Breakpoints

Tailwind defaults:
- `sm` 640px
- `md` 768px
- `lg` 1024px
- `xl` 1280px
- `2xl` 1536px

Mobile-first composition assumed throughout.

## Responsive patterns in Peat-Chat

- **Chat list, room view, mesh viewer** — mobile is single-pane; desktop adds a sidebar.
- **Tactical map** — full-bleed on mobile; pane-aware on desktop.
- **Active-call bar** — bottom-fixed on mobile; header-pinned on desktop.

## What does NOT have parity

- **Native context menus / share sheets** — Capacitor plugins handle these per platform; DTAK doesn't theme them.
- **Native push notifications** — outside DTAK's scope.
- **Hardware controls** (PTT button, volume) — Kotlin / Capacitor bridge, not DTAK.

## Capacitor-specific notes

- Theme persistence: `useTheme()` writes to `localStorage`, which Capacitor proxies to native preferences automatically.
- Status bar color: handled outside DTAK — see Capacitor's `@capacitor/status-bar` plugin.
- Safe-area insets: use Tailwind's `env(safe-area-inset-*)` utilities directly in components that need them.
