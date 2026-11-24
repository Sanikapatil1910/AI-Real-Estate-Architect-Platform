/**
 * The shared state of one Smart House: every light, every fan, the motion-sensor style automation and the (simulated) energy meter.
 * Voice, wall switches, the control panel and the desktop buttons all go through this one object, so they cannot disagree.
 * Port of the tested Unity logic (LightBank / SmartHouseState / AutoLighting / EnergyModel); no three.js, no DOM.
 */
import { FanModel, clampLevel, defaultFanSpec, validateFanSpec, MAX_FAN_LEVEL } from './fan'
import type { FanSpec } from './fan'
import { roomKey } from './document'
import type { SmartHouse } from './document'
import { parseCommand } from './voice'
import type { RoomQuery, VoiceCommand } from './voice'

export type ControlSource = 'code' | 'voice' | 'switch' | 'panel' | 'auto'

export interface RoomInfo { key: string; name: string; type: string; floor: number; hasFan: boolean; order: number }

type Listener<A extends unknown[]> = (...a: A) => void
class Emitter<A extends unknown[]> {
  private fns: Array<Listener<A>> = []
  on(f: Listener<A>): () => void { this.fns.push(f); return () => { this.fns = this.fns.filter((x) => x !== f) } }
  emit(...a: A): void { for (const f of this.fns.slice()) f(...a) }
  get count(): number { return this.fns.length }
}

export class LightBank {
  readonly rooms: RoomInfo[] = []
  private on = new Map<string, boolean>()
  private byKey = new Map<string, RoomInfo>()
  isMaster = false
  readonly changed = new Emitter<[string, boolean, ControlSource]>()

  add(r: Omit<RoomInfo, 'order'>): void {
    if (this.byKey.has(r.key)) throw new Error(`Duplicate room ${r.key}`)
    const info: RoomInfo = { ...r, order: this.rooms.length }
    this.rooms.push(info); this.byKey.set(r.key, info); this.on.set(r.key, false)
  }
  static master(): LightBank {
    const b = new LightBank()
    b.isMaster = true
    b.add({ key: 'master', name: 'House', type: 'master', floor: 0, hasFan: false })
    return b
  }
  has(key: string | null | undefined): boolean { return key != null && this.byKey.has(key) }
  get(key: string | null | undefined): RoomInfo | null { return (key != null && this.byKey.get(key)) || null }
  isOn(key: string): boolean { return this.on.get(key) === true }
  get onCount(): number { let n = 0; for (const v of this.on.values()) if (v) n++; return n }
  set(key: string, value: boolean, src: ControlSource): boolean {
    if (!this.on.has(key)) throw new Error(`No light ${key}`)
    if (this.on.get(key) === value) return false
    this.on.set(key, value)
    this.changed.emit(key, value, src)
    return true
  }
  toggle(key: string, src: ControlSource): boolean { return this.set(key, !this.isOn(key), src) }
  setAll(value: boolean, src: ControlSource): number {
    let n = 0
    for (const r of this.rooms) if (this.set(r.key, value, src)) n++
    return n
  }
  resolve(q: RoomQuery, currentKey: string | null, fansOnly = false): RoomInfo[] {
    if (this.isMaster) return [this.rooms[0]]
    if (q.scope === 'current') {
      const r = this.get(currentKey)
      return r && (!fansOnly || r.hasFan) ? [r] : []
    }
    let res = this.rooms.filter((r) => (!fansOnly || r.hasFan) && r.floor >= q.floorMin && r.floor <= q.floorMax && (q.scope !== 'type' || q.types.includes(r.type)))
    if (q.scope === 'type' && q.ordinal > 0 && res.length > 0) {
      const named = res.filter((r) => trailingNumber(r.name) === q.ordinal)
      if (named.length > 0) return named
      res = [...res].sort((a, b) => a.order - b.order)
      return q.ordinal <= res.length ? [res[q.ordinal - 1]] : []
    }
    return res
  }
}
function trailingNumber(s: string): number { const m = /(\d+)$/.exec(s); return m ? Number(m[1]) : 0 }

// ------------------------------------------------------------------ energy (SIMULATED)
export interface EnergySpec { lightWatts: number; fanWatts: number[] }
export const defaultEnergySpec = (): EnergySpec => ({ lightWatts: 9, fanWatts: [0, 18, 28, 40, 55, 75] })

/** SIMULATED estimate: assumed typical watt figures x the time they were on.  Nothing here is measured. */
export class EnergyModel {
  spec: EnergySpec = defaultEnergySpec()
  sessionWh = 0
  constructor(private readonly st: SmartHouseState) {}
  get lightsOn(): number { return this.st.lights.onCount }
  get fanCount(): number { return this.st.fanKeys.length }
  get fansRunning(): number { return this.st.fanKeys.filter((k) => this.st.fanLevel(k) > 0).length }
  get maxFanLevel(): number { return this.st.fanKeys.reduce((m, k) => Math.max(m, this.st.fanLevel(k)), 0) }
  get lightsWatts(): number { return this.lightsOn * this.spec.lightWatts }
  /** a fan draws the rated power of its SELECTED level (nothing at level 0, even while the blades coast down) */
  get fansWatts(): number { return this.st.fanKeys.reduce((w, k) => w + this.spec.fanWatts[clampLevel(this.st.fanLevel(k))], 0) }
  get totalWatts(): number { return this.lightsWatts + this.fansWatts }
  tick(dt: number): void { if (dt > 0 && Number.isFinite(dt)) this.sessionWh += (this.totalWatts * dt) / 3600 }
  reset(): void { this.sessionWh = 0 }
}
export const formatWatts = (w: number): string => `${Math.round(w)} W`
export const formatEnergy = (wh: number): string => (wh >= 1000 ? `${(wh / 1000).toFixed(3)} kWh` : `${wh.toFixed(2)} Wh`)

// ------------------------------------------------------------------ automatic lighting
/**
 * Motion-detection style lighting (simulated from the player's position; no sensor hardware).  Entering a room switches its light ON; leaving starts a
 * countdown (default 30 s) after which it goes OFF.  Manual control always wins: a light switched OFF by hand while you stand in the room stays off until
 * you leave; a light changed by hand from elsewhere is left as set.  Disabled by default.
 */
export class AutoLighting {
  private vacancy = new Map<string, number>()
  private held = new Set<string>()
  private lastRoom: string | null = null
  private delay = 30
  private enabled = false
  readonly acted = new Emitter<[string, boolean]>()
  useSimulatedOccupant = false
  simulatedRoomKey: string | null = null
  private off: () => void
  constructor(private readonly st: SmartHouseState) { this.off = st.lights.changed.on((k, on, src) => this.onLight(k, on, src)) }
  dispose(): void { this.off() }
  get available(): boolean { return !this.st.lights.isMaster }
  get isEnabled(): boolean { return this.enabled }
  get vacancyDelaySeconds(): number { return this.delay }
  set vacancyDelaySeconds(v: number) { if (!(v >= 0) || !Number.isFinite(v)) throw new RangeError('vacancy delay'); this.delay = v }
  get occupiedRoomKey(): string | null { return this.useSimulatedOccupant ? this.simulatedRoomKey : this.st.currentRoomKey }
  setEnabled(on: boolean): boolean {
    if (on && !this.available) return false
    if (on === this.enabled) return true
    this.enabled = on
    this.vacancy.clear(); this.held.clear(); this.lastRoom = null
    return true
  }
  isHeld(key: string): boolean { return this.held.has(key) }
  secondsUntilOff(key: string): number {
    const t = this.vacancy.get(key)
    return t !== undefined && this.st.lights.isOn(key) ? Math.max(0, this.delay - t) : -1
  }
  get pendingCountdowns(): number { let n = 0; for (const k of this.vacancy.keys()) if (this.st.lights.isOn(k)) n++; return n }
  get status(): string {
    if (!this.available) return 'Automatic lights: needs room data'
    if (!this.enabled) return 'Automatic lights: OFF'
    const p = this.pendingCountdowns
    return p > 0 ? `Automatic lights: ON (${p} room${p === 1 ? '' : 's'} switching off soon)` : 'Automatic lights: ON'
  }
  private onLight(key: string, on: boolean, src: ControlSource): void {
    if (!this.enabled || src === 'auto') return
    if (key === this.occupiedRoomKey) { if (!on) this.held.add(key) } else this.vacancy.delete(key)
  }
  tick(dt: number): void {
    if (!this.enabled) return
    if (!(dt >= 0) || !Number.isFinite(dt)) dt = 0
    const cur = this.occupiedRoomKey
    if (cur !== this.lastRoom) {
      if (this.lastRoom !== null) this.vacancy.set(this.lastRoom, 0)
      this.lastRoom = cur
      if (cur !== null) this.enter(cur)
    }
    if (this.vacancy.size === 0) return
    const due: string[] = []
    for (const k of [...this.vacancy.keys()]) {
      if (k === cur) { this.vacancy.delete(k); continue }
      const t = (this.vacancy.get(k) ?? 0) + dt
      this.vacancy.set(k, t)
      if (t >= this.delay) due.push(k)
    }
    for (const k of due) {
      this.vacancy.delete(k); this.held.delete(k)
      if (this.st.lights.has(k) && this.st.lights.set(k, false, 'auto')) this.acted.emit(k, false)
    }
  }
  private enter(key: string): void {
    this.vacancy.delete(key)
    if (!this.st.lights.has(key) || this.held.has(key)) return
    if (this.st.lights.set(key, true, 'auto')) this.acted.emit(key, true)
  }
}

// ------------------------------------------------------------------ the state
export type PanelRequest = 'none' | 'show' | 'hide'
export interface CommandResult { panel: PanelRequest; understood: boolean; changed: boolean; message: string; roomKeys: string[] }
const newResult = (): CommandResult => ({ panel: 'none', understood: false, changed: false, message: '', roomKeys: [] })

export class SmartHouseState {
  private fans = new Map<string, FanModel>()
  readonly fanLevelChanged = new Emitter<[string, number, ControlSource]>()
  /** the room the player is in (set by the room locator); null when outside or unknown */
  currentRoomKey: string | null = null
  readonly auto: AutoLighting
  readonly energy: EnergyModel

  constructor(readonly lights: LightBank, readonly spec: FanSpec = defaultFanSpec()) {
    validateFanSpec(spec)
    this.auto = new AutoLighting(this)
    this.energy = new EnergyModel(this)
  }

  static fromDocument(doc: SmartHouse, spec: FanSpec = defaultFanSpec()): SmartHouseState {
    const lights = new LightBank()
    const st = new SmartHouseState(lights, spec)
    for (const r of doc.rooms) {
      const key = roomKey(r)
      lights.add({ key, name: r.name, type: r.type, floor: r.floor, hasFan: !!r.fan })
      if (r.fan) st.fans.set(key, new FanModel(spec))
    }
    return st
  }
  /** fallback when no room data exist: one master light, no fans */
  static master(spec: FanSpec = defaultFanSpec()): SmartHouseState { return new SmartHouseState(LightBank.master(), spec) }

  fan(key: string | null | undefined): FanModel | null { return (key != null && this.fans.get(key)) || null }
  get fanKeys(): string[] { return [...this.fans.keys()] }
  fanLevel(key: string): number { return this.fan(key)?.level ?? 0 }
  setFanLevel(key: string, level: number, src: ControlSource): boolean {
    const f = this.fan(key)
    if (!f) return false
    level = clampLevel(level)
    if (f.level === level) return false
    f.setLevel(level)
    if (level > 0) this.lastOn.set(key, level)
    this.fanLevelChanged.emit(key, level, src)
    return true
  }
  /** the speed a fan returns to when it is switched ON: the last speed it ran at, else the default */
  private readonly lastOn = new Map<string, number>()
  fanOnLevel(key: string): number { return this.lastOn.get(key) ?? this.spec.defaultOnLevel }
  /** ON keeps a running fan as it is, else restores the last speed; false when nothing changed */
  fanOn(key: string, src: ControlSource): boolean { const cur = this.fanLevel(key); return this.setFanLevel(key, cur === 0 ? this.fanOnLevel(key) : cur, src) }
  /** the trigger on the fan itself: OFF when it runs, ON (last speed) when it is stopped */
  fanToggle(key: string, src: ControlSource): boolean { return this.fanLevel(key) > 0 ? this.setFanLevel(key, 0, src) : this.fanOn(key, src) }
  setAllLights(on: boolean, src: ControlSource): number { return this.lights.setAll(on, src) }

  /** advances the fans, the automation and the energy meter (set currentRoomKey first) */
  tick(dt: number): void {
    for (const f of this.fans.values()) f.tick(dt)
    this.auto.tick(dt)
    this.energy.tick(dt)
  }

  // ---- voice / typed commands
  execute(input: string | VoiceCommand): CommandResult {
    const c = typeof input === 'string' ? parseCommand(input) : input
    const res = newResult()
    if (c.kind === 'unknown') { res.message = c.normalized.length === 0 ? 'Nothing heard' : `Not understood: “${c.heard.trim()}”`; return res }
    res.understood = true
    if (c.kind.startsWith('fan')) return this.execFan(c, res)
    if (c.kind === 'autoOn' || c.kind === 'autoOff') {
      const want = c.kind === 'autoOn'
      if (!this.auto.setEnabled(want)) { res.message = 'Automatic lights need the room data of the house'; return res }
      res.changed = true; res.message = `Automatic lights ${want ? 'ON' : 'OFF'}`
      return res
    }
    if (c.kind === 'panelShow' || c.kind === 'panelHide') {
      res.panel = c.kind === 'panelShow' ? 'show' : 'hide'
      res.changed = true
      res.message = c.kind === 'panelShow' ? 'Control panel shown' : 'Control panel hidden'
      return res
    }
    const on = c.kind === 'lightOn'
    const rooms = this.lights.resolve(c.room, this.currentRoomKey)
    if (rooms.length === 0) { res.message = noRoom('light'); return res }
    let changed = 0
    for (const r of rooms) { res.roomKeys.push(r.key); if (this.lights.set(r.key, on, 'voice')) changed++ }
    res.changed = changed > 0
    res.message = this.describe(rooms, c.room, 'light', on ? 'ON' : 'OFF', changed)
    return res
  }

  private execFan(c: VoiceCommand, res: CommandResult): CommandResult {
    let rooms = this.lights.resolve(c.room, this.currentRoomKey, true)
    if (rooms.length === 0) {
      if (c.room.scope === 'current' && this.fans.size === 1) rooms = [this.lights.get([...this.fans.keys()][0])!]
      else {
        const here = this.lights.get(this.currentRoomKey)
        res.message = here && !here.hasFan ? `No ceiling fan in the ${here.name}` : noRoom('fan')
        return res
      }
    }
    let changed = 0
    let what = ''
    for (const r of rooms) {
      const cur = this.fanLevel(r.key)
      let next = cur
      switch (c.kind) {
        case 'fanOff': next = 0; break
        case 'fanOn': next = cur === 0 ? this.fanOnLevel(r.key) : cur; break
        case 'fanSet': next = c.level; break
        case 'fanFaster': next = cur + 1; break
        case 'fanSlower': next = cur - 1; break
      }
      res.roomKeys.push(r.key)
      if (this.setFanLevel(r.key, next, 'voice')) changed++
      what = clampLevel(next) === 0 ? 'OFF' : `speed ${clampLevel(next)}`
    }
    res.changed = changed > 0
    res.message = this.describe(rooms, c.room, 'fan', what, changed)
    return res
  }

  private describe(rooms: RoomInfo[], q: RoomQuery, noun: string, state: string, changed: number): string {
    let s: string
    if (this.lights.isMaster) s = 'House light '
    else if (rooms.length === 1) s = `${rooms[0].name} ${noun} `
    else if (q.scope === 'all' && q.floorMin === 0 && q.floorMax === Number.MAX_SAFE_INTEGER) s = `All ${rooms.length} ${noun}s `
    else s = `${rooms.length} ${q.label ? q.label + ' ' : ''}${noun}s `
    s += state
    if (changed === 0) s += ' (already)'
    return s
  }
}
const noRoom = (noun: string): string => `Say which room: I don't know where you are (try “turn on the living room ${noun}”)`
export { MAX_FAN_LEVEL }
