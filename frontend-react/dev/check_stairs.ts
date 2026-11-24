/**
 * Geometry audit of every stair shape (run by tests/test_stair_geometry.py after bundling with esbuild; prints JSON).
 * Local frame: u along the travel axis, v across the room (feet).
 */
import { stairLocal, stairSpec } from '../src/components/stairSpec'
import type { StairShape, StairLocal } from '../src/components/stairSpec'

type P = [number, number]
const segs = (pts: P[]): Array<[P, P]> => pts.slice(0, -1).map((p, i) => [p, pts[i + 1]])
const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
/** proper crossing of two segments (touching at an end does not count) */
function crosses(a: [P, P], b: [P, P]): boolean {
  const d1 = cross(b[0], b[1], a[0]), d2 = cross(b[0], b[1], a[1]), d3 = cross(a[0], a[1], b[0]), d4 = cross(a[0], a[1], b[1])
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
}
/** does some rail / guard segment lie on the line `axis = c` and cover [lo, hi] along the other axis? */
function covered(G: StairLocal, axis: 'u' | 'v', c: number, lo: number, hi: number, includeGuard = false): boolean {
  const ai = axis === 'u' ? 0 : 1, bi = 1 - ai
  const all: Array<[P, P]> = []
  for (const r of G.rails) all.push(...segs(r.pts.map(([u, v]) => [u, v] as P)))
  if (includeGuard) for (const q of G.guard) all.push([q.a, q.b])
  const on = all.filter(([p, q]) => Math.abs(p[ai] - c) < 0.15 && Math.abs(q[ai] - c) < 0.15)
  const iv = on.map(([p, q]) => [Math.min(p[bi], q[bi]), Math.max(p[bi], q[bi])]).sort((x, y) => x[0] - y[0])
  let reach = lo
  for (const [a, b] of iv) { if (a <= reach + 0.35) reach = Math.max(reach, b) }
  return reach >= hi - 0.35
}

const out: string[] = []
const shapes: StairShape[] = ['u', 'straight', 'l', 'double_l', 'spiral']
for (const shape of shapes) for (const mirror of [false, true]) for (const storey of [10, 11]) for (const [L, W] of [[17, 7.5], [16, 8], [14, 7], [19, 9], [12, 10]]) {
  const tag = `${shape}${mirror ? '-mirror' : ''} storey=${storey} room=${L}x${W}`
  const spec = { ...stairSpec(null, storey), shape, mirror }
  const G = stairLocal(spec, L, W)
  // 1. continuous climb: every step is at most one riser, from the foot to the arrival level
  const levels = [0, ...G.treads.map((t) => t.top), ...G.landings.map((l) => l.top), spec.n * spec.riser].sort((a, b) => a - b)
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > spec.riser * 1.02 + 1e-6) out.push(`${tag}: gap of ${(levels[i] - levels[i - 1]).toFixed(2)} ft in the climb (riser ${spec.riser.toFixed(2)})`)
  // 2. no railing across the walking path
  if (G.arrow.length > 1) {
    const path = segs(G.arrow as P[])
    const rails: Array<[P, P]> = []
    for (const r of G.rails) rails.push(...segs(r.pts.map(([u, v]) => [u, v] as P)))
    path.forEach((s, i) => rails.forEach((b, j) => { if (crosses(s, b)) out.push(`${tag}: a rail crosses the walking path (path segment ${i}, rail segment ${j})`) }))
    // upstairs the walker arrives from the last flight onto the head landing: the guard must not stand in that approach
    const last = path[path.length - 1]
    G.guard.forEach((q, j) => { if (crosses(last, [q.a, q.b])) out.push(`${tag}: the upstairs guard blocks the arrival path (guard ${j})`) })
  }
  // 3. exposed edges keep a rail (lanes sit at the two sides of the room, the well between them; mirroring swaps the sides)
  const wellLo = G.lane, wellHi = W - G.lane
  const upLo = mirror ? G.lane : 0.1, upHi = mirror ? W - 0.1 : W - G.lane
  if (shape === 'u') {
    if (wellHi - wellLo > 0.1 && !covered(G, 'u', G.landing.u0, wellLo, wellHi)) out.push(`${tag}: half landing has no rail along its edge facing the well`)
    if (!covered(G, 'u', G.S, upLo, upHi, true)) out.push(`${tag}: upstairs stair opening is not guarded`)
    if (G.rails.length < 3) out.push(`${tag}: flight handrails missing`)
  }
  if (shape === 'double_l' && !covered(G, 'u', G.S, upLo, upHi, true)) out.push(`${tag}: upstairs opening of the wrap-around stair is not guarded`)
  if ((shape === 'u' || shape === 'double_l' || shape === 'l') && G.rails.every((r) => r.pts.length < 2)) out.push(`${tag}: no handrails at all`)
}
console.log(JSON.stringify(out))
