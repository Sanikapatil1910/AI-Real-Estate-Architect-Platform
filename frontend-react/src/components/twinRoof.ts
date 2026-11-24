import * as THREE from 'three'
import { texBox } from './twinMaterials'

/**
 * Pitched clay-tile roofs for the Traditional Indian style.
 *
 * Every function adds geometry on top of the validated plan: the rectangles come from the plan's own footprint, roof areas and terrace, and the
 * roofs only sit above the finished walls (eave height = top of the slab).  Nothing here changes a wall, a room or an opening.
 * Pitched roofs are tagged `userData.roofEdge`, so the structure signature (walls, slabs, stairs) of both styles stays comparable.
 */
export interface RoofMats {
  tile: THREE.Material      // clay tile (procedural PBR, overlapping courses)
  ridge: THREE.Material     // ridge / hip caps
  timber: THREE.Material    // fascia, soffit, barge boards, gable trim
  fill: THREE.Material      // plastered gable ends and lean-to cheeks
}
export interface Rect { x0: number; x1: number; z0: number; z1: number }
type V3 = [number, number, number]

const tileOf = (m: THREE.Material) => (m.userData?.tileFt as number) || 3

function addPoly(g: THREE.Group, mat: THREE.Material, pts: V3[], hint: V3, uvf: (p: V3) => [number, number], tag = true) {
  const pos: number[] = []
  const uv: number[] = []
  const a = new THREE.Vector3(...pts[0]), b = new THREE.Vector3(...pts[1]), c = new THREE.Vector3(...pts[2])
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
  const list = n.dot(new THREE.Vector3(...hint)) < 0 ? [...pts].reverse() : pts
  for (const p of list) { pos.push(...p); uv.push(...uvf(p)) }
  const idx: number[] = []
  for (let i = 1; i < list.length - 1; i++) idx.push(0, i, i + 1)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  m.receiveShadow = true
  if (tag) m.userData.roofEdge = true
  g.add(m)
}

/** One sloping tile plane: `d` is the horizontal unit vector that points down the slope, `t` the tangent of the pitch. */
function slope(g: THREE.Group, M: RoofMats, pts: V3[], d: [number, number], t: number) {
  const tf = tileOf(M.tile)
  const e: [number, number] = [-d[1], d[0]]
  const sl = Math.hypot(1, t)
  const s: V3 = [-d[0] / sl, t / sl, -d[1] / sl]
  addPoly(g, M.tile, pts, [d[0], 1, d[1]], (p) => [(p[0] * e[0] + p[2] * e[1]) / tf, (p[0] * s[0] + p[1] * s[1] + p[2] * s[2]) / tf])
}

function flat(g: THREE.Group, mat: THREE.Material, pts: V3[], hint: V3, scale = 4) {
  addPoly(g, mat, pts, hint, (p) => [(p[0] + p[2]) / scale, (p[1] + p[0] * 0.3) / scale])
}

function box(g: THREE.Group, mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  if (x1 - x0 < 0.001 || y1 - y0 < 0.001 || z1 - z0 < 0.001) return
  const m = new THREE.Mesh(texBox(mat, x0, x1, y0, y1, z0, z1), mat)
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  m.castShadow = true
  m.receiveShadow = true
  m.userData.roofEdge = true
  g.add(m)
}

/** A round ridge / hip cap along a line (half buried in the roof). */
function cap(g: THREE.Group, M: RoofMats, a: V3, b: V3, r = 0.3) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
  const len = A.distanceTo(B)
  if (len < 0.05) return
  const geo = new THREE.CylinderGeometry(r, r, len, 8, 1)
  const m = new THREE.Mesh(geo, M.ridge)
  m.position.copy(A.clone().add(B).multiplyScalar(0.5)).add(new THREE.Vector3(0, r * 0.35, 0))
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize())
  m.castShadow = true
  m.userData.roofEdge = true
  g.add(m)
}

/** Fascia boards round an eave rectangle (their top is the roof edge) and the soffit underneath. */
function eaveTrim(g: THREE.Group, M: RoofMats, r: Rect, y0: number, sides: { x0?: boolean; x1?: boolean; z0?: boolean; z1?: boolean } = { x0: true, x1: true, z0: true, z1: true }) {
  const fh = 0.42, ft = 0.16
  if (sides.z0) box(g, M.timber, r.x0, r.x1, y0 - fh + 0.12, y0 + 0.12, r.z0, r.z0 + ft)
  if (sides.z1) box(g, M.timber, r.x0, r.x1, y0 - fh + 0.12, y0 + 0.12, r.z1 - ft, r.z1)
  if (sides.x0) box(g, M.timber, r.x0, r.x0 + ft, y0 - fh + 0.12, y0 + 0.12, r.z0, r.z1)
  if (sides.x1) box(g, M.timber, r.x1 - ft, r.x1, y0 - fh + 0.12, y0 + 0.12, r.z0, r.z1)
}
function soffit(g: THREE.Group, M: RoofMats, r: Rect, y: number) {
  flat(g, M.timber, [[r.x0, y, r.z0], [r.x1, y, r.z0], [r.x1, y, r.z1], [r.x0, y, r.z1]], [0, -1, 0])
}

/**
 * Hip roof over a rectangle.  The eave sits at `y0` (the top of the slab) and projects `over` ft beyond the rectangle; the ridge runs along the
 * longer side.  The rise is capped by `maxRise`, which lowers the pitch on very deep plans instead of towering over the street.
 * Returns the ridge height above the eave.
 */
export function hipRoof(g: THREE.Group, M: RoofMats, rc: Rect, y0: number, o: { pitch?: number; over?: number; maxRise?: number; trim?: boolean } = {}): number {
  const over = o.over ?? 1.6
  const R: Rect = { x0: rc.x0 - over, x1: rc.x1 + over, z0: rc.z0 - over, z1: rc.z1 + over }
  const W = R.x1 - R.x0, D = R.z1 - R.z0
  const alongX = W >= D
  const half = Math.min(W, D) / 2
  const h = Math.min((o.pitch ?? 0.46) * half, o.maxRise ?? 6.5)
  const t = h / half
  const xm = (R.x0 + R.x1) / 2, zm = (R.z0 + R.z1) / 2
  const yr = y0 + h
  const r0: V3 = alongX ? [R.x0 + half, yr, zm] : [xm, yr, R.z0 + half]
  const r1: V3 = alongX ? [R.x1 - half, yr, zm] : [xm, yr, R.z1 - half]
  const c00: V3 = [R.x0, y0, R.z0], c10: V3 = [R.x1, y0, R.z0], c11: V3 = [R.x1, y0, R.z1], c01: V3 = [R.x0, y0, R.z1]
  slope(g, M, [c01, c11, r1, r0], [0, 1], t)       // south face (down-slope +z)
  slope(g, M, [c00, c10, r1, r0], [0, -1], t)      // north face
  slope(g, M, [c00, c01, r0], [-1, 0], t)          // west hip / end
  slope(g, M, [c10, c11, r1], [1, 0], t)           // east hip / end
  cap(g, M, r0, r1)
  cap(g, M, r0, c00); cap(g, M, r0, c01)
  cap(g, M, r1, c10); cap(g, M, r1, c11)
  if (o.trim !== false) {
    eaveTrim(g, M, R, y0)
    soffit(g, M, R, y0 - 0.02)
  }
  return h
}

/**
 * A lean-to roof over a lower roof (a roof area of the floor below).  It leans on the wall of the upper floor on side `lean` and falls towards the
 * open edges; the rise at the wall stays under `rise` ft so it never reaches the upper floor's window sills (3 ft above the slab).
 * `exterior` says which sides are open to the outside (they get the eave overhang and the fascia); the other sides meet a wall.
 */
export function leanTo(g: THREE.Group, M: RoofMats, rc: Rect, lean: 'x0' | 'x1' | 'z0' | 'z1', y0: number, ext: { x0: boolean; x1: boolean; z0: boolean; z1: boolean },
  o: { rise?: number; over?: number } = {}) {
  const over = o.over ?? 1.3
  const R: Rect = { x0: rc.x0 - (ext.x0 ? over : 0), x1: rc.x1 + (ext.x1 ? over : 0), z0: rc.z0 - (ext.z0 ? over : 0), z1: rc.z1 + (ext.z1 ? over : 0) }
  const alongZ = lean === 'x0' || lean === 'x1'              // the wall runs along z, the slope falls along x
  const run = alongZ ? R.x1 - R.x0 : R.z1 - R.z0
  const rise = Math.min(o.rise ?? 2.2, run * 0.5)
  const t = rise / run
  const hi = (lean === 'x0' ? R.x0 : lean === 'x1' ? R.x1 : lean === 'z0' ? R.z0 : R.z1)
  const yAt = (x: number, z: number) => {
    const dist = alongZ ? Math.abs(x - hi) : Math.abs(z - hi)
    return y0 + rise - dist * t
  }
  const P = (x: number, z: number): V3 => [x, yAt(x, z), z]
  const d: [number, number] = lean === 'x0' ? [1, 0] : lean === 'x1' ? [-1, 0] : lean === 'z0' ? [0, 1] : [0, -1]
  slope(g, M, [P(R.x0, R.z0), P(R.x1, R.z0), P(R.x1, R.z1), P(R.x0, R.z1)], d, t)
  // cheeks: the plastered triangles at the two ends of the slope
  const ends: Array<[V3, V3, V3, V3]> = []
  if (alongZ) {
    const xl = lean === 'x0' ? R.x0 : R.x1, xo = lean === 'x0' ? R.x1 : R.x0
    for (const z of [R.z0, R.z1]) ends.push([[xl, y0, z], [xo, y0, z], [xl, y0 + rise, z], [0, 0, z === R.z0 ? -1 : 1]])
  } else {
    const zl = lean === 'z0' ? R.z0 : R.z1, zo = lean === 'z0' ? R.z1 : R.z0
    for (const x of [R.x0, R.x1]) ends.push([[x, y0, zl], [x, y0, zo], [x, y0 + rise, zl], [x === R.x0 ? -1 : 1, 0, 0]])
  }
  for (const [a, b, c, n] of ends) addPoly(g, M.fill, [a, b, c], n, (p) => [(p[0] + p[2]) / 4, p[1] / 4])
  // fascia on the low edge, a thin timber board along the open ends of the slope
  const low = lean === 'x0' ? 'x1' : lean === 'x1' ? 'x0' : lean === 'z0' ? 'z1' : 'z0'
  eaveTrim(g, M, R, y0, { [low]: true } as { x0?: boolean; x1?: boolean; z0?: boolean; z1?: boolean })
  // the cap where the slope meets the wall
  if (alongZ) cap(g, M, [hi, y0 + rise, R.z0], [hi, y0 + rise, R.z1], 0.2)
  else cap(g, M, [R.x0, y0 + rise, hi], [R.x1, y0 + rise, hi], 0.2)
  return rise
}

/**
 * A tiled skirt round a flat terrace: a sloping tile eave that projects from the top of the parapet, so a usable roof terrace still carries
 * the tiled-roof character without being covered.  `r` is the outer face of the parapet.
 */
export function skirt(g: THREE.Group, M: RoofMats, r: Rect, yTop: number, o: { width?: number; drop?: number } = {}) {
  const w = o.width ?? 1.7, dr = o.drop ?? 0.9
  const I: Rect = { x0: r.x0 - 0.05, x1: r.x1 + 0.05, z0: r.z0 - 0.05, z1: r.z1 + 0.05 }
  const O: Rect = { x0: I.x0 - w, x1: I.x1 + w, z0: I.z0 - w, z1: I.z1 + w }
  const yi = yTop, yo = yTop - dr
  const t = dr / w
  const iA: V3 = [I.x0, yi, I.z0], iB: V3 = [I.x1, yi, I.z0], iC: V3 = [I.x1, yi, I.z1], iD: V3 = [I.x0, yi, I.z1]
  const oA: V3 = [O.x0, yo, O.z0], oB: V3 = [O.x1, yo, O.z0], oC: V3 = [O.x1, yo, O.z1], oD: V3 = [O.x0, yo, O.z1]
  slope(g, M, [iD, iC, oC, oD], [0, 1], t)
  slope(g, M, [iA, iB, oB, oA], [0, -1], t)
  slope(g, M, [iA, iD, oD, oA], [-1, 0], t)
  slope(g, M, [iB, iC, oC, oB], [1, 0], t)
  cap(g, M, iA, iB, 0.22); cap(g, M, iD, iC, 0.22); cap(g, M, iA, iD, 0.22); cap(g, M, iB, iC, 0.22)
  eaveTrim(g, M, O, yo + 0.05)
}

/**
 * A pyramid (or hip) roof for a small square structure such as the stair headroom (mumty) on a terrace.
 */
export function capRoof(g: THREE.Group, M: RoofMats, rc: Rect, y0: number) {
  return hipRoof(g, M, rc, y0, { pitch: 0.5, over: 1.0, maxRise: 3.2 })
}

/**
 * The gabled verandah roof over the main entrance.  The ridge runs out from the facade; the gable end faces the street and is trimmed with timber.
 * `frame`: the facade line (`axis` 'h' = wall along x, 'v' = wall along z), its coordinate `c`, the door centre `mid`, and `out` (+1 / -1) = the
 * side that is outdoors.  `w`, `dpt` = width along the wall and projection from it; `yb` = the underside of the beam, `yr0` = eave level.
 */
export function gablePorchRoof(g: THREE.Group, M: RoofMats, f: { axis: 'h' | 'v'; c: number; mid: number; out: 1 | -1 }, o: { w: number; dpt: number; yb: number; rise?: number; over?: number }) {
  const over = o.over ?? 0.9
  // local frame: u along the wall, v away from it; mapping to world (x, z)
  const W = (u: number, v: number, y: number): V3 => (f.axis === 'h' ? [f.mid + u, y, f.c + f.out * v] : [f.c + f.out * v, y, f.mid + u])
  const hw = o.w / 2 + over, vo = o.dpt + over
  const y0 = o.yb
  const h = o.rise ?? Math.min(hw * 0.5, 3.4)
  const t = h / hw
  const dirU = (s: number): [number, number] => (f.axis === 'h' ? [s, 0] : [0, s])
  // the two slopes fall sideways (along u); the ridge runs along v
  const rA = W(0, 0.0, y0 + h), rB = W(0, vo, y0 + h)
  slope(g, M, [W(-hw, 0, y0), W(-hw, vo, y0), rB, rA], dirU(-1), t)
  slope(g, M, [W(hw, 0, y0), W(hw, vo, y0), rB, rA], dirU(1), t)
  cap(g, M, rA, rB, 0.26)
  // gable end (street side): plastered triangle with a timber barge board and a small timber panel
  const outN: V3 = f.axis === 'h' ? [0, 0, f.out] : [f.out, 0, 0]
  addPoly(g, M.fill, [W(-hw, vo, y0), W(hw, vo, y0), W(0, vo, y0 + h)], outN, (p) => [(p[0] + p[2]) / 4, p[1] / 4])
  const inset = 0.04
  addPoly(g, M.timber, [W(-hw * 0.55, vo + inset, y0 + 0.55), W(hw * 0.55, vo + inset, y0 + 0.55), W(0, vo + inset, y0 + h * 0.62)], outN, (p) => [(p[0] + p[2]) / 3, p[1] / 3])
  // barge boards along the two rakes
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(...W(s * hw, vo + 0.02, y0)), b = new THREE.Vector3(...W(0, vo + 0.02, y0 + h))
    const len = a.distanceTo(b)
    const mm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, 0.14), M.timber)
    mm.position.copy(a.clone().add(b).multiplyScalar(0.5))
    const ang = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z))
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(dir.x * Math.cos(ang), Math.sin(ang), dir.z * Math.cos(ang)).normalize())
    mm.quaternion.copy(q)
    mm.castShadow = true
    mm.userData.roofEdge = true
    g.add(mm)
  }
  // fascia along the two eaves, and the soffit
  const e0 = W(-hw, 0, y0), e1 = W(-hw, vo, y0), e2 = W(hw, 0, y0), e3 = W(hw, vo, y0)
  const bx0 = Math.min(e0[0], e1[0], e2[0], e3[0]), bx1 = Math.max(e0[0], e1[0], e2[0], e3[0])
  const bz0 = Math.min(e0[2], e1[2], e2[2], e3[2]), bz1 = Math.max(e0[2], e1[2], e2[2], e3[2])
  soffit(g, M, { x0: bx0, x1: bx1, z0: bz0, z1: bz1 }, y0 - 0.02)
  if (f.axis === 'h') {
    box(g, M.timber, bx0, bx0 + 0.15, y0 - 0.4, y0 + 0.1, bz0, bz1)
    box(g, M.timber, bx1 - 0.15, bx1, y0 - 0.4, y0 + 0.1, bz0, bz1)
  } else {
    box(g, M.timber, bx0, bx1, y0 - 0.4, y0 + 0.1, bz0, bz0 + 0.15)
    box(g, M.timber, bx0, bx1, y0 - 0.4, y0 + 0.1, bz1 - 0.15, bz1)
  }
  return h
}

/**
 * The roof of a house with a central courtyard (chowk): four tiled slopes round the open court, high at the court's edge and falling outwards to the
 * eaves, so from outside it reads as a hipped roof with the middle left open to the sky.  `B` = the footprint, `C` = the court (inside B).
 */
export function ringRoof(g: THREE.Group, M: RoofMats, B: Rect, C: Rect, y0: number, o: { over?: number; rise?: number } = {}) {
  const over = o.over ?? 1.7
  type Z = 'x0' | 'x1' | 'z0' | 'z1'
  const strips: Array<{ rc: Rect; lean: Z; ext: { x0: boolean; x1: boolean; z0: boolean; z1: boolean }; run: number }> = [
    { rc: { x0: B.x0, x1: B.x1, z0: B.z0, z1: C.z0 }, lean: 'z1', ext: { x0: true, x1: true, z0: true, z1: false }, run: C.z0 - B.z0 + over },
    { rc: { x0: B.x0, x1: B.x1, z0: C.z1, z1: B.z1 }, lean: 'z0', ext: { x0: true, x1: true, z0: false, z1: true }, run: B.z1 - C.z1 + over },
    { rc: { x0: B.x0, x1: C.x0, z0: C.z0, z1: C.z1 }, lean: 'x1', ext: { x0: true, x1: false, z0: false, z1: false }, run: C.x0 - B.x0 + over },
    { rc: { x0: C.x1, x1: B.x1, z0: C.z0, z1: C.z1 }, lean: 'x0', ext: { x0: false, x1: true, z0: false, z1: false }, run: B.x1 - C.x1 + over },
  ]
  const live = strips.filter((s) => s.run - over >= 0.8)
  if (!live.length) return 0
  const rise = Math.min(o.rise ?? 3.2, Math.min(...live.map((s) => s.run)) * 0.5)
  for (const s of live) leanTo(g, M, s.rc, s.lean, y0, s.ext, { rise, over })
  return rise
}
