/**
 * Smart-house data for the Unity / Meta Quest demo: where the lights, wall switches, ceiling fans and the fan regulator of a generated house go.
 *
 * A downloaded .glb has no room identity (nodes are unnamed, meshes are merged per material, there are no lights or fans in it), so the rooms are
 * written here from the plan itself, in the SAME coordinate frame as the .glb (feet; x = plan x, y = up, z = plan y), using the same floor-to-floor
 * height and slab thickness as `twinBuild.ts`.  The file is a sidecar (`house-N.smarthouse.json`) read by the Unity package in `unity-smart-house/`.
 *
 * Pure (no three.js, no DOM): it does not touch the plan, the generator or the 3D build; it only reads them.
 */
import type { Plan } from '../types'
import { passageOpenings } from '../components/walls'
import type { Cut } from '../components/walls'

export const SMART_HOUSE_SCHEMA = 'realestate.smart-house/1'
/** Same values as `twinBuild.ts` (SLAB, the wall-height rule); a browser test compares them with the built model. */
export const SLAB_FT = 0.3
export const INTERIOR_WALL_FT = 120 / 304.8
/** `twinBuild.ts` builds every style's structural exterior wall 230 mm thick (centred on the room edge); Traditional / Wada add cladding on the OUTSIDE only. A browser test checks this against the exported .glb. */
const EXTERIOR_WALL_FT: Record<string, number> = { modern: 230 / 304.8, traditional: 230 / 304.8, wada: 230 / 304.8 }

export const SWITCH_HEIGHT_FT = 4.0           // 1.22 m: inside the 0.38-1.22 m reach range used for wall controls
const PLATE_HALF_FT = 0.2                     // half width of a switch plate / regulator plate
const REGULATOR_HALF_FT = 0.3
const DOOR_CLEAR_FT = 0.55                    // from the door opening to the edge of the plate
const WINDOW_CLEAR_FT = 0.4
const OPENING_CLEAR_FT = 0.3
const CORNER_CLEAR_FT = 0.7
const MIN_FAN_ROOM_FT = 9.0

type V3 = [number, number, number]
type Edge = 'left' | 'right' | 'top' | 'bottom'
interface Rm { id?: string; name?: string; room_type: string; x: number; y: number; x2?: number; y2?: number; width: number; length: number }
interface Door { room?: string; connects_to?: string | null; x1?: number; y1?: number; x2?: number; y2?: number }
interface Win { room?: string; wall?: string; position?: number; width?: number }

export interface SmartAnchor { pos: V3; normal: V3; wall: Edge; wall_thickness_ft: number; exterior_wall: boolean }
export interface SmartRoom {
  id: string
  name: string
  type: string
  floor: number
  rect: { x0: number; z0: number; x1: number; z1: number }
  floor_y: number
  ceiling_y: number
  light: { pos: V3; range_ft: number }
  fan: { pos: V3; blade_radius_ft: number; down_rod_ft: number; blade_plane_above_floor_ft: number } | null
  switch: SmartAnchor | null
  regulator: SmartAnchor | null
  notes: string[]
}
export interface SmartHouse {
  schema: string
  units: 'feet'
  frame: string
  plan_number: number | null
  style: string
  wall_height_ft: number
  slab_ft: number
  interior_wall_ft: number
  exterior_wall_ft: number
  footprint: { x0: number; z0: number; x1: number; z1: number }
  floors: Array<{ level: number; floor_y: number; ceiling_y: number }>
  rooms: SmartRoom[]
  notes: string[]
}

const NOT_LIT = new Set(['balcony', 'courtyard', 'open_terrace', 'parking', 'bike_parking', 'garden', 'terrace'])
const HABITABLE = new Set(['living_room', 'dining', 'master_bedroom', 'bedroom', 'guest_bedroom', 'family_lounge', 'study'])

const styleKey = (s: string | undefined): 'modern' | 'traditional' | 'wada' => {
  const t = (s ?? '').toLowerCase()
  return t.includes('wada') ? 'wada' : t.includes('tradition') ? 'traditional' : 'modern'
}
const pretty = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
const r3 = (v: number) => Math.round(v * 1000) / 1000
const x2of = (r: Rm) => r.x2 ?? r.x + r.width
const y2of = (r: Rm) => r.y2 ?? r.y + r.length

/** Floor-to-floor height exactly as the 3D build derives it (min 8.86 ft, max 14 ft, default 10 ft). */
export function wallHeightFt(plan: Plan): number {
  const st = (plan as unknown as { staircase?: { floor_height?: number } | null }).staircase
  return Math.max(8.86, Math.min(14, Number(st?.floor_height) || 10))
}

interface Span { lo: number; hi: number }

/** Free runs of a wall (along its axis) between its corners, minus the door and window openings with their clearances. */
function freeRuns(a: number, b: number, blocked: Span[]): Span[] {
  let runs: Span[] = [{ lo: a + CORNER_CLEAR_FT, hi: b - CORNER_CLEAR_FT }]
  for (const k of blocked) {
    const next: Span[] = []
    for (const r of runs) {
      if (k.hi <= r.lo || k.lo >= r.hi) { next.push(r); continue }
      if (k.lo > r.lo) next.push({ lo: r.lo, hi: k.lo })
      if (k.hi < r.hi) next.push({ lo: k.hi, hi: r.hi })
    }
    runs = next
  }
  return runs.filter((r) => r.hi - r.lo > 2 * PLATE_HALF_FT)
}

interface EdgeInfo { edge: Edge; c: number; a: number; b: number; blocked: Span[]; doors: Span[]; exterior: boolean }

function edgesOf(r: Rm, doors: Door[], wins: Win[], fp: { x0: number; z0: number; x1: number; z1: number }, cuts: Cut[], floorRooms: Rm[], upper: boolean): EdgeInfo[] {
  const x0 = r.x, x1 = x2of(r), z0 = r.y, z1 = y2of(r)
  const out: EdgeInfo[] = []
  const mk = (edge: Edge, c: number, a: number, b: number): EdgeInfo => {
    const horiz = edge === 'top' || edge === 'bottom'
    const blocked: Span[] = []
    const dspans: Span[] = []
    for (const d of doors) {
      if (d.x1 === undefined || d.y1 === undefined || d.x2 === undefined || d.y2 === undefined) continue
      const onLine = horiz ? Math.abs(d.y1 - c) < 0.2 && Math.abs(d.y2 - c) < 0.2 : Math.abs(d.x1 - c) < 0.2 && Math.abs(d.x2 - c) < 0.2
      if (!onLine) continue
      const lo = horiz ? Math.min(d.x1, d.x2) : Math.min(d.y1, d.y2), hi = horiz ? Math.max(d.x1, d.x2) : Math.max(d.y1, d.y2)
      if (hi < a - 0.05 || lo > b + 0.05) continue
      dspans.push({ lo, hi })
      blocked.push({ lo: lo - DOOR_CLEAR_FT, hi: hi + DOOR_CLEAR_FT })
    }
    for (const w of wins) {
      if (w.room !== r.id || w.wall !== edge || w.position === undefined || w.width === undefined) continue
      blocked.push({ lo: a + w.position - WINDOW_CLEAR_FT, hi: a + w.position + w.width + WINDOW_CLEAR_FT })
    }
    // a passage is open (there is NO wall) where it runs alongside a living / dining / lounge / stair space: the 3D build cuts those wall runs out
    for (const k of cuts) {
      if (k.axis !== (horiz ? 'h' : 'v') || Math.abs(k.c - c) > 0.05 || k.b <= a || k.a >= b) continue
      blocked.push({ lo: k.a - OPENING_CLEAR_FT, hi: k.b + OPENING_CLEAR_FT })
    }
    // the stair well upstairs: where nothing adjoins it on that floor the 3D build draws a guard rail, not a wall
    if (r.room_type === 'staircase' && upper) {
      const covered: Span[] = []
      for (const o of floorRooms) {
        if (o === r || (o.id !== undefined && o.id === r.id)) continue
        const ox0 = o.x, ox1 = x2of(o), oz0 = o.y, oz1 = y2of(o)
        // the neighbour's matching edge: opposite side of the same line
        const touches = edge === 'top' ? Math.abs(oz1 - c) < 0.05 : edge === 'bottom' ? Math.abs(oz0 - c) < 0.05 : edge === 'left' ? Math.abs(ox1 - c) < 0.05 : Math.abs(ox0 - c) < 0.05
        if (!touches) continue
        const lo = horiz ? Math.max(a, ox0) : Math.max(a, oz0), hi = horiz ? Math.min(b, ox1) : Math.min(b, oz1)
        if (hi > lo) covered.push({ lo, hi })
      }
      const fpEdge = horiz ? c <= fp.z0 + 0.05 || c >= fp.z1 - 0.05 : c <= fp.x0 + 0.05 || c >= fp.x1 - 0.05
      if (!fpEdge) {
        covered.sort((p, q) => p.lo - q.lo)
        let cur = a
        for (const k of covered) { if (k.lo > cur) blocked.push({ lo: cur - 0.01, hi: k.lo }); cur = Math.max(cur, k.hi) }
        if (cur < b) blocked.push({ lo: cur, hi: b + 0.01 })
      }
    }
    const ext = horiz ? c <= fp.z0 + 0.05 || c >= fp.z1 - 0.05 : c <= fp.x0 + 0.05 || c >= fp.x1 - 0.05
    return { edge, c, a, b, blocked, doors: dspans, exterior: ext }
  }
  out.push(mk('top', z0, x0, x1), mk('bottom', z1, x0, x1), mk('left', x0, z0, z1), mk('right', x1, z0, z1))
  return out
}

const normalOf = (e: Edge): V3 => (e === 'top' ? [0, 0, 1] : e === 'bottom' ? [0, 0, -1] : e === 'left' ? [1, 0, 0] : [-1, 0, 0])
const posOn = (e: EdgeInfo, along: number, y: number): V3 => (e.edge === 'top' || e.edge === 'bottom' ? [r3(along), r3(y), r3(e.c)] : [r3(e.c), r3(y), r3(along)])

/**
 * Where the switch (and, when the room has a fan, the regulator beside it) go: on a wall with a door, just beside the door opening, clear of every
 * door and window.  Returns centres along the wall.  A switch needs one free run of 0.4 ft; with a regulator the run must hold both plates.
 */
function placeControls(edges: EdgeInfo[], withRegulator: boolean): { edge: EdgeInfo; sw: number; reg: number | null } | null {
  const need = withRegulator ? 2 * PLATE_HALF_FT + 0.35 + 2 * REGULATOR_HALF_FT : 2 * PLATE_HALF_FT
  const tries: Array<{ edge: EdgeInfo; sw: number; reg: number | null; score: number }> = []
  for (const e of edges) {
    const runs = freeRuns(e.a, e.b, e.blocked)
    for (const d of e.doors) {
      for (const dir of [1, -1] as const) {
        const start = dir > 0 ? d.hi + DOOR_CLEAR_FT : d.lo - DOOR_CLEAR_FT          // the plate's door-side edge
        const run = runs.find((r) => start >= r.lo - 1e-6 && start <= r.hi + 1e-6)
        if (!run) continue
        const room = dir > 0 ? run.hi - start : start - run.lo
        if (room < need - 1e-6) continue
        const sw = start + dir * PLATE_HALF_FT
        const reg = withRegulator ? start + dir * (2 * PLATE_HALF_FT + 0.35 + REGULATOR_HALF_FT) : null
        tries.push({ edge: e, sw, reg, score: (e.exterior ? 1 : 0) * 5 + (dir > 0 ? 0 : 0.1) })
      }
    }
  }
  if (tries.length) return tries.sort((p, q) => p.score - q.score)[0]
  // no door on any wall (an open arrangement): the middle of the longest free run
  let best: { edge: EdgeInfo; run: Span } | null = null
  for (const e of edges) for (const r of freeRuns(e.a, e.b, e.blocked)) if (r.hi - r.lo >= need && (!best || r.hi - r.lo > best.run.hi - best.run.lo)) best = { edge: e, run: r }
  if (!best) return null
  const mid = (best.run.lo + best.run.hi) / 2
  return withRegulator ? { edge: best.edge, sw: mid - 0.3, reg: mid + 0.3 + PLATE_HALF_FT } : { edge: best.edge, sw: mid, reg: null }
}

/** Maps a plan to the plan the 3D view draws (the app passes `projectPlan` from twinMassing: projected upper floors are drawn extended, so their rooms are too). */
export type PlanProjector = (plan: Plan) => Plan

export function buildSmartHouse(plan0: Plan, project: PlanProjector = (p) => p): SmartHouse {
  const plan = project(plan0)
  const H = wallHeightFt(plan)
  const sk = styleKey((plan as unknown as { architectural_style?: string }).architectural_style)
  const extT = EXTERIOR_WALL_FT[sk]
  const notes: string[] = []
  const allRooms: Rm[] = plan.floors.flatMap((f) => ((f.layout as unknown as { rooms?: Rm[] })?.rooms ?? []))
  const fp = {
    x0: Math.min(...allRooms.map((r) => r.x)), z0: Math.min(...allRooms.map((r) => r.y)),
    x1: Math.max(...allRooms.map(x2of)), z1: Math.max(...allRooms.map(y2of)),
  }
  const counts = new Map<string, number>()
  const totals = new Map<string, number>()
  for (const f of plan.floors) for (const r of ((f.layout as unknown as { rooms?: Rm[] })?.rooms ?? [])) totals.set(r.room_type, (totals.get(r.room_type) ?? 0) + 1)
  const rooms: SmartRoom[] = []
  plan.floors.forEach((fl, fi) => {
    const lay = fl.layout as unknown as { rooms?: Rm[]; openings?: { doors?: Door[]; windows?: Win[] } } | undefined
    const rs = lay?.rooms ?? []
    const doors = lay?.openings?.doors ?? []
    const wins = lay?.openings?.windows ?? []
    const cuts = passageOpenings(rs as never)
    const floorY = fi * H + SLAB_FT
    const ceilY = fi * H + H
    for (const r of rs) {
      if (NOT_LIT.has(r.room_type)) continue
      const id = r.id ?? `${r.room_type}_${fi}`
      const n = (counts.get(r.room_type) ?? 0) + 1
      counts.set(r.room_type, n)
      const base = r.name ?? pretty(r.room_type)
      const name = (totals.get(r.room_type) ?? 1) > 1 && !/\d/.test(base) && r.room_type !== 'master_bedroom' && r.room_type !== 'bathroom' ? `${base} ${n}` : base
      const x0 = r.x, x1 = x2of(r), z0 = r.y, z1 = y2of(r)
      const w = x1 - x0, d = z1 - z0
      const habitable = HABITABLE.has(r.room_type)
      const clear = ceilY - floorY
      const radius = Math.max(1.75, Math.min(2.35, (Math.min(w, d) - 5) / 2))
      const wantFan = habitable && Math.min(w, d) >= MIN_FAN_ROOM_FT
      const notesR: string[] = []
      // the doors of this room, and the doors of neighbouring rooms that open into it
      const myDoors = doors.filter((q) => q.room === id || q.connects_to === id)
      const edges = edgesOf({ ...r, id }, myDoors, wins, fp, cuts, rs, fi > 0)
      const placed = placeControls(edges, wantFan)
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
      let fan: SmartRoom['fan'] = null
      if (wantFan) {
        const rod = Math.max(0, Math.min(2, clear - 0.55 - 8.5))
        fan = { pos: [r3(cx), r3(ceilY - rod), r3(cz)], blade_radius_ft: r3(radius), down_rod_ft: r3(rod), blade_plane_above_floor_ft: r3(clear - rod - 0.55) }
      }
      // the light fitting: room centre, or beside the fan along the long axis so the blades do not hide it
      const lx = fan ? cx + (w >= d ? Math.min(2.2, w / 4) : 0) : cx
      const lz = fan ? cz + (w >= d ? 0 : Math.min(2.2, d / 4)) : cz
      const anchor = (e: EdgeInfo, along: number): SmartAnchor => ({
        pos: posOn(e, along, floorY + SWITCH_HEIGHT_FT), normal: normalOf(e.edge), wall: e.edge,
        wall_thickness_ft: r3(e.exterior ? extT : INTERIOR_WALL_FT), exterior_wall: e.exterior,
      })
      let sw: SmartAnchor | null = null
      let reg: SmartAnchor | null = null
      if (placed) {
        sw = anchor(placed.edge, placed.sw)
        if (placed.reg !== null) reg = anchor(placed.edge, placed.reg)
      } else {
        notesR.push('no wall run free of doors and windows for a switch: place the switch by hand (see README)')
        if (wantFan) notesR.push('fan regulator not placed')
      }
      if (!wantFan && habitable) notesR.push(`room is under ${MIN_FAN_ROOM_FT} ft wide: no ceiling fan`)
      rooms.push({
        id, name, type: r.room_type, floor: fi,
        rect: { x0: r3(x0), z0: r3(z0), x1: r3(x1), z1: r3(z1) }, floor_y: r3(floorY), ceiling_y: r3(ceilY),
        light: { pos: [r3(lx), r3(ceilY - 0.12), r3(lz)], range_ft: r3(Math.hypot(w, d) * 0.9) },
        fan, switch: sw, regulator: reg, notes: notesR,
      })
    }
  })
  const missing = rooms.filter((q) => !q.switch).length
  if (missing) notes.push(`${missing} room(s) have no automatic switch position`)
  return {
    schema: SMART_HOUSE_SCHEMA, units: 'feet',
    frame: 'same as the exported .glb: x = plan x, y = up, z = plan y; floor n sits at y = n * wall_height_ft',
    plan_number: (plan as unknown as { plan_number?: number }).plan_number ?? null,
    style: (plan as unknown as { architectural_style?: string }).architectural_style ?? '',
    wall_height_ft: H, slab_ft: SLAB_FT, interior_wall_ft: r3(INTERIOR_WALL_FT), exterior_wall_ft: r3(extT),
    footprint: { x0: r3(fp.x0), z0: r3(fp.z0), x1: r3(fp.x1), z1: r3(fp.z1) },
    floors: plan.floors.map((_, i) => ({ level: i, floor_y: r3(i * H + SLAB_FT), ceiling_y: r3(i * H + H) })),
    rooms, notes,
  }
}

/** File name of the data file that belongs to `house-<n>.glb`. */
export const smartHouseFileName = (plan: Plan): string => `house-${(plan as unknown as { plan_number?: number }).plan_number ?? 1}.smarthouse.json`

/** Browser download of the smart-house data file (the lights / fans / switches positions for the Unity + Quest demo). */
export function downloadSmartHouse(plan: Plan, project?: PlanProjector): void {
  const json = JSON.stringify(buildSmartHouse(plan, project), null, 2)
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = smartHouseFileName(plan)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
