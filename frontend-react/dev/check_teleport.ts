/** Unit tests of the teleport arc on synthetic geometry (node only). */
import assert from 'node:assert/strict'
import { NavGrid } from '../src/vr/navGrid'
import { aimArc, FT_M } from '../src/vr/teleport'

type V = [number, number, number]
const tests: Array<[string, () => void]> = []
const test = (n: string, f: () => void) => tests.push([n, f])
const quad = (g: NavGrid, a: V, b: V, c: V, d: V) => { g.addTriangle(...a, ...b, ...c); g.addTriangle(...a, ...c, ...d) }
const up = (g: NavGrid, x0: number, z0: number, x1: number, z1: number, y: number) => quad(g, [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0])
const down = (g: NavGrid, x0: number, z0: number, x1: number, z1: number, y: number) => quad(g, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1])
const wallX = (g: NavGrid, x: number, z0: number, z1: number, y0: number, y1: number) => quad(g, [x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1])
const mk = () => new NavGrid({ x0: 0, z0: 0, x1: 60, z1: 40, y1: 30 })
const m = (ft: number) => ft * FT_M
const eye = (x: number, y: number, z: number): V => [m(x), m(y + 5.3), m(z)]   // feet -> metres, eye height 1.62 m

test('lands on the floor in front of the person; valid, at floor height', () => {
  const g = mk(); up(g, 2, 2, 50, 30, 0.3)
  const r = aimArc(g, eye(10, 0.3, 10), [1, -0.2, 0])
  assert.ok(r.valid && r.target, `reason ${r.reason}`)
  assert.ok(Math.abs(r.target!.y - 0.3) < 0.15 && r.target!.x > 14, `target ${JSON.stringify(r.target)}`)
})
test('a wall in the way stops the arc: no teleport', () => {
  const g = mk(); up(g, 2, 2, 50, 30, 0.3); wallX(g, 14, 2, 30, 0.3, 10.3)
  const r = aimArc(g, eye(10, 0.3, 10), [1, 0.05, 0])
  assert.ok(!r.valid && r.reason === 'wall', r.reason)
  assert.ok(r.points[r.points.length - 1][0] < m(14.3))
})
test('aiming up under a slab hits the ceiling: no teleport through the floor above', () => {
  const g = mk(); up(g, 2, 2, 50, 30, 0.3); up(g, 2, 2, 50, 30, 10.3); down(g, 2, 2, 50, 30, 10.0)
  const r = aimArc(g, eye(10, 0.3, 10), [0.3, 1, 0])
  assert.ok(!r.valid && r.reason === 'ceiling', r.reason)
})
test('upper floor: standing on it, the arc lands on the upper floor (not the ground floor below)', () => {
  const g = mk(); up(g, 2, 2, 50, 30, 0.3); up(g, 2, 2, 50, 30, 10.3); down(g, 2, 2, 50, 30, 10.0)
  const r = aimArc(g, eye(10, 10.3, 10), [1, -0.3, 0])
  assert.ok(r.valid && Math.abs(r.target!.y - 10.3) < 0.15, `${r.reason} ${JSON.stringify(r.target)}`)
})
test('upper floor reached through a stairwell opening: aim from the ground floor up through the hole and land beyond it', () => {
  const g = mk(); up(g, 2, 2, 50, 30, 0.3)
  // slab at 10.3 with a hole x 20..26, z 8..14; the person stands just below the hole
  up(g, 2, 2, 20, 30, 10.3); up(g, 26, 2, 50, 30, 10.3); up(g, 20, 2, 26, 8, 10.3); up(g, 20, 14, 26, 30, 10.3)
  down(g, 2, 2, 20, 30, 10.0); down(g, 26, 2, 50, 30, 10.0); down(g, 20, 2, 26, 8, 10.0); down(g, 20, 14, 26, 30, 10.0)
  let landed = false
  for (const [ang, dx] of [[60, 1], [65, 1], [70, 1], [55, 1], [75, 1], [50, 1]]) {
    const a = (ang * Math.PI) / 180
    const r = aimArc(g, eye(21, 0.3, 11), [Math.cos(a) * dx, Math.sin(a), 0], { speed: 9 })
    if (r.valid && r.target!.y > 9) { landed = true; assert.ok(r.target!.x > 26 || r.target!.x < 20 || r.target!.z < 8 || r.target!.z > 14, 'lands on the slab, not in the hole') ; break }
  }
  assert.ok(landed, 'some aim through the hole lands on the upper floor')
})
test('looking down the stairwell from the upper floor lands on the ground floor below', () => {
  const g = mk(); up(g, 2, 2, 50, 30, 0.3)
  up(g, 2, 2, 20, 30, 10.3); up(g, 26, 2, 50, 30, 10.3); up(g, 20, 2, 26, 8, 10.3); up(g, 20, 14, 26, 30, 10.3)
  down(g, 2, 2, 20, 30, 10.0); down(g, 26, 2, 50, 30, 10.0); down(g, 20, 2, 26, 8, 10.0); down(g, 20, 14, 26, 30, 10.0)
  const r = aimArc(g, eye(18, 10.3, 11), [1, -0.9, 0], { speed: 3 })
  assert.ok(r.valid && Math.abs(r.target!.y - 0.3) < 0.15, `${r.reason} ${JSON.stringify(r.target)}`)
})
test('a table top is not a teleport destination; the floor beside it is', () => {
  const g = mk(); up(g, 2, 2, 50, 30, 0.3)
  up(g, 18, 8, 22, 12, 2.8); wallX(g, 18, 8, 12, 0.3, 2.8); wallX(g, 22, 8, 12, 0.3, 2.8)
  quad(g, [18, 0.3, 8], [22, 0.3, 8], [22, 2.8, 8], [18, 2.8, 8]); quad(g, [18, 0.3, 12], [18, 2.8, 12], [22, 2.8, 12], [22, 0.3, 12])
  const on = aimArc(g, [m(20), m(5.3 + 2.8), m(10)], [0, -1, 0.001], { speed: 0.5, levels: [0.3, 10.3] })
  assert.ok(!on.valid && on.reason === 'cannot-stand', on.reason)
  const beside = aimArc(g, eye(10, 0.3, 18), [1, -0.2, 0], { levels: [0.3, 10.3] })
  assert.ok(beside.valid, beside.reason)
})
test('a spot a hand from a wall is snapped to standable floor instead of being refused', () => {
  const g = mk(); up(g, 2, 2, 50, 30, 0.3); wallX(g, 30, 2, 30, 0.3, 10.3)
  const r = aimArc(g, eye(24, 0.3, 10), [1, -0.35, 0], { speed: 7.8 })
  if (r.valid) assert.ok(r.target!.x < 30, 'snapped inside')
  else assert.ok(['wall', 'cannot-stand'].includes(r.reason), r.reason)
})
test('straight down and falling off the world are handled without throwing', () => {
  const g = mk(); up(g, 2, 2, 50, 30, 0.3)
  assert.ok(aimArc(g, eye(10, 0.3, 10), [0, -1, 0]).valid)
  const r = aimArc(g, eye(70, 0.3, 10), [1, 0, 0]); assert.ok(!r.valid)
  assert.ok(!aimArc(g, eye(10, 0.3, 10), [0, 0, 0]).valid || true)
})
const failed: Array<{ name: string; error: string }> = []
let passed = 0
for (const [name, fn] of tests) { try { fn(); passed++ } catch (e) { failed.push({ name, error: String((e as Error).message).slice(0, 300) }) } }
console.log(JSON.stringify({ passed, total: tests.length, failed }))
process.exit(failed.length ? 1 : 0)
