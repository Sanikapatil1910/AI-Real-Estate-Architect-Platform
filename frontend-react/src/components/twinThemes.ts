import * as THREE from 'three'
import { metal, rgb, solid, surface } from './twinMaterials'
import type { Finish, Rgb, Surface } from './twinMaterials'
import { STYLES } from './twinStyles'
import type { StyleDef, StyleId } from './twinStyles'

/**
 * Design themes for the digital twin.
 *
 * A theme only chooses finishes: floor / wall / ceiling materials, furniture colours, kitchen, bathroom, doors, windows,
 * curtains, lighting and the outside finishes.  It never touches a coordinate: rooms, walls, openings and the furniture layout
 * come from the plan alone, so changing a theme (or any single control) cannot move a wall or make the 3D disagree with the plan.
 */

export type ThemeId = 'wood_classic' | 'colorful_modern' | 'luxury_marble' | 'modern_luxury' | 'scandinavian' | 'industrial' | 'premium_contemporary'
  | 'traditional_rosewood' | 'traditional_teak' | 'wada_ochre' | 'wada_terracotta' | 'wada_cream'
export type Time = 'day' | 'evening'
export type CeilingStyle = 'flat' | 'cove' | 'slats' | 'beams'
export type WallFinish = 'matte' | 'satin' | 'textured'

/** What the person can change on top of a theme.  `undefined` = the theme's own choice. */
export interface Overrides {
  floor?: string; floorFinish?: Finish
  wallColor?: string; wallFinish?: WallFinish
  ceiling?: CeilingStyle
  furnWood?: string; upholstery?: string
  cabinets?: string; counter?: string
  bathTile?: string; fixtures?: string
  door?: string; windowFrame?: string; curtains?: string
  facadeFinish?: string; facadeColor?: string; trim?: string; railing?: string
  landscaping?: boolean; extLights?: boolean
}
/** `style` is the architectural style (Modern Minimalistic / Traditional Indian / Maharashtrian Wada); the theme is one of the palettes that style offers. */
export interface Design { style: StyleId; theme: ThemeId; over: Overrides; time: Time }
export const DEFAULT_DESIGN: Design = { style: 'modern_minimalistic', theme: 'wood_classic', over: {}, time: 'day' }
/** The design a style starts from (its first palette, no customisation); the time of day is kept. */
export const designForStyle = (style: StyleId, time: Time = 'day'): Design => ({ style, theme: STYLES[style].themes[0], over: {}, time })

/* ------------------------------------------------------------------ choices offered in the UI (each one is implemented) */
export interface Choice<T = string> { id: T; label: string; swatch: string }
const sw = (n: number) => '#' + n.toString(16).padStart(6, '0')

const OAK_LIGHT: Rgb = [222, 194, 156]
const OAK_WARM: Rgb = [172, 128, 88]
const WALNUT: Rgb = [92, 62, 44]
const ASH: Rgb = [214, 196, 168]
const EBONY: Rgb = [58, 46, 40]
const TEAK: Rgb = [150, 104, 64]

export const FLOORS: Array<Choice & { s: (f: Finish) => Surface }> = [
  { id: 'oak_light', label: 'Light oak', swatch: sw(0xe2c092), s: (f) => ({ kind: 'plank', plank: { tone: OAK_LIGHT, vary: 0.1 }, finish: f }) },
  { id: 'oak_warm', label: 'Warm oak', swatch: sw(0xb07c4e), s: (f) => ({ kind: 'plank', plank: { tone: OAK_WARM }, finish: f }) },
  { id: 'walnut', label: 'Walnut', swatch: sw(0x5c3e2c), s: (f) => ({ kind: 'plank', plank: { tone: WALNUT, vary: 0.12 }, finish: f }) },
  { id: 'marble_white', label: 'White marble', swatch: sw(0xf0efec), s: (f) => ({ kind: 'marble', marble: { base: [240, 239, 236], vein: [118, 122, 130], veinAmt: 0.9, seed: 3 }, finish: f }) },
  { id: 'marble_gold', label: 'Gold-vein marble', swatch: sw(0xf2ede2), s: (f) => ({ kind: 'marble', marble: { base: [244, 240, 232], vein: [178, 148, 104], veinAmt: 1, seed: 8 }, finish: f }) },
  { id: 'marble_dark', label: 'Dark marble', swatch: sw(0x6a4e3e), s: (f) => ({ kind: 'marble', marble: { base: [104, 78, 62], vein: [220, 200, 170], veinAmt: 0.8, seed: 12 }, finish: f }) },
  { id: 'travertine', label: 'Travertine', swatch: sw(0xd8c8a8), s: (f) => ({ kind: 'marble', marble: { base: [222, 207, 178], vein: [190, 168, 134], veinAmt: 0.55, slabFt: 2, seed: 20, scale: 1.6 }, finish: f }) },
  { id: 'concrete', label: 'Polished concrete', swatch: sw(0x9b9a97), s: (f) => ({ kind: 'concrete', concrete: { color: [150, 149, 146], panels: true }, finish: f }) },
  { id: 'tile_grey', label: 'Grey porcelain', swatch: sw(0xb4b6b8), s: (f) => ({ kind: 'tile', tile: { color: [176, 178, 180], grout: [140, 142, 144], tileFt: 2 }, finish: f }) },
  { id: 'teak', label: 'Teak plank', swatch: sw(0x8a5c38), s: (f) => ({ kind: 'plank', plank: { tone: [138, 92, 58], vary: 0.1, plankFt: 0.5 }, finish: f }) },
  { id: 'rosewood', label: 'Rosewood plank', swatch: sw(0x603826), s: (f) => ({ kind: 'plank', plank: { tone: [98, 58, 40], vary: 0.1, plankFt: 0.5 }, finish: f }) },
  { id: 'terracotta', label: 'Terracotta tile', swatch: sw(0xb06a4a), s: (f) => ({ kind: 'tile', tile: { color: [176, 106, 76], grout: [128, 84, 64], tileFt: 1, vary: 0.1 }, finish: f }) },
  { id: 'kota', label: 'Kota stone', swatch: sw(0x7e8a7c), s: (f) => ({ kind: 'tile', tile: { color: [118, 130, 116], grout: [88, 98, 88], tileFt: 2, vary: 0.07 }, finish: f }) },
  { id: 'stone_ochre', label: 'Ochre stone', swatch: sw(0xc9a46a), s: (f) => ({ kind: 'tile', tile: { color: [201, 164, 106], grout: [150, 120, 80], tileFt: 2, vary: 0.08 }, finish: f }) },
  { id: 'stone_cream', label: 'Cream stone', swatch: sw(0xddd0b0), s: (f) => ({ kind: 'tile', tile: { color: [221, 208, 176], grout: [172, 158, 128], tileFt: 2, vary: 0.07 }, finish: f }) },
  { id: 'coded', label: 'Colour-coded rooms', swatch: sw(0xe0d6b8), s: () => ({ kind: 'solid', color: 0xdddddd, rough: 0.9 }) },
]

const WALL_COLORS: Array<Choice & { c: number }> = [
  { id: 'white', label: 'White', swatch: sw(0xf4f2ee), c: 0xf4f2ee },
  { id: 'cream', label: 'Cream', swatch: sw(0xf0e6d0), c: 0xf0e6d0 },
  { id: 'beige', label: 'Beige', swatch: sw(0xe3d3b8), c: 0xe3d3b8 },
  { id: 'greige', label: 'Greige', swatch: sw(0xd5cdc0), c: 0xd5cdc0 },
  { id: 'sage', label: 'Sage', swatch: sw(0xcad6c3), c: 0xcad6c3 },
  { id: 'sky', label: 'Sky', swatch: sw(0xd3e0e9), c: 0xd3e0e9 },
  { id: 'blush', label: 'Blush', swatch: sw(0xe8cfc5), c: 0xe8cfc5 },
  { id: 'terracotta', label: 'Terracotta', swatch: sw(0xd4a086), c: 0xd4a086 },
  { id: 'charcoal', label: 'Charcoal', swatch: sw(0x55585d), c: 0x55585d },
  { id: 'navy', label: 'Navy', swatch: sw(0x44546b), c: 0x44546b },
  { id: 'ivory', label: 'Ivory', swatch: sw(0xf4ebd4), c: 0xf4ebd4 },
  { id: 'muted_gold', label: 'Muted gold', swatch: sw(0xe0c88e), c: 0xe0c88e },
  { id: 'sandstone', label: 'Sandstone', swatch: sw(0xe2cfa6), c: 0xe2cfa6 },
  { id: 'ochre', label: 'Ochre', swatch: sw(0xe0b66a), c: 0xe0b66a },
  { id: 'muted_red', label: 'Muted red', swatch: sw(0xc98a76), c: 0xc98a76 },
]

const WOODS: Array<Choice & { t: Rgb }> = [
  { id: 'oak', label: 'Oak', swatch: sw(0xc89c68), t: [200, 156, 104] },
  { id: 'walnut', label: 'Walnut', swatch: sw(0x6a4630), t: [108, 72, 50] },
  { id: 'teak', label: 'Teak', swatch: sw(0x966840), t: TEAK },
  { id: 'ash', label: 'Ash', swatch: sw(0xd6c4a8), t: ASH },
  { id: 'ebony', label: 'Ebony', swatch: sw(0x3a2e28), t: EBONY },
  { id: 'rosewood', label: 'Rosewood', swatch: sw(0x5a2e1e), t: [92, 48, 32] },
]

const UPHOLSTERY: Array<Choice & { c: number }> = [
  { id: 'stone', label: 'Stone grey', swatch: sw(0x9a9a98), c: 0x9a9a98 },
  { id: 'oatmeal', label: 'Oatmeal', swatch: sw(0xd8ccb4), c: 0xd8ccb4 },
  { id: 'camel', label: 'Camel', swatch: sw(0xb08a5e), c: 0xb08a5e },
  { id: 'sage', label: 'Sage', swatch: sw(0x8ea58a), c: 0x8ea58a },
  { id: 'navy', label: 'Navy', swatch: sw(0x34455f), c: 0x34455f },
  { id: 'teal', label: 'Teal', swatch: sw(0x2f7f86), c: 0x2f7f86 },
  { id: 'terracotta', label: 'Terracotta', swatch: sw(0xb8664a), c: 0xb8664a },
  { id: 'charcoal', label: 'Charcoal', swatch: sw(0x44474c), c: 0x44474c },
  { id: 'ivory', label: 'Ivory', swatch: sw(0xeadfc6), c: 0xeadfc6 },
  { id: 'muted_gold', label: 'Muted gold', swatch: sw(0xcaa660), c: 0xcaa660 },
  { id: 'maroon', label: 'Maroon', swatch: sw(0x7a2f2c), c: 0x7a2f2c },
]

const CABINETS: Array<Choice & { s: Surface }> = [
  { id: 'white', label: 'White', swatch: sw(0xf1efea), s: { kind: 'solid', color: 0xf1efea, rough: 0.5 } },
  { id: 'cream', label: 'Cream', swatch: sw(0xe8dcc4), s: { kind: 'solid', color: 0xe8dcc4, rough: 0.5 } },
  { id: 'oak', label: 'Oak', swatch: sw(0xc59a66), s: { kind: 'plank', plank: { tone: [200, 156, 104], tileFt: 2, plankFt: 1, lenFt: 4, seam: 0, vary: 0.04 }, finish: 'satin' } },
  { id: 'walnut', label: 'Walnut', swatch: sw(0x6a4630), s: { kind: 'plank', plank: { tone: [102, 68, 48], tileFt: 2, plankFt: 1, lenFt: 4, seam: 0, vary: 0.04 }, finish: 'satin' } },
  { id: 'graphite', label: 'Graphite', swatch: sw(0x383b40), s: { kind: 'solid', color: 0x383b40, rough: 0.45 } },
  { id: 'sage', label: 'Sage', swatch: sw(0x8da38a), s: { kind: 'solid', color: 0x8da38a, rough: 0.5 } },
  { id: 'navy', label: 'Navy', swatch: sw(0x2f405a), s: { kind: 'solid', color: 0x2f405a, rough: 0.5 } },
  { id: 'teak', label: 'Teak', swatch: sw(0x8a5c38), s: { kind: 'plank', plank: { tone: [138, 92, 58], tileFt: 2, plankFt: 1, lenFt: 4, seam: 0, vary: 0.05 }, finish: 'satin' } },
  { id: 'rosewood', label: 'Rosewood', swatch: sw(0x5a3322), s: { kind: 'plank', plank: { tone: [92, 54, 38], tileFt: 2, plankFt: 1, lenFt: 4, seam: 0, vary: 0.05 }, finish: 'satin' } },
]

const COUNTERS: Array<Choice & { s: Surface }> = [
  { id: 'granite_black', label: 'Black granite', swatch: sw(0x2a2c30), s: { kind: 'granite', granite: { base: [36, 38, 42], speck: [150, 152, 158], speck2: [90, 92, 98], density: 0.16 }, finish: 'gloss' } },
  { id: 'granite_grey', label: 'Grey granite', swatch: sw(0x8c8d90), s: { kind: 'granite', granite: { base: [138, 140, 142], speck: [60, 62, 66], speck2: [214, 214, 214], density: 0.2 }, finish: 'gloss' } },
  { id: 'quartz_white', label: 'White quartz', swatch: sw(0xeeeeec), s: { kind: 'granite', granite: { base: [238, 238, 236], speck: [196, 198, 200], speck2: [255, 255, 255], density: 0.06 }, finish: 'satin' } },
  { id: 'marble_white', label: 'White marble', swatch: sw(0xf0efec), s: { kind: 'marble', marble: { base: [244, 243, 240], vein: [120, 124, 132], veinAmt: 0.9, slabFt: 4, seed: 31 }, finish: 'gloss' } },
  { id: 'butcher', label: 'Butcher block', swatch: sw(0xc59a66), s: { kind: 'plank', plank: { tone: [196, 150, 98], tileFt: 2, plankFt: 0.2, lenFt: 2, vary: 0.07, seam: 0.5 }, finish: 'satin' } },
  { id: 'concrete', label: 'Concrete', swatch: sw(0x9a9996), s: { kind: 'concrete', concrete: { color: [150, 149, 146] }, finish: 'satin' } },
  { id: 'kota', label: 'Kota stone', swatch: sw(0x5c6a5a), s: { kind: 'granite', granite: { base: [88, 100, 86], speck: [140, 150, 136], speck2: [60, 70, 58], density: 0.12 }, finish: 'satin' } },
  { id: 'limestone', label: 'Cream limestone', swatch: sw(0xe3d6b8), s: { kind: 'marble', marble: { base: [228, 216, 188], vein: [196, 180, 148], veinAmt: 0.35, slabFt: 4, seed: 52 }, finish: 'satin' } },
]

const BATH_TILES: Array<Choice & { s: Surface }> = [
  { id: 'white_subway', label: 'White subway', swatch: sw(0xf4f4f2), s: { kind: 'tile', tile: { color: [244, 244, 242], grout: [190, 190, 186], tileFt: 0.5, pattern: 'subway', sheetFt: 2, vary: 0.02 }, finish: 'gloss' } },
  { id: 'grey_large', label: 'Grey large format', swatch: sw(0x9a9c9e), s: { kind: 'tile', tile: { color: [150, 152, 154], grout: [112, 114, 116], tileFt: 2, vary: 0.04 }, finish: 'satin' } },
  { id: 'beige_stone', label: 'Beige stone', swatch: sw(0xd0c0a6), s: { kind: 'tile', tile: { color: [210, 194, 168], grout: [170, 156, 134], tileFt: 1, vary: 0.07 }, finish: 'satin' } },
  { id: 'green_mosaic', label: 'Green mosaic', swatch: sw(0x5c8270), s: { kind: 'tile', tile: { color: [92, 130, 112], grout: [60, 80, 70], tileFt: 0.15, pattern: 'mosaic', sheetFt: 1.2, vary: 0.12 }, finish: 'gloss' } },
  { id: 'black_matte', label: 'Black matte', swatch: sw(0x2a2c30), s: { kind: 'tile', tile: { color: [42, 44, 48], grout: [24, 26, 28], tileFt: 1, vary: 0.04 }, finish: 'matte' } },
  { id: 'marble', label: 'Marble', swatch: sw(0xf0efec), s: { kind: 'marble', marble: { base: [244, 243, 240], vein: [130, 134, 140], veinAmt: 0.8, slabFt: 2, seed: 41 }, finish: 'gloss' } },
  { id: 'earth_terracotta', label: 'Earthy terracotta', swatch: sw(0xb67852), s: { kind: 'tile', tile: { color: [182, 120, 82], grout: [136, 98, 72], tileFt: 1, vary: 0.09 }, finish: 'satin' } },
  { id: 'sand_stone', label: 'Sand stone', swatch: sw(0xd9c6a2), s: { kind: 'tile', tile: { color: [216, 198, 162], grout: [172, 154, 124], tileFt: 1, vary: 0.08 }, finish: 'matte' } },
]

const FIXTURES: Array<Choice & { c: number; m: number }> = [
  { id: 'chrome', label: 'Chrome', swatch: sw(0xd5dadc), c: 0xd5dadc, m: 0.18 },
  { id: 'black', label: 'Matte black', swatch: sw(0x23262a), c: 0x23262a, m: 0.4 },
  { id: 'brass', label: 'Brushed brass', swatch: sw(0xc8a45c), c: 0xc8a45c, m: 0.3 },
]

const DOORS: Array<Choice & { s: Surface }> = [
  { id: 'oak', label: 'Oak', swatch: sw(0xc09060), s: { kind: 'plank', plank: { tone: [190, 140, 92], tileFt: 2, plankFt: 1, lenFt: 4, seam: 0, vary: 0.04, vertical: true }, finish: 'satin' } },
  { id: 'walnut', label: 'Walnut', swatch: sw(0x5c3e2c), s: { kind: 'plank', plank: { tone: [96, 64, 46], tileFt: 2, plankFt: 1, lenFt: 4, seam: 0, vary: 0.04, vertical: true }, finish: 'satin' } },
  { id: 'white', label: 'White', swatch: sw(0xf3f1ec), s: { kind: 'solid', color: 0xf3f1ec, rough: 0.5 } },
  { id: 'grey', label: 'Slate grey', swatch: sw(0x6c7075), s: { kind: 'solid', color: 0x6c7075, rough: 0.5 } },
  { id: 'black', label: 'Black', swatch: sw(0x25272b), s: { kind: 'solid', color: 0x25272b, rough: 0.45 } },
  { id: 'teak', label: 'Teak', swatch: sw(0x8a5c38), s: { kind: 'plank', plank: { tone: [136, 90, 56], tileFt: 2, plankFt: 1, lenFt: 4, seam: 0, vary: 0.05, vertical: true }, finish: 'satin' } },
  { id: 'rosewood', label: 'Rosewood', swatch: sw(0x5a3322), s: { kind: 'plank', plank: { tone: [90, 52, 36], tileFt: 2, plankFt: 1, lenFt: 4, seam: 0, vary: 0.05, vertical: true }, finish: 'satin' } },
]

const FRAMES: Array<Choice & { c: number; m?: boolean }> = [
  { id: 'white', label: 'White', swatch: sw(0xf4f2ee), c: 0xf4f2ee },
  { id: 'black', label: 'Black steel', swatch: sw(0x23262a), c: 0x23262a, m: true },
  { id: 'bronze', label: 'Bronze', swatch: sw(0x5a4636), c: 0x5a4636, m: true },
  { id: 'wood', label: 'Timber', swatch: sw(0x9a6c44), c: 0x9a6c44 },
  { id: 'rosewood', label: 'Rosewood', swatch: sw(0x5a3322), c: 0x5a3322 },
]

const CURTAINS: Array<Choice & { c: number | null }> = [
  { id: 'off', label: 'None', swatch: '#ffffff', c: null },
  { id: 'cream', label: 'Cream', swatch: sw(0xe6dcc6), c: 0xe6dcc6 },
  { id: 'grey', label: 'Grey', swatch: sw(0xa9aaa8), c: 0xa9aaa8 },
  { id: 'sage', label: 'Sage', swatch: sw(0x9fb09a), c: 0x9fb09a },
  { id: 'navy', label: 'Navy', swatch: sw(0x3d4c68), c: 0x3d4c68 },
  { id: 'terracotta', label: 'Terracotta', swatch: sw(0xc27a5c), c: 0xc27a5c },
  { id: 'ivory', label: 'Ivory', swatch: sw(0xefe3c8), c: 0xefe3c8 },
  { id: 'maroon', label: 'Maroon', swatch: sw(0x7a3030), c: 0x7a3030 },
  { id: 'muted_gold', label: 'Muted gold', swatch: sw(0xc8a860), c: 0xc8a860 },
]

const FACADE_FINISH: Choice[] = [
  { id: 'plaster', label: 'Painted plaster', swatch: '#e9e1d2' },
  { id: 'stone', label: 'Stone cladding', swatch: '#cdb899' },
  { id: 'brick', label: 'Brick', swatch: '#a4604a' },
  { id: 'wood', label: 'Timber cladding', swatch: '#a9774c' },
]
const FACADE_COLORS: Array<Choice & { c: number }> = [
  { id: 'white', label: 'White', swatch: sw(0xf1efea), c: 0xf1efea },
  { id: 'cream', label: 'Cream', swatch: sw(0xeadcc0), c: 0xeadcc0 },
  { id: 'sand', label: 'Sand', swatch: sw(0xd9c39b), c: 0xd9c39b },
  { id: 'grey', label: 'Warm grey', swatch: sw(0xbdb8b0), c: 0xbdb8b0 },
  { id: 'terracotta', label: 'Terracotta', swatch: sw(0xcf8f72), c: 0xcf8f72 },
  { id: 'sage', label: 'Sage', swatch: sw(0xb7c4ab), c: 0xb7c4ab },
  { id: 'charcoal', label: 'Charcoal', swatch: sw(0x5b5f64), c: 0x5b5f64 },
  { id: 'blue', label: 'Dusty blue', swatch: sw(0x9db2c4), c: 0x9db2c4 },
  { id: 'ivory', label: 'Ivory', swatch: sw(0xf3ead4), c: 0xf3ead4 },
  { id: 'warm_white', label: 'Warm white', swatch: sw(0xf6f0e2), c: 0xf6f0e2 },
  { id: 'ochre', label: 'Ochre', swatch: sw(0xd9a95c), c: 0xd9a95c },
  { id: 'muted_red', label: 'Muted red', swatch: sw(0xb8705c), c: 0xb8705c },
]
const TRIMS: Array<Choice & { c: number }> = [
  { id: 'white', label: 'White', swatch: sw(0xf6f4ef), c: 0xf6f4ef },
  { id: 'charcoal', label: 'Charcoal', swatch: sw(0x3a3d42), c: 0x3a3d42 },
  { id: 'bronze', label: 'Bronze', swatch: sw(0x6b5440), c: 0x6b5440 },
  { id: 'wood', label: 'Timber', swatch: sw(0x9a6c44), c: 0x9a6c44 },
  { id: 'rosewood', label: 'Rosewood', swatch: sw(0x6a3c28), c: 0x6a3c28 },
]
const RAILINGS: Choice[] = [
  { id: 'glass', label: 'Glass', swatch: '#cfe4ec' },
  { id: 'steel', label: 'Steel', swatch: '#3a3d42' },
  { id: 'wood', label: 'Timber', swatch: '#9a6c44' },
]

export const CHOICES = {
  floor: FLOORS, wallColor: WALL_COLORS, furnWood: WOODS, upholstery: UPHOLSTERY, cabinets: CABINETS, counter: COUNTERS,
  bathTile: BATH_TILES, fixtures: FIXTURES, door: DOORS, windowFrame: FRAMES, curtains: CURTAINS,
  facadeFinish: FACADE_FINISH, facadeColor: FACADE_COLORS, trim: TRIMS, railing: RAILINGS,
  floorFinish: [{ id: 'matte', label: 'Matte', swatch: '#d8d2c6' }, { id: 'satin', label: 'Satin', swatch: '#cfc8ba' }, { id: 'gloss', label: 'Gloss', swatch: '#e9e4d8' }] as Choice[],
  wallFinish: [{ id: 'matte', label: 'Matte', swatch: '#e8e2d6' }, { id: 'satin', label: 'Satin', swatch: '#efe9de' }, { id: 'textured', label: 'Textured', swatch: '#ddd5c6' }] as Choice[],
  ceiling: [{ id: 'flat', label: 'Flat', swatch: '#f4f2ee' }, { id: 'cove', label: 'Cove light', swatch: '#fff0d4' }, { id: 'slats', label: 'Timber slats', swatch: '#b88a5c' }, { id: 'beams', label: 'Timber beams', swatch: '#6f4a30' }] as Choice[],
}

/* ------------------------------------------------------------------ themes */
export interface ThemeDef {
  id: ThemeId; label: string; blurb: string
  o: Required<Omit<Overrides, 'landscaping' | 'extLights'>> & { landscaping: boolean; extLights: boolean }
  /** feature-wall colour per room type (Colorful Modern only) */
  accents?: Record<string, number>
  /** material the wet rooms' floor uses (bathroom, kitchen, utility): a tile, not the living-area floor */
  wetFloor: Surface
  outFloor: Surface
  rug: { a: number; b: number; pattern: 'chevron' | 'diamond' | 'stripe' | 'geo' | 'plain' | 'medallion' }
  rugAlt: { a: number; b: number; pattern: 'chevron' | 'diamond' | 'stripe' | 'geo' | 'plain' | 'medallion' }
  accentA: number; accentB: number          // cushions, throws, small decor
  metalFurn: number                          // legs, handles, lamp bases
  metalKind: 'brass' | 'black' | 'chrome' | 'bronze'
  bed: { duvet: number; duvet2: number; throw: number; linen: number }
  ceilingColor: number
  lamp: number                              // lamp shade tint
  leaf: number                              // plant foliage tint 0..1 mix not used; main foliage colour
  roofFinish: Surface
  ground: number                            // lawn tint
  exteriorTone: 'warm' | 'cool' | 'neutral'
  tileColor?: Rgb                           // clay colour of the pitched tile roofs (styles with a tiled roof)
  timber?: Rgb                              // exterior timber: pillars, fascia, gate, shutters
  paving?: number                           // paving / pathway colour (heritage landscape)
}

const rgbN = (c: Rgb) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])

export const THEMES: Record<ThemeId, ThemeDef> = {
  wood_classic: {
    id: 'wood_classic', label: 'Wood Classic', blurb: 'Warm oak floors, natural timber and cosy furniture.',
    o: { floor: 'oak_warm', floorFinish: 'satin', wallColor: 'cream', wallFinish: 'matte', ceiling: 'flat', furnWood: 'teak', upholstery: 'camel', cabinets: 'oak', counter: 'granite_black',
      bathTile: 'beige_stone', fixtures: 'chrome', door: 'oak', windowFrame: 'wood', curtains: 'cream', facadeFinish: 'plaster', facadeColor: 'cream', trim: 'wood', railing: 'wood', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [196, 170, 138], grout: [150, 128, 100], tileFt: 1, vary: 0.08 }, finish: 'satin' },
    outFloor: { kind: 'tile', tile: { color: [176, 128, 100], grout: [120, 90, 70], tileFt: 1, vary: 0.1 }, finish: 'matte' },
    rug: { a: 0xe8dcc4, b: 0xc9b48e, pattern: 'chevron' }, rugAlt: { a: 0xb9553a, b: 0xe8dcc4, pattern: 'geo' },
    accentA: 0xc98a2e, accentB: 0x9c4a2f, metalFurn: 0xb08a4a, metalKind: 'brass',
    bed: { duvet: 0x8a6e52, duvet2: 0xa68a6c, throw: 0xc9b48e, linen: 0xf3eee4 }, ceilingColor: 0xf6f1e6, lamp: 0xffd9a0, leaf: 0x4d7f46,
    roofFinish: { kind: 'tile', tile: { color: [184, 120, 92], grout: [130, 90, 70], tileFt: 1, vary: 0.1 }, finish: 'matte' }, ground: 0x6c9a4a, exteriorTone: 'warm',
  },
  colorful_modern: {
    id: 'colorful_modern', label: 'Colorful Modern', blurb: 'Fresh contemporary colour with coordinated feature walls.',
    o: { floor: 'tile_grey', floorFinish: 'satin', wallColor: 'white', wallFinish: 'matte', ceiling: 'flat', furnWood: 'ash', upholstery: 'teal', cabinets: 'sage', counter: 'quartz_white',
      bathTile: 'green_mosaic', fixtures: 'chrome', door: 'white', windowFrame: 'white', curtains: 'terracotta', facadeFinish: 'plaster', facadeColor: 'sand', trim: 'white', railing: 'steel', landscaping: true, extLights: true },
    accents: { living_room: 0x2f7f86, family_lounge: 0x2f7f86, dining: 0xd9a441, master_bedroom: 0x6f8fb0, bedroom: 0xe29a86, guest_bedroom: 0x8fb08a, study: 0x7a6fa8, kitchen: 0xf0c75a, puja_room: 0xe0a23a },
    wetFloor: { kind: 'tile', tile: { color: [220, 224, 226], grout: [170, 174, 176], tileFt: 1, vary: 0.04 }, finish: 'satin' },
    outFloor: { kind: 'tile', tile: { color: [200, 120, 96], grout: [150, 90, 70], tileFt: 1, vary: 0.1 }, finish: 'matte' },
    rug: { a: 0xf0e6d2, b: 0x2f7f86, pattern: 'geo' }, rugAlt: { a: 0xf2c7b8, b: 0xe29a86, pattern: 'stripe' },
    accentA: 0xf0b43c, accentB: 0xe0614a, metalFurn: 0x2a2d31, metalKind: 'black',
    bed: { duvet: 0x6f8fb0, duvet2: 0xe29a86, throw: 0xf0c75a, linen: 0xffffff }, ceilingColor: 0xffffff, lamp: 0xfff0cc, leaf: 0x3f9a58,
    roofFinish: { kind: 'tile', tile: { color: [176, 180, 184], grout: [130, 134, 138], tileFt: 1, vary: 0.05 }, finish: 'matte' }, ground: 0x62a34b, exteriorTone: 'neutral',
  },
  luxury_marble: {
    id: 'luxury_marble', label: 'Luxury Marble', blurb: 'Polished veined marble, brass details and rich stone.',
    o: { floor: 'marble_gold', floorFinish: 'gloss', wallColor: 'cream', wallFinish: 'satin', ceiling: 'cove', furnWood: 'walnut', upholstery: 'oatmeal', cabinets: 'white', counter: 'marble_white',
      bathTile: 'marble', fixtures: 'brass', door: 'walnut', windowFrame: 'bronze', curtains: 'cream', facadeFinish: 'stone', facadeColor: 'cream', trim: 'bronze', railing: 'glass', landscaping: true, extLights: true },
    wetFloor: { kind: 'marble', marble: { base: [104, 78, 62], vein: [220, 200, 170], veinAmt: 0.8, seed: 12 }, finish: 'gloss' },
    outFloor: { kind: 'marble', marble: { base: [222, 207, 178], vein: [190, 168, 134], veinAmt: 0.55, slabFt: 2, seed: 20, scale: 1.6 }, finish: 'satin' },
    rug: { a: 0xefe6d4, b: 0xb99a62, pattern: 'diamond' }, rugAlt: { a: 0xe3d7c0, b: 0xc7ad7a, pattern: 'chevron' },
    accentA: 0xb99a62, accentB: 0x6e7f78, metalFurn: 0xc8a45c, metalKind: 'brass',
    bed: { duvet: 0xe9dfca, duvet2: 0xdacdb4, throw: 0xb99a62, linen: 0xfaf6ee }, ceilingColor: 0xf8f3e8, lamp: 0xffe0b0, leaf: 0x4a7f55,
    roofFinish: { kind: 'marble', marble: { base: [222, 207, 178], vein: [190, 168, 134], veinAmt: 0.5, slabFt: 2, seed: 20, scale: 1.6 }, finish: 'satin' }, ground: 0x5f9248, exteriorTone: 'warm',
  },
  modern_luxury: {
    id: 'modern_luxury', label: 'Modern Luxury', blurb: 'Beige, cream and walnut with sophisticated cove lighting.',
    o: { floor: 'walnut', floorFinish: 'satin', wallColor: 'beige', wallFinish: 'satin', ceiling: 'cove', furnWood: 'walnut', upholstery: 'oatmeal', cabinets: 'walnut', counter: 'quartz_white',
      bathTile: 'beige_stone', fixtures: 'brass', door: 'walnut', windowFrame: 'black', curtains: 'cream', facadeFinish: 'plaster', facadeColor: 'grey', trim: 'charcoal', railing: 'glass', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [208, 192, 166], grout: [168, 152, 126], tileFt: 2, vary: 0.06 }, finish: 'satin' },
    outFloor: { kind: 'tile', tile: { color: [172, 160, 142], grout: [126, 116, 102], tileFt: 2, vary: 0.05 }, finish: 'matte' },
    rug: { a: 0xe9dfcd, b: 0xb7a584, pattern: 'diamond' }, rugAlt: { a: 0xd8ccb4, b: 0x8a7a60, pattern: 'plain' },
    accentA: 0x8a7458, accentB: 0x3f4a52, metalFurn: 0xb59354, metalKind: 'brass',
    bed: { duvet: 0xd8ccb4, duvet2: 0xc9bca2, throw: 0x8a7458, linen: 0xf6f1e6 }, ceilingColor: 0xf3eee2, lamp: 0xffd9a0, leaf: 0x4d7a4c,
    roofFinish: { kind: 'tile', tile: { color: [168, 160, 148], grout: [120, 114, 104], tileFt: 2, vary: 0.05 }, finish: 'matte' }, ground: 0x5e8f48, exteriorTone: 'warm',
  },
  scandinavian: {
    id: 'scandinavian', label: 'Scandinavian', blurb: 'Light oak, soft whites, natural fabrics and daylight.',
    o: { floor: 'oak_light', floorFinish: 'matte', wallColor: 'white', wallFinish: 'matte', ceiling: 'flat', furnWood: 'ash', upholstery: 'stone', cabinets: 'white', counter: 'butcher',
      bathTile: 'white_subway', fixtures: 'chrome', door: 'white', windowFrame: 'white', curtains: 'cream', facadeFinish: 'wood', facadeColor: 'white', trim: 'white', railing: 'wood', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [226, 226, 222], grout: [190, 190, 184], tileFt: 1, vary: 0.03 }, finish: 'matte' },
    outFloor: { kind: 'plank', plank: { tone: [196, 176, 148], vary: 0.1 }, finish: 'matte' },
    rug: { a: 0xf3efe6, b: 0xb8b4aa, pattern: 'geo' }, rugAlt: { a: 0xf3efe6, b: 0xcfd6d0, pattern: 'stripe' },
    accentA: 0x9fb09a, accentB: 0xe3c9b8, metalFurn: 0x2e3135, metalKind: 'black',
    bed: { duvet: 0xeae6dc, duvet2: 0xdfe3df, throw: 0x9fb09a, linen: 0xffffff }, ceilingColor: 0xffffff, lamp: 0xfff1d6, leaf: 0x5a9a5a,
    roofFinish: { kind: 'tile', tile: { color: [200, 200, 196], grout: [160, 160, 156], tileFt: 1, vary: 0.03 }, finish: 'matte' }, ground: 0x78a85a, exteriorTone: 'cool',
  },
  industrial: {
    id: 'industrial', label: 'Industrial Contemporary', blurb: 'Concrete, dark metal, warm reclaimed wood and black fixtures.',
    o: { floor: 'concrete', floorFinish: 'satin', wallColor: 'greige', wallFinish: 'textured', ceiling: 'flat', furnWood: 'teak', upholstery: 'camel', cabinets: 'graphite', counter: 'concrete',
      bathTile: 'black_matte', fixtures: 'black', door: 'black', windowFrame: 'black', curtains: 'off', facadeFinish: 'brick', facadeColor: 'charcoal', trim: 'charcoal', railing: 'steel', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [92, 94, 96], grout: [60, 62, 64], tileFt: 1, vary: 0.05 }, finish: 'matte' },
    outFloor: { kind: 'concrete', concrete: { color: [128, 127, 124], panels: true }, finish: 'matte' },
    rug: { a: 0x55585d, b: 0x8a8d90, pattern: 'geo' }, rugAlt: { a: 0x7a5238, b: 0x4a3a30, pattern: 'plain' },
    accentA: 0xb5642e, accentB: 0x8a8d90, metalFurn: 0x25272b, metalKind: 'black',
    bed: { duvet: 0x6e7378, duvet2: 0x55585d, throw: 0xb5642e, linen: 0xe8e6e2 }, ceilingColor: 0x8d8c89, lamp: 0xffd6a0, leaf: 0x4a7a4a,
    roofFinish: { kind: 'concrete', concrete: { color: [118, 117, 114], panels: true }, finish: 'matte' }, ground: 0x5a8742, exteriorTone: 'cool',
  },
  premium_contemporary: {
    id: 'premium_contemporary', label: 'Premium Contemporary', blurb: 'Honed stone, fine oak and a coordinated neutral palette.',
    o: { floor: 'travertine', floorFinish: 'satin', wallColor: 'greige', wallFinish: 'satin', ceiling: 'cove', furnWood: 'oak', upholstery: 'oatmeal', cabinets: 'oak', counter: 'marble_white',
      bathTile: 'grey_large', fixtures: 'chrome', door: 'oak', windowFrame: 'bronze', curtains: 'cream', facadeFinish: 'stone', facadeColor: 'sand', trim: 'bronze', railing: 'glass', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [176, 172, 164], grout: [136, 132, 124], tileFt: 2, vary: 0.05 }, finish: 'satin' },
    outFloor: { kind: 'tile', tile: { color: [170, 164, 154], grout: [128, 122, 112], tileFt: 2, vary: 0.05 }, finish: 'matte' },
    rug: { a: 0xe6dfd0, b: 0xaaa190, pattern: 'chevron' }, rugAlt: { a: 0xd8d1c2, b: 0x8f8978, pattern: 'plain' },
    accentA: 0x7d8a7a, accentB: 0xb59a74, metalFurn: 0x2c2f33, metalKind: 'black',
    bed: { duvet: 0xcfc7b6, duvet2: 0xbdb5a2, throw: 0x7d8a7a, linen: 0xf4f0e8 }, ceilingColor: 0xf5f2ec, lamp: 0xffe2b4, leaf: 0x4f7f55,
    roofFinish: { kind: 'tile', tile: { color: [172, 166, 156], grout: [126, 120, 110], tileFt: 2, vary: 0.05 }, finish: 'matte' }, ground: 0x628f4a, exteriorTone: 'neutral',
  },

  traditional_rosewood: {
    id: 'traditional_rosewood', label: 'Rosewood & Ivory', blurb: 'Carved rosewood, ivory walls, teak floors and brass: the warm heritage drawing room.',
    o: { floor: 'teak', floorFinish: 'satin', wallColor: 'ivory', wallFinish: 'matte', ceiling: 'beams', furnWood: 'rosewood', upholstery: 'ivory', cabinets: 'teak', counter: 'kota',
      bathTile: 'earth_terracotta', fixtures: 'brass', door: 'teak', windowFrame: 'wood', curtains: 'ivory', facadeFinish: 'plaster', facadeColor: 'ivory', trim: 'rosewood', railing: 'wood', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [178, 130, 96], grout: [132, 96, 72], tileFt: 1, vary: 0.09 }, finish: 'satin' },
    outFloor: { kind: 'tile', tile: { color: [160, 72, 54], grout: [112, 58, 46], tileFt: 1, pattern: 'inlay', sheetFt: 2, vary: 0.05 }, finish: 'gloss' },
    rug: { a: 0x7a2f2c, b: 0xe6d8b4, pattern: 'medallion' }, rugAlt: { a: 0x8a3a2c, b: 0xd9c08a, pattern: 'medallion' },
    accentA: 0xc9a45c, accentB: 0x7a2f2c, metalFurn: 0xb08a4a, metalKind: 'brass',
    bed: { duvet: 0xe9dfc6, duvet2: 0xdccba2, throw: 0x7a2f2c, linen: 0xf6f0e0 }, ceilingColor: 0xf2e8d0, lamp: 0xffd9a0, leaf: 0x4a7f3f,
    roofFinish: { kind: 'tile', tile: { color: [168, 98, 70], grout: [120, 82, 62], tileFt: 1, vary: 0.1 }, finish: 'matte' }, ground: 0x6c9a4a, exteriorTone: 'warm',
    tileColor: [188, 98, 62], timber: [108, 66, 42], paving: 0xb2664a,
  },
  traditional_teak: {
    id: 'traditional_teak', label: 'Teak & Gold', blurb: 'Honey teak, sandstone walls, muted gold fabrics and terracotta.',
    o: { floor: 'teak', floorFinish: 'satin', wallColor: 'sandstone', wallFinish: 'matte', ceiling: 'beams', furnWood: 'teak', upholstery: 'muted_gold', cabinets: 'teak', counter: 'limestone',
      bathTile: 'sand_stone', fixtures: 'brass', door: 'rosewood', windowFrame: 'wood', curtains: 'muted_gold', facadeFinish: 'plaster', facadeColor: 'warm_white', trim: 'wood', railing: 'wood', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [204, 184, 150], grout: [160, 142, 112], tileFt: 1, vary: 0.07 }, finish: 'satin' },
    outFloor: { kind: 'tile', tile: { color: [150, 62, 46], grout: [104, 52, 42], tileFt: 1, pattern: 'inlay', sheetFt: 2, vary: 0.05 }, finish: 'gloss' },
    rug: { a: 0x8a3a2c, b: 0xe3cf9e, pattern: 'medallion' }, rugAlt: { a: 0x3f5a52, b: 0xe3cf9e, pattern: 'medallion' },
    accentA: 0xb8923e, accentB: 0x8a3a2c, metalFurn: 0xb08a4a, metalKind: 'brass',
    bed: { duvet: 0xe4d4aa, duvet2: 0xd6c08c, throw: 0x8a3a2c, linen: 0xf6f0e0 }, ceilingColor: 0xf0e4c6, lamp: 0xffd096, leaf: 0x4d8040,
    roofFinish: { kind: 'tile', tile: { color: [160, 90, 64], grout: [112, 76, 58], tileFt: 1, vary: 0.1 }, finish: 'matte' }, ground: 0x6f9c4c, exteriorTone: 'warm',
    tileColor: [176, 88, 56], timber: [124, 80, 48], paving: 0xa85e44,
  },
  wada_ochre: {
    id: 'wada_ochre', label: 'Ochre & Teak', blurb: 'Lime-washed ochre walls, dark carved teak, ochre stone floors and brass: the classic wada.',
    o: { floor: 'stone_ochre', floorFinish: 'satin', wallColor: 'ochre', wallFinish: 'textured', ceiling: 'beams', furnWood: 'teak', upholstery: 'ivory', cabinets: 'teak', counter: 'kota',
      bathTile: 'sand_stone', fixtures: 'brass', door: 'teak', windowFrame: 'wood', curtains: 'off', facadeFinish: 'plaster', facadeColor: 'ochre', trim: 'wood', railing: 'wood', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [186, 150, 106], grout: [140, 112, 80], tileFt: 1, vary: 0.09 }, finish: 'satin' },
    outFloor: { kind: 'tile', tile: { color: [168, 150, 124], grout: [120, 106, 88], tileFt: 2, vary: 0.08 }, finish: 'matte' },
    rug: { a: 0x7a2f2c, b: 0xe6d8b4, pattern: 'medallion' }, rugAlt: { a: 0x8a3a2c, b: 0xd9c08a, pattern: 'stripe' },
    accentA: 0xb8923e, accentB: 0x8a3a2c, metalFurn: 0xb08a4a, metalKind: 'brass',
    bed: { duvet: 0xeadfc6, duvet2: 0xdccba2, throw: 0x8a3a2c, linen: 0xf6f0e0 }, ceilingColor: 0xe9d9b4, lamp: 0xffc886, leaf: 0x4a7f3f,
    roofFinish: { kind: 'tile', tile: { color: [168, 98, 70], grout: [120, 82, 62], tileFt: 1, vary: 0.1 }, finish: 'matte' }, ground: 0x7a9a50, exteriorTone: 'warm',
    tileColor: [172, 84, 52], timber: [92, 56, 34], paving: 0xa88a64,
  },
  wada_terracotta: {
    id: 'wada_terracotta', label: 'Terracotta & Cream', blurb: 'Muted-red lime-washed walls, cream trims, terracotta floors and honey teak.',
    o: { floor: 'terracotta', floorFinish: 'satin', wallColor: 'cream', wallFinish: 'textured', ceiling: 'beams', furnWood: 'walnut', upholstery: 'maroon', cabinets: 'rosewood', counter: 'limestone',
      bathTile: 'earth_terracotta', fixtures: 'brass', door: 'rosewood', windowFrame: 'rosewood', curtains: 'off', facadeFinish: 'plaster', facadeColor: 'muted_red', trim: 'rosewood', railing: 'wood', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [178, 120, 88], grout: [132, 94, 70], tileFt: 1, vary: 0.09 }, finish: 'satin' },
    outFloor: { kind: 'tile', tile: { color: [160, 90, 66], grout: [112, 72, 56], tileFt: 1, vary: 0.08 }, finish: 'matte' },
    rug: { a: 0x7a2f2c, b: 0xe3cf9e, pattern: 'medallion' }, rugAlt: { a: 0x3f5a52, b: 0xe3cf9e, pattern: 'stripe' },
    accentA: 0xc9a45c, accentB: 0x7a2f2c, metalFurn: 0xb08a4a, metalKind: 'brass',
    bed: { duvet: 0xe9dfc6, duvet2: 0xd6c08c, throw: 0x7a2f2c, linen: 0xf6f0e0 }, ceilingColor: 0xefe0c0, lamp: 0xffc886, leaf: 0x4d8040,
    roofFinish: { kind: 'tile', tile: { color: [160, 90, 64], grout: [112, 76, 58], tileFt: 1, vary: 0.1 }, finish: 'matte' }, ground: 0x7a9a50, exteriorTone: 'warm',
    tileColor: [160, 70, 46], timber: [104, 62, 38], paving: 0xa86a4c,
  },
  wada_cream: {
    id: 'wada_cream', label: 'Cream & Carved Teak', blurb: 'Cream lime-wash, cream stone floors and deep brown carved teak with brass accents.',
    o: { floor: 'stone_cream', floorFinish: 'satin', wallColor: 'cream', wallFinish: 'textured', ceiling: 'beams', furnWood: 'teak', upholstery: 'oatmeal', cabinets: 'teak', counter: 'limestone',
      bathTile: 'sand_stone', fixtures: 'brass', door: 'teak', windowFrame: 'wood', curtains: 'off', facadeFinish: 'plaster', facadeColor: 'cream', trim: 'wood', railing: 'wood', landscaping: true, extLights: true },
    wetFloor: { kind: 'tile', tile: { color: [204, 184, 150], grout: [160, 142, 112], tileFt: 1, vary: 0.07 }, finish: 'satin' },
    outFloor: { kind: 'tile', tile: { color: [176, 162, 136], grout: [130, 118, 98], tileFt: 2, vary: 0.07 }, finish: 'matte' },
    rug: { a: 0x8a3a2c, b: 0xe3cf9e, pattern: 'medallion' }, rugAlt: { a: 0xb8923e, b: 0x7a2f2c, pattern: 'stripe' },
    accentA: 0xb8923e, accentB: 0x8a3a2c, metalFurn: 0xb08a4a, metalKind: 'brass',
    bed: { duvet: 0xf0e8d2, duvet2: 0xe0d0a8, throw: 0xb8923e, linen: 0xf8f2e2 }, ceilingColor: 0xf0e4c6, lamp: 0xffc886, leaf: 0x4d8040,
    roofFinish: { kind: 'tile', tile: { color: [160, 90, 64], grout: [112, 76, 58], tileFt: 1, vary: 0.1 }, finish: 'matte' }, ground: 0x7a9a50, exteriorTone: 'warm',
    tileColor: [168, 86, 56], timber: [98, 60, 38], paving: 0xb09a74,
  },
}
export const THEME_ORDER: ThemeId[] = ['wood_classic', 'colorful_modern', 'luxury_marble', 'modern_luxury', 'scandinavian', 'industrial', 'premium_contemporary']
/** Every palette of every style (the design studio draws a preview card for each). */
export const ALL_THEME_ORDER: ThemeId[] = [...THEME_ORDER, 'traditional_rosewood', 'traditional_teak', 'wada_ochre', 'wada_terracotta', 'wada_cream']

/* ------------------------------------------------------------------ resolved design (what the builders read) */
export interface Furn {
  /** carved heritage furniture family (twinInterior draws divans, armchairs, panelled beds and wardrobes instead of the contemporary pieces) */
  heritage: boolean
  /** Maharashtrian Wada: low gadi seating with bolsters, a jhula and brass lanterns on top of the heritage family */
  wada: boolean
  carved: THREE.Material
  wood: THREE.Material; woodLight: THREE.Material; woodDark: THREE.Material
  sofa: THREE.Material; sofaDark: THREE.Material; chairFab: THREE.Material; chairFabDark: THREE.Material
  accentA: THREE.Material; accentB: THREE.Material; linen: THREE.Material
  duvet: THREE.Material; duvet2: THREE.Material; throwM: THREE.Material; headboard: THREE.Material
  rug: THREE.Material; rugAlt: THREE.Material; curtain: THREE.Material | null; sheer: THREE.Material
  metal: THREE.Material; metalDark: THREE.Material; brassM: THREE.Material
  cabinet: THREE.Material; upper: THREE.Material; counter: THREE.Material; hardware: THREE.Material
  chrome: THREE.Material; steel: THREE.Material; steelDark: THREE.Material; white: THREE.Material; vanity: THREE.Material
  lampShade: THREE.Material; tv: THREE.Material; tvScreen: THREE.Material; leaf: THREE.Material; leaf2: THREE.Material; pot: THREE.Material
  glass: THREE.Material; mirror: THREE.Material; officeChair: THREE.Material; corner: THREE.Material; bench: THREE.Material
  tile: THREE.Material
}
export interface Resolved {
  style: StyleDef
  def: ThemeDef; time: Time
  coded: boolean
  floorMain: Surface; floorBed: Surface; floorWet: Surface; floorOut: Surface
  wallColor: number; wallFinish: WallFinish; wall: THREE.Material
  trimMat: THREE.Material; trimColor: number
  ceiling: CeilingStyle; ceilingMat: THREE.Material; ceilingTimber: THREE.Material
  curtainOn: boolean
  doorMat: THREE.Material; mainDoorMat: THREE.Material; handle: THREE.Material
  frame: THREE.Material; frameColor: number
  tileMat: THREE.Material; fixtureColor: number
  furn: Furn
  ext: {
    main: THREE.Material; accent: THREE.Material | null; trim: THREE.Material; plinth: THREE.Material; roof: THREE.Material; cap: THREE.Material
    railing: 'glass' | 'steel' | 'wood'; railMat: THREE.Material; wallCol: THREE.Material; ground: THREE.Material; paving: THREE.Material
    landscaping: boolean; lights: boolean; gate: THREE.Material
    tile: THREE.Material; ridge: THREE.Material; timber: THREE.Material; stone: THREE.Material; clay: THREE.Material
  }
  key: string
}

/**
 * Customisable material roles.  Every role material of a resolved design is its own copy, tagged `userData.role` (the glTF exporter writes it as `extras`, so the tag
 * survives into the VR scene).  That is how a live change finds exactly the surfaces of one role (all sofas, all interior doors, ...) without touching anything else that
 * happens to look the same.  An override key (the same keys the design studio uses) controls one or more roles.
 */
export const ROLE_OF_KEY: Record<string, string[]> = {
  furnWood: ['furn.wood', 'furn.woodLight', 'furn.woodDark', 'furn.carved'],
  upholstery: ['furn.sofa', 'furn.sofaDark', 'furn.chairFab', 'furn.chairFabDark', 'furn.corner', 'furn.bench'],
  cabinets: ['furn.cabinet', 'furn.upper', 'furn.vanity'],
  counter: ['furn.counter'],
  bathTile: ['furn.tile', 'tileMat'],
  fixtures: ['furn.chrome'],
  door: ['doorMat', 'mainDoorMat'],
  windowFrame: ['frame'],
  curtains: ['furn.curtain'],
  facadeFinish: ['ext.main', 'ext.accent', 'ext.wallCol', 'ext.cap'],
  facadeColor: ['ext.main', 'ext.accent', 'ext.wallCol', 'ext.cap'],
  trim: ['ext.trim'],
  railing: ['ext.railMat'],
  rugs: ['furn.rug', 'furn.rugAlt'],      // tinted live (no design override: the rug keeps its own pattern)
  gate: ['ext.gate'],                     // recoloured live
}
export const ROLE_PATHS: string[] = [...new Set(Object.values(ROLE_OF_KEY).flat())]
type Bag = Record<string, unknown>
export function roleMaterial(r: Resolved, path: string): THREE.Material | null {
  const [a, b] = path.split('.')
  const v = b ? (r as unknown as Record<string, Bag>)[a]?.[b] : (r as unknown as Bag)[a]
  return (v as THREE.Material | null | undefined) ?? null
}
function tagRoles(r: Resolved): void {
  for (const path of ROLE_PATHS) {
    const m = roleMaterial(r, path)
    if (!m) continue
    const c = m.clone()
    c.userData = { ...c.userData, role: path }
    const [a, b] = path.split('.')
    if (b) (r as unknown as Record<string, Bag>)[a][b] = c
    else (r as unknown as Bag)[a] = c
  }
}

const pick = <T extends { id: string }>(list: T[], id: string, fallback: string): T => list.find((x) => x.id === id) ?? list.find((x) => x.id === fallback) ?? list[0]

function woodSurface(t: Rgb, vertical = false): Surface {
  return { kind: 'plank', plank: { tone: t, tileFt: 2, plankFt: 1, lenFt: 4, seam: 0, vary: 0.05, vertical }, finish: 'satin' }
}
const shade = (c: number, k: number) => rgbN(rgb(c).map((v) => Math.max(0, Math.min(255, v * k))) as Rgb)

export function resolveDesign(d: Design): Resolved {
  const style = STYLES[d.style] ?? STYLES.modern_minimalistic
  const themeId: ThemeId = style.themes.includes(d.theme) ? d.theme : style.themes[0]    // a palette of another style never mixes in
  const def = THEMES[themeId]
  const o = { ...def.o, ...Object.fromEntries(Object.entries(d.over).filter(([, v]) => v !== undefined)) } as typeof def.o
  const finish = o.floorFinish
  const floorCh = pick(FLOORS, o.floor, def.o.floor)
  const coded = floorCh.id === 'coded'
  const floorMain = floorCh.s(finish)
  // bedrooms and studies take the theme's warm floor (wood) when the main floor is stone / tile; otherwise the same floor
  const stoneLike = ['marble_white', 'marble_gold', 'marble_dark', 'travertine', 'concrete', 'tile_grey'].includes(floorCh.id)
  const bedWood: Surface = themeId === 'luxury_marble' ? floorMain
    : themeId === 'industrial' ? floorMain
      : { kind: 'plank', plank: { tone: themeId === 'premium_contemporary' ? OAK_LIGHT : themeId === 'colorful_modern' ? ASH : OAK_WARM }, finish }
  const floorBed = stoneLike && !o.floor.startsWith('marble') ? bedWood : floorMain
  const wallCh = pick(WALL_COLORS, o.wallColor, 'cream')
  const wallFin = o.wallFinish
  const wall = surface({ kind: 'plaster', color: wallCh.c, coarse: wallFin === 'textured' ? 0.75 : 0.05, finish: wallFin === 'satin' ? 'satin' : 'matte' })
  const trimColor = ({ wood_classic: 0xf1e9da, colorful_modern: 0xffffff, luxury_marble: 0xf4efe3, modern_luxury: 0xeee7d8, scandinavian: 0xffffff, industrial: 0x2e3135, premium_contemporary: 0xf2eee6, traditional_rosewood: 0xf4ebd6, traditional_teak: 0xf0e6cc, wada_ochre: 0xe8d8b0, wada_terracotta: 0xefe0c0, wada_cream: 0xf0e6cc } as Record<ThemeId, number>)[themeId]
  const trimMat = solid(trimColor, 0.5)
  const cs = o.ceiling
  const ceilingMat = surface({ kind: 'plaster', color: def.ceilingColor, coarse: 0.02, finish: 'matte' })
  const ceilingTimber = surface({ kind: 'plank', plank: { tone: [102, 64, 42], tileFt: 4, plankFt: 0.45, lenFt: 6, seam: 0.3, vary: 0.07 }, finish: 'satin' })

  const woodCh = pick(WOODS, o.furnWood, 'oak')
  const upCh = pick(UPHOLSTERY, o.upholstery, 'stone')
  const fxCh = pick(FIXTURES, o.fixtures, 'chrome')
  const cabCh = pick(CABINETS, o.cabinets, 'white')
  const ctCh = pick(COUNTERS, o.counter, 'granite_black')
  const btCh = pick(BATH_TILES, o.bathTile, 'white_subway')
  const dCh = pick(DOORS, o.door, 'oak')
  const fCh = pick(FRAMES, o.windowFrame, 'white')
  const cuCh = pick(CURTAINS, o.curtains, 'cream')

  const woodT = woodCh.t
  const wood = surface(woodSurface(woodT))
  const woodLight = surface(woodSurface(rgb(shade(rgbN(woodT), 1.18)) as Rgb))
  const woodDark = surface(woodSurface(rgb(shade(rgbN(woodT), 0.62)) as Rgb))
  const fab = (c: number, coarse = 0): THREE.Material => surface({ kind: 'fabric', color: c, coarse })
  const sofaC = upCh.c
  const handleM = def.metalKind === 'brass' ? metal(0xc8a45c, 0.3) : def.metalKind === 'bronze' ? metal(0x7a5c3e, 0.35) : def.metalKind === 'black' ? metal(0x25272b, 0.4) : metal(0xd5dadc, 0.2)
  const fxMat = metal(fxCh.c, fxCh.m)
  const cabinet = surface(cabCh.s)
  const darkCab = cabCh.id === 'graphite' || cabCh.id === 'navy' || cabCh.id === 'walnut'
  const upper = cabCh.id === 'oak' ? surface({ kind: 'solid', color: 0xefe8da, rough: 0.5 }) : cabCh.id === 'walnut' ? surface({ kind: 'solid', color: 0xe4dac6, rough: 0.5 }) : cabinet
  void darkCab
  const heritage = style.interior.furniture !== 'contemporary'
  const wada = style.interior.furniture === 'wada'
  const furn: Furn = {
    heritage, wada, carved: surface(woodSurface(rgb(shade(rgbN(woodT), 0.78)) as Rgb)),
    wood, woodLight, woodDark,
    sofa: fab(sofaC, 1), sofaDark: fab(shade(sofaC, 0.82), 1), chairFab: fab(shade(sofaC, 1.08), 1), chairFabDark: fab(shade(sofaC, 0.72), 1),
    accentA: fab(def.accentA, 0), accentB: fab(def.accentB, 0), linen: fab(def.bed.linen, 0),
    duvet: fab(def.bed.duvet, 0), duvet2: fab(def.bed.duvet2, 0), throwM: fab(def.bed.throw, 1), headboard: fab(shade(def.bed.duvet, 0.92), 1),
    rug: surface({ kind: 'rug', rug: { a: rgb(def.rug.a), b: rgb(def.rug.b), pattern: def.rug.pattern } }),
    rugAlt: surface({ kind: 'rug', rug: { a: rgb(def.rugAlt.a), b: rgb(def.rugAlt.b), pattern: def.rugAlt.pattern } }),
    curtain: cuCh.c === null ? null : fab(cuCh.c, 0), sheer: surface({ kind: 'solid', color: 0xf4f1ea, rough: 0.9, opacity: 1 }),
    metal: handleM, metalDark: metal(0x3a3a3c, 0.45), brassM: metal(0xc8a45c, 0.3),
    cabinet, upper, counter: surface(ctCh.s), hardware: handleM,
    chrome: fxMat, steel: surface({ kind: 'metal', color: 0xc9cfd2, rough: 0.32, metal: 0.7 }), steelDark: surface({ kind: 'metal', color: 0x7b8085, rough: 0.38, metal: 0.7 }), white: solid(0xf5f5f3, 0.25), vanity: surface(cabCh.id === 'white' || cabCh.id === 'cream' ? woodSurface(rgb(shade(rgbN(woodT), 0.9)) as Rgb) : cabCh.s),
    lampShade: surface({ kind: 'emissive', color: def.lamp, glow: d.time === 'evening' ? 1.4 : 0.12 }), tv: solid(0x14181c, 0.35), tvScreen: surface({ kind: 'solid', color: 0x0b0e12, rough: 0.08 }),
    leaf: solid(def.leaf, 0.85), leaf2: solid(shade(def.leaf, 1.18), 0.85), pot: solid(0xb86f45, 0.85),
    glass: surface({ kind: 'glass', opacity: 0.3 }), mirror: metal(0xdfe9ee, 0.04),
    officeChair: fab(0x3c444d, 0), corner: fab(shade(sofaC, 0.9), 1), bench: fab(shade(sofaC, 1.05), 1),
    tile: surface(btCh.s),
  }

  const facadeFin = o.facadeFinish
  const facadeCol = pick(FACADE_COLORS, o.facadeColor, 'cream').c
  const trimC = pick(TRIMS, o.trim, 'white')
  const mainFacade: Surface = facadeFin === 'brick' ? { kind: 'brick', brick: { color: rgb(def.exteriorTone === 'cool' ? 0x7a4a3e : 0xa4604a) } }
    : facadeFin === 'stone' ? { kind: 'stone', stone: { color: rgb(shade(facadeCol, 0.98)) } }
      : facadeFin === 'wood' ? { kind: 'plank', plank: { tone: [176, 128, 84], tileFt: 4, plankFt: 0.5, lenFt: 4, vary: 0.1, seam: 1.3, vertical: true }, finish: 'satin' }
        : { kind: 'plaster', color: facadeCol, coarse: 0.3, finish: 'matte' }
  const accentFacade: Surface | null = style.exterior.stoneAccent && facadeFin === 'plaster' ? { kind: 'stone', stone: { color: [198, 178, 146] } }
    : facadeFin === 'plaster'
    ? (themeId === 'wood_classic' ? { kind: 'brick', brick: { color: [164, 96, 74] } } : themeId === 'industrial' ? { kind: 'concrete', concrete: { color: [120, 119, 116], panels: true } } : { kind: 'stone', stone: { color: [196, 176, 146] } })
    : facadeFin === 'wood' ? { kind: 'plaster', color: facadeCol, coarse: 0.3, finish: 'matte' }
      : { kind: 'plank', plank: { tone: [160, 112, 72], tileFt: 4, plankFt: 0.5, lenFt: 4, vary: 0.1, seam: 1.3, vertical: true }, finish: 'satin' }
  const trimMatE = trimC.id === 'wood' ? surface({ kind: 'plank', plank: { tone: [150, 104, 64], tileFt: 4, plankFt: 0.5, lenFt: 4, seam: 0.4 }, finish: 'satin' }) : solid(trimC.c, 0.55, trimC.id === 'bronze' ? 0.4 : 0)
  const railing = o.railing as 'glass' | 'steel' | 'wood'
  const timberMat = surface({ kind: 'plank', plank: { tone: def.timber ?? [112, 70, 44], tileFt: 4, plankFt: 0.5, lenFt: 4, vary: 0.08, seam: 0.5, vertical: true }, finish: 'satin' })
  const heritageLand = style.exterior.landscape !== 'standard'
  const ext = {
    tile: surface({ kind: 'rooftile', rooftile: { color: def.tileColor ?? [184, 98, 64] } }), ridge: solid(shade(rgbN(def.tileColor ?? [184, 98, 64]), 0.8), 0.7),
    timber: timberMat, stone: surface({ kind: 'stone', stone: { color: [198, 178, 146] } }), clay: surface({ kind: 'paving', color: def.paving ?? 0xb2664a }),
    main: surface(mainFacade), accent: accentFacade ? surface(accentFacade) : null, trim: trimMatE,
    plinth: surface({ kind: 'stone', stone: { color: [150, 146, 138], mortar: [110, 106, 100], tileFt: 4 } }),
    roof: surface(def.roofFinish), cap: solid(shade(facadeCol, 0.9), 0.8), railing,
    railMat: railing === 'glass' ? surface({ kind: 'glass', opacity: 0.22, color: 0xdcecf2 }) : railing === 'steel' ? metal(0x2f3236, 0.4) : surface({ kind: 'plank', plank: { tone: [160, 112, 72], tileFt: 2, plankFt: 1, lenFt: 4, seam: 0 } }),
    wallCol: surface({ kind: 'plaster', color: shade(facadeCol, 0.96), coarse: 0.3, finish: 'matte' }),
    ground: surface({ kind: 'grass', color: def.ground }), paving: heritageLand ? surface({ kind: 'paving', color: def.paving ?? 0xb2664a }) : surface({ kind: 'paving', color: 0xb8b2a6 }),
    landscaping: Boolean(o.landscaping), lights: Boolean(o.extLights), gate: style.exterior.gate === 'timber' ? timberMat : metal(0x2d3338, 0.45),
  }
  const resolved: Resolved = {
    style, def, time: d.time, coded, floorMain, floorBed, floorWet: def.wetFloor, floorOut: def.outFloor,
    wallColor: wallCh.c, wallFinish: wallFin, wall, trimMat, trimColor, ceiling: cs, ceilingMat, ceilingTimber,
    curtainOn: cuCh.c !== null, doorMat: surface(dCh.s), mainDoorMat: surface(dCh.s.kind === 'solid' ? { ...dCh.s, color: shade(dCh.s.color ?? 0x888888, 0.85) } : dCh.s), handle: handleM,
    frame: surface({ kind: 'solid', color: fCh.c, rough: fCh.m ? 0.45 : 0.5, metal: fCh.m ? 0.6 : 0 }), frameColor: fCh.c,
    tileMat: surface(btCh.s), fixtureColor: fxCh.c, furn, ext,
    key: JSON.stringify([style.id, themeId, d.over, d.time]),
  }
  tagRoles(resolved)
  return resolved
}

/** The style a palette belongs to. */
export const styleOfTheme = (t: ThemeId): StyleId => (STYLES.maharashtrian_wada.themes.includes(t) ? 'maharashtrian_wada' : STYLES.traditional_indian.themes.includes(t) ? 'traditional_indian' : 'modern_minimalistic')
export const designKey = (d: Design) => JSON.stringify([d.style, d.theme, d.over, d.time])
export const overridesCount = (d: Design) => Object.values(d.over).filter((v) => v !== undefined).length
