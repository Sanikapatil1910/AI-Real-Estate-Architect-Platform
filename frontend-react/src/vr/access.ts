/**
 * Walkability audit of a built house: can a person walk from the entrance of the house to every room of every floor, on foot,
 * using the SAME collision grid and the SAME movement code as the VR walker (no teleport, no floor buttons)?
 *
 * This is deliberately strict and alignment-proof: a breadth-first search over a fine lattice (0.15 ft, 4-neighbours) of
 * standing places (`NavGrid.canStand`, which carries the body radius), starting at the spawn point.  The old audit used a coarse
 * lattice and counted a room as reached if *any* of several lattices got in, which could both miss real doorways and hide real
 * pockets.  Here a room counts only if the search reaches standing places inside it, and each room is then proven again by
 * replaying the found path with `NavGrid.move` (the call the stick walking uses).
 */
import type { NavGrid, Foot } from './navGrid'

export interface AccessRoom { id: string; type: string; floor: number; floor_y: number; rect: { x0: number; z0: number; x1: number; z1: number } }
export interface AccessDoor { room: string; connects_to?: string | null; x1: number; y1: number; x2: number; y2: number; width?: number; door_type?: string }
export interface AccessInput {
  nav: NavGrid
  spawn: Foot
  /** a standing place just outside the front door; the walk starts here (the person arrives at the house), and must reach the spawn point too */
  entrance?: Foot | null
  rooms: AccessRoom[]
  floors: Array<{ floor_y: number }>
  /** plan doors per floor (feet, plan frame = nav frame); optional */
  doors?: AccessDoor[][]
}
export interface RoomAccess {
  key: string
  type: string
  floor: number
  reached: boolean
  /** square feet of standing places the walker can reach inside the room (a usable room has some open floor, not one crack) */
  openArea: number
  /** the path from the spawn point was walked again with NavGrid.move and arrived */
  replay: boolean
  /** doors of the room whose opening can be walked through (centre reached and both sides reached) / doors it has */
  doorsOpen: number
  doors: number
  /** largest circle of free standing places (ft radius) that fits inside the reached part of the room */
  clearance: number
}
export interface AccessReport {
  step: number
  cells: number
  ms: number
  rooms: RoomAccess[]
  unreachable: RoomAccess[]
  floorsReached: boolean[]
  /** the walk started outside the front door and got to the spawn point inside (null: no front door in the plan) */
  entranceToSpawn: boolean | null
  doorFailures: Array<{ floor: number; room: string; to?: string | null; reason: string }>
}

interface Node { x: number; y: number; z: number; parent: number }

/** Every standing place reachable from `start` (feet), on a lattice of `step` ft. */
export function walkFill(nav: NavGrid, start: Foot, step = 0.15, limit = 4e6): { nodes: Map<number, Node>; key: (x: number, z: number, y: number) => number } {
  const W = 4096
  const key = (x: number, z: number, y: number) => ((Math.round(x / step) + 2048) * W + (Math.round(z / step) + 2048)) * 64 + Math.max(0, Math.min(63, Math.round(y / 2)))
  const nodes = new Map<number, Node>()
  const g0 = nav.canStand(start.x, start.z, start.y)
  const s: Foot = g0 === null ? start : { x: start.x, y: g0, z: start.z }
  const k0 = key(s.x, s.z, s.y)
  nodes.set(k0, { x: s.x, y: s.y, z: s.z, parent: -1 })
  const q: number[] = [k0]
  for (let h = 0; h < q.length && nodes.size < limit; h++) {
    const kp = q[h]
    const p = nodes.get(kp)!
    for (let d = 0; d < 4; d++) {
      const nx = p.x + (d === 0 ? step : d === 1 ? -step : 0)
      const nz = p.z + (d === 2 ? step : d === 3 ? -step : 0)
      const g = nav.canStand(nx, nz, p.y)
      if (g === null) continue
      const k = key(nx, nz, g)
      if (nodes.has(k)) continue
      nodes.set(k, { x: nx, y: g, z: nz, parent: kp })
      q.push(k)
    }
  }
  return { nodes, key }
}

export function auditAccess(h: AccessInput, step = 0.15): AccessReport {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const startAt = h.entrance ?? h.spawn
  const { nodes, key } = walkFill(h.nav, startAt, step)
  const near = (x: number, z: number, y: number, tol = 0.3): Node | null => {
    for (let dx = -tol; dx <= tol + 1e-9; dx += step) for (let dz = -tol; dz <= tol + 1e-9; dz += step) {
      for (const ly of [y - 2, y, y + 2]) {
        const n = nodes.get(key(x + dx, z + dz, ly))
        if (n && Math.abs(n.y - y) < 1.2) return n
      }
    }
    return null
  }
  const list = [...nodes.values()]
  const rooms: RoomAccess[] = h.rooms.map((r) => {
    const inside = list.filter((p) => p.x >= r.rect.x0 && p.x <= r.rect.x1 && p.z >= r.rect.z0 && p.z <= r.rect.z1 && Math.abs(p.y - r.floor_y) < 1.2)
    let replay = false
    if (inside.length) {
      // the cell nearest the room centre; walk the stored path back from it with the real movement code
      const cx = (r.rect.x0 + r.rect.x1) / 2, cz = (r.rect.z0 + r.rect.z1) / 2
      let best = inside[0], bd = Infinity
      for (const p of inside) { const d = (p.x - cx) ** 2 + (p.z - cz) ** 2; if (d < bd) { bd = d; best = p } }
      const path: Node[] = []
      let cur: Node | undefined = best
      let guard = 0
      while (cur && guard++ < 200000) { path.push(cur); cur = cur.parent >= 0 ? nodes.get(cur.parent) : undefined }
      path.reverse()
      let f: Foot = { ...startAt }
      const g = h.nav.canStand(f.x, f.z, f.y); if (g !== null) f.y = g
      let ok = path.length > 0
      for (let i = 1; i < path.length && ok; i++) {
        const nf = h.nav.move(f, path[i].x - f.x, path[i].z - f.z)
        if (Math.hypot(nf.x - path[i].x, nf.z - path[i].z) > 0.03) ok = false
        f = nf
      }
      replay = ok && Math.hypot(f.x - best.x, f.z - best.z) < 0.05 && Math.abs(f.y - r.floor_y) < 1.2
    }
    // clearance: the largest free circle among the reached cells (distance to the nearest unreached/blocked lattice point, on the room's own floor)
    let clearance = 0
    if (inside.length) {
      const free = new Set(inside.map((p) => key(p.x, p.z, p.y)))
      const R = 1.2
      let bestR = 0
      for (const p of inside) {
        if (((Math.round(p.x / step) + Math.round(p.z / step)) & 3) !== 0) continue // sample every 4th cell
        let rr = 0
        for (let r2 = step; r2 <= R + 1e-9; r2 += step) {
          let ok = true
          for (let a = 0; a < 12 && ok; a++) { const ang = (a / 12) * Math.PI * 2; if (!free.has(key(p.x + Math.cos(ang) * r2, p.z + Math.sin(ang) * r2, p.y))) ok = false }
          if (!ok) break
          rr = r2
        }
        if (rr > bestR) bestR = rr
      }
      clearance = Math.round(bestR * 100) / 100
    }
    return { key: `${r.floor}:${r.id}`, type: r.type, floor: r.floor, reached: inside.length > 0, openArea: Math.round(inside.length * step * step * 10) / 10, replay, doorsOpen: 0, doors: 0, clearance }
  })

  // doors: usable when the opening itself and a spot a little way out on both sides are reached
  const doorFailures: AccessReport['doorFailures'] = []
  const byKey = new Map(rooms.map((r) => [r.key, r]))
  const keyOf = (floor: number, id: string) => `${floor}:${id}`
  ;(h.doors ?? []).forEach((ds, fi) => {
    const fy = h.floors[fi]?.floor_y ?? 0
    for (const d of ds) {
      const cx = (d.x1 + d.x2) / 2, cz = (d.y1 + d.y2) / 2
      const vertical = Math.abs(d.x1 - d.x2) < 1e-6
      const n: [number, number] = vertical ? [1, 0] : [0, 1]
      const a = near(cx - n[0] * 1.6, cz - n[1] * 1.6, fy + 0.2, 1.0)
      const c = near(cx, cz, fy + 0.2, 0.3)
      const b = near(cx + n[0] * 1.6, cz + n[1] * 1.6, fy + 0.2, 1.0)
      const outside = !d.connects_to
      const usable = !!c && (outside ? !!(a || b) : !!(a && b))
      for (const id of [d.room, d.connects_to]) {
        if (!id) continue
        const r = byKey.get(keyOf(fi, id)); if (!r) continue
        r.doors++
        if (usable) r.doorsOpen++
      }
      if (!usable) doorFailures.push({ floor: fi, room: d.room, to: d.connects_to, reason: !c ? 'opening itself cannot be stood in' : !a ? `no reachable floor on the ${vertical ? 'west' : 'north'} side` : 'no reachable floor on the far side' })
    }
  })
  const floorsReached = h.floors.map((f) => list.some((p) => Math.abs(p.y - f.floor_y) < 0.6))
  const unreachable = rooms.filter((r) => !r.reached)
  const entranceToSpawn = h.entrance ? !!near(h.spawn.x, h.spawn.z, h.spawn.y, 0.3) : null
  return { entranceToSpawn, step, cells: nodes.size, ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0), rooms, unreachable, floorsReached, doorFailures }
}
