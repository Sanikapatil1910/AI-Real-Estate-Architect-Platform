import * as THREE from 'three'
import { furnishRoom } from './twinInterior'
import type { Obstacles } from './twinInterior'
import { swingRoom, hingeAtEndA } from './twinDoorsStairs'

/** Shared by the 3D twin and the 2D plan: plan openings -> obstacles -> furnished floor. */

export type RoomT = {
  id?: string
  room_type: string
  name?: string
  x: number
  y: number
  x2?: number
  y2?: number
  width: number
  length: number
}
export type Opening = { room?: string; wall?: string; position?: number; width?: number; x1?: number; y1?: number; x2?: number; y2?: number; door_type?: string; sill?: number; height?: number }
export type Interval = { a: number; b: number }
export type Line = { axis: 'h' | 'v'; c: number } // h: wall runs along x at z=c; v: runs along z at x=c

export const rx2 = (r: RoomT) => r.x2 ?? r.x + r.width
export const ry2 = (r: RoomT) => r.y2 ?? r.y + r.length
export const key = (n: number) => Math.round(n * 100) / 100

export function openingSeg(o: Opening, r: RoomT | undefined): { line: Line; a: number; b: number } | null {
  if (o.x1 !== undefined && o.y1 !== undefined && o.x2 !== undefined && o.y2 !== undefined) {
    if (Math.abs(o.y1 - o.y2) < 0.01) return { line: { axis: 'h', c: key(o.y1) }, a: Math.min(o.x1, o.x2), b: Math.max(o.x1, o.x2) }
    return { line: { axis: 'v', c: key(o.x1) }, a: Math.min(o.y1, o.y2), b: Math.max(o.y1, o.y2) }
  }
  if (!r || !o.wall) return null
  const p = Number(o.position) || 0
  const w = Number(o.width) || 3
  if (o.wall === 'top') return { line: { axis: 'h', c: key(r.y) }, a: r.x + p, b: r.x + p + w }
  if (o.wall === 'bottom') return { line: { axis: 'h', c: key(ry2(r)) }, a: r.x + p, b: r.x + p + w }
  if (o.wall === 'left') return { line: { axis: 'v', c: key(r.x) }, a: r.y + p, b: r.y + p + w }
  return { line: { axis: 'v', c: key(rx2(r)) }, a: r.y + p, b: r.y + p + w }
}

export type Seg = { line: Line; a: number; b: number; arch?: boolean; swing?: string | null }

export function obstaclesFor(r: RoomT, doors: Seg[], windows: Seg[], bbox?: { x0: number; x1: number; z0: number; z1: number }): Obstacles {
  const near = (v: number, w: number) => Math.abs(v - w) < 0.06
  const mk = (list: Seg[], depthOf: (o: Seg) => number, pad: number) => {
    const out: Array<{ x0: number; x1: number; z0: number; z1: number }> = []
    for (const o of list) {
      const depth = depthOf(o)
      if (o.line.axis === 'h') {
        if (o.b <= r.x || o.a >= rx2(r)) continue
        if (near(o.line.c, r.y)) out.push({ x0: o.a - pad, x1: o.b + pad, z0: r.y, z1: r.y + depth })
        else if (near(o.line.c, ry2(r))) out.push({ x0: o.a - pad, x1: o.b + pad, z0: ry2(r) - depth, z1: ry2(r) })
      } else {
        if (o.b <= r.y || o.a >= ry2(r)) continue
        if (near(o.line.c, r.x)) out.push({ x0: r.x, x1: r.x + depth, z0: o.a - pad, z1: o.b + pad })
        else if (near(o.line.c, rx2(r))) out.push({ x0: rx2(r) - depth, x1: rx2(r), z0: o.a - pad, z1: o.b + pad })
      }
    }
    return out
  }
  const winSegs: Obstacles['winSegs'] = []
  for (const o of windows) {
    if (o.line.axis === 'h') {
      if (o.b <= r.x || o.a >= rx2(r)) continue
      if (near(o.line.c, r.y)) winSegs.push({ wall: 'top', a: o.a, b: o.b })
      else if (near(o.line.c, ry2(r))) winSegs.push({ wall: 'bottom', a: o.a, b: o.b })
    } else {
      if (o.b <= r.y || o.a >= ry2(r)) continue
      if (near(o.line.c, r.x)) winSegs.push({ wall: 'left', a: o.a, b: o.b })
      else if (near(o.line.c, rx2(r))) winSegs.push({ wall: 'right', a: o.a, b: o.b })
    }
  }
  const doorSegs: Obstacles['winSegs'] = []
  for (const o of doors) {
    if (o.line.axis === 'h') {
      if (o.b <= r.x || o.a >= rx2(r)) continue
      if (near(o.line.c, r.y)) doorSegs.push({ wall: 'top', a: o.a, b: o.b })
      else if (near(o.line.c, ry2(r))) doorSegs.push({ wall: 'bottom', a: o.a, b: o.b })
    } else {
      if (o.b <= r.y || o.a >= ry2(r)) continue
      if (near(o.line.c, r.x)) doorSegs.push({ wall: 'left', a: o.a, b: o.b })
      else if (near(o.line.c, rx2(r))) doorSegs.push({ wall: 'right', a: o.a, b: o.b })
    }
  }
  // half thickness of the wall on each side of the room: 230 mm outer walls, 120 mm inner walls
  const ext = (v: number, w: number) => (bbox && Math.abs(v - w) < 0.06 ? 230 / 304.8 / 2 : 120 / 304.8 / 2)
  const half = bbox
    ? { top: ext(r.y, bbox.z0), bottom: ext(ry2(r), bbox.z1), left: ext(r.x, bbox.x0), right: ext(rx2(r), bbox.x1) }
    : { top: 0.2, bottom: 0.2, left: 0.2, right: 0.2 }
  // the open leaf of every door that swings into this room, as the VR model holds it (square to the wall, folded back on the hinge side): a solid thing in the way
  const leaves: Obstacles['doors'] = []
  const id = r.id ?? r.room_type
  const allDoors = doors.map((o) => ({ axis: o.line.axis, c: o.line.c, a: o.a, b: o.b }))
  for (const o of doors) {
    if (o.arch || o.swing === null || (o.swing !== undefined && o.swing !== id)) continue
    if (o.b - o.a < 1.5) continue
    const depth = o.b - o.a - 0.03
    const rr = { x: r.x, y: r.y, x2: rx2(r), y2: ry2(r) }
    if (o.line.axis === 'h') {
      if (o.b <= r.x || o.a >= rx2(r)) continue
      const hinge = hingeAtEndA('h', o.line.c, o.a, o.b, rr, allDoors) ? o.a : o.b
      if (near(o.line.c, r.y)) leaves.push({ x0: hinge - 0.1, x1: hinge + 0.1, z0: r.y, z1: r.y + depth })
      else if (near(o.line.c, ry2(r))) leaves.push({ x0: hinge - 0.1, x1: hinge + 0.1, z0: ry2(r) - depth, z1: ry2(r) })
    } else {
      if (o.b <= r.y || o.a >= ry2(r)) continue
      const hinge = hingeAtEndA('v', o.line.c, o.a, o.b, rr, allDoors) ? o.a : o.b
      if (near(o.line.c, r.x)) leaves.push({ x0: r.x, x1: r.x + depth, z0: hinge - 0.1, z1: hinge + 0.1 })
      else if (near(o.line.c, rx2(r))) leaves.push({ x0: rx2(r) - depth, x1: rx2(r), z0: hinge - 0.1, z1: hinge + 0.1 })
    }
  }
  // a door needs its swing (about its width) kept clear; a cased opening needs a walkway
  return { leaves, doors: mk(doors, (o) => (o.arch || o.swing === null ? 2.4 : o.swing !== undefined && o.swing !== (r.id ?? r.room_type) ? 2.4 : Math.min(3.6, o.b - o.a + 0.5)), 0.3), windows: mk(windows, () => 1.3, 0.2), winSegs, doorSegs, half }
}


/** Furnish every habitable room of one floor. `fg` gets furniture, `dg` gets wall decor (curtains). */
export function furnishFloor(rooms: RoomT[], openings: { doors?: unknown[]; windows?: unknown[] } | undefined, lvl: number, fg: THREE.Group, dg: THREE.Group, cg?: THREE.Group): void {
  const byId = new Map<string, RoomT>()
  for (const r of rooms) {
    byId.set(r.id ?? r.room_type, r)
    if (!byId.has(r.room_type)) byId.set(r.room_type, r)
  }
  const segs = (list: Opening[], doors = false): Seg[] =>
    list.flatMap((o) => {
      const q = openingSeg(o, o.room ? byId.get(o.room) : undefined)
      if (!q) return []
      if (!doors) return [{ ...q }]
      // the leaf swings into one room only: the room on the other side needs a walkway, not the whole swing
      const d = o as Opening & { connects_to?: string | null }
      const asR = (x?: RoomT) => (x ? { id: x.id, room_type: x.room_type, x: x.x, y: x.y, x2: rx2(x), y2: ry2(x) } : undefined)
      const sw = swingRoom(d.door_type === 'main' ? 'main' : 'door', d.door_type, asR(o.room ? byId.get(o.room) : undefined), asR(d.connects_to ? byId.get(d.connects_to) : undefined))
      return [{ ...q, arch: o.door_type === 'arch', swing: sw === null ? null : sw?.id ?? sw?.room_type }]
    })
  const doorSegs = segs((openings?.doors ?? []) as Opening[], true)
  const winSegs = segs((openings?.windows ?? []) as Opening[])
  const box = { x0: Math.min(...rooms.map((q) => q.x)), x1: Math.max(...rooms.map(rx2)), z0: Math.min(...rooms.map((q) => q.y)), z1: Math.max(...rooms.map(ry2)) }
  for (const r of rooms) {
    if (r.room_type === 'staircase' || r.room_type === 'passage' || r.room_type === 'open_terrace') continue
    furnishRoom(fg, { id: r.id, room_type: r.room_type, x: r.x, y: r.y, x2: rx2(r), y2: ry2(r) }, lvl, obstaclesFor(r, doorSegs, winSegs, box), dg, cg)
  }
}

/* ---------------------------------------------------------------- top-down view */
export interface PlanShape {
  kind: 'rect' | 'circle'
  cx: number // plan x (ft)
  cz: number // plan y (ft)
  w: number
  d: number
  r: number
  color: string
  top: number // height of the top face above the floor (ft)
  alpha: number
}

/** Flatten a furnished group into top-down shapes for the 2D plan (same layout as the 3D twin). */
export function projectTopDown(group: THREE.Group, lvl = 0): PlanShape[] {
  const out: PlanShape[] = []
  group.updateMatrixWorld(true)
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || m.userData.noPlan) return
    const mat = m.material as THREE.MeshStandardMaterial
    const pc = (mat.userData as { planColor?: number } | undefined)?.planColor
    const color = pc !== undefined ? '#' + pc.toString(16).padStart(6, '0') : '#' + mat.color.getHexString()
    const alpha = mat.transparent ? Math.min(0.5, mat.opacity) : 1
    const p = m.position
    const gp = m.geometry as THREE.BufferGeometry & { parameters?: Record<string, number> }
    const q = gp.parameters ?? {}
    if (gp.type === 'BoxGeometry' || gp.type === 'RoundedBoxGeometry') {
      out.push({ kind: 'rect', cx: p.x, cz: p.z, w: q.width, d: q.depth, r: 0, color, top: p.y + q.height / 2 - lvl, alpha })
    } else if (gp.type === 'CylinderGeometry') {
      out.push({ kind: 'circle', cx: p.x, cz: p.z, w: 0, d: 0, r: q.radiusTop, color, top: p.y + q.height / 2 - lvl, alpha })
    } else if (gp.type === 'SphereGeometry') {
      out.push({ kind: 'circle', cx: p.x, cz: p.z, w: 0, d: 0, r: q.radius, color, top: p.y + q.radius - lvl, alpha })
    }
  })
  return out.sort((a, b) => a.top - b.top)
}
