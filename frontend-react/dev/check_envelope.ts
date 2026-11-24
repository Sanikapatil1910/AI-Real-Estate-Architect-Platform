/**
 * Pure-geometry audit of the roof / terrace envelope helpers (run by tests/test_envelope_geometry.py after bundling with esbuild; prints a JSON list of violations).
 * Scenarios: a rectangular roof, an L-shaped roof (a notch where two strips meet), a roof with the stair head-room on it.
 */
import { ENVELOPE, disjoint, exposedEdges, fasciaRuns, inAny, mumtyDoor, overhangPatches, parapetBoxes, sideOf } from '../src/components/twinEnvelope'
import type { R4, SlabPatch } from '../src/components/twinEnvelope'

const bad: string[] = []
const area = (r: { x0: number; x1: number; z0: number; z1: number }) => (r.x1 - r.x0) * (r.z1 - r.z0)
const overlap = (a: R4, b: R4) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-4 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 1e-4
const by = { top: 1.5, bottom: 1.5, left: 1.5, right: 1.5 }

function scenario(name: string, roofed: R4[], withStair?: { stair: R4; lobby: R4 }) {
  // as the builder does: the outline is the walkable roof; the head-room's room only covers (its walls close that side)
  const edges = exposedEdges(roofed, withStair ? [...roofed, withStair.stair] : roofed)
  const outer = (x: number, z: number) => !inAny(roofed, x, z)
  const patches = overhangPatches(edges, by, outer)
  for (let i = 0; i < patches.length; i++) {
    for (let j = i + 1; j < patches.length; j++) if (overlap(patches[i], patches[j])) bad.push(`${name}: overhang patches ${i} and ${j} overlap`)
    for (const r of roofed) if (overlap(patches[i], r)) bad.push(`${name}: overhang patch ${i} lies over a roofed room`)
    if (Math.min(patches[i].x1 - patches[i].x0, patches[i].z1 - patches[i].z0) > by.top + 1e-6) bad.push(`${name}: overhang wider than configured`)
  }
  if (!patches.length) bad.push(`${name}: no overhang at all`)
  // the fascia never stands inside the slab of another patch or over the building
  for (const f of fasciaRuns(edges, by, patches, outer)) {
    const mid = (f.a + f.b) / 2
    const x = f.axis === 'h' ? mid : f.c, z = f.axis === 'h' ? f.c : mid
    if (inAny(patches.map((p: SlabPatch) => ({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1 })), x, z)) bad.push(`${name}: fascia inside the slab at ${x},${z}`)
    if (inAny(roofed, x, z)) bad.push(`${name}: fascia over the building at ${x},${z}`)
  }
  // disjoint() is idempotent and keeps the area
  const two = disjoint(patches)
  if (Math.abs(two.reduce((s, p) => s + area(p), 0) - patches.reduce((s, p) => s + area(p), 0)) > 1e-6) bad.push(`${name}: disjoint changed the area`)
  // parapets: on exposed edges only, never across the head-room door
  const pb = parapetBoxes(edges, () => true)
  if (!pb.length) bad.push(`${name}: no parapet`)
  for (const q of pb) if (inAny(roofed.map((r) => ({ x0: r.x0 + 0.3, x1: r.x1 - 0.3, z0: r.z0 + 0.3, z1: r.z1 - 0.3 })), (q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2)) bad.push(`${name}: parapet in the middle of the roof`)
  if (withStair) {
    const door = mumtyDoor(withStair.stair, withStair.lobby, roofed)
    if (!door) { bad.push(`${name}: no head-room door`); return }
    if (door.b - door.a < 2.5) bad.push(`${name}: door narrower than 2.5 ft`)
    const probe: R4 = door.axis === 'h' ? { x0: door.a, x1: door.b, z0: door.c + Math.min(0, door.out) * 1.5, z1: door.c + Math.max(0, door.out) * 1.5 }
      : { x0: door.c + Math.min(0, door.out) * 1.5, x1: door.c + Math.max(0, door.out) * 1.5, z0: door.a, z1: door.b }
    // the head-room is a roofed room here, so the exposed edges do not run along its walls: no parapet may stand in front of the door
    for (const q of pb) if (overlap(probe, q)) bad.push(`${name}: a parapet stands in front of the head-room door`)
    if (!inAny(roofed, door.axis === 'h' ? (door.a + door.b) / 2 : door.c + door.out, door.axis === 'h' ? door.c + door.out : (door.a + door.b) / 2)) bad.push(`${name}: the door does not open onto walkable roof`)
  }
}

const rect: R4 = { x0: 3, x1: 47, z0: 23, z1: 55 }
scenario('rectangle', [rect])
const lA: R4 = { x0: 3, x1: 47, z0: 23, z1: 38 }, lB: R4 = { x0: 39.5, x1: 47, z0: 38, z1: 55 }
scenario('L-shape', [lA, lB])
// a walkable terrace roof (one big slab) with a head-room standing on it: the head-room's room is part of the slab but not walkable
const slab: R4 = { x0: 3, x1: 39.5, z0: 23, z1: 38 }
const stair: R4 = { x0: 39.5, x1: 47, z0: 30, z1: 38 }
scenario('terrace+headroom', [slab], { stair, lobby: { x0: 39.5, x1: 47, z0: 30, z1: 33.3 } })

// sideOf agrees with the outward direction
for (const e of exposedEdges([rect])) {
  const s = sideOf(e)
  if ((e.axis === 'h') !== (s === 'top' || s === 'bottom')) bad.push('sideOf axis mismatch')
}
if (ENVELOPE.parapetFt < 2.5 || ENVELOPE.parapetFt > 4) bad.push('parapet height out of the 2.5 - 4 ft range')
console.log(JSON.stringify(bad))
