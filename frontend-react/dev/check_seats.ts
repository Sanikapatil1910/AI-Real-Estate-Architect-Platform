/** Unit tests of seat resolution (height from the mesh, stand-up spot, nearest seat) on synthetic geometry. node only. */
import assert from 'node:assert/strict'
import { NavGrid } from '../src/vr/navGrid'
import { measureSeat, resolveSeats, standSpot, nearestSeat } from '../src/vr/seats'
import type { SeatSite } from '../src/components/seatRegistry'

type V = [number, number, number]
const tests: Array<[string, () => void]> = []
const test = (n: string, f: () => void) => tests.push([n, f])
const quad = (g: NavGrid, a: V, b: V, c: V, d: V) => { g.addTriangle(...a, ...b, ...c); g.addTriangle(...a, ...c, ...d) }
const up = (g: NavGrid, x0: number, z0: number, x1: number, z1: number, y: number) => quad(g, [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0])
const wallX = (g: NavGrid, x: number, z0: number, z1: number, y0: number, y1: number) => quad(g, [x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1])
const wallZ = (g: NavGrid, z: number, x0: number, x1: number, y0: number, y1: number) => quad(g, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z])
const mk = () => new NavGrid({ x0: 0, z0: 0, x1: 40, z1: 30, y1: 24 })
const room = () => { const g = mk(); up(g, 2, 2, 30, 20, 0.3); return g }
const site = (o: Partial<SeatSite>): SeatSite => ({ kind: 'sofa', x: 10, z: 10, y: 0.3, w: 2, d: 2, fx: 1, fz: 0, hint: 2.0, ...o })
/** a sofa: solid base to 1.8 ft, a cushion top at 2.3 (floor 0.3 + 2.0) */
const sofa = (g: NavGrid, x0: number, z0: number, x1: number, z1: number, top: number) => { up(g, x0, z0, x1, z1, top); wallX(g, x0, z0, z1, 0.3, top); wallX(g, x1, z0, z1, 0.3, top); wallZ(g, z0, x0, x1, 0.3, top); wallZ(g, z1, x0, x1, 0.3, top) }

test('the seat height is read from the mesh: a cushion top 2.0 ft above the floor', () => {
  const g = room(); sofa(g, 8, 8, 12, 12, 2.3)
  const m = measureSeat(g, site({}))
  assert.ok(m.measured && Math.abs(m.y - 2.3) < 0.1, JSON.stringify(m))
})
test('a taller back cushion or a floor next to the seat does not confuse it; with no mesh the expected height is used', () => {
  const g = room(); sofa(g, 8, 8, 12, 12, 2.3); up(g, 8, 8, 9, 12, 3.2)   // back cushion at one edge, above the 2.9 ft limit
  assert.ok(Math.abs(measureSeat(g, site({})).y - 2.3) < 0.1)
  const empty = room(); const m = measureSeat(empty, site({ x: 20, z: 15 }))
  assert.ok(!m.measured && Math.abs(m.y - 2.3) < 1e-6, JSON.stringify(m))
})
test('seats on an upper floor are measured against that floor', () => {
  const g = room(); up(g, 2, 2, 30, 20, 10.3); sofa(g, 8, 8, 12, 12, 12.3)
  const m = measureSeat(g, site({ y: 10.3 }))
  assert.ok(m.measured && Math.abs(m.y - 12.3) < 0.1, JSON.stringify(m))
})
test('two registrations of the same piece become one seat; others stay', () => {
  const g = room(); sofa(g, 8, 8, 12, 12, 2.3)
  const s = resolveSeats(g, [site({}), site({ x: 10.1, z: 10.1 }), site({ x: 20, z: 15, kind: 'chair', hint: 1.75 })], () => '0:living')
  assert.equal(s.length, 2); assert.equal(s[0].room, '0:living'); assert.equal(s[1].kind, 'chair')
})
test('stand-up: the spot the person came from is used when it is free and close; otherwise free floor in front of the seat', () => {
  const g = room(); sofa(g, 8, 8, 12, 12, 2.3)
  const spots = resolveSeats(g, [site({})])
  const prev = { x: 14, y: 0.35, z: 10 }
  const a = standSpot(g, spots[0], prev)!; assert.ok(Math.hypot(a.x - 14, a.z - 10) < 0.01)
  const b = standSpot(g, spots[0], null)!
  assert.ok(g.canStand(b.x, b.z, b.y) !== null && b.x > 12, `in front: ${JSON.stringify(b)}`)
  const far = standSpot(g, spots[0], { x: 28, y: 0.35, z: 18 })!; assert.ok(Math.hypot(far.x - 28, far.z - 18) > 1, 'a far-away previous spot is not used')
})
test('stand-up works when the front is blocked (wall right in front): beside or behind instead', () => {
  const g = room(); sofa(g, 8, 8, 12, 12, 2.3); wallX(g, 13.5, 4, 16, 0.3, 10.3)
  const spots = resolveSeats(g, [site({})])
  const b = standSpot(g, spots[0], null)!
  assert.ok(b && g.canStand(b.x, b.z, b.y) !== null && b.x < 13.2, JSON.stringify(b))
})
test('nearest seat: same floor only, within reach, a seat in front beats an equally near one behind', () => {
  const g = room(); up(g, 2, 2, 30, 20, 10.3)
  const spots = resolveSeats(g, [site({ x: 10, z: 10 }), site({ x: 14, z: 10 }), site({ x: 10, z: 10, y: 10.3, kind: 'chair' })].map((s, i) => ({ ...s, x: s.x + i * 0.0, z: s.z + (i === 2 ? 5 : 0) })))
  const f = { x: 12, y: 0.35, z: 10 }
  const ahead = nearestSeat(spots, f, { x: 1, z: 0 })!; assert.ok(Math.abs(ahead.x - 14) < 0.01, 'in front')
  const behind = nearestSeat(spots, f, { x: -1, z: 0 })!; assert.ok(Math.abs(behind.x - 10) < 0.01, 'looking the other way')
  assert.equal(nearestSeat(spots, { x: 28, y: 0.35, z: 19 }, undefined, 5), null, 'out of reach')
  assert.ok(nearestSeat(spots, { x: 12, y: 10.35, z: 14 })!.floorY > 5, 'upper floor seat for an upper floor person')
})
const failed: Array<{ name: string; error: string }> = []
let passed = 0
for (const [name, fn] of tests) { try { fn(); passed++ } catch (e) { failed.push({ name, error: String((e as Error).message).slice(0, 300) }) } }
console.log(JSON.stringify({ passed, total: tests.length, failed }))
process.exit(failed.length ? 1 : 0)
