/**
 * Sitting for the VR walk-through.  The seat sites come from the furniture builder (src/components/seatRegistry.ts); here each one is resolved against the loaded
 * walking grid: the real seat height is read from the mesh (a cushion, a mattress, a chair pad), and a place to stand up to is found.  Pure TypeScript, no three.js.
 * Units: feet, house frame.
 */
import type { NavGrid, Foot } from './navGrid'
import type { SeatKind, SeatSite } from '../components/seatRegistry'

export interface SitSpot {
  id: string
  kind: SeatKind
  x: number
  z: number
  /** floor under the furniture */
  floorY: number
  /** top of the seat (cushion, mattress, pad) */
  seatY: number
  /** whether seatY was measured from the mesh (true) or is the expected default (false) */
  measured: boolean
  fx: number
  fz: number
  w: number
  d: number
  /** the room it is in (key "floor:id") or null */
  room: string | null
}

/** seated eye height above the seat surface (m): a seated adult's eyes are about 0.75 m above the seat */
export const SEATED_EYE_M = 0.75
/** how far (ft, in the plan) a seat can be and still be taken from where the person stands */
export const SIT_REACH_FT = 15

const MIN_ABOVE = 0.9, MAX_ABOVE = 2.9   // a seat is between 0.9 and 2.9 ft above the floor (a stool is 2.3, a dining chair 1.75, a sofa cushion 2.0)

/** the top of the seat at a site, measured on the walking grid's upward surfaces around the centre of the seat */
export function measureSeat(nav: NavGrid, s: SeatSite): { y: number; measured: boolean } {
  const ox = Math.min(0.3, s.w * 0.25), oz = Math.min(0.3, s.d * 0.25)
  const found: number[] = []
  for (const [dx, dz] of [[0, 0], [ox, 0], [-ox, 0], [0, oz], [0, -oz]]) {
    const hs = nav.upHeights(s.x + dx, s.z + dz).filter((h) => h >= s.y + MIN_ABOVE && h <= s.y + MAX_ABOVE)
    if (hs.length) found.push(Math.max(...hs))
  }
  if (!found.length) return { y: s.y + s.hint, measured: false }
  found.sort((a, b) => a - b)
  return { y: found[Math.floor(found.length / 2)], measured: true }
}

/** all seats of a house, with measured heights; seats that coincide (two registrations of the same piece) are merged */
export function resolveSeats(nav: NavGrid, sites: SeatSite[], roomOf?: (x: number, y: number, z: number) => string | null): SitSpot[] {
  const out: SitSpot[] = []
  for (const s of sites) {
    if (out.some((o) => Math.abs(o.x - s.x) < 0.3 && Math.abs(o.z - s.z) < 0.3 && Math.abs(o.floorY - s.y) < 1)) continue
    const m = measureSeat(nav, s)
    out.push({ id: `seat${out.length}`, kind: s.kind, x: s.x, z: s.z, floorY: s.y, seatY: m.y, measured: m.measured, fx: s.fx, fz: s.fz, w: s.w, d: s.d, room: roomOf ? roomOf(s.x, s.y + 3, s.z) : null })
  }
  return out
}

/** where the person stands up to: where they were before sitting when that is close and free, else free floor in front of / beside / behind the seat */
export function standSpot(nav: NavGrid, s: SitSpot, prev?: Foot | null): Foot | null {
  const fromY = s.floorY + 0.2
  const ok = (x: number, z: number): Foot | null => { const g = nav.canStand(x, z, fromY); return g !== null && Math.abs(g - s.floorY) < 1.2 ? { x, y: g, z } : null }
  if (prev && Math.hypot(prev.x - s.x, prev.z - s.z) < 7 && Math.abs(prev.y - s.floorY) < 1.2) { const p = ok(prev.x, prev.z); if (p) return p }
  const half = Math.max(s.w, s.d) / 2
  const px = -s.fz, pz = s.fx                           // sideways
  const tries: Array<[number, number]> = []
  for (const d of [half + 0.9, half + 1.5, half + 2.3]) tries.push([s.fx * d, s.fz * d])                       // in front
  for (const d of [half + 0.9, half + 1.5]) tries.push([px * d, pz * d], [-px * d, -pz * d])                    // beside
  for (const d of [half + 0.9, half + 1.5, half + 2.3]) tries.push([-s.fx * d, -s.fz * d])                      // behind (a chair is pushed back)
  for (const [dx, dz] of tries) { const f = ok(s.x + dx, s.z + dz); if (f) return f }
  const n = nav.nearestStandable(s.x, s.z, fromY, 5)
  return n && Math.abs(n.y - s.floorY) < 1.2 ? n : null
}

/** the best seat for a person at `foot` looking along (lx, lz): near, on the same floor, and preferably in front */
export function nearestSeat(spots: SitSpot[], foot: Foot, look?: { x: number; z: number }, reach = SIT_REACH_FT): SitSpot | null {
  let best: SitSpot | null = null, bestScore = Infinity
  for (const s of spots) {
    if (Math.abs(s.floorY - foot.y) > 3) continue
    const dx = s.x - foot.x, dz = s.z - foot.z, d = Math.hypot(dx, dz)
    if (d > reach) continue
    const front = look && d > 1e-6 ? (dx * look.x + dz * look.z) / d : 0       // 1 straight ahead, -1 behind
    const score = d - 2.5 * front
    if (score < bestScore) { bestScore = score; best = s }
  }
  return best
}
