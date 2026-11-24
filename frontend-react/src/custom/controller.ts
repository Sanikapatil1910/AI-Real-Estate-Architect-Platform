/**
 * The customisation controller: ONE object that owns the document (CustomStore), the live applier and what the panel shows (tab, section, target room).  The in-VR canvas
 * panel and the desktop HTML panel both call perform() and draw layout(), so a change made in either place is the same change on the same scene and the same saved state.
 */
import type { LoadedHouse } from '../vr/houseLoader'
import type { PanelButton, PanelLayout, PanelText } from '../vr/smart/panel'
import { DEFAULT_DESIGN } from '../components/twinThemes'
import { CustomApplier } from './apply'
import type { ApplyResult } from './apply'
import { CEILING_COLORS, CEILING_FINISHES, FLOOR_OPTIONS, PAINT_FINISHES, PALETTES, ROLE_OPTIONS, SURFACE_FINISHES, WALL_MATERIALS, WALL_PAINTS } from './catalog'
import { CustomStore } from './store'
import type { StorageLike } from './store'
import { emptyState } from './types'
import type { CustomState, PaintFinish, RoomCustom, SurfaceFinish, WallSide } from './types'

export type CustomTab = 'interior' | 'exterior' | 'walls' | 'flooring' | 'ceiling' | 'doors' | 'furniture' | 'decor' | 'history'
export const TABS: Array<{ id: CustomTab; label: string }> = [
  { id: 'interior', label: 'Interior' }, { id: 'exterior', label: 'Exterior' }, { id: 'walls', label: 'Walls' }, { id: 'flooring', label: 'Flooring' }, { id: 'ceiling', label: 'Ceiling' },
  { id: 'doors', label: 'Doors' }, { id: 'furniture', label: 'Furniture' }, { id: 'decor', label: 'Decor' }, { id: 'history', label: 'History' },
]
/** tabs that edit one room (or all rooms at once) */
const ROOM_TABS = new Set<CustomTab>(['walls', 'flooring', 'ceiling'])

export type CustomAction =
  | { t: 'tab'; tab: CustomTab } | { t: 'section'; id: string } | { t: 'target'; key: string | 'all' } | { t: 'step'; delta: number }
  | { t: 'wallColor'; id: string } | { t: 'wallFinish'; id: PaintFinish } | { t: 'wallMaterial'; id: string }
  | { t: 'accentSide'; side: WallSide | null } | { t: 'accentColor'; id: string } | { t: 'accentMaterial'; id: string }
  | { t: 'floor'; id: string } | { t: 'floorFinish'; id: SurfaceFinish }
  | { t: 'ceilColor'; id: string } | { t: 'ceilFinish'; id: 'matte' | 'satin' }
  | { t: 'role'; key: string; id: string | null } | { t: 'palette'; id: string } | { t: 'resetRoom' }
  | { t: 'undo' } | { t: 'redo' } | { t: 'reset' } | { t: 'save' } | { t: 'restore' } | { t: 'forget' } | { t: 'close' } | { t: 'lighting'; id: 'day' | 'evening' }

const SECTIONS: Record<CustomTab, Array<{ id: string; label: string }>> = {
  interior: [{ id: 'palettes', label: 'Palettes' }],
  exterior: [{ id: 'facadeFinish', label: 'Wall finish' }, { id: 'facadeColor', label: 'Wall colour' }, { id: 'trim', label: 'Trim' }, { id: 'railing', label: 'Railing' }, { id: 'gate', label: 'Gate' }],
  walls: [{ id: 'paint', label: 'Paint' }, { id: 'finish', label: 'Finish' }, { id: 'material', label: 'Material' }, { id: 'accent', label: 'Accent wall' }],
  flooring: [{ id: 'Wood', label: 'Wood' }, { id: 'Marble', label: 'Marble' }, { id: 'Granite', label: 'Granite' }, { id: 'Ceramic', label: 'Ceramic' }, { id: 'Stone', label: 'Stone' }],
  ceiling: [{ id: 'color', label: 'Colour' }, { id: 'finish', label: 'Finish' }],
  doors: [{ id: 'door', label: 'Doors' }, { id: 'windowFrame', label: 'Window frames' }],
  furniture: [{ id: 'furnWood', label: 'Wood' }, { id: 'upholstery', label: 'Sofas' }, { id: 'cabinets', label: 'Cabinets' }, { id: 'counter', label: 'Counter' }, { id: 'bathTile', label: 'Bath tile' }, { id: 'fixtures', label: 'Fixtures' }],
  decor: [{ id: 'curtains', label: 'Curtains' }, { id: 'rugs', label: 'Rugs' }],
  history: [],
}
const sideLabel: Record<WallSide, string> = { N: 'North', E: 'East', S: 'South', W: 'West' }

export interface CustomInfo { changes: number; unsaved: boolean; hasSaved: boolean; lastMessage: string }

export class CustomController {
  readonly store: CustomStore
  readonly applier: CustomApplier
  tab: CustomTab = 'walls'
  section: Record<CustomTab, string>
  /** a room key, or 'all' */
  target: string | 'all' = 'all'
  message = ''
  lastResult: ApplyResult | null = null
  onChange: (() => void) | null = null
  /** called after Save with the document to keep in the project record (the page copies it into project.data.custom) */
  onSaved: ((s: CustomState) => void) | null = null
  onClose: (() => void) | null = null
  /** the scene's lighting (set by the engine): the panel offers Daylight / Evening next to the design controls */
  lighting: { get: () => 'day' | 'evening'; set: (l: 'day' | 'evening') => void } | null = null
  private unsub: () => void
  private roomList: Array<{ key: string; name: string; floor: number; type: string }>

  constructor(readonly house: LoadedHouse, storage: StorageLike | null, storeKey: string, savedInProject?: unknown) {
    this.store = new CustomStore(storeKey, storage)
    this.applier = new CustomApplier(house.root, house.smart, house.design ?? DEFAULT_DESIGN)
    this.roomList = house.smart.rooms.map((r) => ({ key: `${r.floor}:${r.id}`, name: r.name, floor: r.floor, type: r.type })).sort((a, b) => a.floor - b.floor)
    this.section = Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, v[0]?.id ?? ''])) as Record<CustomTab, string>
    this.section.flooring = 'Wood'
    if (savedInProject !== undefined) this.store.adopt(savedInProject)             // a design saved with the project (other device) when nothing is saved here
    const dropped = this.store.prune(this.applier.roomKeys())
    if (dropped.length) this.message = `${dropped.length} saved room setting${dropped.length > 1 ? 's' : ''} did not match this house and ${dropped.length > 1 ? 'were' : 'was'} ignored.`
    this.unsub = this.store.subscribe((s, why) => { if (why !== 'save' && why !== 'clear') this.applyNow(s); this.onChange?.() })
    this.applyNow(this.store.state)
  }

  private applyNow(s: CustomState): void { this.lastResult = this.applier.apply(s) }
  get info(): CustomInfo { return { changes: this.store.changeCount, unsaved: this.store.unsaved, hasSaved: this.store.hasSaved, lastMessage: this.message } }
  get rooms() { return this.roomList }
  get targetKeys(): string[] { return this.target === 'all' ? this.roomList.map((r) => r.key) : [this.target] }
  get targetName(): string { const r = this.roomList.find((q) => q.key === this.target); return this.target === 'all' ? 'All rooms' : r ? `${r.name} (${r.floor === 0 ? 'G' : r.floor + 'F'})` : this.target }
  private say(m: string): void { this.message = m }

  perform(a: CustomAction): boolean {
    const S = this.store
    const room = (patch: (r: RoomCustom) => RoomCustom | undefined, why: string) => S.editRooms(this.targetKeys, patch, why)
    switch (a.t) {
      case 'tab': this.tab = a.tab; this.onChange?.(); return true
      case 'section': this.section[this.tab] = a.id; this.onChange?.(); return true
      case 'target': this.target = a.key; this.onChange?.(); return true
      case 'step': {
        const ks = ['all', ...this.roomList.map((r) => r.key)]
        const i = Math.max(0, ks.indexOf(this.target))
        this.target = ks[(i + a.delta + ks.length) % ks.length]; this.onChange?.(); return true
      }
      case 'wallColor': { const c = WALL_PAINTS.find((p) => p.id === a.id); if (!c) return false; this.say(`${this.targetName}: wall colour ${c.label}`); return room((r) => ({ ...r, wall: { finish: r.wall?.finish, color: c.swatch } }), 'wall') }
      case 'wallFinish': this.say(`${this.targetName}: ${a.id} wall finish`); return room((r) => ({ ...r, wall: { ...r.wall, finish: a.id } }), 'wall')
      case 'wallMaterial': { const m = WALL_MATERIALS.find((w) => w.id === a.id); if (!m) return false; this.say(`${this.targetName}: ${m.label} walls`); return room((r) => ({ ...r, wall: { finish: r.wall?.finish, material: m.id } }), 'wall') }
      case 'accentSide':
        this.say(a.side ? `${this.targetName}: ${sideLabel[a.side]} wall is the accent wall` : `${this.targetName}: accent wall removed`)
        return room((r) => { const { accent, ...rest } = r; return a.side ? { ...rest, accent: { side: a.side, color: accent?.color ?? '#c98a76', ...(accent?.material ? { material: accent.material } : {}) } } : rest }, 'accent')
      case 'accentColor': { const c = WALL_PAINTS.find((p) => p.id === a.id); if (!c) return false; return room((r) => ({ ...r, accent: { side: r.accent?.side ?? 'N', color: c.swatch } }), 'accent') }
      case 'accentMaterial': { const m = WALL_MATERIALS.find((w) => w.id === a.id); if (!m) return false; return room((r) => ({ ...r, accent: { side: r.accent?.side ?? 'N', material: m.id } }), 'accent') }
      case 'floor': { const f = FLOOR_OPTIONS.find((x) => x.id === a.id); if (!f) return false; this.say(`${this.targetName}: ${f.label} floor`); return room((r) => ({ ...r, floor: { id: f.id, finish: r.floor?.finish } }), 'floor') }
      case 'floorFinish': this.say(`${this.targetName}: ${a.id} floor finish`); return room((r) => ({ ...r, floor: { id: r.floor?.id ?? 'oak_warm', finish: a.id } }), 'floor')
      case 'ceilColor': { const c = CEILING_COLORS.find((x) => x.id === a.id); if (!c) return false; this.say(`${this.targetName}: ${c.label} ceiling`); return room((r) => ({ ...r, ceiling: { ...r.ceiling, color: c.swatch } }), 'ceiling') }
      case 'ceilFinish': this.say(`${this.targetName}: ${a.id} ceiling`); return room((r) => ({ ...r, ceiling: { ...r.ceiling, finish: a.id } }), 'ceiling')
      case 'resetRoom': this.say(`${this.targetName}: back to the original`); return room(() => undefined, 'room reset')
      case 'role': {
        const opt = ROLE_OPTIONS[a.key]?.options.find((o) => o.id === a.id)
        this.say(a.id === null ? `${ROLE_OPTIONS[a.key]?.label ?? a.key}: original` : `${ROLE_OPTIONS[a.key]?.label ?? a.key}: ${opt?.label ?? a.id}`)
        return S.setRole(a.key, a.id)
      }
      case 'palette': {
        const p = PALETTES.find((x) => x.id === a.id)
        if (!p) return false
        const ns = p.build(this.roomList.map((r) => ({ key: r.key, type: r.type })))
        this.say(`Applied the ${p.label} palette to the whole house`)
        // a palette replaces the whole look but keeps role choices the palette does not set (rugs, gate, ...)
        return S.replace({ v: 1, roles: { ...S.state.roles, ...ns.roles }, rooms: ns.rooms }, 'palette')
      }
      case 'undo': { const ok = S.undo(); this.say(ok ? 'Undone' : 'Nothing to undo'); return ok }
      case 'redo': { const ok = S.redo(); this.say(ok ? 'Redone' : 'Nothing to redo'); return ok }
      case 'reset': { const ok = S.reset(); this.say(ok ? 'Back to the original design (Undo brings your changes back)' : 'Already the original design'); return ok }
      case 'save': S.save(); this.say('Design saved'); this.onSaved?.(S.state); this.onChange?.(); return true
      case 'restore': { const ok = S.restore(); this.say(ok ? 'Restored the saved design' : 'No saved design yet'); this.onChange?.(); return ok }
      case 'forget': S.clearSaved(); this.say('Saved design deleted'); this.onSaved?.(emptyState()); this.onChange?.(); return true
      case 'close': this.onClose?.(); return true
      case 'lighting': this.lighting?.set(a.id); this.say(a.id === 'day' ? 'Daylight lighting' : 'Evening lighting'); this.onChange?.(); return true
    }
  }

  // ------------------------------------------------------------------ what is currently chosen (for the highlight)
  private roomsVal<T>(get: (r: RoomCustom | undefined) => T | undefined): T | undefined {
    const vals = this.targetKeys.map((k) => get(this.store.state.rooms[k]))
    const first = vals[0]
    return vals.every((v) => v !== undefined && JSON.stringify(v) === JSON.stringify(first)) ? first : undefined
  }

  // ------------------------------------------------------------------ layout
  /** the panel as rectangles (1024 x 880), drawn by the VR canvas and by the desktop HTML panel */
  layout(): PanelLayout {
    const W = 1024, H = 880, pad = 24
    const b: PanelButton[] = []
    const t: PanelText[] = []
    const info = this.info
    t.push({ x: pad, y: 46, text: 'Customize your home', size: 34, weight: 700, color: '#f3efe6' })
    t.push({ x: 560, y: 44, text: info.changes === 0 ? 'Original design' : `${info.changes} change${info.changes > 1 ? 's' : ''}${info.unsaved ? ' · not saved' : ' · saved'}`, size: 20, color: info.unsaved && info.changes ? '#e6b45a' : '#cfe3c8', align: 'center' })
    b.push({ id: 'cu:close', x: W - pad - 90, y: 14, w: 90, h: 44, label: 'Close', kind: 'neutral', action: { t: 'custom' }, size: 24 })
    // tabs
    const tw = (W - 2 * pad - 8 * 6) / 9
    TABS.forEach((tb, i) => b.push({ id: `cu:tab:${tb.id}`, x: pad + i * (tw + 6), y: 70, w: tw, h: 52, label: tb.label, kind: this.tab === tb.id ? 'primary' : 'neutral', action: null, selected: this.tab === tb.id, size: 19 }))
    let y = 134
    if (ROOM_TABS.has(this.tab) || this.tab === 'interior') {
      if (this.tab !== 'interior') {
        t.push({ x: pad, y: y + 34, text: 'Apply to:', size: 22, color: '#d9c9a0' })
        b.push({ id: 'cu:prev', x: 150, y, w: 70, h: 48, label: '◀', kind: 'neutral', action: null, size: 26 })
        b.push({ id: 'cu:target', x: 228, y, w: 380, h: 48, label: this.targetName, kind: 'neutral', action: null, size: 24 })
        b.push({ id: 'cu:next', x: 616, y, w: 70, h: 48, label: '▶', kind: 'neutral', action: null, size: 26 })
        b.push({ id: 'cu:all', x: 700, y, w: 130, h: 48, label: 'ALL ROOMS', kind: this.target === 'all' ? 'on' : 'neutral', action: null, size: 20 })
        b.push({ id: 'cu:resetroom', x: 840, y, w: 160, h: 48, label: 'RESET ROOM', kind: 'neutral', action: null, size: 20 })
        y += 60
      } else { t.push({ x: pad, y: y + 30, text: 'A palette sets walls, floors, ceilings, doors, frames, furniture and outer colour for the whole house in one step.', size: 19, color: '#b9b4a6' }); y += 44 }
    }
    const secs = SECTIONS[this.tab]
    if (secs.length > 1) {
      const sw = Math.min(190, (W - 2 * pad - 6 * (secs.length - 1)) / secs.length)
      secs.forEach((s, i) => b.push({ id: `cu:sec:${s.id}`, x: pad + i * (sw + 6), y, w: sw, h: 46, label: s.label, kind: this.section[this.tab] === s.id ? 'on' : 'neutral', action: null, size: 20 }))
      y += 56
    }
    this.content(b, t, y)
    // footer
    const fy = 792
    t.push({ x: pad, y: fy - 12, text: this.message || 'Pick an option: the house changes right away. Save keeps it for next time.', size: 19, color: '#cfe3c8' })
    const fb = (i: number, id: string, label: string, kind: PanelButton['kind'], enabled: boolean) => b.push({ id: `cu:${id}`, x: pad + i * 196, y: fy, w: 184, h: 60, label, kind: enabled ? kind : 'disabled', action: null, size: 24 })
    fb(0, 'undo', 'UNDO', 'neutral', this.store.canUndo)
    fb(1, 'redo', 'REDO', 'neutral', this.store.canRedo)
    fb(2, 'reset', 'RESET ALL', 'danger', this.store.changeCount > 0)
    fb(3, 'save', 'SAVE', 'primary', true)
    fb(4, 'restore', 'RESTORE SAVED', 'neutral', this.store.hasSaved)
    // every enabled button carries a marker action (so hover / disabled drawing work); the real routing is by button id (press / actionFor)
    return { width: W, height: H, buttons: b.map((x) => ({ ...x, action: x.kind === 'disabled' ? null : ({ t: 'custom' } as const) })), texts: t }
  }

  /** the option grid of the current tab + section; actions are filled in by `act` */
  private content(b: PanelButton[], t: PanelText[], y0: number): void {
    const pad = 24
    const sec = this.section[this.tab]
    const grid = (items: Array<{ id: string; label: string; swatch?: string; selected?: boolean }>, idOf: (i: string) => string, y: number, cols = 5): number => {
      const w = (1024 - 2 * pad - 8 * (cols - 1)) / cols
      items.forEach((it, i) => b.push({ id: idOf(it.id), x: pad + (i % cols) * (w + 8), y: y + Math.floor(i / cols) * 72, w, h: 64, label: it.label, kind: 'neutral', action: null, swatch: it.swatch, selected: it.selected, size: it.label.length > 14 ? 17 : 20 }))
      return y + Math.ceil(items.length / cols) * 72
    }
    const roleGrid = (key: string, y: number): number => {
      const def = ROLE_OPTIONS[key]
      const cur = this.store.state.roles[key]
      const has = this.applier.hasRole(key)
      t.push({ x: pad, y: y + 22, text: `${def.label}${has ? '' : ' - this house has none of these'}`, size: 21, weight: 600, color: has ? '#f3efe6' : '#8d897d' })
      const items = [{ id: 'original', label: 'Original', swatch: undefined as string | undefined, selected: cur === undefined }, ...def.options.filter((o) => o.id !== 'original').map((o) => ({ id: o.id, label: o.label, swatch: o.swatch, selected: cur === o.id }))]
      return grid(items, (i) => `cu:role:${key}:${i}`, y + 34)
    }
    switch (this.tab) {
      case 'interior': grid(PALETTES.map((p) => ({ id: p.id, label: p.label, swatch: p.swatches[0] })), (i) => `cu:palette:${i}`, y0, 4); break
      case 'exterior': roleGrid(sec, y0); break
      case 'walls': {
        const cur = this.roomsVal((r) => r?.wall)
        if (sec === 'paint') grid(WALL_PAINTS.map((p) => ({ id: p.id, label: p.label, swatch: p.swatch, selected: cur?.color === p.swatch && !cur.material })), (i) => `cu:wallColor:${i}`, y0, 5)
        else if (sec === 'finish') {
          t.push({ x: pad, y: y0 + 22, text: 'Paint finish (applies to painted walls)', size: 21, color: '#f3efe6' })
          grid(PAINT_FINISHES.map((p) => ({ id: p.id, label: p.label, selected: (cur?.finish ?? 'matte') === p.id })), (i) => `cu:wallFinish:${i}`, y0 + 34, 3)
        } else if (sec === 'material') grid(WALL_MATERIALS.map((m) => ({ id: m.id, label: m.label, swatch: m.swatch, selected: cur?.material === m.id })), (i) => `cu:wallMaterial:${i}`, y0, 4)
        else {
          const acc = this.roomsVal((r) => r?.accent)
          t.push({ x: pad, y: y0 + 22, text: 'Which wall is the accent wall', size: 21, color: '#f3efe6' })
          const sides: Array<WallSide | 'none'> = ['N', 'E', 'S', 'W', 'none']
          const y1 = grid(sides.map((s) => ({ id: s, label: s === 'none' ? 'None' : sideLabel[s], selected: s === 'none' ? !acc : acc?.side === s })), (i) => `cu:accentSide:${i}`, y0 + 34, 5)
          t.push({ x: pad, y: y1 + 22, text: 'Accent colour', size: 21, color: '#f3efe6' })
          grid(WALL_PAINTS.map((p) => ({ id: p.id, label: p.label, swatch: p.swatch, selected: acc?.color === p.swatch })), (i) => `cu:accentColor:${i}`, y1 + 34, 5)
        }
        break
      }
      case 'flooring': {
        const cur = this.roomsVal((r) => r?.floor)
        const y1 = grid(FLOOR_OPTIONS.filter((f) => f.group === sec).map((f) => ({ id: f.id, label: f.label, swatch: f.swatch, selected: cur?.id === f.id })), (i) => `cu:floor:${i}`, y0, 5)
        t.push({ x: pad, y: y1 + 22, text: 'Floor finish', size: 21, color: '#f3efe6' })
        grid(SURFACE_FINISHES.map((f) => ({ id: f.id, label: f.label, selected: (cur?.finish ?? 'satin') === f.id })), (i) => `cu:floorFinish:${i}`, y1 + 34, 3)
        break
      }
      case 'ceiling': {
        const cur = this.roomsVal((r) => r?.ceiling)
        if (sec === 'color') grid(CEILING_COLORS.map((c) => ({ id: c.id, label: c.label, swatch: c.swatch, selected: cur?.color === c.swatch })), (i) => `cu:ceilColor:${i}`, y0, 5)
        else grid(CEILING_FINISHES.map((f) => ({ id: f.id, label: f.label, selected: (cur?.finish ?? 'matte') === f.id })), (i) => `cu:ceilFinish:${i}`, y0, 3)
        t.push({ x: pad, y: 760 - 130, text: 'Ceiling shape (cove light, slats, beams) is part of the build: change it in the 3D design studio.', size: 17, color: '#8d897d' })
        break
      }
      case 'doors': case 'furniture': case 'decor': roleGrid(sec, y0); break
      case 'history': {
        const i = this.info
        const lines = [
          `${i.changes} customisation${i.changes === 1 ? '' : 's'} on top of the original design.`,
          i.hasSaved ? (i.unsaved ? 'A saved design exists; you have changes since the last save.' : 'Everything is saved.') : 'Nothing saved yet.',
          'Undo / Redo step through your changes. Reset all returns to the original generated design and can itself be undone.',
          'Save keeps the design in this browser and with the project, so it is the same on desktop and in VR.',
        ]
        lines.forEach((l, k) => t.push({ x: pad, y: y0 + 30 + k * 34, text: l, size: 21, color: '#e6e2d6' }))
        t.push({ x: pad, y: y0 + 290, text: 'Lighting', size: 21, weight: 600, color: '#f3efe6' })
        const cur = this.lighting?.get()
        b.push({ id: 'cu:lighting:day', x: pad, y: y0 + 304, w: 220, h: 56, label: 'DAYLIGHT', kind: 'neutral', action: null, size: 22, selected: cur === 'day' })
        b.push({ id: 'cu:lighting:evening', x: pad + 232, y: y0 + 304, w: 220, h: 56, label: 'EVENING', kind: 'neutral', action: null, size: 22, selected: cur === 'evening' })
        b.push({ id: 'cu:forget', x: pad, y: y0 + 190, w: 300, h: 56, label: 'DELETE SAVED DESIGN', kind: this.store.hasSaved ? 'danger' : 'disabled', action: null, size: 20 })
        break
      }
    }
  }

  /** button id -> action (the layout is built with ids only, so both panels route through here) */
  actionFor(id: string): CustomAction | null {
    if (!id.startsWith('cu:')) return null
    const [, kind, a, b] = id.split(':')
    const asStr = (s: string | undefined) => s ?? ''
    switch (kind) {
      case 'tab': return { t: 'tab', tab: a as CustomTab }
      case 'sec': return { t: 'section', id: a }
      case 'prev': return { t: 'step', delta: -1 }
      case 'next': return { t: 'step', delta: 1 }
      case 'all': return { t: 'target', key: 'all' }
      case 'target': return null
      case 'resetroom': return { t: 'resetRoom' }
      case 'wallColor': return { t: 'wallColor', id: asStr(a) }
      case 'wallFinish': return { t: 'wallFinish', id: a as PaintFinish }
      case 'wallMaterial': return { t: 'wallMaterial', id: asStr(a) }
      case 'accentSide': return { t: 'accentSide', side: a === 'none' ? null : (a as WallSide) }
      case 'accentColor': return { t: 'accentColor', id: asStr(a) }
      case 'floor': return { t: 'floor', id: asStr(a) }
      case 'floorFinish': return { t: 'floorFinish', id: a as SurfaceFinish }
      case 'ceilColor': return { t: 'ceilColor', id: asStr(a) }
      case 'ceilFinish': return { t: 'ceilFinish', id: a as 'matte' | 'satin' }
      case 'role': return { t: 'role', key: asStr(a), id: b === 'original' ? null : asStr(b) }
      case 'palette': return { t: 'palette', id: asStr(a) }
      case 'undo': case 'redo': case 'reset': case 'save': case 'restore': case 'forget': return { t: kind }
      case 'close': return { t: 'close' }
      case 'lighting': return { t: 'lighting', id: a as 'day' | 'evening' }
      default: return null
    }
  }
  /** run a button of layout() by id; returns whether something happened */
  press(id: string): boolean { const a = this.actionFor(id); return a ? this.perform(a) : false }

  dispose(): void { this.unsub(); this.applier.dispose() }
}
