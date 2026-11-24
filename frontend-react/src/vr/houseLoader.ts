/**
 * Gets a saved house into the VR scene WITHOUT any file transfer: the plan is built by the website's own generator code (`buildTwin`, the same call the
 * "Download 3D model (.glb)" button uses), exported to a binary glTF in memory with the same preparation as that button (full-height walls, roof,
 * ceilings, doors open, no labels), and that .glb is then LOADED back with GLTFLoader.  So what the person walks through is literally the exported .glb,
 * textures and materials included.  A .glb that arrives from elsewhere can be loaded the same way (prepareHouseFromGlb) together with its smart-house JSON.
 *
 * The model stays in its own frame (feet; x = plan x, y = up, z = plan y).  The scene puts it under a 0.3048 scale so one metre of headset movement is one
 * metre in the house.
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Plan } from '@/types'
import { buildTwin } from '../components/twinBuild'
import { WALK_OPEN_SCALE } from '../components/twinDoorsStairs'
import { takeAccessLog } from '../components/twinInterior'
import type { RoomAccessLog } from '../components/twinInterior'
import { repairPlanAccess } from './planAccess'
import type { PlanAccessReport, PPlan } from './planAccess'
import { takeStairWalk } from '../components/stairWalk'
import { takeSeats } from '../components/seatRegistry'
import type { SeatSite } from '../components/seatRegistry'
import { resolveSeats } from './seats'
import type { SitSpot } from './seats'
import { RoomLocator } from './smart/document'
import type { WalkPatch } from '../components/stairWalk'
import type { TwinModel } from '../components/twinBuild'
import { designForStyle } from '../components/twinThemes'
import type { Design } from '../components/twinThemes'
import { styleIdOf } from '../components/twinStyles'
import { buildSmartHouse } from '../lib/smartHouse'
import { parseSmartHouse } from './smart/document'
import type { SmartHouse } from './smart/document'
import { NavGrid } from './navGrid'
import type { Foot } from './navGrid'

export const FT = 0.3048
/** textures larger than this are shrunk after loading (Quest 2 has little GPU memory) */
export const MAX_TEXTURE_PX = 1024

export interface HouseStats {
  meshes: number; meshesBeforeMerge: number; triangles: number; textures: number; texturePixels: number; glbBytes: number
  buildMs: number; exportMs: number; loadMs: number; navMs: number; navSamples: number
}
export interface LoadedHouse {
  root: THREE.Group
  smart: SmartHouse
  nav: NavGrid
  spawn: Foot
  /** places to sit (from the furniture the generator placed; empty for a plain .glb) */
  seats: SitSpot[]
  /** how the build made sure every room can be walked into: doors added for rooms the plan gave none (assumed, reported), the rooms' furniture clearance log, and the plan-level door check */
  access?: HouseAccessInfo
  stats: HouseStats
  /** where the model came from: 'plan' (built + exported in the browser) or 'glb' (a file / URL) */
  source: 'plan' | 'glb'
  /** the exported file, kept so the person can download exactly what is shown */
  glb: ArrayBuffer
  /** the design the house was built with (the customisation panel swaps finishes relative to it); undefined for a plain .glb file */
  design?: Design
  dispose: () => void
}
export interface HouseAccessInfo { plan: PlanAccessReport; rooms: RoomAccessLog[] }
export type Progress = (message: string, fraction: number) => void
export class HouseLoadError extends Error {
  constructor(msg: string, readonly cause2?: unknown) { super(msg); this.name = 'HouseLoadError' }
}

function disposeModel(m: TwinModel): void {
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose()
  })
}

/** Same preparation as the viewer's "Download 3D model (.glb)" button (TwinViewer.exportGlb), without touching the viewer. */
export async function exportTwinGlb(m: TwinModel): Promise<ArrayBuffer> {
  m.labels.forEach((l) => (l.visible = false))
  m.floors.forEach((g) => (g.visible = true))
  m.roof.visible = true
  m.exterior.visible = true
  m.ceil.forEach((g) => (g.visible = true))
  m.walls.forEach((w) => { w.scale.y = 1; w.position.y = 0 })
  m.doors.forEach((d) => { d.pivot.scale.y = 1; d.arc.visible = false; d.pivot.rotation.y = d.phi0 + d.dphi * WALK_OPEN_SCALE })
  m.lights.forEach((s) => (s.light.visible = false))
  return new Promise<ArrayBuffer>((resolve, reject) =>
    new GLTFExporter().parse(m.root, (r) => (r instanceof ArrayBuffer ? resolve(r) : reject(new Error('unexpected export result'))), reject, { binary: true, onlyVisible: true }))
}

type TexKey = 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'emissiveMap'
const TEX_KEYS: TexKey[] = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']

/** Shrinks oversized textures and caps anisotropy; returns {count, pixels} after the change. */
export function optimiseTextures(root: THREE.Object3D, maxPx = MAX_TEXTURE_PX): { textures: number; pixels: number } {
  const seen = new Set<THREE.Texture>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
    for (const m of mats) for (const k of TEX_KEYS) { const t = (m as unknown as Record<string, THREE.Texture | null>)[k]; if (t) seen.add(t) }
  })
  let pixels = 0
  for (const t of seen) {
    t.anisotropy = Math.min(t.anisotropy || 1, 4)
    const img = t.image as { width?: number; height?: number } | undefined
    const w = img?.width ?? 0, h = img?.height ?? 0
    if (w > maxPx || h > maxPx) {
      const sc = maxPx / Math.max(w, h)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc))
      c.getContext('2d')!.drawImage(img as unknown as CanvasImageSource, 0, 0, c.width, c.height)
      ;(img as { close?: () => void }).close?.()
      t.image = c
      t.needsUpdate = true
      pixels += c.width * c.height
    } else pixels += w * h
  }
  return { textures: seen.size, pixels }
}

/**
 * Quest 2 draws far faster with few draw calls.  The exported .glb keeps ~1300-1900 small meshes; the house never animates in VR (doors are open and fixed),
 * so every mesh that shares a material is baked into one mesh (positions moved into the model frame).  Geometry, materials and textures are unchanged.
 */
export function mergeStaticMeshes(root: THREE.Group): { group: THREE.Group; before: number; after: number } {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const groups = new Map<THREE.Material, THREE.Mesh[]>()
  let before = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || Array.isArray(m.material) || (m as THREE.SkinnedMesh).isSkinnedMesh) return
    before++
    const l = groups.get(m.material) ?? []
    l.push(m); groups.set(m.material, l)
  })
  const out = new THREE.Group()
  out.name = root.name
  let after = 0
  const mat = new THREE.Matrix4()
  for (const [material, meshes] of groups) {
    const parts: THREE.BufferGeometry[] = []
    const common = ['position', 'normal', 'uv', 'color'].filter((a) => meshes.every((m) => !!m.geometry.attributes[a]))
    for (const m of meshes) {
      const g = new THREE.BufferGeometry()
      const src = m.geometry
      for (const a of common) g.setAttribute(a, src.attributes[a].clone())
      if (src.index) g.setIndex(src.index.clone())
      else g.setIndex(Array.from({ length: src.attributes.position.count }, (_, i) => i))
      mat.multiplyMatrices(inv, m.matrixWorld)
      g.applyMatrix4(mat)
      parts.push(g)
    }
    const merged = mergeGeometries(parts, false)
    parts.forEach((g) => g.dispose())
    if (!merged) { for (const m of meshes) { out.add(m.clone()); after++ } ; continue }
    const mesh = new THREE.Mesh(merged, material)
    mesh.name = (material.name || 'material') + '-merged'
    mesh.matrixAutoUpdate = false
    out.add(mesh)
    after++
    for (const m of meshes) m.geometry.dispose()
  }
  return { group: out, before, after }
}

function triangleCount(root: THREE.Object3D): { meshes: number; triangles: number } {
  let meshes = 0, triangles = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    meshes++
    const g = m.geometry
    triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
  })
  return { meshes, triangles }
}

/** Samples every triangle of the loaded model into a walking grid covering the house footprint plus a margin. */
export function buildNavGrid(root: THREE.Object3D, smart: SmartHouse, margin = 30): NavGrid {
  const fp = smart.footprint
  const top = Math.max(...smart.floors.map((f) => f.ceiling_y))
  const grid = new NavGrid({ x0: fp.x0 - margin, z0: fp.z0 - margin, x1: fp.x1 + margin, z1: fp.z1 + margin, y1: top + 1 })
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const m = new THREE.Matrix4()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    const g = mesh.geometry
    const pos = g.attributes.position
    if (!pos) return
    m.multiplyMatrices(inv, mesh.matrixWorld)
    const idx = g.index
    const n = idx ? idx.count : pos.count
    for (let i = 0; i + 2 < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2
      a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); c.fromBufferAttribute(pos, i2).applyMatrix4(m)
      grid.addTriangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    }
  })
  return grid
}

/** A good place to start: the middle of the living room (else the first room) on the ground floor, on a spot the body fits. */
/** A standing place on the FLOOR of the room (not on a sofa, a bed or a counter top) with a free circle of about a foot around it, nearest to the room's middle. */
function floorSpotIn(r: SmartHouse['rooms'][number], nav: NavGrid): Foot | null {
  const cx = (r.rect.x0 + r.rect.x1) / 2, cz = (r.rect.z0 + r.rect.z1) / 2
  const onFloor = (x: number, z: number): number | null => { const g = nav.canStand(x, z, r.floor_y); return g !== null && Math.abs(g - r.floor_y) < 0.25 ? g : null }
  let best: Foot | null = null, bd = Infinity
  for (let x = r.rect.x0 + 0.6; x <= r.rect.x1 - 0.6; x += 0.5) for (let z = r.rect.z0 + 0.6; z <= r.rect.z1 - 0.6; z += 0.5) {
    const d = (x - cx) ** 2 + (z - cz) ** 2
    if (d >= bd) continue
    const g = onFloor(x, z); if (g === null) continue
    let free = true
    for (let a = 0; a < 8 && free; a++) free = onFloor(x + Math.cos(a * Math.PI / 4) * 1.0, z + Math.sin(a * Math.PI / 4) * 1.0) !== null
    if (free) { best = { x, y: g, z }; bd = d }
  }
  return best
}

export function chooseSpawn(smart: SmartHouse, nav: NavGrid): Foot {
  const ground = smart.rooms.filter((r) => r.floor === 0)
  const order = [...ground.filter((r) => r.type === 'living_room'), ...ground, ...smart.rooms]
  for (const r of order) { const s = floorSpotIn(r, nav); if (s) return s }
  for (const r of order) {
    const s = nav.nearestOpen((r.rect.x0 + r.rect.x1) / 2, (r.rect.z0 + r.rect.z1) / 2, r.floor_y + 0.2, 6)
    if (s) return s
  }
  const fp = smart.footprint
  return nav.nearestStandable((fp.x0 + fp.x1) / 2, (fp.z0 + fp.z1) / 2, smart.floors[0].floor_y + 0.2, 20)
    ?? { x: (fp.x0 + fp.x1) / 2, y: smart.floors[0].floor_y, z: (fp.z0 + fp.z1) / 2 }
}

/** Where to stand to use a given floor: its staircase room, else any room on it. */
export function floorSpot(smart: SmartHouse, nav: NavGrid, floor: number): Foot | null {
  const rooms = smart.rooms.filter((r) => r.floor === floor)
  const order = [...rooms.filter((r) => r.type === 'staircase'), ...rooms.filter((r) => r.type === 'living_room' || r.type === 'passage'), ...rooms]
  for (const r of order) {
    const s = nav.nearestOpen((r.rect.x0 + r.rect.x1) / 2, (r.rect.z0 + r.rect.z1) / 2, r.floor_y + 0.2, 6, 40) ?? nav.nearestStandable((r.rect.x0 + r.rect.x1) / 2, (r.rect.z0 + r.rect.z1) / 2, r.floor_y + 0.2, 6)
    if (s) return s
  }
  return null
}

async function parseGlb(buf: ArrayBuffer): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().parseAsync(buf.slice(0), '')
  return gltf.scene
}

/** Wraps a loaded .glb root + its smart-house data into a LoadedHouse (nav grid, spawn, statistics). */
export async function prepareHouseFromGlb(glb: ArrayBuffer, smartJson: unknown, opts: { progress?: Progress; source?: 'plan' | 'glb'; maxTexture?: number; timings?: Partial<HouseStats>; walk?: WalkPatch[]; seats?: SeatSite[]; access?: HouseAccessInfo; design?: Design } = {}): Promise<LoadedHouse> {
  const progress = opts.progress ?? (() => undefined)
  const smart = parseSmartHouse(smartJson)
  progress('Loading the 3D model into the viewer…', 0.6)
  const t0 = performance.now()
  let root: THREE.Group
  try { root = await parseGlb(glb) } catch (e) { throw new HouseLoadError('The 3D file could not be loaded. It may be damaged or not a .glb.', e) }
  const tex = optimiseTextures(root, opts.maxTexture ?? MAX_TEXTURE_PX)
  const merge = mergeStaticMeshes(root)
  root = merge.group
  const loadMs = performance.now() - t0
  progress('Preparing walking and collision…', 0.8)
  const t1 = performance.now()
  const nav = buildNavGrid(root, smart)
  if (opts.walk?.length) nav.addWalkPatches(opts.walk)      // stair treads/landings the generator knows exactly (a plain .glb has none: then stairs rely on the triangles)
  const navMs = performance.now() - t1
  const locator = new RoomLocator(smart.rooms)
  const seats = resolveSeats(nav, opts.seats ?? [], (x, y, z) => locator.locate(x, y, z))
  const spawn = chooseSpawn(smart, nav)
  const tc = triangleCount(root)
  progress('Ready', 1)
  return {
    root, smart, nav, spawn, seats, access: opts.access, source: opts.source ?? 'glb', glb, design: opts.design,
    stats: { ...tc, meshesBeforeMerge: merge.before, textures: tex.textures, texturePixels: tex.pixels, glbBytes: glb.byteLength, buildMs: 0, exportMs: 0, ...opts.timings, loadMs, navMs, navSamples: nav.samples },
    dispose: () => {
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.geometry.dispose()
        const mats = Array.isArray(m.material) ? m.material : [m.material]
        for (const mt of mats) { for (const k of TEX_KEYS) ((mt as unknown as Record<string, THREE.Texture | null>)[k])?.dispose(); mt.dispose() }
      })
    },
  }
}

/** Saved plan -> the house the VR scene walks through (build, export to .glb in memory, load that .glb, derive the smart-house data from the same plan). */
export async function prepareHouseFromPlan(plan: Plan, opts: { design?: Design; progress?: Progress; maxTexture?: number } = {}): Promise<LoadedHouse> {
  const progress = opts.progress ?? (() => undefined)
  if (!plan?.floors?.length) throw new HouseLoadError('This project has no floors to show.')
  progress('Building the house from your plan…', 0.05)
  await new Promise((r) => setTimeout(r, 0))            // let the message paint before the heavy synchronous work
  const t0 = performance.now()
  let model: TwinModel
  let walk: WalkPatch[] = []
  let seats: SeatSite[] = []
  let access: HouseAccessInfo | undefined
  let usedDesign: Design | undefined
  try {
    const design = opts.design ?? designForStyle(styleIdOf((plan as unknown as { architectural_style?: string }).architectural_style))
    usedDesign = design
    // a room with no way in is repaired before anything is built (the stored plan is not changed; every added door is reported)
    const pa = repairPlanAccess(plan as unknown as PPlan)
    model = buildTwin(pa.plan as unknown as Plan, design, { walkable: true })
    walk = takeStairWalk()
    seats = takeSeats()
    access = { plan: pa, rooms: takeAccessLog() }
  } catch (e) { throw new HouseLoadError('The house could not be built from this plan.', e) }
  const buildMs = performance.now() - t0
  progress('Exporting the 3D model (.glb)…', 0.3)
  await new Promise((r) => setTimeout(r, 0))
  const t1 = performance.now()
  let glb: ArrayBuffer
  try { glb = await exportTwinGlb(model) } catch (e) { throw new HouseLoadError('The 3D model could not be exported.', e) } finally { disposeModel(model) }
  const exportMs = performance.now() - t1
  progress('Reading the smart-house data…', 0.5)
  let smart: SmartHouse
  try { smart = buildSmartHouse(plan) } catch (e) { throw new HouseLoadError('The smart-house data could not be derived from this plan.', e) }
  return prepareHouseFromGlb(glb, smart, { progress, source: 'plan', maxTexture: opts.maxTexture, timings: { buildMs, exportMs }, walk, seats, access, design: usedDesign })
}
