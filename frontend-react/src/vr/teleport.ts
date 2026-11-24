/**
 * Teleport aiming for the VR walk-through: a ballistic arc from the controller (or, on the desktop, from the eye along the view direction) that lands on
 * the first upward-facing surface it meets, and is stopped by walls, furniture sides and ceilings / slab undersides.  Landing on an upper floor works the
 * same way as on the ground floor: aim down onto it from the stairs, a landing or through the stairwell opening.  A landing is only valid where the body
 * can stand (NavGrid.canStand, with a small snap to a standable neighbour so a spot beside a wall is forgiving).
 * Pure TypeScript on the NavGrid (no three.js): unit-tested in node on synthetic geometry and in a browser on real generated houses.
 * Units: the arc is in metres in the world frame (house frame x 0.3048); the nav grid is in feet.
 */
import type { NavGrid, Foot } from './navGrid'

export const FT_M = 0.3048
export interface ArcOptions {
  speed?: number; gravity?: number; dt?: number; maxT?: number; snap?: number
  /** the walking levels of the house (floor surfaces, feet): furniture tops (a table, a bed, a sofa back) are standable by the grid but are no place to teleport to */
  levels?: number[]
}
export interface ArcResult {
  /** the arc in metres (world frame), ending where it landed or was stopped */
  points: Array<[number, number, number]>
  /** where the person would stand (feet, house frame) - null when the arc found no valid spot */
  target: Foot | null
  valid: boolean
  reason: 'ok' | 'wall' | 'ceiling' | 'no-floor' | 'cannot-stand' | 'outside'
}

export function aimArc(nav: NavGrid, origin: [number, number, number], dir: [number, number, number], o: ArcOptions = {}): ArcResult {
  const speed = o.speed ?? 8, g = o.gravity ?? 9.8, dt = o.dt ?? 0.02, maxT = o.maxT ?? 3, snap = o.snap ?? 0.7
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
  const v: [number, number, number] = [(dir[0] / len) * speed, (dir[1] / len) * speed, (dir[2] / len) * speed]
  const pts: Array<[number, number, number]> = [[origin[0], origin[1], origin[2]]]
  let [px, py, pz] = origin
  const end = (reason: ArcResult['reason'], target: Foot | null = null): ArcResult => ({ points: pts, target, valid: reason === 'ok', reason })
  const t0 = 0.12                                        // the hand may be right next to a wall or the underside of a stair: do not count that
  for (let t = 0; t < maxT; t += dt) {
    const nx = px + v[0] * dt, nz = pz + v[2] * dt
    v[1] -= g * dt
    const ny = py + v[1] * dt
    // sub-steps of at most 0.2 ft so thin slabs and walls cannot be skipped
    const dist = Math.hypot(nx - px, ny - py, nz - pz) / FT_M
    const n = Math.max(1, Math.ceil(dist / 0.2))
    for (let k = 1; k <= n; k++) {
      const f = k / n
      const ax = px + (nx - px) * ((k - 1) / n), ay = py + (ny - py) * ((k - 1) / n), az = pz + (nz - pz) * ((k - 1) / n)
      const bx = px + (nx - px) * f, by = py + (ny - py) * f, bz = pz + (nz - pz) * f
      const xf = bx / FT_M, yf = by / FT_M, zf = bz / FT_M, yaf = ay / FT_M
      if (by < ay) {                                     // going down: the first upward surface crossed is the landing
        const h = nav.surfaceBetween(xf, zf, yaf, yf)
        if (h !== null) {
          pts.push([bx, h * FT_M, bz])
          const s = nav.canStand(xf, zf, h) !== null ? { x: xf, y: nav.canStand(xf, zf, h)!, z: zf } : nav.nearestStandable(xf, zf, h, snap)
          if (!s || Math.abs(s.y - h) >= 0.6) return end('cannot-stand')
          if (o.levels && !o.levels.some((l) => Math.abs(l - s.y) < 0.5) && nav.patchGround(s.x, s.z, s.y) === null) return end('cannot-stand')
          return end('ok', { x: s.x, y: s.y, z: s.z })
        }
      }
      if (t >= t0 && nav.blockedBetween(xf, zf, yaf, yf)) {
        pts.push([ax, ay, az])
        return end(ay < by ? 'ceiling' : 'wall')
      }
    }
    px = nx; py = ny; pz = nz
    pts.push([px, py, pz])
    if (!Number.isFinite(px + py + pz)) return end('outside')
    if (py < -5) return end('no-floor')
  }
  return end('no-floor')
}
