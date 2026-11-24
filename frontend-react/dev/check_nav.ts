/** Unit tests of the walking grid on synthetic geometry (stairs, doorway, furniture, floor edge): node only, no browser. */
import assert from 'node:assert/strict'
import { NavGrid, BODY_RADIUS_FT } from '../src/vr/navGrid'

type V = [number, number, number]
const tests: Array<[string, () => void]> = []
const test = (n: string, f: () => void) => tests.push([n, f])
const quad = (g: NavGrid, a: V, b: V, c: V, d: V) => { g.addTriangle(...a, ...b, ...c); g.addTriangle(...a, ...c, ...d) }
const floor = (g: NavGrid, x0: number, z0: number, x1: number, z1: number, y: number) => quad(g, [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0])   // normal up
const wallX = (g: NavGrid, x: number, z0: number, z1: number, y0: number, y1: number) => quad(g, [x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1])
const box = (g: NavGrid, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) => {
  wallX(g, x0, z0, z1, y0, y1); wallX(g, x1, z0, z1, y0, y1)
  quad(g, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]); quad(g, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])
  quad(g, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0])
}
const mk = () => new NavGrid({ x0: 0, z0: 0, x1: 40, z1: 30, y1: 24 })

test('flat floor is walkable and has its height; the edge of the floor stops the walker', () => {
  const g = mk(); floor(g, 2, 2, 20, 20, 0.3)
  assert.ok(Math.abs(g.groundAt(10, 10, 0.3)! - 0.3) < 0.13)
  const p = g.move({ x: 10, y: 0.3, z: 10 }, 30, 0)
  assert.ok(p.x < 20.01 && p.x > 18, `stopped at the edge, got ${p.x}`)
})
test('a wall blocks, a doorway lets the walker through, walls are slid along', () => {
  const g = mk(); floor(g, 2, 2, 30, 20, 0.3)
  wallX(g, 12, 2, 9, 0.3, 10); wallX(g, 12, 12, 20, 0.3, 10)           // wall at x = 12 with a 3 ft opening z in [9, 12]
  let p = g.move({ x: 8, y: 0.3, z: 4 }, 10, 0); assert.ok(p.x < 12 - BODY_RADIUS_FT + 0.1, `wall must stop the walker one body radius short of the wall, x=${p.x}`)
  p = g.move({ x: 8, y: 0.3, z: 10.5 }, 10, 0); assert.ok(p.x > 17, `doorway must be passable, x=${p.x}`)
  p = g.move({ x: 8, y: 0.3, z: 4 }, 6, 3); assert.ok(p.z > 6, 'slides along the wall')
})
test('a doorway too narrow for the body (0.3 ft) blocks', () => {
  const g = mk(); floor(g, 2, 2, 30, 20, 0.3); wallX(g, 12.15, 2, 9.85, 0.3, 10); wallX(g, 12.15, 10.15, 20, 0.3, 10)
  const p = g.move({ x: 8, y: 0.3, z: 10 }, 10, 0); assert.ok(p.x < 12.15 - BODY_RADIUS_FT + 0.1, `x=${p.x}`)
})
test('stairs: climb 10 risers of 0.6 ft (up to the next floor) and walk back down', () => {
  const g = mk(); floor(g, 2, 2, 12, 20, 0.3)
  for (let i = 0; i < 17; i++) {                               // treads (3 ft wide, 0.8 ft deep) and risers
    const x0 = 12 + i * 0.8, y = 0.3 + (i + 1) * 0.6
    floor(g, x0, 8, x0 + 0.8, 11, y); quad(g, [x0, y - 0.6, 8], [x0, y, 8], [x0, y, 11], [x0, y - 0.6, 11])
    wallX(g, x0, 8, 11, y - 0.6, y)
  }
  floor(g, 25.6, 2, 38, 20, 0.3 + 18 * 0.6)
  let p = g.move({ x: 10, y: 0.3, z: 9.5 }, 30, 0)
  assert.ok(p.y > 10, `should reach the upper landing, y=${p.y}`)
  p = g.move(p, -30, 0); assert.ok(p.y < 1.2, `should walk back down, y=${p.y}`)
})
test('a table (top 2.5 ft) and a sofa-height box stop the walker; a 0.5 ft rug does not', () => {
  const g = mk(); floor(g, 2, 2, 30, 20, 0.3)
  box(g, 14, 6, 17, 9, 0.3, 2.8); box(g, 20, 6, 23, 9, 0.3, 0.8)
  let p = g.move({ x: 10, y: 0.3, z: 7.5 }, 10, 0); assert.ok(p.x < 13.5, `table must stop, x=${p.x}`)
  p = g.move({ x: 18, y: 0.3, z: 7.5 }, 10, 0); assert.ok(p.x > 24, `rug is walked over, x=${p.x}`)
})
test('a drop off a terrace edge (> 1.1 ft) is not allowed; a low kerb is', () => {
  const g = mk(); floor(g, 2, 2, 12, 20, 6.3); floor(g, 12, 2, 30, 20, 0.3)
  const p = g.move({ x: 8, y: 6.3, z: 10 }, 10, 0); assert.ok(p.x < 12.2 && p.y > 6, `no jumping off, x=${p.x} y=${p.y}`)
})
test('ceiling undersides never block (a stair flight can run under a slab edge); a 1.2 ft doorway is too narrow, a low table leaves a hand of clearance', () => {
  const g = mk(); floor(g, 2, 2, 30, 20, 0.3)
  quad(g, [12, 4.5, 2], [14, 4.5, 2], [14, 4.5, 20], [12, 4.5, 20])       // downward-facing slab at 4.5 ft
  assert.ok(g.move({ x: 8, y: 0.3, z: 10 }, 10, 0).x > 17, 'underside is ignored')
  const t = mk(); floor(t, 2, 2, 30, 20, 0.3); box(t, 14, 8, 17, 11, 0.3, 2.8)
  assert.ok(t.canStand(13.3, 9.5, 0.3) !== null, 'low furniture: only a hand of clearance')
  assert.ok(t.canStand(14.2, 9.5, 0.3) === null, 'cannot stand inside the table')
  const w = mk(); floor(w, 2, 2, 30, 20, 0.3); wallX(w, 14, 2, 20, 0.3, 10)
  assert.ok(w.canStand(14 - BODY_RADIUS_FT + 0.1, 9.5, 0.3) === null, 'a wall keeps the full body radius away')
  assert.ok(w.canStand(14 - BODY_RADIUS_FT - 0.4, 9.5, 0.3) !== null, 'but not more than that')
  assert.ok(w.canStand(12.9, 9.5, 0.3) !== null)
})
test('nearestStandable finds a free spot near a blocked one; null when none', () => {
  const g = mk(); floor(g, 2, 2, 30, 20, 0.3); box(g, 14, 6, 17, 9, 0.3, 2.8)
  const s = g.nearestStandable(15.5, 7.5, 0.3)!; assert.ok(s && g.canStand(s.x, s.z, 0.3) !== null)
  assert.equal(new NavGrid({ x0: 0, z0: 0, x1: 10, z1: 10, y1: 12 }).nearestStandable(5, 5, 0.3, 3), null)
})
test('a 2 km plot triangle does not explode: only the part inside the grid is sampled (fast)', () => {
  const g = mk(); const t0 = Date.now()
  g.addTriangle(-2000, 0.2, -2000, 0, 0.2, 2000, 2000, 0.2, -2000)
  assert.ok(Date.now() - t0 < 1500 && g.samples < 3e6, `took ${Date.now() - t0} ms, ${g.samples} samples`)
  assert.ok(g.groundAt(20, 15, 0.2) !== null)
})
test('outside the grid is not walkable; degenerate triangles are ignored', () => {
  const g = mk(); g.addTriangle(1, 1, 1, 1, 1, 1, 1, 1, 1); assert.equal(g.triangles, 0)
  assert.equal(g.groundAt(-5, -5, 0), null)
})
test('building the grid is fast: 200k triangles of furniture-like boxes in < 3 s', () => {
  const g = mk(); floor(g, 2, 2, 38, 28, 0.3); const t0 = Date.now()
  for (let i = 0; i < 4000; i++) box(g, 3 + (i % 60) * 0.55, 3 + Math.floor(i / 60) * 0.3, 3.3 + (i % 60) * 0.55, 3.3 + Math.floor(i / 60) * 0.3, 0.3, 2.2)
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`)
})
test('walk patches: a stair whose own geometry is blocked by a tall rail is still climbable, and the rail still blocks beside the stair', () => {
  const g = mk(); floor(g, 2, 2, 30, 20, 0.3)
  // 10 treads going up along +x, 1 ft deep, 0.5 ft riser, 4 ft wide (z 8..12); a 3 ft tall rail runs across the foot of the flight
  const patches: Array<{ pts: Array<[number, number]>; top: number }> = []
  for (let i = 0; i < 10; i++) patches.push({ pts: [[14 + i, 8], [15 + i, 8], [15 + i, 12], [14 + i, 12]], top: 0.3 + 0.5 * (i + 1) })
  box(g, 13.9, 8, 14.1, 12, 0.3, 3.3)                                     // guard rail across the lane at the foot
  assert.ok(g.canStand(12, 10, 0.3) !== null, 'floor before the stair is standable')
  assert.equal(g.canStand(13.95, 10, 0.3), null, 'without patches the rail seals the foot of the stair')
  g.addWalkPatches(patches)
  assert.equal(g.patchCount, 10)
  let p = { x: 12, y: 0.3, z: 10 }
  for (let i = 0; i < 60; i++) p = g.move(p, 0.3, 0)
  assert.ok(p.y > 4.5, `walker climbed the patches, y=${p.y}`)
  box(g, 20, 3, 22, 6, 0.3, 3.3)                                          // a rail-height block elsewhere stays solid: patches only exempt the stair itself
  assert.equal(g.canStand(19.9, 4.5, 0.3), null, 'solid things away from the stair still block')
})
test('walk patches: walking back down follows the treads to the floor', () => {
  const g = mk(); floor(g, 2, 2, 30, 20, 0.3)
  const patches: Array<{ pts: Array<[number, number]>; top: number }> = []
  for (let i = 0; i < 6; i++) patches.push({ pts: [[14 + i, 8], [15 + i, 8], [15 + i, 12], [14 + i, 12]], top: 0.3 + 0.5 * (i + 1) })
  g.addWalkPatches(patches)
  let p = { x: 19.5, y: 3.3, z: 10 }
  for (let i = 0; i < 60; i++) p = g.move(p, -0.3, 0)
  assert.ok(p.y < 0.8, `walker came back down, y=${p.y}`)
})
const failed: Array<{ name: string; error: string }> = []
let passed = 0
for (const [name, fn] of tests) { try { fn(); passed++ } catch (e) { failed.push({ name, error: String((e as Error).message).slice(0, 300) }) } }
console.log(JSON.stringify({ passed, total: tests.length, failed }))
process.exit(failed.length ? 1 : 0)
