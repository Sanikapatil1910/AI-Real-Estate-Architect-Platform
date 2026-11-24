import * as THREE from 'three'
import { texBox } from './twinMaterials'
import type { Furn } from './twinThemes'
import type { Frame } from './twinInterior'

/**
 * Maharashtrian Wada: the pieces that make the style (carved columns with bracket capitals, cusped arches, timber balustrades, brass lanterns,
 * a tulsi vrindavan, a rangoli, a toran, gadi seating with bolsters and a jhula).
 *
 * Like every style module these only dress the validated plan: exterior pieces stand on the ground, on the verandah platform or hang from
 * the existing roof / ceiling heights; interior pieces are drawn inside the same slots the furniture system already reserved.  Nothing here
 * moves a wall, a room or an opening, and nothing is tagged as structure.
 */

type Mat = THREE.Material
export type Axis = 'x' | 'z'

export function box(g: THREE.Group, mat: Mat, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: { cast?: boolean; edge?: boolean } = {}) {
  if (x1 - x0 < 0.001 || y1 - y0 < 0.001 || z1 - z0 < 0.001) return
  const m = new THREE.Mesh(texBox(mat, x0, x1, y0, y1, z0, z1), mat)
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  m.castShadow = o.cast ?? true
  m.receiveShadow = true
  if (o.edge) m.userData.roofEdge = true
  g.add(m)
}

function lathe(g: THREE.Group, mat: Mat, x: number, y: number, z: number, prof: Array<[number, number]>, seg = 14) {
  const geo = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(Math.max(0.001, r), h)), seg)
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  g.add(m)
  return m
}

/* ------------------------------------------------------------------------------------------------ exterior pieces */
/**
 * A carved teak column: lotus base, a long shaft with a bulb, a neck and a lotus capital, under a bracket block whose brackets step out along
 * the beam (`beam` = the axis the beam runs along).  Spans y0..y1 (the underside of the beam).
 */
export function carvedPillar(g: THREE.Group, timber: Mat, x: number, z: number, y0: number, y1: number, beam: Axis, o: { r?: number } = {}) {
  const H = y1 - y0 - 0.45
  const r = o.r ?? 0.27
  const k = (t: number) => t * H
  const prof: Array<[number, number]> = [
    [r * 1.55, 0], [r * 1.7, 0.1], [r * 1.25, 0.28], [r * 1.05, 0.45], [r, 0.7],
    [r * 0.98, k(0.5)], [r * 1.28, k(0.55)], [r * 1.18, k(0.6)], [r * 0.9, k(0.66)], [r * 0.92, H - 1.05],
    [r * 1.2, H - 0.9], [r * 1.45, H - 0.7], [r * 1.2, H - 0.5], [r * 1.6, H - 0.38], [r * 1.7, H - 0.18], [r * 1.5, H],
  ]
  lathe(g, timber, x, y0, z, prof, 14)
  // bracket block and stepped brackets along the beam
  const top = y1
  const bw = 0.36
  const put = (a0: number, a1: number, yy0: number, yy1: number) => {
    if (beam === 'x') box(g, timber, x + a0, x + a1, yy0, yy1, z - bw / 2, z + bw / 2)
    else box(g, timber, x - bw / 2, x + bw / 2, yy0, yy1, z + a0, z + a1)
  }
  put(-0.5, 0.5, top - 0.46, top)
  for (const sd of [-1, 1]) {
    const seg = (e0: number, e1: number, yy0: number, yy1: number) => put(Math.min(sd * e0, sd * e1), Math.max(sd * e0, sd * e1), yy0, yy1)
    seg(0.5, 1.2, top - 0.3, top - 0.08)
    seg(0.5, 0.9, top - 0.58, top - 0.3)
    seg(0.5, 0.65, top - 0.82, top - 0.58)
  }
}

/** A cusped (multifoil) arch panel between two columns: a solid timber spandrel with a scalloped opening.  Panel centred on (cx, cz), spans w x h from y0. */
export function cuspedArch(g: THREE.Group, timber: Mat, cx: number, cz: number, axis: Axis, y0: number, w: number, h: number, thick = 0.22, foils = 5) {
  const m = Math.min(0.14, w * 0.04)
  const rx = w / 2 - m
  const ys = Math.min(h * 0.4, h - 0.5)
  const ry = h - ys - 0.18
  if (rx < 0.4 || ry < 0.3) return
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, 0)
  shape.lineTo(-rx, 0)
  shape.lineTo(-rx, ys)
  const P = (i: number): [number, number] => {
    const t = Math.PI - (Math.PI * i) / foils
    return [rx * Math.cos(t), ys + ry * Math.sin(t)]
  }
  for (let i = 0; i < foils; i++) {
    const a = P(i), b = P(i + 1)
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
    // scallop: the control point is pulled in towards the centre of the opening, which makes a cusp at every joint
    const cxp = mx * 0.8, cyp = ys + (my - ys) * 0.8
    shape.quadraticCurveTo(cxp, cyp, b[0], b[1])
  }
  shape.lineTo(rx, 0)
  shape.lineTo(w / 2, 0)
  shape.lineTo(w / 2, h)
  shape.lineTo(-w / 2, h)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 6 })
  // planar UVs in feet so the plank texture does not stretch
  const pos = geo.getAttribute('position')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = (pos.getX(i) + pos.getZ(i)) / 4; uv[i * 2 + 1] = pos.getY(i) / 4 }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  const mesh = new THREE.Mesh(geo, timber)
  mesh.castShadow = true
  mesh.receiveShadow = true
  if (axis === 'x') mesh.position.set(cx, y0, cz - thick / 2)
  else { mesh.rotation.y = -Math.PI / 2; mesh.position.set(cx + thick / 2, y0, cz) }
  g.add(mesh)
}

/** A timber balustrade along a straight run: posts with finials, a top rail with a carved lower rail, a bottom rail and turned balusters. */
export function timberBalustrade(g: THREE.Group, timber: Mat, axis: Axis, c: number, a: number, b: number, y0: number, h: number, o: { post?: number } = {}) {
  const len = b - a
  if (len < 0.4) return
  const B = (a0: number, b0: number, yy0: number, yy1: number, n0: number, n1: number) => {
    if (axis === 'x') box(g, timber, a0, b0, yy0, yy1, c + n0, c + n1)
    else box(g, timber, c + n0, c + n1, yy0, yy1, a0, b0)
  }
  const L = (u: number, yy0: number, prof: Array<[number, number]>) => (axis === 'x' ? lathe(g, timber, u, yy0, c, prof, 8) : lathe(g, timber, c, yy0, u, prof, 8))
  const np = Math.max(1, Math.round(len / (o.post ?? 4)))
  for (let i = 0; i <= np; i++) {
    const u = a + (len * i) / np
    const u0 = Math.min(Math.max(u - 0.17, a), b - 0.34), u1 = u0 + 0.34
    B(u0, u1, y0, y0 + h + 0.05, -0.17, 0.17)
    B(u0 - 0.04, u1 + 0.04, y0 + h + 0.05, y0 + h + 0.14, -0.21, 0.21)
    L((u0 + u1) / 2, y0 + h + 0.14, [[0.0, 0], [0.16, 0.03], [0.14, 0.12], [0.07, 0.22], [0.1, 0.3], [0.04, 0.42], [0.0, 0.5]])
  }
  B(a, b, y0 + h - 0.1, y0 + h + 0.12, -0.14, 0.14)     // handrail
  B(a, b, y0 + h - 0.42, y0 + h - 0.32, -0.08, 0.08)    // carved lower rail
  B(a, b, y0 + 0.18, y0 + 0.36, -0.1, 0.1)             // bottom rail
  const n = Math.max(2, Math.round(len / 0.5))
  const bal: Array<[number, number]> = [[0.06, 0], [0.08, 0.1], [0.05, 0.22], [0.09, 0.42], [0.1, 0.5], [0.09, 0.58], [0.05, 0.8], [0.07, 0.95], [0.06, 1]]
  for (let i = 1; i < n; i++) {
    const u = a + (len * i) / n
    const hh = h - 0.5
    L(u, y0 + 0.36, bal.map(([r, t]) => [r, t * hh] as [number, number]))
  }
}

/** A brass hanging lantern (chain, cap, a six-sided glowing cage, base finial). `top` = the height of the hook. */
export function lantern(g: THREE.Group, brass: Mat, glow: Mat, x: number, top: number, z: number, o: { chain?: number; s?: number } = {}) {
  const s = o.s ?? 1
  const ch = o.chain ?? 1.0
  const cyl = (rt: number, rb: number, y0: number, y1: number, m: Mat, seg = 6) => {
    const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, y1 - y0, seg), m)
    me.position.set(x, (y0 + y1) / 2, z)
    me.castShadow = false
    g.add(me)
  }
  cyl(0.012 * s, 0.012 * s, top - ch, top, brass, 4)
  const y = top - ch
  cyl(0.02 * s, 0.26 * s, y - 0.3 * s, y, brass, 6)              // cap
  cyl(0.24 * s, 0.24 * s, y - 1.0 * s, y - 0.3 * s, glow, 6)      // glowing cage
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.7 * s, 4), brass)
    bar.position.set(x + Math.cos(a) * 0.245 * s, y - 0.65 * s, z + Math.sin(a) * 0.245 * s)
    g.add(bar)
  }
  cyl(0.26 * s, 0.05 * s, y - 1.22 * s, y - 1.0 * s, brass, 6)   // base
  cyl(0.012 * s, 0.03 * s, y - 1.4 * s, y - 1.22 * s, brass, 6)  // finial
}

/** A tulsi vrindavan: a plastered pedestal with arched niches on all four sides, a stepped cap, a pot with the holy basil and a small lamp. */
export function tulsiVrindavan(g: THREE.Group, M: { plaster: Mat; stone: Mat; cap: Mat; pot: Mat; leaf: Mat; leaf2: Mat; brass: Mat; glow: Mat; dark: Mat }, x: number, z: number) {
  box(g, M.stone, x - 1.15, x + 1.15, 0, 0.35, z - 1.15, z + 1.15)
  box(g, M.stone, x - 0.95, x + 0.95, 0.35, 0.6, z - 0.95, z + 0.95)
  box(g, M.plaster, x - 0.78, x + 0.78, 0.6, 2.7, z - 0.78, z + 0.78)
  // arched niches on the four faces (a dark recess with a pointed head)
  for (const [dx, dz, ax] of [[0, 0.8, 'x'], [0, -0.8, 'x'], [0.8, 0, 'z'], [-0.8, 0, 'z']] as Array<[number, number, Axis]>) {
    const sd = (dx || dz) > 0 ? 1 : -1
    const n = 0.025
    if (ax === 'x') {
      box(g, M.dark, x - 0.3, x + 0.3, 1.25, 2.0, z + dz - (sd > 0 ? n : 0) , z + dz + (sd > 0 ? 0 : n), { cast: false })
      box(g, M.dark, x - 0.16, x + 0.16, 2.0, 2.28, z + dz - (sd > 0 ? n : 0), z + dz + (sd > 0 ? 0 : n), { cast: false })
    } else {
      box(g, M.dark, x + dx - (sd > 0 ? n : 0), x + dx + (sd > 0 ? 0 : n), 1.25, 2.0, z - 0.3, z + 0.3, { cast: false })
      box(g, M.dark, x + dx - (sd > 0 ? n : 0), x + dx + (sd > 0 ? 0 : n), 2.0, 2.28, z - 0.16, z + 0.16, { cast: false })
    }
  }
  box(g, M.cap, x - 0.95, x + 0.95, 2.7, 2.88, z - 0.95, z + 0.95)
  box(g, M.cap, x - 0.82, x + 0.82, 2.88, 3.0, z - 0.82, z + 0.82)
  lathe(g, M.pot, x, 3.0, z, [[0.0, 0], [0.42, 0], [0.5, 0.1], [0.52, 0.5], [0.46, 0.55], [0.0, 0.55]], 16)
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4
    const r = k === 0 ? 0 : 0.26
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 - k * 0.018, 1), k % 2 ? M.leaf2 : M.leaf)
    b.position.set(x + Math.cos(a) * r, 3.75 + k * 0.11, z + Math.sin(a) * r)
    b.castShadow = true
    g.add(b)
  }
  const diya = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), M.glow)
  diya.position.set(x + 0.62, 3.05, z + 0.62)
  g.add(diya)
}

/** A rangoli: concentric rings of coloured powder with eight petals, flat on the ground at (x, z). */
export function rangoli(g: THREE.Group, x: number, y: number, z: number, r: number) {
  const flat = (rad: number, yy: number, color: number, segs = 48) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.02, segs), new THREE.MeshStandardMaterial({ color, roughness: 1 }))
    m.position.set(x, y + yy, z)
    m.receiveShadow = true
    g.add(m)
    return m
  }
  flat(r, 0.012, 0xf3eee0)
  flat(r * 0.86, 0.022, 0xb8452f)
  flat(r * 0.72, 0.032, 0xf3eee0)
  flat(r * 0.6, 0.042, 0xe8a317)
  flat(r * 0.36, 0.052, 0xc02a4a)
  flat(r * 0.16, 0.062, 0xf3eee0)
  const petal = new THREE.MeshStandardMaterial({ color: 0x3f7f5a, roughness: 1 })
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.1, r * 0.1, 0.02, 14), petal)
    p.position.set(x + Math.cos(a) * r * 0.5, y + 0.07, z + Math.sin(a) * r * 0.5)
    g.add(p)
  }
}

/** A marigold toran: a sagging garland of orange and yellow flowers along a lintel (from (x0,z0) to (x1,z1) at height y, sag in ft). */
export function toran(g: THREE.Group, x0: number, z0: number, x1: number, z1: number, y: number, sag = 0.5) {
  const n = 18
  const mats = [new THREE.MeshStandardMaterial({ color: 0xf29a1f, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0xf6c344, roughness: 0.8 })]
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mats[i % 2])
    f.position.set(x0 + (x1 - x0) * t, y - Math.sin(Math.PI * t) * sag, z0 + (z1 - z0) * t)
    g.add(f)
  }
}

/* ------------------------------------------------------------------------------------------------ interior pieces */
/**
 * Gadi: a low timber platform with a white cotton mattress, a long back bolster (takiya) and round arm bolsters, in the sofa's slot (`w` x `f.D`,
 * back against v = 0).
 */
export function gadi(f: Frame, F: Furn, w: number) {
  const D = f.D
  f.b(F.woodDark, 0, w, 0, D, 0, 0.18)                                         // plinth
  f.b(F.wood, 0.04, w - 0.04, 0.04, D - 0.04, 0.18, 0.72)                      // carved timber box
  f.b(F.carved, 0, w, 0, D, 0.72, 0.82)                                         // moulded top edge
  for (let i = 0; i < Math.max(3, Math.round(w / 1.3)); i++) {
    const n = Math.max(3, Math.round(w / 1.3))
    f.b(F.carved, 0.2 + ((w - 0.4) * i) / n + 0.08, 0.2 + ((w - 0.4) * (i + 1)) / n - 0.08, D - 0.045, D, 0.28, 0.66)   // carved front panels
  }
  f.s(F.linen, 0.08, w - 0.08, 0.08, D - 0.08, 0.82, 1.18, 0.14)                // white cotton mattress
  f.s(F.accentA, 0.08, w - 0.08, 0.08, D - 0.08, 1.14, 1.2, 0.04)               // a coloured spread along the back half
  f.s(F.linen, 0.08, w - 0.08, D * 0.5, D - 0.08, 1.14, 1.19, 0.03)
  f.s(F.accentB, 0.35, w - 0.35, 0.1, 0.85, 1.2, 2.05, 0.4)                     // long back bolster
  f.s(F.accentA, 0.2, 0.85, 0.5, D - 0.35, 1.2, 1.75, 0.27)                     // arm bolsters
  f.s(F.accentA, w - 0.85, w - 0.2, 0.5, D - 0.35, 1.2, 1.75, 0.27)
  const n = w > 5 ? 3 : 2
  for (let i = 0; i < n; i++) {
    const u = (w * (i + 0.5)) / n
    f.s(i % 2 ? F.accentA : F.accentB, u - 0.42, u + 0.42, 0.7, 1.2, 1.2, 1.95, 0.12)    // square cushions leaning on the bolster
  }
}

/** A low carved table (chowki) with a brass urli and marigolds, for the gadi seating.  Slot `W` x `D`. */
export function chowki(f: Frame, F: Furn) {
  const W = f.W, D = f.D
  for (const [u, v] of [[0.3, 0.3], [W - 0.3, 0.3], [0.3, D - 0.3], [W - 0.3, D - 0.3]]) f.b(F.woodDark, u - 0.12, u + 0.12, v - 0.12, v + 0.12, 0, 0.9)
  f.b(F.wood, 0.05, W - 0.05, 0.05, D - 0.05, 0.72, 0.9)
  f.b(F.carved, 0, W, 0, D, 0.9, 1.08)
  f.b(F.woodDark, 0.08, W - 0.08, 0.08, D - 0.08, 1.08, 1.11)
  f.lathe(F.brassM, W * 0.5, D / 2, [[0.0, 0], [0.5, 0.05], [0.6, 0.2], [0.58, 0.26], [0.0, 0.26]], 28, 1.11)
  for (let k = 0; k < 6; k++) f.ball(k % 2 ? F.accentA : F.accentB, W * 0.5 + Math.cos(k * 1.05) * 0.26, D / 2 + Math.sin(k * 1.05) * 0.26, 1.42, 0.12)
}

/**
 * A jhula (swing): a carved plank seat on four brass chains from the ceiling, with a bolster and cushions.  `ceilH` = the height of the ceiling above
 * the floor.  Slot: `w` along the wall x `f.D` out.
 */
export function jhula(f: Frame, F: Furn, w: number, ceilH: number) {
  const D = f.D
  const seatY = 1.55
  f.b(F.carved, 0.1, w - 0.1, 0.35, D - 0.35, seatY, seatY + 0.2)               // plank seat
  f.b(F.wood, 0.06, w - 0.06, 0.28, D - 0.28, seatY + 0.2, seatY + 0.3)
  f.b(F.carved, 0.1, w - 0.1, 0.35, 0.55, seatY + 0.3, seatY + 2.1)              // low backrest
  f.b(F.carved, 0.1, w - 0.1, 0.3, 0.6, seatY + 2.1, seatY + 2.3)
  for (let i = 0; i < Math.max(4, Math.round(w / 0.5)); i++) {
    const n = Math.max(4, Math.round(w / 0.5))
    f.cy(F.wood, 0.3 + ((w - 0.6) * i) / (n - 1), 0.45, 0.05, seatY + 0.3, seatY + 2.1, 0.7, 6)
  }
  for (const u of [0.18, w - 0.18]) for (const v of [0.5, D - 0.4]) {
    f.cy(F.brassM, u, v, 0.022, seatY + 0.3, ceilH, 0.5, 5)                      // chains
    f.cy(F.brassM, u, v, 0.07, ceilH - 0.12, ceilH, 0.5, 8)                       // ceiling hooks
  }
  f.s(F.linen, 0.16, w - 0.16, 0.6, D - 0.38, seatY + 0.3, seatY + 0.62, 0.14)    // mattress
  f.s(F.accentB, 0.3, w - 0.3, 0.58, 1.0, seatY + 0.62, seatY + 1.35, 0.3)        // back bolster
  f.s(F.accentA, 0.25, 0.85, 1.0, D - 0.5, seatY + 0.62, seatY + 1.0, 0.12)
  f.s(F.accentA, w - 0.85, w - 0.25, 1.0, D - 0.5, seatY + 0.62, seatY + 1.0, 0.12)
}

/** A low carved seat (peeth) with a cushion, for the armchair slots of the living room.  Slot `w` x `f.D`. */
export function peeth(f: Frame, F: Furn, w: number) {
  const D = f.D
  const u0 = 0.25, u1 = w - 0.25, v0 = 0.25, v1 = D - 0.25
  for (const [u, v] of [[u0 + 0.12, v0 + 0.12], [u1 - 0.12, v0 + 0.12], [u0 + 0.12, v1 - 0.12], [u1 - 0.12, v1 - 0.12]]) f.lathe(F.woodDark, u, v, [[0.1, 0], [0.14, 0.08], [0.09, 0.18], [0.12, 0.34], [0.1, 0.6]], 10)
  f.b(F.carved, u0, u1, v0, v1, 0.6, 0.8)
  f.s(F.sofa, u0 + 0.06, u1 - 0.06, v0 + 0.06, v1 - 0.06, 0.8, 1.15, 0.14)
  f.s(F.accentA, w / 2 - 0.55, w / 2 + 0.55, 0.15, 0.7, 1.1, 1.9, 0.3)         // a round bolster at the back
}
