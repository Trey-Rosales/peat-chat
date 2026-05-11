import { useState, useRef, useEffect } from 'react'
import type { MeshPeer } from '../types'

const TRANSPORT_COLORS: Record<string, string> = {
  tcp:            '#3b82f6',
  btle:           '#8b5cf6',
  quic:           '#06b6d4',
  wifi:           '#f59e0b',
  'wifi-direct':  '#f59e0b',
  lan:            '#22c55e',
  p2p:            '#ec4899',
  relay:          '#6b7280',
}

interface Props {
  peers: MeshPeer[]
  selfName: string
  selfShortId: string
}

export function MeshViewer({ peers, selfName, selfShortId }: Props) {
  const [selectedPeer, setSelectedPeer] = useState<MeshPeer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 600, height: 400 })

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setDims({ width, height })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const cx = dims.width / 2
  const cy = dims.height / 2
  const innerRadius = Math.min(cx, cy) * 0.55
  const outerOffset = Math.min(cx, cy) * 0.22

  // Separate direct peers from relay (BLE) peers
  const directPeers = peers.filter((p) => !p.connected_via)
  const relayPeers = peers.filter((p) => !!p.connected_via)

  // Position direct peers in the inner ring around self
  const directPositions = directPeers.map((peer, i) => {
    const angle = (2 * Math.PI * i) / Math.max(directPeers.length, 1) - Math.PI / 2
    return {
      peer,
      x: cx + innerRadius * Math.cos(angle),
      y: cy + innerRadius * Math.sin(angle),
    }
  })

  // Build a lookup from peer ID to position for parent resolution
  const posById = new Map<string, { x: number; y: number }>()
  posById.set('self', { x: cx, y: cy })
  for (const dp of directPositions) {
    posById.set(dp.peer.id, { x: dp.x, y: dp.y })
  }

  // Position relay peers near their parent node, fanned out slightly further
  const childrenOf = new Map<string, MeshPeer[]>()
  for (const rp of relayPeers) {
    const list = childrenOf.get(rp.connected_via!) || []
    list.push(rp)
    childrenOf.set(rp.connected_via!, list)
  }

  const relayPositions = relayPeers.map((peer) => {
    const parentPos = posById.get(peer.connected_via!) || { x: cx, y: cy }
    const siblings = childrenOf.get(peer.connected_via!) || [peer]
    const idx = siblings.indexOf(peer)
    const count = siblings.length

    // Fan angle: spread children in a 120-degree arc away from center
    const parentAngle = Math.atan2(parentPos.y - cy, parentPos.x - cx)
    const spreadAngle = Math.PI * 0.66 // 120 degrees
    const startAngle = parentAngle - spreadAngle / 2
    const step = count > 1 ? spreadAngle / (count - 1) : 0
    const childAngle = count === 1 ? parentAngle : startAngle + step * idx

    return {
      peer,
      x: parentPos.x + outerOffset * Math.cos(childAngle),
      y: parentPos.y + outerOffset * Math.sin(childAngle),
      parentPos,
    }
  })

  // Merge all positions for node rendering
  const positions = [
    ...directPositions.map((dp) => ({ ...dp, parentPos: null as { x: number; y: number } | null })),
    ...relayPositions,
  ]

  // Find unique transports in use for legend
  const activeTransports = [...new Set(peers.map((p) => p.transport))]

  return (
    <div ref={containerRef} className="flex-1 relative bg-surface-canvas overflow-hidden">
      <svg width={dims.width} height={dims.height} className="absolute inset-0">
        {/* Connection lines */}
        {positions.map(({ peer, x, y, parentPos }) => {
          const color = TRANSPORT_COLORS[peer.transport] || '#6b7280'
          const isDegraded = peer.state === 'degraded'
          const isRelay = !!peer.connected_via
          // Direct peers connect to self (center); relay peers connect to parent
          const fromX = isRelay && parentPos ? parentPos.x : cx
          const fromY = isRelay && parentPos ? parentPos.y : cy
          const mx = (fromX + x) / 2
          const my = (fromY + y) / 2
          // Relay links are always dashed; direct links are dashed only when degraded
          const dashed = isRelay || isDegraded
          return (
            <g key={`line-${peer.id}`}>
              <line
                x1={fromX} y1={fromY} x2={x} y2={y}
                stroke={color}
                strokeWidth={isRelay ? 1.5 : 2}
                opacity={isDegraded ? 0.3 : 0.6}
                strokeDasharray={dashed ? '6 4' : 'none'}
              />
              {/* Transport label */}
              <rect
                x={mx - 20} y={my - 18}
                width={40} height={14}
                rx={3}
                fill="#0b141a"
                opacity={0.8}
              />
              <text
                x={mx} y={my - 8}
                fill={color}
                fontSize={9}
                textAnchor="middle"
                fontWeight={600}
              >
                {peer.transport.toUpperCase()}
              </text>
              {/* Latency */}
              <text
                x={mx} y={my + 6}
                fill="#8696a0"
                fontSize={8}
                textAnchor="middle"
              >
                {peer.latency_ms > 0 ? `${peer.latency_ms}ms` : '...'}
              </text>
            </g>
          )
        })}

        {/* Self node (center) */}
        <circle cx={cx} cy={cy} r={28} fill="#00a884" opacity={0.12}>
          <animate attributeName="r" values="28;34;28" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.12;0.04;0.12" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx={cx} cy={cy} r={22} fill="#00a884" />
        <text x={cx} y={cy - 3} fill="white" fontSize={10} textAnchor="middle" fontWeight={600}>
          {selfName.length > 6 ? selfName.slice(0, 6) : selfName}
        </text>
        <text x={cx} y={cy + 10} fill="rgba(255,255,255,0.6)" fontSize={8} textAnchor="middle">
          YOU
        </text>

        {/* Peer nodes */}
        {positions.map(({ peer, x, y }) => {
          const color = TRANSPORT_COLORS[peer.transport] || '#6b7280'
          const isSelected = selectedPeer?.id === peer.id
          const isRelay = !!peer.connected_via
          const nodeRadius = isRelay ? 14 : 18
          return (
            <g
              key={`node-${peer.id}`}
              onClick={() => setSelectedPeer(isSelected ? null : peer)}
              style={{ cursor: 'pointer' }}
            >
              {/* Pulse ring */}
              {peer.state === 'connected' && !isRelay && (
                <circle cx={x} cy={y} r={22} fill={color} opacity={0.1}>
                  <animate attributeName="r" values="20;26;20" dur="2.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.12;0.03;0.12" dur="2.5s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Selection ring */}
              {isSelected && (
                <circle cx={x} cy={y} r={nodeRadius + 6} fill="none" stroke={color} strokeWidth={2} opacity={0.6} />
              )}
              {/* Node circle */}
              <circle cx={x} cy={y} r={nodeRadius} fill={color} opacity={isRelay ? 0.75 : 0.9} />
              {/* Name above */}
              <text x={x} y={y - nodeRadius - 8} fill="#e9edef" fontSize={isRelay ? 10 : 11} textAnchor="middle" fontWeight={500}>
                {peer.name}
              </text>
              {/* Short ID inside */}
              <text x={x} y={y + 4} fill="white" fontSize={isRelay ? 7 : 8} textAnchor="middle" fontFamily="monospace">
                {peer.short_id}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Empty state */}
      {peers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-surface-2 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8696a0" strokeWidth="1.5">
                <circle cx="12" cy="5" r="2.5" />
                <circle cx="5" cy="18" r="2.5" />
                <circle cx="19" cy="18" r="2.5" />
                <line x1="12" y1="7.5" x2="5" y2="15.5" />
                <line x1="12" y1="7.5" x2="19" y2="15.5" />
                <line x1="5" y1="18" x2="19" y2="18" />
              </svg>
            </div>
            <p className="text-fg-secondary text-sm">No other peers in this room</p>
            <p className="text-fg-tertiary text-xs mt-1 opacity-60">Waiting for mesh connections...</p>
          </div>
        </div>
      )}

      {/* Peer detail panel */}
      {selectedPeer && (
        <PeerDetail peer={selectedPeer} onClose={() => setSelectedPeer(null)} />
      )}

      {/* Transport legend */}
      {activeTransports.length > 0 && (
        <div className="absolute bottom-3 left-3 bg-surface-1/80 backdrop-blur-sm rounded-lg px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(TRANSPORT_COLORS)
            .filter(([name]) => activeTransports.includes(name))
            .map(([name, color]) => (
              <div key={name} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-fg-tertiary uppercase tracking-wide">{name}</span>
              </div>
            ))}
        </div>
      )}

      {/* Peer count badge */}
      <div className="absolute top-3 left-3 bg-surface-1/80 backdrop-blur-sm rounded-lg px-3 py-1.5">
        <span className="text-xs text-fg-secondary">
          {peers.length} peer{peers.length !== 1 ? 's' : ''} connected
        </span>
      </div>
    </div>
  )
}

function PeerDetail({ peer, onClose }: { peer: MeshPeer; onClose: () => void }) {
  const duration = formatDuration(Date.now() - peer.connected_at)
  const color = TRANSPORT_COLORS[peer.transport] || '#6b7280'

  return (
    <div className="absolute top-3 right-3 left-3 md:left-auto bg-surface-1 rounded-xl p-4 md:w-60 shadow-2xl border border-border-subtle">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="text-sm font-medium text-fg-primary">{peer.name}</div>
          <div className="text-xs text-fg-secondary font-mono">{peer.short_id}</div>
        </div>
        <button
          onClick={onClose}
          className="text-fg-secondary hover:text-fg-primary text-lg leading-none"
        >
          &times;
        </button>
      </div>
      <div className="space-y-2.5 text-xs">
        <DetailRow label="Transport">
          <span className="font-semibold" style={{ color }}>{peer.transport.toUpperCase()}</span>
        </DetailRow>
        <DetailRow label="Latency">
          <span className="text-fg-primary">
            {peer.latency_ms > 0 ? `${peer.latency_ms}ms` : 'measuring...'}
          </span>
        </DetailRow>
        <DetailRow label="State">
          <span className={peer.state === 'connected' ? 'text-[#00a884]' : 'text-[#ea4335]'}>
            {peer.state}
          </span>
        </DetailRow>
        <DetailRow label="Connected">
          <span className="text-fg-primary">{duration}</span>
        </DetailRow>
        {peer.connected_via && (
          <DetailRow label="Via">
            <span className="text-fg-primary font-mono text-[10px] break-all">{peer.connected_via.slice(0, 12)}...</span>
          </DetailRow>
        )}
        <DetailRow label="Full ID">
          <span className="text-fg-primary font-mono text-[10px] break-all">{peer.id.slice(0, 24)}...</span>
        </DetailRow>
      </div>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-fg-secondary">{label}</span>
      {children}
    </div>
  )
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}
