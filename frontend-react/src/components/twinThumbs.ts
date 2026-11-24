import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { rugBox, solid, surface, texBox } from './twinMaterials'
import { ALL_THEME_ORDER as THEME_ORDER, resolveDesign, styleOfTheme } from './twinThemes'
import type { ThemeId } from './twinThemes'

/**
 * Preview pictures of the themes.  Each one is a real render of a small living room built from the theme's own resolved materials
 * (the same floor, wall, sofa, rug, curtain and wood materials the house uses), so a card shows what choosing it will look like.
 */
const cache = new Map<ThemeId, string>()

export function themeThumbnails(w = 320, h = 220): Record<ThemeId, string> {
  const out = {} as Record<ThemeId, string>
  if (THEME_ORDER.every((t) => cache.has(t))) { for (const t of THEME_ORDER) out[t] = cache.get(t)!; return out }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  } catch {
    return out
  }
  renderer.setPixelRatio(1)
  renderer.setSize(w, h, false)
  renderer.shadowMap.enabled = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.95
  const pm = new THREE.PMREMGenerator(renderer)
  const envScene = new RoomEnvironment()
  const env = pm.fromScene(envScene, 0.04)
  envScene.dispose()
  for (const id of THEME_ORDER) {
    const scene = buildRoom(id)
    scene.environment = env.texture
    scene.environmentIntensity = 0.55
    scene.background = new THREE.Color(0xe9eef2)
    const cam = new THREE.PerspectiveCamera(32, w / h, 0.5, 200)
    cam.position.set(16.2, 6.4, 18.6)
    cam.lookAt(5.9, 2.9, 3.4)
    renderer.render(scene, cam)
    const url = canvas.toDataURL('image/jpeg', 0.86)
    cache.set(id, url)
    out[id] = url
    scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose() })
  }
  env.dispose()
  pm.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
  return out
}

function buildRoom(id: ThemeId): THREE.Scene {
  const R = resolveDesign({ style: styleOfTheme(id), theme: id, over: {}, time: 'day' })
  const F = R.furn
  const scene = new THREE.Scene()
  const g = new THREE.Group()
  scene.add(g)
  const bx = (m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const me = new THREE.Mesh(texBox(m, x0, x1, y0, y1, z0, z1), m)
    me.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    me.castShadow = true
    me.receiveShadow = true
    g.add(me)
  }
  const soft = (m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rad = 0.14) => {
    const geo = new RoundedBoxGeometry(x1 - x0, y1 - y0, z1 - z0, 3, Math.min(rad, (x1 - x0) / 2.1, (y1 - y0) / 2.1, (z1 - z0) / 2.1))
    const me = new THREE.Mesh(geo, m)
    me.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    me.castShadow = true
    me.receiveShadow = true
    g.add(me)
  }
  const cyl = (m: THREE.Material, x: number, z: number, r0: number, r1: number, y0: number, y1: number) => {
    const me = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, y1 - y0, 24), m)
    me.position.set(x, (y0 + y1) / 2, z)
    me.castShadow = true
    me.receiveShadow = true
    g.add(me)
  }
  const Wd = 13, D = 10, H = 8.6
  const accent = R.def.accents?.living_room
  // shell
  bx(R.coded ? solid(0xdddddd) : surface(R.floorMain), -0.4, Wd, -0.3, 0, -0.4, D)
  bx(accent !== undefined ? solid(accent, 0.9) : R.wall, -0.4, Wd, 0, H, -0.4, 0)
  bx(R.wall, -0.4, 0, 0, H, 0, 2.4)
  bx(R.wall, -0.4, 0, 0, 3, 2.4, 7.6)
  bx(R.wall, -0.4, 0, 7, H, 2.4, 7.6)
  bx(R.wall, -0.4, 0, 0, H, 7.6, D)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.05, 4, 5.2), new THREE.MeshStandardMaterial({ color: 0xcfe6ee, transparent: true, opacity: 0.22, roughness: 0.05 }))
  glass.position.set(-0.2, 5, 5)
  g.add(glass)
  for (const [z0, z1, y0, y1] of [[2.3, 2.45, 3, 7], [7.55, 7.7, 3, 7], [2.3, 7.7, 3, 3.12], [2.3, 7.7, 6.88, 7], [4.9, 5.05, 3, 7]] as number[][]) bx(R.frame, -0.3, 0.05, y0, y1, z0, z1)
  // skirting
  bx(R.trimMat, 0, Wd, 0, 0.5, 0, 0.05)
  bx(R.trimMat, 0, 0.05, 0, 0.5, 0, D)
  // curtains
  if (F.curtain) {
    for (const [z0, z1] of [[1.9, 3.3], [6.9, 8.3]]) {
      const n = 5
      for (let i = 0; i < n; i++) bx(F.curtain, 0.12 + (i % 2 ? 0.12 : 0), 0.3 + (i % 2 ? 0.12 : 0), 0.7, 8.0, z0 + ((z1 - z0) / n) * i, z0 + ((z1 - z0) / n) * (i + 1))
    }
    bx(F.metal, 0.1, 0.2, 7.95, 8.05, 1.6, 8.6)
  }
  // rug + sofa group
  const rug = new THREE.Mesh(rugBox(F.rug, 8.2, 5.6, 0.07), F.rug)
  rug.position.set(6.1, 0.035, 5.0)
  rug.receiveShadow = true
  g.add(rug)
  const sx0 = 2.4, sx1 = 9.6
  for (const lx of [sx0 + 0.3, sx1 - 0.6]) for (const lz of [0.7, 3.2]) bx(F.woodDark, lx, lx + 0.3, 0, 0.4, lz, lz + 0.3)
  soft(F.sofa, sx0, sx1, 0.35, 1.45, 0.4, 3.5)
  soft(F.sofaDark, sx0, sx1, 1.4, 3.0, 0.4, 1.35, 0.3)
  soft(F.sofaDark, sx0, sx0 + 0.8, 1.4, 2.4, 0.4, 3.5, 0.25)
  soft(F.sofaDark, sx1 - 0.8, sx1, 1.4, 2.4, 0.4, 3.5, 0.25)
  const cw = (sx1 - sx0 - 1.6) / 3
  for (let i = 0; i < 3; i++) soft(F.chairFab, sx0 + 0.8 + cw * i + 0.02, sx0 + 0.8 + cw * (i + 1) - 0.02, 1.4, 1.95, 1.35, 3.5, 0.2)
  const pillow = (m: THREE.Material, x: number, tilt = 0) => {
    const me = new THREE.Mesh(new RoundedBoxGeometry(1.35, 1.35, 0.4, 3, 0.15), m)
    me.position.set(x, 2.35, 1.7)
    me.rotation.z = tilt
    me.rotation.x = -0.18
    me.castShadow = true
    g.add(me)
  }
  pillow(F.accentA, sx0 + 1.3, 0.12)
  pillow(F.accentB, sx0 + 2.8, -0.1)
  pillow(F.accentA, sx1 - 1.3, -0.12)
  // coffee table, book, vase
  bx(F.wood, 4.4, 8.0, 1.15, 1.32, 4.5, 6.2)
  for (const [lx, lz] of [[4.55, 4.65], [7.65, 4.65], [4.55, 5.85], [7.65, 5.85]]) bx(F.metal, lx, lx + 0.15, 0, 1.15, lz, lz + 0.15)
  bx(F.accentB, 4.8, 5.8, 1.32, 1.4, 4.8, 5.5)
  bx(F.linen, 4.85, 5.75, 1.4, 1.46, 4.85, 5.45)
  cyl(F.glass, 7.1, 5.3, 0.32, 0.22, 1.32, 2.0)
  for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 - k * 0.05, 1), k % 2 ? F.leaf2 : F.leaf); b.position.set(7.1 + (k - 1) * 0.15, 2.2 + k * 0.25, 5.3); g.add(b) }
  // armchair
  soft(F.chairFab, 10.4, 12.4, 0.35, 1.3, 4.6, 6.9, 0.2)
  soft(F.chairFabDark, 11.7, 12.5, 1.3, 3.0, 4.6, 6.9, 0.25)
  soft(F.chairFabDark, 10.4, 12.4, 1.3, 2.1, 4.6, 5.2, 0.2)
  soft(F.chairFabDark, 10.4, 12.4, 1.3, 2.1, 6.3, 6.9, 0.2)
  for (const [lx, lz] of [[10.6, 4.8], [10.6, 6.5], [12.0, 4.8], [12.0, 6.5]]) bx(F.woodDark, lx, lx + 0.18, 0, 0.35, lz, lz + 0.18)
  // floor lamp + plant
  cyl(F.metalDark, 1.4, 1.2, 0.5, 0.5, 0, 0.1)
  cyl(F.metalDark, 1.4, 1.2, 0.05, 0.05, 0.1, 5.4)
  cyl(F.lampShade, 1.4, 1.2, 0.55, 0.8, 5.0, 6.1)
  cyl(F.pot, 11.8, 1.1, 0.62, 0.45, 0, 1.3)
  for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62 - k * 0.05, 1), k % 2 ? F.leaf2 : F.leaf); b.position.set(11.8 + Math.sin(k * 2.2) * 0.3, 1.9 + k * 0.42, 1.1 + Math.cos(k * 2.2) * 0.3); b.castShadow = true; g.add(b) }
  // wall art + sideboard
  bx(F.woodDark, 3.7, 8.3, 4.5, 7.3, 0.0, 0.12)
  bx(F.accentA, 3.9, 6.0, 4.7, 7.1, 0.12, 0.16)
  bx(F.accentB, 6.0, 8.1, 4.7, 7.1, 0.12, 0.16)
  bx(F.wood, 10.0, 12.9, 0.5, 2.6, 2.2, 3.4)
  bx(F.woodDark, 10.1, 12.8, 0, 0.5, 2.3, 3.3)

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2)
  sun.position.set(-6, 14, 16)
  sun.target.position.set(6, 0, 4)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  const sc = sun.shadow.camera
  sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60
  sun.shadow.bias = -0.0006
  scene.add(sun, sun.target)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc4b0, 0.5))
  return scene
}
