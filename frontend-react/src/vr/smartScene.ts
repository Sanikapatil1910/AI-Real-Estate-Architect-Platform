/**
 * The smart-house things that live INSIDE the 3D scene: a ceiling light fixture per room, a ceiling fan with turning blades where the sidecar says there
 * is one, and a wall switch plate / fan regulator plate on the wall where the sidecar puts them (all positions come from the smart-house JSON; the .glb
 * meshes are never searched by name).  Plates are clickable (controller ray or mouse): they only call SmartHouseState, so they cannot disagree with the
 * control panel or with voice.
 *
 * Lighting: Quest 2 cannot afford a real light per room, so a small POOL of point lights (default 4) is handed to the lit rooms nearest the viewer and
 * faded in and out; every lit room additionally has its fixture glow.  The ambience of the scene is kept low (evening) so a lit room is visibly different.
 */
import * as THREE from 'three'
import { FT } from './houseLoader'
import { roomKey } from './smart/document'
import type { SmartHouse, SmartRoom } from './smart/document'
import type { SmartHouseState } from './smart/state'
import { drawPanel, layoutSignature } from './panelCanvas'
import { hitPanel } from './smart/panel'
import type { PanelAction, PanelLayout } from './smart/panel'
import { layoutFanPopup, POPUP_W, POPUP_H, POPUP_FT_W, POPUP_FT_H, POPUP_HIDE_SECONDS } from './fanPopup'

export type TargetKind = 'switch' | 'regPlus' | 'regMinus' | 'fan'
export interface TargetData { kind: TargetKind; key: string }

const Z = new THREE.Vector3(0, 0, 1)

function plateTexture(w: number, h: number): { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 2
  return { tex, ctx: c.getContext('2d')! }
}

interface FanRig { key: string; spin: THREE.Group; disc: THREE.Mesh; discMat: THREE.MeshBasicMaterial; ring: THREE.Mesh; floorY: number; x: number; z: number; name: string; floor: number; radius: number }
interface FixtureRig { key: string; mat: THREE.MeshStandardMaterial; pos: THREE.Vector3; range: number }
interface PlateRig { key: string; kind: 'switch' | 'reg'; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; w: number; h: number }
interface Slot { light: THREE.PointLight; key: string | null; level: number }

export class SmartScene {
  readonly group = new THREE.Group()
  /** invisible, generously sized hit volumes for the controller ray / mouse (kept apart so the ray never has to test the whole house) */
  readonly proxies: THREE.Mesh[] = []
  private fans: FanRig[] = []
  /** exposed for the tests / statistics */
  fixtures = new Map<string, FixtureRig>()
  private plates: PlateRig[] = []
  private slots: Slot[] = []
  private dirty = true
  private hoverTarget: TargetData | null = null
  private unsub: Array<() => void> = []
  private owned: Array<{ dispose(): void }> = []
  private poolTimer = 0
  private wanted = new Set<string>()
  private readonly viewer = new THREE.Vector3()
  /** how much light a room fixture adds (candela, in the metre-based world) */
  lightIntensity = 22
  // ---- the floating fan control (hint when pointed at, full with buttons after a selection)
  private popup: { mesh: THREE.Mesh; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string | null; mode: 'hint' | 'full'; hover: string | null; idle: number; sig: string; layout: PanelLayout | null } | null = null
  /** the fan the person last pointed at or selected (the panel's fan strip falls back to it) */
  lastFanKey: string | null = null

  constructor(private readonly doc: SmartHouse, private readonly st: SmartHouseState, readonly poolSize = 4) {
    this.group.name = 'smart-house'
    const own = <T extends { dispose(): void }>(o: T): T => { this.owned.push(o); return o }
    const white = own(new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.6 }))
    const wood = own(new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.7 }))
    const bladeGeo = own(new THREE.BoxGeometry(1, 0.035, 0.42)); bladeGeo.translate(0.5, 0, 0)
    const hubGeo = own(new THREE.CylinderGeometry(0.3, 0.34, 0.42, 14))
    const capGeo = own(new THREE.CylinderGeometry(0.24, 0.3, 0.1, 12))
    const rodGeo = own(new THREE.CylinderGeometry(0.035, 0.035, 1, 6))
    const canopyGeo = own(new THREE.CylinderGeometry(0.2, 0.28, 0.14, 12))
    const domeGeo = own(new THREE.CylinderGeometry(0.42, 0.5, 0.1, 18))

    for (const r of doc.rooms) {
      const key = roomKey(r)
      // ---- ceiling light fixture
      const fm = own(new THREE.MeshStandardMaterial({ color: 0xe9e4d6, emissive: 0xffe2a8, emissiveIntensity: 0, roughness: 0.5 }))
      const dome = new THREE.Mesh(domeGeo, fm)
      dome.position.set(r.light.pos[0], r.ceiling_y - 0.05, r.light.pos[2])
      dome.name = `light-${key}`
      this.group.add(dome)
      this.fixtures.set(key, { key, mat: fm, pos: new THREE.Vector3(r.light.pos[0], r.ceiling_y - 0.4, r.light.pos[2]), range: r.light.range_ft })
      if (r.fan) this.addFan(r, key, { white, wood, bladeGeo, hubGeo, capGeo, rodGeo, canopyGeo })
      if (r.switch) this.addPlate(r, key, 'switch')
      if (r.regulator && r.fan) this.addPlate(r, key, 'reg')
    }
    this.makePopup()
    for (let i = 0; i < poolSize; i++) {
      const l = new THREE.PointLight(0xffe6bd, 0, 1, 2)
      l.castShadow = false
      l.visible = false
      this.group.add(l)
      this.slots.push({ light: l, key: null, level: 0 })
    }
    this.unsub.push(st.lights.changed.on(() => { this.dirty = true }), st.fanLevelChanged.on(() => { this.dirty = true }))
  }

  private addFan(r: SmartRoom, key: string, m: { white: THREE.Material; wood: THREE.Material; bladeGeo: THREE.BufferGeometry; hubGeo: THREE.BufferGeometry; capGeo: THREE.BufferGeometry; rodGeo: THREE.BufferGeometry; canopyGeo: THREE.BufferGeometry }): void {
    const f = r.fan!
    const g = new THREE.Group()
    g.name = `fan-${key}`
    const cx = f.pos[0], cz = f.pos[2], top = f.pos[1]                       // top = lower end of the down-rod (= top of the motor)
    const bladeY = r.floor_y + f.blade_plane_above_floor_ft
    const rod = f.down_rod_ft > 0.05 ? f.down_rod_ft : 0
    if (rod > 0) {
      const rm = new THREE.Mesh(m.rodGeo, m.white); rm.scale.y = rod; rm.position.set(cx, top + rod / 2, cz); g.add(rm)
    }
    const canopy = new THREE.Mesh(m.canopyGeo, m.white); canopy.position.set(cx, r.ceiling_y - 0.07, cz); g.add(canopy)
    const spin = new THREE.Group()
    spin.position.set(cx, bladeY, cz)
    const hub = new THREE.Mesh(m.hubGeo, m.white); hub.position.y = 0.17; spin.add(hub)
    const cap = new THREE.Mesh(m.capGeo, m.white); cap.position.y = -0.08; spin.add(cap)
    const len = Math.max(0.6, f.blade_radius_ft - 0.3)
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group(); arm.rotation.y = (i * 2 * Math.PI) / 3
      const b = new THREE.Mesh(m.bladeGeo, m.wood); b.scale.x = len; b.position.x = 0.3; b.rotation.x = 0.12      // slight pitch
      arm.add(b); spin.add(arm)
    }
    // a faint disc that grows more visible with speed: the "blur" of fast blades
    const discMat = new THREE.MeshBasicMaterial({ color: 0xcfc6b4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    this.owned.push(discMat)
    const discGeo = new THREE.CircleGeometry(f.blade_radius_ft, 28); discGeo.rotateX(-Math.PI / 2)
    this.owned.push(discGeo)
    const disc = new THREE.Mesh(discGeo, discMat); disc.position.y = 0.02; disc.visible = false
    g.add(spin, disc)
    disc.position.set(cx, bladeY + 0.02, cz)
    // pointing aid: an amber ring at the blade tips while the fan is hovered / selected
    const ringGeo = new THREE.RingGeometry(f.blade_radius_ft + 0.05, f.blade_radius_ft + 0.22, 40); ringGeo.rotateX(-Math.PI / 2)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
    this.owned.push(ringGeo, ringMat)
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.set(cx, bladeY + 0.05, cz); ring.visible = false
    g.add(ring)
    this.group.add(g)
    // a generous invisible hit volume around the blades and hub (the ray picks it like a plate)
    const hitGeo = new THREE.CylinderGeometry(f.blade_radius_ft + 0.5, f.blade_radius_ft + 0.5, 2.0, 18)
    const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial())
    this.owned.push(hitGeo, hit.material as THREE.Material)
    hit.position.set(cx, bladeY + 0.3, cz); hit.visible = false
    hit.userData = { kind: 'fan', key } as TargetData
    this.group.add(hit)
    this.proxies.push(hit)
    this.fans.push({ key, spin, disc, discMat, ring, floorY: r.floor_y, x: cx, z: cz, name: r.name, floor: r.floor ?? 0, radius: f.blade_radius_ft })
  }

  private addPlate(r: SmartRoom, key: string, kind: 'switch' | 'reg'): void {
    const a = kind === 'switch' ? r.switch! : r.regulator!
    const w = kind === 'switch' ? 0.42 : 0.5, h = kind === 'switch' ? 0.62 : 1.0
    const px = kind === 'switch' ? 128 : 128, py = kind === 'switch' ? 190 : 256
    const { tex, ctx } = plateTexture(px, py)
    this.owned.push(tex)
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    const geo = new THREE.PlaneGeometry(w, h)
    this.owned.push(mat, geo)
    const n = new THREE.Vector3(a.normal[0], 0, a.normal[2]).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(Z, n)
    const plate = new THREE.Mesh(geo, mat)
    plate.position.set(a.pos[0] + n.x * 0.03, a.pos[1], a.pos[2] + n.z * 0.03)
    plate.quaternion.copy(q)
    plate.name = `${kind === 'switch' ? 'switch' : 'regulator'}-${key}`
    this.group.add(plate)
    const mk = (data: TargetData, bw: number, bh: number, oy: number) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.12), new THREE.MeshBasicMaterial())
      this.owned.push(box.geometry, box.material as THREE.Material)
      box.position.copy(plate.position).add(new THREE.Vector3(0, oy, 0)).addScaledVector(n, 0.06)
      box.quaternion.copy(q)
      box.visible = false
      box.userData = data
      this.group.add(box)
      this.proxies.push(box)
    }
    if (kind === 'switch') mk({ kind: 'switch', key }, 0.9, 1.1, 0)
    else { mk({ kind: 'regPlus', key }, 0.9, 0.62, 0.34); mk({ kind: 'regMinus', key }, 0.9, 0.62, -0.34) }
    this.plates.push({ key, kind, ctx, tex, w: px, h: py })
  }

  setHover(t: TargetData | null): void {
    const same = (!t && !this.hoverTarget) || (t && this.hoverTarget && t.kind === this.hoverTarget.kind && t.key === this.hoverTarget.key)
    if (same) return
    this.hoverTarget = t
    this.dirty = true
    if (t?.kind === 'fan') {
      this.lastFanKey = t.key
      if (!(this.popup?.mode === 'full' && this.popup.key === t.key)) this.showFanPopup(t.key, 'hint')   // pointing at a fan shows what it is and what the trigger does
    } else if (this.popup?.mode === 'hint') this.hideFanPopup()
  }

  // ------------------------------------------------------------------ the floating fan control
  private makePopup(): void {
    const c = document.createElement('canvas'); c.width = POPUP_W; c.height = POPUP_H
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, side: THREE.DoubleSide })
    const geo = new THREE.PlaneGeometry(POPUP_FT_W, POPUP_FT_H)
    this.owned.push(tex, mat, geo)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.visible = false; mesh.name = 'fan-popup'
    this.group.add(mesh)
    this.popup = { mesh, ctx: c.getContext('2d')!, tex, key: null, mode: 'hint', hover: null, idle: 0, sig: '', layout: null }
  }
  private fanInfo(key: string): { key: string; name: string; floor: number; level: number; rpm: number } | null {
    const f = this.fans.find((q) => q.key === key), m = this.st.fan(key)
    if (!f || !m) return null
    return { key, name: f.name, floor: f.floor, level: m.level, rpm: Math.round((m.spec.rpm[m.level] ?? 0)) }
  }
  /** opens the fan control at a fan: 'hint' (what it is) or 'full' (with the speed buttons) */
  showFanPopup(key: string, mode: 'hint' | 'full'): void {
    const p = this.popup
    if (!p || !this.fans.some((f) => f.key === key)) return
    if (p.mode === 'full' && p.key !== null && mode === 'hint') return              // an open control is never replaced by a hint
    p.key = key; p.mode = mode; p.idle = 0; p.sig = ''; p.hover = null
    p.mesh.visible = true
    this.lastFanKey = key
    this.dirty = true
  }
  hideFanPopup(): void {
    const p = this.popup
    if (!p) return
    p.key = null; p.mesh.visible = false; p.hover = null; p.sig = ''
    this.dirty = true
  }
  /** keeps an open fan control alive after an interaction */
  touchFanPopup(): void { if (this.popup) this.popup.idle = 0 }
  get fanPopup(): { key: string | null; mode: 'hint' | 'full'; visible: boolean } { const p = this.popup; return { key: p?.key ?? null, mode: p?.mode ?? 'hint', visible: !!p?.mesh.visible } }
  setPopupHover(id: string | null): void { const p = this.popup; if (p && p.hover !== id) { p.hover = id; p.sig = '' } }
  /** the nearest fan control button under a ray (null when the control is hidden / is only a hint / nothing is under the ray) */
  pickPopup(rc: THREE.Raycaster): { id: string; distance: number; action: PanelAction | null } | null {
    const p = this.popup
    if (!p || !p.mesh.visible || p.mode !== 'full' || !p.layout) return null
    p.mesh.updateMatrixWorld(true)
    const h = rc.intersectObject(p.mesh, false)[0]
    if (!h || !h.uv) return null
    const btn = hitPanel(p.layout, h.uv.x * POPUP_W, (1 - h.uv.y) * POPUP_H)
    return { id: btn?.id ?? '', distance: h.distance, action: btn?.action ?? null }
  }
  /** where a fan's blades are / where a button of the open fan control is, in the model frame (feet); used by the tests to aim at them */
  fanCenterFeet(key: string): THREE.Vector3 | null { const f = this.fans.find((q) => q.key === key); return f ? new THREE.Vector3(f.x, f.spin.position.y, f.z) : null }
  popupButtonFeet(id: string): THREE.Vector3 | null {
    const p = this.popup
    const b = p?.layout?.buttons.find((q) => q.id === id)
    if (!p || !b || !p.mesh.visible) return null
    p.mesh.updateMatrix()                                  // the group has no transform of its own, so the mesh matrix is in model feet
    return new THREE.Vector3(((b.x + b.w / 2) / POPUP_W - 0.5) * POPUP_FT_W, (0.5 - (b.y + b.h / 2) / POPUP_H) * POPUP_FT_H, 0).applyMatrix4(p.mesh.matrix)
  }
  /** every fan: its room, level and where it is (the panel's fan strip and the keyboard use the nearest) */
  nearestFan(feet: THREE.Vector3): string | null {
    let best: { k: string; d: number } | null = null
    for (const f of this.fans) {
      const dy = (f.floorY + 4 - feet.y) * 2.5
      const d = (f.x - feet.x) ** 2 + (f.z - feet.z) ** 2 + dy * dy
      if (!best || d < best.d) best = { k: f.key, d }
    }
    return best?.k ?? null
  }
  private updatePopup(dt: number, viewerFeet: THREE.Vector3): void {
    const p = this.popup
    if (!p || !p.mesh.visible || p.key === null) return
    const f = this.fans.find((q) => q.key === p.key)
    const info = f ? this.fanInfo(p.key) : null
    if (!f || !info) { this.hideFanPopup(); return }
    // a full control closes after a few quiet seconds, and when the person walks away or to another floor
    if (p.mode === 'full') {
      p.idle += dt
      const far = Math.hypot(f.x - viewerFeet.x, f.z - viewerFeet.z) > 14 || Math.abs(f.floorY - (viewerFeet.y - 0.3)) > 7
      if (p.idle > POPUP_HIDE_SECONDS || far) { this.hideFanPopup(); return }
    }
    // stands under the fan at a comfortable height, turned towards the person
    const dx = viewerFeet.x - f.x, dz = viewerFeet.z - f.z, l = Math.hypot(dx, dz) || 1
    const off = Math.min(1.4, Math.max(0.2, l - 1.8))
    p.mesh.position.set(f.x + (dx / l) * off, f.floorY + 4.9, f.z + (dz / l) * off)
    p.mesh.rotation.set(0, Math.atan2(dx, dz), 0)
    const lay = layoutFanPopup(info, p.mode)
    p.layout = lay
    const sig = layoutSignature(lay, p.hover) + p.mode
    if (sig !== p.sig) { p.sig = sig; drawPanel(p.ctx, lay, p.hover); p.tex.needsUpdate = true }
  }

  private drawPlate(p: PlateRig): void {
    const c = p.ctx, W = p.w, H = p.h
    const hov = this.hoverTarget && this.hoverTarget.key === p.key
    c.clearRect(0, 0, W, H)
    c.fillStyle = hov ? '#fff4d6' : '#ece8dc'; c.fillRect(0, 0, W, H)
    c.strokeStyle = '#8c8676'; c.lineWidth = 4; c.strokeRect(2, 2, W - 4, H - 4)
    c.textAlign = 'center'
    if (p.kind === 'switch') {
      const on = this.st.lights.isOn(p.key)
      c.fillStyle = '#5a564b'; c.font = 'bold 22px sans-serif'; c.fillText('LIGHT', W / 2, 30)
      c.fillStyle = on ? '#f2b630' : '#8a8576'; c.fillRect(24, 48, W - 48, 112)
      c.fillStyle = on ? '#fff3c4' : '#6f6a5d'; c.fillRect(24, on ? 48 : 104, W - 48, 56)
      c.fillStyle = '#2d2a22'; c.font = 'bold 26px sans-serif'; c.fillText(on ? 'ON' : 'OFF', W / 2, on ? 86 : 142)
    } else {
      const lvl = this.st.fanLevel(p.key)
      const plus = this.hoverTarget?.kind === 'regPlus' && hov, minus = this.hoverTarget?.kind === 'regMinus' && hov
      c.fillStyle = plus ? '#ffd778' : '#d9d3c1'; c.fillRect(14, 14, W - 28, 76)
      c.fillStyle = minus ? '#ffd778' : '#d9d3c1'; c.fillRect(14, H - 90, W - 28, 76)
      c.fillStyle = '#2d2a22'; c.font = 'bold 64px sans-serif'; c.fillText('+', W / 2, 74); c.fillText('−', W / 2, H - 28)
      c.font = 'bold 20px sans-serif'; c.fillText('FAN', W / 2, 112)
      c.fillStyle = lvl > 0 ? '#1d7a3a' : '#7a756a'; c.font = 'bold 66px sans-serif'; c.fillText(String(lvl), W / 2, 178)
      c.fillStyle = '#5a564b'; c.font = '16px sans-serif'; c.fillText('0 - 5', W / 2, 206)
    }
    p.tex.needsUpdate = true
  }

  /** viewerFeet: the viewer's position in the model frame (feet). */
  update(dt: number, viewerFeet: THREE.Vector3): void {
    if (this.dirty) { this.dirty = false; for (const p of this.plates) this.drawPlate(p) }
    // fixtures
    for (const fx of this.fixtures.values()) {
      const target = this.st.lights.isOn(fx.key) ? 2.2 : 0
      fx.mat.emissiveIntensity += (target - fx.mat.emissiveIntensity) * Math.min(1, dt * 12)
    }
    // fans
    const hoverFan = this.hoverTarget?.kind === 'fan' ? this.hoverTarget.key : null
    for (const f of this.fans) {
      f.ring.visible = f.key === hoverFan || (this.popup?.mesh.visible === true && this.popup.key === f.key)
      const m = this.st.fan(f.key)!
      f.spin.rotation.y = (-m.totalDeg * Math.PI) / 180
      const sp = Math.min(1, Math.abs(m.velocityDegPerSec) / 1800)
      f.discMat.opacity = sp * 0.22
      f.disc.visible = sp > 0.05
    }
    this.updatePopup(dt, viewerFeet)
    // light pool
    this.viewer.copy(viewerFeet)
    this.poolTimer -= dt
    if (this.poolTimer <= 0) { this.poolTimer = 0.25; this.assignPool() }
    for (const s of this.slots) {
      const want = s.key !== null && this.wanted.has(s.key) && this.st.lights.isOn(s.key) ? 1 : 0
      s.level += (want - s.level) * Math.min(1, dt * 8)
      s.light.intensity = s.level * this.lightIntensity
      s.light.visible = s.level > 0.01
      if (want === 0 && s.level < 0.02) s.key = null
    }
  }

  private assignPool(): void {
    const lit: Array<{ key: string; d: number }> = []
    for (const r of this.doc.rooms) {
      const key = roomKey(r)
      if (!this.st.lights.isOn(key)) continue
      const fx = this.fixtures.get(key)!
      const dy = (fx.pos.y - this.viewer.y) * 2.5               // a room on another floor counts as far away
      lit.push({ key, d: (fx.pos.x - this.viewer.x) ** 2 + (fx.pos.z - this.viewer.z) ** 2 + dy * dy })
    }
    lit.sort((a, b) => a.d - b.d)
    const wanted = new Set(lit.slice(0, this.slots.length).map((l) => l.key))
    this.wanted = wanted
    const have = new Set(this.slots.filter((s) => s.key !== null && wanted.has(s.key)).map((s) => s.key))
    for (const k of wanted) {
      if (have.has(k)) continue
      const slot = this.slots.find((s) => s.key === null) ?? this.slots.find((s) => s.key !== null && !wanted.has(s.key) && s.level < 0.15)
      if (!slot) continue
      const fx = this.fixtures.get(k)!
      slot.key = k
      slot.level = 0
      slot.light.position.copy(fx.pos)
      slot.light.distance = Math.max(4, fx.range * 1.6) * FT
    }
  }

  /** the lights that are currently allowed to shine (for tests / statistics) */
  get activeLights(): number { return this.slots.filter((s) => s.light.visible).length }
  get fanRigs(): ReadonlyArray<{ key: string; angleRad: number }> { return this.fans.map((f) => ({ key: f.key, angleRad: f.spin.rotation.y })) }

  dispose(): void {
    this.unsub.forEach((u) => u())
    this.owned.forEach((o) => o.dispose())
    this.group.clear()
  }
}
