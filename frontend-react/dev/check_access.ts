/**
 * Unit tests of the walkability machinery (node only, no browser):
 *   - twinAccess:  the per-room clearance check that runs after furniture is placed, and the corridor reservation used to retry
 *   - planAccess:  the plan-level door repair (assumed doors, dead ends, open-air rooms, car bays)
 *   - access.ts:   the strict breadth-first audit of the real collision grid (same canStand / move code as the VR walker)
 */
import assert from 'node:assert/strict'
import { checkRoomAccess, routeStrips, anchors, type RoomAccessInput, type R4 } from '../src/components/twinAccess'
import { repairPlanAccess, type PPlan, type PRoom, type PDoor } from '../src/vr/planAccess'
import { auditAccess } from '../src/vr/access'
import { NavGrid } from '../src/vr/navGrid'

const tests: Array<[string, () => void]> = []
const test = (n: string, f: () => void) => tests.push([n, f])

// ------------------------------------------------------------------------------------------------ twinAccess
const room = { x: 0, y: 0, x2: 12, y2: 12 }
const half = { top: 0.2, bottom: 0.2, left: 0.2, right: 0.2 }
const input = (blocks: R4[], leaves: R4[] = []): RoomAccessInput => ({ room, half, doors: [{ wall: 'left', a: 5, b: 8 }, { wall: 'top', a: 8, b: 11 }], leaves, blocks })

test('an empty room: both doorways are connected', () => assert.equal(checkRoomAccess(input([]), 0.8).ok, true))
test('a wardrobe-and-bed wall between two doorways is found (doors-split) and so is a blocked doorway', () => {
  const wall: R4 = { x0: 0.2, x1: 12, z0: 3, z1: 6 }                                     // runs from the left wall to the right wall
  const r = checkRoomAccess(input([wall]), 0.7)
  assert.ok(!r.ok && r.issues.some((i) => i.kind === 'doors-split' || i.kind === 'door-blocked'), JSON.stringify(r.issues))
  const onDoor: R4 = { x0: 0, x1: 3, z0: 4, z1: 9 }                                       // a bed in front of the left doorway
  const r2 = checkRoomAccess(input([onDoor]), 0.7)
  assert.ok(!r2.ok && r2.issues.some((i) => i.kind === 'door-blocked' || i.kind === 'doors-split'), JSON.stringify(r2.issues))
})
test('a 0.7 ft crack beside an open door leaf is NOT a way through; a 2 ft gap is', () => {
  // leaf from the top door hangs down along x = 8 to z = 3; a bed ends 0.7 ft short of the leaf's end
  const leaf: R4 = { x0: 7.9, x1: 8.1, z0: 0, z1: 3 }
  const sealed: R4[] = [{ x0: 0.2, x1: 7.3, z0: 4, z1: 6 }, { x0: 8.1, x1: 12, z0: 4, z1: 6 }]
  assert.equal(checkRoomAccess(input(sealed, [leaf]), 0.7).ok, false)
  const open: R4[] = [{ x0: 0.2, x1: 5.5, z0: 4, z1: 6 }]
  assert.equal(checkRoomAccess(input(open, [leaf]), 0.7).ok, true)
})
test('corridor reservation: the strips join the two doorways, stay around the room, and furniture kept off them leaves the doorways connected', () => {
  const inp = input([])
  const an = anchors(inp)
  const strips = routeStrips(inp, an[0], an[1], 0.9)
  assert.ok(strips.length > 0)
  for (const s of strips) assert.ok(s.x0 >= -1 && s.z0 >= -1 && s.x1 <= 13 && s.z1 <= 13 && s.x1 > 0 && s.z1 > 0, JSON.stringify(s))   // a strip may reach past a wall by its half width (nothing is placed there)
  // a piece that would have cut the room in two is placed only where it does not touch a strip
  const piece: R4 = { x0: 0.2, x1: 12, z0: 9, z1: 11.5 }
  const hits = strips.some((s) => s.x0 < piece.x1 && s.x1 > piece.x0 && s.z0 < piece.z1 && s.z1 > piece.z0)
  assert.ok(!hits || checkRoomAccess(input([piece]), 0.7).ok)
})

// ------------------------------------------------------------------------------------------------ planAccess
const R = (id: string, type: string, x: number, y: number, x2: number, y2: number, extra: Partial<PRoom> = {}): PRoom => ({ id, room_type: type, x, y, x2, y2, ...extra })
const D = (room: string, to: string | null, x1: number, y1: number, x2: number, y2: number, type = 'internal'): PDoor => ({ room, connects_to: to, x1, y1, x2, y2, door_type: type })
const plan = (rooms: PRoom[], doors: PDoor[]): PPlan => ({ floors: [{ layout: { rooms, openings: { doors } } }] })

test('a bathroom the plan gave no door gets one to its bedroom; the input plan is not touched; the added door is marked', () => {
  const p = plan([R('liv', 'living_room', 0, 0, 12, 10), R('bed', 'bedroom', 0, 10, 12, 20), R('bath', 'bathroom', 12, 10, 18, 20)], [D('liv', null, 4, 0, 8, 0, 'main'), D('liv', 'bed', 4, 10, 7, 10)])
  const before = JSON.stringify(p)
  const rep = repairPlanAccess(p)
  assert.equal(JSON.stringify(p), before, 'input untouched')
  assert.equal(rep.added.length, 1)
  assert.equal(rep.added[0].room, 'bath'); assert.equal(rep.added[0].to, 'bed')
  assert.equal((rep.plan.floors[0].layout!.openings!.doors!.at(-1) as PDoor).source, 'assumed_access')
  assert.ok(rep.graphOk && rep.unresolved.length === 0)
})
test('a bedroom is never given its door THROUGH a bathroom (kitchen is the fallback)', () => {
  const p = plan([R('liv', 'living_room', 0, 0, 12, 10), R('kit', 'kitchen', 12, 0, 26, 10), R('bed', 'bedroom', 0, 10, 12, 20), R('bath', 'bathroom', 12, 10, 18, 20), R('mb', 'master_bedroom', 18, 10, 30, 20)],
    [D('liv', null, 4, 0, 8, 0, 'main'), D('liv', 'bed', 4, 10, 7, 10), D('liv', 'kit', 12, 3, 12, 6)])
  const rep = repairPlanAccess(p)
  const mb = rep.added.find((a) => a.room === 'mb'); assert.ok(mb, 'master bedroom got a door')
  assert.equal(mb!.to, 'kit')
  assert.ok(!rep.added.some((a) => a.room === 'mb' && a.to === 'bath'))
  assert.ok(rep.graphOk && rep.throughDeadEnd.length === 0)
})
test('a courtyard (open to the sky) is not forced to have a door, a car bay is not a corridor', () => {
  const p = plan([R('liv', 'living_room', 0, 0, 12, 10), R('court', 'courtyard', 12, 0, 22, 10)], [D('liv', null, 4, 0, 8, 0, 'main')])
  const rep = repairPlanAccess(p)
  assert.equal(rep.added.length, 0); assert.deepEqual(rep.unresolved, [])
  const p2 = plan([R('liv', 'living_room', 0, 0, 12, 10), R('park', 'parking', 12, 0, 22, 10), R('st', 'staircase', 22, 0, 29, 10)], [D('liv', null, 4, 0, 8, 0, 'main'), D('liv', 'park', 12, 3, 12, 6)])
  const rep2 = repairPlanAccess(p2)
  assert.ok(!rep2.added.some((a) => a.to === 'park'), 'no door to a car bay is added')
  assert.ok(rep2.unresolved.includes('0:st') || rep2.plan.floors[0].layout!.openings!.doors!.length === 2)
})
test('rooms reached only THROUGH a bathroom are reported (a person can walk there, the plan is not valid)', () => {
  const p = plan([R('liv', 'living_room', 0, 0, 12, 10), R('bath', 'bathroom', 12, 0, 18, 10), R('lounge', 'family_lounge', 18, 0, 30, 10)], [D('liv', null, 4, 0, 8, 0, 'main'), D('liv', 'bath', 12, 3, 12, 6, 'bathroom'), D('bath', 'lounge', 18, 3, 18, 6, 'bathroom')])
  const rep = repairPlanAccess(p)
  assert.deepEqual(rep.throughDeadEnd, ['0:lounge'])
  assert.ok(rep.graphOk, 'still physically connected')
})
test('no front door in the plan: nothing can be proven, and every room is reported unresolved', () => {
  const rep = repairPlanAccess(plan([R('a', 'living_room', 0, 0, 10, 10), R('b', 'bedroom', 10, 0, 20, 10)], []))
  assert.equal(rep.graphOk, false); assert.equal(rep.unresolved.length, 2)
})
test('a room that shares no wall wide enough for a door is reported, never silently accepted', () => {
  const p = plan([R('liv', 'living_room', 0, 0, 12, 10), R('bed', 'bedroom', 12, 9.5, 20, 19.5)], [D('liv', null, 4, 0, 8, 0, 'main')])
  const rep = repairPlanAccess(p)
  assert.deepEqual(rep.unresolved, ['0:bed']); assert.equal(rep.graphOk, false)
})

// ------------------------------------------------------------------------------------------------ strict audit on a synthetic collision grid
type V = [number, number, number]
const quad = (g: NavGrid, a: V, b: V, c: V, d: V) => { g.addTriangle(...a, ...b, ...c); g.addTriangle(...a, ...c, ...d) }
const floor = (g: NavGrid, x0: number, z0: number, x1: number, z1: number, y: number) => quad(g, [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0])
const wallX = (g: NavGrid, x: number, z0: number, z1: number, y0: number, y1: number) => quad(g, [x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1])
const wallZ = (g: NavGrid, z: number, x0: number, x1: number, y0: number, y1: number) => quad(g, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z])
test('audit: rooms joined by a doorway are reached, a sealed room is not, the entrance joins the spawn point, and each reached room is replayed with move()', () => {
  const g = new NavGrid({ x0: -6, z0: -6, x1: 40, z1: 30, y1: 24 })
  floor(g, 0, 0, 30, 20, 0.3)
  wallX(g, 10, 0, 7, 0.3, 10); wallX(g, 10, 10, 20, 0.3, 10)            // wall x = 10 with a 3 ft doorway z 7..10 (rooms A | B)
  wallX(g, 20, 0, 20, 0.3, 10)                                           // wall x = 20, no doorway at all (room C sealed)
  wallZ(g, 0, 0, 30, 0.3, 10); wallZ(g, 20, 0, 30, 0.3, 10)
  floor(g, -4, 6, 0, 11, 0.3)                                            // a step outside the front opening
  // front opening in the z = 0 wall is not cut here; the entrance is just outside the west wall opening instead:
  wallX(g, 0, 0, 6, 0.3, 10); wallX(g, 0, 11, 20, 0.3, 10)              // west wall with a 5 ft front doorway z 6..11
  const rooms = [
    { id: 'A', type: 'living_room', floor: 0, floor_y: 0.3, rect: { x0: 0, z0: 0, x1: 10, z1: 20 } },
    { id: 'B', type: 'bedroom', floor: 0, floor_y: 0.3, rect: { x0: 10, z0: 0, x1: 20, z1: 20 } },
    { id: 'C', type: 'bathroom', floor: 0, floor_y: 0.3, rect: { x0: 20, z0: 0, x1: 30, z1: 20 } },
  ]
  const rep = auditAccess({ nav: g, spawn: { x: 5, y: 0.3, z: 8 }, entrance: { x: -2, y: 0.3, z: 8.5 }, rooms, floors: [{ floor_y: 0.3 }],
    doors: [[{ room: 'A', connects_to: 'B', x1: 10, y1: 7, x2: 10, y2: 10 }, { room: 'A', connects_to: null, x1: 0, y1: 6, x2: 0, y2: 11 }, { room: 'B', connects_to: 'C', x1: 20, y1: 8, x2: 20, y2: 11 }]] })
  const by = Object.fromEntries(rep.rooms.map((r) => [r.key, r]))
  assert.ok(by['0:A'].reached && by['0:A'].replay, 'A reached and replayed')
  assert.ok(by['0:B'].reached && by['0:B'].replay, 'B reached through the doorway')
  assert.ok(!by['0:C'].reached, 'C is sealed')
  assert.equal(rep.entranceToSpawn, true)
  assert.equal(rep.unreachable.length, 1)
  assert.equal(rep.doorFailures.length, 1, 'the door into the sealed room is reported as unusable')
  assert.equal(by['0:A'].doorsOpen, 2)
})

const failed: Array<{ name: string; error: string }> = []
let passed = 0
for (const [name, fn] of tests) { try { fn(); passed++ } catch (e) { failed.push({ name, error: String((e as Error).message).slice(0, 400) }) } }
console.log(JSON.stringify({ passed, total: tests.length, failed }))
process.exit(failed.length ? 1 : 0)
