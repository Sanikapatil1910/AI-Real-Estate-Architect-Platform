/**
 * Pure geometry for per-room finishes ("skins"): thin faces laid 3 mm in front of a room's own wall faces, floor and ceiling, so one room can have its own
 * paint / floor / ceiling without touching the shared materials of the rest of the house.  No three.js here (plain arrays), so it is unit-tested in node.
 *
 * The wall faces are READ from the exported model (every axis-aligned vertical face of the plaster wall material), not re-derived from the plan, so a skin has
 * exactly the door and window openings the real wall has.  A face that runs past a room (one wall line serving two rooms) is clipped to the room's own extent.
 */
import type { WallSide } from './types'

export interface WallFace { axis: 'x' | 'z'; sign: 1 | -1; p: number; a0: number; a1: number; y0: number; y1: number }
export interface RoomBox { key: string; type: string; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }
export interface WallSeg { side: WallSide; axis: 'x' | 'z'; sign: 1 | -1; p: number; a0: number; a1: number; y0: number; y1: number }
/** one finished quad: 4 corners (x,y,z), the unit normal and the uv in tile units */
export interface Quad { pos: number[]; nor: number[]; uv: number[]; index: number[] }

/** how far in front of the real surface a skin sits (feet): 3 mm */
export const SKIN_LIFT = 0.01
/** a wall face belongs to a room edge when its plane is between 0.06 ft outside and 0.55 ft inside the room rectangle (the walls are centred on the rectangle) */
const NEAR_OUT = 0.06
const NEAR_IN = 0.55

const r2 = (n: number) => Math.round(n * 100) / 100

/** Every axis-aligned vertical face in a triangle list, one entry per quad (the two triangles of a quad give the same rectangle). */
export function collectWallFaces(pos: ArrayLike<number>, index: ArrayLike<number> | null): WallFace[] {
  const out = new Map<string, WallFace>()
  const n = index ? index.length : Math.floor(pos.length / 3)
  const v = (i: number): [number, number, number] => { const k = (index ? index[i] : i) * 3; return [pos[k], pos[k + 1], pos[k + 2]] }
  for (let t = 0; t + 2 < n; t += 3) {
    const a = v(t), b = v(t + 1), c = v(t + 2)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2]
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-9) continue
    nx /= len; ny /= len; nz /= len
    if (Math.abs(ny) > 0.02) continue
    const axis: 'x' | 'z' | null = Math.abs(nx) > 0.98 ? 'x' : Math.abs(nz) > 0.98 ? 'z' : null
    if (!axis) continue
    const k = axis === 'x' ? 0 : 2, o = axis === 'x' ? 2 : 0
    const p = (a[k] + b[k] + c[k]) / 3
    if (Math.abs(a[k] - p) > 0.01 || Math.abs(b[k] - p) > 0.01 || Math.abs(c[k] - p) > 0.01) continue
    const sign: 1 | -1 = (axis === 'x' ? nx : nz) > 0 ? 1 : -1
    const f: WallFace = { axis, sign, p, a0: Math.min(a[o], b[o], c[o]), a1: Math.max(a[o], b[o], c[o]), y0: Math.min(a[1], b[1], c[1]), y1: Math.max(a[1], b[1], c[1]) }
    if (f.a1 - f.a0 < 0.01 || f.y1 - f.y0 < 0.01) continue
    out.set(`${axis}${sign}|${r2(p)}|${r2(f.a0)}|${r2(f.a1)}|${r2(f.y0)}|${r2(f.y1)}`, f)
  }
  return [...out.values()]
}

const SIDES: Array<{ side: WallSide; axis: 'x' | 'z'; sign: 1 | -1 }> = [
  { side: 'W', axis: 'x', sign: 1 }, { side: 'E', axis: 'x', sign: -1 }, { side: 'N', axis: 'z', sign: 1 }, { side: 'S', axis: 'z', sign: -1 },
]
/** side -> which edge of the rectangle: N = the low-z edge, S = high-z, W = low-x, E = high-x */
export function roomWallSegs(faces: WallFace[], room: RoomBox): WallSeg[] {
  const out: WallSeg[] = []
  for (const s of SIDES) {
    const edge = s.side === 'W' ? room.x0 : s.side === 'E' ? room.x1 : s.side === 'N' ? room.z0 : room.z1
    const e0 = s.axis === 'x' ? room.z0 : room.x0, e1 = s.axis === 'x' ? room.z1 : room.x1
    for (const f of faces) {
      if (f.axis !== s.axis || f.sign !== s.sign) continue
      const d = (f.p - edge) * s.sign
      if (d < -NEAR_OUT || d > NEAR_IN) continue
      const a0 = Math.max(f.a0, e0), a1 = Math.min(f.a1, e1)
      const y0 = Math.max(f.y0, room.y0 - 0.05), y1 = Math.min(f.y1, room.y1 + 0.05)
      if (a1 - a0 < 0.02 || y1 - y0 < 0.02) continue
      out.push({ side: s.side, axis: s.axis, sign: s.sign, p: f.p, a0, a1, y0, y1 })
    }
  }
  return out
}

/** the quad for a wall segment, lifted off the wall toward the room */
export function wallQuad(s: WallSeg, tileFt: number, lift = SKIN_LIFT): Quad {
  const q = s.p + s.sign * lift
  const pts: Array<[number, number, number]> = s.axis === 'z'
    ? [[s.a0, s.y0, q], [s.a1, s.y0, q], [s.a1, s.y1, q], [s.a0, s.y1, q]]
    : [[q, s.y0, s.a0], [q, s.y0, s.a1], [q, s.y1, s.a1], [q, s.y1, s.a0]]
  const nor: [number, number, number] = s.axis === 'x' ? [s.sign, 0, 0] : [0, 0, s.sign]
  const uvs = pts.map((p) => [(s.axis === 'x' ? p[2] : p[0]) / tileFt, p[1] / tileFt])
  return quadOf(pts, nor, uvs)
}

/** a horizontal quad over a rectangle at height y facing up (floor) or down (ceiling) */
export function flatQuad(x0: number, x1: number, z0: number, z1: number, y: number, up: boolean, tileFt: number): Quad {
  const pts: Array<[number, number, number]> = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]
  return quadOf(pts, [0, up ? 1 : -1, 0], pts.map((p) => [p[0] / tileFt, p[2] / tileFt]))
}

function quadOf(pts: Array<[number, number, number]>, nor: [number, number, number], uvs: number[][]): Quad {
  const a = pts[0], b = pts[1], c = pts[2]
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2]
  const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx
  const flip = cx * nor[0] + cy * nor[1] + cz * nor[2] < 0
  return {
    pos: pts.flat(), nor: pts.flatMap(() => nor), uv: uvs.flat(),
    index: flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3],
  }
}

/** several quads -> one set of attribute arrays */
export function mergeQuads(quads: Quad[]): { pos: number[]; nor: number[]; uv: number[]; index: number[] } {
  const out = { pos: [] as number[], nor: [] as number[], uv: [] as number[], index: [] as number[] }
  let base = 0
  for (const q of quads) {
    out.pos.push(...q.pos); out.nor.push(...q.nor); out.uv.push(...q.uv)
    out.index.push(...q.index.map((i) => i + base))
    base += q.pos.length / 3
  }
  return out
}

/** open / stair / vehicle spaces have no finished floor and ceiling of their own */
export const isSkinnable = (type: string): boolean => !['staircase', 'balcony', 'open_terrace', 'courtyard', 'parking', 'bike_parking', 'garden', 'terrace', 'lift'].includes(type)
