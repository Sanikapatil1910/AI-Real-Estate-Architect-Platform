import type { ArchitecturalStyle } from '@/types'
import type { ThemeId } from './twinThemes'
import { normaliseStyle } from '@/lib/archStyle'

/**
 * The architectural styles of the application as data: the 3D builders read these values and never test a style name.
 *
 * A style chooses *how the house is dressed*: finishes (through its themes), the furniture family, ceiling, doors and windows, the roof, porch,
 * garden and gate.  It never touches the validated plan: rooms, walls, openings, stairs and the furniture slots come from the plan alone,
 * so switching the style cannot move a wall (the tests compare the structure of both).
 *
 * Adding a style = adding one entry here (and the themes it offers); nothing else branches on the style's name.
 */
export type StyleId = 'modern_minimalistic' | 'traditional_indian' | 'maharashtrian_wada'

export interface StyleDef {
  id: StyleId
  /** exact display name, shared with the backend (`ArchitecturalStyle`) */
  label: ArchitecturalStyle
  blurb: string
  /** colour / material palettes offered in the design studio for this style (the first one is the default) */
  themes: ThemeId[]
  interior: {
    furniture: 'contemporary' | 'heritage' | 'wada'   // heritage: carved divan, armchairs, wooden bed + wardrobe, solid coffee table, brass lamps; wada: the same carved family with low gadi seating, bolsters, a jhula and brass lanterns
    ceiling: 'theme' | 'timber' | 'coffered'    // timber: plank ceilings + exposed beams in the dry rooms (never in wet rooms); coffered: beams both ways
    doors: 'flush' | 'carved' | 'grand'         // carved: framed panelled leaves, carved architraves with corbels, brass studs on the main door; grand: a deep carved door frame with a cusped arch and a studded double leaf
    windows: 'plain' | 'timber' | 'jali'        // timber: heavy frames, glazing bars, a jali transom and (outside) wooden shutters; jali: a full lattice upper panel and turned bars below
    decor: 'minimal' | 'heritage' | 'wada'      // brass lamps / urli, carved mirror frame, framed prints, tulsi / planters; wada: lanterns, urli, bolsters
  }
  exterior: {
    roof: 'flat' | 'tiled'                      // tiled: pitched clay-tile roofs over the top floor and over every lower roof area
    porch: 'slab' | 'pillared' | 'wada'         // pillared: timber pillars on stone bases, balustrade and a tiled canopy over the entrance; wada: a raised otta with carved columns, cusped arches, side seats and a deep tiled eave
    balcony: 'plain' | 'timber'                 // timber: carved timber balustrade with a handrail and brackets under the slab
    eave: number                                // how far the tiled roofs project beyond the walls (ft)
    gable: boolean                              // a timber-trimmed gable over the entrance side of the main roof
    shutters: boolean
    stoneAccent: boolean                        // stone cladding around the entrance
    landscape: 'standard' | 'heritage' | 'wada' // heritage: palms, flowering shrubs, clay paving; wada: also a tulsi vrindavan, a rangoli at the door and a paved front angan
    gate: 'metal' | 'timber'                    // timber: wooden gate leaves between tile-capped brick pillars
  }
}

export const STYLES: Record<StyleId, StyleDef> = {
  modern_minimalistic: {
    id: 'modern_minimalistic', label: 'Modern Minimalistic',
    blurb: 'Clean geometry, neutral palette, contemporary furniture, flat roofs and simple openings.',
    themes: ['wood_classic', 'colorful_modern', 'luxury_marble', 'modern_luxury', 'scandinavian', 'industrial', 'premium_contemporary'],
    interior: { furniture: 'contemporary', ceiling: 'theme', doors: 'flush', windows: 'plain', decor: 'minimal' },
    exterior: { roof: 'flat', porch: 'slab', balcony: 'plain', eave: 1.7, gable: false, shutters: false, stoneAccent: false, landscape: 'standard', gate: 'metal' },
  },
  traditional_indian: {
    id: 'traditional_indian', label: 'Traditional Indian',
    blurb: 'Carved teak and rosewood, timber-beamed ceilings, terracotta tile roofs, a pillared verandah and warm ivory walls.',
    themes: ['traditional_rosewood', 'traditional_teak'],
    interior: { furniture: 'heritage', ceiling: 'timber', doors: 'carved', windows: 'timber', decor: 'heritage' },
    exterior: { roof: 'tiled', porch: 'pillared', balcony: 'plain', eave: 1.7, gable: true, shutters: true, stoneAccent: true, landscape: 'heritage', gate: 'timber' },
  },
  maharashtrian_wada: {
    id: 'maharashtrian_wada', label: 'Maharashtrian Wada',
    blurb: 'A raised otta verandah with carved teak columns and arches, a grand carved door, deep tiled eaves, jali windows, stone floors, gadi seating, a jhula and warm lanterns.',
    themes: ['wada_ochre', 'wada_terracotta', 'wada_cream'],
    interior: { furniture: 'wada', ceiling: 'coffered', doors: 'grand', windows: 'jali', decor: 'wada' },
    exterior: { roof: 'tiled', porch: 'wada', balcony: 'timber', eave: 2.5, gable: false, shutters: false, stoneAccent: true, landscape: 'wada', gate: 'timber' },
  },
}
export const STYLE_ORDER: StyleId[] = ['modern_minimalistic', 'traditional_indian', 'maharashtrian_wada']

/** The display name used by the plan / backend -> the style id.  Old names (saved projects) are mapped; unknown ones fall back to Modern Minimalistic. */
export function styleIdOf(raw: unknown): StyleId {
  const n = normaliseStyle(raw)
  return n === 'Traditional Indian' ? 'traditional_indian' : n === 'Maharashtrian Wada' ? 'maharashtrian_wada' : 'modern_minimalistic'
}
