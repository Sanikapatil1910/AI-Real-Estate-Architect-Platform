/**
 * What the person can choose.  Every entry is implemented by the applier (src/custom/apply.ts): a wall / floor / ceiling entry becomes a real surface material
 * (the same procedural textures the house is built with), a role entry swaps the finish of one family of objects (all interior doors, all sofas, ...).
 */
import { CHOICES } from '../components/twinThemes'
import type { Surface, Finish } from '../components/twinMaterials'
import type { CustomState, RoomCustom, PaintFinish, SurfaceFinish } from './types'
import { emptyState } from './types'

export interface Option { id: string; label: string; swatch: string }
export type FloorOption = Option & { group: 'Wood' | 'Marble' | 'Granite' | 'Ceramic' | 'Stone'; s: (f: Finish) => Surface }
export type WallMaterial = Option & { s: Surface }

const ch = (id: string) => CHOICES.floor.find((f) => f.id === id)!
const fromTheme = (id: string, group: FloorOption['group'], label?: string): FloorOption => { const f = ch(id); return { id: f.id, label: label ?? f.label, swatch: f.swatch, group, s: f.s } }

export const FLOOR_OPTIONS: FloorOption[] = [
  fromTheme('oak_light', 'Wood'), fromTheme('oak_warm', 'Wood'), fromTheme('walnut', 'Wood'), fromTheme('teak', 'Wood'), fromTheme('rosewood', 'Wood'),
  fromTheme('marble_white', 'Marble'), fromTheme('marble_gold', 'Marble'), fromTheme('marble_dark', 'Marble'), fromTheme('travertine', 'Marble'),
  { id: 'granite_black', label: 'Black granite', swatch: '#2a2c30', group: 'Granite', s: (f) => ({ kind: 'granite', granite: { base: [36, 38, 42], speck: [150, 152, 158], speck2: [90, 92, 98], density: 0.16, tileFt: 2 }, finish: f }) },
  { id: 'granite_grey', label: 'Grey granite', swatch: '#8c8d90', group: 'Granite', s: (f) => ({ kind: 'granite', granite: { base: [138, 140, 142], speck: [60, 62, 66], speck2: [214, 214, 214], density: 0.2, tileFt: 2 }, finish: f }) },
  { id: 'granite_rose', label: 'Rose granite', swatch: '#b98c82', group: 'Granite', s: (f) => ({ kind: 'granite', granite: { base: [186, 140, 130], speck: [120, 82, 76], speck2: [236, 214, 206], density: 0.18, tileFt: 2 }, finish: f }) },
  fromTheme('tile_grey', 'Ceramic', 'Grey ceramic'), fromTheme('terracotta', 'Ceramic', 'Terracotta ceramic'),
  { id: 'ceramic_white', label: 'White ceramic', swatch: '#f0efec', group: 'Ceramic', s: (f) => ({ kind: 'tile', tile: { color: [240, 240, 237], grout: [200, 200, 196], tileFt: 2, vary: 0.03 }, finish: f }) },
  { id: 'ceramic_cream', label: 'Cream ceramic', swatch: '#e6dcc4', group: 'Ceramic', s: (f) => ({ kind: 'tile', tile: { color: [230, 220, 196], grout: [190, 180, 156], tileFt: 2, vary: 0.04 }, finish: f }) },
  fromTheme('kota', 'Stone'), fromTheme('concrete', 'Stone'),
]
export const floorOption = (id: string): FloorOption | undefined => FLOOR_OPTIONS.find((f) => f.id === id)

export const WALL_MATERIALS: WallMaterial[] = [
  { id: 'wood_panel', label: 'Wood panelling', swatch: '#a9774c', s: { kind: 'plank', plank: { tone: [170, 122, 80], tileFt: 4, plankFt: 0.5, lenFt: 4, vary: 0.1, seam: 1.3, vertical: true }, finish: 'satin' } },
  { id: 'stone_wall', label: 'Stone cladding', swatch: '#cdb899', s: { kind: 'stone', stone: { color: [198, 178, 146] } } },
  { id: 'brick_wall', label: 'Brick', swatch: '#a4604a', s: { kind: 'brick', brick: { color: [164, 96, 74] } } },
  { id: 'concrete_wall', label: 'Concrete', swatch: '#9b9a97', s: { kind: 'concrete', concrete: { color: [150, 149, 146], panels: true }, finish: 'matte' } },
]
export const wallMaterial = (id: string): WallMaterial | undefined => WALL_MATERIALS.find((w) => w.id === id)

export const WALL_PAINTS: Option[] = CHOICES.wallColor.map((c) => ({ id: c.id, label: c.label, swatch: c.swatch }))
export const CEILING_COLORS: Option[] = [
  { id: 'c_white', label: 'White', swatch: '#f6f4f0' }, { id: 'c_ivory', label: 'Ivory', swatch: '#f2ead6' }, { id: 'c_cream', label: 'Cream', swatch: '#ecdfc4' },
  { id: 'c_grey', label: 'Light grey', swatch: '#d9d9d6' }, { id: 'c_sky', label: 'Pale blue', swatch: '#dbe6ee' }, { id: 'c_sand', label: 'Sand', swatch: '#e2cfa6' },
]
export const PAINT_FINISHES: Array<{ id: PaintFinish; label: string }> = [{ id: 'matte', label: 'Matte' }, { id: 'satin', label: 'Satin' }, { id: 'textured', label: 'Textured' }]
export const SURFACE_FINISHES: Array<{ id: SurfaceFinish; label: string }> = [{ id: 'matte', label: 'Matte' }, { id: 'satin', label: 'Satin' }, { id: 'gloss', label: 'Gloss' }]
export const CEILING_FINISHES: Array<{ id: 'matte' | 'satin'; label: string }> = [{ id: 'matte', label: 'Matte' }, { id: 'satin', label: 'Satin' }]

/** rug tints (the rug's own pattern is kept: a tint multiplies it) and gate finishes */
export const RUG_TINTS: Option[] = [
  { id: 'original', label: 'Original', swatch: '#ffffff' }, { id: 'warm', label: 'Warm', swatch: '#f0c8a0' }, { id: 'cool', label: 'Cool', swatch: '#a8c4e0' },
  { id: 'sage', label: 'Sage', swatch: '#b5c9a8' }, { id: 'rose', label: 'Rose', swatch: '#e0a8a8' }, { id: 'charcoal', label: 'Charcoal', swatch: '#6a6c70' },
]
export const GATE_FINISHES: Option[] = [
  { id: 'original', label: 'Original', swatch: '#ffffff' }, { id: 'black', label: 'Matte black', swatch: '#25272b' }, { id: 'bronze', label: 'Bronze', swatch: '#5a4636' },
  { id: 'white', label: 'White', swatch: '#f1efea' }, { id: 'green', label: 'Forest green', swatch: '#2f4a3a' }, { id: 'navy', label: 'Navy', swatch: '#2f405a' },
]
export const TINT_HEX: Record<string, number> = { original: 0xffffff, warm: 0xf0c8a0, cool: 0xa8c4e0, sage: 0xb5c9a8, rose: 0xe0a8a8, charcoal: 0x6a6c70 }
export const GATE_HEX: Record<string, number> = { black: 0x25272b, bronze: 0x5a4636, white: 0xf1efea, green: 0x2f4a3a, navy: 0x2f405a }

/** the design-studio override keys a role tab offers (each id list is the studio's own, so the same names mean the same finish everywhere) */
const list = (k: keyof typeof CHOICES): Option[] => (CHOICES[k] as Option[]).map((c) => ({ id: c.id, label: c.label, swatch: c.swatch }))
export const ROLE_OPTIONS: Record<string, { label: string; options: Option[] }> = {
  door: { label: 'Interior and main doors', options: list('door') },
  windowFrame: { label: 'Window frames', options: list('windowFrame') },
  furnWood: { label: 'Wooden furniture', options: list('furnWood') },
  upholstery: { label: 'Sofas and chairs', options: list('upholstery') },
  cabinets: { label: 'Kitchen cabinets', options: list('cabinets') },
  counter: { label: 'Kitchen counter', options: list('counter') },
  bathTile: { label: 'Bathroom tile', options: list('bathTile') },
  fixtures: { label: 'Taps and fixtures', options: list('fixtures') },
  curtains: { label: 'Curtains', options: list('curtains') },
  rugs: { label: 'Rugs', options: RUG_TINTS },
  facadeFinish: { label: 'Outer wall finish', options: list('facadeFinish') },
  facadeColor: { label: 'Outer wall colour', options: list('facadeColor') },
  trim: { label: 'Trim and cornices', options: list('trim') },
  railing: { label: 'Railings', options: list('railing') },
  gate: { label: 'Gate', options: GATE_FINISHES },
}

/** a ready-made look for the whole house: walls, floors and ceilings of every room + door / frame / furniture / outer colours, applied as ONE undoable step */
export interface PaletteRoom { key: string; type: string }
export interface Palette { id: string; label: string; swatches: string[]; build: (rooms: PaletteRoom[]) => CustomState }
const BED = new Set(['bedroom', 'master_bedroom', 'guest_room', 'kids_room'])
const WET = new Set(['bathroom', 'toilet', 'kitchen', 'utility', 'laundry'])
function palette(id: string, label: string, swatches: string[], wall: string, bed: string, floor: string, wetFloor: string, ceil: string, roles: Record<string, string>): Palette {
  return {
    id, label, swatches,
    build: (rooms) => {
      const s = emptyState()
      s.roles = { ...roles }
      for (const r of rooms) {
        if (!isIndoor(r.type)) continue
        const rc: RoomCustom = { wall: { color: BED.has(r.type) ? bed : wall, finish: 'matte' }, floor: { id: WET.has(r.type) ? wetFloor : floor, finish: 'satin' }, ceiling: { color: ceil, finish: 'matte' } }
        s.rooms[r.key] = rc
      }
      return s
    },
  }
}
const isIndoor = (t: string) => !['staircase', 'balcony', 'open_terrace', 'courtyard', 'parking', 'bike_parking', 'garden', 'terrace', 'lift'].includes(t)
export const PALETTES: Palette[] = [
  palette('warm_classic', 'Warm classic', ['#f0e6d0', '#e8cfc5', '#b07c4e'], '#f0e6d0', '#e8cfc5', 'oak_warm', 'ceramic_cream', '#f2ead6', { door: 'walnut', windowFrame: 'white', furnWood: 'walnut', upholstery: 'camel', facadeColor: 'cream' }),
  palette('cool_modern', 'Cool modern', ['#d3e0e9', '#d5cdc0', '#8c8d90'], '#d5cdc0', '#d3e0e9', 'granite_grey', 'ceramic_white', '#f6f4f0', { door: 'grey', windowFrame: 'black', furnWood: 'ash', upholstery: 'stone', facadeColor: 'grey' }),
  palette('luxury_marble', 'Luxury marble', ['#f4ebd4', '#e0c88e', '#f2ede2'], '#f4ebd4', '#e0c88e', 'marble_gold', 'marble_white', '#f6f4f0', { door: 'white', windowFrame: 'bronze', furnWood: 'ebony', upholstery: 'ivory', facadeColor: 'warm_white', trim: 'bronze' }),
  palette('earthy_terracotta', 'Earthy terracotta', ['#d4a086', '#e2cfa6', '#b06a4a'], '#e2cfa6', '#d4a086', 'terracotta', 'terracotta', '#ecdfc4', { door: 'teak', windowFrame: 'rosewood', furnWood: 'teak', upholstery: 'terracotta', facadeColor: 'terracotta' }),
]
