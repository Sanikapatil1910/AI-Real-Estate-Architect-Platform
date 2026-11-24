import * as THREE from 'three'
import type { Chajja, Plan } from '@/types'
import { makeBike, makeCar, CAR_COLOURS, BIKE_COLOURS } from './twinVehicles'
import { furnishFloor, openingSeg, rx2, ry2, key } from './twinFloor'
import type { Line, Opening, Interval, RoomT } from './twinFloor'
import { buildStair, makeDoor, stairEntryHigh, stairLobbyRect } from './twinDoorsStairs'
import type { RoomR } from './twinDoorsStairs'
import { ENVELOPE, exposedEdges, fasciaRuns, inAny, mumtyDoor, overhangPatches, parapetBoxes, roofOverhangBySide, sideOf } from './twinEnvelope'
import type { Edge, R4, Side } from './twinEnvelope'
import { stairSpec, stairVariant } from './stairSpec'
import { passageOpenings, cutIntervals } from './walls'
import type { StairDrawn } from './stairSpec'
import type { DoorLeaf } from './twinDoorsStairs'
import { resetStairWalk } from './stairWalk'
import { resetSeats } from './seatRegistry'
import { resetFixtures, setCeilingHeight, setFurn, takeFixtures, takeFootprints } from './twinInterior'
import type { KitchenFixtures } from './twinInterior'
import { mergeByMaterial, metal, solid, surface, texBox, texBoxMulti } from './twinMaterials'
import { DEFAULT_DESIGN, resolveDesign } from './twinThemes'
import { capRoof, gablePorchRoof, hipRoof, leanTo, ringRoof, skirt } from './twinRoof'
import type { Rect, RoofMats } from './twinRoof'
import type { Design, Resolved } from './twinThemes'
import { box as wbox, carvedPillar, cuspedArch, lantern, rangoli, timberBalustrade, toran, tulsiVrindavan } from './twinWada'

/**
 * Digital twin: a 3D model built directly from the plan's own coordinates
 * (rooms, walls, doors, windows, stairs, terrace), so it always matches the 2D drawing.
 * Units: 1 three.js unit = 1 ft.  Plan x -> east (+x), plan y -> south (+z).
 *
 * The design (theme + overrides + day/evening) only chooses materials, colours and lighting fixtures.  Every wall, slab, opening,
 * stair and the whole furniture layout is derived from the plan alone; `sig` proves it (see TwinModel.sig).
 */

let WALL_H = 10 // floor-to-floor height in ft; set from the plan (min 2.7 m) in buildTwin
export const getWallH = () => WALL_H
export const SLAB = 0.3
const OPEN_TYPES = new Set(['open_terrace', 'balcony', 'courtyard'])   // courtyard (chowk): open to the sky, bounded by the walls of its neighbours
const COLORS: Record<string, number> = {
  living_room: 0xe8d9b8, dining: 0xe6d3a8, kitchen: 0xd9e6c4, utility: 0xcfd8dc, dressing: 0xe6dcc8, master_bedroom: 0xd7c9e6,
  bedroom: 0xdcd0ec, guest_bedroom: 0xdcd0ec, bathroom: 0xb9dbe6, toilet: 0xb9dbe6, parking: 0xbfc4c8, puja_room: 0xf4d8a8, study: 0xe3dcc8,
  family_lounge: 0xe8d9b8, staircase: 0xc9c2b8, passage: 0xe9e4da, balcony: 0xd8d2c4, open_terrace: 0xcfc8bb,
}
const WET = new Set(['bathroom', 'toilet', 'utility', 'kitchen'])
const BEDS = new Set(['master_bedroom', 'bedroom', 'guest_bedroom', 'study', 'dressing', 'puja_room'])

function merge(iv: Interval[]): Interval[] {
  const s = [...iv].sort((p, q) => p.a - q.a)
  const out: Interval[] = []
  for (const i of s) {
    const last = out[out.length - 1]
    if (last && i.a <= last.b + 0.01) last.b = Math.max(last.b, i.b)
    else out.push({ ...i })
  }
  return out
}

type Mat = THREE.Material | THREE.Material[]
function bx(g: THREE.Group, mat: Mat, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: { struct?: boolean; cast?: boolean; edge?: boolean } = {}) {
  if (x1 - x0 < 0.001 || y1 - y0 < 0.001 || z1 - z0 < 0.001) return
  const geo = Array.isArray(mat) ? texBoxMulti(mat, x0, x1, y0, y1, z0, z1) : texBox(mat, x0, x1, y0, y1, z0, z1)
  const m = new THREE.Mesh(geo, mat)
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  m.castShadow = o.cast ?? true
  m.receiveShadow = true
  if (o.struct) m.userData.struct = true
  if (o.edge) m.userData.roofEdge = true
  g.add(m)
}

function bboxOf(rs: RoomT[]): Rect {
  return { x0: Math.min(...rs.map((r) => r.x)), x1: Math.max(...rs.map(rx2)), z0: Math.min(...rs.map((r) => r.y)), z1: Math.max(...rs.map(ry2)) }
}

function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(15,23,42,0.78)'
  ctx.beginPath()
  ctx.roundRect(4, 8, 248, 48, 14)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = '600 26px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 33)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }))
  s.scale.set(6.4, 1.6, 1)
  s.renderOrder = 10
  s.layers.set(1) // drawn in a separate overlay pass (see twinScene.createRig), so ambient occlusion never sees them
  return s
}

const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
function hash32(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}
/** Order-independent hash of the world boxes of the meshes `pick` selects (rounded to 0.01 ft). */
function sigOf(root: THREE.Object3D, pick: (o: THREE.Mesh) => boolean): string {
  const parts: string[] = []
  const b = new THREE.Box3()
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !pick(m)) return
    b.setFromObject(m)
    parts.push([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(r2).join(','))
  })
  parts.sort()
  return `${parts.length}:${hash32(parts.join('|'))}`
}

export interface ChajjaInfo {
  floor: number; room: string; wall: string; axis: 'h' | 'v'; c: number; a: number; b: number; dir: 1 | -1
  projection: number; thickness: number; y0: number; y1: number; mesh: THREE.Object3D
}

export interface LightSlot { light: THREE.PointLight; floor: number; on: number }

export interface TwinModel {
  root: THREE.Group
  floors: THREE.Group[]
  roof: THREE.Group
  labels: THREE.Sprite[]
  furniture: THREE.Group[]
  ceil: THREE.Group[]            // ceiling fixtures / ceiling style: shown with the full-height walls
  walls: THREE.Group[]
  doors: DoorLeaf[]
  doorAmt: { v: number }
  center: THREE.Vector3
  size: number
  road: THREE.Vector3 // unit vector (x, z) pointing from the house towards the street
  exterior: THREE.Group // compound wall, gate, trees, road: shown in exterior mode
  lights: LightSlot[]            // evening room lights (always the same count for a plan, so shaders never recompile)
  resolved: Resolved
  wallH: number
  /** Hashes of the structural geometry (slabs, walls, stairs) and of the furniture layout: identical for every design of one plan. */
  sig: { struct: string; furniture: string; layout: string }
  /** Where the parked vehicles of this model stand (plan coordinates, ft) and the porch room they stand in. */
  /** One sun-shade slab per window (read from each window's `chajja` record), tagged with the window it covers. */
  chajjas: ChajjaInfo[]
  /** What each kitchen really got (base run, wall cabinets, sink, hob, fridge), straight from the furnishing code. */
  kitchens: KitchenFixtures[]
  /** Flat roofs of the floor below (not rooms, no access) drawn as slab + parapet. */
  roofAreas: Array<{ floor: number; id: string; x0: number; x1: number; z0: number; z1: number }>
  /** What the roof / terrace / balcony code built (plan feet): lets tests and the UI check access, parapets, overhangs and projections without parsing meshes. */
  envelope: {
    roofY: number
    overhang: R4[]
    overhangBySide: Record<Side, number>
    parapets: Array<R4 & { y0: number; y1: number }>
    mumty: Array<{ room: R4; lobby: R4; door: { axis: 'h' | 'v'; c: number; a: number; b: number; out: 1 | -1 } | null; walls: Array<R4 & { y0: number; y1: number }>; coverY: number; floorY: number }>
    balconies: Array<{ floor: number; room: string; rect: R4; sides: Partial<Record<Side, number>>; slab: R4[]; rails: Array<{ axis: 'h' | 'v'; c: number; a: number; b: number }> }>
  }
  parking: { room: { x: number; y: number; width: number; length: number } | null; cars: Array<{ x: number; z: number }>; bikes: Array<{ x: number; z: number }> }
}

/** `walkable`: the model the VR walker uses.  Its compound gate stands open (the pillars stay; the bars are not drawn across the way in), so the way from the street to the front door is walkable. */
export interface TwinOptions { walkable?: boolean }

export function buildTwin(plan: Plan, design: Design = DEFAULT_DESIGN, opts: TwinOptions = {}): TwinModel {
  const R = resolveDesign(design)
  const evening = R.time === 'evening'
  const root = new THREE.Group()
  root.name = 'house'
  root.userData.architecturalStyle = R.style.label   // travels into the exported .glb as a node extra
  root.userData.palette = R.def.label
  const floors: THREE.Group[] = []
  const labels: THREE.Sprite[] = []
  const furniture: THREE.Group[] = []
  const ceil: THREE.Group[] = []
  const walls: THREE.Group[] = []
  const doors: DoorLeaf[] = []
  const lights: LightSlot[] = []
  const furnSigs: string[] = []
  const chajjas: ChajjaInfo[] = []
  const roofAreas: TwinModel['roofAreas'] = []
  const chajjaDone = new WeakSet<object>()
  resetFixtures()
  resetStairWalk(); resetSeats()
  setFurn(R.furn)
  const tiledRoof = R.style.exterior.roof === 'tiled'
  const pillared = R.style.exterior.porch === 'pillared'
  const wadaPorch = R.style.exterior.porch === 'wada'
  const EAVE = R.style.exterior.eave
  const wadaStyle = R.style.interior.furniture === 'wada'
  const RM: RoofMats = { tile: R.ext.tile, ridge: R.ext.ridge, timber: R.ext.timber, fill: R.ext.wallCol }
  const leanJobs: Array<{ rc: Rect; lean: 'x0' | 'x1' | 'z0' | 'z1'; y0: number; ext: { x0: boolean; x1: boolean; z0: boolean; z1: boolean } }> = []

  const stairInfo = (plan as unknown as { staircase?: Record<string, unknown> | null }).staircase ?? undefined
  WALL_H = Math.max(8.86, Math.min(14, Number((stairInfo as { floor_height?: number } | undefined)?.floor_height) || 10))
  setCeilingHeight(WALL_H - SLAB)
  const sSpec = stairSpec(stairInfo as never, WALL_H)
  const planAny = plan as unknown as { terrace?: { exists?: boolean; x: number; y: number; width: number; length: number } }
  const nF = plan.floors.length
  const hasTerr = Boolean(planAny.terrace?.exists)
  const envelope: TwinModel['envelope'] = { roofY: nF * WALL_H, overhang: [], parapets: [], mumty: [], overhangBySide: { top: 0, bottom: 0, left: 0, right: 0 }, balconies: [] }
  const allRooms = plan.floors.flatMap((f) => (f.layout?.rooms ?? []) as unknown as RoomT[])
  const bx0 = Math.min(...allRooms.map((r) => r.x))
  const bx1 = Math.max(...allRooms.map(rx2))
  const bz0 = Math.min(...allRooms.map((r) => r.y))
  const bz1 = Math.max(...allRooms.map(ry2))

  const slabEdge = surface({ kind: 'concrete', concrete: { color: [196, 193, 187] }, finish: 'matte' })
  const glass = surface({ kind: 'glass', opacity: 0.26, color: 0xcfe6ee })
  const asphalt = surface({ kind: 'concrete', concrete: { color: [74, 76, 80] }, finish: 'matte' })
  const lightGlow = (c: number, day = 0.25, night = 2.2) => surface({ kind: 'emissive', color: c, glow: evening ? night : day })

  // ---------------------------------------------------------------- ground / plot
  const plot = plan.floors[0].layout?.plot ?? { width: bx1, length: bz1 }
  const px = plot.x ?? 0
  const pz = plot.y ?? 0
  const roadSide = String((plan as unknown as { road_side?: string }).road_side || plan.floors[0].layout?.road_side || 'South')
  const road = new THREE.Vector3(roadSide === 'East' ? 1 : roadSide === 'West' ? -1 : 0, 0, roadSide === 'South' ? 1 : roadSide === 'North' ? -1 : 0)
  const groundMat = R.ext.ground
  const gs = 1600
  bx(root, groundMat, px + plot.width / 2 - gs / 2, px + plot.width / 2 + gs / 2, -0.2, -0.05, pz + plot.length / 2 - gs / 2, pz + plot.length / 2 + gs / 2, { cast: false })
  bx(root, R.ext.paving, px, px + plot.width, -0.05, 0, pz, pz + plot.length, { cast: false })
  const pave = surface({ kind: 'concrete', concrete: { color: [150, 148, 143], panels: true }, finish: 'matte' })
  for (const rg of (plan.floors[0].layout?.open_spaces?.regions ?? []) as Array<{ type?: string; x: number; y: number; width: number; length: number }>) {
    const isParking = (rg.type ?? '').includes('park')
    bx(root, isParking ? pave : R.ext.ground, rg.x, rg.x + rg.width, -0.05, 0.02, rg.y, rg.y + rg.length, { cast: false, struct: true })
  }

  // the stair is entered from one short end, the same on every floor (it arrives where it starts)
  const stairHigh = (() => {
    for (const fl of plan.floors) {
      const rs = (fl.layout?.rooms ?? []) as unknown as RoomT[]
      const st = rs.find((q) => q.room_type === 'staircase')
      const ds = (fl.layout?.openings?.doors ?? []) as unknown as Array<{ x1?: number; y1?: number; x2?: number; y2?: number; room?: string; connects_to?: string | null }>
      if (st && ds.some((d) => d.room === st.id || d.connects_to === st.id)) {
        return stairEntryHigh({ id: st.id, room_type: st.room_type, x: st.x, y: st.y, x2: rx2(st), y2: ry2(st), stair: (st as unknown as { stair?: StairDrawn | null }).stair }, ds)
      }
    }
    return false
  })()

  // the entrance: a feature strip of the facade above and around the main door (only when the facade has an accent material)
  const mainDoor0 = ((plan.floors[0].layout?.openings?.doors ?? []) as Opening[]).find((d) => d.door_type === 'main')
  const mseg = mainDoor0 ? openingSeg(mainDoor0, mainDoor0.room ? plan.floors[0].layout!.rooms.find((q) => (q as unknown as RoomT).id === mainDoor0.room) as unknown as RoomT : undefined) : null
  const accentSpan = R.ext.accent && mseg ? { axis: mseg.line.axis, c: mseg.line.c, a: (mseg.a + mseg.b) / 2 - 3.6, b: (mseg.a + mseg.b) / 2 + 3.6 } : null

  const floorMatFor = (t: string): THREE.Material => {
    if (R.coded) return solid(COLORS[t] ?? 0xdddddd, 0.9)
    if (t === 'parking' || t === 'bike_parking') return pave
    if (t === 'balcony' || t === 'open_terrace' || t === 'courtyard') return surface(R.floorOut)
    if (WET.has(t)) return surface(R.floorWet)
    if (BEDS.has(t)) return surface(R.floorBed)
    return surface(R.floorMain)
  }

  plan.floors.forEach((fl, fi) => {
    const g = new THREE.Group()
    const rooms = (fl.layout?.rooms ?? []) as unknown as RoomT[]
    const openings = fl.layout?.openings
    const base = fi * WALL_H
    const lvl = base + SLAB
    const hWall = WALL_H - SLAB
    const byId = new Map<string, RoomT>()
    for (const r of rooms) {
      byId.set(r.id ?? r.room_type, r)
      if (!byId.has(r.room_type)) byId.set(r.room_type, r)
    }
    const indoor = rooms.filter((r) => !OPEN_TYPES.has(r.room_type))
    const inside = (x: number, z: number) => indoor.some((r) => x > r.x + 0.01 && x < rx2(r) - 0.01 && z > r.y + 0.01 && z < ry2(r) - 0.01)

    // slabs: finish on top, ceiling underneath, concrete edge
    for (const r of rooms) {
      if (r.room_type === 'courtyard' && fi > 0) continue   // an upper-floor courtyard is a void: open to the sky, ringed by a gallery rail
      let covered: Array<[number, number, number, number]> = [[r.x, rx2(r), r.y, ry2(r)]]
      if (r.room_type === 'staircase' && fi > 0) {
        // stair well: upper floors only carry the arrival lobby
        const lv = stairVariant(sSpec, stairHigh, fi - 1)
        const lb = stairLobbyRect({ room_type: r.room_type, x: r.x, y: r.y, x2: rx2(r), y2: ry2(r) }, lv.entryHigh, lv.spec)
        covered = [[lb.x0, lb.x1, lb.z0, lb.z1]]
      }
      for (const [a0, a1, c0, c1] of covered) {
        const top = floorMatFor(r.room_type)
        bx(g, [slabEdge, slabEdge, top, R.ceilingMat, slabEdge, slabEdge], a0, a1, base, lvl, c0, c1, { struct: true })
      }
      if (r.room_type !== 'passage') {
        const s = label((r.name ?? r.room_type.replace(/_/g, ' ')).replace(/\b\w/g, (m) => m.toUpperCase()))
        s.position.set((r.x + rx2(r)) / 2, lvl + 4.5, (r.y + ry2(r)) / 2)
        g.add(s)
        labels.push(s)
      }
    }

    // flat roofs of the floor below (a roof area is not a room: slab with the roof finish on top, ceiling underneath; parapet added with the walls)
    const roofRects = ((fl.layout as unknown as { roof_areas?: Array<{ id: string; x: number; y: number; x2: number; y2: number }> })?.roof_areas ?? [])
    for (const ra of roofRects) {
      bx(g, [slabEdge, slabEdge, R.ext.roof, R.ceilingMat, slabEdge, slabEdge], ra.x, ra.x2, base, lvl, ra.y, ra.y2, { struct: true })
      roofAreas.push({ floor: fi, id: ra.id, x0: ra.x, x1: ra.x2, z0: ra.y, z1: ra.y2 })
      if (tiledRoof && indoor.length && fi > 0) {
        // a tiled lean-to over this lower roof: it leans on the wall of the floor above and falls to the open edges
        const U = bboxOf(indoor), Fb = bboxOf(plan.floors[fi - 1].layout?.rooms as unknown as RoomT[])
        const ov = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0)
        const cands: Array<['x0' | 'x1' | 'z0' | 'z1', number]> = [
          ['x1', Math.abs(ra.x2 - U.x0) < 0.06 ? ov(ra.y, ra.y2, U.z0, U.z1) : -1], ['x0', Math.abs(ra.x - U.x1) < 0.06 ? ov(ra.y, ra.y2, U.z0, U.z1) : -1],
          ['z1', Math.abs(ra.y2 - U.z0) < 0.06 ? ov(ra.x, ra.x2, U.x0, U.x1) : -1], ['z0', Math.abs(ra.y - U.z1) < 0.06 ? ov(ra.x, ra.x2, U.x0, U.x1) : -1],
        ]
        cands.sort((p, q) => q[1] - p[1])
        let lean = cands[0][0]
        if (cands[0][1] <= 0) {
          const dx = (U.x0 + U.x1) / 2 - (ra.x + ra.x2) / 2, dz = (U.z0 + U.z1) / 2 - (ra.y + ra.y2) / 2
          lean = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'x1' : 'x0') : (dz > 0 ? 'z1' : 'z0')
        }
        const ext = { x0: Math.abs(ra.x - Fb.x0) < 0.06 && lean !== 'x0', x1: Math.abs(ra.x2 - Fb.x1) < 0.06 && lean !== 'x1', z0: Math.abs(ra.y - Fb.z0) < 0.06 && lean !== 'z0', z1: Math.abs(ra.y2 - Fb.z1) < 0.06 && lean !== 'z1' }
        leanJobs.push({ rc: { x0: ra.x, x1: ra.x2, z0: ra.y, z1: ra.y2 }, lean, y0: lvl, ext })
      }
    }

    // wall lines (own group so the walls can be cut down to see the rooms)
    const wg = new THREE.Group()
    g.add(wg)
    walls.push(wg)
    const sg = new THREE.Group() // structure
    const tg = new THREE.Group() // trims, frames, glass, railings (merged)
    const cjg = new THREE.Group() // chajjas (kept unmerged: one mesh per window)
    wg.add(sg, tg, cjg)
    const lines = new Map<string, { line: Line; solid: Interval[]; low: Interval[] }>()
    const touch = (line: Line) => {
      const k = `${line.axis}${line.c}`
      if (!lines.has(k)) lines.set(k, { line, solid: [], low: [] })
      return lines.get(k)!
    }
    const edges = (r: RoomT) => [
      { line: { axis: 'h' as const, c: key(r.y) }, a: r.x, b: rx2(r), ext: Math.abs(r.y - bz0) < 0.01 },
      { line: { axis: 'h' as const, c: key(ry2(r)) }, a: r.x, b: rx2(r), ext: Math.abs(ry2(r) - bz1) < 0.01 },
      { line: { axis: 'v' as const, c: key(r.x) }, a: r.y, b: ry2(r), ext: Math.abs(r.x - bx0) < 0.01 },
      { line: { axis: 'v' as const, c: key(rx2(r)) }, a: r.y, b: ry2(r), ext: Math.abs(rx2(r) - bx1) < 0.01 },
    ]
    const rdSide = roadSide
    for (const r of rooms) {
      const open = OPEN_TYPES.has(r.room_type)
      const porch = r.room_type === 'parking' || r.room_type === 'bike_parking'
      for (const e of edges(r)) {
        // a car porch is open to the road: no wall on the street side, columns carry the roof (added below)
        if (porch && e.ext && ((rdSide === 'South' && e.line.axis === 'h' && e.line.c > (bz0 + bz1) / 2) || (rdSide === 'North' && e.line.axis === 'h' && e.line.c < (bz0 + bz1) / 2) ||
            (rdSide === 'East' && e.line.axis === 'v' && e.line.c > (bx0 + bx1) / 2) || (rdSide === 'West' && e.line.axis === 'v' && e.line.c < (bx0 + bx1) / 2))) continue
        const t = touch(e.line)
        if (!open) t.solid.push({ a: e.a, b: e.b })
        else if (e.ext || (r.room_type === 'courtyard' && fi > 0)) t.low.push({ a: e.a, b: e.b })
      }
    }
    const holes = new Map<string, Array<{ a: number; b: number; kind: 'door' | 'window' | 'main'; win?: Opening & { chajja?: Chajja } }>>()
    const addHole = (o: Opening, kind: 'door' | 'window' | 'main') => {
      const r = o.room ? byId.get(o.room) : undefined
      const s = openingSeg(o, r)
      if (!s) return
      const k = `${s.line.axis}${s.line.c}`
      if (!holes.has(k)) holes.set(k, [])
      holes.get(k)!.push({ a: s.a, b: s.b, kind, win: kind === 'window' ? (o as Opening & { chajja?: Chajja }) : undefined })
    }
    for (const d of (openings?.doors ?? []) as Opening[]) addHole(d, d.door_type === 'main' ? 'main' : 'door')
    for (const w of (openings?.windows ?? []) as Opening[]) addHole(w, 'window')

    /** Which side of a wall is outdoors: +1 / -1 along the normal, 0 when both or neither side is a room. */
    const outward = (axis: 'h' | 'v', c: number, a: number, b: number, t: number, fallbackExt: boolean): number => {
      const m = (a + b) / 2, off = t / 2 + 0.4
      const p = (d: number) => (axis === 'h' ? inside(m, c + d) : inside(c + d, m))
      const lo = p(-off), hi = p(off)
      if (lo && !hi) return 1
      if (!lo && hi) return -1
      if (fallbackExt && !lo && !hi) return axis === 'h' ? (c <= (bz0 + bz1) / 2 ? -1 : 1) : (c <= (bx0 + bx1) / 2 ? -1 : 1)
      return 0
    }

    /** One straight wall run on a line: solid pieces between the openings, frames / glass / casings in them, finishes on both faces. */
    const emitRun = (axis: 'h' | 'v', c: number, t: number, solidIv: Array<{ a: number; b: number }>, hs: Array<{ a: number; b: number; kind: 'door' | 'window' | 'main'; win?: Opening & { chajja?: Chajja } }>,
      isExt: boolean, extra: { lo?: number; hi?: number } = {}) => {
      const box = (a: number, b: number, y0: number, y1: number, m: Mat, o?: { struct?: boolean; cast?: boolean }, grp: THREE.Group = tg, n0 = -t / 2, n1 = t / 2) => {
        if (b - a < 0.005) return
        if (axis === 'h') bx(grp, m, a, b, y0, y1, c + n0, c + n1, o)
        else bx(grp, m, c + n0, c + n1, y0, y1, a, b, o)
      }
      for (const s of solidIv) {
        const sa = extra.lo ?? s.a, sb = extra.hi ?? s.b
        const out = outward(axis, c, s.a, s.b, t, isExt)
        const faces = (): THREE.Material[] => {
          // box faces: +x, -x, +y, -y, +z, -z; the normal axis is z for an h line, x for a v line
          const f = R.wall, e = R.ext.main
          if (out === 0) return [f, f, f, f, f, f]
          const plus = out > 0
          return axis === 'h' ? [f, f, f, f, plus ? e : f, plus ? f : e] : [plus ? e : f, plus ? f : e, f, f, f, f]
        }
        const wallMat = faces()
        const piece = (a: number, b: number, y0: number, y1: number) => {
          box(a, b, y0, y1, wallMat, { struct: true }, sg)
          if (b - a < 0.2) return
          // skirting on the room side(s)
          if (y0 <= lvl + 0.01) {
            for (const side of [-1, 1]) {
              if (out !== 0 && side === out) continue
              const n0 = side < 0 ? -t / 2 - 0.035 : t / 2, n1 = side < 0 ? -t / 2 : t / 2 + 0.035
              box(a, b, lvl, lvl + 0.5, R.trimMat, { cast: false }, tg, n0, n1)
            }
          }
          if (out !== 0 && isExt) {
            const n = (d0: number, d1: number) => (out > 0 ? [t / 2 + d0, t / 2 + d1] : [-t / 2 - d1, -t / 2 - d0])
            const ac = accentSpan && accentSpan.axis === axis && Math.abs(accentSpan.c - c) < 0.05 ? accentSpan : null
            if (ac && R.ext.accent && Math.min(b, ac.b) - Math.max(a, ac.a) > 0.1) {
              const [n0, n1] = n(0, 0.06)
              box(Math.max(a, ac.a), Math.min(b, ac.b), y0, y1, R.ext.accent, { cast: false }, tg, n0, n1)
            }
            if (fi === 0 && y0 <= lvl + 0.01) {
              const [n0, n1] = n(0, 0.09)
              box(a, b, lvl, lvl + 1.7, R.ext.plinth, { cast: false }, tg, n0, n1)
            }
            if (fi > 0 && y0 <= lvl + 0.01) { // string course at every upper slab
              const [n0, n1] = n(0, 0.14)
              box(a, b, base - 0.1, lvl + 0.25, R.ext.trim, { cast: false }, tg, n0, n1)
            }
          }
        }
        const casing = (a: number, b: number) => {
          // door architraves on both faces
          const cv = R.style.interior.doors !== 'flush'
          const cw = cv ? 0.36 : 0.24, cd = cv ? 0.09 : 0.05
          for (const side of [-1, 1]) {
            const mat = cv ? (out !== 0 && side === out ? R.ext.timber : R.furn.carved) : out !== 0 && side === out ? R.ext.trim : R.trimMat
            const n0 = side < 0 ? -t / 2 - cd : t / 2, n1 = side < 0 ? -t / 2 : t / 2 + cd
            box(a - cw, a, lvl, lvl + 7.25, mat, { cast: false }, tg, n0, n1)
            box(b, b + cw, lvl, lvl + 7.25, mat, { cast: false }, tg, n0, n1)
            box(a, b, lvl + 7.0, lvl + 7.25, mat, { cast: false }, tg, n0, n1)
            if (cv) {
              // carved header: a stepped cornice on corbels, and a plinth block at the foot of each post
              const m2 = side < 0 ? -t / 2 - cd - 0.06 : t / 2 + cd, m3 = side < 0 ? -t / 2 - cd : t / 2 + cd + 0.06
              box(a - cw - 0.1, b + cw + 0.1, lvl + 7.25, lvl + 7.5, mat, { cast: false }, tg, m2, m3)
              box(a - cw - 0.04, b + cw + 0.04, lvl + 7.5, lvl + 7.62, mat, { cast: false }, tg, m2 - (side < 0 ? 0.04 : 0), m3 + (side < 0 ? 0 : 0.04))
              for (const [x0, x1] of [[a - cw, a + 0.08], [b - 0.08, b + cw]]) box(x0, x1, lvl + 6.7, lvl + 7.0, mat, { cast: false }, tg, side < 0 ? n0 - 0.03 : n0, side < 0 ? n1 : n1 + 0.03)
              for (const [x0, x1] of [[a - cw - 0.04, a], [b, b + cw + 0.04]]) box(x0, x1, lvl, lvl + 0.55, mat, { cast: false }, tg, side < 0 ? n0 - 0.03 : n0, side < 0 ? n1 : n1 + 0.03)
            }
          }
        }
        let cur = sa
        const here = hs.filter((h) => h.b > s.a + 0.01 && h.a < s.b - 0.01).sort((p, q) => p.a - q.a)
        for (const h of here) {
          const a = Math.max(h.a, s.a), b = Math.min(h.b, s.b)
          piece(cur, a, lvl, lvl + hWall)
          if (h.kind === 'window') {
            const sill = Math.max(1.5, Math.min(5.5, Number((h.win as { sill?: number } | undefined)?.sill) || 3))   // ft above the floor (plan data; bathrooms high, living rooms low)
            piece(a, b, lvl, lvl + sill)
            piece(a, b, lvl + 7, lvl + hWall)
            // sash frame, mullions, glass
            const tw = R.style.interior.windows !== 'plain'
            const fd = tw ? 0.15 : 0.1
            const fy0 = lvl + sill, fy1 = lvl + 7, ft = tw ? 0.15 : 0.09
            box(a, a + ft, fy0, fy1, R.frame, undefined, tg, -fd, fd)
            box(b - ft, b, fy0, fy1, R.frame, undefined, tg, -fd, fd)
            box(a, b, fy0, fy0 + ft, R.frame, undefined, tg, -fd, fd)
            box(a, b, fy1 - ft, fy1, R.frame, undefined, tg, -fd, fd)
            const nm = (b - a) >= 6 ? 2 : (b - a) >= 3.4 ? 1 : 0
            for (let i = 1; i <= nm; i++) { const mx = a + ((b - a) * i) / (nm + 1); box(mx - 0.035, mx + 0.035, fy0, fy1, R.frame, undefined, tg, -fd * 0.8, fd * 0.8) }
            box(a + ft, b - ft, fy0 + ft, fy1 - ft, glass, { cast: false }, tg, -0.02, 0.02)
            if (tw) {
              // timber window: a transom bar with a jali (lattice) panel above it
              const ty = fy1 - Math.min(1.35, (fy1 - fy0) * 0.3)
              box(a + ft, b - ft, ty, ty + 0.1, R.frame, undefined, tg, -fd, fd)
              const nx = Math.max(2, Math.round((b - a - 2 * ft) / 0.3))
              for (let i = 1; i < nx; i++) { const x = a + ft + ((b - a - 2 * ft) * i) / nx; box(x - 0.025, x + 0.025, ty + 0.1, fy1 - ft, R.frame, { cast: false }, tg, -0.07, 0.07) }
              for (let j = 1; j < 4; j++) { const y = ty + 0.1 + ((fy1 - ft - ty - 0.1) * j) / 4; box(a + ft, b - ft, y - 0.025, y + 0.025, R.frame, { cast: false }, tg, -0.07, 0.07) }
            }
            // sills and lintels
            box(a - 0.15, b + 0.15, lvl + sill - 0.12, lvl + sill, R.trimMat, { cast: false }, tg, out > 0 || out === 0 ? -t / 2 - 0.28 : t / 2 - 0.02, out > 0 || out === 0 ? -t / 2 + 0.02 : t / 2 + 0.28)
            // chajja: one sun-shade slab above every window, on the same wall, projecting to the outdoor side
            if (!chajjaDone.has(h)) {
              chajjaDone.add(h)
              const cj = h.win?.chajja ?? { projection: 1.5, thickness: 0.33, overhang: 0.5 }
              const dir: 1 | -1 = out !== 0 ? (out > 0 ? 1 : -1) : outward(axis, c, a, b, t, true) >= 0 ? 1 : -1
              const y0 = lvl + 7.25, y1 = y0 + cj.thickness
              const n0 = dir > 0 ? t / 2 : -t / 2 - cj.projection, n1 = dir > 0 ? t / 2 + cj.projection : -t / 2
              const before = cjg.children.length
              box(a - cj.overhang, b + cj.overhang, y0, y1, R.ext.trim, { cast: true }, cjg, n0, n1)
              const mesh = cjg.children[before]
              if (mesh) {
                mesh.userData.chajja = true
                chajjas.push({ floor: fi, room: String(h.win?.room ?? ''), wall: String(h.win?.wall ?? ''), axis, c, a: a - cj.overhang, b: b + cj.overhang, dir, projection: cj.projection, thickness: cj.thickness, y0, y1, mesh })
              }
            }
            if (out !== 0 && isExt) {
              const n0 = out > 0 ? t / 2 : -t / 2 - 0.2, n1 = out > 0 ? t / 2 + 0.2 : -t / 2
              box(a - 0.2, b + 0.2, lvl + sill - 0.22, lvl + sill, R.ext.trim, { cast: false }, tg, n0, n1)
              const l0 = out > 0 ? t / 2 : -t / 2 - 0.1, l1 = out > 0 ? t / 2 + 0.1 : -t / 2
              box(a - 0.2, b + 0.2, lvl + 7.0, lvl + 7.25, R.ext.trim, { cast: false }, tg, l0, l1)
              if (R.style.exterior.shutters) {
                // louvred timber shutters, folded open flat against the wall on both sides of the window (never wider than the free wall beside it)
                const idx = here.indexOf(h)
                const lim0 = idx > 0 ? here[idx - 1].b : s.a, lim1 = idx < here.length - 1 ? here[idx + 1].a : s.b
                const sn0 = out > 0 ? t / 2 + 0.02 : -t / 2 - 0.12, sn1 = out > 0 ? t / 2 + 0.12 : -t / 2 - 0.02
                const shutter = (x0: number, x1: number) => {
                  const m = R.ext.timber
                  box(x0, x0 + 0.12, fy0, fy1, m, { cast: false }, tg, sn0, sn1); box(x1 - 0.12, x1, fy0, fy1, m, { cast: false }, tg, sn0, sn1)
                  box(x0, x1, fy0, fy0 + 0.14, m, { cast: false }, tg, sn0, sn1); box(x0, x1, fy1 - 0.14, fy1, m, { cast: false }, tg, sn0, sn1)
                  for (let y = fy0 + 0.3; y < fy1 - 0.3; y += 0.24) box(x0 + 0.12, x1 - 0.12, y, y + 0.08, m, { cast: false }, tg, sn0, sn1)
                }
                const wl = Math.min((b - a) / 2 - 0.02, (a - lim0) / 2 - 0.1), wr = Math.min((b - a) / 2 - 0.02, (lim1 - b) / 2 - 0.1)
                if (wl >= 0.7) shutter(a - 0.05 - wl, a - 0.05)
                if (wr >= 0.7) shutter(b + 0.05, b + 0.05 + wr)
              }
            }
          } else {
            piece(a, b, lvl + 7, lvl + hWall)
            casing(a, b)
          }
          cur = Math.max(cur, b)
        }
        piece(cur, sb, lvl, lvl + hWall)
      }
    }

    /** A low wall (balcony / terrace edge): plastered parapet with the design's railing above it. */
    const lowRun = (axis: 'h' | 'v', c: number, a: number, b: number, plain = false) => {
      const t = 0.4
      const box = (a0: number, b0: number, y0: number, y1: number, m: Mat, n0: number, n1: number, grp: THREE.Group = tg, o?: { struct?: boolean; cast?: boolean; edge?: boolean }) => {
        if (axis === 'h') bx(grp, m, a0, b0, y0, y1, c + n0, c + n1, o)
        else bx(grp, m, c + n0, c + n1, y0, y1, a0, b0, o)
      }
      if (plain) { box(a, b, lvl, lvl + 3, R.ext.wallCol, -t / 2, t / 2, sg, { struct: true, edge: true }); return }
      box(a, b, lvl, lvl + 1.1, R.ext.wallCol, -t / 2, t / 2, sg, { struct: true })
      box(a - 0.05, b + 0.05, lvl + 1.1, lvl + 1.2, R.ext.cap, -t / 2 - 0.05, t / 2 + 0.05)
      const len = b - a
      if (R.ext.railing === 'glass') {
        box(a, b, lvl + 1.2, lvl + 3.2, R.ext.railMat, -0.03, 0.03, tg, { cast: false })
        box(a, b, lvl + 3.2, lvl + 3.32, metal(0xb9bdc0, 0.25), -0.07, 0.07)
      } else if (R.ext.railing === 'wood' && R.style.exterior.balcony === 'timber') {
        // Maharashtrian Wada: a carved timber balustrade (turned balusters, finialled posts, a deep handrail) on the plastered kerb
        timberBalustrade(tg, R.ext.timber, axis === 'h' ? 'x' : 'z', c, a, b, lvl + 1.2, 2.2)
      } else {
        const wood = R.ext.railing === 'wood'
        const n = Math.max(2, Math.round(len / (wood ? 0.5 : 0.42)))
        const w = wood ? 0.12 : 0.06
        for (let i = 0; i <= n; i++) { const q = a + (len * i) / n; box(Math.min(q, b - w) , Math.min(q, b - w) + w, lvl + 1.2, lvl + 3.2, R.ext.railMat, -w / 2, w / 2) }
        box(a, b, lvl + 3.2, lvl + 3.36, R.ext.railMat, wood ? -0.12 : -0.07, wood ? 0.12 : 0.07)
        box(a, b, lvl + 1.2, lvl + 1.3, R.ext.railMat, -0.05, 0.05)
      }
    }

    // balcony projections (generated plans): the balcony slab cantilevers beyond the enclosed floor on the sides the backend cleared against the plot margin
    const projCut = new Map<string, Array<[number, number]>>()   // original balcony edge runs replaced by the projected slab's own railing
    for (const pr of ((fl.layout as unknown as { balcony_projections?: Array<{ room: string; sides: Partial<Record<Side, number>> }> })?.balcony_projections ?? [])) {
      const br = rooms.find((q) => (q.id ?? q.room_type) === pr.room && q.room_type === 'balcony')
      if (!br) continue
      const x0 = br.x, x1 = rx2(br), z0 = br.y, z1 = ry2(br)
      const d = { top: pr.sides.top ?? 0, bottom: pr.sides.bottom ?? 0, left: pr.sides.left ?? 0, right: pr.sides.right ?? 0 }
      const slabs: R4[] = []
      const rails: Array<{ axis: 'h' | 'v'; c: number; a: number; b: number }> = []
      const slabMat = [slabEdge, slabEdge, surface(R.floorOut), R.ceilingMat, slabEdge, slabEdge]
      const addSlab = (q: R4) => { bx(sg, slabMat, q.x0, q.x1, base, lvl, q.z0, q.z1, { struct: true }); slabs.push(q) }
      if (d.top) addSlab({ x0, x1, z0: z0 - d.top, z1: z0 })
      if (d.bottom) addSlab({ x0, x1, z0: z1, z1: z1 + d.bottom })
      if (d.left) addSlab({ x0: x0 - d.left, x1: x0, z0, z1 })
      if (d.right) addSlab({ x0: x1, x1: x1 + d.right, z0, z1 })
      for (const [a, b] of [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']] as Array<[Side, Side]>) {
        if (!d[a] || !d[b]) continue
        addSlab({ x0: b === 'left' ? x0 - d.left : x1, x1: b === 'left' ? x0 : x1 + d.right, z0: a === 'top' ? z0 - d.top : z1, z1: a === 'top' ? z0 : z1 + d.bottom })
      }
      const cut = (axis: 'h' | 'v', c: number, a: number, b: number) => { const k = `${axis}${key(c)}`; projCut.set(k, [...(projCut.get(k) ?? []), [a, b]]) }
      const run = (axis: 'h' | 'v', c: number, a: number, b: number) => { rails.push({ axis, c, a, b }); lowRun(axis, c, a, b) }
      if (d.top) { cut('h', z0, x0, x1); run('h', z0 - d.top, x0 - d.left, x1 + d.right); if (!d.left) run('v', x0, z0 - d.top, z0); if (!d.right) run('v', x1, z0 - d.top, z0) }
      if (d.bottom) { cut('h', z1, x0, x1); run('h', z1 + d.bottom, x0 - d.left, x1 + d.right); if (!d.left) run('v', x0, z1, z1 + d.bottom); if (!d.right) run('v', x1, z1, z1 + d.bottom) }
      if (d.left) { cut('v', x0, z0, z1); run('v', x0 - d.left, z0 - d.top, z1 + d.bottom); if (!d.top) run('h', z0, x0 - d.left, x0); if (!d.bottom) run('h', z1, x0 - d.left, x0) }
      if (d.right) { cut('v', x1, z0, z1); run('v', x1 + d.right, z0 - d.top, z1 + d.bottom); if (!d.top) run('h', z0, x1, x1 + d.right); if (!d.bottom) run('h', z1, x1, x1 + d.right) }
      envelope.balconies.push({ floor: fi, room: pr.room, rect: { x0, x1, z0, z1 }, sides: pr.sides, slab: slabs, rails })
    }

    // parapet round the open edge of every flat roof (the sides that face a room are that room's wall)
    for (const ra of roofRects) {
      const sides: Array<['h' | 'v', number, number, number]> = [['h', key(ra.y), ra.x, ra.x2], ['h', key(ra.y2), ra.x, ra.x2], ['v', key(ra.x), ra.y, ra.y2], ['v', key(ra.x2), ra.y, ra.y2]]
      for (const [ax, cc, a0, b0] of sides) {
        const ext = ax === 'h' ? cc <= bz0 + 0.01 || cc >= bz1 - 0.01 : cc <= bx0 + 0.01 || cc >= bx1 - 0.01
        if (ext && !tiledRoof) lowRun(ax, cc, a0, b0, true)
      }
    }

    // courtyard (chowk) on the ground floor: a colonnade where the court is not closed by a neighbour's wall (carved columns and arches in Wada, columns
    // in the other styles), a tulsi / planter at its centre.  Only drawn for a court the plan itself contains.
    if (fi === 0) {
      for (const cr of rooms.filter((q) => q.room_type === 'courtyard')) {
        const cw = rx2(cr) - cr.x, cd = ry2(cr) - cr.y
        const segs: Array<{ axis: 'h' | 'v'; c: number; a: number; b: number }> = [
          { axis: 'h', c: cr.y, a: cr.x, b: rx2(cr) }, { axis: 'h', c: ry2(cr), a: cr.x, b: rx2(cr) },
          { axis: 'v', c: cr.x, a: cr.y, b: ry2(cr) }, { axis: 'v', c: rx2(cr), a: cr.y, b: ry2(cr) },
        ]
        const yTop = base + WALL_H - 0.75
        for (const sgm of segs) {
          const ln = lines.get(`${sgm.axis}${key(sgm.c)}`)
          const cover = (ln ? cutIntervals(merge(ln.solid).map((q) => [q.a, q.b] as [number, number]), sgm.axis, ln.line.c, passageOpenings(rooms as never)).map((q) => ({ a: q[0], b: q[1] })) : []).filter((iv) => iv.b > sgm.a + 0.01 && iv.a < sgm.b - 0.01).sort((p, q) => p.a - q.a)
          const free: Array<[number, number]> = []
          let cur = sgm.a
          for (const iv of cover) { if (iv.a - cur > 0.5) free.push([cur, iv.a]); cur = Math.max(cur, iv.b) }
          if (sgm.b - cur > 0.5) free.push([cur, sgm.b])
          for (const [a0, a1] of free) {
            const len = a1 - a0
            if (len < 1.6) continue
            const nn = Math.max(1, Math.ceil(len / 6.2))
            const pos = Array.from({ length: nn + 1 }, (_, i) => a0 + 0.45 + ((len - 0.9) * i) / nn)
            const beamAx: 'x' | 'z' = sgm.axis === 'h' ? 'x' : 'z'
            for (const u of pos) {
              const wx = sgm.axis === 'h' ? u : sgm.c, wz = sgm.axis === 'h' ? sgm.c : u
              bx(sg, R.ext.plinth, wx - 0.45, wx + 0.45, lvl, lvl + 0.3, wz - 0.45, wz + 0.45, { cast: false })
              if (R.style.exterior.porch !== 'slab') carvedPillar(tg, R.ext.timber, wx, wz, lvl + 0.3, yTop, beamAx)
              else bx(tg, R.ext.wallCol, wx - 0.3, wx + 0.3, lvl + 0.3, yTop, wz - 0.3, wz + 0.3, { cast: false })
            }
            // beam over the run, and cusped arches between the columns (Wada)
            const bm = R.style.exterior.porch !== 'slab' ? R.ext.timber : R.ext.trim
            if (sgm.axis === 'h') bx(tg, bm, a0, a1, yTop, yTop + 0.75, sgm.c - 0.3, sgm.c + 0.3, { cast: false })
            else bx(tg, bm, sgm.c - 0.3, sgm.c + 0.3, yTop, yTop + 0.75, a0, a1, { cast: false })
            if (R.style.exterior.porch === 'wada') {
              for (let i = 0; i < nn; i++) {
                const m = (pos[i] + pos[i + 1]) / 2
                cuspedArch(tg, R.ext.timber, sgm.axis === 'h' ? m : sgm.c, sgm.axis === 'h' ? sgm.c : m, beamAx, yTop - 2.2, pos[i + 1] - pos[i] - 0.7, 2.2, 0.2, 5)
              }
            }
          }
        }
        // the heart of the court: a tulsi vrindavan (a planter in the modern style) and, in Wada, a rangoli beside it
        const ccx = (cr.x + rx2(cr)) / 2, ccz = (cr.y + ry2(cr)) / 2
        if (cw >= 6 && cd >= 6) {
          if (R.style.exterior.porch === 'slab') {
            bx(tg, R.ext.plinth, ccx - 1.6, ccx + 1.6, lvl, lvl + 1.2, ccz - 1.6, ccz + 1.6)
            for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 - k * 0.07, 1), k % 2 ? R.furn.leaf2 : R.furn.leaf); b.position.set(ccx + Math.cos(k * 2.4) * 0.7, lvl + 1.7 + k * 0.2, ccz + Math.sin(k * 2.4) * 0.7); b.castShadow = true; tg.add(b) }
          } else {
            const tgrp = new THREE.Group()
            tulsiVrindavan(tgrp, { plaster: R.ext.wallCol, stone: R.ext.stone, cap: R.ext.cap, pot: R.furn.pot, leaf: R.furn.leaf, leaf2: R.furn.leaf2, brass: R.furn.brassM, glow: lightGlow(0xffe2b0, 0.3, 2.6), dark: solid(0x2a1c12, 1) }, ccx, ccz)
            tgrp.position.y = lvl
            g.add(tgrp)
            if (wadaStyle && cw >= 9 && cd >= 9) { const rg = new THREE.Group(); rangoli(rg, ccx + 0, 0, ccz, Math.min(cw, cd) * 0.3); rg.position.y = lvl; g.add(rg) }
          }
        }
      }
    }

    const pcuts = passageOpenings(rooms as never)
    for (const [k, ln] of lines) {
      const solidIv = cutIntervals(merge(ln.solid).map((q) => [q.a, q.b] as [number, number]), ln.line.axis, ln.line.c, pcuts).map((q) => ({ a: q[0], b: q[1] }))
      const cutLow = projCut.get(k) ?? []
      const low = merge(ln.low).filter((l) => !solidIv.some((s) => s.a <= l.a + 0.01 && s.b >= l.b - 0.01))
        .flatMap((l) => {
          // the balcony's own edge railing is replaced by the railing round its projected slab
          let parts: Array<{ a: number; b: number }> = [l]
          for (const [ca, cb] of cutLow) parts = parts.flatMap((q) => (cb <= q.a + 0.01 || ca >= q.b - 0.01 ? [q] : [{ a: q.a, b: Math.max(q.a, ca) }, { a: Math.min(q.b, cb), b: q.b }].filter((w) => w.b - w.a > 0.05)))
          return parts
        })
      const hs = (holes.get(k) ?? []).sort((p, q) => p.a - q.a)
      // an outer wall: on the footprint edge, or facing the open air inside the footprint (a flat roof below, a notch) - not merely a balcony / court side
      const anyRoom = (x: number, z: number) => rooms.some((q) => x > q.x + 0.01 && x < rx2(q) - 0.01 && z > q.y + 0.01 && z < ry2(q) - 0.01)
      const facesAir = solidIv.some((sv) => {
        const m = (sv.a + sv.b) / 2
        const p = (d: number) => (ln.line.axis === 'h' ? [m, ln.line.c + d] : [ln.line.c + d, m])
        const A = p(-0.55), B = p(0.55)
        const ia = inside(A[0], A[1]), ib = inside(B[0], B[1])
        return (ia && !ib && !anyRoom(B[0], B[1])) || (ib && !ia && !anyRoom(A[0], A[1]))
      })
      const isExt = facesAir || (ln.line.axis === 'h' ? ln.line.c <= bz0 + 0.01 || ln.line.c >= bz1 - 0.01 : ln.line.c <= bx0 + 0.01 || ln.line.c >= bx1 - 0.01)
      const t = isExt ? 230 / 304.8 : 120 / 304.8 // 230 mm outer, 120 mm inner walls
      emitRun(ln.line.axis, ln.line.c, t, solidIv, hs, isExt)
      for (const l of low) lowRun(ln.line.axis, ln.line.c, l.a, l.b) // balcony / terrace parapet
    }

    // pipe ducts (shafts) of the wet rooms: a slim solid column in the corner
    for (const d of ((fl.layout as unknown as { ducts?: Array<{ x: number; y: number; width: number; length: number }> })?.ducts ?? [])) {
      bx(sg, R.wall, d.x, d.x + d.width, lvl, lvl + hWall, d.y, d.y + d.length, { struct: true })
    }

    // feature walls (Colorful Modern): one blank wall of a room in the room's accent colour, on top of the plain wall
    if (R.def.accents) {
      for (const r of rooms) {
        const col = R.def.accents[r.room_type]
        if (col === undefined) continue
        const sides = [
          { axis: 'h' as const, c: key(r.y), a: r.x, b: rx2(r), n: 1 }, { axis: 'h' as const, c: key(ry2(r)), a: r.x, b: rx2(r), n: -1 },
          { axis: 'v' as const, c: key(r.x), a: r.y, b: ry2(r), n: 1 }, { axis: 'v' as const, c: key(rx2(r)), a: r.y, b: ry2(r), n: -1 },
        ]
        const free = sides.filter((s) => !(holes.get(`${s.axis}${s.c}`) ?? []).some((h) => h.b > s.a - 0.3 && h.a < s.b + 0.3) && s.b - s.a >= 6)
        free.sort((p, q) => (q.b - q.a) - (p.b - p.a))
        const s = free[0]
        if (!s) continue
        const th = (axis: 'h' | 'v', cc: number) => (axis === 'h' ? cc <= bz0 + 0.01 || cc >= bz1 - 0.01 : cc <= bx0 + 0.01 || cc >= bx1 - 0.01) ? 230 / 304.8 : 120 / 304.8
        const half = th(s.axis, s.c) / 2 + 0.012
        const m = solid(col, 0.9)
        if (s.axis === 'h') bx(tg, m, s.a + 0.2, s.b - 0.2, lvl + 0.5, lvl + hWall - 0.05, s.c + s.n * half, s.c + s.n * (half + 0.012), { cast: false })
        else bx(tg, m, s.c + s.n * half, s.c + s.n * (half + 0.012), lvl + 0.5, lvl + hWall - 0.05, s.a + 0.2, s.b - 0.2, { cast: false })
      }
    }

    // stairs: U-shaped, two flights and a mid landing
    const stg = new THREE.Group()
    g.add(stg)
    const stairMat: THREE.Material = R.coded ? solid(0xbdb5a8, 0.9) : surface(R.floorMain)
    for (const r of rooms.filter((q) => q.room_type === 'staircase')) {
      const sr = { room_type: r.room_type, x: r.x, y: r.y, x2: rx2(r), y2: ry2(r) }
      const sv = stairVariant(sSpec, stairHigh, fi)
      // flights only climb to a floor that exists: the top floor's stair goes on to the roof only when a terrace was selected
      const climbs = fi < nF - 1 || hasTerr
      if (climbs) buildStair(stg, stairMat, sr, lvl, sv.spec, false, sv.entryHigh)
      // the void this floor's slab leaves for the flight arriving from below is guarded in THAT flight's frame
      if (fi > 0) {
        const lv = stairVariant(sSpec, stairHigh, fi - 1)
        buildStair(stg, stairMat, sr, lvl, lv.spec, true, lv.entryHigh, false)
      }
    }
    stg.traverse((o) => { o.userData.struct = true })

    // door leaves + swing arcs
    const floorDoorSegs = ((openings?.doors ?? []) as Array<Opening>).flatMap((q) => { const sq = openingSeg(q, q.room ? byId.get(q.room) : undefined); return sq ? [{ axis: sq.line.axis, c: sq.line.c, a: sq.a, b: sq.b }] : [] })
    for (const d of (openings?.doors ?? []) as Array<Opening & { connects_to?: string | null }>) {
      const owner = d.room ? byId.get(d.room) : undefined
      const sg2 = openingSeg(d, owner)
      if (!sg2 || !owner) continue
      const other = d.connects_to ? byId.get(d.connects_to) : undefined
      const asR = (q?: RoomT) => (q ? { id: q.id, room_type: q.room_type, x: q.x, y: q.y, x2: rx2(q), y2: ry2(q) } : undefined)
      const leaf = makeDoor({ axis: sg2.line.axis, c: sg2.line.c, a: sg2.a, b: sg2.b, kind: d.door_type === 'main' ? 'main' : 'door', doorType: d.door_type, owner: asR(owner), other: asR(other), doors: floorDoorSegs }, lvl,
        { leaf: R.doorMat, main: R.mainDoorMat, handle: R.handle, carved: R.style.interior.doors !== 'flush' ? { border: R.furn.carved, brass: R.furn.brassM, grand: R.style.interior.doors === 'grand' } : undefined })
      if (leaf) {
        g.add(leaf.pivot)
        g.add(leaf.arc)
        doors.push(leaf)
      }
    }

    // furniture (rule-placed, clear of door swings and — for tall pieces — windows)
    const fg = new THREE.Group()
    const dg = new THREE.Group() // curtains, wall tiles: part of the walls so they follow the cutaway
    const cg = new THREE.Group() // things that hang from the ceiling: shown with the full-height walls
    wg.add(dg)
    furniture.push(dg)
    furnishFloor(rooms, openings, lvl, fg, dg, cg)

    // ceiling style (needs full-height walls to be seen)
    const ceilY = lvl + hWall
    const ledM = lightGlow(0xffe2b0, 0.35, 1.8)
    for (const r of indoor) {
      if (r.room_type === 'staircase' || r.room_type === 'passage') continue
      const w = rx2(r) - r.x, d = ry2(r) - r.y
      if (w < 6 || d < 6) continue
      if (R.ceiling === 'cove' && !WET.has(r.room_type)) {
        const m = 0.25, bw = 0.9, th = 0.4
        const x0 = r.x + m, x1 = rx2(r) - m, z0 = r.y + m, z1 = ry2(r) - m
        bx(cg, R.ceilingMat, x0, x1, ceilY - th, ceilY, z0, z0 + bw, { cast: false })
        bx(cg, R.ceilingMat, x0, x1, ceilY - th, ceilY, z1 - bw, z1, { cast: false })
        bx(cg, R.ceilingMat, x0, x0 + bw, ceilY - th, ceilY, z0 + bw, z1 - bw, { cast: false })
        bx(cg, R.ceilingMat, x1 - bw, x1, ceilY - th, ceilY, z0 + bw, z1 - bw, { cast: false })
        const s = 0.06
        bx(cg, ledM, x0 + bw, x1 - bw, ceilY - th - 0.0, ceilY - th + s, z0 + bw - 0.02, z0 + bw + 0.06, { cast: false })
        bx(cg, ledM, x0 + bw, x1 - bw, ceilY - th - 0.0, ceilY - th + s, z1 - bw - 0.06, z1 - bw + 0.02, { cast: false })
        bx(cg, ledM, x0 + bw - 0.02, x0 + bw + 0.06, ceilY - th, ceilY - th + s, z0 + bw, z1 - bw, { cast: false })
        bx(cg, ledM, x1 - bw - 0.06, x1 - bw + 0.02, ceilY - th, ceilY - th + s, z0 + bw, z1 - bw, { cast: false })
      } else if (R.ceiling === 'slats' && !WET.has(r.room_type)) {
        const along = w >= d // slats run across the shorter side
        const n = Math.max(3, Math.floor((along ? d : w) / 0.55))
        for (let i = 0; i < n; i++) {
          const q = (along ? r.y : r.x) + 0.6 + ((along ? d : w) - 1.2) * (i / (n - 1))
          if (along) bx(cg, R.furn.wood, r.x + 0.4, rx2(r) - 0.4, ceilY - 0.2, ceilY, q - 0.07, q + 0.07, { cast: false })
          else bx(cg, R.furn.wood, q - 0.07, q + 0.07, ceilY - 0.2, ceilY, r.y + 0.4, ry2(r) - 0.4, { cast: false })
        }
      }
      if (R.style.interior.ceiling !== 'theme' && !WET.has(r.room_type)) {
        // timber ceiling: plank soffit, exposed beams across the short span and a carved border beam (dry rooms only)
        bx(cg, R.ceilingTimber, r.x + 0.05, rx2(r) - 0.05, ceilY - 0.08, ceilY, r.y + 0.05, ry2(r) - 0.05, { cast: false })
        const alongX = w >= d, longLen = alongX ? w : d, n = Math.max(2, Math.round(longLen / 3.6))
        const bm = R.furn.carved
        if (R.style.interior.ceiling === 'coffered') {
          // coffered: cross beams the other way too, so the soffit breaks into square timber coffers (the wada ceiling)
          const shortLen = alongX ? d : w, m2 = Math.max(2, Math.round(shortLen / 3.6))
          for (let i = 0; i <= m2; i++) {
            const q = (alongX ? r.y : r.x) + 0.18 + ((shortLen - 0.36) * i) / m2
            if (alongX) bx(cg, bm, r.x + 0.05, rx2(r) - 0.05, ceilY - 0.42, ceilY - 0.08, q - 0.18, q + 0.18, { cast: false })
            else bx(cg, bm, q - 0.18, q + 0.18, ceilY - 0.42, ceilY - 0.08, r.y + 0.05, ry2(r) - 0.05, { cast: false })
          }
        }
        for (let i = 0; i <= n; i++) {
          const q = (alongX ? r.x : r.y) + 0.22 + ((longLen - 0.44) * i) / n
          if (alongX) bx(cg, bm, q - 0.22, q + 0.22, ceilY - 0.55, ceilY - 0.08, r.y + 0.05, ry2(r) - 0.05, { cast: false })
          else bx(cg, bm, r.x + 0.05, rx2(r) - 0.05, ceilY - 0.55, ceilY - 0.08, q - 0.22, q + 0.22, { cast: false })
        }
        bx(cg, bm, r.x + 0.05, rx2(r) - 0.05, ceilY - 0.32, ceilY - 0.08, r.y + 0.05, r.y + 0.3, { cast: false })
        bx(cg, bm, r.x + 0.05, rx2(r) - 0.05, ceilY - 0.32, ceilY - 0.08, ry2(r) - 0.3, ry2(r) - 0.05, { cast: false })
        bx(cg, bm, r.x + 0.05, r.x + 0.3, ceilY - 0.32, ceilY - 0.08, r.y + 0.3, ry2(r) - 0.3, { cast: false })
        bx(cg, bm, rx2(r) - 0.3, rx2(r) - 0.05, ceilY - 0.32, ceilY - 0.08, r.y + 0.3, ry2(r) - 0.3, { cast: false })
      }
      // recessed downlights in the larger habitable rooms
      if (w * d >= 90 && !WET.has(r.room_type) && R.style.interior.ceiling === 'theme') {
        const cx = (r.x + rx2(r)) / 2, cz = (r.y + ry2(r)) / 2
        for (const [ox, oz] of [[-w / 4, -d / 4], [w / 4, -d / 4], [-w / 4, d / 4], [w / 4, d / 4]]) {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 18), lightGlow(0xfff0d0, 0.2, 2.4))
          m.position.set(cx + ox, ceilY - 0.02, cz + oz)
          cg.add(m)
        }
      }
    }

    // evening: one warm light per large room (fixed count per plan; switched by intensity)
    const lit = indoor.filter((r) => !['staircase', 'passage', 'parking', 'bike_parking'].includes(r.room_type)).sort((p, q) => (rx2(q) - q.x) * (ry2(q) - q.y) - (rx2(p) - p.x) * (ry2(p) - p.y)).slice(0, Math.max(3, Math.ceil(12 / nF)))
    for (const r of lit) {
      const area = (rx2(r) - r.x) * (ry2(r) - r.y)
      const pl = new THREE.PointLight(0xffd7a0, 0, 0, 2)
      pl.position.set((r.x + rx2(r)) / 2, lvl + hWall - 1.3, (r.y + ry2(r)) / 2)
      pl.castShadow = false
      const on = Math.min(260, 40 + area * 2.6)
      lights.push({ light: pl, floor: fi, on })
      root.add(pl)
    }

    furnSigs.push(sigOf(fg, () => true))
    mergeByMaterial(tg)
    mergeByMaterial(dg)
    mergeByMaterial(fg)
    mergeByMaterial(cg)
    g.add(fg)
    g.add(cg)
    furniture.push(fg)
    ceil.push(cg)
    floors.push(g)
    root.add(g)
  })

  // ---------------------------------------------------------------- roof + parapet over the top floor (open terraces / balconies stay open)
  const roof = new THREE.Group()
  const top = plan.floors[nF - 1]
  const topRooms = (top.layout?.rooms ?? []) as unknown as RoomT[]
  const roofY = nF * WALL_H
  const roofTop = [slabEdge, slabEdge, R.ext.roof, R.ceilingMat, slabEdge, slabEdge]
  const roofG = new THREE.Group() // pitched tile roofs (Traditional Indian): everything above the finished slabs
  const asR4 = (q: RoomT): R4 => ({ x0: q.x, x1: rx2(q), z0: q.y, z1: ry2(q) })
  const allTopR = topRooms.map(asR4)                                                    // every room of the top floor (open ones too)
  const stairTopR = topRooms.filter((q) => q.room_type === 'staircase').map(asR4)
  const roofedR = topRooms.filter((q) => !OPEN_TYPES.has(q.room_type) && q.room_type !== 'staircase').map(asR4)   // rooms with a flat roof slab over them
  const plotRect = { x: px, y: pz, width: plot.width, length: plot.length }
  const ovBy = roofOverhangBySide({ x0: bx0, x1: bx1, z0: bz0, z1: bz1 }, plotRect, (plan as unknown as { roof_spec?: { overhang_ft?: number; by_side?: Partial<Record<Side, number>> } }).roof_spec)
  envelope.roofY = roofY
  envelope.overhangBySide = ovBy
  const outerPt = (x: number, z: number) => !inAny(allTopR, x, z) && x > px && x < px + plot.width && z > pz && z < pz + plot.length
  const slabBox = (q: R4, overlap = 0.1) => bx(roof, roofTop, q.x0 - overlap, q.x1 + overlap, roofY, roofY + SLAB, q.z0 - overlap, q.z1 + overlap, { struct: true })
  for (const r of topRooms) {
    if (OPEN_TYPES.has(r.room_type)) continue
    if (r.room_type === 'staircase' && hasTerr) {
      // the stair opens onto the terrace: the arrival lobby gets a slab, the rest of the stair room stays open under a closed headroom (mumty)
      const tv = stairVariant(sSpec, stairHigh, nF - 1)
      const lb = stairLobbyRect({ room_type: r.room_type, x: r.x, y: r.y, x2: rx2(r), y2: ry2(r) }, tv.entryHigh, tv.spec)
      bx(roof, roofTop, lb.x0, lb.x1, roofY, roofY + SLAB, lb.z0, lb.z1, { struct: true })
      const sr = asR4(r)
      const door = mumtyDoor(sr, { x0: lb.x0, x1: lb.x1, z0: lb.z0, z1: lb.z1 }, roofedR)
      const hy = roofY + SLAB + ENVELOPE.mumtyWallFt
      const ws = roofY + SLAB
      const sideIsOuter = (axis: 'h' | 'v', c: number) => (axis === 'h' ? c <= bz0 + 0.01 || c >= bz1 - 0.01 : c <= bx0 + 0.01 || c >= bx1 - 0.01)
      const wallBoxes: Array<R4 & { y0: number; y1: number }> = []
      const wall = (x0: number, x1: number, z0: number, z1: number, y0 = ws, y1 = hy) => {
        if (x1 - x0 < 0.01 || z1 - z0 < 0.01 || y1 - y0 < 0.01) return
        bx(roof, R.ext.main, x0, x1, y0, y1, z0, z1, { struct: true, edge: true })
        wallBoxes.push({ x0, x1, z0, z1, y0, y1 })
      }
      // four walls round the stair room, with the door opening in one of them
      const sides: Array<['h' | 'v', number, number, number]> = [['h', sr.z0, sr.x0, sr.x1], ['h', sr.z1, sr.x0, sr.x1], ['v', sr.x0, sr.z0, sr.z1], ['v', sr.x1, sr.z0, sr.z1]]
      for (const [ax, c, a0, b0] of sides) {
        const t = sideIsOuter(ax, c) ? 0.755 : 0.4
        const ex = ax === 'h' ? 0 : 0
        void ex
        const put = (u0: number, u1: number, y0: number, y1: number) => (ax === 'h' ? wall(u0, u1, c - t / 2, c + t / 2, y0, y1) : wall(c - t / 2, c + t / 2, u0, u1, y0, y1))
        // the corners belong to the horizontal walls: they run the full width plus the thickness of the vertical walls
        const A = ax === 'h' ? a0 - (sideIsOuter('v', sr.x0) ? 0.378 : 0.2) : a0 + (sideIsOuter('h', sr.z0) ? 0.378 : 0.2)
        const B = ax === 'h' ? b0 + (sideIsOuter('v', sr.x1) ? 0.378 : 0.2) : b0 - (sideIsOuter('h', sr.z1) ? 0.378 : 0.2)
        if (door && door.axis === ax && Math.abs(door.c - c) < 0.01) {
          put(A, door.a, ws, hy)
          put(door.b, B, ws, hy)
          put(door.a, door.b, ws + ENVELOPE.mumtyDoorH, hy)          // lintel over the door
        } else if (B - A >= 6) {
          // a small stair window in a long blank wall: sill 3.5 ft above the terrace, head at 6 ft, with a frame and glass
          const mid = (A + B) / 2, hw = 1.25
          put(A, mid - hw, ws, hy); put(mid + hw, B, ws, hy)
          put(mid - hw, mid + hw, ws, ws + 3.5); put(mid - hw, mid + hw, ws + 6, hy)
          const pane = (u0: number, u1: number, y0: number, y1: number, m: Mat, th: number, o?: { cast?: boolean }) => (ax === 'h' ? bx(roof, m, u0, u1, y0, y1, c - th / 2, c + th / 2, o) : bx(roof, m, c - th / 2, c + th / 2, y0, y1, u0, u1, o))
          pane(mid - hw, mid + hw, ws + 3.5, ws + 6, glass, 0.04, { cast: false })
          pane(mid - hw - 0.1, mid - hw, ws + 3.4, ws + 6.1, R.ext.trim, t + 0.1, { cast: false }); pane(mid + hw, mid + hw + 0.1, ws + 3.4, ws + 6.1, R.ext.trim, t + 0.1, { cast: false })
          pane(mid - hw - 0.1, mid + hw + 0.1, ws + 3.3, ws + 3.5, R.ext.trim, t + 0.15, { cast: false }); pane(mid - hw - 0.1, mid + hw + 0.1, ws + 6, ws + 6.15, R.ext.trim, t + 0.1, { cast: false })
        } else put(A, B, ws, hy)
      }
      // a high ventilation slot on the side that faces the street-less end so the headroom is not a closed box: a small window opposite the door
      bx(roof, roofTop, sr.x0 - 0.3, sr.x1 + 0.3, hy, hy + SLAB, sr.z0 - 0.3, sr.z1 + 0.3, { struct: true, edge: true })    // cover slab with a drip edge
      envelope.mumty.push({ room: asR4(r), lobby: { x0: lb.x0, x1: lb.x1, z0: lb.z0, z1: lb.z1 }, door, walls: wallBoxes, coverY: hy, floorY: ws })
      if (door) {
        // the door leaf (swings out onto the terrace) and a plain frame; it is a real door: it opens with the other doors
        const virtual: RoomR = door.axis === 'h'
          ? { room_type: 'open_terrace', x: door.a - 1, x2: door.b + 1, y: door.out > 0 ? door.c : door.c - 4, y2: door.out > 0 ? door.c + 4 : door.c }
          : { room_type: 'open_terrace', y: door.a - 1, y2: door.b + 1, x: door.out > 0 ? door.c : door.c - 4, x2: door.out > 0 ? door.c + 4 : door.c }
        const leaf = makeDoor({ axis: door.axis, c: door.c, a: door.a, b: door.b, kind: 'door', owner: virtual }, ws,
          { leaf: R.doorMat, main: R.mainDoorMat, handle: R.handle, carved: R.style.interior.doors !== 'flush' ? { border: R.furn.carved, brass: R.furn.brassM, grand: false } : undefined })
        if (leaf) { roof.add(leaf.pivot); roof.add(leaf.arc); doors.push(leaf) }
        const fw = 0.22, ft = 0.5
        const frame = (u0: number, u1: number, y0: number, y1: number) => (door.axis === 'h' ? bx(roof, R.ext.trim, u0, u1, y0, y1, door.c - ft / 2, door.c + ft / 2, { cast: false }) : bx(roof, R.ext.trim, door.c - ft / 2, door.c + ft / 2, y0, y1, u0, u1, { cast: false }))
        frame(door.a - fw, door.a, ws, ws + ENVELOPE.mumtyDoorH + 0.2); frame(door.b, door.b + fw, ws, ws + ENVELOPE.mumtyDoorH + 0.2)
        frame(door.a - fw, door.b + fw, ws + ENVELOPE.mumtyDoorH, ws + ENVELOPE.mumtyDoorH + 0.2)
        // a landing step in front of the door, so the threshold is level with the terrace
      }
      if (tiledRoof) capRoof(roofG, RM, { x0: r.x - 0.3, x1: rx2(r) + 0.3, z0: r.y - 0.3, z1: ry2(r) + 0.3 }, hy + SLAB)
      continue
    }
    // every other room (and, without a terrace, the stair room too: the stair ends on the top floor, so its room is simply roofed)
    bx(roof, roofTop, r.x - 0.1, rx2(r) + 0.1, roofY, roofY + SLAB, r.y - 0.1, ry2(r) + 0.1, { struct: true })
  }
  // the roof edge: every run of the roof outline that is not shared with another roofed room (the stair room counts as occupied: its headroom walls close that side)
  const roofOutline: R4[] = hasTerr ? roofedR : [...roofedR, ...stairTopR]
  const roofCover: R4[] = [...roofedR, ...stairTopR]
  const edgesAll = exposedEdges(roofOutline, roofCover)
  // flat roof: an overhang round the outside of the building, with a drip fascia (the terrace parapet stands on the wall line, inside it)
  {
    // the RCC slab overhang is structure, so it is the same in every style (a tiled roof sits on it and carries its own eave beyond); only the plain drip fascia is Modern's
    const patches = overhangPatches(edgesAll, ovBy, outerPt)
    for (const q of patches) {
      bx(roof, roofTop, q.x0, q.x1, roofY, roofY + SLAB, q.z0, q.z1, { struct: true })
      envelope.overhang.push({ ...q })
    }
    if (!tiledRoof || hasTerr)
    for (const f of fasciaRuns(edgesAll, ovBy, patches, outerPt)) {
      const f0 = Math.min(f.c, f.c - f.out * 0.14), f1 = Math.max(f.c, f.c - f.out * 0.14)
      if (f.axis === 'h') bx(roof, R.ext.trim, f.a, f.b, roofY - 0.3, roofY + SLAB + 0.02, f0, f1, { cast: true, edge: true })
      else bx(roof, R.ext.trim, f0, f1, roofY - 0.3, roofY + SLAB + 0.02, f.a, f.b, { cast: true, edge: true })
    }
  }
  // terrace: a parapet along every exposed edge of the roof (never across the stair headroom's door)
  if (hasTerr) {
    const ty = roofY + SLAB
    const par = ENVELOPE.parapetFt
    const isOuterEdge = (e: Edge) => outerPt(e.axis === 'h' ? (e.a + e.b) / 2 : e.c + e.out * 0.3, e.axis === 'h' ? e.c + e.out * 0.3 : (e.a + e.b) / 2)
    const hrWalls = envelope.mumty.flatMap((m) => m.walls)
    for (const q0 of parapetBoxes(edgesAll, isOuterEdge)) {
      // a parapet ends at the face of the stair head-room's wall it runs into (no overlapping boxes)
      const q = { x0: q0.x0, x1: q0.x1, z0: q0.z0, z1: q0.z1 }
      const alongX = q.x1 - q.x0 >= q.z1 - q.z0
      for (const w of hrWalls) {
        if (q.x1 <= w.x0 + 1e-4 || w.x1 <= q.x0 + 1e-4 || q.z1 <= w.z0 + 1e-4 || w.z1 <= q.z0 + 1e-4) continue
        if (alongX) { if ((q.x0 + q.x1) / 2 < (w.x0 + w.x1) / 2) q.x1 = Math.min(q.x1, w.x0); else q.x0 = Math.max(q.x0, w.x1) }
        else if ((q.z0 + q.z1) / 2 < (w.z0 + w.z1) / 2) q.z1 = Math.min(q.z1, w.z0)
        else q.z0 = Math.max(q.z0, w.z1)
      }
      if (q.x1 - q.x0 < 0.05 || q.z1 - q.z0 < 0.05) continue
      bx(roof, R.ext.wallCol, q.x0, q.x1, ty, ty + par, q.z0, q.z1, { struct: true })
      bx(roof, R.ext.cap, q.x0 - 0.05, q.x1 + 0.05, ty + par, ty + par + 0.12, q.z0 - 0.05, q.z1 + 0.05, { cast: false })
      envelope.parapets.push({ x0: q.x0, x1: q.x1, z0: q.z0, z1: q.z1, y0: ty, y1: ty + par + 0.12 })
    }
  }
  if (tiledRoof) {
    // Traditional Indian: a hipped clay-tile roof over the top floor (a roof terrace stays open: it gets a tiled eave round its parapet instead)
    const indoorTop = topRooms.filter((q) => !OPEN_TYPES.has(q.room_type))
    const topCourt = topRooms.filter((q) => q.room_type === 'courtyard')
    if (!hasTerr && indoorTop.length && topCourt.length === 1) {
      const cq = topCourt[0]
      ringRoof(roofG, RM, bboxOf([...indoorTop, cq]), { x0: cq.x, x1: rx2(cq), z0: cq.y, z1: ry2(cq) }, roofY + SLAB, { over: EAVE, rise: 3.2 })
    } else if (!hasTerr && indoorTop.length && topCourt.length === 0) hipRoof(roofG, RM, bboxOf(indoorTop), roofY + SLAB, { pitch: 0.46, over: EAVE, maxRise: 6.5 })
    if (hasTerr && edgesAll.length) {
      const bb = bboxOf(roofOutline.map((q) => ({ x: q.x0, y: q.z0, x2: q.x1, y2: q.z1 } as unknown as RoomT)))
      const area = roofOutline.reduce((acc, q) => acc + (q.x1 - q.x0) * (q.z1 - q.z0), 0)
      if (Math.abs(area - (bb.x1 - bb.x0) * (bb.z1 - bb.z0)) < 0.5) skirt(roofG, RM, bb, roofY + SLAB + ENVELOPE.parapetFt - 0.1)   // a plain rectangle: the mitred tile apron
      else for (const q of parapetBoxes(edgesAll, () => true)) skirt(roofG, RM, { x0: q.x0, x1: q.x1, z0: q.z0, z1: q.z1 }, roofY + SLAB + ENVELOPE.parapetFt - 0.1, { width: 1.2 })
    }
    for (const j of leanJobs) leanTo(roofG, RM, j.rc, j.lean, j.y0, j.ext)
    mergeByMaterial(roofG)
    roof.add(roofG)
  }
  root.add(roof)

  // ---------------------------------------------------------------- exterior: porch, compound wall + gate, driveway path, road, trees
  const exterior = new THREE.Group()
  const vehicles = new THREE.Group()
  const parked: TwinModel['parking'] = { room: null, cars: [], bikes: [] }
  {
    const wallCol = R.ext.wallCol
    const capCol = R.ext.cap
    const metalM = R.ext.gate
    const alongRoad = road.x !== 0 // gate runs along z when the road is east/west
    const doorMid = mseg ? (mseg.a + mseg.b) / 2 : alongRoad ? pz + plot.length / 2 : px + plot.width / 2
    // front wall coordinate (plot edge on the road side) and the gate gap
    const edge = road.z > 0 ? pz + plot.length : road.z < 0 ? pz : road.x > 0 ? px + plot.width : px
    const H = 4.6, TH = 0.6
    const pk0 = (plan.floors[0].layout?.usable_plot as unknown as { reserved_regions?: Array<{ x: number; y: number; width: number; length: number }> } | undefined)?.reserved_regions?.[0]
    const pkRoom = (plan.floors[0].layout?.rooms ?? []).map((q) => q as unknown as RoomT).find((q) => q.room_type === 'parking' || q.room_type === 'bike_parking')
    const pk = pkRoom ? { x: pkRoom.x, y: pkRoom.y, width: rx2(pkRoom) - pkRoom.x, length: ry2(pkRoom) - pkRoom.y } : pk0
    const pkInfo0 = (plan as unknown as { parking?: { required?: boolean; cars?: number; bikes?: number } }).parking
    const pkInfo = pkInfo0 ?? (pkRoom ? { required: true, cars: 1, bikes: 0 } : undefined)

    // the street: pavement and carriageway on the road side (outside the plot; the plan only gives the side)
    {
      const L = 90
      const sw = 5, rw = 24
      const cx = px + plot.width / 2, cz = pz + plot.length / 2
      const strip = (o0: number, o1: number, y1: number, m: THREE.Material) => {
        const a = Math.min(o0, o1), b = Math.max(o0, o1)
        if (alongRoad) bx(exterior, m, a, b, -0.05, y1, cz - L, cz + L, { cast: false })
        else bx(exterior, m, cx - L, cx + L, -0.05, y1, a, b, { cast: false })
      }
      const s = road.x > 0 || road.z > 0 ? 1 : -1
      const walk = surface({ kind: 'paving', color: 0xb8b2a6 }) // the public pavement is the same in every style; only the plot's own paving follows the style
      strip(edge, edge + s * sw, 0.06, walk)
      strip(edge + s * sw, edge + s * (sw + rw), 0.0, asphalt)
      strip(edge + s * (sw + rw), edge + s * (sw + rw + sw), 0.06, walk)
      const mid = edge + s * (sw + rw / 2)
      const dash = solid(0xe9e6dc, 0.9)
      for (let q = -L; q < L; q += 9) {
        if (alongRoad) bx(exterior, dash, mid - 0.15, mid + 0.15, 0.0, 0.02, cz + q, cz + q + 4.5, { cast: false })
        else bx(exterior, dash, cx + q, cx + q + 4.5, 0.0, 0.02, mid - 0.15, mid + 0.15, { cast: false })
      }
    }

    // gaps in the front wall: a pedestrian gate at the door, and a wide vehicle gate over the parking bay
    let gaps: Array<[number, number, boolean]> = [[doorMid - 2, doorMid + 2, false]]
    if (pk && pkInfo?.required) {
      if (pkRoom) parked.room = { x: pk.x, y: pk.y, width: pk.width, length: pk.length }
      const c = alongRoad ? pk.y + pk.length / 2 : pk.x + pk.width / 2
      const ext = alongRoad ? pk.length : pk.width
      const half = Math.max(6, ext / 2 + 0.8)
      gaps = [[c - half, c + half, true]]
      if (Math.abs(doorMid - c) > half + 3) gaps.push([doorMid - 2, doorMid + 2, false])
    } else gaps = [[doorMid - 6, doorMid + 6, true]]
    gaps.sort((p, q) => p[0] - q[0])
    const wallRun = (a: number, b: number, c: number, horiz: boolean) => {
      if (b - a < 0.05) return
      if (horiz) { bx(exterior, wallCol, a, b, 0, H, c - TH / 2, c + TH / 2); bx(exterior, capCol, a - 0.1, b + 0.1, H, H + 0.3, c - TH / 2 - 0.1, c + TH / 2 + 0.1) }
      else { bx(exterior, wallCol, c - TH / 2, c + TH / 2, 0, H, a, b); bx(exterior, capCol, c - TH / 2 - 0.1, c + TH / 2 + 0.1, H, H + 0.3, a - 0.1, b + 0.1) }
    }
    const x0 = px, x1 = px + plot.width, z0 = pz, z1 = pz + plot.length
    // a plan whose main door is NOT on the road side (an uploaded drawing: the road side is a separate choice) would have its front door shut in by the compound wall:
    // the plot edge the door faces gets a pedestrian opening in front of the door as well
    const doorEdge0: 'x0' | 'x1' | 'z0' | 'z1' | null = mseg ? (mseg.line.axis === 'h' ? (mseg.line.c <= bz0 + 0.01 ? 'z0' : 'z1') : (mseg.line.c <= bx0 + 0.01 ? 'x0' : 'x1')) : null
    const frontEdge0 = road.z < 0 ? 'z0' : road.z > 0 ? 'z1' : road.x < 0 ? 'x0' : 'x1'
    const sideGap: Array<[number, number, boolean]> = mseg && doorEdge0 && doorEdge0 !== frontEdge0 ? [[doorMid - 2.5, doorMid + 2.5, false]] : []
    const gapped = (a: number, b: number, c: number, horiz: boolean, isFront: boolean, name: 'x0' | 'x1' | 'z0' | 'z1') => {
      const gs = isFront ? gaps : name === doorEdge0 ? sideGap : []
      if (!gs.length) { wallRun(a, b, c, horiz); return }
      let cur = a
      for (const [g0, g1] of gs) {
        wallRun(cur, Math.min(b, g0), c, horiz)
        cur = Math.max(cur, g1)
      }
      wallRun(cur, b, c, horiz)
    }
    gapped(x0, x1, z0, true, road.z < 0, 'z0')
    gapped(x0, x1, z1, true, road.z > 0, 'z1')
    gapped(z0, z1, x0, false, road.x < 0, 'x0')
    gapped(z0, z1, x1, false, road.x > 0, 'x1')
    // gates: bars between two pillars, in each gap left in the front wall; a lamp on each pillar
    const lampM = lightGlow(0xffe2b0, 0.3, 2.6)
    const timberGate = R.style.exterior.gate === 'timber'
    const pillarLamp = (cxp: number, czp: number, top: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), lampM)
      m.position.set(cxp, top + (tiledRoof ? 1.0 : 0.45), czp)
      exterior.add(m)
    }
    for (const [g0, g1] of gaps) {
      if (alongRoad) {
        const gx = edge
        if (!opts.walkable) {
          if (timberGate) {
            for (let q = g0 + 0.3; q < g1 - 0.4; q += 0.5) bx(exterior, metalM, gx - 0.07, gx + 0.07, 0.3, H - 0.3, q, q + 0.46)
            for (const [y0, y1] of [[0.9, 1.25], [2.4, 2.75]]) bx(exterior, metalM, gx - 0.11, gx + 0.11, y0, y1, g0, g1)
            bx(exterior, R.ext.stone, gx - 0.05, gx + 0.05, 0.3, H - 0.3, (g0 + g1) / 2 - 0.03, (g0 + g1) / 2 + 0.03)
          } else for (let q = g0 + 0.4; q < g1 - 0.2; q += 0.55) bx(exterior, metalM, gx - 0.05, gx + 0.05, 0.3, H - 0.2, q, q + 0.08)
          bx(exterior, metalM, gx - 0.06, gx + 0.06, H - 0.4, H - 0.2, g0, g1)
          bx(exterior, metalM, gx - 0.06, gx + 0.06, 0.3, 0.5, g0, g1)
        }
        for (const gz of [g0 - 0.6, g1]) {
          bx(exterior, wallCol, gx - 0.7, gx + 0.7, 0, H + 1.2, gz, gz + 0.6); bx(exterior, capCol, gx - 0.8, gx + 0.8, H + 1.2, H + 1.5, gz - 0.1, gz + 0.7)
          if (tiledRoof) hipRoof(exterior, RM, { x0: gx - 0.8, x1: gx + 0.8, z0: gz - 0.1, z1: gz + 0.7 }, H + 1.5, { pitch: 0.8, over: 0.1, maxRise: 1.2, trim: false })
          if (R.ext.lights) pillarLamp(gx, gz + 0.3, H + 1.5)
        }
      } else {
        const gz = edge
        if (!opts.walkable) {
          if (timberGate) {
            for (let q = g0 + 0.3; q < g1 - 0.4; q += 0.5) bx(exterior, metalM, q, q + 0.46, 0.3, H - 0.3, gz - 0.07, gz + 0.07)
            for (const [y0, y1] of [[0.9, 1.25], [2.4, 2.75]]) bx(exterior, metalM, g0, g1, y0, y1, gz - 0.11, gz + 0.11)
            bx(exterior, R.ext.stone, (g0 + g1) / 2 - 0.03, (g0 + g1) / 2 + 0.03, 0.3, H - 0.3, gz - 0.05, gz + 0.05)
          } else for (let q = g0 + 0.4; q < g1 - 0.2; q += 0.55) bx(exterior, metalM, q, q + 0.08, 0.3, H - 0.2, gz - 0.05, gz + 0.05)
          bx(exterior, metalM, g0, g1, H - 0.4, H - 0.2, gz - 0.06, gz + 0.06)
          bx(exterior, metalM, g0, g1, 0.3, 0.5, gz - 0.06, gz + 0.06)
        }
        for (const gx of [g0 - 0.6, g1]) {
          bx(exterior, wallCol, gx, gx + 0.6, 0, H + 1.2, gz - 0.7, gz + 0.7); bx(exterior, capCol, gx - 0.1, gx + 0.7, H + 1.2, H + 1.5, gz - 0.8, gz + 0.8)
          if (tiledRoof) hipRoof(exterior, RM, { x0: gx - 0.1, x1: gx + 0.7, z0: gz - 0.8, z1: gz + 0.8 }, H + 1.5, { pitch: 0.8, over: 0.1, maxRise: 1.2, trim: false })
          if (R.ext.lights) pillarLamp(gx + 0.3, gz, H + 1.5)
        }
      }
    }
    // path from the gate to the door, a covered porch and a wall light
    if (mseg) {
      const doorEdge = mseg.line.c
      const lo = Math.min(edge, doorEdge), hi = Math.max(edge, doorEdge)
      if (alongRoad) bx(exterior, R.ext.paving, lo, hi, 0, 0.1, doorMid - 2.5, doorMid + 2.5, { cast: false })
      else bx(exterior, R.ext.paving, doorMid - 2.5, doorMid + 2.5, 0, 0.1, lo, hi, { cast: false })
      const out = mseg.line.axis === 'h' ? (mseg.line.c <= bz0 + 0.01 ? -1 : 1) : (mseg.line.c <= bx0 + 0.01 ? -1 : 1)
      const setbackFt = Math.abs(edge - mseg.line.c)   // the verandah never reaches the front wall: it is made shallower on a shallow setback
      const pw = wadaPorch ? 10.8 : pillared ? 7.4 : 7, pd = wadaPorch ? Math.max(3.4, Math.min(5.6, setbackFt - 1.1)) : pillared ? 4.4 : 3.6, py = SLAB + (wadaPorch ? 7.7 : pillared ? 7.5 : 7.6)
      const c0 = mseg.line.c
      const A = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, m: THREE.Material) => {
        const va = c0 + out * v0, vb = c0 + out * v1
        const lo2 = Math.min(va, vb), hi2 = Math.max(va, vb)
        if (mseg.line.axis === 'h') bx(exterior, m, doorMid + u0, doorMid + u1, y0, y1, lo2, hi2)
        else bx(exterior, m, lo2, hi2, y0, y1, doorMid + u0, doorMid + u1)
      }
      if (!pillared && !wadaPorch) {
        A(-pw / 2, pw / 2, 0.2, pd, py, py + 0.35, R.ext.main)
        A(-pw / 2 - 0.1, pw / 2 + 0.1, 0.2, pd + 0.1, py + 0.35, py + 0.6, capCol)
        for (const u of [-pw / 2 + 0.25, pw / 2 - 0.45]) A(u, u + 0.4, pd - 0.55, pd - 0.15, SLAB, py, R.ext.trim)
      } else if (wadaPorch) {
        // Maharashtrian Wada: a raised otta (verandah platform) with six carved teak columns, cusped arches between them, side seats with timber
        // balustrades, a carved door frame with an arched head, hanging brass lanterns and a shallow tiled lean-to roof with a deep eave.
        const Wd = (u: number, v: number): [number, number] => (mseg.line.axis === 'h' ? [doorMid + u, c0 + out * v] : [c0 + out * v, doorMid + u])
        const beam: 'x' | 'z' = mseg.line.axis === 'h' ? 'x' : 'z'
        const timber = R.ext.timber
        const dw = Math.max(3, mseg.b - mseg.a)
        const iu = Math.max(1.9, dw / 2 + 0.7)
        const uO = pw / 2 - 0.65, vF = pd - 0.65, vB = 0.65
        A(-pw / 2, pw / 2, 0.2, pd + 0.1, 0.2, 0.32, R.ext.stone)                                   // the otta floor (flush with the house floor)
        A(-2.2, 2.2, pd + 0.1, pd + 0.62, 0, 0.17, R.ext.stone)                                      // entrance step
        const colU = [-uO, -iu, iu, uO]
        for (const u of colU) {
          A(u - 0.5, u + 0.5, vF - 0.5, vF + 0.5, 0.32, 0.62, R.ext.stone)                            // stone base
          const [wx, wz] = Wd(u, vF)
          carvedPillar(exterior, timber, wx, wz, 0.62, py, beam)
        }
        for (const u of [-uO, uO]) {
          A(u - 0.5, u + 0.5, vB - 0.5, vB + 0.5, 0.32, 0.62, R.ext.stone)
          const [wx, wz] = Wd(u, vB)
          carvedPillar(exterior, timber, wx, wz, 0.62, py, beam)
        }
        // beams: the front beam across all four columns, a beam on each side and a wall plate along the facade
        A(-uO - 0.55, uO + 0.55, vF - 0.28, vF + 0.28, py, py + 0.6, timber)
        A(-uO - 0.55, uO + 0.55, vF - 0.3, vF + 0.3, py + 0.6, py + 0.72, R.furn.carved)
        for (const u of [-uO, uO]) A(u - 0.28, u + 0.28, 0.0, vF, py, py + 0.6, timber)
        A(-pw / 2 + 0.1, pw / 2 - 0.1, 0.0, 0.4, py, py + 0.6, timber)
        // cusped arches between the columns (front and sides)
        const spans: Array<[number, number]> = [[-uO, -iu], [-iu, iu], [iu, uO]]
        for (const [a0, a1] of spans) {
          const [wx, wz] = Wd((a0 + a1) / 2, vF)
          cuspedArch(exterior, timber, wx, wz, beam, py - 2.25, a1 - a0 - 0.6, 2.25, 0.2, a1 - a0 > 3.2 ? 7 : 5)
        }
        for (const u of [-uO, uO]) {
          const [wx, wz] = Wd(u, (vB + vF) / 2)
          cuspedArch(exterior, timber, wx, wz, beam === 'x' ? 'z' : 'x', py - 2.25, vF - vB - 0.6, 2.25, 0.2, 5)
        }
        // side seats (kaksh asan): a plastered seat with a timber top and a turned balustrade behind it
        for (const sd of [-1, 1]) {
          A(sd * (pw / 2 - 1.2) - 0.5, sd * (pw / 2 - 1.2) + 0.5, vB + 0.7, vF - 0.7, 0.32, 1.5, R.ext.wallCol)
          A(sd * (pw / 2 - 1.2) - 0.58, sd * (pw / 2 - 1.2) + 0.58, vB + 0.65, vF - 0.65, 1.5, 1.68, timber)
          const sideU = sd * (pw / 2 - 0.25)
          const [xa, za] = Wd(sideU, vB + 0.7), [xb, zb] = Wd(sideU, vF - 0.7)
          if (mseg.line.axis === 'h') timberBalustrade(exterior, timber, 'z', xa, Math.min(za, zb), Math.max(za, zb), 1.68, 1.9)
          else timberBalustrade(exterior, timber, 'x', za, Math.min(xa, xb), Math.max(xa, xb), 1.68, 1.9)
        }
        // the carved door frame: jambs, a deep lintel and a cusped arch over it, proud of the facade
        A(-dw / 2 - 0.55, -dw / 2 + 0.02, 0.0, 0.3, SLAB, 7.4, timber)
        A(dw / 2 - 0.02, dw / 2 + 0.55, 0.0, 0.3, SLAB, 7.4, timber)
        A(-dw / 2 - 0.65, dw / 2 + 0.65, 0.0, 0.34, 7.4, 7.9, timber)
        A(-dw / 2 - 0.75, dw / 2 + 0.75, 0.0, 0.38, 7.9, 8.05, R.furn.carved)
        {
          const [wx, wz] = Wd(0, 0.17)
          cuspedArch(exterior, timber, wx, wz, beam, 8.05, dw + 1.3, 1.5, 0.16, 5)
        }
        // roof: a shallow tiled lean-to from the beam up to the facade, the deep eave projecting past the columns
        {
          const [xa, za] = Wd(-pw / 2, 0), [xb, zb] = Wd(pw / 2, pd + 0.3)
          const rc = { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) }
          const lean = (mseg.line.axis === 'h' ? (out > 0 ? 'z0' : 'z1') : (out > 0 ? 'x0' : 'x1')) as 'x0' | 'x1' | 'z0' | 'z1'
          const ext = { x0: lean !== 'x0', x1: lean !== 'x1', z0: lean !== 'z0', z1: lean !== 'z1' }
          const yBase = py + 0.72
          const rise = Math.max(0.7, Math.min(2.4, WALL_H - 0.5 - yBase))
          leanTo(exterior, RM, rc, lean, yBase, ext, { rise, over: EAVE * 0.62 })
        }
        // hanging brass lanterns on both sides of the door, and a marigold toran over it
        for (const u of [-dw / 2 - 1.1, dw / 2 + 1.1]) {
          const [wx, wz] = Wd(u, vF)
          lantern(exterior, R.furn.brassM, lampM, wx, py - 0.05, wz, { chain: 0.9 })
        }
        {
          const [xa, za] = Wd(-dw / 2 - 0.2, 0.55), [xb, zb] = Wd(dw / 2 + 0.2, 0.55)
          toran(exterior, xa, za, xb, zb, 7.15, 0.5)
        }
      } else {
        // pillared verandah: teak pillars on stone bases, a tie beam, a turned balustrade and a gabled tile roof
        const Wd = (u: number, v: number): [number, number] => (mseg.line.axis === 'h' ? [doorMid + u, c0 + out * v] : [c0 + out * v, doorMid + u])
        const cyl = (u: number, v: number, y0: number, y1: number, r0: number, r1: number, m: THREE.Material, seg = 12) => {
          const [wx, wz] = Wd(u, v)
          const me = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg), m)
          me.position.set(wx, (y0 + y1) / 2, wz); me.castShadow = true; exterior.add(me)
        }
        const uP = pw / 2 - 0.55, vP = pd - 0.55
        const timber = R.ext.timber
        for (const u of [-uP, uP]) {
          A(u - 0.45, u + 0.45, vP - 0.45, vP + 0.45, 0.2, 1.7, R.ext.stone)
          A(u - 0.52, u + 0.52, vP - 0.52, vP + 0.52, 1.7, 1.86, R.ext.stone)
          cyl(u, vP, 1.86, py - 0.62, 0.3, 0.25, timber)
          for (const y of [2.05, py - 0.85]) cyl(u, vP, y, y + 0.14, 0.37, 0.37, timber)
          cyl(u, vP, 3.1, 3.22, 0.32, 0.32, timber)
          A(u - 0.42, u + 0.42, vP - 0.42, vP + 0.42, py - 0.62, py - 0.42, timber)
          A(u - 0.95, u + 0.95, vP - 0.17, vP + 0.17, py - 0.6, py - 0.5, timber)          // carved bracket under the beam
          A(u - 0.7, u + 0.7, vP - 0.17, vP + 0.17, py - 0.76, py - 0.6, timber)
        }
        A(-uP - 0.55, uP + 0.55, vP - 0.22, vP + 0.22, py - 0.5, py, timber)                      // tie beam
        for (const u of [-uP, uP]) A(u - 0.2, u + 0.2, 0.25, vP - 0.45, py - 0.5, py, timber)   // side beams to the wall
        const balu = (u0: number, u1: number, v0: number, v1: number) => {
          const alongU = u1 - u0 >= v1 - v0, len = alongU ? u1 - u0 : v1 - v0
          if (len < 0.6) return
          const um = (u0 + u1) / 2, vm = (v0 + v1) / 2
          A(u0, u1, v0, v1, 0.2, 0.55, R.ext.stone)
          A(alongU ? u0 : um - 0.15, alongU ? u1 : um + 0.15, alongU ? vm - 0.15 : v0, alongU ? vm + 0.15 : v1, 2.6, 2.85, timber)
          const n = Math.max(2, Math.round(len / 0.42))
          for (let i = 0; i <= n; i++) {
            const q = (alongU ? u0 : v0) + (len * i) / n
            const uu = alongU ? q : um, vv = alongU ? vm : q
            cyl(uu, vv, 0.55, 2.6, 0.075, 0.075, timber, 6)
            cyl(uu, vv, 1.3, 1.62, 0.1, 0.1, timber, 6)
          }
        }
        balu(-uP + 0.5, -2.35, vP - 0.1, vP + 0.1); balu(2.35, uP - 0.5, vP - 0.1, vP + 0.1)    // front, either side of the path
        for (const u of [-uP, uP]) balu(u - 0.1, u + 0.1, 0.45, vP - 0.5)                          // sides
        gablePorchRoof(exterior, RM, { axis: mseg.line.axis, c: c0 + out * 0.2, mid: doorMid, out: (out > 0 ? 1 : -1) as 1 | -1 }, { w: pw, dpt: pd - 0.2, yb: py, rise: 2.0, over: 0.9 })
      }
      A(-pw / 2, pw / 2, 0.2, pd + 0.5, 0, 0.2, R.ext.plinth)
      A(-pw / 2 + 0.4, pw / 2 - 0.4, pd + 0.5, pd + 1.3, 0, 0.1, R.ext.plinth)
      // downlights under the canopy and a lantern beside the door
      if (R.ext.lights) {
        const dl = lightGlow(0xfff0d0, 0.2, 2.8)
        for (const u of [-1.6, 1.6]) {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16), dl)
          const vv = c0 + out * 1.9
          if (mseg.line.axis === 'h') m.position.set(doorMid + u, py - 0.02, vv)
          else m.position.set(vv, py - 0.02, doorMid + u)
          exterior.add(m)
        }
        const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 10), lampM)
        const lv = c0 + out * 0.45
        if (mseg.line.axis === 'h') lantern.position.set(doorMid + 3.0, SLAB + 5.6, lv)
        else lantern.position.set(lv, SLAB + 5.6, doorMid + 3.0)
        exterior.add(lantern)
        const pl = new THREE.PointLight(0xffd7a0, 0, 0, 2)
        const vv = c0 + out * 2.2
        if (mseg.line.axis === 'h') pl.position.set(doorMid, SLAB + 6.4, vv)
        else pl.position.set(vv, SLAB + 6.4, doorMid)
        lights.push({ light: pl, floor: -1, on: 70 })
        root.add(pl)
      }
      // pots beside the door
      if (R.ext.landscaping) {
        for (const u of [-pw / 2 + 0.2, pw / 2 - 0.2]) {
          const vv = c0 + out * (pd + 0.9)
          const hx = mseg.line.axis === 'h' ? doorMid + u : vv, hz = mseg.line.axis === 'h' ? vv : doorMid + u
          const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.36, 0.9, 14), R.furn.pot)
          pot.position.set(hx, 0.45, hz); pot.castShadow = true; exterior.add(pot)
          for (let k = 0; k < 5; k++) {
            const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 - k * 0.04, 1), k % 2 ? R.furn.leaf2 : R.furn.leaf)
            b.position.set(hx + Math.sin(k * 2.4) * 0.22, 1.15 + k * 0.2, hz + Math.cos(k * 2.4) * 0.22); b.castShadow = true; exterior.add(b)
          }
        }
      }
    }
    // Maharashtrian Wada: a paved front angan, a tulsi vrindavan beside the steps and a rangoli on the path (only where the plot has room: nothing is invented
    // inside the setbacks, and the paving never covers the parking bay)
    if (mseg && wadaPorch && R.ext.landscaping) {
      const out2 = mseg.line.axis === 'h' ? (mseg.line.c <= bz0 + 0.01 ? -1 : 1) : (mseg.line.c <= bx0 + 0.01 ? -1 : 1)
      const c1 = mseg.line.c
      const W2 = (u: number, v: number): [number, number] => (mseg.line.axis === 'h' ? [doorMid + u, c1 + out2 * v] : [c1 + out2 * v, doorMid + u])
      const inPlot = (x: number, z: number, m: number) => x > px + m && x < px + plot.width - m && z > pz + m && z < pz + plot.length - m
      const hitsPark = (x0: number, x1: number, z0: number, z1: number) => Boolean(pk && pkInfo?.required && x1 > pk.x - 0.5 && x0 < pk.x + pk.width + 0.5 && z1 > pk.y - 0.5 && z0 < pk.y + pk.length + 0.5)
      const depth = Math.abs(edge - c1) - 5.6          // free depth between the verandah and the front wall
      if (depth > 3.2) {
        const [xa, za] = W2(-4.8, 6.0), [xb, zb] = W2(4.8, Math.min(depth + 4.0, 12))
        const ax0 = Math.min(xa, xb), ax1 = Math.max(xa, xb), az0 = Math.min(za, zb), az1 = Math.max(za, zb)
        if (!hitsPark(ax0, ax1, az0, az1)) wbox(exterior, R.ext.clay, ax0, ax1, 0, 0.1, az0, az1, { cast: false })
        const [rx, rz] = W2(0, 6.9)
        if (inPlot(rx, rz, 1) && !hitsPark(rx - 1.5, rx + 1.5, rz - 1.5, rz + 1.5)) rangoli(exterior, rx, 0.1, rz, 1.4)
        const [tx, tz] = W2(-5.9, 8.2)
        if (depth > 5 && inPlot(tx, tz, 2) && !hitsPark(tx - 1.6, tx + 1.6, tz - 1.6, tz + 1.6)) {
          tulsiVrindavan(exterior, { plaster: R.ext.wallCol, stone: R.ext.stone, cap: R.ext.cap, pot: R.furn.pot, leaf: R.furn.leaf, leaf2: R.furn.leaf2, brass: R.furn.brassM, glow: lampM, dark: solid(0x2a1c12, 1) }, tx, tz)
        }
      }
    }
    // trees, shrubs and (when asked for) garden lights in the green areas of the plot
    const regions = ((plan.floors[0].layout?.open_spaces?.regions ?? []) as Array<{ type?: string; x: number; y: number; width: number; length: number }>)
      .filter((q) => !(q.type ?? '').includes('park') && q.width > 4 && q.length > 4)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    if (R.ext.landscaping) {
      const trunk = solid(0x6b4a2b, 1)
      const greens = [R.furn.leaf, R.furn.leaf2, solid(0x3f7541, 0.9)]
      const blob = (cx: number, cy: number, cz: number, rad: number, m: THREE.Material) => {
        const geo = new THREE.IcosahedronGeometry(rad, 2)
        const p = geo.getAttribute('position') as THREE.BufferAttribute
        for (let i = 0; i < p.count; i++) { const k = 1 + (rnd() - 0.5) * 0.28; p.setXYZ(i, p.getX(i) * k, p.getY(i) * (0.9 + (rnd() - 0.5) * 0.2), p.getZ(i) * k) }
        geo.computeVertexNormals()
        const mm = new THREE.Mesh(geo, m)
        mm.position.set(cx, cy, cz); mm.castShadow = true; mm.receiveShadow = true; exterior.add(mm)
      }
      const heritageLand = R.style.exterior.landscape === 'heritage'
      const trunkM = solid(0x8d7a5c, 0.95), cocoM = solid(0x6a4a24, 0.8)
      const flowerMats = [solid(0xf29a1f, 0.7), solid(0xd8344e, 0.7), solid(0xe96ba0, 0.7)]
      const seg = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, m: THREE.Material) => {
        const len = a.distanceTo(b)
        const me = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 7), m)
        me.position.copy(a.clone().add(b).multiplyScalar(0.5))
        me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
        me.castShadow = true; exterior.add(me)
      }
      const frondMats = greens.slice(0, 2).map((m) => { const c = (m as THREE.MeshStandardMaterial).clone(); c.side = THREE.DoubleSide; return c })
      const frondGeo = (L: number) => {      // a tapered blade: widest a third of the way out, pointed tip
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, L * 0.35, 0, 0.32, L * 0.35, 0, -0.32, L, 0, 0], 3))
        geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0.35, 1, 0.35, 0, 1, 0.5], 2))
        geo.setIndex([0, 1, 2, 1, 3, 2])
        geo.computeVertexNormals()
        return geo
      }
      /** A coconut palm: a gently bowed ringed trunk and a crown of arching fronds (each frond = a rising and a drooping blade). */
      const palm = (cx0: number, cz0: number) => {
        const hgt = 12 + rnd() * 5, lean = rnd() * Math.PI * 2, bend = 1.0 + rnd() * 1.4
        const pts: THREE.Vector3[] = []
        for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push(new THREE.Vector3(cx0 + Math.cos(lean) * bend * t * t, hgt * t, cz0 + Math.sin(lean) * bend * t * t)) }
        for (let k = 0; k < 4; k++) seg(pts[k], pts[k + 1], 0.34 - k * 0.04, 0.3 - k * 0.04, trunkM)
        const top = pts[4]
        for (let f = 0; f < 14; f++) {
          const ang = (f / 14) * Math.PI * 2 + rnd() * 0.25, L = 2.2 + rnd() * 0.5
          let cur = top.clone()
          for (const el of [0.5, -0.45, -0.7]) {
            const d = new THREE.Vector3(Math.cos(ang) * Math.cos(el), Math.sin(el), Math.sin(ang) * Math.cos(el))
            const fr = new THREE.Mesh(frondGeo(L), frondMats[f % 2])
            fr.position.copy(cur); fr.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d); fr.castShadow = true; exterior.add(fr)
            cur = cur.clone().add(d.multiplyScalar(L * 0.92))
          }
        }
        for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), cocoM); c.position.set(top.x + Math.cos(k * 2.1) * 0.45, top.y - 0.5, top.z + Math.sin(k * 2.1) * 0.45); exterior.add(c) }
      }
      for (const q of regions) {
        const n = Math.min(4, Math.floor((q.width * q.length) / 90))
        for (let i = 0; i < n; i++) {
          const tx = q.x + 1.6 + rnd() * Math.max(0, q.width - 3.2)
          const tz = q.y + 1.6 + rnd() * Math.max(0, q.length - 3.2)
          if (Math.abs((alongRoad ? tz : tx) - doorMid) < 4.5 && (road.z > 0 ? tz > bz1 : road.z < 0 ? tz < bz0 : road.x > 0 ? tx > bx1 : tx < bx0)) continue // keep the entry clear
          if (heritageLand && i % 2 === 0) { palm(tx, tz); continue }
          const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 4.6, 8), trunk)
          tr.position.set(tx, 2.3, tz); tr.castShadow = true; exterior.add(tr)
          const rr = 1.7 + rnd() * 0.9
          for (let k = 0; k < 4; k++) blob(tx + (rnd() - 0.5) * rr * 0.9, 5.4 + k * 0.7 + rnd() * 0.5, tz + (rnd() - 0.5) * rr * 0.9, rr * (1 - k * 0.14), greens[k % 3])
        }
        // low shrubs along the edge of the green area that faces the house
        const ns = Math.min(5, Math.floor((q.width + q.length) / 9))
        for (let i = 0; i < ns; i++) {
          const sx = q.x + 0.8 + rnd() * Math.max(0, q.width - 1.6)
          const sz = q.y + 0.8 + rnd() * Math.max(0, q.length - 1.6)
          if (Math.abs((alongRoad ? sz : sx) - doorMid) < 3.5 && (road.z > 0 ? sz > bz1 : road.z < 0 ? sz < bz0 : road.x > 0 ? sx > bx1 : sx < bx0)) continue
          const sr = 0.55 + rnd() * 0.45
          blob(sx, sr * 0.8, sz, sr, greens[i % 3])
          blob(sx + sr * 0.7, sr * 0.6, sz + sr * 0.3, sr * 0.7, greens[(i + 1) % 3])
          if (heritageLand) for (let k = 0; k < 7; k++) { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), flowerMats[(i + k) % 3]); fl.position.set(sx + Math.sin(k * 2.3) * sr * 0.85, sr * 0.9 + Math.cos(k * 1.7) * sr * 0.4, sz + Math.cos(k * 2.3) * sr * 0.85); exterior.add(fl) }
        }
        if (R.ext.lights && q.width > 6 && q.length > 6) {
          const gl = lightGlow(0xffe2b0, 0.25, 2.2)
          const lx = q.x + q.width / 2, lz = q.y + q.length / 2
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 8), R.ext.gate)
          post.position.set(lx, 0.8, lz); exterior.add(post)
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), gl)
          lamp.position.set(lx, 1.75, lz); exterior.add(lamp)
        }
      }
    }
    // ---- parking: paving, bay lines and the vehicles the user chose (always visible)
    const yo = pkRoom ? SLAB - 0.08 : 0 // vehicles stand on the porch floor slab when the porch is inside the house
    if (pk && pkInfo?.required) {
      if (!pkRoom) bx(vehicles, pave, pk.x, pk.x + pk.width, 0, 0.08, pk.y, pk.y + pk.length, { cast: false })
      // driveway from the bay to the road edge
      if (road.z !== 0) {
        const a0 = road.z > 0 ? pk.y + pk.length : edge, a1 = road.z > 0 ? edge : pk.y
        bx(vehicles, pave, pk.x, pk.x + pk.width, 0, 0.08, Math.min(a0, a1), Math.max(a0, a1), { cast: false })
      } else {
        const a0 = road.x > 0 ? pk.x + pk.width : edge, a1 = road.x > 0 ? edge : pk.x
        bx(vehicles, pave, Math.min(a0, a1), Math.max(a0, a1), 0, 0.08, pk.y, pk.y + pk.length, { cast: false })
      }
      const lineM = solid(0xf4f1ea, 0.9)
      // frontage axis (across the bays) and depth axis (towards the road)
      const front0 = alongRoad ? pk.y : pk.x
      const frontLen = alongRoad ? pk.length : pk.width
      const depLen = alongRoad ? pk.width : pk.length
      const place = (obj: THREE.Group, across: number, back: number, kind: 'car' | 'bike' = 'car') => {
        // across: distance along the frontage from the bay start; back: distance from the house-side edge towards the road
        const fx = front0 + across
        const dx = alongRoad ? (road.x > 0 ? pk.x + back : pk.x + pk.width - back) : fx
        const dz = alongRoad ? fx : (road.z > 0 ? pk.y + back : pk.y + pk.length - back)
        obj.position.set(dx, 0.08 + yo, dz)
        parked[kind === 'car' ? 'cars' : 'bikes'].push({ x: dx, z: dz })
        // parked nose-in: the front of the vehicle points away from the street
        obj.rotation.y = Math.atan2(road.z, -road.x)
        vehicles.add(obj)
      }
      const bay = 9
      const cars = pkInfo.cars ?? 0
      const bikes = pkInfo.bikes ?? 0
      const lineAt = (across: number) => {
        if (alongRoad) bx(vehicles, lineM, pk.x, pk.x + pk.width, 0.08 + yo, 0.1 + yo, front0 + across - 0.06, front0 + across + 0.06, { cast: false })
        else bx(vehicles, lineM, front0 + across - 0.06, front0 + across + 0.06, 0.08 + yo, 0.1 + yo, pk.y, pk.y + pk.length, { cast: false })
      }
      const nBays = Math.max(1, Math.round(frontLen / bay))
      if (!pkRoom) for (let i = 0; i <= nBays; i++) lineAt(i * bay)
      const kinds: Array<'sedan' | 'suv'> = ['sedan', 'suv']
      for (let i = 0; i < cars; i++) {
        const car = makeCar(kinds[i % 2], CAR_COLOURS[i % CAR_COLOURS.length])
        // in a porch the bays are centred across it (the same bays the 2D plan marks); on open paving a strip is left for bikes
        const across = pkRoom ? frontLen / 2 + (i - (cars - 1) / 2) * bay : i * bay + (bikes > 0 && cars === 1 ? 2.95 : bay / 2)
        place(car, across, depLen / 2 + 0.5)
      }
      if (bikes > 0) {
        if (cars === 0) {
          for (let i = 0; i < bikes; i++) {
            const b = makeBike(BIKE_COLOURS[i % BIKE_COLOURS.length])
            place(b, 1.8 + i * 2.7, 6, 'bike')
          }
        } else {
          for (let i = 0; i < Math.min(bikes, 2); i++) {
            const b = makeBike(BIKE_COLOURS[i % BIKE_COLOURS.length])
            place(b, bay - 1.3, depLen * 0.25 + i * 8, 'bike')
          }
        }
      }
    }
    // porch shade: a roof slab over the car porch and two columns at the road-side corners
    if (pkRoom) {
      const sy = WALL_H - SLAB
      bx(vehicles, [slabEdge, slabEdge, R.ext.roof, R.ceilingMat, slabEdge, slabEdge], pkRoom.x - 0.1, rx2(pkRoom) + 0.1, sy, WALL_H, pkRoom.y - 0.1, ry2(pkRoom) + 0.1, { struct: true })
      const fz = road.z > 0 ? ry2(pkRoom) : pkRoom.y, fx = road.x > 0 ? rx2(pkRoom) : pkRoom.x
      const cs = 0.7
      const cols: Array<[number, number]> = alongRoad
        ? [[fx, pkRoom.y], [fx, ry2(pkRoom)]]
        : [[pkRoom.x, fz], [rx2(pkRoom), fz]]
      for (const [cx, cz] of cols) {
        const ox = Math.abs(cx - (pkRoom.x + rx2(pkRoom)) / 2) < 0.01 ? 0 : (cx < (pkRoom.x + rx2(pkRoom)) / 2 ? cs / 2 : -cs / 2)
        const oz = Math.abs(cz - (pkRoom.y + ry2(pkRoom)) / 2) < 0.01 ? 0 : (cz < (pkRoom.y + ry2(pkRoom)) / 2 ? cs / 2 : -cs / 2)
        bx(vehicles, R.ext.main, cx + ox - cs / 2, cx + ox + cs / 2, SLAB, sy, cz + oz - cs / 2, cz + oz + cs / 2, { struct: true })
      }
    }
  }
  mergeByMaterial(vehicles)
  mergeByMaterial(exterior)
  root.add(vehicles)
  root.add(exterior)

  const size = Math.max(bx1 - bx0, bz1 - bz0, nF * WALL_H)
  const sig = {
    struct: sigOf(root, (m) => Boolean(m.userData.struct) && !m.userData.roofEdge),
    furniture: hash32(furnSigs.join('|')),
    layout: hash32(takeFootprints()),    // where the furniture stands (footprints): the same in every style
  }
  return {
    chajjas, roofAreas, kitchens: takeFixtures().slice(), root, floors, roof, labels, furniture, ceil, walls, doors, doorAmt: { v: 1 }, center: new THREE.Vector3((bx0 + bx1) / 2, (nF * WALL_H) / 3, (bz0 + bz1) / 2), size, road, exterior,
    lights, resolved: R, wallH: WALL_H, sig, parking: parked, envelope,
  }
}
