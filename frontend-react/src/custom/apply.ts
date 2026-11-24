/**
 * Applies a CustomState to the LOADED house (the exact scene the person walks through), live, without rebuilding it:
 *  - whole-house ROLES (doors, window frames, sofas, kitchen, curtains, outer walls, ...) swap the material of the role-tagged meshes (`userData.role`, written at build time and
 *    carried through the .glb as glTF extras).  Only meshes that carry that role are touched, so nothing that merely looks similar changes.
 *  - per-ROOM paint / wall material / accent wall / floor / ceiling are thin skins (src/custom/skins.ts) laid 3 mm in front of that room's own faces.
 * The original generated design is never modified: reset = remove the skins and put every original material (and uv) back.  Navigation / collision are not touched
 * (the nav grid was built from the original geometry; skins are not part of it).
 */
import * as THREE from 'three'
import { resolveDesign, roleMaterial, ROLE_OF_KEY } from '../components/twinThemes'
import type { Design, Overrides } from '../components/twinThemes'
import { surface } from '../components/twinMaterials'
import type { SmartHouse } from '../vr/smart/document'
import { roomKey } from '../vr/smart/document'
import { CEILING_COLORS, GATE_HEX, TINT_HEX, floorOption, wallMaterial } from './catalog'
import { collectWallFaces, flatQuad, isSkinnable, mergeQuads, roomWallSegs, wallQuad } from './skins'
import type { Quad, RoomBox, WallFace } from './skins'
import type { CustomState, RoomCustom } from './types'

/** keys that are real design-studio overrides (the rest of ROLE_OF_KEY are applied directly) */
const DESIGN_KEYS = Object.keys(ROLE_OF_KEY).filter((k) => k !== 'rugs' && k !== 'gate')
export interface ApplyResult { rolesSwapped: number; rolesHidden: number; skinQuads: number; roomsSkinned: number; skippedRooms: string[] }

const hex = (h: string) => parseInt(h.slice(1), 16)

export class CustomApplier {
  private roleMeshes = new Map<string, THREE.Mesh[]>()
  private base = new Map<THREE.Mesh, { material: THREE.Material; uv: THREE.BufferAttribute | null; visible: boolean }>()
  private made: THREE.Material[] = []
  private resolved = new Map<string, ReturnType<typeof resolveDesign>>()
  private skins = new THREE.Group()
  private faces: WallFace[] | null = null
  private skinMats = new Map<string, THREE.Material>()
  readonly rooms: RoomBox[]
  /** the paths that carry a role in this model (a house built without curtains has no 'furn.curtain') */
  readonly rolePaths: string[]
  private disposed = false

  constructor(private readonly root: THREE.Object3D, smart: SmartHouse, private readonly design: Design) {
    this.skins.name = 'custom-skins'
    this.skins.userData.custom = true
    root.add(this.skins)
    this.rooms = smart.rooms.map((r) => ({ key: roomKey(r), type: r.type, x0: r.rect.x0, x1: r.rect.x1, z0: r.rect.z0, z1: r.rect.z1, y0: r.floor_y, y1: r.ceiling_y }))
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || Array.isArray(m.material)) return
      const role = (m.material.userData as { role?: string } | undefined)?.role
      if (!role) return
      const l = this.roleMeshes.get(role) ?? []
      l.push(m); this.roleMeshes.set(role, l)
      this.base.set(m, { material: m.material, uv: (m.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined)?.clone() ?? null, visible: m.visible })
    })
    this.rolePaths = [...this.roleMeshes.keys()]
  }

  roomKeys(): string[] { return this.rooms.map((r) => r.key) }
  /** how many meshes carry a role path (tests / UI: "no curtains in this house") */
  meshesOf(path: string): number { return this.roleMeshes.get(path)?.length ?? 0 }
  hasRole(key: string): boolean { return (ROLE_OF_KEY[key] ?? []).some((p) => this.meshesOf(p) > 0) }

  apply(state: CustomState): ApplyResult {
    if (this.disposed) return { rolesSwapped: 0, rolesHidden: 0, skinQuads: 0, roomsSkinned: 0, skippedRooms: [] }
    const res: ApplyResult = { rolesSwapped: 0, rolesHidden: 0, skinQuads: 0, roomsSkinned: 0, skippedRooms: [] }
    this.restoreRoles()
    this.applyRoles(state, res)
    this.applySkins(state, res)
    return res
  }

  // ------------------------------------------------------------------ roles
  private restoreRoles(): void {
    for (const [m, b] of this.base) {
      m.material = b.material
      m.visible = b.visible
      if (b.uv) m.geometry.setAttribute('uv', b.uv.clone())
    }
    for (const x of this.made) x.dispose()
    this.made = []
  }

  private resolveFor(roles: Record<string, string>): ReturnType<typeof resolveDesign> {
    const over: Overrides = { ...this.design.over }
    for (const k of DESIGN_KEYS) if (roles[k]) (over as Record<string, unknown>)[k] = roles[k]
    const key = JSON.stringify(over)
    let r = this.resolved.get(key)
    if (!r) { r = resolveDesign({ ...this.design, over }); this.resolved.set(key, r) }
    return r
  }

  private applyRoles(state: CustomState, res: ApplyResult): void {
    const roles = state.roles
    if (!Object.keys(roles).length) return
    const r2 = this.resolveFor(roles)
    for (const [key, choice] of Object.entries(roles)) {
      for (const path of ROLE_OF_KEY[key] ?? []) {
        const meshes = this.roleMeshes.get(path)
        if (!meshes?.length) continue
        if (key === 'rugs' || key === 'gate') {
          const col = key === 'rugs' ? TINT_HEX[choice] : GATE_HEX[choice]
          if (col === undefined || choice === 'original') continue
          for (const m of meshes) {
            const mat = (this.base.get(m)!.material as THREE.MeshStandardMaterial).clone()
            mat.color.setHex(col)
            if (key === 'gate') { (mat as THREE.MeshStandardMaterial).map = null }       // a recoloured gate is a painted gate (no timber grain under the paint)
            mat.needsUpdate = true
            this.made.push(mat); m.material = mat; res.rolesSwapped++
          }
          continue
        }
        const nm = roleMaterial(r2, path)
        if (!nm) { for (const m of meshes) { m.visible = false; res.rolesHidden++ } continue }
        const newTile = (nm.userData.tileFt as number) || 0
        for (const m of meshes) {
          const b = this.base.get(m)!
          const baseTile = (b.material.userData.tileFt as number) || 0
          const mat = nm.clone()
          mat.userData = { ...nm.userData, role: path }
          this.made.push(mat)
          m.material = mat
          if (newTile > 0 && newTile !== baseTile || (newTile > 0 && !b.uv)) worldUV(m.geometry, newTile)
          res.rolesSwapped++
        }
      }
    }
  }

  // ------------------------------------------------------------------ per-room skins
  private wallFaces(): WallFace[] {
    if (this.faces) return this.faces
    const out: WallFace[] = []
    this.root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || Array.isArray(m.material) || m.userData.custom || (m.parent && m.parent.userData.custom)) return
      const u = m.material.userData as { surface?: string; role?: string } | undefined
      if (u?.surface !== 'plaster' || u.role) return
      const pos = m.geometry.getAttribute('position')
      if (!pos) return
      out.push(...collectWallFaces(pos.array as ArrayLike<number>, m.geometry.index ? (m.geometry.index.array as ArrayLike<number>) : null))
    })
    this.faces = out
    return out
  }

  private skinMat(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.skinMats.get(key)
    if (!m) {
      m = make().clone()
      m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2
      m.userData = { ...m.userData, custom: true }
      this.skinMats.set(key, m)
    }
    return m
  }

  private paintMat(color: string, finish: 'matte' | 'satin' | 'textured'): { m: THREE.Material; tile: number } {
    const m = this.skinMat(`paint|${color}|${finish}`, () => surface({ kind: 'plaster', color: hex(color), coarse: finish === 'textured' ? 0.75 : 0.05, finish: finish === 'satin' ? 'satin' : 'matte' }))
    return { m, tile: (m.userData.tileFt as number) || 2 }
  }
  private wallMatFor(c: { color?: string; finish?: 'matte' | 'satin' | 'textured'; material?: string }, fallbackColor: string): { m: THREE.Material; tile: number } | null {
    if (c.material) {
      const wm = wallMaterial(c.material)
      if (!wm) return null
      const m = this.skinMat(`wall|${wm.id}`, () => surface(wm.s))
      return { m, tile: (m.userData.tileFt as number) || 4 }
    }
    if (!c.color && !c.finish) return null
    return this.paintMat(c.color ?? fallbackColor, c.finish ?? 'matte')
  }

  private applySkins(state: CustomState, res: ApplyResult): void {
    for (const ch of [...this.skins.children]) { (ch as THREE.Mesh).geometry?.dispose(); this.skins.remove(ch) }
    for (const m of this.skinMats.values()) m.dispose()
    this.skinMats.clear()
    const groups = new Map<THREE.Material, Quad[]>()
    const add = (m: THREE.Material, q: Quad) => { const l = groups.get(m) ?? []; l.push(q); groups.set(m, l) }
    const baseWall = '#' + resolveDesign(this.design).wallColor.toString(16).padStart(6, '0')
    const byKey = new Map(this.rooms.map((r) => [r.key, r]))
    for (const [key, rc] of Object.entries(state.rooms)) {
      const room = byKey.get(key)
      if (!room) { res.skippedRooms.push(key); continue }
      let did = false
      did = this.skinWalls(room, rc, baseWall, add, res) || did
      if (rc.floor && isSkinnable(room.type)) {
        const fo = floorOption(rc.floor.id)
        if (fo) {
          const m = this.skinMat(`floor|${fo.id}|${rc.floor.finish ?? 'satin'}`, () => surface(fo.s(rc.floor!.finish ?? 'satin')))
          add(m, flatQuad(room.x0, room.x1, room.z0, room.z1, room.y0 + 0.012, true, (m.userData.tileFt as number) || 4)); res.skinQuads++; did = true
        }
      }
      if (rc.ceiling && isSkinnable(room.type) && (rc.ceiling.color || rc.ceiling.finish)) {
        const col = rc.ceiling.color ?? CEILING_COLORS[0].swatch
        const m = this.skinMat(`ceil|${col}|${rc.ceiling.finish ?? 'matte'}`, () => surface({ kind: 'plaster', color: hex(col), coarse: 0.02, finish: rc.ceiling!.finish === 'satin' ? 'satin' : 'matte' }))
        add(m, flatQuad(room.x0, room.x1, room.z0, room.z1, room.y1 - 0.012, false, 1.4)); res.skinQuads++; did = true
      }
      if (did) res.roomsSkinned++
    }
    for (const [m, quads] of groups) {
      const g = mergeQuads(quads)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2))
      geo.setIndex(g.index)
      const mesh = new THREE.Mesh(geo, m)
      mesh.name = 'custom-skin'; mesh.userData.custom = true; mesh.matrixAutoUpdate = false
      mesh.raycast = () => undefined           // a finish is never a thing to click or stand on
      this.skins.add(mesh)
    }
  }

  private skinWalls(room: RoomBox, rc: RoomCustom, baseWall: string, add: (m: THREE.Material, q: Quad) => void, res: ApplyResult): boolean {
    if (!rc.wall && !rc.accent) return false
    const main = rc.wall ? this.wallMatFor(rc.wall, baseWall) : null
    const acc = rc.accent ? this.wallMatFor({ color: rc.accent.color, material: rc.accent.material, finish: rc.wall?.finish }, baseWall) : null
    if (!main && !acc) return false
    let n = 0
    for (const s of roomWallSegs(this.wallFaces(), room)) {
      const use = rc.accent && s.side === rc.accent.side && acc ? acc : main
      if (!use) continue
      add(use.m, wallQuad(s, use.tile)); n++
    }
    res.skinQuads += n
    return n > 0
  }

  dispose(): void {
    this.disposed = true
    this.restoreRoles()
    for (const ch of [...this.skins.children]) { (ch as THREE.Mesh).geometry?.dispose(); this.skins.remove(ch) }
    for (const m of this.skinMats.values()) m.dispose()
    this.skinMats.clear()
    this.root.remove(this.skins)
  }
}

/** world-aligned uv in tile units (the same rule the generator uses): feet / tileFt, by the face's dominant axis */
export function worldUV(g: THREE.BufferGeometry, tile: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (!pos || !nor) return
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i))
    let u: number, v: number
    if (ay > 0.5) { u = x; v = z } else if (ax > 0.5) { u = z; v = y } else { u = x; v = y }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}
