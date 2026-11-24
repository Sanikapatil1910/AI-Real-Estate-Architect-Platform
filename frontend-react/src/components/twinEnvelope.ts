/**
 * Pure geometry for the building envelope: where the roof edge is exposed (parapet, overhang), how far the roof may project, and where the
 * terrace-access door of the stair headroom (mumty) goes.  No three.js here, so the rules can be checked on their own
 * (tests/test_envelope_geometry.py bundles this file with esbuild and runs it under node).  Units: feet, plan x -> x, plan y -> z.
 */
export interface R4 { x0: number; x1: number; z0: number; z1: number }
/** A straight run of roof edge.  `axis` 'h': the run lies along x at z = c; 'v': along z at x = c.  `out` (+1 / -1): which way along the normal is outdoors. */
export interface Edge { axis: 'h' | 'v'; c: number; a: number; b: number; out: 1 | -1 }
export type Side = 'top' | 'bottom' | 'left' | 'right'

export const ENVELOPE = {
  /** Flat-roof slab projection beyond the wall face when the plan carries no `roof_spec` (ft). Configurable per request (`roof_overhang_ft`). */
  roofOverhangFt: 1.5,
  roofOverhangMaxFt: 3,
  /** A roof edge never comes closer than this to the plot boundary (ft). */
  roofPlotClearFt: 1.0,
  /** Terrace parapet and the stair headroom. */
  parapetFt: 3,
  parapetThickFt: 0.5,
  mumtyWallFt: 7.6,
  mumtyDoorW: 2.75,
  mumtyDoorH: 7,
}

const TOL = 0.06

/** Remove the parts of [a, b] that are covered by `cut` intervals; returns what is left (pieces shorter than 0.1 ft are dropped). */
function subtract(a: number, b: number, cut: Array<[number, number]>): Array<[number, number]> {
  let parts: Array<[number, number]> = [[a, b]]
  for (const [c0, c1] of cut) {
    const next: Array<[number, number]> = []
    for (const [p0, p1] of parts) {
      if (c1 <= p0 + 1e-6 || c0 >= p1 - 1e-6) { next.push([p0, p1]); continue }
      if (c0 > p0) next.push([p0, c0])
      if (c1 < p1) next.push([c1, p1])
    }
    parts = next
  }
  return parts.filter(([p0, p1]) => p1 - p0 > 0.1)
}

/** Union of intervals, sorted and merged (touching ones join). */
export function mergeIv(iv: Array<[number, number]>, gap = 0.01): Array<[number, number]> {
  const s = [...iv].sort((p, q) => p[0] - q[0])
  const out: Array<[number, number]> = []
  for (const x of s) {
    const last = out[out.length - 1]
    if (last && x[0] <= last[1] + gap) last[1] = Math.max(last[1], x[1])
    else out.push([x[0], x[1]])
  }
  return out
}

/**
 * The boundary of a group of rectangles that is not shared with another rectangle of `cover`: the edges of a roof that are exposed to the air.
 * `rects` are the roof slabs; `cover` (default `rects`) are all rectangles that count as "something is there" (e.g. the stair headroom, whose own
 * walls close the edge).  Collinear runs are merged, so a long edge made of several rooms is one run.
 */
export function exposedEdges(rects: R4[], cover: R4[] = rects): Edge[] {
  const raw: Edge[] = []
  const push = (axis: 'h' | 'v', c: number, a: number, b: number, out: 1 | -1) => raw.push({ axis, c, a, b, out })
  for (const r of rects) {
    // each side: neighbours on the other side of the line are rectangles that touch it from outside
    const sides: Array<['h' | 'v', number, number, number, 1 | -1]> = [
      ['h', r.z0, r.x0, r.x1, -1], ['h', r.z1, r.x0, r.x1, 1], ['v', r.x0, r.z0, r.z1, -1], ['v', r.x1, r.z0, r.z1, 1],
    ]
    for (const [axis, c, a, b, out] of sides) {
      const cut: Array<[number, number]> = []
      for (const o of cover) {
        if (o === r) continue
        if (axis === 'h') {
          const edge = out > 0 ? o.z0 : o.z1
          if (Math.abs(edge - c) < TOL && Math.min(o.x1, b) - Math.max(o.x0, a) > 0.01) cut.push([o.x0, o.x1])
        } else {
          const edge = out > 0 ? o.x0 : o.x1
          if (Math.abs(edge - c) < TOL && Math.min(o.z1, b) - Math.max(o.z0, a) > 0.01) cut.push([o.z0, o.z1])
        }
      }
      for (const [p0, p1] of subtract(a, b, cut)) push(axis, c, p0, p1, out)
    }
  }
  // merge collinear runs with the same outward side
  const key = (e: Edge) => `${e.axis}${Math.round(e.c * 10)}${e.out}`
  const groups = new Map<string, Edge[]>()
  for (const e of raw) { const k = key(e); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(e) }
  const out: Edge[] = []
  for (const list of groups.values()) {
    for (const [a, b] of mergeIv(list.map((e) => [e.a, e.b] as [number, number]))) out.push({ axis: list[0].axis, c: list[0].c, a, b, out: list[0].out })
  }
  return out
}

export const sideOf = (e: Edge): Side => (e.axis === 'h' ? (e.out < 0 ? 'top' : 'bottom') : e.out < 0 ? 'left' : 'right')

/** Is the point inside any of the rectangles? */
export const inAny = (rs: R4[], x: number, z: number) => rs.some((r) => x > r.x0 + 0.01 && x < r.x1 - 0.01 && z > r.z0 + 0.01 && z < r.z1 - 0.01)

/** Open ground between the footprint and the plot boundary, per side. */
export function plotMargins(foot: R4, plot: { x: number; y: number; width: number; length: number }): Record<Side, number> {
  return { top: foot.z0 - plot.y, bottom: plot.y + plot.length - foot.z1, left: foot.x0 - plot.x, right: plot.x + plot.width - foot.x1 }
}

const floor025 = (v: number) => Math.floor(v * 4 + 1e-9) / 4

/**
 * How far the flat roof may project on each side: the requested overhang, never within `roofPlotClearFt` of the plot boundary.  A plan that
 * carries `roof_spec.by_side` (decided by the backend) is used as given; otherwise the same rule is applied here.
 */
export function roofOverhangBySide(foot: R4, plot: { x: number; y: number; width: number; length: number }, spec?: { overhang_ft?: number; by_side?: Partial<Record<Side, number>> } | null): Record<Side, number> {
  const want = Math.max(0, Math.min(ENVELOPE.roofOverhangMaxFt, spec?.overhang_ft ?? ENVELOPE.roofOverhangFt))
  const m = plotMargins(foot, plot)
  const calc = (s: Side) => Math.max(0, Math.min(want, floor025(m[s] - ENVELOPE.roofPlotClearFt)))
  const out = { top: calc('top'), bottom: calc('bottom'), left: calc('left'), right: calc('right') }
  if (spec?.by_side) for (const s of Object.keys(out) as Side[]) { const v = spec.by_side[s]; if (typeof v === 'number') out[s] = Math.max(0, Math.min(out[s], v)) }
  return out
}

export interface SlabPatch { x0: number; x1: number; z0: number; z1: number }

/**
 * The overhang of a flat roof as rectangles outside the walls: one strip along every exposed outer edge, plus the corner squares where two strips
 * meet at a convex corner.  Edges that face another part of the same floor (a balcony, an open terrace) get no overhang.
 * `outer(x, z)` says whether a point just beyond an edge is outdoors (not over another room of the floor).
 */
export function overhangPatches(edges: Edge[], by: Record<Side, number>, outer: (x: number, z: number) => boolean): SlabPatch[] {
  const patches: SlabPatch[] = []
  const strips: Array<{ e: Edge; w: number }> = []
  for (const e of edges) {
    const w = by[sideOf(e)]
    if (w < 0.25) continue
    const mid = (e.a + e.b) / 2
    const px = e.axis === 'h' ? mid : e.c + e.out * 0.3
    const pz = e.axis === 'h' ? e.c + e.out * 0.3 : mid
    if (!outer(px, pz)) continue
    strips.push({ e, w })
  }
  for (const { e, w } of strips) {
    patches.push(e.axis === 'h'
      ? { x0: e.a, x1: e.b, z0: e.out > 0 ? e.c : e.c - w, z1: e.out > 0 ? e.c + w : e.c }
      : { x0: e.out > 0 ? e.c : e.c - w, x1: e.out > 0 ? e.c + w : e.c, z0: e.a, z1: e.b })
  }
  // convex corners: a horizontal strip and a vertical strip that end at the same point, both facing away from each other's line
  for (const h of strips.filter((s) => s.e.axis === 'h')) {
    for (const v of strips.filter((s) => s.e.axis === 'v')) {
      for (const hx of [h.e.a, h.e.b]) {
        if (Math.abs(hx - v.e.c) > TOL) continue
        for (const vz of [v.e.a, v.e.b]) {
          if (Math.abs(vz - h.e.c) > TOL) continue
          // the corner is convex when the strips lie on the outer side of each other: horizontal edge ends at hx going away from the vertical
          // edge's interior, i.e. the horizontal run extends toward -out of v (or +) ... equivalently the building lies on the opposite side
          const hInside = hx === h.e.a ? 1 : -1          // direction from the corner into the horizontal run
          if (hInside !== -v.e.out) continue
          const vInside = vz === v.e.a ? 1 : -1
          if (vInside !== -h.e.out) continue
          const x0 = v.e.out > 0 ? v.e.c : v.e.c - v.w, x1 = v.e.out > 0 ? v.e.c + v.w : v.e.c
          const z0 = h.e.out > 0 ? h.e.c : h.e.c - h.w, z1 = h.e.out > 0 ? h.e.c + h.w : h.e.c
          patches.push({ x0, x1, z0, z1 })
        }
      }
    }
  }
  return disjoint(patches)
}

/** Make the patches pairwise disjoint (a notch where two strips meet inside the L would otherwise be covered twice: z-fighting, double slab). */
export function disjoint(patches: SlabPatch[]): SlabPatch[] {
  const out: SlabPatch[] = []
  for (const p of patches) {
    let parts: SlabPatch[] = [p]
    for (const q of out) {
      const next: SlabPatch[] = []
      for (const r of parts) {
        if (r.x1 <= q.x0 + 1e-6 || q.x1 <= r.x0 + 1e-6 || r.z1 <= q.z0 + 1e-6 || q.z1 <= r.z0 + 1e-6) { next.push(r); continue }
        if (r.z0 < q.z0 - 1e-6) next.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: q.z0 })
        if (r.z1 > q.z1 + 1e-6) next.push({ x0: r.x0, x1: r.x1, z0: q.z1, z1: r.z1 })
        const z0 = Math.max(r.z0, q.z0), z1 = Math.min(r.z1, q.z1)
        if (r.x0 < q.x0 - 1e-6) next.push({ x0: r.x0, x1: q.x0, z0, z1 })
        if (r.x1 > q.x1 + 1e-6) next.push({ x0: q.x1, x1: r.x1, z0, z1 })
      }
      parts = next
    }
    out.push(...parts.filter((r) => r.x1 - r.x0 > 0.02 && r.z1 - r.z0 > 0.02))
  }
  return out
}

/** A run of fascia (the drip edge of the roof slab): lies on the far line of an overhang strip, only where the slab really ends. */
export interface FasciaRun { axis: 'h' | 'v'; c: number; a: number; b: number; out: 1 | -1 }

export function fasciaRuns(edges: Edge[], by: Record<Side, number>, patches: SlabPatch[], outer: (x: number, z: number) => boolean): FasciaRun[] {
  const runs: FasciaRun[] = []
  const inside = (x: number, z: number) => patches.some((q) => x > q.x0 + 1e-3 && x < q.x1 - 1e-3 && z > q.z0 + 1e-3 && z < q.z1 - 1e-3)
  for (const e of edges) {
    const w = by[sideOf(e)]
    if (w < 0.25) continue
    const mid = (e.a + e.b) / 2
    if (!(e.axis === 'h' ? outer(mid, e.c + e.out * 0.3) : outer(e.c + e.out * 0.3, mid))) continue
    const far = e.c + e.out * w
    // a convex corner continues the fascia round the corner patch; a notch does not
    const at = (u: number, d: number) => (e.axis === 'h' ? inside(u, e.c + e.out * d) : inside(e.c + e.out * d, u))
    const a0 = at(e.a - w / 2, w / 2) ? e.a - w : e.a
    const b0 = at(e.b + w / 2, w / 2) ? e.b + w : e.b
    const cuts: Array<[number, number]> = []
    for (const q of patches) {
      if (e.axis === 'h' ? far > q.z0 + 1e-3 && far < q.z1 - 1e-3 : far > q.x0 + 1e-3 && far < q.x1 - 1e-3) cuts.push(e.axis === 'h' ? [q.x0, q.x1] : [q.z0, q.z1])
    }
    for (const [u0, u1] of subtract(a0, b0, cuts)) runs.push({ axis: e.axis, c: far, a: u0, b: u1, out: e.out })
  }
  return runs
}

export interface MumtyDoor { axis: 'h' | 'v'; c: number; a: number; b: number; out: 1 | -1 }

/**
 * Where the stair headroom (mumty) opens onto the roof terrace.  The door goes in a wall of the stair room that (1) borders the walkable roof
 * and (2) is next to the landing where the stair arrives, so a person steps off the last tread, through the door, onto the terrace.
 * Walls on the outer edge of the building (nothing to walk on beyond them) are never used.  Returns null when no wall qualifies.
 */
export function mumtyDoor(stair: R4, lobby: R4, walkable: R4[], width = ENVELOPE.mumtyDoorW): MumtyDoor | null {
  type Cand = MumtyDoor & { score: number }
  const cands: Cand[] = []
  const sides: Array<['h' | 'v', number, number, number, 1 | -1, number, number]> = [
    ['h', stair.z0, stair.x0, stair.x1, -1, lobby.x0, lobby.x1], ['h', stair.z1, stair.x0, stair.x1, 1, lobby.x0, lobby.x1],
    ['v', stair.x0, stair.z0, stair.z1, -1, lobby.z0, lobby.z1], ['v', stair.x1, stair.z0, stair.z1, 1, lobby.z0, lobby.z1],
  ]
  for (const [axis, c, a, b, out, la, lb] of sides) {
    // the lobby has to touch this wall (or be within a foot of it)
    const touches = axis === 'h' ? (out < 0 ? lobby.z0 - c < 0.6 : c - lobby.z1 < 0.6) : (out < 0 ? lobby.x0 - c < 0.6 : c - lobby.x1 < 0.6)
    // the wall segment next to the lobby (when the lobby only touches the end wall, the wall segment is the whole end)
    const lo = Math.max(a, touches ? la : a), hi = Math.min(b, touches ? lb : b)
    // walkable roof on the outer side
    const walk: Array<[number, number]> = []
    for (const w of walkable) {
      if (axis === 'h') { const e = out > 0 ? w.z0 : w.z1; if (Math.abs(e - c) < TOL) walk.push([Math.max(w.x0, lo), Math.min(w.x1, hi)]) }
      else { const e = out > 0 ? w.x0 : w.x1; if (Math.abs(e - c) < TOL) walk.push([Math.max(w.z0, lo), Math.min(w.z1, hi)]) }
    }
    for (const [p0, p1] of mergeIv(walk.filter(([x, y]) => y - x > 0.05))) {
      if (p1 - p0 < width + 0.4) continue                 // 0.2 ft of wall each side at least
      const mid = Math.min(Math.max((lo + hi) / 2, p0 + width / 2 + 0.2), p1 - width / 2 - 0.2)
      const near = touches ? 2 : 0
      const endWall = (axis === 'h') === (stair.x1 - stair.x0 < stair.z1 - stair.z0)   // a wall across the short side of the room
      cands.push({ axis, c, a: mid - width / 2, b: mid + width / 2, out, score: near * 10 + (endWall ? 3 : 0) + Math.min(p1 - p0, 12) / 12 })
    }
  }
  cands.sort((p, q) => q.score - p.score)
  const best = cands[0]
  return best ? { axis: best.axis, c: best.c, a: best.a, b: best.b, out: best.out } : null
}

/** Axis-aligned boxes overlap (strictly, with a small tolerance)? */
export const boxesOverlap = (a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }, eps = 0.02) =>
  [0, 1, 2].every((i) => a.min[i] < b.max[i] - eps && b.min[i] < a.max[i] - eps)

export interface ParapetBox extends R4 { edge: Edge; outer: boolean }

/**
 * Parapet boxes (plan rectangles) along the exposed roof edges.  An edge on the outside of the building gets a parapet flush with the outer wall
 * face (wall 230 mm, parapet 150 mm); an edge facing an open balcony / terrace of the same floor sits on that thinner wall.  Runs are extended
 * past convex corners only, so two parapets close the corner and nothing sticks out at an inside corner.
 */
export function parapetBoxes(edges: Edge[], isOuter: (e: Edge) => boolean): ParapetBox[] {
  const out: ParapetBox[] = []
  for (const e of edges) {
    const outer = isOuter(e)
    const fo = outer ? 0.378 : 0.2          // outer face of the wall below, measured from the wall line
    const th = outer ? ENVELOPE.parapetThickFt : 0.4
    let a = e.a, b = e.b
    // convex corner at the start / end of the run? (a perpendicular exposed edge on the same outer side)
    const hasCorner = (at: number, towards: 1 | -1) => edges.some((o) => o.axis !== e.axis && Math.abs(o.c - at) < TOL && o.out === towards
      && (e.axis === 'h' ? Math.abs(e.c - o.a) < TOL || Math.abs(e.c - o.b) < TOL : Math.abs(e.c - o.a) < TOL || Math.abs(e.c - o.b) < TOL))
    if (hasCorner(e.a, -1)) a -= fo
    if (hasCorner(e.b, 1)) b += fo
    const f0 = e.c + e.out * fo, f1 = f0 - e.out * th
    const lo = Math.min(f0, f1), hi = Math.max(f0, f1)
    out.push(e.axis === 'h' ? { x0: a, x1: b, z0: lo, z1: hi, edge: e, outer } : { x0: lo, x1: hi, z0: a, z1: b, edge: e, outer })
  }
  return out
}
