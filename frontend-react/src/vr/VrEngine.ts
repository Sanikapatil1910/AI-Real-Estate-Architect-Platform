/**
 * The walk-through engine: one three.js scene that runs in two modes.
 *
 *   VR       WebXR 'immersive-vr' session (Meta Quest Browser): headset tracking, Touch-controller rays, thumbstick walking, snap turning, the in-world panel.
 *   DESKTOP  ordinary canvas: WASD / arrow keys + drag to look, click on switches, the panel is an HTML overlay (React).  This is also what runs when WebXR is
 *            missing, so the house can always be inspected.
 *
 * Both modes share the SAME state (SmartHouseState), collision grid (NavGrid) and panel model, so a light switched on from the wall plate, the panel,
 * voice or the automatic mode is the same light everywhere.  Units: the house is modelled in feet and put under a 0.3048 scale, so the headset's metres are
 * real metres in the house; the foot position and all collision are kept in feet in the house frame.
 *
 * Nothing in here has run on a real Quest: it is tested with a mocked navigator.xr and simulated controllers (see docs).
 */
import * as THREE from 'three'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js'
import { makeSkyEnv, makeStudioEnv } from '../components/twinScene'
import { FT, floorSpot } from './houseLoader'
import type { LoadedHouse } from './houseLoader'
import type { Foot } from './navGrid'
import { SmartScene } from './smartScene'
import type { TargetData } from './smartScene'
import { SmartHouseState } from './smart/state'
import { RoomLocator, roomKey } from './smart/document'
import { PanelModel, layoutPanel, hitPanel, runPanelAction, PANEL_W, PANEL_H, FAN_SPEEDS } from './smart/panel'
import type { PanelAction, PanelLayout } from './smart/panel'
import { drawPanel, layoutSignature } from './panelCanvas'
import { CustomController } from '../custom/controller'
import type { StorageLike } from '../custom/store'
import { VoiceInput, detectVoice } from './voiceInput'
import type { VoiceSupport } from './voiceInput'
import { ContinuousVoice, hudInfo } from './continuousVoice'
import type { VcStatus, VcExecResult, WakeMode, VcEnv } from './continuousVoice'
import { detectXr } from './xrSupport'
import { aimArc } from './teleport'
import { nearestSeat, standSpot, SEATED_EYE_M, SIT_REACH_FT } from './seats'
import type { SitSpot } from './seats'
import type { ArcResult } from './teleport'
import type { XrStatus, NavLike } from './xrSupport'

export type Mode = 'desktop' | 'vr'
export type Lighting = 'day' | 'evening'
export interface EngineOptions {
  /** navigator-like object (tests pass a fake with a mocked `xr`) */
  nav?: NavLike
  /** secure-context flag override (tests) */
  secure?: boolean
  poolSize?: number
  /** pixel ratio cap for the desktop canvas */
  maxPixelRatio?: number
  /** skip the sky/PMREM (unit tests on software GL) */
  plainBackground?: boolean
  /** 'day' (default) or 'evening' */
  lighting?: Lighting
  /** the customisation document: where it is kept in this browser, and a design saved with the project */
  custom?: { storage: StorageLike | null; key: string; saved?: unknown }
  /** hands-free voice: the wake-phrase mode, and (tests) an injected browser environment for the recognizer */
  voice?: { wake?: WakeMode; env?: VcEnv }
}
export interface HitInfo { kind: 'panel' | 'cpanel' | 'seat' | 'fanBtn' | TargetData['kind']; id: string }

const EYE_M = 1.62
const WALK_MPS = 1.5
const SNAP_RAD = THREE.MathUtils.degToRad(30)
const PANEL_W_M = 1.1
const ARC_POINTS = 90
const FADE_OUT = 0.12, FADE_IN = 0.2                  // comfort blink around a teleport (s)

type XrSessionLike = { end(): Promise<void>; addEventListener(t: string, f: () => void): void; inputSources: ArrayLike<XrInputSourceLike> }
interface XrInputSourceLike { handedness: string; gamepad?: { axes: ReadonlyArray<number>; buttons: ReadonlyArray<{ pressed: boolean }>; hapticActuators?: Array<{ pulse?: (v: number, ms: number) => void }> } | null }

export class VrEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly rig = new THREE.Group()
  readonly home = new THREE.Group()
  readonly smart: SmartScene
  readonly state: SmartHouseState
  readonly panel: PanelModel
  readonly voice: VoiceInput
  /** hands-free (continuous) listening: starts when VR starts, stops when VR ends */
  readonly handsFree: ContinuousVoice
  private hud!: THREE.Mesh
  private hudCtx!: CanvasRenderingContext2D
  private hudTex!: THREE.CanvasTexture
  private hudSig = ''
  /** the text the status pill shows right now ('' = hidden); tests read it */
  hudText = ''
  readonly locator: RoomLocator
  private hemi = new THREE.HemisphereLight(0xffffff, 0x8a8372, 1.0)
  private envs: Partial<Record<Lighting, THREE.Texture>> = {}
  lighting: Lighting = 'day'

  mode: Mode = 'desktop'
  foot: Foot
  yaw = 0
  pitch = 0
  panelOpen = false
  currentRoom: string | null = null
  xrStatus: XrStatus = { state: 'no-webxr', message: 'not checked yet' }
  /** the last thing said to the person (toast text) */
  message = ''
  showExit = false
  onChange: (() => void) | null = null
  onMode: ((m: Mode) => void) | null = null
  onMessage: ((m: string) => void) | null = null

  /** exposed for the tests only */
  panelMesh: THREE.Mesh
  private panelCtx: CanvasRenderingContext2D
  private panelTex: THREE.CanvasTexture
  private panelSig = ''
  private panelLayout: PanelLayout
  private panelHover: string | null = null
  /** the second floating panel (customisation); independent of the Smart House panel */
  customOpen = false
  customMesh: THREE.Mesh
  readonly custom: CustomController
  private customCtx: CanvasRenderingContext2D
  private customTex: THREE.CanvasTexture
  private customSig = ''
  private customLayout: PanelLayout
  private customHover: string | null = null
  private lastPanelDraw = 0
  private session: XrSessionLike | null = null
  private eyeOffset = 0
  private raycaster = new THREE.Raycaster()
  private controllers: Array<{ ctrl: THREE.Group; line: THREE.Line; hand: string }> = []
  private keys = new Set<string>()
  private prevButtons = new Map<string, boolean[]>()
  private snapReady = true
  private lastTime = 0
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()
  private disposed = false
  private ro: ResizeObserver | null = null
  private nav: NavLike | undefined
  private secure: boolean | undefined
  private notifyTimer = 0
  private cleanup: Array<() => void> = []
  private voiceSupport: VoiceSupport
  // teleport
  private aim: { hand: string; result: ArcResult | null } | null = null
  private arcLine: THREE.Line
  private arcGeo: THREE.BufferGeometry
  private marker: THREE.Group
  private markerMat: THREE.MeshBasicMaterial
  private fadeMesh: THREE.Mesh
  private fade: { t: number; target: Foot | null } | null = null
  private levels: number[]
  // sitting
  /** set while the person is sitting: the seat, and where they stand up to */
  seated: { spot: SitSpot; stand: Foot } | null = null
  private sitLift = 0                                    // metres: how far the view is lowered while seated
  private seatPads: THREE.Mesh[] = []
  private seatHover: string | null = null

  constructor(readonly container: HTMLElement, readonly house: LoadedHouse, readonly opts: EngineOptions = {}) {
    this.nav = opts.nav
    this.secure = opts.secure
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = false             // no shadow maps: they are too expensive for a Quest 2
    this.renderer.xr.enabled = true
    this.renderer.xr.setReferenceSpaceType('local-floor')
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.touchAction = 'none'
    this.renderer.domElement.style.display = 'block'

    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight)
    this.camera = new THREE.PerspectiveCamera(70, w / h, 0.05, 400)
    this.renderer.setSize(w, h)
    this.rig.add(this.camera)
    this.scene.add(this.rig)

    // lighting: DAYLIGHT by default (bright, neutral, no dark corners); EVENING is a dimmer dusk where a switched-on room is clearly different from an off one
    this.scene.add(this.hemi)
    this.setLighting(opts.lighting ?? 'day')

    this.home.scale.setScalar(FT)
    this.home.add(house.root)
    this.scene.add(this.home)

    this.state = SmartHouseState.fromDocument(house.smart)
    this.panel = new PanelModel(this.state)
    this.smart = new SmartScene(house.smart, this.state, opts.poolSize ?? 4)
    this.home.add(this.smart.group)
    this.locator = new RoomLocator(house.smart.rooms)
    this.voiceSupport = detectVoice()
    this.voice = new VoiceInput({
      onState: (s, d) => { this.panel.voice.onBackendState(s, d); this.changed() },
      onPartial: (t) => { this.panel.voice.onPartial(t); this.changed() },
      onFinal: (t) => this.handleCommand(t),
    })
    this.panel.voice.setBackend(this.voiceSupport.available)
    if (!this.voiceSupport.available) this.panel.voice.onBackendState('unavailable', this.voiceSupport.reason)
    this.panel.voice.handsFree = this.voiceSupport.available ? 'off' : 'unsupported'
    this.handsFree = new ContinuousVoice({ execute: (t) => this.handleCommand(t), onStatus: (s) => this.onHandsFreeStatus(s), wake: opts.voice?.wake, env: opts.voice?.env })
    this.buildHud()

    // panel canvas in the world (VR only)
    const pc = document.createElement('canvas'); pc.width = PANEL_W; pc.height = PANEL_H
    this.panelCtx = pc.getContext('2d')!
    this.panelTex = new THREE.CanvasTexture(pc)
    this.panelTex.colorSpace = THREE.SRGBColorSpace
    this.panelTex.anisotropy = 4
    this.panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W_M, (PANEL_W_M * PANEL_H) / PANEL_W), new THREE.MeshBasicMaterial({ map: this.panelTex, toneMapped: false, transparent: true, side: THREE.DoubleSide }))
    this.panelMesh.visible = false
    this.panelMesh.name = 'smart-house-panel'
    this.scene.add(this.panelMesh)
    // customisation panel + controller (same canvas size and drawing code as the Smart House panel)
    this.custom = new CustomController(house, opts.custom?.storage ?? null, opts.custom?.key ?? `rea.custom.${house.smart.rooms.length}`, opts.custom?.saved)
    const cc = document.createElement('canvas'); cc.width = PANEL_W; cc.height = PANEL_H
    this.customCtx = cc.getContext('2d')!
    this.customTex = new THREE.CanvasTexture(cc)
    this.customTex.colorSpace = THREE.SRGBColorSpace
    this.customTex.anisotropy = 4
    this.customMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W_M, (PANEL_W_M * PANEL_H) / PANEL_W), new THREE.MeshBasicMaterial({ map: this.customTex, toneMapped: false, transparent: true, side: THREE.DoubleSide }))
    this.customMesh.visible = false
    this.customMesh.name = 'customization-panel'
    this.scene.add(this.customMesh)
    this.customLayout = this.custom.layout()
    this.custom.onClose = () => this.setCustomOpen(false)
    this.custom.lighting = { get: () => this.lighting, set: (l) => this.setLighting(l) }
    this.custom.onChange = () => { this.customLayout = this.custom.layout(); if (this.mode === 'vr' && this.customOpen) this.redrawCustom(true); this.changed() }
    this.panelLayout = this.computeLayout()

    // teleport visuals: arc, landing marker, and the comfort blink
    this.levels = [0, ...house.smart.floors.map((f) => f.floor_y)]
    this.arcGeo = new THREE.BufferGeometry()
    this.arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3))
    this.arcLine = new THREE.Line(this.arcGeo, new THREE.LineBasicMaterial({ color: 0x66ddaa, depthTest: false, transparent: true, opacity: 0.95 }))
    this.arcLine.frustumCulled = false; this.arcLine.renderOrder = 998; this.arcLine.visible = false; this.arcLine.name = 'teleport-arc'
    this.scene.add(this.arcLine)
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0x66ddaa, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    this.marker = new THREE.Group(); this.marker.name = 'teleport-marker'
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 32), this.markerMat); ring.rotation.x = -Math.PI / 2
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), this.markerMat); dot.rotation.x = -Math.PI / 2
    this.marker.add(ring, dot); this.marker.visible = false; this.marker.renderOrder = 998; ring.renderOrder = 998; dot.renderOrder = 998
    this.scene.add(this.marker)
    this.fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }))
    this.fadeMesh.position.z = -0.25; this.fadeMesh.renderOrder = 1000; this.fadeMesh.visible = false; this.fadeMesh.name = 'teleport-fade'
    this.camera.add(this.fadeMesh)
    // "sit here" pads: a small disc on each seat, shown when the person is near and standing; point at one and press the trigger / click to sit
    const padGeo = new THREE.CircleGeometry(0.2, 20); padGeo.rotateX(-Math.PI / 2)
    for (const sp of house.seats) {
      const pad = new THREE.Mesh(padGeo, new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }))
      pad.position.set(sp.x * FT, sp.seatY * FT + 0.03, sp.z * FT)
      pad.userData = { kind: 'seat', key: sp.id }
      pad.visible = false; pad.name = `seat-pad-${sp.id}`
      this.scene.add(pad); this.seatPads.push(pad)
    }

    this.foot = { ...house.spawn }
    this.faceInto()
    this.snapRig(true)
    this.setupControllers()
    this.setupDesktopInput()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    void detectXr(this.nav, this.secure).then((s) => { this.xrStatus = s; this.changed() })
    this.renderer.setAnimationLoop((t, f) => this.frame(t, f))
  }

  // ------------------------------------------------------------------ layout / state helpers
  private floors(): number { return this.house.smart.floors.length }
  /** the fan the panel's fan strip, the F key and the number keys act on: the room the person is in, else the fan last pointed at, else the nearest */
  focusFanKey(): string | null {
    if (this.currentRoom && this.state.fan(this.currentRoom)) return this.currentRoom
    if (this.smart.lastFanKey && this.state.fan(this.smart.lastFanKey)) return this.smart.lastFanKey
    return this.foot && this.state.fanKeys.length ? this.smart.nearestFan(this.tmpFeet.set(this.foot.x, this.foot.y, this.foot.z)) : null
  }
  private readonly tmpFeet = new THREE.Vector3()
  private fanRoomName(key: string): string { return this.house.smart.rooms.find((r) => roomKey(r) === key)?.name ?? key }
  /** a click / trigger on a fan: switch it ON (last speed) or OFF and open its speed control */
  private fanClick(key: string): boolean {
    this.state.fanToggle(key, 'switch')
    this.smart.showFanPopup(key, 'full'); this.smart.touchFanPopup()
    const lv = this.state.fanLevel(key)
    this.say(`${this.fanRoomName(key)} fan: ${lv === 0 ? 'OFF' : `ON, speed ${lv}`}`)
    return true
  }
  /** keyboard: F = fan ON/OFF, 1 2 3 4 5 = speed of the focus fan */
  fanKey(code: string): boolean {
    const key = this.focusFanKey()
    if (!key) { this.say('No ceiling fan here.'); return false }
    if (code === 'KeyF') return this.fanClick(key)
    const m = /^(?:Digit|Numpad)([0-5])$/.exec(code)
    if (!m) return false
    const lv = Number(m[1])
    if (![0, ...FAN_SPEEDS].includes(lv)) return false
    this.state.setFanLevel(key, lv, 'switch'); this.smart.showFanPopup(key, 'full'); this.smart.touchFanPopup()
    this.say(`${this.fanRoomName(key)} fan: ${lv === 0 ? 'OFF' : `speed ${lv}`}`)
    return true
  }
  private computeLayout(): PanelLayout { this.panel.focusKey = this.focusFanKey(); return layoutPanel(this.panel, this.state, { floors: this.floors(), showExit: this.mode === 'vr', seat: this.house.seats.length ? (this.seated ? 'stand' : 'sit') : undefined }) }
  get layout(): PanelLayout { return this.panelLayout }
  get xrSupported(): boolean { return this.xrStatus.state === 'supported' }
  get voiceAvailable(): boolean { return this.voiceSupport.available }
  get voiceReason(): string { return this.voiceSupport.reason }
  private changed(): void { this.onChange?.() }
  private say(msg: string): void { this.message = msg; this.onMessage?.(msg); this.changed() }
  get roomName(): string { return this.state.lights.get(this.currentRoom)?.name ?? (this.currentRoom ? this.currentRoom : 'Outside / between rooms') }
  get floorIndex(): number { let best = 0; for (const f of this.house.smart.floors) if (this.foot.y >= f.floor_y - 1) best = f.level; return best }

  /** turns the person towards the middle of the house when they start */
  private faceInto(): void {
    const fp = this.house.smart.footprint
    const dx = (fp.x0 + fp.x1) / 2 - this.foot.x, dz = (fp.z0 + fp.z1) / 2 - this.foot.z
    this.yaw = Math.hypot(dx, dz) > 2 ? Math.atan2(-dx, -dz) : 0
  }

  private snapRig(immediate: boolean): void {
    const tx = this.foot.x * FT, tz = this.foot.z * FT, ty = this.foot.y * FT + this.eyeOffset + this.sitLift
    if (this.mode === 'desktop') {
      this.rig.position.set(tx, immediate ? ty : this.rig.position.y, tz)
      this.rig.rotation.set(0, this.yaw, 0)
      this.camera.position.set(0, EYE_M, 0)
      this.camera.rotation.set(this.pitch, 0, 0)
    } else if (immediate) {
      this.rig.rotation.y = this.yaw
      this.rig.updateMatrixWorld(true)
      const head = this.camera.getWorldPosition(this.tmp)
      this.rig.position.x += tx - head.x; this.rig.position.z += tz - head.z; this.rig.position.y = ty
    }
  }

  // ------------------------------------------------------------------ movement
  /** moves the body by (dx, dz) metres through the collision grid; returns true when it moved */
  walk(dxM: number, dzM: number): boolean {
    if (this.seated) this.standUp()
    const r = this.house.nav.move(this.foot, dxM / FT, dzM / FT)
    const moved = r.x !== this.foot.x || r.z !== this.foot.z
    if (this.mode === 'vr') { this.rig.position.x += (r.x - this.foot.x) * FT; this.rig.position.z += (r.z - this.foot.z) * FT }
    this.foot = r
    return moved
  }

  teleportTo(f: Foot): void {
    if (this.seated) { this.seated = null; this.sitLift = 0 }
    this.place(f)
  }
  /** puts the body at f (the view height includes the seated lowering, if any) */
  private place(f: Foot): void {
    this.foot = { ...f }
    if (this.mode === 'vr') {
      const head = this.camera.getWorldPosition(this.tmp)
      this.rig.position.x += f.x * FT - head.x; this.rig.position.z += f.z * FT - head.z
      this.rig.position.y = f.y * FT + this.eyeOffset + this.sitLift
    } else this.snapRig(true)
    this.changed()
  }

  /**
   * The height the occupancy sensor looks at (feet + 3 ft).  On a stair flight that carries on above the top ceiling (the stair up to the terrace) that point
   * is above every room, so the person would count as nowhere and the staircase light would switch off mid-climb: there the sensor reads the staircase the
   * flight belongs to.
   */
  private occupantY(): number {
    const f = this.foot
    const y = f.y + 3
    if (this.house.nav.patchCount === 0 || this.locator.locate(f.x, y, f.z)) return y
    if (this.house.nav.patchGround(f.x, f.z, f.y) === null) return y
    let best: { floor_y: number } | null = null
    for (const r of this.house.smart.rooms) {
      if (!/stair/.test(r.type) || f.x < r.rect.x0 || f.x > r.rect.x1 || f.z < r.rect.z0 || f.z > r.rect.z1 || r.floor_y > f.y + 0.5) continue
      if (!best || r.floor_y > best.floor_y) best = r
    }
    return best ? best.floor_y + 3 : y
  }

  // ------------------------------------------------------------------ sitting
  get seatCount(): number { return this.house.seats.length }
  /** sits on the given seat (a pad that was clicked / pointed at) or, without an id, on the nearest one in front of the person; sitting again re-sets the view height */
  sit(id?: string): boolean {
    const spots = this.house.seats
    if (!spots.length) { this.say('There is nothing to sit on in this house.'); return false }
    if (this.seated && !id) { this.calibrateSeat(); this.say('Seat height re-set to where you are sitting now.'); return true }
    const look = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }
    const spot = id ? spots.find((q) => q.id === id) : nearestSeat(spots, this.foot, look)
    if (!spot) { this.say('No seat within reach - walk closer to a sofa, chair or bed.'); return false }
    if (Math.abs(spot.floorY - this.foot.y) > 3 || Math.hypot(spot.x - this.foot.x, spot.z - this.foot.z) > SIT_REACH_FT) { this.say('That seat is too far away - walk closer.'); return false }
    const prev = this.seated ? this.seated.stand : { ...this.foot }
    const stand = standSpot(this.house.nav, spot, prev)
    if (!stand) { this.say('There is no room to stand up again from that seat.'); return false }
    this.cancelAim()
    const want = Math.atan2(-spot.fx, -spot.fz)             // face the way the seat faces
    if (this.mode === 'vr') { let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.snapTurn(d) } else this.yaw = want
    const gy = this.house.nav.groundAt(spot.x, spot.z, spot.floorY + 0.1) ?? spot.floorY
    this.seated = { spot, stand }
    this.sitLift = 0
    this.place({ x: spot.x, y: gy, z: spot.z })
    this.calibrateSeat()
    const what = spot.kind === 'sofa' ? 'the sofa' : spot.kind === 'bed' ? 'the bed' : spot.kind === 'bench' ? 'the bench' : spot.kind === 'stool' ? 'the stool' : 'the chair'
    this.say(`Sitting on ${what}. Move the stick, press E or use STAND UP to stand.`)
    return true
  }
  /** the view height while seated: eyes about 75 cm above the seat, taken from the headset's own height at this moment (stand up straight, or sit physically, then press Sit again) */
  private calibrateSeat(): void {
    const s = this.seated
    if (!s) return
    const head = this.eyeOffset + this.camera.position.y
    this.sitLift = s.spot.seatY * FT + SEATED_EYE_M - (this.foot.y * FT + head)
    this.rig.position.y = this.foot.y * FT + this.eyeOffset + this.sitLift
    this.rig.updateMatrixWorld(true)
    this.panelLayout = this.computeLayout()
  }
  standUp(): boolean {
    const s = this.seated
    if (!s) return false
    this.seated = null; this.sitLift = 0
    this.place(s.stand)
    this.say('Standing up.')
    return true
  }
  toggleSit(): boolean { return this.seated ? this.standUp() : this.sit() }
  private updatePads(): void {
    for (const pad of this.seatPads) {
      const sp = this.house.seats.find((q) => q.id === pad.userData.key)
      if (!sp) { pad.visible = false; continue }
      pad.visible = !this.seated && Math.abs(sp.floorY - this.foot.y) < 3 && Math.hypot(sp.x - this.foot.x, sp.z - this.foot.z) <= SIT_REACH_FT + 3
      const m = pad.material as THREE.MeshBasicMaterial
      m.color.setHex(this.seatHover === sp.id ? 0xffe9a8 : 0x66aaff); m.opacity = this.seatHover === sp.id ? 0.9 : 0.55
    }
  }
  goToFloor(floor: number): boolean {
    const s = floorSpot(this.house.smart, this.house.nav, floor)
    if (!s) { this.say(`No standing spot found on floor ${floor}.`); return false }
    this.teleportTo(s); this.say(floor === 0 ? 'Ground floor' : `Floor ${floor}`); return true
  }
  goToRoom(key: string): boolean {
    const r = this.house.smart.rooms.find((q) => `${q.floor}:${q.id}` === key)
    if (!r) return false
    const cx = (r.rect.x0 + r.rect.x1) / 2, cz = (r.rect.z0 + r.rect.z1) / 2
    const s = this.house.nav.nearestOpen(cx, cz, r.floor_y + 0.2, 6, 30) ?? this.house.nav.nearestStandable(cx, cz, r.floor_y + 0.2, 6)
    if (!s) { this.say(`There is no free floor to stand on in ${r.name}.`); return false }
    this.teleportTo(s); this.say(`In ${r.name}`); return true
  }

  // ------------------------------------------------------------------ frame
  /** logic only (no rendering): used by the loop and by tests */
  tick(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.1)
    if (this.mode === 'vr') this.vrInput(dt)
    else this.desktopMove(dt)
    this.updateAim()
    this.updateFade(dt)
    this.updatePads()
    this.syncRig(dt)
    const feet = this.foot
    const occ = this.occupantY()
    this.currentRoom = this.locator.locate(feet.x, occ, feet.z)
    this.state.currentRoomKey = this.currentRoom
    this.state.tick(dt)
    this.panel.voice.tick(dt)
    this.smart.update(dt, this.tmp2.set(feet.x, occ, feet.z))
    this.panelLayout = this.computeLayout()
    if (this.mode === 'vr' && this.panelOpen) this.redrawPanel(false)
    this.notifyTimer -= dt
    if (this.notifyTimer <= 0) { this.notifyTimer = 0.2; this.changed() }
  }

  private frame(time: number, _xr?: unknown): void {
    if (this.disposed) return
    const dt = this.lastTime ? (time - this.lastTime) / 1000 : 0.016
    this.lastTime = time
    this.tick(dt)
    this.renderer.render(this.scene, this.camera)
  }

  private syncRig(dt: number): void {
    const ty = this.foot.y * FT + this.eyeOffset + this.sitLift
    const k = Math.min(1, dt * 10)
    if (this.mode === 'desktop') {
      this.rig.position.x = this.foot.x * FT; this.rig.position.z = this.foot.z * FT
      this.rig.position.y += (ty - this.rig.position.y) * k
      this.rig.rotation.y = this.yaw
      this.camera.rotation.x = this.pitch
    } else {
      this.rig.position.y += (ty - this.rig.position.y) * k
      if (this.seated) return                              // sitting: the body stays on the seat
      // physical walking in the play space: follow the head through the collision grid, push the body back at walls
      const head = this.camera.getWorldPosition(this.tmp)
      const hx = head.x / FT, hz = head.z / FT
      const ddx = hx - this.foot.x, ddz = hz - this.foot.z
      if (Math.hypot(ddx, ddz) > 0.03) {
        const r = this.house.nav.move(this.foot, ddx, ddz)
        this.rig.position.x += (r.x - hx) * FT; this.rig.position.z += (r.z - hz) * FT
        this.foot = r
      }
    }
  }

  // ------------------------------------------------------------------ teleport
  /** state for the UI and the tests */
  get teleportInfo(): { aiming: boolean; valid: boolean; reason: string; target: Foot | null; fading: boolean } {
    const r = this.aim?.result
    return { aiming: !!this.aim, valid: !!r?.valid, reason: r?.reason ?? '', target: r?.target ?? null, fading: !!this.fade }
  }

  /** where the aiming ray starts and points: the controller in VR, the eye along the view direction on the desktop */
  private aimRay(hand: string): { o: [number, number, number]; d: [number, number, number] } | null {
    if (hand === 'desktop' || this.mode !== 'vr') {
      // from the eye along the view direction, straight from the foot position / yaw / pitch (no dependence on when the camera matrices were last updated)
      const cp = Math.cos(this.pitch)
      return { o: [this.foot.x * FT, this.foot.y * FT + EYE_M + this.sitLift, this.foot.z * FT], d: [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp] }
    }
    const c = this.controllers.find((q) => q.hand === hand) ?? this.controllers[1] ?? this.controllers[0]
    if (!c) return null
    c.ctrl.updateMatrixWorld(true)
    const o = new THREE.Vector3().setFromMatrixPosition(c.ctrl.matrixWorld)
    const d = new THREE.Vector3(0, 0, -1).transformDirection(c.ctrl.matrixWorld)
    return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] }
  }

  /** start pointing the teleport arc (VR: right thumbstick forward; desktop: hold T) */
  startAim(hand: string): void {
    if (this.fade) return
    this.aim = { hand, result: null }
    this.updateAim()
  }
  cancelAim(): void {
    this.aim = null
    this.arcLine.visible = false; this.marker.visible = false
  }
  /** releases the aim: teleports when the spot is valid; returns whether a teleport started */
  releaseAim(): boolean {
    const a = this.aim
    if (!a) return false
    this.updateAim()
    const r = a.result
    this.cancelAim()
    if (r?.valid && r.target) {
      this.fade = { t: 0, target: { ...r.target } }
      this.fadeMesh.visible = true
      this.pulse(a.hand, 0.5)
      return true
    }
    if (r) this.say(r.reason === 'ceiling' || r.reason === 'wall' ? 'Something is in the way - aim at open floor.' : 'You cannot stand there - aim at open floor.')
    return false
  }
  private updateAim(): void {
    const a = this.aim
    if (!a) return
    const ray = this.aimRay(a.hand)
    if (!ray) return
    const r = aimArc(this.house.nav, ray.o, ray.d, { levels: this.levels })
    a.result = r
    const pos = this.arcGeo.getAttribute('position') as THREE.BufferAttribute
    const n = Math.min(r.points.length, ARC_POINTS)
    const step = r.points.length / n
    for (let i = 0; i < n; i++) { const p = r.points[Math.min(r.points.length - 1, Math.floor(i * step))]; pos.setXYZ(i, p[0], p[1], p[2]) }
    const last = r.points[r.points.length - 1]
    for (let i = n; i < ARC_POINTS; i++) pos.setXYZ(i, last[0], last[1], last[2])
    pos.needsUpdate = true
    this.arcGeo.setDrawRange(0, ARC_POINTS)
    const col = r.valid ? 0x66ddaa : 0xff6b5b
    ;(this.arcLine.material as THREE.LineBasicMaterial).color.setHex(col)
    this.markerMat.color.setHex(col)
    this.arcLine.visible = true
    this.marker.visible = true
    if (r.valid && r.target) this.marker.position.set(r.target.x * FT, r.target.y * FT + 0.02, r.target.z * FT)
    else this.marker.position.set(last[0], last[1] + 0.02, last[2])
  }
  /** the blink: dim, move, undim (the person never glides, so no motion sickness from the move itself) */
  private updateFade(dt: number): void {
    const f = this.fade
    if (!f) return
    f.t += dt
    const m = this.fadeMesh.material as THREE.MeshBasicMaterial
    if (f.t < FADE_OUT) m.opacity = f.t / FADE_OUT
    else {
      if (f.target) { this.teleportTo(f.target); this.say(this.floorIndex === 0 ? 'Teleported (ground floor)' : `Teleported (floor ${this.floorIndex})`); f.target = null }
      m.opacity = Math.max(0, 1 - (f.t - FADE_OUT) / FADE_IN)
      if (f.t >= FADE_OUT + FADE_IN) { this.fade = null; this.fadeMesh.visible = false; m.opacity = 0 }
    }
  }

  // ------------------------------------------------------------------ desktop input
  private desktopMove(dt: number): void {
    const k = this.keys
    let f = 0, s = 0
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1
    if (k.has('KeyD')) s += 1
    if (k.has('KeyA')) s -= 1
    if (k.has('ArrowLeft')) this.yaw += 1.6 * dt
    if (k.has('ArrowRight')) this.yaw -= 1.6 * dt
    if (!f && !s) return
    const sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? 2.6 : 1.4) * dt
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw)
    const rx = -fz, rz = fx
    const l = Math.hypot(f, s)
    this.walk(((fx * f + rx * s) / l) * sp, ((fz * f + rz * s) / l) * sp)
  }

  private setupDesktopInput(): void {
    const el = this.renderer.domElement
    let down: { x: number; y: number; moved: boolean } | null = null
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, moved: false }; try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ } }
    const onMove = (e: PointerEvent) => {
      if (this.mode !== 'desktop') return
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y
        if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true
        if (down.moved) {
          this.yaw -= (e.movementX || dx - 0) * 0.004
          this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - (e.movementY || 0) * 0.004))
        }
        down.x = down.moved ? e.clientX : down.x; down.y = down.moved ? e.clientY : down.y
      } else {
        const hit = this.pickFromPointer(e)
        this.seatHover = hit?.kind === 'seat' ? hit.id : null
        this.smart.setHover(hit && hit.kind !== 'panel' && hit.kind !== 'seat' && hit.kind !== 'fanBtn' ? { kind: hit.kind as TargetData['kind'], key: hit.id } : null)
        this.smart.setPopupHover(hit?.kind === 'fanBtn' ? hit.id : null)
        el.style.cursor = hit ? 'pointer' : 'grab'
      }
    }
    const onUp = (e: PointerEvent) => {
      const wasClick = down && !down.moved
      down = null
      if (wasClick && this.mode === 'desktop') this.activate(this.pickFromPointer(e))
    }
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      this.keys.add(e.code)
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
      if (this.mode === 'desktop' && !e.repeat) {
        if (e.code === 'KeyT') this.startAim('desktop')
        if (e.code === 'KeyE') this.toggleSit()
        if (e.code === 'KeyF' || /^(Digit|Numpad)[0-5]$/.test(e.code)) { if (!e.ctrlKey && !e.metaKey && !e.altKey) this.fanKey(e.code) }
        if (e.code === 'Escape') this.cancelAim()
      }
    }
    const ku = (e: KeyboardEvent) => { this.keys.delete(e.code); if (e.code === 'KeyT' && this.aim?.hand === 'desktop') this.releaseAim() }
    const blur = () => { this.keys.clear(); if (this.aim?.hand === 'desktop') this.cancelAim() }
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur)
    this.cleanup.push(() => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur) })
  }

  private pickFromPointer(e: PointerEvent): HitInfo | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.camera.updateMatrixWorld(true)
    this.raycaster.setFromCamera(ndc, this.camera)
    return this.pick(this.raycaster)
  }

  // ------------------------------------------------------------------ picking / activation (shared by mouse, controllers and the simulated-controller tests)
  /** nearest hit among the clickable wall plates and (in VR, when open) the panel; the ray is limited to arm's length for plates */
  pick(rc: THREE.Raycaster): HitInfo | null {
    rc.far = 6
    let best: { d: number; info: HitInfo; uv?: THREE.Vector2 } | null = null
    this.home.updateMatrixWorld(true)
    for (const h of rc.intersectObjects(this.smart.proxies, false)) {
      const d = h.object.userData as TargetData
      best = { d: h.distance, info: { kind: d.kind, id: d.key } }
      break
    }
    // the fan control that opened next to a fan (OFF | 1 | 2 | 3 | 5)
    const pp = this.smart.pickPopup(rc)
    if (pp && (!best || pp.distance < best.d)) best = { d: pp.distance, info: { kind: 'fanBtn', id: pp.id } }
    // the open panel is a UI floating in front of the person: it wins over the sit discs behind or beneath it (a disc between the controller and EXIT VR must not sit you down)
    if (this.mode === 'vr' && this.panelOpen) {
      this.panelMesh.updateMatrixWorld(true)
      const ph = rc.intersectObject(this.panelMesh, false)[0]
      if (ph && ph.uv && (!best || ph.distance < best.d)) {
        const btn = hitPanel(this.panelLayout, ph.uv.x * PANEL_W, (1 - ph.uv.y) * PANEL_H)
        best = { d: ph.distance, info: { kind: 'panel', id: btn?.id ?? '' }, uv: ph.uv }
      }
    }
    if (this.mode === 'vr' && this.customOpen) {
      this.customMesh.updateMatrixWorld(true)
      const ph = rc.intersectObject(this.customMesh, false)[0]
      if (ph && ph.uv && (!best || ph.distance < best.d)) {
        const btn = hitPanel(this.customLayout, ph.uv.x * PANEL_W, (1 - ph.uv.y) * PANEL_H)
        best = { d: ph.distance, info: { kind: 'cpanel', id: btn?.id ?? '' }, uv: ph.uv }
      }
    }
    if (!best || (best.info.kind !== 'panel' && best.info.kind !== 'cpanel')) {
      const pads = this.seatPads.filter((p) => p.visible)
      if (pads.length) {
        for (const p of pads) p.updateMatrixWorld(true)
        const ph = rc.intersectObjects(pads, false)[0]
        if (ph && (!best || ph.distance < best.d)) best = { d: ph.distance, info: { kind: 'seat', id: (ph.object.userData as { key: string }).key } }
      }
    }
    if (best) this.lastPanelUv = best.uv ?? null
    return best ? best.info : null
  }
  private lastPanelUv: THREE.Vector2 | null = null

  /** performs what clicking the thing under the ray does; returns whether something was activated */
  activate(hit: HitInfo | null): boolean {
    if (!hit) return false
    if (hit.kind === 'switch') { this.state.lights.toggle(hit.id, 'switch'); return true }
    if (hit.kind === 'regPlus' || hit.kind === 'regMinus') { this.state.setFanLevel(hit.id, this.state.fanLevel(hit.id) + (hit.kind === 'regPlus' ? 1 : -1), 'switch'); return true }
    if (hit.kind === 'fan') return this.fanClick(hit.id)
    if (hit.kind === 'fanBtn') {
      const key = this.smart.fanPopup.key
      const level = Number(hit.id.replace('pop:', ''))
      if (!key || !hit.id.startsWith('pop:') || !Number.isFinite(level)) return false
      this.state.setFanLevel(key, level, 'switch'); this.smart.touchFanPopup()
      this.say(`${this.fanRoomName(key)} fan: ${level === 0 ? 'OFF' : `speed ${level}`}`)
      return true
    }
    if (hit.kind === 'seat') return this.sit(hit.id)
    if (hit.kind === 'cpanel') return this.custom.press(hit.id)
    if (hit.kind === 'panel') {
      const b = this.panelLayout.buttons.find((x) => x.id === hit.id)
      if (!b?.action) return false
      this.runAction(b.action)
      return true
    }
    return false
  }

  /** a panel button's action (also used by the HTML panel on desktop) */
  runAction(a: PanelAction): void {
    const rest = runPanelAction(a, this.panel)
    if (rest) {
      switch (rest.t) {
        case 'close': this.setPanelOpen(false); break
        case 'exit': void this.exitVR(); break
        case 'floor': this.goToFloor(rest.floor); break
        case 'goto': this.goToRoom(rest.key); break
        case 'sit': this.sit(); break
        case 'stand': this.standUp(); break
        case 'custom': this.setCustomOpen(!this.customOpen); break
        case 'mic': void this.toggleMic(); break
      }
    }
    this.panelLayout = this.computeLayout()
    this.changed()
  }

  // ------------------------------------------------------------------ the in-world panel
  setPanelOpen(open: boolean): void {
    this.panelOpen = open
    if (this.mode === 'vr') {
      this.panelMesh.visible = open
      if (open) this.placePanel()
    }
    this.changed()
  }
  togglePanel(): void { this.setPanelOpen(!this.panelOpen) }

  /** daylight (bright, neutral) or evening (dusk sky, dim ambient so switched-on lights stand out); the house itself is not touched */
  setLighting(l: Lighting): void {
    this.lighting = l
    if (this.opts.plainBackground) {
      this.scene.background = new THREE.Color(l === 'day' ? 0x8fb4d8 : 0x20242e)
    } else {
      if (!this.envs[l]) this.envs[l] = l === 'day' ? makeStudioEnv(this.renderer) : makeSkyEnv(this.renderer, 'dusk')
      this.skyBg ||= {}
      this.skyBg[l] ||= makeSkyEnv(this.renderer, l === 'day' ? 'day' : 'dusk')
      this.scene.background = this.skyBg[l]!
      this.scene.environment = this.envs[l]!
    }
    if (l === 'day') { this.scene.environmentIntensity = 0.9; this.hemi.color.set(0xffffff); this.hemi.groundColor.set(0x8a8372); this.hemi.intensity = 1.0 }
    else { this.scene.environmentIntensity = 0.5; this.hemi.color.set(0xaab8d8); this.hemi.groundColor.set(0x30281f); this.hemi.intensity = 0.55 }
    this.changed()
  }
  private skyBg: Partial<Record<Lighting, THREE.Texture>> | undefined

  setCustomOpen(open: boolean): void {
    this.customOpen = open
    if (this.mode === 'vr') {
      this.customMesh.visible = open
      if (open) this.placePanel()
    }
    this.customLayout = this.custom.layout()
    this.panelLayout = this.computeLayout()
    this.changed()
  }
  toggleCustom(): void { this.setCustomOpen(!this.customOpen) }

  /** puts the panel 1 m in front of the head, a little below eye level, facing the person */
  placePanel(): void {
    this.camera.updateMatrixWorld(true)
    const head = this.camera.getWorldPosition(this.tmp)
    const dir = this.camera.getWorldDirection(this.tmp2); dir.y = 0
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1)
    dir.normalize()
    // side by side when both are open (the Smart House panel on the left, customisation on the right), each turned toward the head
    const side = this.panelOpen && this.customOpen ? 0.6 : 0
    const lx = -dir.z, lz = dir.x                       // to the person's right
    const put = (mesh: THREE.Mesh, k: number) => {
      mesh.position.set(head.x + dir.x * 1.0 + lx * side * k, head.y - 0.18, head.z + dir.z * 1.0 + lz * side * k)
      mesh.rotation.set(0, Math.atan2(head.x - mesh.position.x, head.z - mesh.position.z), 0)
    }
    put(this.panelMesh, -1); put(this.customMesh, 1)
    this.redrawPanel(true); this.redrawCustom(true)
  }

  private redrawPanel(force: boolean): void {
    const sig = layoutSignature(this.panelLayout, this.panelHover)
    const now = performance.now()
    if (!force && (sig === this.panelSig || now - this.lastPanelDraw < 180)) return
    this.panelSig = sig; this.lastPanelDraw = now
    drawPanel(this.panelCtx, this.panelLayout, this.panelHover)
    this.panelTex.needsUpdate = true
  }

  private redrawCustom(force: boolean): void {
    const sig = layoutSignature(this.customLayout, this.customHover)
    const now = performance.now()
    if (!force && (sig === this.customSig || now - this.lastCustomDraw < 180)) return
    this.customSig = sig; this.lastCustomDraw = now
    drawPanel(this.customCtx, this.customLayout, this.customHover)
    this.customTex.needsUpdate = true
  }
  private lastCustomDraw = 0
  get customPanelLayout(): PanelLayout { return this.customLayout }

  // ------------------------------------------------------------------ voice
  pushToTalk(): void {
    if (this.handsFree.active) { this.say('Hands-free listening is already on: just speak. (MIC mutes it.)'); return }
    if (this.handsFree.status.phase === 'muted') { void this.toggleMic(); return }
    if (!this.voiceSupport.available) { this.panel.voice.onBackendState('unavailable', this.voiceSupport.reason); this.say(`Voice commands are unavailable: ${this.voiceSupport.reason}`); return }
    this.voice.start()
  }
  /** a sentence (spoken or typed) -> the same state changes the panel makes */
  handleCommand(text: string): VcExecResult {
    const t = text.trim().toLowerCase().replace(/[.!?]+$/, '')
    if (/^(please )?(sit( down)?|take a seat)$/.test(t)) { this.sit(); return { understood: true, changed: true, message: 'Sitting down' } }
    if (/^(please )?(stand( up)?|get up)$/.test(t)) { if (!this.standUp()) this.say('You are already standing.'); return { understood: true, changed: true, message: 'Standing up' } }
    const res = this.state.execute(text)
    this.panel.voice.onCommand(text, res)
    if (res.panel === 'show') this.setPanelOpen(true)
    if (res.panel === 'hide') this.setPanelOpen(false)
    this.say(res.message)
    return { understood: res.understood, changed: res.changed, message: res.message }
  }

  // ------------------------------------------------------------------ hands-free listening
  /** the status of hands-free listening -> the panel's status board, the MIC button and the head-up pill */
  private onHandsFreeStatus(s: VcStatus): void {
    const b = this.panel.voice
    switch (s.phase) {
      case 'starting': b.onBackendState('requestingPermission', s.detail); break
      case 'listening': b.onBackendState('listening'); b.onPartial(s.partial); break
      case 'processing': b.onBackendState('processing'); break
      case 'muted': b.onBackendState('muted'); break
      case 'denied': b.onBackendState('permissionDenied', s.detail); break
      case 'unavailable': case 'stopped': case 'unsupported': b.onBackendState('unavailable', s.detail); break
      case 'off': b.onBackendState('idle'); break
    }
    b.handsFree = s.phase === 'unsupported' ? 'unsupported' : s.phase === 'muted' ? 'muted' : (s.phase === 'listening' || s.phase === 'processing' || s.phase === 'starting') ? 'on' : 'off'
    this.panelLayout = this.computeLayout()
    this.redrawHud()
    this.changed()
  }
  /** VR started (or the person pressed the desktop button): ask for the microphone, then keep listening until stop / mute */
  async startHandsFree(): Promise<void> {
    if (this.voice.listening) this.voice.stop()          // never two recognizers: the push-to-talk one gives way
    await this.handsFree.start()
  }
  /** MIC control (panel button, left thumbstick click, desktop button): mute while listening, else (re)start */
  async toggleMic(): Promise<void> {
    const p = this.handsFree.status.phase
    if (p === 'unsupported') { this.say(`Voice commands are unavailable: ${this.handsFree.unsupportedReason}`); return }
    if (this.handsFree.active) this.handsFree.mute()
    else { if (this.voice.listening) this.voice.stop(); await this.handsFree.resume() }
  }
  setWakeMode(m: WakeMode): void { this.handsFree.setWake(m) }

  private buildHud(): void {
    const c = document.createElement('canvas'); c.width = 512; c.height = 72
    this.hudCtx = c.getContext('2d')!
    this.hudTex = new THREE.CanvasTexture(c); this.hudTex.colorSpace = THREE.SRGBColorSpace
    this.hud = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.30 * 72 / 512), new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, toneMapped: false, depthTest: false, depthWrite: false }))
    this.hud.name = 'voice-status'
    this.hud.renderOrder = 1000
    this.hud.position.set(0, -0.19, -0.62)               // small, low in the view, head-locked
    this.hud.visible = false
    this.camera.add(this.hud)
  }
  private redrawHud(): void {
    const info = this.mode === 'vr' ? hudInfo(this.handsFree.status) : null
    const text = info?.text ?? ''
    this.hudText = text
    this.hud.visible = !!info
    if (!info) { this.hudSig = ''; return }
    const sig = `${info.tone}|${text}`
    if (sig === this.hudSig) return
    this.hudSig = sig
    const g = this.hudCtx, W = 512, H = 72
    g.clearRect(0, 0, W, H)
    g.fillStyle = 'rgba(24,22,20,0.78)'
    g.beginPath(); if (typeof g.roundRect === 'function') g.roundRect(2, 2, W - 4, H - 4, 34); else g.rect(2, 2, W - 4, H - 4); g.fill()
    g.fillStyle = info.tone === 'good' ? '#69c27a' : info.tone === 'busy' ? '#e6b45a' : info.tone === 'bad' ? '#e7897e' : '#9a968a'
    g.beginPath(); g.arc(36, H / 2, 12, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#f3efe6'; g.font = '600 28px system-ui, sans-serif'; g.textBaseline = 'middle'
    g.fillText(text, 62, H / 2 + 1, W - 80)
    this.hudTex.needsUpdate = true
  }

  // ------------------------------------------------------------------ VR
  private setupControllers(): void {
    const factory = new XRControllerModelFactory()
    for (let i = 0; i < 2; i++) {
      const ctrl = this.renderer.xr.getController(i)
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)])
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8 }))
      line.scale.z = 2.5
      ctrl.add(line)
      // a small marker so a controller is visible even if the model library cannot be fetched
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.1), new THREE.MeshBasicMaterial({ color: 0xd9c9a0 }))
      marker.position.z = 0.02
      ctrl.add(marker)
      this.rig.add(ctrl)
      const entry = { ctrl, line, hand: 'none' }
      this.controllers.push(entry)
      ctrl.addEventListener('connected', (ev: { data?: { handedness?: string } }) => { entry.hand = ev.data?.handedness ?? 'none' })
      ctrl.addEventListener('selectstart', () => this.onSelect(i))
      const grip = this.renderer.xr.getControllerGrip(i)
      try { grip.add(factory.createControllerModel(grip)) } catch { /* offline: the marker and ray remain */ }
      this.rig.add(grip)
    }
  }

  private onSelect(i: number): void {
    const c = this.controllers[i]
    if (!c) return
    const hit = this.pick(this.rayFor(c.ctrl))
    const ok = this.activate(hit)
    this.pulse(c.hand, ok ? 0.6 : 0.15)
  }

  private rayFor(ctrl: THREE.Object3D): THREE.Raycaster {
    ctrl.updateMatrixWorld(true)
    const o = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld)
    const d = new THREE.Vector3(0, 0, -1).transformDirection(ctrl.matrixWorld)
    this.raycaster.set(o, d)
    return this.raycaster
  }

  private pulse(hand: string, v: number): void {
    const s = this.session
    if (!s) return
    for (const src of Array.from(s.inputSources)) if (src.handedness === hand) { try { src.gamepad?.hapticActuators?.[0]?.pulse?.(v, 30) } catch { /* no haptics */ } }
  }

  private vrInput(dt: number): void {
    // hover + ray length
    let hover: HitInfo | null = null
    for (const c of this.controllers) {
      const hit = this.pick(this.rayFor(c.ctrl))
      c.line.scale.z = hit ? 1.2 : 2.5
      if (hit && !hover) hover = hit
    }
    this.seatHover = hover?.kind === 'seat' ? hover.id : null
    this.smart.setHover(hover && hover.kind !== 'panel' && hover.kind !== 'cpanel' && hover.kind !== 'seat' && hover.kind !== 'fanBtn' ? { kind: hover.kind as TargetData['kind'], key: hover.id } : null)
    this.smart.setPopupHover(hover?.kind === 'fanBtn' ? hover.id : null)
    const hid = hover?.kind === 'panel' ? hover.id : null
    if (hid !== this.panelHover) { this.panelHover = hid; if (this.panelOpen) this.redrawPanel(true) }
    const cid = hover?.kind === 'cpanel' ? hover.id : null
    if (cid !== this.customHover) { this.customHover = cid; if (this.customOpen) this.redrawCustom(true) }

    const s = this.session
    if (!s) return
    for (const src of Array.from(s.inputSources)) {
      const gp = src.gamepad
      if (!gp) continue
      const ax = gp.axes
      const sx = ax.length >= 4 ? ax[2] : ax[0] ?? 0, sy = ax.length >= 4 ? ax[3] : ax[1] ?? 0
      const prev = this.prevButtons.get(src.handedness) ?? []
      const now = gp.buttons.map((b) => b.pressed)
      const edge = (n: number) => now[n] && !prev[n]
      this.prevButtons.set(src.handedness, now)
      if (src.handedness === 'left') {
        const dead = 0.15
        const mx = Math.abs(sx) > dead ? sx : 0, my = Math.abs(sy) > dead ? sy : 0
        if (mx || my) {
          this.camera.updateMatrixWorld(true)
          const fwd = this.camera.getWorldDirection(this.tmp); fwd.y = 0
          if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
          fwd.normalize()
          const rx = -fwd.z, rz = fwd.x
          const sp = WALK_MPS * dt
          this.walk((fwd.x * -my + rx * mx) * sp, (fwd.z * -my + rz * mx) * sp)
        }
        if (edge(3)) void this.toggleMic()               // left stick click: mute / resume hands-free listening
        if (edge(5)) this.togglePanel()                  // Y: show / hide the panel
        if (edge(4) && (this.panelOpen || this.customOpen)) this.placePanel() // X: bring the panel back in front of me
      } else if (src.handedness === 'right') {
        // thumbstick forward = point the teleport arc, release = go (back = cancel)
        if (sy < -0.6 && !this.aim && !this.fade) this.startAim('right')
        else if (this.aim?.hand === 'right') {
          if (sy > 0.5) this.cancelAim()
          else if (sy > -0.3) this.releaseAim()
        }
        if (Math.abs(sx) < 0.3) this.snapReady = true
        else if (this.snapReady && Math.abs(sx) > 0.7) { this.snapReady = false; this.snapTurn(sx > 0 ? -SNAP_RAD : SNAP_RAD) }
        if (edge(5)) this.pushToTalk()                   // B: push to talk (only if the browser offers speech recognition)
        if (edge(4)) this.toggleCustom()                 // A: show / hide the customisation panel
      }
    }
  }

  /** rotates the person about their head */
  snapTurn(rad: number): void {
    this.camera.updateMatrixWorld(true)
    const before = this.camera.getWorldPosition(this.tmp).clone()
    this.rig.rotation.y += rad
    this.yaw += rad
    this.rig.updateMatrixWorld(true)
    const after = this.camera.getWorldPosition(this.tmp)
    this.rig.position.x += before.x - after.x; this.rig.position.z += before.z - after.z
  }

  async enterVR(): Promise<void> {
    if (this.mode === 'vr') return
    const status = await detectXr(this.nav, this.secure)
    this.xrStatus = status
    if (status.state !== 'supported') { this.say(status.message); throw new Error(status.message) }
    const xr = (this.nav ?? (navigator as unknown as NavLike)).xr!
    const request = async (feat: string[]): Promise<XrSessionLike> => (await xr.requestSession('immersive-vr', { optionalFeatures: feat })) as XrSessionLike
    let session: XrSessionLike
    try {
      session = await request(['local-floor', 'bounded-floor'])
      try { await this.renderer.xr.setSession(session as unknown as XRSession) } catch (e) {
        // no floor-level reference space on this device: retry with a seated 'local' space and a fixed eye height
        try { await session.end() } catch { /* already ended */ }
        this.renderer.xr.setReferenceSpaceType('local')
        this.eyeOffset = EYE_M
        session = await request([])
        await this.renderer.xr.setSession(session as unknown as XRSession)
        void e
      }
    } catch (e) {
      const msg = `Could not start VR: ${(e as Error).message}`
      this.say(msg); throw new Error(msg)
    }
    this.session = session
    session.addEventListener('end', () => this.onSessionEnded())
    this.renderer.xr.setFoveation(1)
    this.mode = 'vr'
    this.showExit = true
    this.camera.position.set(0, 0, 0); this.camera.rotation.set(0, 0, 0)
    this.snapRig(true)
    this.panelMesh.visible = this.panelOpen
    this.customMesh.visible = this.customOpen
    if (this.panelOpen || this.customOpen) this.placePanel()
    this.say('In VR. Left stick: walk. Right stick: turn; push it forward to aim a teleport, release to go. Trigger: press buttons. Left Y: control panel. Voice: just speak (hands-free); left stick click mutes / resumes the microphone.')
    this.onMode?.('vr')
    this.redrawHud()
    void this.startHandsFree()                           // hands-free listening starts with VR (microphone permission is asked now, never before)
  }

  async exitVR(): Promise<void> {
    const s = this.session
    if (s) { try { await s.end() } catch { this.onSessionEnded() } }
  }

  private onSessionEnded(): void {
    if (this.mode !== 'vr') return
    this.session = null
    this.cancelAim()
    this.mode = 'desktop'
    this.showExit = false
    this.panelMesh.visible = false
    this.customMesh.visible = false
    this.rig.position.set(this.foot.x * FT, this.foot.y * FT + this.sitLift, this.foot.z * FT)
    this.rig.rotation.set(0, this.yaw, 0)
    this.camera.position.set(0, EYE_M, 0)
    this.camera.rotation.set(this.pitch, 0, 0)
    this.camera.updateMatrixWorld(true)
    this.resize()
    this.handsFree.stop()                                // nothing listens outside VR: recognizer aborted, status off
    this.redrawHud()
    this.say('Left VR. Back to the desktop walk-through.')
    this.onMode?.('desktop')
  }

  // ------------------------------------------------------------------ misc
  resize(): void {
    if (this.renderer.xr.isPresenting) return
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  stats(): { drawCalls: number; triangles: number; textures: number; geometries: number; mode: Mode; poolLights: number } {
    const i = this.renderer.info
    return { drawCalls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, mode: this.mode, poolLights: this.smart.activeLights }
  }

  dispose(): void {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    this.cleanup.forEach((f) => f())
    this.handsFree.stop()
    this.ro?.disconnect()
    void this.exitVR()
    this.smart.dispose()
    this.house.dispose()
    this.panelTex.dispose()
    this.customTex.dispose()
    this.hudTex.dispose()
    for (const t of [...Object.values(this.envs), ...Object.values(this.skyBg ?? {})]) t?.dispose()
    this.custom.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
