import * as THREE from 'three'

/** Door leaves (with swing arcs) and U-shaped stair flights for the digital twin. Units: feet. */

import { stairLocal, stairSpec, toPlanRect } from './stairSpec'
import type { RoomR, StairSpec } from './stairSpec'
import { texBox } from './twinMaterials'
import { registerStairWalk, stairWalkPatches } from './stairWalk'
export type { RoomR }

/* ------------------------------------------------------------------ stairs */
/** Part of a stair room that carries a floor slab on the level the stair arrives at (the landing at its head). */
export function stairLobbyRect(r: RoomR, entryHigh = false, spec?: StairSpec): { x0: number; x1: number; z0: number; z1: number } {
  const sp = spec ?? stairSpec(undefined, 10)
  const P = toPlanRect(r, entryHigh, sp.axis)
  const G = stairLocal(sp, P.L, P.W)
  const q = P.map(G.head.u0, G.head.u1, G.head.v0, G.head.v1)
  return { x0: q.x0, x1: q.x1, z0: q.y0, z1: q.y1 }
}

/**
 * `flights: false` draws only the protective guard round the stair opening (the top floor of a house whose roof is not accessible: the stair
 * ends on that floor, so there are no flights going up, but the opening it arrives through still needs its guard rail).
 */
export function buildStair(g: THREE.Group, mat: THREE.Material, r: RoomR, lvl: number, spec: StairSpec, upper = false, entryHigh = false, flights = true): void {
  const P = toPlanRect(r, entryHigh, spec.axis)
  const G = stairLocal(spec, P.L, P.W)
  if (flights) registerStairWalk(stairWalkPatches(r, lvl, spec, entryHigh))   // the walkable surfaces, for the VR walk-through (changes nothing drawn)
  // folded stair: thin treads + risers only, so the space under the flights stays open
  const TH = 0.35
  const plate = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number) => {
    const b = P.map(u0, u1, v0, v1)
    const m = new THREE.Mesh(texBox(mat, b.x0, Math.max(b.x1, b.x0 + 0.05), lvl + y0, lvl + Math.max(y1, y0 + 0.05), b.y0, Math.max(b.y1, b.y0 + 0.05)), mat)
    m.position.set((b.x0 + b.x1) / 2, lvl + (y0 + y1) / 2, (b.y0 + b.y1) / 2)
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
  }
  // a plate whose long side points along local angle `ang` (spiral treads)
  const spin = (cu: number, cv: number, ang: number, len: number, wid: number, y0: number, y1: number, off = 0) => {
    const c = P.pt(cu - off * Math.sin(ang), cv + off * Math.cos(ang))
    const base = P.pt(cu, cv)
    const dir = P.pt(cu + Math.cos(ang), cv + Math.sin(ang))
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, Math.max(0.05, y1 - y0), wid), mat)
    m.position.set(c.x, lvl + (y0 + y1) / 2, c.y)
    m.rotation.y = -Math.atan2(dir.y - base.y, dir.x - base.x)
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
  }
  for (let fl = 1; flights && fl <= G.nFlights; fl++) {
    const ts = G.treads.filter((t) => t.flight === fl).sort((p, q) => p.top - q.top)
    ts.forEach((t, i) => {
      const prev = i === 0 ? 0 : ts[i - 1].top
      if (t.rot) {
        const rt = t.rot
        spin(rt.cu, rt.cv, rt.ang, rt.len, rt.wid, t.top - TH, t.top)
        // riser on the tangential edge facing the lower step
        spin(rt.cu, rt.cv, rt.ang, rt.len, 0.12, prev, t.top, -rt.wid / 2 + 0.06)
        return
      }
      plate(t.u0, t.u1, t.v0, t.v1, t.top - TH, t.top)
      // direction of travel on this tread: from the previous tread (or along the flight for the first one)
      const cur = [(t.u0 + t.u1) / 2, (t.v0 + t.v1) / 2]
      const ref = i > 0 ? ts[i - 1] : ts[1] ?? t
      const rc = [(ref.u0 + ref.u1) / 2, (ref.v0 + ref.v1) / 2]
      let du = i > 0 ? cur[0] - rc[0] : rc[0] - cur[0]
      let dv = i > 0 ? cur[1] - rc[1] : rc[1] - cur[1]
      if (i === 0 && ts.length === 1) { du = 1; dv = 0 }
      if (Math.abs(du) >= Math.abs(dv)) {
        // climbing along u: the riser stands on the low-u side when travelling toward +u
        const lowSide = du >= 0
        plate(lowSide ? t.u0 : t.u1 - 0.12, lowSide ? t.u0 + 0.12 : t.u1, t.v0, t.v1, prev, t.top)
      } else {
        const lowSide = dv >= 0
        plate(t.u0, t.u1, lowSide ? t.v0 : t.v1 - 0.12, lowSide ? t.v0 + 0.12 : t.v1, prev, t.top)
      }
    })
  }
  for (const ld of flights ? G.landings : []) {
    plate(ld.u0, ld.u1, ld.v0, ld.v1, ld.top - TH, ld.top) // landing slab, open below
    for (const [pu, pv] of [[ld.u1 - 0.3, ld.v0], [ld.u1 - 0.3, ld.v1 - 0.3]] as Array<[number, number]>) {
      plate(pu, pu + 0.3, pv, pv + 0.3, 0, ld.top - TH) // two slim columns carry each landing
    }
  }
  if (G.column && flights) {
    const c = P.pt(G.column.u, G.column.v)
    const m = new THREE.Mesh(new THREE.CylinderGeometry(G.column.r, G.column.r, spec.storeyH, 20), mat)
    m.position.set(c.x, lvl + spec.storeyH / 2, c.y)
    m.castShadow = true
    g.add(m)
  }

  // handrails on the open (well) side of every flight, plus a guard rail round the stair void upstairs
  const railMat = new THREE.MeshStandardMaterial({ color: 0x5b3f26, roughness: 0.6 })
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3f3a35, roughness: 0.5, metalness: 0.3 })
  const Pt = (u: number, v: number, h: number) => {
    const b = P.pt(u, v)
    return new THREE.Vector3(b.x, lvl + h, b.y)
  }
  const post = (p: THREE.Vector3, h0: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, p.y - lvl - h0, 0.1), postMat)
    m.position.set(p.x, lvl + h0 + (p.y - lvl - h0) / 2, p.z)
    m.castShadow = true
    g.add(m)
  }
  const rail = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a)
    if (d.length() < 0.05) return
    const m = new THREE.Mesh(new THREE.BoxGeometry(d.length(), 0.14, 0.14), railMat)
    m.position.copy(a.clone().add(b).multiplyScalar(0.5))
    m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize())
    m.castShadow = true
    g.add(m)
  }
  const HR = 3.0
  for (const rl of flights ? G.rails : []) {
    if (rl.pts.length < 2) continue
    const pts = rl.pts.map(([u, v, h]) => Pt(u, v, h + HR))
    if (rl.posts) rl.pts.forEach(([, , h], j) => { if (j % 2 === 0 || j === rl.pts.length - 1) post(pts[j], h) })
    for (let j = 0; j + 1 < pts.length; j++) rail(pts[j], pts[j + 1])
  }
  if (upper) {
    for (const q of G.guard) {
      const a = Pt(q.a[0], q.a[1], HR)
      const b = Pt(q.b[0], q.b[1], HR)
      rail(a, b)
      post(a, 0)
      post(b, 0)
      post(a.clone().add(b).multiplyScalar(0.5).setY(lvl + HR), 0)
    }
  }
}

/* ------------------------------------------------------------------- doors */
export interface DoorLeaf {
  pivot: THREE.Group
  arc: THREE.Object3D
  phi0: number
  dphi: number
}

const RANK: Record<string, number> = {
  bathroom: 3, toilet: 3, dressing: 3, puja_room: 2, utility: 2, master_bedroom: 1, bedroom: 1, guest_bedroom: 1, study: 1, kitchen: 1,
}
const OPEN_PLAN = new Set(['living_room', 'dining', 'family_lounge', 'passage', 'staircase', 'open_terrace', 'courtyard'])

const leafMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.65 })
/** Finishes for a door leaf (from the design); without them the plain brown leaf of the original viewer is used. */
export interface DoorMats { leaf: THREE.Material; main?: THREE.Material; handle?: THREE.Material; frame?: THREE.Material; carved?: { border: THREE.Material; brass: THREE.Material; grand?: boolean } }
const arcFill = new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
const arcLine = new THREE.LineBasicMaterial({ color: 0x1d4ed8 })

export interface DoorInput {
  axis: 'h' | 'v'
  c: number
  a: number
  b: number
  kind: string // 'main' | 'door'
  doorType?: string
  owner?: RoomR
  other?: RoomR
  /** every other doorway on this floor (so a leaf is never hinged where it would fold across one) */
  doors?: DoorSeg[]
}

const OPEN_ANGLE = (72 * Math.PI) / 180
/** The angle a door leaf stands at in the model the VR walker uses (the viewer's swing symbol stays at 72°): 90° keeps the leaf square to the wall, along the hinge side of the opening, so an open door never narrows the way through. */
export const WALK_OPEN_ANGLE = Math.PI / 2
export const WALK_OPEN_SCALE = WALK_OPEN_ANGLE / OPEN_ANGLE

/** The room a door leaf swings into (null for an open-plan / cased opening, which has no leaf).  Shared with the furniture layout. */
export function swingRoom(kind: string, doorType: string | undefined, owner?: RoomR, other?: RoomR): RoomR | undefined | null {
  if (doorType === 'arch') return null
  if (kind === 'main') return owner
  if (owner && other) {
    const ro = RANK[owner.room_type] ?? 0
    const rt = RANK[other.room_type] ?? 0
    if (ro === 0 && rt === 0 && OPEN_PLAN.has(owner.room_type) && OPEN_PLAN.has(other.room_type)) return null
    return rt > ro ? other : owner
  }
  return owner ?? other
}


export interface DoorSeg { axis: 'h' | 'v'; c: number; a: number; b: number }
/**
 * Which end of the opening the leaf is hinged at (true: at `a`).  A leaf folds back against the wall beside the opening, so by default it is hinged at the end nearer a
 * corner.  But when that folded leaf would lie across ANOTHER doorway of the same room (a corridor door hinged 0.5 ft from the wall that holds a bathroom door, say), the
 * other end is used.  One rule, used by the door builder and by the furniture planner, so the leaf drawn and the leaf kept clear are the same.
 */
export function hingeAtEndA(axis: 'h' | 'v', c: number, a: number, b: number, swing: { x: number; y: number; x2: number; y2: number }, doors: DoorSeg[] = []): boolean {
  const lo = axis === 'h' ? swing.x : swing.y
  const hi = axis === 'h' ? swing.x2 : swing.y2
  const cMid = axis === 'h' ? (swing.y + swing.y2) / 2 : (swing.x + swing.x2) / 2
  const nSign = cMid >= c ? 1 : -1
  const pref = a - lo <= hi - b
  const w = b - a
  const crosses = (atA: boolean): boolean => {
    const hinge = atA ? a : b
    // the folded leaf: a thin slab from the hinge, w long, square to the wall into the room; kept 0.45 ft clear of every other doorway of that room
    const L = axis === 'h' ? { x0: hinge - 0.55, x1: hinge + 0.55, z0: Math.min(c, c + nSign * w), z1: Math.max(c, c + nSign * w) } : { x0: Math.min(c, c + nSign * w), x1: Math.max(c, c + nSign * w), z0: hinge - 0.55, z1: hinge + 0.55 }
    for (const d of doors) {
      if (d.axis === axis && Math.abs(d.c - c) < 0.06 && Math.abs(d.a - a) < 0.06 && Math.abs(d.b - b) < 0.06) continue     // itself
      const band = d.axis === 'h' ? { x0: d.a, x1: d.b, z0: d.c - 0.3, z1: d.c + 0.3 } : { x0: d.c - 0.3, x1: d.c + 0.3, z0: d.a, z1: d.b }
      if (band.x1 <= swing.x - 0.1 || band.x0 >= swing.x2 + 0.1 || band.z1 <= swing.y - 0.1 || band.z0 >= swing.y2 + 0.1) continue      // not a doorway of this room
      if (L.x0 < band.x1 && L.x1 > band.x0 && L.z0 < band.z1 && L.z1 > band.z0) return true
    }
    return false
  }
  if (!crosses(pref)) return pref
  return crosses(!pref) ? pref : !pref
}

/** Creates the leaf + arc for a door, or null when the opening is an open-plan (cased) one. */
export function makeDoor(inp: DoorInput, lvl: number, mats?: DoorMats): DoorLeaf | null {
  const { owner, other } = inp
  const swing = swingRoom(inp.kind, inp.doorType, owner, other)
  if (!swing) return null
  const w = inp.b - inp.a
  if (w < 1.5) return null

  const cMid = inp.axis === 'h' ? (swing.y + swing.y2) / 2 : (swing.x + swing.x2) / 2
  const nSign = cMid >= inp.c ? 1 : -1 // towards the room the door swings into
  const lo = inp.axis === 'h' ? swing.x : swing.y
  const hi = inp.axis === 'h' ? swing.x2 : swing.y2
  const hingeAtA = hingeAtEndA(inp.axis, inp.c, inp.a, inp.b, swing, inp.doors) // hinge on the end nearer a corner (unless the folded leaf would cross another doorway)
  const eSign = hingeAtA ? 1 : -1 // direction along the line from hinge to latch
  const hingeAlong = hingeAtA ? inp.a : inp.b

  // unit vectors in the (x, z) plane
  const e = inp.axis === 'h' ? new THREE.Vector2(eSign, 0) : new THREE.Vector2(0, eSign)
  const n = inp.axis === 'h' ? new THREE.Vector2(0, nSign) : new THREE.Vector2(nSign, 0)
  const dir = e.clone().multiplyScalar(Math.cos(OPEN_ANGLE)).add(n.clone().multiplyScalar(Math.sin(OPEN_ANGLE)))
  const phi = (v: THREE.Vector2) => Math.atan2(-v.y, v.x)
  const phi0 = phi(e)
  let dphi = phi(dir) - phi0
  while (dphi > Math.PI) dphi -= 2 * Math.PI
  while (dphi < -Math.PI) dphi += 2 * Math.PI

  const hx = inp.axis === 'h' ? hingeAlong : inp.c
  const hz = inp.axis === 'h' ? inp.c : hingeAlong
  const color = inp.kind === 'main' ? 0x5b3a1e : swing.room_type === 'bathroom' || swing.room_type === 'toilet' ? 0xb9a58a : 0x9b6b40
  const pivot = new THREE.Group()
  pivot.position.set(hx, lvl, hz)
  const lw = w - 0.08
  const lm = mats ? (inp.kind === 'main' ? mats.main ?? mats.leaf : mats.leaf) : leafMat(color)
  const leaf = new THREE.Mesh(texBox(lm, -lw / 2, lw / 2, -3.425, 3.425, -0.08, 0.08), lm)
  leaf.position.set(lw / 2 + 0.04, 3.45, 0)
  leaf.castShadow = true
  leaf.receiveShadow = true
  pivot.add(leaf)
  if (mats) {
    // raised panels on both faces (a flush slab reads as a plank); they are part of the leaf, so they swing with it
    const pm = lm
    const pw = lw - 1.0, ph1 = 2.7, ph2 = 2.4
    for (const [cy, ph] of [[1.75, ph1], [5.1, ph2]] as Array<[number, number]>) {
      for (const sd of [-1, 1]) {
        const pn = new THREE.Mesh(texBox(pm, -pw / 2, pw / 2, -ph / 2, ph / 2, -0.0125, 0.0125), pm)
        pn.position.set(lw / 2 + 0.04, cy, sd * 0.0925)
        pn.castShadow = false
        pivot.add(pn)
      }
    }
  }
  if (mats?.carved) {
    // carved leaf (Traditional Indian): a moulded border round every panel, a carved boss in the middle, brass studs on the main door.
    // All of it sits on the leaf's faces, so it swings with the door and never changes the opening.
    const { border, brass, grand } = mats.carved
    const pw = lw - 1.0
    const cx = lw / 2 + 0.04
    for (const [cy, ph] of [[1.75, 2.7], [5.1, 2.4]] as Array<[number, number]>) {
      for (const sd of [-1, 1]) {
        const zf = sd * 0.108, th = 0.03
        for (const [bx0, bx1, by0, by1] of [
          [-pw / 2 - 0.1, pw / 2 + 0.1, ph / 2, ph / 2 + 0.1], [-pw / 2 - 0.1, pw / 2 + 0.1, -ph / 2 - 0.1, -ph / 2],
          [-pw / 2 - 0.1, -pw / 2, -ph / 2, ph / 2], [pw / 2, pw / 2 + 0.1, -ph / 2, ph / 2],
        ] as Array<[number, number, number, number]>) {
          const m = new THREE.Mesh(texBox(border, bx0, bx1, by0, by1, -th / 2, th / 2), border)
          m.position.set(cx, cy, zf)
          pivot.add(m)
        }
        const boss = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.04), border)
        boss.rotation.z = Math.PI / 4
        boss.position.set(cx, cy, sd * 0.115)
        pivot.add(boss)
      }
    }
    if (inp.kind === 'main' && grand) {
      // Maharashtrian Wada: a heavy studded entrance leaf: brass-studded iron bands across it and a dense grid of domed studs between them
      for (const sd of [-1, 1]) {
        for (const by of [0.7, 3.45, 6.2]) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.12, 0.2, 0.03), brass)
          band.position.set(cx, by, sd * 0.1)
          pivot.add(band)
        }
        const nx = Math.max(3, Math.round((lw - 0.6) / 0.55))
        for (let i = 0; i < nx; i++) for (let j = 0; j < 12; j++) {
          if (Math.abs(((j + 0.5) / 12) * 6.4 + 0.25 - 3.45) < 0.18 || Math.abs(((j + 0.5) / 12) * 6.4 + 0.25 - 0.7) < 0.18 || Math.abs(((j + 0.5) / 12) * 6.4 + 0.25 - 6.2) < 0.18) continue
          const st = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), brass)
          st.position.set(cx - lw / 2 + 0.3 + (i * (lw - 0.6)) / (nx - 1), 0.25 + ((j + 0.5) / 12) * 6.4, sd * 0.1)
          pivot.add(st)
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 20), brass)
        ring.position.set(cx - lw / 2 + 0.55, 3.45, sd * 0.14)
        pivot.add(ring)
      }
    } else if (inp.kind === 'main') {
      for (const sd of [-1, 1]) {
        for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
          const st = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), brass)
          st.position.set(cx - pw / 2 + 0.3 + (i * (pw - 0.6)) / 2, 0.9 + j * 1.15, sd * 0.098)
          pivot.add(st)
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 8, 18), brass)
        ring.position.set(cx - pw / 2 + 0.25, 3.5, sd * 0.13)
        pivot.add(ring)
      }
    }
  }
  const hm = mats?.handle ?? new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.7, roughness: 0.3 })
  for (const sd of [-1, 1]) {
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 14), hm)
    rose.rotation.x = Math.PI / 2
    rose.position.set(w - 0.4, 3.3, sd * 0.1)
    pivot.add(rose)
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8), hm)
    lever.rotation.z = Math.PI / 2
    lever.position.set(w - 0.58, 3.3, sd * 0.21)
    pivot.add(lever)
  }
  pivot.rotation.y = phi0 + dphi

  // swing arc on the floor (architect-style)
  const arc = new THREE.Group()
  const pts: THREE.Vector3[] = []
  const steps = 18
  const verts: number[] = [hx, lvl + 0.04, hz]
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * OPEN_ANGLE
    const v = e.clone().multiplyScalar(Math.cos(t)).add(n.clone().multiplyScalar(Math.sin(t)))
    const px = hx + v.x * w
    const pz = hz + v.y * w
    pts.push(new THREE.Vector3(px, lvl + 0.05, pz))
    verts.push(px, lvl + 0.04, pz)
  }
  const idx: number[] = []
  for (let i = 1; i <= steps; i++) idx.push(0, i, i + 1)
  const fg = new THREE.BufferGeometry()
  fg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  fg.setIndex(idx)
  arc.add(new THREE.Mesh(fg, arcFill))
  arc.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), arcLine))
  return { pivot, arc, phi0, dphi }
}

/** Which short end the stair is entered from, judged from its doors (the plan keeps all stair doors on one end). */
export function stairEntryHigh(r: RoomR, doors: Array<{ x1?: number; y1?: number; x2?: number; y2?: number; room?: string; connects_to?: string | null }>): boolean {
  if (r.stair && typeof r.stair.entry_high === 'boolean') return r.stair.entry_high // read from the drawing
  const horiz = r.stair?.axis ? r.stair.axis === 'x' : r.x2 - r.x >= r.y2 - r.y
  for (const d of doors) {
    if (!r.id || (d.room !== r.id && d.connects_to !== r.id)) continue
    if (d.x1 === undefined || d.y1 === undefined || d.x2 === undefined || d.y2 === undefined) continue
    if (horiz && Math.abs(d.x1 - d.x2) < 0.01) return Math.abs(d.x1 - r.x2) < Math.abs(d.x1 - r.x)
    if (!horiz && Math.abs(d.y1 - d.y2) < 0.01) return Math.abs(d.y1 - r.y2) < Math.abs(d.y1 - r.y)
  }
  return false
}
