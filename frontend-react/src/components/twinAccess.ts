/**
 * Walking clearance of ONE furnished room, checked on the footprints the furniture placer actually claimed (feet, plan frame; no three.js).
 *
 * The placer arranges pieces against walls in a greedy order and only keeps door swings clear.  That is not enough to make a room walkable: a bed and a wardrobe
 * can leave a 0.7 ft crack between them and an open door leaf, so the second door of the room (or a toilet) sits in a pocket nobody can enter.  This module answers
 * the question "can a person walk from every doorway of this room to every other doorway, and up to every piece of furniture?" on a fine grid, with the real
 * obstacles: wall faces, the open door leaves (as the VR walker sees them) and every claimed footprint, each pushed out by a clear-walking margin.
 *
 * `checkRoomAccess` tells what is wrong; `routeStrips` draws the corridor that has to stay free so the placer can try again.  Both are pure functions, so they are
 * unit-tested without a browser (dev/check_access.ts).
 */
export interface R4 { x0: number; x1: number; z0: number; z1: number }
export type W4 = 'top' | 'bottom' | 'left' | 'right'
export interface DoorOpening { wall: W4; a: number; b: number }
export interface RoomAccessInput {
  room: { x: number; y: number; x2: number; y2: number }
  half: Record<W4, number>
  doors: DoorOpening[]
  /** open door leaves that swing into this room (as the VR model has them) */
  leaves: R4[]
  /** every claimed furniture footprint (including the clear zones the placer reserves in front of pieces) */
  blocks: R4[]
}
export type AccessIssue =
  | { kind: 'door-blocked'; door: number }
  | { kind: 'doors-split'; from: number; to: number }
  | { kind: 'piece-sealed'; rect: R4; from: number }
export interface AccessResult { ok: boolean; issues: AccessIssue[]; cells: number; reached: number }

export const CELL = 0.25
/** the gap (ft) kept between a person's centre line and a wall face: the VR body radius */
export const WALL_MARGIN = 0.32
/** how far the centre line of a walker keeps from an open door leaf */
export const LEAF_MARGIN = 0.5

const distTo = (x: number, z: number, r: R4) => {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1)
  return Math.hypot(dx, dz)
}

interface Grid { x0: number; z0: number; nx: number; nz: number; blocked: Uint8Array }

function inner(i: RoomAccessInput) {
  return { x0: i.room.x + i.half.left + WALL_MARGIN, x1: i.room.x2 - i.half.right - WALL_MARGIN, z0: i.room.y + i.half.top + WALL_MARGIN, z1: i.room.y2 - i.half.bottom - WALL_MARGIN }
}

function buildGrid(i: RoomAccessInput, furnitureMargin: number, withFurniture: boolean): Grid {
  const b = inner(i)
  const nx = Math.max(0, Math.floor((b.x1 - b.x0) / CELL) + 1), nz = Math.max(0, Math.floor((b.z1 - b.z0) / CELL) + 1)
  const blocked = new Uint8Array(nx * nz)
  const mark = (r: R4, m: number) => {
    const i0 = Math.max(0, Math.floor((r.x0 - m - b.x0) / CELL)), i1 = Math.min(nx - 1, Math.ceil((r.x1 + m - b.x0) / CELL))
    const j0 = Math.max(0, Math.floor((r.z0 - m - b.z0) / CELL)), j1 = Math.min(nz - 1, Math.ceil((r.z1 + m - b.z0) / CELL))
    for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
      if (distTo(b.x0 + ii * CELL, b.z0 + jj * CELL, r) < m) blocked[jj * nx + ii] = 1
    }
  }
  for (const l of i.leaves) mark(l, LEAF_MARGIN)
  if (withFurniture) for (const r of i.blocks) mark(r, furnitureMargin)
  return { x0: b.x0, z0: b.z0, nx, nz, blocked }
}

/** the standing spot just inside each doorway (centre of the opening, a step into the room) */
export function anchors(i: RoomAccessInput): Array<{ x: number; z: number }> {
  return i.doors.map((d) => {
    const c = (d.a + d.b) / 2
    const t = i.half[d.wall] + 0.6
    return d.wall === 'top' ? { x: c, z: i.room.y + t } : d.wall === 'bottom' ? { x: c, z: i.room.y2 - t } : d.wall === 'left' ? { x: i.room.x + t, z: c } : { x: i.room.x2 - t, z: c }
  })
}

const cellOf = (g: Grid, x: number, z: number): [number, number] => [Math.round((x - g.x0) / CELL), Math.round((z - g.z0) / CELL)]

/** nearest open cell to (x, z) within `reach` ft, or -1 */
function openNear(g: Grid, x: number, z: number, reach = 0.8): number {
  const [ci, cj] = cellOf(g, x, z)
  const n = Math.ceil(reach / CELL)
  let best = -1, bd = Infinity
  for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
    const ii = ci + di, jj = cj + dj
    if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz || g.blocked[jj * g.nx + ii]) continue
    const d = di * di + dj * dj
    if (d < bd) { bd = d; best = jj * g.nx + ii }
  }
  return best
}

function fill(g: Grid, start: number): Uint8Array {
  const seen = new Uint8Array(g.nx * g.nz)
  if (start < 0) return seen
  const q = [start]; seen[start] = 1
  for (let h = 0; h < q.length; h++) {
    const c = q[h], ci = c % g.nx, cj = (c / g.nx) | 0
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = ci + di, jj = cj + dj
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue
      const k = jj * g.nx + ii
      if (seen[k] || g.blocked[k]) continue
      seen[k] = 1; q.push(k)
    }
  }
  return seen
}

/**
 * Can a person (whose centre keeps `margin` ft from every piece) walk between all the doorways of the room and up to every piece?
 * A room without doors has nothing to check here (the plan itself must give it a door).
 */
export function checkRoomAccess(i: RoomAccessInput, margin = 0.8): AccessResult {
  const g = buildGrid(i, margin, true)
  const issues: AccessIssue[] = []
  const an = anchors(i)
  if (!an.length || g.nx === 0 || g.nz === 0) return { ok: true, issues, cells: g.nx * g.nz, reached: 0 }
  const cells = an.map((a) => openNear(g, a.x, a.z))
  const seeds: number[] = []
  cells.forEach((c, k) => { if (c < 0) issues.push({ kind: 'door-blocked', door: k }); else seeds.push(k) })
  let seen: Uint8Array = new Uint8Array(g.nx * g.nz)
  if (seeds.length) {
    seen = fill(g, cells[seeds[0]])
    for (const k of seeds.slice(1)) if (!seen[cells[k]]) issues.push({ kind: 'doors-split', from: seeds[0], to: k })
    const from = seeds[0]
    // every piece must be reachable: some reached cell within a hand's reach of it
    for (const r of i.blocks) {
      if (Math.min(r.x1 - r.x0, r.z1 - r.z0) < 0.3) continue
      const m = margin + 0.6
      const i0 = Math.max(0, Math.floor((r.x0 - m - g.x0) / CELL)), i1 = Math.min(g.nx - 1, Math.ceil((r.x1 + m - g.x0) / CELL))
      const j0 = Math.max(0, Math.floor((r.z0 - m - g.z0) / CELL)), j1 = Math.min(g.nz - 1, Math.ceil((r.z1 + m - g.z0) / CELL))
      let touched = false
      for (let jj = j0; jj <= j1 && !touched; jj++) for (let ii = i0; ii <= i1 && !touched; ii++) {
        if (seen[jj * g.nx + ii] && distTo(g.x0 + ii * CELL, g.z0 + jj * CELL, r) <= m) touched = true
      }
      if (!touched) issues.push({ kind: 'piece-sealed', rect: r, from })
    }
  }
  let reached = 0
  for (let k = 0; k < seen.length; k++) reached += seen[k]
  return { ok: issues.length === 0, issues, cells: g.nx * g.nz, reached }
}

/**
 * The corridor (as rectangles, half-width `hw`) that joins two points through the room using only its walls and door leaves as obstacles - the way a designer draws
 * the circulation first.  The path prefers long straight runs (turns cost extra) so the free strip is a plain "L" or "Z" and does not slice the room into slivers.
 */
export function routeStrips(i: RoomAccessInput, from: { x: number; z: number }, to: { x: number; z: number }, hw: number): R4[] {
  const g = buildGrid(i, 0, false)
  if (!g.nx || !g.nz) return []
  const s = openNear(g, from.x, from.z, 1.2), t = openNear(g, to.x, to.z, 1.2)
  if (s < 0 || t < 0) return []
  const N = g.nx * g.nz
  const INF = 1e9
  const dist = new Float64Array(N * 5).fill(INF)       // state = cell * 5 + dir (4 = start)
  const prev = new Int32Array(N * 5).fill(-1)
  const heap: Array<[number, number]> = []
  const push = (c: number, s2: number) => { heap.push([c, s2]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p } }
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { let m = k; const l = 2 * k + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m } } return top }
  dist[s * 5 + 4] = 0; push(0, s * 5 + 4)
  const DI = [1, -1, 0, 0], DJ = [0, 0, 1, -1]
  let goal = -1
  while (heap.length) {
    const [d, st] = pop()
    if (d > dist[st]) continue
    const c = (st / 5) | 0, dir = st % 5
    if (c === t) { goal = st; break }
    const ci = c % g.nx, cj = (c / g.nx) | 0
    for (let k = 0; k < 4; k++) {
      const ii = ci + DI[k], jj = cj + DJ[k]
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue
      const nc = jj * g.nx + ii
      if (g.blocked[nc]) continue
      const nd = d + 1 + (dir !== 4 && dir !== k ? 10 : 0)
      const ns = nc * 5 + k
      if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = st; push(nd, ns) }
    }
  }
  if (goal < 0) return []
  const path: Array<[number, number, number]> = []        // cell i, cell j, dir
  for (let st = goal; st >= 0; st = prev[st]) { const c = (st / 5) | 0; path.push([c % g.nx, (c / g.nx) | 0, st % 5]) }
  path.reverse()
  // straight runs -> rectangles
  const out: R4[] = []
  const pt = (p: [number, number, number]) => ({ x: g.x0 + p[0] * CELL, z: g.z0 + p[1] * CELL })
  let runStart = 0
  const flush = (a: number, b: number) => {
    const p = pt(path[a]), q = pt(path[b])
    out.push({ x0: Math.min(p.x, q.x) - hw, x1: Math.max(p.x, q.x) + hw, z0: Math.min(p.z, q.z) - hw, z1: Math.max(p.z, q.z) + hw })
  }
  for (let k = 1; k < path.length; k++) {
    if (path[k][2] !== path[k - 1][2] && path[k - 1][2] !== 4 && k > 1) { flush(runStart, k - 1); runStart = k - 1 }
  }
  flush(runStart, path.length - 1)
  return out
}

/** the standing cell next to a sealed piece that is closest to `toward` (where the corridor should come from) */
export function frontOf(i: RoomAccessInput, rect: R4, toward: { x: number; z: number }, margin = 0.8): { x: number; z: number } | null {
  const g = buildGrid(i, 0, false)
  let best: { x: number; z: number } | null = null, bd = Infinity
  for (let jj = 0; jj < g.nz; jj++) for (let ii = 0; ii < g.nx; ii++) {
    if (g.blocked[jj * g.nx + ii]) continue
    const x = g.x0 + ii * CELL, z = g.z0 + jj * CELL
    const d = distTo(x, z, rect)
    if (d < margin || d > margin + 0.6) continue
    const e = Math.hypot(x - toward.x, z - toward.z)
    if (e < bd) { bd = e; best = { x, z } }
  }
  return best
}
