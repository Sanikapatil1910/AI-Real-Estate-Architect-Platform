import type { ReactNode } from 'react'
import { ARCH_STYLES } from '@/lib/archStyle'
import type { ArchitecturalStyle } from '@/types'

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="brand-mark" aria-hidden="true" style={{ background: light ? 'var(--gold-soft)' : undefined }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={light ? '#2b1d16' : '#f1e3bd'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5" /><path d="M10 20v-5h4v5" />
      </svg>
    </span>
  )
}

export const STYLE_INFO: Record<ArchitecturalStyle, { img: string; blurb: string }> = {
  'Modern Minimalistic': { img: '/samples/style-modern.jpg', blurb: 'Clean lines, flat roofs, large glazing, warm minimal interiors.' },
  'Traditional Indian': { img: '/samples/style-traditional.jpg', blurb: 'Pitched tile roofs, pillared verandah, carved timber, louvred shutters.' },
  'Maharashtrian Wada': { img: '/samples/style-wada.jpg', blurb: 'Carved timber columns, deep verandah, ochre walls, tiled eaves, gadi seating.' },
}

export function StylePicker({ value, onChange, disabled = false, compact = false }: { value: ArchitecturalStyle; onChange: (s: ArchitecturalStyle) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <div className="style-grid" role="group" aria-label="Architectural style" data-testid="style-cards">
      {ARCH_STYLES.map((s) => (
        <button key={s} type="button" className="style-card" aria-pressed={value === s} disabled={disabled} onClick={() => onChange(s)} data-testid={`style-card-${s.split(' ').pop()!.toLowerCase()}`}>
          {!compact && <img src={STYLE_INFO[s].img} alt={`${s} sample render`} loading="lazy" />}
          <span className="body"><b>{s}</b><span>{STYLE_INFO[s].blurb}</span></span>
        </button>
      ))}
    </div>
  )
}

export function Notice({ kind = 'info', children, testId }: { kind?: 'info' | 'ok' | 'warn' | 'bad'; children: ReactNode; testId?: string }) {
  const c = kind === 'ok' ? 'notice-ok' : kind === 'warn' ? 'notice-warn' : kind === 'bad' ? 'notice-bad' : ''
  return <div className={`notice ${c}`} role={kind === 'bad' ? 'alert' : 'status'} data-testid={testId}>{children}</div>
}

export function Spinner({ label }: { label?: string }) {
  return <span className="row" style={{ gap: 8 }}><span className="spinner" aria-hidden="true" />{label && <span>{label}</span>}</span>
}

/** Small deterministic preview of a stored plan's ground floor (no WebGL): rooms as tinted rectangles. */
const TINT: Record<string, string> = {
  living_room: '#e9d3a6', dining: '#ecd9b4', kitchen: '#e3c7a0', master_bedroom: '#d9b99a', bedroom: '#dfc3a4', guest_bedroom: '#dfc3a4', bathroom: '#c9d6d1',
  toilet: '#c9d6d1', utility: '#d7c7ae', puja_room: '#f0dca4', staircase: '#bfae98', passage: '#eadfcb', balcony: '#cfd9b8', parking: '#c9c3b8', courtyard: '#c6d6a8', study: '#dcc9ae',
}
interface RectRoom { room_type: string; x: number; y: number; width: number; length: number }
export function PlanThumb({ rooms, plotW, plotL }: { rooms: RectRoom[]; plotW?: number; plotL?: number }) {
  if (!rooms.length) return <div className="skeleton" style={{ aspectRatio: '16/10' }} />
  const w = plotW ?? Math.max(...rooms.map((r) => r.x + r.width))
  const l = plotL ?? Math.max(...rooms.map((r) => r.y + r.length))
  return (
    <svg viewBox={`-1 -1 ${w + 2} ${l + 2}`} role="img" aria-label="Floor plan preview" style={{ width: '100%', aspectRatio: '16/10', background: 'var(--ivory-2)', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width={w} height={l} fill="#f4ecdc" stroke="#d3c2a5" strokeWidth={Math.max(w, l) / 200} />
      {rooms.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.width} height={r.length} fill={TINT[r.room_type] ?? '#e6dac3'} stroke="#7a4a29" strokeWidth={Math.max(w, l) / 260} />)}
    </svg>
  )
}
