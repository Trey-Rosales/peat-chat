import { useChatStore } from '@/store/chatStore'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type Status = 'online' | 'limited' | 'offline'

interface TransportRow {
  label: string
  detail: string
  status: 'ok' | 'warn' | 'off'
}

function statusDot(status: TransportRow['status']) {
  return cn(
    'h-1.5 w-1.5 rounded-full shrink-0',
    status === 'ok' && 'bg-brand',
    status === 'warn' && 'bg-status-warning',
    status === 'off' && 'bg-fg-secondary/40',
  )
}

export function OnlineIndicator() {
  const connected = useChatStore((s) => s.connected)
  const meshPeers = useChatStore((s) => s.meshPeers)

  // Flatten peers across rooms; bucket by transport.
  const flatPeers = Object.values(meshPeers).flat()
  const btleCount = flatPeers.filter((p) => p.transport === 'btle').length
  const wifiCount = flatPeers.filter((p) => p.transport === 'wifi-direct').length
  const internetMesh = flatPeers.filter(
    (p) => p.transport !== 'btle' && p.transport !== 'wifi-direct',
  ).length

  const meshTotal = btleCount + wifiCount + internetMesh

  const overall: Status = !connected
    ? 'offline'
    : meshTotal > 0
      ? 'online'
      : 'limited'

  const dotClass = cn(
    'h-2.5 w-2.5 rounded-full transition-colors',
    overall === 'online' && 'bg-brand shadow-[0_0_8px_var(--color-brand)]',
    overall === 'limited' && 'bg-status-warning',
    overall === 'offline' && 'bg-status-critical',
  )

  const rows: TransportRow[] = [
    {
      label: 'WebSocket',
      detail: connected ? 'Connected' : 'Disconnected',
      status: connected ? 'ok' : 'off',
    },
    {
      label: 'Mesh — Bluetooth LE',
      detail: btleCount === 0 ? 'No peers' : `${btleCount} peer${btleCount !== 1 ? 's' : ''}`,
      status: btleCount > 0 ? 'ok' : 'off',
    },
    {
      label: 'Mesh — Wi-Fi Direct',
      detail: wifiCount === 0 ? 'No peers' : `${wifiCount} peer${wifiCount !== 1 ? 's' : ''}`,
      status: wifiCount > 0 ? 'ok' : 'off',
    },
    {
      label: 'Mesh — Internet',
      detail: internetMesh === 0 ? 'No peers' : `${internetMesh} peer${internetMesh !== 1 ? 's' : ''}`,
      status: internetMesh > 0 ? 'ok' : 'off',
    },
  ]

  const summary =
    overall === 'online'
      ? `Online · ${meshTotal} mesh peer${meshTotal !== 1 ? 's' : ''}`
      : overall === 'limited'
        ? 'Online · no mesh peers'
        : 'Offline'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Network status: ${summary}`}
          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-secondary hover:bg-surface-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <span className={dotClass} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className={dotClass} />
          <span className="text-sm font-medium text-fg-primary">{summary}</span>
        </div>
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2">
              <span className={statusDot(r.status)} />
              <span className="text-xs text-fg-primary">{r.label}</span>
              <span className="ml-auto text-xs text-fg-secondary">{r.detail}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
