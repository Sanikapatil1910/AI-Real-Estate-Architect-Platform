import * as THREE from 'three'

/**
 * Parked vehicles for the digital twin: a sedan, an SUV and a Royal Enfield style classic bike,
 * built from simple solids.  Units: feet.  Each model faces +x, sits on y = 0, is centred on its
 * footprint, and is rotated into place by the caller.
 */

const std = (c: number, rough = 0.5, metal = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal })
const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a35, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.88 })
const tyre = std(0x16181a, 0.95)
const hub = std(0xb9bec3, 0.3, 0.8)
const chrome = std(0xcfd3d7, 0.15, 0.95)
const blackM = std(0x15181b, 0.6, 0.2)

function addBox(g: THREE.Object3D, m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m)
  b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  b.castShadow = true
  g.add(b)
  return b
}

/** Extrude a side profile (x forward, y up) across the car's width. */
function profile(g: THREE.Object3D, pts: Array<[number, number]>, m: THREE.Material, depth: number) {
  const shape = new THREE.Shape()
  pts.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)))
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  geo.translate(0, 0, -depth / 2)
  const mesh = new THREE.Mesh(geo, m)
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return mesh
}

function wheel(g: THREE.Object3D, x: number, z: number, r: number, w: number) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 22), tyre)
  t.rotation.x = Math.PI / 2
  t.position.set(x, r, z)
  t.castShadow = true
  g.add(t)
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.04, 18), hub)
  h.rotation.x = Math.PI / 2
  h.position.set(x, r, z)
  g.add(h)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.08, 10), blackM)
  cap.rotation.x = Math.PI / 2
  cap.position.set(x, r, z)
  g.add(cap)
}

export type CarKind = 'sedan' | 'suv'

export function makeCar(kind: CarKind, color: number): THREE.Group {
  const g = new THREE.Group()
  const body = std(color, 0.32, 0.55)
  const suv = kind === 'suv'
  const L = suv ? 15 : 14.6
  const W = suv ? 6.1 : 5.8
  const hx = L / 2
  // side profile: rear -> roof -> bonnet -> front
  const pts: Array<[number, number]> = suv
    ? [[-hx, 1.0], [-hx, 3.4], [-hx + 0.4, 5.2], [-3.9, 5.5], [1.9, 5.5], [3.9, 3.7], [hx - 0.6, 3.4], [hx, 2.9], [hx, 1.0]]
    : [[-hx, 1.0], [-hx, 2.8], [-hx + 1.6, 3.05], [-3.9, 3.1], [-2.7, 4.6], [1.0, 4.6], [3.0, 3.1], [hx - 0.9, 2.95], [hx, 2.5], [hx, 1.0]]
  profile(g, pts, body, W - 0.5)
  // glass band (slightly wider than the body so the windows show on the sides)
  const gl: Array<[number, number]> = suv
    ? [[-3.6, 3.7], [-3.5, 5.1], [1.7, 5.1], [3.5, 3.7]]
    : [[-3.55, 3.15], [-2.55, 4.45], [0.9, 4.45], [2.75, 3.15]]
  profile(g, gl, glass, W - 0.44)
  // lower skirt, bumpers, lights, grille
  addBox(g, blackM, -hx + 0.2, hx - 0.2, 0.75, 1.15, -(W - 0.4) / 2, (W - 0.4) / 2)
  addBox(g, blackM, hx - 0.15, hx + 0.12, 1.0, 1.7, -(W - 0.9) / 2, (W - 0.9) / 2) // grille
  for (const s of [-1, 1]) {
    addBox(g, std(0xfff2c4, 0.2, 0.2), hx - 0.12, hx + 0.1, 2.0, 2.4, s * (W / 2 - 0.9), s * (W / 2 - 0.35)) // headlamps
    addBox(g, std(0xc0272d, 0.4), -hx - 0.08, -hx + 0.12, 2.1, 2.55, s * (W / 2 - 1.0), s * (W / 2 - 0.35)) // tail lamps
    addBox(g, body, 2.4, 3.1, 3.3, 3.6, s * (W / 2 + 0.05), s * (W / 2 + 0.55)) // mirrors
  }
  // wheels
  const wr = suv ? 1.15 : 1.05
  for (const x of [hx - 3.1, -hx + 3.0]) for (const z of [-1, 1]) wheel(g, x, z * (W / 2 - 0.35), wr, 0.75)
  g.userData = { length: L, width: W }
  return g
}

/** A Royal Enfield style classic: round headlamp, teardrop tank, spoked wheels, wide bars. */
export function makeBike(color: number): THREE.Group {
  const g = new THREE.Group()
  const paint = std(color, 0.3, 0.5)
  const steel = std(0x2b2f33, 0.5, 0.6)
  const seat = std(0x3a2a1e, 0.8)
  const R = 1.05
  const spoked = (x: number) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(R - 0.12, 0.15, 10, 28), tyre)
    t.position.set(x, R, 0)
    t.castShadow = true
    g.add(t)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.3, 0.035, 6, 28), chrome)
    rim.position.set(x, R, 0)
    g.add(rim)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI
      const sp = new THREE.Mesh(new THREE.BoxGeometry((R - 0.3) * 2, 0.03, 0.03), chrome)
      sp.position.set(x, R, 0)
      sp.rotation.z = a
      g.add(sp)
    }
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.34, 12), chrome)
    h.rotation.x = Math.PI / 2
    h.position.set(x, R, 0)
    g.add(h)
  }
  spoked(2.45)
  spoked(-2.45)
  // mudguards
  const mud = (x: number, len: number, y: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.42, 20, 1, true, -0.2, Math.PI * 0.7), paint)
    m.material = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5, side: THREE.DoubleSide })
    m.rotation.x = Math.PI / 2
    m.rotation.z = Math.PI / 2 + 0.25
    m.position.set(x, y, 0)
    m.castShadow = true
    g.add(m)
    void len
  }
  mud(2.45, 2, R)
  mud(-2.45, 2, R)
  // frame, engine, tank, seat
  addBox(g, steel, -1.0, 1.0, 0.8, 1.9, -0.28, 0.28) // crank-case / engine block
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, 1.0, 14), steel) // cylinder
  cyl.position.set(0.15, 2.1, 0)
  cyl.rotation.z = -0.15
  g.add(cyl)
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), paint)
  tank.scale.set(1.45, 0.82, 0.8)
  tank.position.set(0.4, 3.0, 0)
  tank.castShadow = true
  g.add(tank)
  addBox(g, seat, -2.0, -0.5, 2.55, 2.85, -0.45, 0.45) // saddle
  addBox(g, steel, -2.3, -0.4, 2.3, 2.5, -0.1, 0.1) // frame rail
  // forks and handlebar
  for (const z of [-0.32, 0.32]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.9, 8), chrome)
    f.position.set(1.95, 2.45, z)
    f.rotation.z = -0.4
    g.add(f)
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.5, 8), chrome)
  bar.rotation.x = Math.PI / 2
  bar.position.set(1.15, 3.85, 0)
  g.add(bar)
  for (const z of [-1.2, 1.2]) addBox(g, blackM, 1.05, 1.3, 3.8, 3.9, z - 0.18 * Math.sign(z), z + 0.18 * Math.sign(z))
  // round headlamp
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), chrome)
  lamp.position.set(1.85, 3.6, 0)
  lamp.scale.set(0.8, 1, 1)
  g.add(lamp)
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff3c8, emissive: 0xfff3c8, emissiveIntensity: 0.6 }))
  lens.position.set(2.1, 3.6, 0)
  g.add(lens)
  // exhaust and rear shocks
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 3.0, 12), chrome)
  ex.rotation.z = Math.PI / 2 + 0.05
  ex.position.set(-1.6, 1.0, 0.55)
  g.add(ex)
  for (const z of [-0.5, 0.5]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 8), chrome)
    s.position.set(-1.9, 1.9, z)
    s.rotation.z = 0.25
    g.add(s)
  }
  addBox(g, std(0xc0272d, 0.4), -2.55, -2.35, 1.9, 2.1, -0.15, 0.15) // tail lamp
  g.userData = { length: 6.9, width: 2.6 }
  return g
}

export const CAR_COLOURS = [0xe9ecef, 0x9a1b22, 0x7d8790, 0x1f3a5f]
export const BIKE_COLOURS = [0x1f4d3a, 0x15181b, 0x7a1f2b]
