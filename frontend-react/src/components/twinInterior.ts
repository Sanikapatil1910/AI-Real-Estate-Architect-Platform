import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { rugBox, surface, texBox, worldUV } from './twinMaterials'
import { DEFAULT_DESIGN, resolveDesign } from './twinThemes'
import type { Furn } from './twinThemes'
import * as H from './twinHeritage'
import * as WD from './twinWada'

/**
 * Interior of the digital twin: rule-placed furniture and fittings for each room.
 * Pieces are laid out against walls in a small local frame (u along the wall, v out from the wall,
 * h up) so every piece faces into the room whichever wall it is on.  Door swings, door clearances
 * and (for tall pieces) windows are kept clear.  Units: feet.  x = east, z = south, y = up.
 *
 * Positions and sizes never depend on the design theme: the theme only supplies the materials (`F`), so changing it
 * recolours / re-textures the furniture without moving anything.
 */

export interface RoomR {
  id?: string
  room_type: string
  x: number
  y: number
  x2: number
  y2: number
}
export type Wall = 'top' | 'bottom' | 'left' | 'right'
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface WinSeg { wall: Wall; a: number; b: number }
export interface Obstacles {
  doors: Rect[]      // swing / walk-through zones, flush against their wall
  leaves?: Rect[]    // the open leaf of each door that swings into the room (a solid thing the walker has to go round)
  windows: Rect[]    // strip in front of each window (tall pieces keep out)
  winSegs: WinSeg[]  // window openings as seen from this room (for curtains)
  doorSegs?: WinSeg[] // door openings as seen from this room (for wall tiling)
  half?: Record<Wall, number> // half thickness of the wall on each side (outer walls are thicker)
}

const T = 0.45 // inset of furniture from the wall centre line

/* ------------------------------------------------------------- materials & primitives */
/** The materials of the current design; set by `setFurn` (the 3D viewer) or defaulted for the 2D plan. */
let F: Furn = null as unknown as Furn
/** What the kitchen furnishing actually placed, per room (read by the 3D build / tests: a kitchen must really have its fittings). */
export interface KitchenFixtures { room: string; base: number; wall: number; sink: boolean; hob: boolean; fridge: boolean; runs: Array<{ wall: string; len: number }> }
let FIXTURES: KitchenFixtures[] = []
import { registerSeat, seatCount, seatTruncate } from './seatRegistry'
import type { SeatKind } from './seatRegistry'
import { checkRoomAccess, frontOf, routeStrips, anchors } from './twinAccess'
import type { AccessIssue, RoomAccessInput } from './twinAccess'
export function resetFixtures(): void { FIXTURES = []; LAYOUTS = []; ACCESS_LOG = [] }
export function takeFixtures(): KitchenFixtures[] { return FIXTURES }
/** The footprints (plan rectangles) every room's furniture claimed.  They come from the slot system alone, so they are identical in every style and palette. */
let LAYOUTS: Array<{ r: RoomR; placed: Rect[]; ob: Obstacles; reserve: Rect[] }> = []
/** The room layouts of the last build (rooms, their furniture footprints); read by the accessibility validator and the dev tools. */
export function takeLayouts(): Array<{ r: RoomR; placed: Rect[]; doors: Rect[] }> { return LAYOUTS.map((l) => ({ r: l.r, placed: l.placed.slice(), doors: l.ob.doors.slice() })) }
export function takeFootprints(): string {
  const f = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
  return LAYOUTS.map((L) => `${L.r.id ?? L.r.room_type}:${L.placed.map((a) => [a.x0, a.x1, a.z0, a.z1].map(f).join(',')).sort().join('|')}`).join(';')
}

export function setFurn(f: Furn | null): void { if (f) F = f }
const ensure = () => { if (!F) F = resolveDesign(DEFAULT_DESIGN).furn }
const mats = new Map<string, THREE.MeshStandardMaterial>()
const M = (c: number, r = 0.8, glow = 0) => {
  const k = `${c}|${r}|${glow}`
  if (!mats.has(k)) {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: r, emissive: glow ? c : 0x000000, emissiveIntensity: glow })
    m.userData.shared = true
    mats.set(k, m)
  }
  return mats.get(k)!
}
const plain = (c: number | THREE.Material, r: number) => (typeof c === 'number' ? M(c, r) : c)

function bx(g: THREE.Group, c: number | THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r = 0.8) {
  if (x1 - x0 < 0.002 || y1 - y0 < 0.002 || z1 - z0 < 0.002) return
  const mat = plain(c, r)
  const m = new THREE.Mesh(texBox(mat, x0, x1, y0, y1, z0, z1), mat)
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  m.castShadow = true
  m.receiveShadow = true
  g.add(m)
}
function cyl(g: THREE.Group, c: number | THREE.Material, cx: number, cz: number, rad: number, y0: number, y1: number, r = 0.8, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, y1 - y0, seg), plain(c, r))
  m.position.set(cx, (y0 + y1) / 2, cz)
  m.castShadow = true
  m.receiveShadow = true
  g.add(m)
}
function ball(g: THREE.Group, c: number | THREE.Material, cx: number, cy: number, cz: number, rad: number) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 12), plain(c, 0.9))
  m.position.set(cx, cy, cz)
  m.castShadow = true
  g.add(m)
}
void surface

const hit = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad

/* ------------------------------------------------------------------- local frame */
export interface Placed extends Rect { wall: Wall }
export interface Frame {
  W: number
  D: number
  b: (c: number | THREE.Material, u0: number, u1: number, v0: number, v1: number, h0: number, h1: number, r?: number) => void
  s: (c: number | THREE.Material, u0: number, u1: number, v0: number, v1: number, h0: number, h1: number, rad?: number) => void
  cy: (c: number | THREE.Material, u: number, v: number, rad: number, h0: number, h1: number, r?: number, seg?: number) => void
  /** A turned (lathe) piece at (u, v): `prof` = [radius, height] pairs from the bottom up, standing on height `h0`. */
  lathe: (c: number | THREE.Material, u: number, v: number, prof: Array<[number, number]>, seg?: number, h0?: number) => void
  ball: (c: number | THREE.Material, u: number, v: number, h: number, rad: number) => void
  rect: (u0: number, u1: number, v0: number, v1: number) => Rect
  /** records a place to sit (centre u, v; size w along u, d along v; the sitter faces (fu, fv); expected seat height above the floor) for the VR walk-through */
  seat: (kind: SeatKind, u: number, v: number, w: number, d: number, fu: number, fv: number, hint: number) => void
}
function frame(g: THREE.Group, y: number, p: Placed): Frame {
  const horiz = p.wall === 'top' || p.wall === 'bottom'
  const W = horiz ? p.x1 - p.x0 : p.z1 - p.z0
  const D = horiz ? p.z1 - p.z0 : p.x1 - p.x0
  const map = (u: number, v: number): [number, number] =>
    p.wall === 'top' ? [p.x0 + u, p.z0 + v]
      : p.wall === 'bottom' ? [p.x0 + u, p.z1 - v]
        : p.wall === 'left' ? [p.x0 + v, p.z0 + u]
          : [p.x1 - v, p.z0 + u]
  const rect = (u0: number, u1: number, v0: number, v1: number): Rect => {
    const [xa, za] = map(u0, v0)
    const [xb, zb] = map(u1, v1)
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) }
  }
  return {
    W, D, rect,
    seat: (kind, u, v, w, d, fu, fv, hint) => {
      const [cx, cz] = map(u, v)
      const [ax, az] = map(u + fu, v + fv)
      const l = Math.hypot(ax - cx, az - cz) || 1
      registerSeat({ kind, x: cx, z: cz, y, w, d, fx: (ax - cx) / l, fz: (az - cz) / l, hint })
    },
    b: (c, u0, u1, v0, v1, h0, h1, r = 0.8) => { const q = rect(u0, u1, v0, v1); bx(g, c, q.x0, q.x1, y + h0, y + h1, q.z0, q.z1, r) },
    s: (c, u0, u1, v0, v1, h0, h1, rad = 0.12) => { const q = rect(u0, u1, v0, v1); soft(g, c, q.x0, q.x1, y + h0, y + h1, q.z0, q.z1, rad) },
    cy: (c, u, v, rad, h0, h1, r = 0.8, seg = 20) => { const [x, z] = map(u, v); cyl(g, c, x, z, rad, y + h0, y + h1, r, seg) },
    lathe: (c, u, v, prof, seg = 14, h0 = 0) => {
      const [x, z] = map(u, v)
      const mat = plain(c, 0.6)
      const geo = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(Math.max(0.001, r), h)), seg)
      worldUV(geo, mat, x, y + h0, z)
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y + h0, z)
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
    },
    ball: (c, u, v, h, rad) => { const [x, z] = map(u, v); ball(g, c, x, y + h, z, rad) },
  }
}

/* ----------------------------------------------------------------- layout helper */
class Layout {
  placed: Rect[] = []
  /** corridors that must stay free so every doorway (and every piece) can be walked to; treated exactly like a door zone by all the placement code */
  constructor(public r: RoomR, public ob: Obstacles, public reserve: Rect[] = []) {}
  inside(a: Rect, inset = T) {
    const r = this.r
    return a.x0 >= r.x + inset - 0.01 && a.x1 <= r.x2 - inset + 0.01 && a.z0 >= r.y + inset - 0.01 && a.z1 <= r.y2 - inset + 0.01
  }
  doorHit(a: Rect) { return this.ob.doors.some((d) => hit(a, d)) || this.reserve.some((d) => hit(a, d)) }
  free(a: Rect, tall: boolean): boolean {
    if (!this.inside(a)) return false
    if (this.doorHit(a)) return false
    if (tall && this.ob.windows.some((d) => hit(a, d))) return false
    return !this.placed.some((p) => hit(a, p, 0.05))
  }
  rectAt(wall: Wall, s: number, w: number, d: number): Rect {
    const r = this.r
    if (wall === 'top') return { x0: s, x1: s + w, z0: r.y + T, z1: r.y + T + d }
    if (wall === 'bottom') return { x0: s, x1: s + w, z0: r.y2 - T - d, z1: r.y2 - T }
    if (wall === 'left') return { x0: r.x + T, x1: r.x + T + d, z0: s, z1: s + w }
    return { x0: r.x2 - T - d, x1: r.x2 - T, z0: s, z1: s + w }
  }
  len(wall: Wall) { return wall === 'top' || wall === 'bottom' ? this.r.x2 - this.r.x : this.r.y2 - this.r.y }
  /** How much of each wall is taken by door zones / windows. */
  busy(): Record<Wall, { door: number; win: number }> {
    const r = this.r
    const out: Record<Wall, { door: number; win: number }> = { top: { door: 0, win: 0 }, bottom: { door: 0, win: 0 }, left: { door: 0, win: 0 }, right: { door: 0, win: 0 } }
    const add = (list: Rect[], k: 'door' | 'win') => {
      for (const q of list) {
        if (Math.abs(q.z0 - r.y) < 0.05) out.top[k] += q.x1 - q.x0
        else if (Math.abs(q.z1 - r.y2) < 0.05) out.bottom[k] += q.x1 - q.x0
        else if (Math.abs(q.x0 - r.x) < 0.05) out.left[k] += q.z1 - q.z0
        else if (Math.abs(q.x1 - r.x2) < 0.05) out.right[k] += q.z1 - q.z0
      }
    }
    add(this.ob.doors, 'door')
    add(this.ob.windows, 'win')
    return out
  }
  /** Walls ordered best-first: least doors/windows in the way, then longest. */
  walls(opts: { tall?: boolean; skip?: Wall[]; prefer?: Wall[] } = {}): Wall[] {
    const bz = this.busy()
    const all: Wall[] = ['top', 'bottom', 'left', 'right']
    const score = (w: Wall) =>
      bz[w].door * 2.2 + (opts.tall ? bz[w].win * 1.4 : bz[w].win * 0.3) - this.len(w) * 0.55 - (opts.prefer?.includes(w) ? 8 : 0)
    return all.filter((w) => !opts.skip?.includes(w)).sort((p, q) => score(p) - score(q))
  }
  /** Slide a piece along each wall in turn, preferring the middle (or an end). */
  place(w: number, d: number, walls: Wall[], tall = false, from: 'mid' | 'start' | 'end' = 'mid', clear = 0): Placed | null {
    for (const wall of walls) {
      const horiz = wall === 'top' || wall === 'bottom'
      const lo = (horiz ? this.r.x : this.r.y) + T
      const hi = (horiz ? this.r.x2 : this.r.y2) - T
      if (hi - lo < w - 0.01) continue
      const cands: number[] = []
      for (let s = lo; s + w <= hi + 0.01; s += 0.5) cands.push(s)
      const mid = (lo + hi) / 2 - w / 2
      cands.sort((p, q) => (from === 'start' ? p - q : from === 'end' ? q - p : Math.abs(p - mid) - Math.abs(q - mid)))
      for (const s of cands) {
        const a = this.rectAt(wall, s, w, d)
        // `clear` keeps room in front of the piece (a desk chair) off doors and other furniture
        if (this.free(a, tall) && (clear <= 0 || this.free(this.rectAt(wall, s, w, d + clear), false))) {
          this.placed.push(a)
          return { ...a, wall }
        }
      }
    }
    return null
  }
  /** Reserve a free-standing rectangle if it is free. */
  claim(a: Rect, tall = false): boolean {
    if (!this.free(a, tall)) return false
    this.placed.push(a)
    return true
  }
  /** Rectangle in front of a placed piece (not reserved). */
  front(p: Placed, w: number, d: number, gap = 0.8): Rect {
    const cx = (p.x0 + p.x1) / 2
    const cz = (p.z0 + p.z1) / 2
    if (p.wall === 'top') return { x0: cx - w / 2, x1: cx + w / 2, z0: p.z1 + gap, z1: p.z1 + gap + d }
    if (p.wall === 'bottom') return { x0: cx - w / 2, x1: cx + w / 2, z0: p.z0 - gap - d, z1: p.z0 - gap }
    if (p.wall === 'left') return { x0: p.x1 + gap, x1: p.x1 + gap + d, z0: cz - w / 2, z1: cz + w / 2 }
    return { x0: p.x0 - gap - d, x1: p.x0 - gap, z0: cz - w / 2, z1: cz + w / 2 }
  }
  opposite(w: Wall): Wall { return ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as Record<Wall, Wall>)[w] }
  corners(size: number): Rect[] {
    const r = this.r
    const a = r.x + T, b = r.x2 - T, c = r.y + T, d = r.y2 - T
    return [
      { x0: a, x1: a + size, z0: c, z1: c + size }, { x0: b - size, x1: b, z0: c, z1: c + size },
      { x0: a, x1: a + size, z0: d - size, z1: d }, { x0: b - size, x1: b, z0: d - size, z1: d },
    ]
  }
}

/* ------------------------------------------------------------------- shared shapes */
let CEIL_H = 9.7
/** Height of the ceiling above the floor (ft), for things that hang from it; set by the viewer from the plan's floor height. */
export function setCeilingHeight(h: number): void { CEIL_H = Math.max(8, h) }

/** A box with rounded edges (upholstery, pillows, mattresses). */
function soft(g: THREE.Group, c: number | THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rad = 0.12) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0
  if (w < 0.01 || h < 0.01 || d < 0.01) return
  const mat = plain(c, 0.9)
  const geo = new RoundedBoxGeometry(w, h, d, 3, Math.max(0.005, Math.min(rad, w / 2.05, h / 2.05, d / 2.05)))
  worldUV(geo, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  const m = new THREE.Mesh(geo, mat)
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  m.castShadow = true
  m.receiveShadow = true
  g.add(m)
}
/** A cone / tapered cylinder (lamp shades, pots, stools). */
function tcyl(g: THREE.Group, c: number | THREE.Material, cx: number, cz: number, rTop: number, rBot: number, y0: number, y1: number, seg = 24) {
  const mat = plain(c, 0.7)
  const geo = new THREE.CylinderGeometry(rTop, rBot, y1 - y0, seg)
  worldUV(geo, mat, cx, (y0 + y1) / 2, cz)
  const m = new THREE.Mesh(geo, mat)
  m.position.set(cx, (y0 + y1) / 2, cz)
  m.castShadow = true
  m.receiveShadow = true
  g.add(m)
}
/** Decoration that is not part of the plan's furniture (kept out of the 2D drawing). */
function deco(g: THREE.Group | undefined): THREE.Group | undefined {
  if (!g) return undefined
  return g
}
const noPlan = (o: THREE.Object3D) => { o.userData.noPlan = true }

/* ------------------------------------------------------------------- small pieces */
function plant(g: THREE.Group, y: number, a: Rect, tall = 2.2) {
  const cx = (a.x0 + a.x1) / 2, cz = (a.z0 + a.z1) / 2
  const rad = Math.min(a.x1 - a.x0, a.z1 - a.z0) / 2
  tcyl(g, F.pot, cx, cz, rad * 0.66, rad * 0.46, y, y + 1.2)
  cyl(g, 0x3b2a1a, cx, cz, rad * 0.6, y + 1.17, y + 1.21, 1)
  const n = 7
  for (let k = 0; k < n; k++) {
    const ang = k * 2.4
    const r = k === 0 ? 0 : rad * 0.42
    ball(g, k % 2 ? F.leaf : F.leaf2, cx + Math.cos(ang) * r, y + 1.3 + tall * (0.2 + 0.12 * k), cz + Math.sin(ang) * r, rad * (0.62 - 0.035 * k))
  }
}
function lamp(g: THREE.Group, y: number, cx: number, cz: number, h: number, shade = 0.5) {
  const stem = F.heritage ? F.brassM : F.metalDark                                      // heritage: brass lamps
  cyl(g, stem, cx, cz, 0.22, y, y + 0.06, 0.5, 14)
  cyl(g, stem, cx, cz, 0.04, y, y + h, 0.5, 8)
  tcyl(g, F.lampShade, cx, cz, shade * 0.46, shade * 0.62, y + h, y + h + shade * 1.1, 20)
}
function chair(f: Frame, u: number, v: number, out: 1 | -1) {
  f.seat('chair', u, v, 1.4, 1.4, 0, -out, 1.75)
  if (F.heritage) { H.heritageChair(f, F, u, v, out); return }
  f.s(F.chairFab, u - 0.7, u + 0.7, v - 0.7, v + 0.7, 1.4, 1.75, 0.1)
  for (const [du, dv] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]]) f.b(F.woodDark, u + du - 0.06, u + du + 0.06, v + dv - 0.06, v + dv + 0.06, 0, 1.4)
  f.s(F.wood, u - 0.68, u + 0.68, v + out * 0.6 - 0.07, v + out * 0.6 + 0.07, 1.75, 3.2, 0.06)
}

function sofaPiece(f: Frame, w: number, col: THREE.Material, dark: THREE.Material, scatter = true) {
  {
    const n = w > 5 ? 3 : w > 3.3 ? 2 : 1, cw = (w - 1.5) / n
    if (w < 2.4) f.seat('sofa', w / 2, f.D * 0.55, Math.max(1, w - 0.4), Math.max(1, f.D - 1.0), 0, 1, 2.0)             // an armchair / a single peeth
    else for (let i = 0; i < n; i++) f.seat('sofa', 0.75 + (i + 0.5) * cw, (0.85 + f.D - 0.05) / 2, cw, Math.max(1, f.D - 0.9), 0, 1, 2.0)
  }
  if (F.wada) { if (w < 3.4) WD.peeth(f, F, w); else WD.gadi(f, F, w); return }
  if (F.heritage) { H.divan(f, F, w, { scatter }); return }
  const D = f.D
  for (const [u, v] of [[0.25, 0.25], [w - 0.45, 0.25], [0.25, D - 0.45], [w - 0.45, D - 0.45]]) f.b(F.metalDark, u, u + 0.2, v, v + 0.2, 0, 0.4)
  f.s(dark, 0, w, 0.0, D, 0.4, 1.5, 0.14)                                    // base
  f.s(dark, 0, w, 0, 0.95, 1.4, 3.0, 0.3)                                    // back
  f.s(dark, 0, 0.75, 0.15, D, 1.4, 2.5, 0.28)                                // arms
  f.s(dark, w - 0.75, w, 0.15, D, 1.4, 2.5, 0.28)
  const n = w > 5 ? 3 : w > 3.3 ? 2 : 1
  const cw = (w - 1.5) / n
  for (let i = 0; i < n; i++) f.s(col, 0.75 + i * cw + 0.02, 0.75 + (i + 1) * cw - 0.02, 0.85, D - 0.05, 1.45, 2.0, 0.2)   // seat cushions
  for (let i = 0; i < n; i++) f.s(col, 0.8 + i * cw + 0.04, 0.75 + (i + 1) * cw - 0.06, 0.55, 1.25, 2.0, 2.9, 0.3)           // back cushions
  if (scatter && w > 4.5) {
    f.s(F.accentA, 0.95, 1.85, 1.0, 1.55, 2.0, 2.75, 0.24)
    f.s(F.accentB, w - 1.85, w - 0.95, 1.0, 1.55, 2.0, 2.75, 0.24)
    f.s(F.linen, w / 2 - 0.4, w / 2 + 0.4, 1.0, 1.5, 2.0, 2.7, 0.24)
  }
}

/** Wall hung pieces (art, tiles): a box flush with the inner face of a room's wall. */
function onWall(g: THREE.Group | undefined, y: number, r: RoomR, ob: Obstacles, wall: Wall, a0: number, a1: number, h0: number, h1: number, depth: number, c: number | THREE.Material, off = 0.0) {
  if (!g) return
  const half = ob.half?.[wall] ?? 0.2
  const o = half + 0.012 + off
  if (wall === 'top') bx(g, c, a0, a1, y + h0, y + h1, r.y + o, r.y + o + depth)
  else if (wall === 'bottom') bx(g, c, a0, a1, y + h0, y + h1, r.y2 - o - depth, r.y2 - o)
  else if (wall === 'left') bx(g, c, r.x + o, r.x + o + depth, y + h0, y + h1, a0, a1)
  else bx(g, c, r.x2 - o - depth, r.x2 - o, y + h0, y + h1, a0, a1)
}
/** True when [a0,a1] along a wall clears every door and window of that wall. */
function wallClear(ob: Obstacles, wall: Wall, a0: number, a1: number, pad = 0.6): boolean {
  return ![...(ob.winSegs ?? []), ...(ob.doorSegs ?? [])].some((s) => s.wall === wall && s.b + pad > a0 && s.a - pad < a1)
}
/** Framed picture on a wall. */
function art(g: THREE.Group | undefined, y: number, r: RoomR, ob: Obstacles, wall: Wall, mid: number, w: number, h: number, h0: number, kind = 0) {
  if (!g || !wallClear(ob, wall, mid - w / 2, mid + w / 2, 0.3)) return
  const a0 = mid - w / 2, a1 = mid + w / 2
  if (F.heritage && kind === 2) {
    // the focal piece of a traditional sofa wall: a carved wooden mirror with a stepped, arched crest
    const topRoom = (CEIL_H - h0 - h)
    for (const b of H.carvedFrameBoxes(w, h)) {
      if (b.h1 > h + topRoom - 0.4) continue
      onWall(g, y, r, ob, wall, a0 + b.u0, a0 + b.u1, h0 + b.h0, h0 + b.h1, b.d, b.mat === 'mirror' ? F.mirror : b.mat === 'woodDark' ? F.woodDark : F.carved)
    }
    return
  }
  onWall(g, y, r, ob, wall, a0, a1, h0, h0 + h, F.heritage ? 0.18 : 0.12, F.heritage ? F.carved : F.woodDark)
  const m = F.heritage ? 0.2 : 0.14
  onWall(g, y, r, ob, wall, a0 + m, a1 - m, h0 + m, h0 + h - m, 0.05, F.linen, F.heritage ? 0.11 : 0.07)
  const col = [F.accentA, F.accentB, F.leaf, F.metal][kind % 4]
  const iw = (w - 2 * m)
  const po = F.heritage ? 0.16 : 0.115
  onWall(g, y, r, ob, wall, a0 + m + iw * 0.12, a0 + m + iw * 0.55, h0 + m + (h - 2 * m) * 0.2, h0 + m + (h - 2 * m) * 0.8, 0.02, col, po)
  onWall(g, y, r, ob, wall, a0 + m + iw * 0.58, a0 + m + iw * 0.88, h0 + m + (h - 2 * m) * 0.4, h0 + m + (h - 2 * m) * 0.7, 0.02, [F.accentB, F.accentA, F.metal, F.leaf2][kind % 4], po)
}
/** Wall tile up to `h` ft on every wall of the room except across doors, and below / above windows. */
function tileWalls(g: THREE.Group | undefined, y: number, r: RoomR, ob: Obstacles, h: number, mat: THREE.Material, from = 0) {
  if (!g) return
  const walls: Wall[] = ['top', 'bottom', 'left', 'right']
  for (const wall of walls) {
    const horiz = wall === 'top' || wall === 'bottom'
    const lo = (horiz ? r.x : r.y) + (horiz ? (ob.half?.left ?? 0.2) : (ob.half?.top ?? 0.2))
    const hi = (horiz ? r.x2 : r.y2) - (horiz ? (ob.half?.right ?? 0.2) : (ob.half?.bottom ?? 0.2))
    const doors = (ob.doorSegs ?? []).filter((s) => s.wall === wall).sort((p, q) => p.a - q.a)
    const wins = (ob.winSegs ?? []).filter((s) => s.wall === wall).sort((p, q) => p.a - q.a)
    let cur = lo
    const runs: Array<[number, number]> = []
    for (const d of doors) { if (d.a > cur) runs.push([cur, Math.min(d.a, hi)]); cur = Math.max(cur, d.b) }
    if (cur < hi) runs.push([cur, hi])
    for (const [a, b] of runs) {
      let c2 = a
      for (const w of wins) {
        if (w.b <= a || w.a >= b) continue
        const wa = Math.max(w.a, a), wb = Math.min(w.b, b)
        onWall(g, y, r, ob, wall, c2, wa, from, h, 0.04, mat)
        onWall(g, y, r, ob, wall, wa, wb, from, 3, 0.04, mat)                  // below the sill
        if (h > 7) onWall(g, y, r, ob, wall, wa, wb, 7, h, 0.04, mat)           // above the window head
        c2 = wb
      }
      onWall(g, y, r, ob, wall, c2, b, from, h, 0.04, mat)
    }
  }
}
/** Pendant lamp hanging from the ceiling. */
function pendant(g: THREE.Group | undefined, cx: number, cz: number, y: number, drop: number, r = 0.7) {
  if (!g) return
  const top = y + CEIL_H
  if (F.wada) { WD.lantern(g, F.brassM, F.lampShade, cx, top, cz, { chain: Math.max(0.8, drop - 0.6), s: Math.max(1, r * 1.1) }); return }
  const mm = F.heritage ? F.brassM : F.metalDark
  cyl(g, mm, cx, cz, 0.015, top - drop, top, 0.5, 6)
  tcyl(g, mm, cx, cz, r * 0.26, r * 1.0, top - drop - r * 0.5, top - drop, 24)
  tcyl(g, F.lampShade, cx, cz, r * 0.9, r * 0.9, top - drop - r * 0.56, top - drop - r * 0.5, 24)
}

/* ------------------------------------------------------------------- the rooms */
function furnishOnce(g: THREE.Group, r: RoomR, lvl: number, ob: Obstacles, decor: THREE.Group | undefined, ceil: THREE.Group | undefined, reserve: Rect[]): Layout {
  const L = new Layout(r, ob, reserve)
  const W = r.x2 - r.x
  const D = r.y2 - r.y
  const y = lvl
  const area = W * D
  const dg = decor
  const cg = ceil
  const half = (w: Wall) => ob.half?.[w] ?? 0.2

  // free-standing rug, only where nothing blocks the doorway
  const rug = (a: Rect, mat: THREE.Material) => {
    if (!L.inside(a, T + 0.1) || L.doorHit(a)) return
    const w = a.x1 - a.x0, d = a.z1 - a.z0
    const m = new THREE.Mesh(rugBox(mat, w, d, 0.07), mat)
    m.position.set((a.x0 + a.x1) / 2, y + 0.035, (a.z0 + a.z1) / 2)
    m.receiveShadow = true
    g.add(m)
  }
  const curtains = (mat: THREE.Material | null, rod = 7.75) => {
    if (!decor || !mat) return
    for (const s of ob.winSegs) {
      const len = s.b - s.a
      const ext = 0.45
      const wallPos = s.wall === 'top' ? r.y : s.wall === 'bottom' ? r.y2 : s.wall === 'left' ? r.x : r.x2
      const dir = s.wall === 'top' || s.wall === 'left' ? 1 : -1
      const base = half(s.wall) + 0.1
      const horiz = s.wall === 'top' || s.wall === 'bottom'
      const put = (a0: number, a1: number, y0: number, y1: number, c: THREE.Material, d0 = 0, d1 = 0.16) => {
        const v0 = wallPos + dir * (base + d0), v1 = wallPos + dir * (base + d1)
        const lo = Math.min(v0, v1), hi = Math.max(v0, v1)
        if (horiz) bx(decor, c, a0, a1, y + y0, y + y1, lo, hi, 0.95)
        else bx(decor, c, lo, hi, y + y0, y + y1, a0, a1, 0.95)
      }
      put(s.a - ext - 0.15, s.b + ext + 0.15, rod, rod + 0.08, F.metal, 0.12, 0.2)                    // rod
      for (const e of [s.a - ext - 0.2, s.b + ext + 0.12]) put(e, e + 0.08, rod - 0.04, rod + 0.12, F.metal, 0.1, 0.22)
      const pw = Math.min(1.7, len * 0.42 + ext)
      const fold = (a0: number, a1: number) => {
        const n = Math.max(2, Math.round((a1 - a0) / 0.28))
        const wd = (a1 - a0) / n
        for (let i = 0; i < n; i++) put(a0 + i * wd, a0 + (i + 1) * wd, 0.1, rod - 0.05, mat, i % 2 ? 0.2 : 0.02, i % 2 ? 0.32 : 0.16)
      }
      fold(s.a - ext, s.a - ext + pw)
      fold(s.b + ext - pw, s.b + ext)
    }
  }
  const lampBase = (cx: number, cz: number, hy: number, sh: number) => lamp(g, y + hy, cx, cz, 0.55, sh)

  switch (r.room_type) {
    case 'master_bedroom':
    case 'bedroom':
    case 'guest_bedroom': {
      const master = r.room_type === 'master_bedroom'
      const bw = master ? 6 : 5
      const bl = master ? 6.8 : 6.4
      const walls = L.walls({ tall: true })
      let bed = L.place(bw + 3.2, bl, walls, false) // with a bedside table each side
      let off = 1.6
      if (!bed) { bed = L.place(bw + 1.6, bl, walls, false); off = 0.1 }
      if (!bed) { bed = L.place(bw, bl, walls, false); off = 0 }
      if (!bed) { bed = L.place(4.2, 6.2, walls, false); off = 0 }
      if (!bed) { bed = L.place(3.4, 6.2, walls, false); off = 0 }   // single bed in a narrow room
      if (!bed) { bed = L.place(3.0, 6.0, walls, false); off = 0 }   // 3 ft single bed
      if (bed) {
        const f = frame(g, y, bed)
        const bwEff = Math.min(bw, f.W - off * (off > 0.2 ? 2 : off))
        const u0 = off, u1 = off + bwEff
        const mEnd = F.heritage ? bl - 0.45 : bl                                  // a carved footboard closes the heritage bed
        if (F.heritage) H.bedFrame(f, F, u0, u1, bl)
        else {
          for (const [uu, vv] of [[u0 + 0.1, 0.4], [u1 - 0.4, 0.4], [u0 + 0.1, bl - 0.5], [u1 - 0.4, bl - 0.5]]) f.b(F.woodDark, uu, uu + 0.3, vv, vv + 0.3, 0, 0.5)
          f.b(F.wood, u0, u1, 0.1, bl, 0.5, 1.2)                                   // frame
          f.b(F.woodDark, u0 - 0.05, u1 + 0.05, 0, 0.35, 0, 3.7)                   // headboard frame
          f.s(F.headboard, u0 + 0.12, u1 - 0.12, 0.35, 0.65, 1.2, 3.55, 0.12)      // upholstered panel
        }
        f.s(F.linen, u0 + 0.08, u1 - 0.08, 0.55, mEnd - 0.05, 1.2, 1.9, 0.16)    // mattress
        f.seat('bed', (u0 + u1) / 2, mEnd - 1.0, Math.max(1.5, bwEff - 0.6), 1.6, 0, 1, 1.9)   // the foot of the bed, facing the room
        const np = master ? 3 : 2
        const pwid = (bwEff - 0.5) / np
        for (let i = 0; i < np; i++) f.s(F.linen, u0 + 0.25 + i * pwid + 0.04, u0 + 0.25 + (i + 1) * pwid - 0.04, 0.7, 1.6, 1.9, 2.5, 0.2)
        f.s(F.accentA, u0 + bwEff / 2 - 0.8, u0 + bwEff / 2 + 0.8, 1.7, 2.2, 1.9, 2.5, 0.2)   // front pillow
        f.s(master ? F.duvet : F.duvet2, u0 + 0.02, u1 - 0.02, 2.4, mEnd + 0.02, 1.85, 2.2, 0.17)    // duvet
        f.s(F.throwM, u0 + 0.02, u1 - 0.02, mEnd - 1.9, mEnd - 1.2, 2.2, 2.34, 0.08)                 // folded throw
        if (off > 0.2) {
          for (const side of [0, 1]) {
            const a = side === 0 ? 0.1 : off + bwEff + 0.1
            if (F.heritage) H.nightstand(f, F, a)
            else {
              f.b(F.wood, a, a + 1.3, 0.1, 1.4, 0, 1.7)
              f.b(F.woodDark, a + 0.1, a + 1.2, 1.4, 1.42, 0.3, 1.5)
            }
            const [lu, lv] = [a + 0.65, 0.7]
            const q = f.rect(lu - 0.1, lu + 0.1, lv - 0.1, lv + 0.1)
            lamp(g, y + 1.7, (q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2, 0.5, 0.5)
          }
        }
        // rug under the bed
        const rr = f.rect(u0 - 1.2, u1 + 1.2, 1.5, bl + 2.0)
        rug(rr, master ? F.rug : F.rugAlt)
        if (master) {
          const bench = f.rect(u0 + 0.6, u1 - 0.6, bl + 0.2, bl + 1.3)
          if (L.claim(bench)) {
            f.seat('bench', (u0 + u1) / 2, bl + 0.75, Math.max(1.2, u1 - u0 - 1.4), 0.9, 0, 1, 1.45)
            if (F.heritage) { f.b(F.carved, u0 + 0.6, u1 - 0.6, bl + 0.2, bl + 1.3, 0.9, 1.05); f.s(F.bench, u0 + 0.65, u1 - 0.65, bl + 0.25, bl + 1.25, 1.05, 1.45, 0.12); for (const uu of [u0 + 0.8, u1 - 0.8]) for (const vv of [bl + 0.4, bl + 1.1]) f.lathe(F.woodDark, uu, vv, H.turned(0.9, 0.1)) }
            else f.s(F.bench, u0 + 0.6, u1 - 0.6, bl + 0.2, bl + 1.3, 0.4, 1.4, 0.12)
          }
        }
        // pictures above the bed
        const mid = bed.wall === 'top' || bed.wall === 'bottom' ? (bed.x0 + bed.x1) / 2 : (bed.z0 + bed.z1) / 2
        void mid
        if (dg) {
          const uMid = off + bwEff / 2
          const q = f.rect(uMid, uMid, 0, 0)
          const along = bed.wall === 'top' || bed.wall === 'bottom' ? q.x0 : q.z0
          art(dg, y, r, ob, bed.wall, along - 1.25, 1.6, 2.0, 4.4, 0)
          art(dg, y, r, ob, bed.wall, along + 1.25, 1.6, 2.0, 4.4, 1)
        }
      }
      // wardrobe: ideally on a wall without door or window
      const wardW = master ? 7 : 5.5
      const wr = L.place(wardW, 2.1, L.walls({ tall: true }), true) ?? L.place(4.5, 2.1, L.walls({ tall: true }), true) ?? L.place(3.5, 2.1, L.walls(), true)
      if (wr) {
        const f = frame(g, y, wr)
        if (F.heritage) H.wardrobe(f, F)
        else {
          f.b(F.wood, 0, f.W, 0, f.D, 0, 7.4)
          const n = Math.max(2, Math.round(f.W / 2.4))
          for (let i = 1; i < n; i++) {
            const u = (f.W * i) / n
            f.b(F.woodDark, u - 0.025, u + 0.025, f.D - 0.04, f.D + 0.02, 0.2, 7.2)
            f.b(F.metal, u - 0.22, u - 0.17, f.D, f.D + 0.12, 3.2, 4.4)
            f.b(F.metal, u + 0.17, u + 0.22, f.D, f.D + 0.12, 3.2, 4.4)
          }
          f.b(F.woodDark, 0, f.W, f.D - 0.04, f.D + 0.02, 0.1, 0.25)
        }
      }
      if (area >= 130 || master) {
        const dw = L.place(master ? 4.2 : 3.6, 1.6, L.walls({ tall: false }), false)
        if (dw) {
          const f = frame(g, y, dw)
          if (F.heritage) H.dresser(f, F)
          else {
            f.b(F.wood, 0, f.W, 0, f.D, 0, 2.6)
            for (let i = 1; i < 3; i++) f.b(F.woodDark, (f.W * i) / 3 - 0.02, (f.W * i) / 3 + 0.02, f.D - 0.03, f.D + 0.01, 0.2, 2.4)
            for (let i = 0; i < 3; i++) f.b(F.metal, (f.W * (i + 0.5)) / 3 - 0.2, (f.W * (i + 0.5)) / 3 + 0.2, f.D, f.D + 0.06, 1.4, 1.5)
            f.b(F.mirror, 0.4, f.W - 0.4, 0.05, 0.12, 3.0, 6.6)
            f.b(F.woodDark, 0.35, f.W - 0.35, 0.02, 0.16, 6.6, 6.75)
            f.b(F.woodDark, 0.35, f.W - 0.35, 0.02, 0.16, 2.95, 3.05)
          }
        }
      }
      if (area >= 150) {
        const desk = L.place(4, 1.9, L.walls({ tall: false }), false, 'end', 2.2)
        if (desk) {
          const f = frame(g, y, desk)
          f.b(F.wood, 0, f.W, 0, f.D, 2.3, 2.5)
          f.b(F.woodDark, 0, 0.25, 0.1, f.D - 0.1, 0, 2.3)
          f.b(F.woodDark, f.W - 0.25, f.W, 0.1, f.D - 0.1, 0, 2.3)
          f.b(0x20262c, f.W / 2 - 0.7, f.W / 2 + 0.7, 0.5, 1.2, 2.5, 2.58)  // laptop base
          f.b(0x20262c, f.W / 2 - 0.7, f.W / 2 + 0.7, 0.5, 0.58, 2.58, 3.4)
          chair(f, f.W / 2, f.D + 1.1, 1)
          L.placed.push(f.rect(f.W / 2 - 0.9, f.W / 2 + 0.9, f.D, f.D + 2))
        }
      }
      if (master && area >= 210) {
        const rc = L.corners(2.6).find((c) => L.free(c, false))
        if (rc) { L.placed.push(rc); const cx = (rc.x0 + rc.x1) / 2, cz = (rc.z0 + rc.z1) / 2; soft(g, F.corner, cx - 1.2, cx + 1.2, y + 0.4, y + 1.7, cz - 1.2, cz + 1.2, 0.3); soft(g, F.corner, cx - 1.2, cx + 1.2, y + 1.7, y + 3.0, cz - 1.2, cz - 0.7, 0.2) }
      }
      curtains(F.curtain)
      break
    }

    case 'living_room':
    case 'family_lounge': {
      const sw = Math.min(8, Math.max(5.5, W - 3))
      let sofa: Placed | null = null
      let swEff = sw
      for (const w of [sw, 7, 6.5, 6, 5.5, 5, 4.5]) { if (w > sw + 0.01) continue; sofa = L.place(w, 3.1, L.walls({ skip: [] }), false); if (sofa) { swEff = w; break } }
      if (sofa) {
        const f = frame(g, y, sofa)
        sofaPiece(f, f.W, F.sofa, F.sofaDark)
        for (const u of [-0.9, f.W + 0.3]) {
          f.b(F.wood, u, u + 0.6, 0.4, 1.4, 0, 1.6); f.b(F.woodDark, u - 0.02, u + 0.62, 0.35, 1.45, 1.6, 1.7)
          const q = f.rect(u + 0.3, u + 0.3, 0.9, 0.9)
          lamp(g, y + 1.7, q.x0, q.z0, 0.5, 0.5)
        }
        const ct = L.front(sofa, 3.6, 2, 1.2)
        const ctOk = L.claim(ct)
        if (ctOk && F.wada) {
          WD.chowki(frame(g, y, { ...ct, wall: 'top' }), F)
        } else if (ctOk && F.heritage) {
          H.coffeeTable(frame(g, y, { ...ct, wall: 'top' }), F)
        } else if (ctOk) {
          const cx = (ct.x0 + ct.x1) / 2, cz = (ct.z0 + ct.z1) / 2
          bx(g, F.wood, ct.x0, ct.x1, y + 1.2, y + 1.4, ct.z0, ct.z1)
          bx(g, F.glass, ct.x0 + 0.1, ct.x1 - 0.1, y + 1.4, y + 1.45, ct.z0 + 0.1, ct.z1 - 0.1)
          for (const [px, pz] of [[ct.x0 + 0.1, ct.z0 + 0.1], [ct.x1 - 0.2, ct.z0 + 0.1], [ct.x0 + 0.1, ct.z1 - 0.2], [ct.x1 - 0.2, ct.z1 - 0.2]]) bx(g, F.woodDark, px, px + 0.1, y, y + 1.2, pz, pz + 0.1)
          bx(g, F.accentA, cx - 0.9, cx - 0.1, y + 1.45, y + 1.55, cz - 0.4, cz + 0.2)    // books
          bx(g, F.linen, cx - 0.85, cx - 0.15, y + 1.55, y + 1.62, cz - 0.35, cz + 0.15)
          tcyl(g, F.pot, cx + 0.8, cz, 0.28, 0.2, y + 1.45, y + 1.85, 16)                 // vase
          ball(g, F.leaf, cx + 0.8, y + 2.15, cz, 0.3)
        }
        rug(L.front(sofa, Math.min(swEff - 1, 7.5), 5.4, 0.3), F.rug)
        // TV unit on the opposite wall
        const tvWalls = [L.opposite(sofa.wall), ...L.walls({ tall: true, skip: [sofa.wall, L.opposite(sofa.wall)] })]
        let tv: Placed | null = null
        for (const tw of [6.5, 5.5, 4.5, 3.8]) { tv = L.place(Math.min(tw, W - 2.5), 1.6, tvWalls, true); if (tv) break }
        if (tv) {
          const f = frame(g, y, tv)
          f.b(F.woodDark, 0, f.W, 0, f.D, 0.3, 1.9)
          f.b(F.metalDark, 0.1, f.W - 0.1, 0.1, f.D - 0.1, 0, 0.3)
          for (let i = 1; i < 3; i++) f.b(F.metalDark, (f.W * i) / 3 - 0.02, (f.W * i) / 3 + 0.02, f.D - 0.03, f.D + 0.01, 0.4, 1.8)
          for (let i = 0; i < 3; i++) f.b(F.metal, (f.W * (i + 0.5)) / 3 - 0.2, (f.W * (i + 0.5)) / 3 + 0.2, f.D, f.D + 0.05, 1.5, 1.58)
          const tw = Math.min(f.W - 1, 5)
          f.b(F.tv, f.W / 2 - tw / 2, f.W / 2 + tw / 2, 0.25, 0.4, 2.6, 2.6 + tw * 0.5)
          f.b(F.tvScreen, f.W / 2 - tw / 2 + 0.08, f.W / 2 + tw / 2 - 0.08, 0.4, 0.43, 2.68, 2.52 + tw * 0.5)
          f.b(F.tv, f.W / 2 - 0.3, f.W / 2 + 0.3, 0.3, 0.7, 1.9, 2.6)
        }
        // armchairs at the sides
        if (area > 150) {
          for (const side of walls2(L, sofa.wall)) {
            const ar = L.place(2.7, 2.7, [side], false, 'mid')
            if (ar) { const f = frame(g, y, ar); sofaPiece(f, f.W, F.chairFab, F.chairFabDark, false) }
          }
        }
        const lc = L.corners(1.4).find((c) => L.free(c, false))
        if (lc) { L.placed.push(lc); lamp(g, y, (lc.x0 + lc.x1) / 2, (lc.z0 + lc.z1) / 2, 4.9, 0.95) }
        if (dg) {
          const along = sofa.wall === 'top' || sofa.wall === 'bottom' ? (sofa.x0 + sofa.x1) / 2 : (sofa.z0 + sofa.z1) / 2
          art(dg, y, r, ob, sofa.wall, along, Math.min(4.4, sofa.wall === 'top' || sofa.wall === 'bottom' ? sofa.x1 - sofa.x0 - 1 : sofa.z1 - sofa.z0 - 1), 2.4, 4.6, 2)
        }
      }
      const pc = L.corners(1.5).find((c) => L.free(c, false))
      if (pc) { L.placed.push(pc); plant(g, y, pc, 2.6) }
      if (F.wada && cg && area >= 140) {
        // a jhula (swing) on a free stretch of wall, hung from the ceiling.  It is decoration: it takes only space that is still free
        // (and is not reserved), so the furniture slots, their clearances and the layout signature are the same as in every other style
        for (const wall of L.walls({ tall: true })) {
          let put = false
          for (let s0 = (wall === 'top' || wall === 'bottom' ? r.x : r.y) + T + 0.5; s0 + 5.2 <= (wall === 'top' || wall === 'bottom' ? r.x2 : r.y2) - T - 0.5 && !put; s0 += 0.5) {
            const a = L.rectAt(wall, s0, 5.2, 2.6)
            const clear = L.rectAt(wall, s0 - 0.3, 5.8, 5.4)
            if (L.free(a, true) && L.free(clear, false)) { WD.jhula(frame(cg, y, { ...a, wall }), F, 5.2, CEIL_H); put = true }
          }
          if (put) break
        }
      }
      if (cg && area > 90) pendant(cg, (r.x + r.x2) / 2, (r.y + r.y2) / 2, y, 1.6, 0.9)
      curtains(F.curtain)
      break
    }

    case 'dining': {
      const horiz = W >= D
      const cx = (r.x + r.x2) / 2, cz = (r.y + r.y2) / 2
      const long0 = Math.min(7, Math.max(4, Math.max(W, D) - 5.5))
      const round = Math.max(W, D) / Math.max(1, Math.min(W, D)) < 1.3 && Math.min(W, D) >= 9
      // the table plus a chair zone must stay clear of doors; try the centre, then nearby spots, then smaller tables
      const spots: Array<[number, number]> = [[0, 0]]
      for (const d of [0.5, 1, 1.5, 2, 2.5, 3]) spots.push([d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d])
      let table: Rect | null = null
      let tw = 0, td = 0
      const sizes: Array<[number, number]> = round ? [[3.6, 3.6]] : [[long0, 3.3], [Math.max(4, long0 - 1), 3.1], [4, 3], [3.4, 3]]
      for (const [lg, sh] of sizes) {
        tw = horiz ? lg : sh
        td = horiz ? sh : lg
        if (round) { tw = lg; td = sh }
        for (const [dx, dz] of spots) {
          const a: Rect = { x0: cx + dx - tw / 2, x1: cx + dx + tw / 2, z0: cz + dz - td / 2, z1: cz + dz + td / 2 }
          const zone: Rect = { x0: a.x0 - 1.0, x1: a.x1 + 1.0, z0: a.z0 - 1.0, z1: a.z1 + 1.0 }
          const ok = L.inside({ x0: a.x0 - 0.7, x1: a.x1 + 0.7, z0: a.z0 - 0.7, z1: a.z1 + 0.7 }, T) && !L.doorHit(zone) && !L.placed.some((p) => hit(a, p))
          if (ok) { table = a; L.placed.push(zone); break }
        }
        if (table) break
      }
      if (table) {
        const tcx = (table.x0 + table.x1) / 2, tcz = (table.z0 + table.z1) / 2
        if (round) {
          const rad = (table.x1 - table.x0) / 2 - 0.15
          const top = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.2, 40), F.wood)
          worldUV(top.geometry, F.wood, tcx, y + 2.35, tcz)
          top.position.set(tcx, y + 2.35, tcz); top.castShadow = true; top.receiveShadow = true; g.add(top)
          cyl(g, F.woodDark, tcx, tcz, 0.14, y, y + 2.25, 0.6, 14)
          cyl(g, F.woodDark, tcx, tcz, 0.7, y, y + 0.1, 0.6, 24)
          for (let k = 0; k < 4; k++) {
            const ang = k * Math.PI / 2 + Math.PI / 4
            const px = tcx + Math.cos(ang) * (rad + 0.45), pz = tcz + Math.sin(ang) * (rad + 0.45)
            registerSeat({ kind: 'chair', x: px, z: pz, y, w: 1.4, d: 1.4, fx: -Math.cos(ang), fz: -Math.sin(ang), hint: 1.75 })
            soft(g, F.chairFab, px - 0.7, px + 0.7, y + 1.4, y + 1.75, pz - 0.7, pz + 0.7, 0.1)
            for (const [du, dv] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) bx(g, F.woodDark, px + du - 0.06, px + du + 0.06, y, y + 1.4, pz + dv - 0.06, pz + dv + 0.06)
            const bxOff = Math.cos(ang) * 0.62, bzOff = Math.sin(ang) * 0.62
            soft(g, F.wood, px + bxOff - (Math.abs(bxOff) > 0.3 ? 0.07 : 0.62), px + bxOff + (Math.abs(bxOff) > 0.3 ? 0.07 : 0.62), y + 1.75, y + 3.2, pz + bzOff - (Math.abs(bzOff) > 0.3 ? 0.07 : 0.62), pz + bzOff + (Math.abs(bzOff) > 0.3 ? 0.07 : 0.62), 0.06)
          }
          tcyl(g, F.upper, tcx, tcz, 0.45, 0.35, y + 2.45, y + 2.7, 20)                 // bowl
          for (let k = 0; k < 4; k++) ball(g, [F.accentA, F.leaf2, F.accentB, F.leaf][k], tcx + Math.cos(k * 1.6) * 0.18, y + 2.82, tcz + Math.sin(k * 1.6) * 0.18, 0.17)
          rug({ x0: tcx - 4, x1: tcx + 4, z0: tcz - 4, z1: tcz + 4 }, F.rug)
          pendant(cg, tcx, tcz, y, 3.2, 0.8)
        } else {
          const f = frame(g, y, { ...table, wall: horiz ? 'top' : 'left' })
          f.b(F.wood, 0, f.W, 0, f.D, 2.2, 2.45)
          if (F.heritage) H.tableLegs(f, F)
          else {
            f.b(F.woodDark, 0.15, f.W - 0.15, 0.15, f.D - 0.15, 2.0, 2.2)
            for (const [uu, vv] of [[0.25, 0.25], [f.W - 0.45, 0.25], [0.25, f.D - 0.45], [f.W - 0.45, f.D - 0.45]]) f.b(F.woodDark, uu, uu + 0.2, vv, vv + 0.2, 0, 2.2)
          }
          const nch = Math.max(2, Math.round(f.W / 2.1))
          for (let i = 0; i < nch; i++) {
            const u = (f.W * (i + 0.5)) / nch
            chair(f, u, -0.55, -1)
            chair(f, u, f.D + 0.55, 1)
          }
          // table runner, plates and a centrepiece
          f.b(F.accentA, 0.3, f.W - 0.3, f.D / 2 - 0.3, f.D / 2 + 0.3, 2.45, 2.48)
          for (let i = 0; i < nch; i++) {
            const u = (f.W * (i + 0.5)) / nch
            f.cy(F.white, u, 0.65, 0.4, 2.45, 2.5, 0.3)
            f.cy(F.white, u, f.D - 0.65, 0.4, 2.45, 2.5, 0.3)
          }
          f.cy(F.pot, f.W / 2, f.D / 2, 0.28, 2.48, 3.1, 0.5)
          f.ball(F.leaf, f.W / 2, f.D / 2, 3.45, 0.38)
          rug({ x0: table.x0 - 1.8, x1: table.x1 + 1.8, z0: table.z0 - 1.8, z1: table.z1 + 1.8 }, F.rugAlt)
          pendant(cg, tcx, tcz, y, 3.0, 0.7)
        }
      }
      const sb = L.place(Math.min(5, Math.max(W, D) - 3), 1.5, L.walls({ tall: true }), true)
      if (sb) {
        const f = frame(g, y, sb)
        if (F.heritage) H.sideboard(f, F)
        else {
          f.b(F.woodDark, 0, f.W, 0, f.D, 0, 3)
          for (let i = 1; i < 3; i++) f.b(F.metalDark, (f.W * i) / 3 - 0.02, (f.W * i) / 3 + 0.02, f.D - 0.03, f.D + 0.01, 0.2, 2.8)
          f.b(F.accentA, 0.5, 1.5, 0.3, 1.1, 3, 3.5, 0.5)
          f.cy(F.pot, f.W - 0.8, 0.7, 0.25, 3, 3.9, 0.4)
        }
        if (dg) {
          const along = sb.wall === 'top' || sb.wall === 'bottom' ? (sb.x0 + sb.x1) / 2 : (sb.z0 + sb.z1) / 2
          art(dg, y, r, ob, sb.wall, along, 2.6, 2.2, 4.8, 3)
        }
      }
      curtains(F.curtain)
      break
    }

    case 'kitchen': {
      const fx: KitchenFixtures = { room: r.id ?? 'kitchen', base: 0, wall: 0, sink: false, hob: false, fridge: false, runs: [] }
      FIXTURES.push(fx)
      const run = (p: Placed, hob: boolean, sink: boolean) => {
        const f = frame(g, y, p)
        fx.base++
        fx.runs.push({ wall: p.wall, len: Math.round(f.W * 10) / 10 })
        // sink and hob keep clear of each other and of the run ends, however short the run is
        const uSink = Math.max(1.0, f.W * 0.32)
        const uHob = Math.min(f.W - 1.05, Math.max(f.W * 0.68, uSink + 2.0))
        f.b(F.metalDark, 0.05, f.W - 0.05, 0.05, f.D - 0.2, 0, 0.3)                // plinth
        f.b(F.cabinet, 0, f.W, 0, f.D, 0.3, 2.9, 0.7)
        const n = Math.max(2, Math.round(f.W / 1.6))
        for (let i = 1; i < n; i++) f.b(F.metalDark, (f.W * i) / n - 0.015, (f.W * i) / n + 0.015, f.D - 0.03, f.D + 0.012, 0.4, 2.8)
        for (let i = 0; i < n; i++) f.b(F.hardware, (f.W * (i + 0.5)) / n - 0.3, (f.W * (i + 0.5)) / n + 0.3, f.D, f.D + 0.08, 2.5, 2.58)
        f.b(F.counter, -0.02, f.W + 0.02, 0, f.D + 0.2, 2.9, 3.12, 0.35)             // worktop
        if (sink) {
          const u = uSink
          fx.sink = true
          f.b(F.steel, u - 0.9, u + 0.9, 0.35, f.D - 0.15, 3.1, 3.14, 0.25)
          f.b(F.steelDark, u - 0.8, u - 0.1, 0.45, f.D - 0.25, 3.14, 3.16, 0.25)
          f.b(F.steelDark, u + 0.1, u + 0.8, 0.45, f.D - 0.25, 3.14, 3.16, 0.25)
          f.cy(F.chrome, u, 0.2, 0.06, 3.1, 4.0, 0.2)
          f.b(F.chrome, u - 0.04, u + 0.04, 0.2, 0.8, 3.9, 4.0, 0.2)
        }
        if (hob) {
          const u = uHob
          fx.hob = true
          f.b(F.tvScreen, u - 1.0, u + 1.0, 0.25, f.D - 0.25, 3.12, 3.18, 0.3)
          for (const [du, dv] of [[-0.45, 0.6], [0.45, 0.6], [-0.45, 1.3], [0.45, 1.3]]) f.cy(F.steelDark, u + du, dv, 0.22, 3.18, 3.22, 0.3)
          if (!ob.windows.some((w) => hit(f.rect(u - 1.4, u + 1.4, 0, 1.6), w))) {
            f.b(F.steel, u - 1.2, u + 1.2, 0, 1.7, 5.9, 6.5, 0.3)             // chimney hood
            f.b(F.steel, u - 0.4, u + 0.4, 0, 0.8, 6.5, 8.6, 0.3)
          }
        }
        // wall cabinets
        const wallCab = f.rect(0, f.W, 0, 1.2)
        {
          // wall units fill the stretches of the run that are clear of the chimney hood
          const stretches: Array<[number, number]> = hob ? [[0, uHob - 1.2], [uHob + 1.2, f.W]] : [[0, f.W]]
          for (const [s0, s1] of stretches) {
            if (s1 - s0 < 1.0) continue
            const nn = Math.max(1, Math.round((s1 - s0) / 1.8))
            for (let i = 0; i < nn; i++) {
              const a = s0 + ((s1 - s0) * i) / nn, b2 = s0 + ((s1 - s0) * (i + 1)) / nn
              if (ob.windows.some((w) => hit(f.rect(a, b2, 0, 1.2), w))) continue          // a unit never hides a window: the stretch under it stays open
              fx.wall++
              f.b(F.upper, a + 0.02, b2 - 0.02, 0, 1.2, 5.4, 7.3, 0.7)
              f.b(F.hardware, (a + b2) / 2 - 0.25, (a + b2) / 2 + 0.25, 1.2, 1.28, 5.5, 5.58, 0.3)
            }
          }
        }
        // splash-back tile between the worktop and the wall cabinets
        if (dg && !ob.windows.some((w) => hit(wallCab, w))) {
          const horizW = p.wall === 'top' || p.wall === 'bottom'
          onWall(dg, y, r, ob, p.wall, horizW ? p.x0 : p.z0, horizW ? p.x1 : p.z1, 3.12, 5.4, 0.04, F.tile)
        }
      }
      // The fridge (a tall piece) and the counter run share the room.  The run goes on a wall without a window (wall units and the splash-back
      // need a clear wall), so the fridge is tried on each wall / end in turn until the run still gets a clean wall; if none does, the fridge
      // goes first and the run takes the longest clear length that is left.
      const w1 = L.walls({ tall: false })
      const bz1 = L.busy()
      const clean = w1.filter((q) => bz1[q].win === 0)
      const FRIDGES: Array<[number, number]> = [[2.7, 2.6], [2.5, 2.4], [2.3, 2.3]]
      const cleanRun = (): Placed | null => {
        if (!clean.length) return null
        const top = Math.min(Math.max(...clean.map((q) => L.len(q))) - 2.2, 10.5)
        for (const from of ['mid', 'start', 'end'] as const) {
          for (let len = top; len >= 4.4; len -= 0.8) { const r0 = L.place(len, 2.1, clean, false, from); if (r0) return r0 }
        }
        return null
      }
      let fr: Placed | null = null
      let run1: Placed | null = null
      const mark = L.placed.length
      search: for (const [fw, fd] of FRIDGES) {
        for (const wall of L.walls({ tall: true })) {
          for (const from of ['end', 'start', 'mid'] as const) {
            const cand = L.place(fw, fd, [wall], true, from)
            if (!cand) continue
            const r0 = cleanRun()
            if (r0) { fr = cand; run1 = r0; break search }
            L.placed.length = mark                      // this fridge position leaves no clean wall for the run: take it back
          }
        }
      }
      if (!fr) {
        for (const [fw, fd] of FRIDGES) {
          for (const from of ['end', 'start', 'mid'] as const) { if (!fr) fr = L.place(fw, fd, L.walls({ tall: true }), true, from) }
          if (fr) break
        }
        for (const from of ['mid', 'start', 'end'] as const) {
          for (let len = Math.min(Math.max(...w1.map((q) => L.len(q))) - 2.2, 10.5); len >= 4.4 && !run1; len -= 0.8) run1 = L.place(len, 2.1, w1, false, from)
          if (run1) break
        }
      }
      if (run1) {
        run(run1, true, true)
        const rest = L.walls({ skip: [run1.wall, L.opposite(run1.wall)] })
        const run2 = L.place(Math.min(L.len(rest[0] ?? run1.wall) - 2.5, 7), 2.1, rest.length ? rest : L.walls({ skip: [run1.wall] }), false, 'start')
        if (run2) run(run2, false, false)
      }
      if (fr) {
        fx.fridge = true
        const f = frame(g, y, fr)
        f.b(F.steel, 0, f.W, 0, f.D - 0.1, 0.2, 6.2, 0.3)
        f.b(F.steelDark, 0, f.W, f.D - 0.1, f.D, 0.2, 6.2, 0.3)
        f.b(F.steelDark, 0, f.W, f.D - 0.12, f.D + 0.02, 3.6, 3.66, 0.3)
        f.b(F.steelDark, 0.2, 0.3, f.D, f.D + 0.12, 3.9, 5.4, 0.3)
        f.b(F.steelDark, 0.2, 0.3, f.D, f.D + 0.12, 1.0, 2.6, 0.3)
      }
      // island with stools (as in a larger open kitchen), only where there is room to walk round it
      if (W >= 11 && D >= 11 && run1) {
        const alongX = W >= D
        const iw = alongX ? 5.5 : 2.6, id = alongX ? 2.6 : 5.5
        let best: Rect | null = null
        for (let dx = -3; dx <= 3 && !best; dx += 0.5) {
          for (let dz = -3; dz <= 3 && !best; dz += 0.5) {
            const c: Rect = { x0: (r.x + r.x2) / 2 + dx - iw / 2, x1: (r.x + r.x2) / 2 + dx + iw / 2, z0: (r.y + r.y2) / 2 + dz - id / 2, z1: (r.y + r.y2) / 2 + dz + id / 2 }
            const zone: Rect = { x0: c.x0 - 2.7, x1: c.x1 + 2.7, z0: c.z0 - 2.7, z1: c.z1 + 2.7 }
            if (L.inside(zone, 0.2) && !L.doorHit(zone) && !L.placed.some((p) => hit(zone, p))) best = c
          }
        }
        if (best) {
          L.placed.push({ x0: best.x0 - 2.4, x1: best.x1 + 2.4, z0: best.z0 - 2.4, z1: best.z1 + 2.4 })
          bx(g, F.cabinet, best.x0, best.x1, y + 0.3, y + 2.9, best.z0, best.z1, 0.7)
          bx(g, F.metalDark, best.x0 + 0.05, best.x1 - 0.05, y, y + 0.3, best.z0 + 0.05, best.z1 - 0.05)
          bx(g, F.counter, best.x0 - 0.1, best.x1 + 0.1, y + 2.9, y + 3.12, best.z0 - 0.1, best.z1 + 0.25)
          const n = 3
          for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n
            const sx = alongX ? best.x0 + (best.x1 - best.x0) * t : best.x1 + 0.9
            const sz = alongX ? best.z1 + 0.9 : best.z0 + (best.z1 - best.z0) * t
            registerSeat({ kind: 'stool', x: sx, z: sz, y, w: 1.0, d: 1.0, fx: alongX ? 0 : -1, fz: alongX ? -1 : 0, hint: 2.3 })
            tcyl(g, F.chairFab, sx, sz, 0.5, 0.45, y + 2.05, y + 2.3, 22)
            cyl(g, F.metalDark, sx, sz, 0.05, y, y + 2.05, 0.5, 8)
            cyl(g, F.metalDark, sx, sz, 0.32, y, y + 0.06, 0.5, 14)
          }
          const mx = (best.x0 + best.x1) / 2, mz = (best.z0 + best.z1) / 2
          ball(g, F.leaf, mx, y + 3.7, mz, 0.4)
          tcyl(g, F.pot, mx, mz, 0.3, 0.22, y + 3.12, y + 3.5, 16)
          pendant(cg, mx - (alongX ? 1.4 : 0), mz - (alongX ? 0 : 1.4), y, 3.0, 0.5)
          pendant(cg, mx + (alongX ? 1.4 : 0), mz + (alongX ? 0 : 1.4), y, 3.0, 0.5)
        }
      }
      break
    }

    case 'toilet':
    case 'bathroom': {
      const walls = L.walls({ tall: true })
      const wc = L.place(1.7, 2.5, walls, true)
      if (wc) {
        const f = frame(g, y, wc)
        f.s(F.white, 0.15, f.W - 0.15, 0, 0.75, 0.9, 2.9, 0.08)                // cistern
        f.s(F.white, 0.2, f.W - 0.2, 0.75, f.D, 0.0, 1.4, 0.15)                // bowl
        f.cy(F.white, f.W / 2, f.D - 0.6, 0.62, 1.4, 1.5, 0.3)
        f.b(F.chrome, f.W - 0.55, f.W - 0.3, 0.1, 0.25, 2.3, 2.5, 0.2)
      }
      const basin = L.place(2.0, 1.6, walls, true)
      if (basin) {
        const f = frame(g, y, basin)
        f.b(F.vanity, 0, f.W, 0, f.D, 0, 2.6, 0.7)
        f.b(F.white, 0.2, f.W - 0.2, 0.15, f.D - 0.15, 2.6, 2.8, 0.2)
        f.cy(F.chrome, f.W / 2, 0.25, 0.05, 2.8, 3.3, 0.2)
        f.b(F.mirror, 0.2, f.W - 0.2, 0.0, 0.08, 3.9, 6.6)
        f.b(F.chrome, 0.1, f.W - 0.1, 0.0, 0.11, 3.82, 3.9)
        f.b(F.chrome, 0.1, f.W - 0.1, 0.0, 0.11, 6.6, 6.68)
        f.b(F.hardware, f.W / 2 - 0.2, f.W / 2 + 0.2, f.D, f.D + 0.06, 1.8, 1.88)
      }
      if (W >= 5 && D >= 5) {
        const sh = L.place(3, 3, walls, true, 'end')
        if (sh) {
          const f = frame(g, y, sh)
          f.b(F.white, 0, f.W, 0, f.D, 0, 0.18, 0.4)                          // tray
          f.b(F.glass, 0.05, 0.1 + f.W - 0.1, f.D - 0.06, f.D, 0.18, 6.8, 0.1)  // glass screen
          f.b(F.glass, f.W - 0.06, f.W, 0.0, f.D, 0.18, 6.8, 0.1)
          f.cy(F.chrome, f.W / 2, 0.15, 0.04, 5.5, 7.0, 0.2)
          f.cy(F.chrome, f.W / 2, 0.45, 0.45, 7.0, 7.06, 0.2)
        }
      }
      if (area >= 36) {
        const gz = L.place(1.2, 1.2, walls, true, 'start')
        if (gz) { const f = frame(g, y, gz); f.b(F.white, 0, f.W, 0, f.D, 6.6, 8.2, 0.4) } // geyser
      }
      tileWalls(dg, y, r, ob, 7.2, F.tile)
      break
    }

    case 'puja_room': {
      const m = L.place(Math.min(3.6, W - 1.6), 1.7, L.walls({ tall: true }), true)
      if (m) {
        const f = frame(g, y, m)
        f.b(F.wood, 0, f.W, 0, f.D, 0, 3.0)
        f.b(F.woodLight, -0.1, f.W + 0.1, 0, f.D + 0.1, 3.0, 3.15)
        f.b(F.woodLight, 0, 0.35, 0, f.D, 3.15, 6.2)
        f.b(F.woodLight, f.W - 0.35, f.W, 0, f.D, 3.15, 6.2)
        f.b(F.woodLight, 0, f.W, 0, f.D, 6.2, 6.8)
        f.b(F.woodLight, f.W / 2 - 0.3, f.W / 2 + 0.3, 0, f.D, 6.8, 7.4)
        f.b(F.woodDark, 0.35, f.W - 0.35, 0, 0.15, 3.15, 6.2)
        f.b(F.brassM, f.W / 2 - 0.25, f.W / 2 + 0.25, 0.3, 0.7, 3.15, 4.3, 0.3)
        f.cy(M(0xffb347, 0.4, 0.9), f.W / 2 - 0.9, 1.0, 0.08, 3.15, 3.35)
        f.cy(M(0xffb347, 0.4, 0.9), f.W / 2 + 0.9, 1.0, 0.08, 3.15, 3.35)
        rug(f.rect(f.W / 2 - 1.2, f.W / 2 + 1.2, f.D + 0.3, f.D + 2.2), F.rugAlt)
      }
      break
    }

    case 'dressing': {
      // wardrobe wall (doors, rail, handles) and a low dresser with a mirror
      const wl = L.place(Math.min(Math.max(W, D) - 0.8, 9), 1.8, L.walls({ tall: true }), true)
      if (wl) {
        const f = frame(g, y, wl)
        f.b(F.wood, 0, f.W, 0, f.D, 0, 7.0)
        const nd = Math.max(2, Math.round(f.W / 2.0))
        const dw = f.W / nd
        for (let i = 0; i < nd; i++) {
          f.b(F.woodLight, i * dw + 0.04, (i + 1) * dw - 0.04, f.D - 0.05, f.D + 0.03, 0.3, 6.7)
          f.b(F.metal, (i + 1) * dw - 0.32, (i + 1) * dw - 0.24, f.D + 0.03, f.D + 0.08, 3.0, 3.8)
        }
      }
      const dr = L.place(Math.min(3.2, Math.max(W, D) - 2.4), 1.3, L.walls({ tall: false }), true)
      if (dr) {
        const f = frame(g, y, dr)
        f.b(F.wood, 0, f.W, 0, f.D, 0, 2.5)
        f.b(F.mirror, 0.2, f.W - 0.2, 0.02, 0.1, 2.9, 6.2)
      }
      break
    }

    case 'utility': {
      const wm = L.place(2.3, 2.3, L.walls({ tall: false }), false)
      if (wm) {
        const f = frame(g, y, wm)
        f.b(F.white, 0, f.W, 0, f.D, 0, 3.1, 0.4)
        f.cy(0x35505f, f.W / 2, f.D, 0.75, 1.0, 2.2, 0.2)
        f.b(F.steel, 0.2, f.W - 0.2, f.D - 0.1, f.D + 0.02, 2.6, 2.95, 0.3)
      }
      const sk = L.place(Math.min(3.4, W - 2.5), 1.8, L.walls({ tall: false }), false, 'end', 2.4)
      if (sk) {
        const f = frame(g, y, sk)
        f.b(F.upper, 0, f.W, 0, f.D, 0, 2.8, 0.7)
        f.b(F.steel, 0.3, f.W - 0.3, 0.2, f.D - 0.2, 2.8, 2.95, 0.25)
        f.cy(F.chrome, f.W / 2, 0.15, 0.05, 2.95, 3.6, 0.2)
        f.b(F.upper, 0, f.W, 0, 1.0, 5.0, 6.6, 0.7)
      }
      break
    }

    case 'study': {
      const dk = L.place(5, 2.2, L.walls({ tall: false }), false)
      if (dk) {
        const f = frame(g, y, dk)
        f.b(F.wood, 0, f.W, 0, f.D, 2.3, 2.5)
        f.b(F.woodDark, 0, 0.3, 0.1, f.D - 0.1, 0, 2.3)
        f.b(F.woodDark, f.W - 1.4, f.W, 0.1, f.D - 0.1, 0, 2.3)
        f.b(0x20262c, f.W / 2 - 0.9, f.W / 2 + 0.9, 0.7, 1.4, 2.5, 2.58)
        f.b(0x20262c, f.W / 2 - 0.9, f.W / 2 + 0.9, 0.7, 0.78, 2.58, 3.7)
        chair(f, f.W / 2 - 0.4, f.D + 1.2, 1)
        L.placed.push(f.rect(f.W / 2 - 1.2, f.W / 2 + 0.6, f.D, f.D + 2.2))
      }
      const bs = L.place(Math.min(5, Math.max(W, D) - 3), 1.2, L.walls({ tall: true }), true)
      if (bs) {
        const f = frame(g, y, bs)
        f.b(F.woodDark, 0, f.W, 0, f.D, 0, 6.6)
        for (let sh = 0; sh < 4; sh++) {
          const h0 = 0.4 + sh * 1.6
          f.b(F.wood, 0.05, f.W - 0.05, 0.05, f.D, h0, h0 + 0.06)
          let u = 0.2
          const cols = [0xb5402f, 0x2f5d8a, 0x3f7a45, 0xd9a441, 0x6d4c8a]
          for (let k = 0; u < f.W - 0.4; k++) { const wd = 0.2 + ((k * 7) % 3) * 0.08; f.b(cols[k % 5], u, u + wd, 0.2, f.D - 0.1, h0 + 0.06, h0 + 1.3); u += wd + 0.02 }
        }
      }
      curtains(F.curtain)
      break
    }

    case 'balcony': {
      // The table and its two chairs are reserved as ONE piece (chairs included), so no chair can stand in a doorway; a narrow balcony gets the table alone.
      const withChairs = L.place(5.0, 2.4, L.walls(), false, 'mid')
      const tb = withChairs ?? L.place(2.4, 2.4, L.walls(), false, 'mid')
      if (tb) {
        const f = frame(g, y, tb)
        const c = f.W / 2
        f.cy(F.woodDark, c, f.D / 2, 0.9, 1.9, 2.0, 0.5)
        f.cy(F.metalDark, c, f.D / 2, 0.08, 0, 1.9, 0.5)
        f.cy(F.metalDark, c, f.D / 2, 0.5, 0, 0.1, 0.5)
        if (withChairs) {
          for (const cu of [c - 1.8, c + 1.8]) {
            const cv = f.D / 2
            f.s(F.corner, cu - 0.7, cu + 0.7, cv - 0.7, cv + 0.7, 1.3, 1.7, 0.1)
            f.s(F.corner, cu - 0.7, cu + 0.7, cv - 0.7, cv + 0.7, 1.7, 2.9, 0.12)
            for (const [du, dv] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) f.b(F.metalDark, cu + du - 0.05, cu + du + 0.05, cv + dv - 0.05, cv + dv + 0.05, 0, 1.3)
          }
        }
      }
      for (const [from, size] of [['start', 1.3], ['end', 1.3]] as Array<['start' | 'end', number]>) {
        const pl = L.place(size, size, L.walls(), false, from)
        if (pl) plant(g, y, pl, 2.4)
      }
      break
    }
    default:
      break
  }
  void deco; void noPlan; void lampBase
  return L
}

/* ------------------------------------------------------------- walkable furnishing (validate, repair, validate again) */
/** How a room's layout fared when it was built (read by the tests and the report). */
export interface RoomAccessLog {
  room: string; type: string
  /** furnishing passes tried (1 = the first layout was kept) */
  attempts: number
  /** a person can walk between every doorway of the room at the minimum clear width (no door pocket, no sealed doorway) */
  ok: boolean
  /** ... and also at the comfortable width (0.8 ft kept free around every piece) */
  comfortable: boolean
  /** what is still wrong (only when !ok) */
  issues: string[]
  /** small pieces whose front is boxed in although the doorways are all connected (reported, not a walking problem) */
  notes: string[]
  reserved: number
  /** pieces placed on the first try / in the layout that was kept (a retry that dropped pieces shows here) */
  piecesFirst: number; pieces: number; seatsFirst: number; seats: number
  firstIssues: string[]
}
let ACCESS_LOG: RoomAccessLog[] = []
export function takeAccessLog(): RoomAccessLog[] { return ACCESS_LOG.slice() }
/** The narrowest clear walking width that is accepted: the body of the VR walker is 0.6 ft wide, so every gap between a wall, an open door leaf and a piece of
 *  furniture must leave 2 x MIN_MARGIN = 1.24 ft.  Layouts that only fail the COMFORTABLE width (COMFY_MARGIN) are kept as they are - the retry strips furniture
 *  out of a room, and that is only worth doing when a doorway really is cut off. */
const MIN_MARGIN = 0.7
const COMFY_MARGIN = 0.8
/** half width of the corridor kept free on each retry (wider first, then narrower so a small room is not stripped bare) */
const HALF_WIDTHS = [0.95, 0.85, 0.75, 0.65]

function accessInput(L: Layout, extra: Rect[] = []): RoomAccessInput {
  const half = { top: L.ob.half?.top ?? 0.2, bottom: L.ob.half?.bottom ?? 0.2, left: L.ob.half?.left ?? 0.2, right: L.ob.half?.right ?? 0.2 }
  const doors = (L.ob.doorSegs ?? []).map((d) => ({ wall: d.wall, a: d.a, b: d.b }))
  return { room: { x: L.r.x, y: L.r.y, x2: L.r.x2, y2: L.r.y2 }, half, doors, leaves: L.ob.leaves ?? [], blocks: extra.length ? L.placed.concat(extra) : L.placed }
}
const describe = (i: AccessIssue) => i.kind === 'door-blocked' ? `door ${i.door} approach blocked` : i.kind === 'doors-split' ? `door ${i.to} cut off from door ${i.from}` : `a piece at (${i.rect.x0.toFixed(1)},${i.rect.z0.toFixed(1)}) is boxed in`

/**
 * Furnishes a room and proves it can be walked: every doorway can be reached from every other doorway and from the front of every piece, with the open door leaves and
 * the furniture as real obstacles.  If not, the layout is taken back, the corridor that has to stay free is reserved, and the room is furnished again (a few times,
 * with a slightly narrower corridor each time).  A room that still fails is built as well as it can be and is REPORTED (see `takeAccessLog`), never silently accepted.
 */
export function furnishRoom(g: THREE.Group, r: RoomR, lvl: number, ob: Obstacles, decor?: THREE.Group, ceil?: THREE.Group): void {
  ensure()
  const mark = { g: g.children.length, d: decor?.children.length ?? 0, c: ceil?.children.length ?? 0, seats: seatCount(), fix: FIXTURES.length, lay: LAYOUTS.length }
  const undo = () => {
    const cut = (grp: THREE.Group | undefined, n: number) => { if (grp) while (grp.children.length > n) grp.remove(grp.children[grp.children.length - 1]) }
    cut(g, mark.g); cut(decor, mark.d); cut(ceil, mark.c)
    seatTruncate(mark.seats); FIXTURES.length = mark.fix; LAYOUTS.length = mark.lay
  }
  const hardOf = (iss: AccessIssue[]) => iss.filter((i) => i.kind !== 'piece-sealed')
  // What really stands in the room: the footprints the placer CLAIMED can be smaller than what is drawn (bedside tables, a wardrobe's cornice, a TV unit's legs ...), and the
  // VR walker collides with the drawn meshes.  So the walking check also uses the bounding box of every piece that was drawn, below head height and above step height.
  const drawn = (): Rect[] => {
    const out: Rect[] = []
    g.updateWorldMatrix(true, false)
    const inv = g.matrixWorld.clone().invert()
    const box = new THREE.Box3()
    for (let i = mark.g; i < g.children.length; i++) {
      const c = g.children[i]
      c.updateMatrixWorld(true)
      box.setFromObject(c)
      if (box.isEmpty()) continue
      box.applyMatrix4(inv)
      const lo = box.min.y - lvl, hi = box.max.y - lvl
      if (hi < 1.1 || lo > 3.7) continue                           // rugs, flat things / things hanging above head height
      const a: Rect = { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z }
      if (a.x1 - a.x0 > (r.x2 - r.x) * 0.98 && a.z1 - a.z0 > (r.y2 - r.y) * 0.98) continue    // a shell that spans the whole room (not a piece)
      out.push(a)
    }
    return out
  }
  let reserve: Rect[] = []
  let L!: Layout
  let attempt = 0
  L = furnishOnce(g, r, lvl, ob, decor, ceil, reserve)
  const piecesFirst = L.placed.length, seatsFirst = seatCount() - mark.seats
  let ex = drawn()
  const comfy0 = checkRoomAccess(accessInput(L, ex), COMFY_MARGIN)
  let res = comfy0.ok ? comfy0 : checkRoomAccess(accessInput(L, ex), MIN_MARGIN)
  const firstIssues = (comfy0.ok ? [] : comfy0.issues).map(describe)
  let hard = hardOf(res.issues)
  const isBedroom = r.room_type === 'bedroom' || r.room_type === 'master_bedroom' || r.room_type === 'guest_bedroom'
  const bedLost = () => isBedroom && seatsFirst > 0 && seatCount() - mark.seats < 1        // the bed is a place to sit: a bedroom that lost it lost its bed
  // every cut-off doorway seen so far: the corridors are drawn again from scratch for each retry (narrower each time), never piled up
  const known = new Map<string, AccessIssue>()
  const remember = (iss: AccessIssue[]) => iss.forEach((i) => known.set(i.kind === 'doors-split' ? `s${i.from}-${i.to}` : i.kind === 'door-blocked' ? `b${i.door}` : '', i))
  const strips = (inp: RoomAccessInput, hw: number): Rect[] => {
    const an = anchors(inp)
    const add: Rect[] = []
    for (const is of known.values()) {
      if (is.kind === 'doors-split') add.push(...routeStrips(inp, an[is.from], an[is.to], hw))
      else if (is.kind === 'door-blocked') add.push(...routeStrips(inp, an[is.door], { x: (r.x + r.x2) / 2, z: (r.y + r.y2) / 2 }, hw))
    }
    return add
  }
  remember(hard)
  while ((hard.length || (attempt > 0 && bedLost())) && attempt < HALF_WIDTHS.length) {
    const add = strips(accessInput(L, ex), HALF_WIDTHS[attempt])
    if (!add.length) break                      // nothing more can be drawn: keep what we have and report it
    reserve = add
    undo()
    attempt++
    L = furnishOnce(g, r, lvl, ob, decor, ceil, reserve)
    ex = drawn()
    res = checkRoomAccess(accessInput(L, ex), MIN_MARGIN)
    hard = hardOf(res.issues)
    remember(hard)
  }
  const comfortable = hard.length === 0 && (comfy0.ok && attempt === 0 ? true : checkRoomAccess(accessInput(L, ex), COMFY_MARGIN).ok)
  LAYOUTS.push(L)
  if (LAYOUTS.length > 400) LAYOUTS.shift()
  ACCESS_LOG.push({
    room: r.id ?? r.room_type, type: r.room_type, attempts: attempt + 1, ok: hard.length === 0, comfortable,
    issues: hard.map(describe), notes: res.issues.filter((i) => i.kind === 'piece-sealed').map(describe), reserved: reserve.length,
    piecesFirst, pieces: L.placed.length, seatsFirst, seats: seatCount() - mark.seats, firstIssues,
  })
  if (ACCESS_LOG.length > 600) ACCESS_LOG.shift()
}

/** The two walls beside the sofa wall (for armchairs). */
function walls2(L: Layout, sofaWall: Wall): Wall[] {
  return sofaWall === 'top' || sofaWall === 'bottom' ? ['left', 'right'] : ['top', 'bottom'].map((w) => w as Wall)
}
