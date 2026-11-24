/**
 * Shared stair geometry for the 2D plan and the 3D twin (feet).
 *
 * Rules (from the brief): floor-to-floor height at least 2.7 m, riser at most 150 mm, tread 300 mm,
 * 1 m clear landing at the foot and head of the stair, stair width 1 m or more (3.5 ft default).
 *
 * Shapes (all built from the same rules, so the plan and the 3D model always agree):
 *   u         dog-leg: flight 1 climbs along lane A, a half landing joins the lanes, flight 2 returns along lane B
 *   straight  one flight
 *   l         quarter turn: a flight, a corner landing, a second flight at right angles
 *   double_l  two quarter turns around a well (three flights): the "wrap-around" stair
 *   spiral    treads wound round a centre column
 * Local frame: u runs along the travel axis from the entry end (0) to the far end (L), v across the room (0..W).
 */
export const MM = 304.8 // mm per foot

export type StairShape = 'u' | 'straight' | 'l' | 'double_l' | 'spiral'
export const STAIR_SHAPES: Array<[StairShape, string]> = [
  ['u', 'U-shape (dog-leg)'],
  ['straight', 'Straight'],
  ['l', 'L-shape (quarter turn)'],
  ['double_l', 'Double L (wrap-around)'],
  ['spiral', 'Spiral'],
]
export const ALTERNATING: ReadonlySet<StairShape> = new Set<StairShape>(['straight', 'l'])

export interface RoomR { id?: string; room_type: string; x: number; y: number; x2: number; y2: number; stair?: StairDrawn | null }

/** Optional stair drawing hints (shape, axis, landing) carried on a room. */
export interface StairDrawn {
  shape?: string
  axis?: 'x' | 'y'
  mirror?: boolean
  entry_high?: boolean
  lobby_ft?: number
  width_ft?: number
  weights?: number[]
}

export interface StairInfo {
  riser_count?: number
  tread_depth_mm?: number
  stair_width_feet?: number
  entry_landing_feet?: number | null
  flights?: Array<{ riser_count: number }>
  floor_height?: number
  shape?: string
  axis?: 'x' | 'y'
  mirror?: boolean
  entry_high?: boolean
  flight_weights?: number[] | null
}

export interface StairSpec {
  r1: number // risers in flight 1
  r2: number // risers in flight 2
  n: number // total risers
  riser: number // riser height, ft
  tread: number // tread depth, ft
  S: number // clear landing at the foot / head, ft
  widthFt: number // clear width of one flight
  storeyH: number
  shape: StairShape
  axis?: 'x' | 'y'
  mirror: boolean
  weights?: number[]
}

export function normShape(s: unknown): StairShape {
  const t = String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (t === 'straight' || t === 'single') return 'straight'
  if (t === 'l' || t === 'lshape' || t === 'quarter') return 'l'
  if (t === 'doublel' || t === 'dl' || t === 'wrap' || t === 'wraparound' || t === 'threeflight') return 'double_l'
  if (t === 'spiral' || t === 'circular' || t === 'helical') return 'spiral'
  return 'u'
}

export function stairSpec(info: StairInfo | undefined | null, storeyH: number): StairSpec {
  const tread = (info?.tread_depth_mm ?? 300) / MM
  const S = info?.entry_landing_feet ?? 1000 / MM
  let n = info?.riser_count ?? Math.max(2, Math.ceil((storeyH * MM) / 150 - 1e-9))
  let r1 = info?.flights?.[0]?.riser_count ?? Math.floor(n / 2)
  let r2 = info?.flights?.[1]?.riser_count ?? n - r1
  if (r1 + r2 !== n) { n = r1 + r2 }
  return {
    r1, r2, n, riser: storeyH / n, tread, S, widthFt: info?.stair_width_feet ?? 3.5, storeyH,
    shape: normShape(info?.shape), axis: info?.axis, mirror: !!info?.mirror,
    weights: info?.flight_weights ?? undefined,
  }
}

export interface Tread {
  flight: number; j: number; u0: number; u1: number; v0: number; v1: number; top: number
  /** spiral: a wedge drawn as a rotated rectangle (centre, radial angle, radial length, tangential width) */
  rot?: { cu: number; cv: number; ang: number; len: number; wid: number }
}
export interface Rect { u0: number; u1: number; v0: number; v1: number }
export interface Landing extends Rect { top: number }
export type RailPt = [number, number, number] // u, v, height above this floor's level
export interface Rail { pts: RailPt[]; posts: boolean }

export interface StairLocal {
  L: number
  W: number
  lane: number
  gap: number
  laneA: [number, number]
  laneB: [number, number]
  S: number
  uF: number // near edge of the half landing (u shape)
  landing: Landing // main landing (first of `landings`)
  landings: Landing[]
  treads: Tread[]
  nFlights: number
  head: Rect // floor area where the stair arrives on the next level (carried by that level's slab)
  foot: Rect // clear landing where the stair is entered
  well: Rect | null // open void between the flights
  arrow: Array<[number, number]> // walking line, foot -> head
  rails: Rail[]
  guard: Array<{ a: [number, number]; b: [number, number] }> // upstairs: open drop beside the arrival landing
  column?: { u: number; v: number; r: number }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** split n risers over `k` flights by weights (each flight at least 3 risers when possible) */
function splitRisers(n: number, k: number, w?: number[]): number[] {
  const ws = (w && w.length >= k ? w.slice(0, k) : Array(k).fill(1)).map((x) => Math.max(0.5, x))
  const sum = ws.reduce((a, b) => a + b, 0)
  const out = ws.map((x) => Math.max(3, Math.round((n * x) / sum)))
  let diff = n - out.reduce((a, b) => a + b, 0)
  // put the difference on the middle (or only) flight first, then the others
  const order = k === 3 ? [1, 0, 2] : k === 2 ? [1, 0] : [0]
  let guard = 0
  while (diff !== 0 && guard++ < 200) {
    for (const i of order) {
      if (diff === 0) break
      if (diff > 0) { out[i] += 1; diff -= 1 } else if (out[i] > 2) { out[i] -= 1; diff += 1 }
    }
  }
  return out
}

function mirrorV(G: StairLocal): StairLocal {
  const W = G.W
  const mr = (r: Rect): Rect => ({ u0: r.u0, u1: r.u1, v0: W - r.v1, v1: W - r.v0 })
  return {
    ...G,
    laneA: [W - G.laneA[1], W - G.laneA[0]],
    laneB: [W - G.laneB[1], W - G.laneB[0]],
    landing: { ...G.landing, ...mr(G.landing) },
    landings: G.landings.map((l) => ({ ...l, ...mr(l) })),
    treads: G.treads.map((t) => ({
      ...t, ...mr(t),
      rot: t.rot ? { ...t.rot, cv: W - t.rot.cv, ang: -t.rot.ang } : undefined,
    })),
    head: mr(G.head), foot: mr(G.foot), well: G.well ? mr(G.well) : null,
    arrow: G.arrow.map(([u, v]) => [u, W - v] as [number, number]),
    rails: G.rails.map((r) => ({ ...r, pts: r.pts.map(([u, v, h]) => [u, W - v, h] as RailPt) })),
    guard: G.guard.map((q) => ({ a: [q.a[0], W - q.a[1]] as [number, number], b: [q.b[0], W - q.b[1]] as [number, number] })),
    column: G.column ? { ...G.column, v: W - G.column.v } : undefined,
  }
}

export function stairLocal(spec: StairSpec, L: number, W: number): StairLocal {
  let G: StairLocal
  switch (spec.shape) {
    case 'straight': G = straightLocal(spec, L, W); break
    case 'l': G = lLocal(spec, L, W); break
    case 'double_l': G = doubleLLocal(spec, L, W); break
    case 'spiral': G = spiralLocal(spec, L, W); break
    default: G = uLocal(spec, L, W)
  }
  return spec.mirror ? mirrorV(G) : G
}

/* ------------------------------------------------------------------ U (dog-leg) */
function uLocal(spec: StairSpec, L: number, W: number): StairLocal {
  const gap = 0.2
  const lane = Math.max(2.2, (W - gap) / 2)
  const t1 = Math.max(1, spec.r1 - 1)
  const t2 = Math.max(1, spec.r2 - 1)
  // a stair room smaller than the rules need (e.g. one read from a drawing) gets shallower treads
  const landD = Math.max(2.5, Math.min(lane, 3.5))
  let S = spec.S
  let T = spec.tread
  if (S + t2 * T + landD > L + 1e-6) {
    S = Math.min(S, 2)
    T = Math.max(0.45, (L - S - landD) / t2)
  }
  const uF = S + t2 * T
  const laneA: [number, number] = [0, lane]
  const laneB: [number, number] = [W - lane, W]
  const treads: Tread[] = []
  for (let j = 1; j <= t1; j++) {
    treads.push({ flight: 1, j, u0: S + (j - 1) * T, u1: S + j * T, v0: laneA[0], v1: laneA[1], top: j * spec.riser })
  }
  for (let j = 1; j <= t2; j++) {
    treads.push({ flight: 2, j, u0: uF - j * T, u1: uF - (j - 1) * T, v0: laneB[0], v1: laneB[1], top: (spec.r1 + j) * spec.riser })
  }
  const landing: Landing = { u0: S + t1 * T, u1: Math.max(uF + landD, L), v0: 0, v1: W, top: spec.r1 * spec.riser }
  const HR = 3.0
  const f1 = treads.filter((t) => t.flight === 1).map((t) => [(t.u0 + t.u1) / 2, laneA[1], t.top] as RailPt)
  const f2 = treads.filter((t) => t.flight === 2).map((t) => [(t.u0 + t.u1) / 2, laneB[0], t.top] as RailPt)
  void HR
  return {
    L, W, lane, gap, laneA, laneB, S, uF, landing, landings: [landing], treads, nFlights: 2,
    head: { u0: 0, u1: S, v0: 0, v1: W }, foot: { u0: 0, u1: S, v0: 0, v1: W },
    well: { u0: S, u1: landing.u0, v0: laneA[1], v1: laneB[0] },
    arrow: [[S * 0.45, lane / 2], [(landing.u0 + landing.u1) / 2, lane / 2], [(landing.u0 + landing.u1) / 2, W - lane / 2], [S * 0.45 + 0.8, W - lane / 2]],
    rails: [
      { pts: f1, posts: true }, { pts: f2, posts: true },
      // The half landing's only open edge is the one that faces the well (between the two flights). The walking path crosses the
      // landing from lane A to lane B, so no rail may run along the landing in the travel direction (that used to wall the flights off).
      { pts: [[landing.u0, laneA[1], landing.top], [landing.u0, laneB[0], landing.top]], posts: true },
    ],
    // upstairs the whole stair room except the arrival landing is open: guard its edge from lane A across the well up to flight 2
    guard: [{ a: [S, 0.1], b: [S, laneB[0]] }],
  }
}

/* ------------------------------------------------------------------ straight */
function straightLocal(spec: StairSpec, L: number, W: number): StairLocal {
  const lane = Math.min(W, Math.max(spec.widthFt, 2.5))
  const t = Math.max(1, spec.n - 1)
  let S = spec.S
  if (L - 2 * S < t * 0.45) S = Math.min(S, 1.5)
  const T = clamp((L - 2 * S) / t, 0.45, 1.5)
  const treads: Tread[] = []
  for (let j = 1; j <= t; j++) {
    treads.push({ flight: 1, j, u0: S + (j - 1) * T, u1: S + j * T, v0: 0, v1: lane, top: j * spec.riser })
  }
  const uEnd = S + t * T
  const rails: Rail[] = []
  if (lane < W - 0.3) rails.push({ pts: treads.map((q) => [(q.u0 + q.u1) / 2, lane, q.top] as RailPt), posts: true })
  return {
    L, W, lane, gap: 0, laneA: [0, lane], laneB: [0, lane], S, uF: S,
    landing: { u0: uEnd, u1: L, v0: 0, v1: lane, top: spec.n * spec.riser }, landings: [],
    treads, nFlights: 1,
    head: { u0: uEnd, u1: L, v0: 0, v1: lane }, foot: { u0: 0, u1: S, v0: 0, v1: W },
    well: null,
    arrow: [[S * 0.45, lane / 2], [uEnd - 0.4, lane / 2]],
    rails,
    guard: [],
  }
}

/* ------------------------------------------------------------------ L (quarter turn) */
function lLocal(spec: StairSpec, L: number, W: number): StairLocal {
  const lane = clamp(Math.max(spec.widthFt, 2.5), 2.5, Math.max(2.5, Math.min(L, W) / 2))
  const [r1, r2] = splitRisers(spec.n, 2, spec.weights)
  const t1 = Math.max(1, r1 - 1)
  const t2 = Math.max(1, r2 - 1)
  let S = spec.S
  if (L - lane - S < t1 * 0.45) S = Math.min(S, 1.5)
  const T1 = clamp((L - lane - S) / t1, 0.45, 1.5)
  const T2 = clamp((W - 2 * lane) / t2, 0.45, 1.5)
  const treads: Tread[] = []
  for (let j = 1; j <= t1; j++) treads.push({ flight: 1, j, u0: S + (j - 1) * T1, u1: S + j * T1, v0: 0, v1: lane, top: j * spec.riser })
  const uL = S + t1 * T1
  const landing: Landing = { u0: uL, u1: L, v0: 0, v1: lane, top: r1 * spec.riser }
  for (let j = 1; j <= t2; j++) {
    treads.push({ flight: 2, j, u0: L - lane, u1: L, v0: lane + (j - 1) * T2, v1: Math.min(W, lane + j * T2), top: (r1 + j) * spec.riser })
  }
  const vEnd = Math.min(W, lane + t2 * T2)
  const f1 = treads.filter((t) => t.flight === 1).map((t) => [(t.u0 + t.u1) / 2, lane, t.top] as RailPt)
  const f2 = treads.filter((t) => t.flight === 2).map((t) => [L - lane, (t.v0 + t.v1) / 2, t.top] as RailPt)
  return {
    L, W, lane, gap: 0, laneA: [0, lane], laneB: [0, lane], S, uF: S, landing, landings: [landing], treads, nFlights: 2,
    head: { u0: L - lane, u1: L, v0: vEnd, v1: W }, foot: { u0: 0, u1: S, v0: 0, v1: lane },
    well: { u0: S, u1: L - lane, v0: lane, v1: W },
    arrow: [[S * 0.45, lane / 2], [L - lane / 2, lane / 2], [L - lane / 2, Math.max(vEnd - 0.4, lane)]],
    rails: [{ pts: [...f1, [L - lane, lane, landing.top] as RailPt, ...f2], posts: true }],
    guard: vEnd < W - 0.3 ? [{ a: [L - lane, vEnd], b: [L - lane, W - 0.1] }] : [],
  }
}

/* ------------------------------------------------------------------ double L (three flights round a well) */
function doubleLLocal(spec: StairSpec, L: number, W: number): StairLocal {
  const lane = clamp(Math.max(spec.widthFt, 2.5), 2.5, Math.max(2.5, Math.min(L, W / 2 - 0.4)))
  const [r1, r2, r3] = splitRisers(spec.n, 3, spec.weights)
  const t1 = Math.max(1, r1 - 1)
  const t2 = Math.max(1, r2 - 1)
  const t3 = Math.max(1, r3 - 1)
  let S = spec.S
  if (L - lane - S < Math.max(t1, t3) * 0.45) S = Math.min(S, 1.0)
  const T1 = clamp((L - lane - S) / t1, 0.45, 1.5)
  const T3 = clamp((L - lane - S) / t3, 0.45, 1.5)
  const T2 = clamp((W - 2 * lane) / t2, 0.45, 1.5)
  const treads: Tread[] = []
  for (let j = 1; j <= t1; j++) treads.push({ flight: 1, j, u0: S + (j - 1) * T1, u1: S + j * T1, v0: 0, v1: lane, top: j * spec.riser })
  const landing1: Landing = { u0: S + t1 * T1, u1: L, v0: 0, v1: lane, top: r1 * spec.riser }
  for (let j = 1; j <= t2; j++) {
    treads.push({ flight: 2, j, u0: L - lane, u1: L, v0: lane + (j - 1) * T2, v1: Math.min(W - lane, lane + j * T2), top: (r1 + j) * spec.riser })
  }
  const vE2 = Math.min(W - lane, lane + t2 * T2)
  const landing2: Landing = { u0: L - lane, u1: L, v0: vE2, v1: W, top: (r1 + r2) * spec.riser }
  for (let j = 1; j <= t3; j++) {
    treads.push({ flight: 3, j, u0: L - lane - j * T3, u1: L - lane - (j - 1) * T3, v0: W - lane, v1: W, top: (r1 + r2 + j) * spec.riser })
  }
  const f1 = treads.filter((t) => t.flight === 1).map((t) => [(t.u0 + t.u1) / 2, lane, t.top] as RailPt)
  const f2 = treads.filter((t) => t.flight === 2).map((t) => [L - lane, (t.v0 + t.v1) / 2, t.top] as RailPt)
  const f3 = treads.filter((t) => t.flight === 3).map((t) => [(t.u0 + t.u1) / 2, W - lane, t.top] as RailPt)
  return {
    L, W, lane, gap: 0, laneA: [0, lane], laneB: [W - lane, W], S, uF: S, landing: landing1, landings: [landing1, landing2],
    treads, nFlights: 3,
    head: { u0: 0, u1: S, v0: 0, v1: W }, foot: { u0: 0, u1: S, v0: 0, v1: W },
    well: { u0: S, u1: L - lane, v0: lane, v1: W - lane },
    arrow: [[S * 0.45, lane / 2], [L - lane / 2, lane / 2], [L - lane / 2, W - lane / 2], [S * 0.45 + 0.8, W - lane / 2]],
    rails: [{ pts: [...f1, [L - lane, lane, landing1.top] as RailPt, ...f2, [L - lane, W - lane, landing2.top] as RailPt, ...f3], posts: true }],
    guard: [{ a: [S, 0.1], b: [S, W - lane] }],
  }
}

/* ------------------------------------------------------------------ spiral */
function spiralLocal(spec: StairSpec, L: number, W: number): StairLocal {
  const S = Math.min(spec.S, Math.max(1.5, L - 5))
  const R = clamp(Math.min(W / 2, (L - S) / 2), 2.0, 6.0)
  const rc = 0.4
  const cu = S + R
  const cv = W / 2
  const t = Math.max(3, spec.n - 1)
  const da = (2 * Math.PI * 0.94) / t
  const rm = (R + rc) / 2
  const treads: Tread[] = []
  const rail: RailPt[] = []
  for (let j = 1; j <= t; j++) {
    const ang = Math.PI + (j - 0.5) * da // first tread sits next to the entry lobby
    const wid = rm * da * 1.04
    const len = R - rc
    const cx = cu + rm * Math.cos(ang)
    const cy = cv + rm * Math.sin(ang)
    const top = j * spec.riser
    const ex = Math.abs(Math.cos(ang)) * len / 2 + Math.abs(Math.sin(ang)) * wid / 2
    const ey = Math.abs(Math.sin(ang)) * len / 2 + Math.abs(Math.cos(ang)) * wid / 2
    treads.push({ flight: 1, j, u0: cx - ex, u1: cx + ex, v0: cy - ey, v1: cy + ey, top, rot: { cu: cx, cv: cy, ang, len, wid } })
    rail.push([cu + (R - 0.05) * Math.cos(ang), cv + (R - 0.05) * Math.sin(ang), top])
  }
  return {
    L, W, lane: R, gap: 0, laneA: [0, W], laneB: [0, W], S, uF: S,
    landing: { u0: 0, u1: 0, v0: 0, v1: 0, top: 0 }, landings: [], treads, nFlights: 1,
    head: { u0: 0, u1: S, v0: 0, v1: W }, foot: { u0: 0, u1: S, v0: 0, v1: W },
    well: null,
    arrow: Array.from({ length: 13 }, (_, i) => {
      const a = Math.PI + (i / 12) * (2 * Math.PI * 0.9)
      return [cu + rm * Math.cos(a), cv + rm * Math.sin(a)] as [number, number]
    }),
    rails: [{ pts: rail, posts: true }],
    guard: [],
    column: { u: cu, v: cv, r: rc },
  }
}

/** local (u0,u1,v0,v1) -> plan/world rectangle; the entry end is the high-coordinate short end when `entryHigh`. */
export function toPlanRect(r: RoomR, entryHigh: boolean, axis?: 'x' | 'y') {
  const w = r.x2 - r.x
  const h = r.y2 - r.y
  const horiz = axis ? axis === 'x' : w >= h
  const L = horiz ? w : h
  const W = horiz ? h : w
  return {
    horiz, L, W,
    map: (u0: number, u1: number, v0: number, v1: number) => {
      const a = entryHigh ? L - u1 : u0
      const b = entryHigh ? L - u0 : u1
      return horiz
        ? { x0: r.x + a, x1: r.x + b, y0: r.y + v0, y1: r.y + v1 }
        : { x0: r.x + v0, x1: r.x + v1, y0: r.y + a, y1: r.y + b }
    },
    /** a local point -> plan point */
    pt: (u: number, v: number) => {
      const a = entryHigh ? L - u : u
      return horiz ? { x: r.x + a, y: r.y + v } : { x: r.x + v, y: r.y + a }
    },
  }
}

/** What the stair does on floor `fi`: straight and L stairs alternate direction (the next flight starts at the far
 *  end of the one below), every other shape is the same on every floor. */
export function stairVariant(spec: StairSpec, entryHigh: boolean, fi: number): { spec: StairSpec; entryHigh: boolean } {
  if (ALTERNATING.has(spec.shape) && fi % 2 === 1) return { spec: { ...spec, mirror: !spec.mirror }, entryHigh: !entryHigh }
  return { spec, entryHigh }
}
