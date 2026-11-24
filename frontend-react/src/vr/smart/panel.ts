/**
 * What the control panel shows and does (port of the tested Unity PanelModel) plus a pure LAYOUT: the same list of rectangles is drawn into the
 * in-VR canvas, hit-tested by controller rays, and used for the desktop HTML panel, so what a button looks like and what it does cannot diverge.
 */
import { SmartHouseState, formatEnergy, formatWatts } from './state'
import type { RoomInfo } from './state'
import { VoiceStatusBoard } from './voice'
import { MAX_FAN_LEVEL } from './fan'

/** the named fan speeds of the panel / popup / keyboard / voice: OFF, then speed 1, 2, 3, 4 and 5 (5 = the configured maximum) */
export const FAN_SPEEDS: readonly number[] = [1, 2, 3, 4, 5]

export interface FanFocus { key: string; name: string; floor: number; level: number; rpm: number }

export interface PanelRow { key: string; name: string; floor: number; lightOn: boolean; hasFan: boolean; fanLevel: number; fanRpm: number; offInSeconds: number }

export class PanelModel {
  static readonly ROWS_PER_PAGE = 6
  private rooms: RoomInfo[]
  private _page = 0
  /** the room whose fan the 'Fan control' strip drives (the engine sets it: the room the person is in, else the last fan they pointed at, else the nearest) */
  focusKey: string | null = null
  constructor(private readonly st: SmartHouseState, readonly voice: VoiceStatusBoard = new VoiceStatusBoard()) {
    this.rooms = [...st.lights.rooms].sort((a, b) => (a.floor !== b.floor ? a.floor - b.floor : a.order - b.order))
  }
  get roomCount(): number { return this.rooms.length }
  get pageCount(): number { return Math.max(1, Math.ceil(this.rooms.length / PanelModel.ROWS_PER_PAGE)) }
  get page(): number { return this._page }
  set page(p: number) { this._page = Math.max(0, Math.min(this.pageCount - 1, p)) }
  nextPage(): void { this.page = this._page + 1 }
  prevPage(): void { this.page = this._page - 1 }
  static floorLabel(f: number): string { return f === 0 ? 'G' : `${f}F` }
  rows(): PanelRow[] { return this.rooms.slice(this._page * PanelModel.ROWS_PER_PAGE, (this._page + 1) * PanelModel.ROWS_PER_PAGE).map((r) => this.rowFor(r)) }
  rowFor(r: RoomInfo): PanelRow {
    const f = this.st.fan(r.key)
    return {
      key: r.key, floor: r.floor,
      name: this.st.lights.isMaster ? 'Whole house' : `${r.name} (${PanelModel.floorLabel(r.floor)})`,
      lightOn: this.st.lights.isOn(r.key), hasFan: !!f, fanLevel: f?.level ?? 0, fanRpm: f ? Math.round(f.velocityDegPerSec / 6) : 0,
      offInSeconds: this.st.auto.secondsUntilOff(r.key),
    }
  }
  /** the fan the control strip is about, or null when the house has none / none is in focus */
  get fanFocus(): FanFocus | null {
    const k = this.focusKey
    const f = k ? this.st.fan(k) : null
    if (!k || !f) return null
    const r = this.rooms.find((q) => q.key === k)
    return { key: k, name: r ? r.name : k, floor: r?.floor ?? 0, level: f.level, rpm: Math.round(f.velocityDegPerSec / 6) }
  }
  /** OFF = 0, ON = the last speed used (default speed when it was never on), or an exact level */
  fanSet(key: string, level: number): void { if (this.st.fan(key)) this.st.setFanLevel(key, level, 'panel') }
  fanOn(key: string): void { this.st.fanOn(key, 'panel') }
  toggleLight(key: string): void { if (this.st.lights.has(key)) this.st.lights.toggle(key, 'panel') }
  allOn(): number { return this.st.setAllLights(true, 'panel') }
  allOff(): number { return this.st.setAllLights(false, 'panel') }
  fanStep(key: string, delta: number): void { if (this.st.fan(key)) this.st.setFanLevel(key, this.st.fanLevel(key) + delta, 'panel') }
  toggleAuto(): boolean { return this.st.auto.setEnabled(!this.st.auto.isEnabled) }
  get lightsSummary(): string { return `${this.st.lights.onCount} of ${this.st.lights.rooms.length} lights ON` }
  get pageText(): string { return `Page ${this._page + 1}/${this.pageCount}` }
  get autoText(): string { return this.st.auto.status }
  get fanSummary(): string {
    const e = this.st.energy
    if (e.fanCount === 0) return 'No ceiling fans'
    if (e.fansRunning === 0) return 'Fans: all OFF'
    return `Fans: ${e.fansRunning} running, top speed ${e.maxFanLevel}`
  }
  get energyLines(): [string, string] {
    const e = this.st.energy
    return [`Simulated power: ${formatWatts(e.totalWatts)}  (lights ${formatWatts(e.lightsWatts)}, fans ${formatWatts(e.fansWatts)})`, `Simulated session total: ${formatEnergy(e.sessionWh)}`]
  }
}

// ---------------------------------------------------------------- layout
export type PanelAction =
  | { t: 'allOn' } | { t: 'allOff' } | { t: 'auto' } | { t: 'prev' } | { t: 'next' } | { t: 'close' } | { t: 'exit' }
  | { t: 'light'; key: string } | { t: 'fan'; key: string; delta: number } | { t: 'fanSet'; key: string; level: number } | { t: 'fanOn'; key: string }
  | { t: 'floor'; floor: number } | { t: 'goto'; key: string } | { t: 'sit' } | { t: 'stand' } | { t: 'custom' } | { t: 'mic' }
export interface PanelButton { id: string; x: number; y: number; w: number; h: number; label: string; kind: 'primary' | 'on' | 'off' | 'neutral' | 'danger' | 'disabled'; action: PanelAction | null
  /** optional colour chip (customisation panel): the button is drawn in this colour, `selected` adds a gold outline, `size` overrides the label size */
  swatch?: string; selected?: boolean; size?: number }
export interface PanelText { x: number; y: number; text: string; size: number; weight?: number; color: string; align?: 'left' | 'center' | 'right' }
export interface PanelLayout { width: number; height: number; buttons: PanelButton[]; texts: PanelText[] }

export const PANEL_W = 1024
export const PANEL_H = 880

export function layoutPanel(model: PanelModel, st: SmartHouseState, opts: { floors?: number; showExit?: boolean; seat?: 'sit' | 'stand' } = {}): PanelLayout {
  const b: PanelButton[] = []
  const t: PanelText[] = []
  const pad = 24
  t.push({ x: pad, y: 44, text: 'Smart House', size: 36, weight: 700, color: '#f3efe6' })
  t.push({ x: PANEL_W - pad - 90, y: 44, text: model.lightsSummary, size: 22, color: '#d9c9a0', align: 'right' })
  b.push({ id: 'close', x: PANEL_W - pad - 76, y: 14, w: 76, h: 44, label: 'Close', kind: 'neutral', action: { t: 'close' } })
  b.push({ id: 'custom', x: pad + 470, y: 14, w: 190, h: 44, label: 'CUSTOMIZE', kind: 'primary', action: { t: 'custom' } })
  if (opts.seat) b.push({ id: 'seat', x: pad + 250, y: 14, w: 200, h: 44, label: opts.seat === 'stand' ? 'STAND UP' : 'SIT NEAREST', kind: opts.seat === 'stand' ? 'primary' : 'neutral', action: { t: opts.seat === 'stand' ? 'stand' : 'sit' } })
  // master row
  b.push({ id: 'allOn', x: pad, y: 72, w: 220, h: 56, label: 'ALL LIGHTS ON', kind: 'on', action: { t: 'allOn' } })
  b.push({ id: 'allOff', x: pad + 236, y: 72, w: 220, h: 56, label: 'ALL LIGHTS OFF', kind: 'off', action: { t: 'allOff' } })
  const autoOn = st.auto.isEnabled
  b.push({ id: 'auto', x: pad + 472, y: 72, w: 250, h: 56, label: autoOn ? 'AUTO LIGHTS: ON' : 'AUTO LIGHTS: OFF', kind: st.auto.available ? (autoOn ? 'on' : 'neutral') : 'disabled', action: st.auto.available ? { t: 'auto' } : null })
  t.push({ x: pad + 736, y: 98, text: model.fanSummary, size: 18, color: '#b9b4a6' })
  // fan control strip (the fan of the room the person is in)
  const ff = model.fanFocus
  const sy = 140
  t.push({ x: pad, y: sy + 22, text: ff ? `Fan - ${ff.name} (${PanelModel.floorLabel(ff.floor)}): ${ff.level === 0 ? 'OFF' : `ON, speed ${ff.level}  (${ff.rpm} rpm)`}` : 'Fan control: no ceiling fan here', size: 22, weight: 600, color: ff ? '#f3efe6' : '#8d897d' })
  const sbtn = (id: string, x: number, w: number, label: string, on: boolean, action: PanelAction | null, kind: PanelButton['kind']) => b.push({ id, x, y: sy + 32, w, h: 56, label, kind: action ? (on ? 'on' : kind) : 'disabled', action })
  sbtn('fanstrip:off', pad, 130, 'FAN OFF', !!ff && ff.level === 0, ff ? { t: 'fanSet', key: ff.key, level: 0 } : null, 'off')
  sbtn('fanstrip:on', pad + 142, 130, 'FAN ON', !!ff && ff.level > 0, ff ? { t: 'fanOn', key: ff.key } : null, 'neutral')
  FAN_SPEEDS.forEach((lv, i) => sbtn(`fanstrip:${lv}`, pad + 296 + i * 116, 104, `SPEED ${lv}`, !!ff && ff.level === lv, ff ? { t: 'fanSet', key: ff.key, level: lv } : null, 'neutral'))
  // rows
  const rowH = 70
  const y0 = 238
  model.rows().forEach((r, i) => {
    const y = y0 + i * (rowH + 6)
    t.push({ x: pad, y: y + 30, text: r.name, size: 22, weight: 600, color: '#f3efe6' })
    if (r.offInSeconds >= 0) t.push({ x: pad, y: y + 56, text: `auto-off in ${Math.ceil(r.offInSeconds)} s`, size: 16, color: '#e6b45a' })
    b.push({ id: `goto:${r.key}`, x: 304, y, w: 66, h: rowH - 6, label: 'GO', kind: 'neutral', action: { t: 'goto', key: r.key } })
    b.push({ id: `light:${r.key}`, x: 380, y, w: 150, h: rowH - 6, label: r.lightOn ? 'LIGHT ON' : 'LIGHT OFF', kind: r.lightOn ? 'on' : 'off', action: { t: 'light', key: r.key } })
    if (r.hasFan) {
      b.push({ id: `fan-:${r.key}`, x: 560, y, w: 80, h: rowH - 6, label: '−', kind: r.fanLevel > 0 ? 'neutral' : 'disabled', action: r.fanLevel > 0 ? { t: 'fan', key: r.key, delta: -1 } : null })
      b.push({ id: `fanlvl:${r.key}`, x: 648, y, w: 190, h: rowH - 6, label: r.fanLevel === 0 ? 'FAN OFF' : `FAN ${r.fanLevel}  (${r.fanRpm} rpm)`, kind: r.fanLevel > 0 ? 'on' : 'off', action: null })
      b.push({ id: `fan+:${r.key}`, x: 846, y, w: 80, h: rowH - 6, label: '+', kind: r.fanLevel < MAX_FAN_LEVEL ? 'neutral' : 'disabled', action: r.fanLevel < MAX_FAN_LEVEL ? { t: 'fan', key: r.key, delta: 1 } : null })
    } else t.push({ x: 560, y: y + 40, text: 'no ceiling fan', size: 18, color: '#8d897d' })
  })
  // footer
  const fy = y0 + 6 * (rowH + 6) + 4
  b.push({ id: 'prev', x: pad, y: fy, w: 90, h: 50, label: '◀', kind: model.page > 0 ? 'neutral' : 'disabled', action: model.page > 0 ? { t: 'prev' } : null })
  t.push({ x: pad + 140, y: fy + 34, text: model.pageText, size: 22, color: '#d9c9a0', align: 'center' })
  b.push({ id: 'next', x: pad + 190, y: fy, w: 90, h: 50, label: '▶', kind: model.page < model.pageCount - 1 ? 'neutral' : 'disabled', action: model.page < model.pageCount - 1 ? { t: 'next' } : null })
  const floors = opts.floors ?? 1
  if (floors > 1) {
    for (let f = 0; f < Math.min(floors, 4); f++) b.push({ id: `floor${f}`, x: pad + 310 + f * 104, y: fy, w: 98, h: 50, label: `Go ${PanelModel.floorLabel(f)}`, kind: 'neutral', action: { t: 'floor', floor: f } })
  }
  if (opts.showExit) b.push({ id: 'exit', x: PANEL_W - pad - 180, y: fy, w: 180, h: 50, label: 'EXIT VR', kind: 'danger', action: { t: 'exit' } })
  // hands-free listening: mute / resume (the microphone is never switched on without the person asking: it starts when VR starts, and this button stops / restarts it)
  {
    const hf = model.voice.handsFree
    const label = hf === 'on' ? 'MIC: LISTENING' : hf === 'muted' ? 'MIC: MUTED' : hf === 'unsupported' ? 'MIC: N/A' : 'MIC: START'
    b.push({ id: 'mic', x: PANEL_W - pad - 230, y: fy + 82, w: 230, h: 52, label, kind: hf === 'unsupported' ? 'disabled' : hf === 'on' ? 'on' : hf === 'muted' ? 'off' : 'neutral', action: hf === 'unsupported' ? null : { t: 'mic' } })
  }
  const [e1, e2] = model.energyLines
  t.push({ x: pad, y: fy + 84, text: e1, size: 20, color: '#cfe3c8' })
  t.push({ x: pad, y: fy + 112, text: e2, size: 20, color: '#cfe3c8' })
  t.push({ x: pad, y: fy + 144, text: model.autoText, size: 18, color: '#b9b4a6' })
  const v = model.voice
  t.push({ x: pad, y: fy + 172, text: `${v.headline}${v.detail ? ' — ' + v.detail : ''}`, size: 18, color: v.tone === 'bad' ? '#e7897e' : v.tone === 'warn' ? '#e6b45a' : '#b9b4a6' })
  return { width: PANEL_W, height: PANEL_H, buttons: b, texts: t }
}

/** the button under a canvas pixel (null when none, or when it is disabled) */
export function hitPanel(layout: PanelLayout, px: number, py: number): PanelButton | null {
  for (let i = layout.buttons.length - 1; i >= 0; i--) {
    const q = layout.buttons[i]
    if (px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h) return q
  }
  return null
}

/** runs a button's action on the model / state; floor / exit / close are returned to the caller (they need the scene or the XR session) */
export function runPanelAction(a: PanelAction, model: PanelModel): PanelAction | null {
  switch (a.t) {
    case 'allOn': model.allOn(); return null
    case 'allOff': model.allOff(); return null
    case 'auto': model.toggleAuto(); return null
    case 'prev': model.prevPage(); return null
    case 'next': model.nextPage(); return null
    case 'light': model.toggleLight(a.key); return null
    case 'fan': model.fanStep(a.key, a.delta); return null
    case 'fanSet': model.fanSet(a.key, a.level); return null
    case 'fanOn': model.fanOn(a.key); return null
    default: return a
  }
}
