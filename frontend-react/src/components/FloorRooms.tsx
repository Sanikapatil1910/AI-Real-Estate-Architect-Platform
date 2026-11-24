import type { BuildingType } from '@/types'

export const FLOOR_ROOM_TYPES: Array<[string, string]> = [
  ['living_room', 'Living room'], ['dining', 'Dining'], ['kitchen', 'Kitchen'], ['utility', 'Utility'],
  ['master_bedroom', 'Master bedroom'], ['bedroom', 'Bedroom'], ['guest_bedroom', 'Guest bedroom'],
  ['bathroom', 'Bathroom'], ['puja_room', 'Puja room'], ['study', 'Study'], ['family_lounge', 'Family lounge'],
]

export function floorCount(b: BuildingType | string): number {
  return b === 'Ground' ? 1 : b === 'G+2' || b === 'Villa' ? 3 : 2
}

export type FloorCounts = Array<Record<string, number>>

export function defaultFloorCounts(n: number): FloorCounts {
  const out: FloorCounts = Array.from({ length: n }, () => ({}))
  out[0] = { living_room: 1, kitchen: 1, dining: 1, bathroom: 1 }
  if (n > 1) out[1] = { master_bedroom: 1, bedroom: 1, bathroom: 2 }
  return out
}

export function flattenFloorCounts(fc: FloorCounts): { rooms: Array<{ room_type: string }>; floorRooms: string[][] } {
  const floorRooms = fc.map((c) => FLOOR_ROOM_TYPES.flatMap(([t]) => Array.from({ length: Math.max(0, c[t] || 0) }, () => t)))
  return { rooms: floorRooms.flat().map((t) => ({ room_type: t })), floorRooms }
}

interface Props {
  buildingType: BuildingType
  enabled: boolean
  setEnabled: (v: boolean) => void
  counts: FloorCounts
  setCounts: (v: FloorCounts) => void
  allowAdjust: boolean
  setAllowAdjust: (v: boolean) => void
}

/** "Rooms per floor": exactly which rooms (and how many) go on each floor. */
export default function FloorRooms({ buildingType, enabled, setEnabled, counts, setCounts, allowAdjust, setAllowAdjust }: Props) {
  const n = floorCount(buildingType)
  const adjust = (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, marginTop: 10 }}>
      <input type="checkbox" checked={allowAdjust} onChange={(e) => setAllowAdjust(e.target.checked)} />
      <span>Let the planner adjust my brief (extra floor, fewer rooms, no parking) if it does not fit. Off = exactly what I entered; if it cannot fit you get an explanation instead.</span>
    </label>
  )
  if (n < 2) return <div className="form-section">{adjust}</div>
  const names = ['Ground floor', '1st floor', '2nd floor']
  const cur = Array.from({ length: n }, (_, i) => counts[i] ?? {})
  const set = (fi: number, t: string, v: number) => {
    const next = cur.map((c) => ({ ...c }))
    next[fi][t] = Math.max(0, Math.min(6, v))
    setCounts(next)
  }
  return (
    <div className="form-section">
      <div className="form-section-header"><h3>🏠 Rooms per floor</h3></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Choose exactly which rooms go on each floor
      </label>
      {enabled && cur.map((c, fi) => (
        <div key={fi} style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{names[fi]}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px', gap: '4px 8px', alignItems: 'center' }}>
            {FLOOR_ROOM_TYPES.map(([t, label]) => (
              <div key={t} style={{ display: 'contents' }}>
                <span style={{ fontSize: 12 }}>{label}</span>
                <input type="number" min={0} max={6} value={c[t] || 0} onChange={(e) => set(fi, t, Number(e.target.value))} />
              </div>
            ))}
          </div>
        </div>
      ))}
      {adjust}
      {enabled && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          Bedrooms bring their attached bath. Nothing outside these lists is added.
        </p>
      )}
    </div>
  )
}
