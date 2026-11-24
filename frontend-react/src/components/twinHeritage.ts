import type { Furn } from './twinThemes'
import type { Frame } from './twinInterior'

/**
 * Heritage furniture family of the Traditional Indian style: a carved divan and armchairs with turned posts and baluster arms, a solid coffee
 * table with a brass urli, a four-poster-style panelled bed, a panelled wardrobe with a cornice, spindle-back dining chairs, framed prints and a
 * carved mirror.
 *
 * Every piece is drawn inside the same footprint as its contemporary counterpart (the same `w` x `D` slot in the room's local frame:
 * u along the wall, v out from the wall, h up), so the slots, door clearances and circulation that `Layout` already guarantees are unchanged;
 * only the shapes and materials differ.  Nothing here reads the plan.
 */

/** Profile (radius, height) of a turned post / leg: foot, neck, bulb, neck, collar, top. */
export function turned(h: number, r: number): Array<[number, number]> {
  const k = (x: number) => x * h
  return [
    [r * 0.62, 0], [r * 0.9, k(0.03)], [r * 0.7, k(0.07)], [r * 0.72, k(0.2)], [r * 1.18, k(0.3)], [r * 1.22, k(0.36)], [r * 0.7, k(0.46)],
    [r * 0.62, k(0.58)], [r * 0.95, k(0.66)], [r * 0.7, k(0.74)], [r * 0.8, k(0.88)], [r * 0.95, k(0.94)], [r * 0.8, h],
  ]
}
const FINIAL: Array<[number, number]> = [[0.05, 0], [0.16, 0.05], [0.2, 0.18], [0.12, 0.3], [0.1, 0.38], [0.14, 0.46], [0.05, 0.62], [0.0, 0.7]]

/** A raised, carved panel set into a flat surface (the front face lies at v = `at`; `out` = +1 grows towards +v). */
function panel(f: Frame, F: Furn, u0: number, u1: number, v: number, h0: number, h1: number, out: 1 | -1 = 1) {
  const t = 0.045
  const bar = (a0: number, a1: number, b0: number, b1: number) => f.b(F.carved, a0, a1, out > 0 ? v : v - t, out > 0 ? v + t : v, b0, b1)
  const m = Math.min(0.1, (u1 - u0) / 4, (h1 - h0) / 4)
  bar(u0, u1, h0, h0 + m); bar(u0, u1, h1 - m, h1); bar(u0, u0 + m, h0, h1); bar(u1 - m, u1, h0, h1)
  f.b(F.woodDark, u0 + m, u1 - m, out > 0 ? v : v - t * 0.5, out > 0 ? v + t * 0.5 : v, h0 + m, h1 - m)
  // a small carved rosette in the middle of the field
  const cu = (u0 + u1) / 2, ch = (h0 + h1) / 2, s = Math.min(0.14, (u1 - u0) / 5, (h1 - h0) / 5)
  f.b(F.carved, cu - s, cu + s, out > 0 ? v + t * 0.5 : v - t, out > 0 ? v + t : v - t * 0.5, ch - s, ch + s)
}

/* ------------------------------------------------------------------------------------------------ seating */
/**
 * Carved wooden divan / sofa (w >= 3 ft) or armchair (w < 3.3 ft): turned legs, seat rail with carved apron panels, a back of rails and
 * balusters under a carved crest, baluster arms and ivory seat / back cushions.  Slot: `w` x `f.D`, back against v = 0.
 */
export function divan(f: Frame, F: Furn, w: number, o: { scatter: boolean }) {
  const D = f.D
  const chairSize = w < 3.3
  const arm = chairSize ? 0.5 : 0.62
  // legs, seat rail, carved front apron
  for (const [u, v] of [[0.26, 0.26], [w - 0.26, 0.26], [0.26, D - 0.26], [w - 0.26, D - 0.26]]) f.lathe(F.woodDark, u, v, turned(1.1, 0.17))
  f.b(F.wood, 0.06, w - 0.06, 0.06, D - 0.06, 1.05, 1.5)
  const nap = Math.max(2, Math.round((w - 1) / 1.5))
  for (let i = 0; i < nap; i++) panel(f, F, 0.5 + ((w - 1) * i) / nap + 0.06, 0.5 + ((w - 1) * (i + 1)) / nap - 0.06, D - 0.06, 1.1, 1.45)
  // seat cushions (ivory / gold), a little proud of the rail
  const inner = w - 2 * arm
  const n = inner > 4.6 ? 3 : inner > 2.8 ? 2 : 1
  const cw = inner / n
  for (let i = 0; i < n; i++) f.s(F.sofa, arm + i * cw + 0.02, arm + (i + 1) * cw - 0.02, 0.62, D - 0.1, 1.5, 2.05, 0.2)
  // back: lower panel, balusters, top rail and a carved crest
  f.b(F.wood, 0.06, w - 0.06, 0.06, 0.4, 1.5, 2.7)
  const nbp = Math.max(2, Math.round(w / 1.6))
  for (let i = 0; i < nbp; i++) panel(f, F, ((w - 0.4) * i) / nbp + 0.3, ((w - 0.4) * (i + 1)) / nbp + 0.1, 0.4, 1.62, 2.58)
  f.b(F.wood, 0.06, w - 0.06, 0.06, 0.4, 2.7, 2.88)
  const sp = Math.max(4, Math.round(w / 0.42))
  for (let i = 0; i < sp; i++) f.cy(F.wood, 0.34 + ((w - 0.68) * i) / (sp - 1), 0.23, 0.055, 2.88, 3.5, 0.7, 6)
  f.b(F.carved, 0.06, w - 0.06, 0.06, 0.42, 3.5, 3.78)
  f.b(F.carved, w / 2 - 1.2, w / 2 + 1.2, 0.08, 0.4, 3.78, 4.0)
  f.b(F.carved, w / 2 - 0.7, w / 2 + 0.7, 0.1, 0.38, 4.0, 4.22)
  f.lathe(F.carved, w / 2, 0.22, FINIAL.map(([r, h]) => [r * 0.8, h * 0.8] as [number, number]), 12, 4.22)
  // posts with finials at the back corners
  for (const u of [0.24, w - 0.24]) {
    f.lathe(F.woodDark, u, 0.22, turned(3.9, 0.17), 14, 0.0)
    f.lathe(F.carved, u, 0.22, FINIAL, 12, 3.9)
  }
  // arms: front post, rail and balusters
  for (const side of [0, 1]) {
    const u = side === 0 ? arm / 2 : w - arm / 2
    f.lathe(F.woodDark, u, D - 0.24, turned(2.6, 0.15), 14, 1.5 - 0.5)
    f.b(F.wood, u - arm / 2, u + arm / 2, 0.06, D - 0.06, 2.5, 2.68)
    f.ball(F.carved, u, D - 0.12, 2.76, 0.19)
    for (let k = 0; k < 4; k++) f.cy(F.wood, u, 0.55 + ((D - 1.2) * k) / 3, 0.05, 1.5, 2.5, 0.7, 6)
  }
  // back cushions and scatter cushions
  for (let i = 0; i < n; i++) f.s(F.sofa, arm + i * cw + 0.06, arm + (i + 1) * cw - 0.06, 0.45, 1.0, 2.0, 3.15, 0.3)
  if (o.scatter && w > 4.5) {
    f.s(F.accentA, arm + 0.2, arm + 1.1, 0.95, 1.5, 2.05, 2.85, 0.22)
    f.s(F.accentB, w - arm - 1.1, w - arm - 0.2, 0.95, 1.5, 2.05, 2.85, 0.22)
    f.s(F.linen, w / 2 - 0.4, w / 2 + 0.4, 0.95, 1.45, 2.05, 2.75, 0.22)
  }
}

/** Dining / desk chair: turned legs, upholstered seat, spindle back under a carved top rail.  Slot: 1.4 x 1.4, back towards `out`. */
export function heritageChair(f: Frame, F: Furn, u: number, v: number, out: 1 | -1) {
  for (const [du, dv] of [[-0.58, -0.58], [0.58, -0.58], [-0.58, 0.58], [0.58, 0.58]]) f.lathe(F.woodDark, u + du, v + dv, turned(1.45, 0.1))
  f.b(F.wood, u - 0.68, u + 0.68, v - 0.68, v + 0.68, 1.3, 1.45)
  f.s(F.chairFab, u - 0.64, u + 0.64, v - 0.64, v + 0.64, 1.45, 1.78, 0.1)
  const bv = v + out * 0.6
  for (const du of [-0.64, 0.64]) f.cy(F.woodDark, u + du, bv, 0.07, 1.45, 3.35, 0.7, 8)
  f.b(F.carved, u - 0.7, u + 0.7, bv - 0.07, bv + 0.07, 3.2, 3.5)
  f.b(F.wood, u - 0.64, u + 0.64, bv - 0.05, bv + 0.05, 2.0, 2.18)
  for (let i = 0; i < 5; i++) f.cy(F.wood, u - 0.48 + i * 0.24, bv, 0.04, 2.18, 3.2, 0.7, 6)
}

/** Solid-wood coffee table with a thick top, a carved apron, turned legs and a lower shelf, a brass urli with floating flowers and two books. */
export function coffeeTable(f: Frame, F: Furn) {
  const W = f.W, D = f.D
  for (const [u, v] of [[0.26, 0.26], [W - 0.26, 0.26], [0.26, D - 0.26], [W - 0.26, D - 0.26]]) f.lathe(F.woodDark, u, v, turned(1.3, 0.16))
  f.b(F.wood, 0.1, W - 0.1, 0.1, D - 0.1, 0.35, 0.5)                                   // lower shelf
  f.b(F.wood, 0.08, W - 0.08, 0.08, D - 0.08, 1.0, 1.2)                                  // apron
  f.b(F.carved, 0, W, 0, D, 1.2, 1.42)                                                    // thick top
  f.b(F.woodDark, 0.06, W - 0.06, 0.06, D - 0.06, 1.42, 1.46)                            // inlay band
  f.cy(F.brassM, W * 0.64, D / 2, 0.55, 1.46, 1.52, 0.35, 28)                              // urli: a wide shallow brass bowl
  f.lathe(F.brassM, W * 0.64, D / 2, [[0.0, 0], [0.55, 0.05], [0.62, 0.2], [0.6, 0.26], [0.0, 0.26]].map(([r, h]) => [r, h] as [number, number]), 28, 1.5)
  for (let k = 0; k < 5; k++) f.ball([F.accentA, F.accentB, F.linen, F.accentA, F.leaf][k], W * 0.64 + Math.cos(k * 1.26) * 0.28, D / 2 + Math.sin(k * 1.26) * 0.28, 1.78, 0.12)
  f.b(F.accentB, W * 0.1, W * 0.1 + 0.8, D / 2 - 0.35, D / 2 + 0.3, 1.46, 1.54)
  f.b(F.linen, W * 0.1 + 0.05, W * 0.1 + 0.75, D / 2 - 0.3, D / 2 + 0.25, 1.54, 1.6)
}

/* ------------------------------------------------------------------------------------------------ bedroom */
/**
 * Carved wooden bed: four turned posts with finials, a tall panelled headboard under a carved crest, a low panelled footboard and side rails.
 * `u0..u1` is the bed's width in the slot, `bl` its length (head against v = 0).  Returns nothing; the mattress and linen are drawn by the caller.
 */
export function bedFrame(f: Frame, F: Furn, u0: number, u1: number, bl: number) {
  const w = u1 - u0
  const post = (u: number, v: number, h: number) => {
    f.lathe(F.woodDark, u, v, turned(h, 0.2), 16, 0)
    f.lathe(F.carved, u, v, FINIAL, 12, h)
  }
  post(u0 + 0.22, 0.24, 4.9); post(u1 - 0.22, 0.24, 4.9)
  post(u0 + 0.22, bl - 0.26, 3.1); post(u1 - 0.22, bl - 0.26, 3.1)
  // side rails and slat base
  f.b(F.wood, u0, u1, 0.1, bl, 0.62, 1.2)
  f.b(F.carved, u0 - 0.02, u0 + 0.12, 0.3, bl - 0.3, 1.0, 1.25)
  f.b(F.carved, u1 - 0.12, u1 + 0.02, 0.3, bl - 0.3, 1.0, 1.25)
  // headboard: frame, three raised panels, carved crest
  f.b(F.wood, u0 + 0.05, u1 - 0.05, 0.05, 0.4, 1.2, 4.1)
  const np = w > 4.5 ? 3 : 2
  for (let i = 0; i < np; i++) panel(f, F, u0 + 0.4 + ((w - 0.8) * i) / np + 0.06, u0 + 0.4 + ((w - 0.8) * (i + 1)) / np - 0.06, 0.4, 1.55, 3.7)
  f.b(F.carved, u0 + 0.0, u1 - 0.0, 0.0, 0.46, 4.1, 4.4)
  f.b(F.carved, u0 + w / 2 - 1.0, u0 + w / 2 + 1.0, 0.04, 0.42, 4.4, 4.7)
  f.b(F.carved, u0 + w / 2 - 0.5, u0 + w / 2 + 0.5, 0.08, 0.38, 4.7, 4.95)
  // footboard: low frame with two panels
  f.b(F.wood, u0 + 0.05, u1 - 0.05, bl - 0.4, bl - 0.08, 0.7, 2.3)
  for (let i = 0; i < 2; i++) panel(f, F, u0 + 0.4 + ((w - 0.8) * i) / 2 + 0.06, u0 + 0.4 + ((w - 0.8) * (i + 1)) / 2 - 0.06, bl - 0.08, 0.95, 2.05)
  f.b(F.carved, u0, u1, bl - 0.46, bl - 0.02, 2.3, 2.5)
}

/** Bedside chest: panelled front, brass pull, turned legs. Slot: 1.3 wide, depth 1.3, from v = 0.1. */
export function nightstand(f: Frame, F: Furn, a: number) {
  for (const [u, v] of [[a + 0.16, 0.26], [a + 1.14, 0.26], [a + 0.16, 1.24], [a + 1.14, 1.24]]) f.lathe(F.woodDark, u, v, turned(0.55, 0.09))
  f.b(F.wood, a, a + 1.3, 0.1, 1.4, 0.55, 1.75)
  f.b(F.carved, a - 0.04, a + 1.34, 0.06, 1.44, 1.75, 1.88)
  panel(f, F, a + 0.15, a + 1.15, 1.4, 0.7, 1.6)
  f.b(F.brassM, a + 0.5, a + 0.8, 1.44, 1.5, 1.15, 1.2)
}

/** Panelled wardrobe: framed double / triple doors with raised panels, brass pulls, a plinth and a projecting cornice. Slot: W x 2.1. */
export function wardrobe(f: Frame, F: Furn) {
  const W = f.W, D = f.D
  f.b(F.wood, 0, W, 0, D, 0, 7.4)
  f.b(F.woodDark, 0.04, W - 0.04, D - 0.02, D + 0.04, 0, 0.55)                          // plinth
  const nd = Math.max(2, Math.round(W / 2.4))
  for (let i = 0; i < nd; i++) {
    const a = (W * i) / nd, b = (W * (i + 1)) / nd
    f.b(F.carved, a + 0.05, b - 0.05, D - 0.02, D + 0.03, 0.55, 7.2)
    panel(f, F, a + 0.22, b - 0.22, D + 0.03, 3.4, 6.9)
    panel(f, F, a + 0.22, b - 0.22, D + 0.03, 0.8, 3.1)
    const hu = i % 2 === 0 ? b - 0.3 : a + 0.3
    f.b(F.brassM, hu - 0.04, hu + 0.04, D + 0.07, D + 0.16, 3.2, 4.3)
  }
  f.b(F.carved, -0.04, W + 0.04, D - 0.4, D + 0.08, 7.4, 7.62)
  f.b(F.woodDark, 0.0, W, D - 0.3, D + 0.04, 7.62, 7.8)
}

/** Dressing chest (wide, low): panelled drawers with a framed mirror above. Slot: W x 1.6. */
export function dresser(f: Frame, F: Furn) {
  const W = f.W, D = f.D
  for (const [u, v] of [[0.2, 0.2], [W - 0.2, 0.2], [0.2, D - 0.2], [W - 0.2, D - 0.2]]) f.lathe(F.woodDark, u, v, turned(0.5, 0.1))
  f.b(F.wood, 0, W, 0, D, 0.5, 2.5)
  f.b(F.carved, -0.04, W + 0.04, -0.02, D + 0.04, 2.5, 2.65)
  const n = Math.max(2, Math.round(W / 1.3))
  for (let i = 0; i < n; i++) {
    panel(f, F, (W * i) / n + 0.12, (W * (i + 1)) / n - 0.12, D, 0.7, 2.3)
    f.b(F.brassM, (W * (i + 0.5)) / n - 0.18, (W * (i + 0.5)) / n + 0.18, D + 0.05, D + 0.1, 1.45, 1.55)
  }
  f.b(F.mirror, 0.5, W - 0.5, 0.06, 0.12, 3.2, 6.4)
  f.b(F.carved, 0.4, W - 0.4, 0.02, 0.18, 6.4, 6.65); f.b(F.carved, 0.4, W - 0.4, 0.02, 0.18, 3.0, 3.2)
  f.b(F.carved, 0.4, 0.55, 0.02, 0.18, 3.2, 6.4); f.b(F.carved, W - 0.55, W - 0.4, 0.02, 0.18, 3.2, 6.4)
}

/* ------------------------------------------------------------------------------------------------ dining & storage */
/** Dining table base: turned legs and a carved apron under the top at height 2.2..2.45 (the top itself is drawn by the caller). */
export function tableLegs(f: Frame, F: Furn) {
  const W = f.W, D = f.D
  for (const [u, v] of [[0.3, 0.3], [W - 0.3, 0.3], [0.3, D - 0.3], [W - 0.3, D - 0.3]]) f.lathe(F.woodDark, u, v, turned(2.2, 0.2))
  f.b(F.carved, 0.1, W - 0.1, 0.1, D - 0.1, 1.85, 2.2)
  f.b(F.carved, -0.04, W + 0.04, -0.04, D + 0.04, 2.2, 2.28)
}

/** Sideboard / console: panelled doors, brass pulls and a brass lamp and pot on top. Slot: W x 1.5. */
export function sideboard(f: Frame, F: Furn) {
  const W = f.W, D = f.D
  for (const [u, v] of [[0.2, 0.2], [W - 0.2, 0.2], [0.2, D - 0.2], [W - 0.2, D - 0.2]]) f.lathe(F.woodDark, u, v, turned(0.45, 0.1))
  f.b(F.wood, 0, W, 0, D, 0.45, 2.9)
  f.b(F.carved, -0.04, W + 0.04, -0.02, D + 0.04, 2.9, 3.05)
  const n = Math.max(2, Math.round(W / 1.5))
  for (let i = 0; i < n; i++) {
    panel(f, F, (W * i) / n + 0.12, (W * (i + 1)) / n - 0.12, D, 0.65, 2.7)
    f.b(F.brassM, (W * (i + 0.5)) / n - 0.05, (W * (i + 0.5)) / n + 0.05, D + 0.05, D + 0.1, 1.5, 1.9)
  }
  // brass traditional lamp (a tall stem with a wide oil bowl) and a brass pot
  f.lathe(F.brassM, 0.8, D * 0.5, [[0.34, 0], [0.34, 0.06], [0.1, 0.18], [0.07, 0.5], [0.22, 0.62], [0.3, 0.7], [0.3, 0.76], [0.0, 0.76]].map(([r, h]) => [r, h] as [number, number]), 20, 3.05)
  f.lathe(F.brassM, W - 0.8, D * 0.5, [[0.0, 0], [0.26, 0.02], [0.34, 0.25], [0.2, 0.55], [0.28, 0.75], [0.0, 0.75]].map(([r, h]) => [r, h] as [number, number]), 20, 3.05)
}

/** A carved wooden mirror / picture frame with an arched, stepped crest (the focal piece of a traditional sofa wall). */
export function carvedFrameBoxes(w: number, h: number): Array<{ u0: number; u1: number; h0: number; h1: number; d: number; mat: 'carved' | 'mirror' | 'woodDark' }> {
  const m = 0.26
  return [
    { u0: 0, u1: w, h0: 0, h1: h, d: 0.12, mat: 'carved' },
    { u0: m, u1: w - m, h0: m, h1: h - m, d: 0.16, mat: 'mirror' },
    { u0: m * 0.4, u1: w - m * 0.4, h0: h, h1: h + 0.28, d: 0.14, mat: 'carved' },
    { u0: w * 0.22, u1: w * 0.78, h0: h + 0.28, h1: h + 0.62, d: 0.14, mat: 'carved' },
    { u0: w * 0.36, u1: w * 0.64, h0: h + 0.62, h1: h + 0.9, d: 0.14, mat: 'carved' },
    { u0: w * 0.45, u1: w * 0.55, h0: h + 0.9, h1: h + 1.12, d: 0.14, mat: 'woodDark' },
  ]
}
