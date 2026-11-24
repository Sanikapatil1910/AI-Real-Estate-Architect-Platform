/**
 * Walking surface and collision for the VR / desktop walk-through, built from the loaded model's own triangles (so it is exactly the geometry the
 * person sees, whatever the meshes are called: the exported .glb has merged, unnamed meshes).  Units: feet, the model frame (x, up y, z).
 *
 *  - every triangle is sampled onto a 2D grid (cell 0.3 ft) with a vertical bit-set per cell (bins of 0.1 ft);
 *  - upward-facing triangles are "ground" (floors, stair treads, terraces, the plot); other triangles are "solid" (walls, furniture sides, rails);
 *  - a person stands on the highest ground within a step height (0.8 ft) above their feet, can drop at most 1.1 ft, and is blocked by solids that
 *    rise more than a step above the ground and below chest height (3.8 ft: slab edges above a staircase are the person's own head room).  So stairs are climbable, door openings are passable, walls, furniture
 *    and floor edges stop movement, and wall-hugging motion slides.
 * Pure TypeScript (no three.js, no DOM) so it is unit-tested in node on synthetic geometry and in a browser on the real exported house.
 */
export const BIN_FT = 0.1
export const CELL_FT = 0.3
export const STEP_FT = 0.8
export const DROP_FT = 1.1
export const HEAD_FT = 3.8
export const BODY_RADIUS_FT = 0.3   // ≈ 9 cm (head-sized, camera near plane is 5 cm): slim on purpose so the narrow bathroom doors and furniture gaps of generated houses stay passable (0.55 ft left master bathrooms unreachable in most sample houses, 0.4 ft still in 8 of 21)
export const TALL_FT = 6
export const FURNITURE_RADIUS_FT = 0.25

export interface NavBounds { x0: number; z0: number; x1: number; z1: number; y1: number }
export interface Foot { x: number; y: number; z: number }
/** A walkable quad known from the generator (a stair tread or landing): corners (x, z) in feet and an absolute surface height. */
export interface WalkPatchLike { pts: Array<[number, number]>; top: number }

export class NavGrid {
  readonly nx: number
  readonly nz: number
  readonly nBins: number
  private readonly words: number
  private readonly up: Uint32Array
  private readonly solid: Uint32Array
  private readonly down: Uint32Array
  triangles = 0
  samples = 0
  private patches: WalkPatchLike[] = []
  private patchCells = new Map<number, number[]>()
  /** body radius in feet (a 36 cm wide person; doorways in the plans are 2.5-4 ft) */
  bodyRadius = BODY_RADIUS_FT
  furnitureRadius = FURNITURE_RADIUS_FT

  constructor(readonly b: NavBounds, readonly cell = CELL_FT) {
    this.nx = Math.max(1, Math.ceil((b.x1 - b.x0) / cell))
    this.nz = Math.max(1, Math.ceil((b.z1 - b.z0) / cell))
    this.nBins = Math.max(4, Math.ceil(Math.max(b.y1, 1) / BIN_FT) + 2)
    this.words = Math.ceil(this.nBins / 32)
    this.up = new Uint32Array(this.nx * this.nz * this.words)
    this.solid = new Uint32Array(this.nx * this.nz * this.words)
    this.down = new Uint32Array(this.nx * this.nz * this.words)   // undersides: never stop a walker, but they do stop a teleport arc (ceilings, slabs seen from below)
  }

  private cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.b.x0) / this.cell), j = Math.floor((z - this.b.z0) / this.cell)
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i
  }
  private binOf(y: number): number { return Math.max(0, Math.min(this.nBins - 1, Math.floor(y / BIN_FT))) }
  private setBit(arr: Uint32Array, c: number, bin: number): void { arr[c * this.words + (bin >> 5)] |= 1 << (bin & 31) }
  private getBit(arr: Uint32Array, c: number, bin: number): boolean { return bin >= 0 && bin < this.nBins && (arr[c * this.words + (bin >> 5)] & (1 << (bin & 31))) !== 0 }

  /** Adds one triangle (model frame, feet). Triangles outside the grid are skipped and huge ones (the plot, the road) are split so only the part inside is sampled. */
  addTriangle(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, depth = 0): void {
    const { x0, z0, x1, z1, y1 } = this.b
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz)
    if (maxX < x0 || minX > x1 || maxZ < z0 || minZ > z1 || Math.min(ay, by, cy) > y1) return
    const inside = minX >= x0 && maxX <= x1 && minZ >= z0 && maxZ <= z1
    if (!inside && depth < 24) {
      const eab = Math.hypot(bx - ax, by - ay, bz - az), ebc = Math.hypot(cx - bx, cy - by, cz - bz), eca = Math.hypot(ax - cx, ay - cy, az - cz)
      const m = Math.max(eab, ebc, eca)
      if (m > 12) {
        if (m === eab) { const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2; this.addTriangle(ax, ay, az, mx, my, mz, cx, cy, cz, depth + 1); this.addTriangle(mx, my, mz, bx, by, bz, cx, cy, cz, depth + 1) }
        else if (m === ebc) { const mx = (bx + cx) / 2, my = (by + cy) / 2, mz = (bz + cz) / 2; this.addTriangle(ax, ay, az, bx, by, bz, mx, my, mz, depth + 1); this.addTriangle(ax, ay, az, mx, my, mz, cx, cy, cz, depth + 1) }
        else { const mx = (cx + ax) / 2, my = (cy + ay) / 2, mz = (cz + az) / 2; this.addTriangle(ax, ay, az, bx, by, bz, mx, my, mz, depth + 1); this.addTriangle(mx, my, mz, bx, by, bz, cx, cy, cz, depth + 1) }
        return
      }
    }
    this.sample(ax, ay, az, bx, by, bz, cx, cy, cz)
  }

  private sample(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az
    const nxv = uy * vz - uz * vy, nyv = uz * vx - ux * vz, nzv = ux * vy - uy * vx
    const len = Math.hypot(nxv, nyv, nzv)
    if (len < 1e-9) return
    this.triangles++
    const ny = nyv / len
    // undersides (ceilings, soffits, stair undersides) never stop a walker (head room is the person's own business in VR) but are recorded for the teleport arc
    const isUp = ny > 0.6, isDown = ny < -0.6
    const arr = isUp ? this.up : isDown ? this.down : this.solid
    const s = isUp || isDown ? this.cell * 0.5 : Math.min(this.cell * 0.5, BIN_FT * 0.95)   // solids are sampled finely enough that every height bin they span is set
    const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz)
    const nu = Math.max(1, Math.ceil(lu / s)), nv = Math.max(1, Math.ceil(lv / s))
    for (let i = 0; i <= nu; i++) {
      const u = i / nu
      const jmax = Math.floor((1 - u) * nv + 1e-9)
      for (let j = 0; j <= jmax; j++) {
        const v = j / nv
        const x = ax + u * ux + v * vx, y = ay + u * uy + v * vy, z = az + u * uz + v * vz
        const c = this.cellOf(x, z)
        this.samples++
        if (c < 0 || y > this.b.y1) continue
        this.setBit(arr, c, this.binOf(y))
      }
    }
  }

  /**
   * Registers the generator's own stair treads / landings.  A triangle-sampled stair is hard to climb reliably (thin folded treads, risers, rails, stringers all
   * land in the same cells), so where the generator says "this is a tread at height h", the walker stands on it; walls still stop it, rails and risers do not.
   */
  addWalkPatches(list: WalkPatchLike[]): void {
    for (const p of list) {
      const idx = this.patches.length
      this.patches.push(p)
      const xs = p.pts.map((q) => q[0]), zs = p.pts.map((q) => q[1])
      const i0 = Math.floor((Math.min(...xs) - this.b.x0) / this.cell), i1 = Math.floor((Math.max(...xs) - this.b.x0) / this.cell)
      const j0 = Math.floor((Math.min(...zs) - this.b.z0) / this.cell), j1 = Math.floor((Math.max(...zs) - this.b.z0) / this.cell)
      for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
        const c = j * this.nx + i
        const a = this.patchCells.get(c)
        if (a) a.push(idx); else this.patchCells.set(c, [idx])
      }
    }
  }
  get patchCount(): number { return this.patches.length }
  /** the stair walk surfaces (read-only; for diagnostics and tests) */
  get walkPatches(): readonly WalkPatchLike[] { return this.patches }

  /** True when a generator stair surface (within a step or a drop of height g) lies within `margin` feet of (x, z): the stair zone. */
  nearPatch(x: number, z: number, g: number, margin = 0.7): boolean {
    if (!this.patches.length) return false
    for (const [ox, oz] of [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin], [margin, margin], [-margin, margin], [margin, -margin], [-margin, -margin]]) {
      const c = this.cellOf(x + ox, z + oz)
      const ids = c < 0 ? undefined : this.patchCells.get(c)
      if (!ids) continue
      for (const id of ids) {
        const p = this.patches[id]
        if (p.top > g + STEP_FT + 0.01 || p.top < g - DROP_FT) continue
        if (this.inQuad(p.pts, x + ox, z + oz)) return true
      }
    }
    return false
  }

  private inQuad(q: Array<[number, number]>, x: number, z: number): boolean {
    let pos = false, neg = false
    for (let i = 0; i < q.length; i++) {
      const [ax, az] = q[i], [bx, bz] = q[(i + 1) % q.length]
      const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax)
      if (cr > 1e-9) pos = true; else if (cr < -1e-9) neg = true
      if (pos && neg) return false
    }
    return true
  }

  /** Height of the generator's stair surface at (x, z) within reach of fromY (highest such), or null. */
  patchGround(x: number, z: number, fromY: number): number | null {
    if (!this.patches.length) return null
    const c = this.cellOf(x, z)
    const ids = c < 0 ? undefined : this.patchCells.get(c)
    if (!ids) return null
    let best: number | null = null
    for (const id of ids) {
      const p = this.patches[id]
      if (p.top > fromY + STEP_FT + 1e-6 || p.top < fromY - DROP_FT) continue
      if (best !== null && p.top <= best) continue
      if (this.inQuad(p.pts, x, z)) best = p.top
    }
    return best
  }

  /** Height of the walkable surface at (x, z) for a person whose feet are at fromY; null when there is none within step-up / drop reach. */
  groundAt(x: number, z: number, fromY: number): number | null {
    const pg = this.patchGround(x, z, fromY)
    if (pg !== null) return pg
    const c = this.cellOf(x, z)
    if (c < 0) return null
    const hi = this.binOf(fromY + STEP_FT), lo = this.binOf(Math.max(0, fromY - DROP_FT))
    for (let b = hi; b >= lo; b--) {
      if (!this.getBit(this.up, c, b)) continue
      let bottom = b                                  // a thin rug / tile layer sits within a bin of the slab: stand on the slab
      while (bottom - 1 >= 0 && bottom - 1 >= lo - 1 && this.getBit(this.up, c, bottom - 1)) bottom--
      return (bottom + 0.5) * BIN_FT
    }
    return null
  }

  /** True when something solid occupies the body column [groundY + step, groundY + head] at (x, z). */
  solidAt(x: number, z: number, groundY: number): boolean {
    const c = this.cellOf(x, z)
    if (c < 0) return false
    const from = this.binOf(groundY + STEP_FT) + 1, to = this.binOf(groundY + HEAD_FT)     // one bin of slack so a step-high riser never counts as a wall
    for (let b = from; b <= to; b++) if (this.getBit(this.solid, c, b)) return true
    return false
  }

  /** Does anything solid (a wall, furniture side, a ceiling / slab underside) occupy (x, z) between heights ya and yb? Used by the teleport arc. */
  blockedBetween(x: number, z: number, ya: number, yb: number): boolean {
    const c = this.cellOf(x, z)
    if (c < 0) return true
    const lo = this.binOf(Math.min(ya, yb)), hi = this.binOf(Math.max(ya, yb))
    for (let b = lo; b <= hi; b++) if (this.getBit(this.solid, c, b) || this.getBit(this.down, c, b)) return true
    return false
  }

  /** The highest upward-facing surface at (x, z) within [yLo, yHi] (+ a small tolerance), or null. */
  surfaceBetween(x: number, z: number, yHi: number, yLo: number): number | null {
    const c = this.cellOf(x, z)
    if (c < 0) return null
    const hi = this.binOf(yHi + 0.05), lo = this.binOf(yLo - 0.05)
    for (let b = hi; b >= lo; b--) if (this.getBit(this.up, c, b)) return (b + 0.5) * BIN_FT
    return null
  }

  /** every walkable surface height at (x, z) - for diagnostics */
  upHeights(x: number, z: number): number[] {
    const c = this.cellOf(x, z)
    const out: number[] = []
    if (c < 0) return out
    for (let b = 0; b < this.nBins; b++) if (this.getBit(this.up, c, b)) out.push(Math.round((b + 0.5) * BIN_FT * 100) / 100)
    return out
  }

  /** diagnostics: heights of the bins holding solid (side) surface at (x, z) */
  solidHeights(x: number, z: number): number[] {
    const c = this.cellOf(x, z)
    const out: number[] = []
    if (c < 0) return out
    for (let b = 0; b < this.nBins; b++) if (this.getBit(this.solid, c, b)) out.push(Math.round((b + 0.5) * BIN_FT * 100) / 100)
    return out
  }

  /** True when something TALL (wall, door leaf, tall cupboard: solid reaching 6 ft above the ground) stands at (x, z). Low furniture does not count. */
  wallAt(x: number, z: number, groundY: number): boolean {
    const c = this.cellOf(x, z)
    if (c < 0) return false
    // a real wall has material both at knee height and at 6 ft; the walls of the floor ABOVE (seen through a stairwell) have neither at knee height
    return this.getBit(this.solid, c, this.binOf(groundY + TALL_FT)) && this.getBit(this.solid, c, this.binOf(groundY + 1.6))
  }

  /** The body at (x, z) with feet starting at fromY: its new feet height, or null when it cannot stand there. */
  canStand(x: number, z: number, fromY: number): number | null {
    const g = this.groundAt(x, z, fromY)
    if (g === null) return null
    const r = this.bodyRadius
    // In the stair zone (a tread within a step, 0.7 ft around) guard rails, posts, risers and stringers do not block - the generator draws a guard rail across the foot of the
    // flight on some houses, and an open stairwell is already stopped by having no floor (drop) - but walls still do.
    const onStair = this.patchGround(x, z, fromY) !== null || this.nearPatch(x, z, g)
    if (!onStair && this.solidAt(x, z, g)) return null
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4
      const ca = Math.cos(a), sa = Math.sin(a)
      // walls and other tall things keep the full body radius away ...
      let px = x + ca * r, pz = z + sa * r
      let gp = this.groundAt(px, pz, g) ?? g              // a body probe over the next stair tread is judged from that tread, not from the foot
      if (this.wallAt(px, pz, Math.max(g, gp))) return null
      // ... low furniture only a hand's breadth, so a crowded bathroom or bedroom door stays usable
      if (onStair) continue
      px = x + ca * this.furnitureRadius; pz = z + sa * this.furnitureRadius
      gp = this.groundAt(px, pz, g) ?? g
      if (this.solidAt(px, pz, Math.max(g, gp))) return null
    }
    return g
  }

  /** Moves the feet by (dx, dz) in small steps, sliding along obstacles; returns the new foot position. */
  move(p: Foot, dx: number, dz: number): Foot {
    const dist = Math.hypot(dx, dz)
    const n = Math.max(1, Math.ceil(dist / 0.2))
    let { x, y, z } = p
    const sx = dx / n, sz = dz / n
    for (let i = 0; i < n; i++) {
      let g = this.canStand(x + sx, z + sz, y)
      if (g !== null) { x += sx; z += sz; y = g; continue }
      g = sx !== 0 ? this.canStand(x + sx, z, y) : null
      if (g !== null) { x += sx; y = g; continue }
      g = sz !== 0 ? this.canStand(x, z + sz, y) : null
      if (g !== null) { z += sz; y = g }
    }
    return { x, y, z }
  }

  /** How many 0.6 ft steps of floor a body can reach from here (stops counting at `limit`) - tells a free spot from a pocket between furniture. */
  floodCount(x: number, y: number, z: number, limit = 400, step = 0.6): number {
    const seen = new Set<string>()
    const key = (a: number, b: number) => `${Math.round(a / step)},${Math.round(b / step)}`
    const q: Foot[] = [{ x, y, z }]
    seen.add(key(x, z))
    let n = 0
    while (q.length && n < limit) {
      const p = q.pop()!
      n++
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const k = key(p.x + dx, p.z + dz)
        if (seen.has(k)) continue
        seen.add(k)
        const g = this.canStand(p.x + dx, p.z + dz, p.y)
        if (g !== null) q.push({ x: p.x + dx, y: g, z: p.z + dz })
      }
    }
    return n
  }

  /** Like nearestStandable, but the spot must open onto at least `minCells` of reachable floor (not a pocket). */
  nearestOpen(x: number, z: number, y: number, radius = 8, minCells = 150): Foot | null {
    for (let r = 0; r <= radius; r += 0.5) {
      const steps = Math.max(1, Math.round((2 * Math.PI * r) / 0.5))
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
        const g = this.canStand(px, pz, y)
        if (g !== null && this.floodCount(px, g, pz, minCells) >= minCells) return { x: px, y: g, z: pz }
      }
    }
    return null
  }

  /** The nearest standable spot to (x, z) (searching outwards on a small spiral) at about this height; null when none within `radius`. */
  nearestStandable(x: number, z: number, y: number, radius = 8): Foot | null {
    for (let r = 0; r <= radius; r += 0.4) {
      const steps = Math.max(1, Math.round((2 * Math.PI * r) / 0.4))
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
        const g = this.canStand(px, pz, y)
        if (g !== null) return { x: px, y: g, z: pz }
      }
    }
    return null
  }
}
