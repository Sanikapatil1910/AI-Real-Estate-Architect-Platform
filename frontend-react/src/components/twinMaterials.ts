import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Physically based materials for the digital twin.
 *
 * Every surface is generated procedurally (no downloaded assets, so nothing to license and nothing to fetch): an albedo map,
 * a tangent-space normal map derived from a height field and a roughness map, at 256-512 px.  Textures and materials are cached
 * by their parameters and shared by every model, so switching a theme re-uses everything it has already built.
 * Texture coordinates of boxes are world-aligned (see `texBox`), so floors run on continuously from room to room and every
 * surface has a true-to-scale grain, tile or brick size in feet.
 */

export type Finish = 'matte' | 'satin' | 'gloss'
export type Rgb = [number, number, number]
export const rgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
const hexOf = (c: Rgb) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k]
const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }

/* ------------------------------------------------------------------ noise (tileable, deterministic) */
function hash(i: number, j: number, s: number): number {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
const wrap = (i: number, f: number) => ((i % f) + f) % f
/** Value noise with an integer period of fu x fv across the unit square (so the texture tiles seamlessly). */
function vnoise(u: number, v: number, fu: number, fv: number, seed: number): number {
  const x = u * fu, y = v * fv
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const a = hash(wrap(x0, fu), wrap(y0, fv), seed), b = hash(wrap(x0 + 1, fu), wrap(y0, fv), seed)
  const c = hash(wrap(x0, fu), wrap(y0 + 1, fv), seed), d = hash(wrap(x0 + 1, fu), wrap(y0 + 1, fv), seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
function fbm(u: number, v: number, base: number, oct: number, seed: number, fv = 1): number {
  let s = 0, a = 0.5, n = 0
  for (let o = 0; o < oct; o++) {
    const f = base * (1 << o)
    s += a * vnoise(u, v, f, Math.max(1, Math.round(f * fv)), seed + o * 17)
    n += a
    a *= 0.5
  }
  return s / n
}

/* ------------------------------------------------------------------ texture baking */
interface Px { r: number; g: number; b: number; h: number; rough: number }
interface Baked { map?: THREE.Texture; normal?: THREE.Texture; rough?: THREE.Texture; avg?: number }

function canvasTex(n: number, data: Uint8ClampedArray, srgb: boolean, jpeg: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = n
  c.getContext('2d')!.putImageData(new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 8
  t.userData.mimeType = jpeg ? 'image/jpeg' : 'image/png'
  return t
}

/**
 * Paint `n` x `n` pixels with `fn(u, v, px)` (u, v in 0..1) and turn the result into an albedo map, a normal map (from the
 * height field, strength `bump`) and a roughness map.  `maps` chooses which of them are produced.
 */
function bake(n: number, fn: (u: number, v: number, o: Px) => void, o: { bump?: number; albedo?: boolean; rough?: boolean; nSize?: number } = {}): Baked {
  const A = new Uint8ClampedArray(n * n * 4)
  const R = new Uint8ClampedArray(n * n * 4)
  const H = new Float32Array(n * n)
  const px: Px = { r: 255, g: 255, b: 255, h: 0, rough: 1 }
  let sr = 0, sg = 0, sb = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      px.r = 255; px.g = 255; px.b = 255; px.h = 0; px.rough = 1
      fn((x + 0.5) / n, (y + 0.5) / n, px)
      const i = y * n + x
      H[i] = px.h
      A[i * 4] = px.r; A[i * 4 + 1] = px.g; A[i * 4 + 2] = px.b; A[i * 4 + 3] = 255
      sr += px.r; sg += px.g; sb += px.b
      const rv = clamp(px.rough) * 255
      R[i * 4] = R[i * 4 + 1] = R[i * 4 + 2] = rv; R[i * 4 + 3] = 255
    }
  }
  const out: Baked = { avg: (Math.round(clamp(sr / (n * n), 0, 255)) << 16) | (Math.round(clamp(sg / (n * n), 0, 255)) << 8) | Math.round(clamp(sb / (n * n), 0, 255)) }
  if (o.albedo !== false) out.map = canvasTex(n, A, true, true)
  if (o.rough) out.rough = canvasTex(n, R, false, true)
  const bump = o.bump ?? 0
  if (bump > 0) {
    // normal map at its own (smaller) size: it is lossless PNG in the .glb, so keep it compact
    const m = o.nSize ?? n
    const N = new Uint8ClampedArray(m * m * 4)
    const st = n / m
    const hAt = (x: number, y: number) => H[(((y * st) | 0) % n + n) % n * n + ((((x * st) | 0) % n) + n) % n]
    for (let y = 0; y < m; y++) {
      for (let x = 0; x < m; x++) {
        const dx = hAt(x + 1, y) - hAt(x - 1, y)
        const dy = hAt(x, y + 1) - hAt(x, y - 1)
        let nx = -dx * bump, ny = dy * bump, nz = 1
        const l = Math.hypot(nx, ny, nz)
        nx /= l; ny /= l; nz /= l
        const i = (y * m + x) * 4
        N[i] = (nx * 0.5 + 0.5) * 255; N[i + 1] = (ny * 0.5 + 0.5) * 255; N[i + 2] = (nz * 0.5 + 0.5) * 255; N[i + 3] = 255
      }
    }
    out.normal = canvasTex(m, N, false, false)
  }
  return out
}

/* ------------------------------------------------------------------ pattern generators */
export interface PlankOpts { tone: Rgb; tileFt?: number; plankFt?: number; lenFt?: number; vary?: number; seam?: number; vertical?: boolean; grain?: number }
function plank(p: PlankOpts): { b: Baked; tileFt: number } {
  const tileFt = p.tileFt ?? 8
  const rows = Math.max(2, Math.round(tileFt / (p.plankFt ?? 0.55)))
  const segs = Math.max(1, Math.round(tileFt / (p.lenFt ?? 4)))
  const vary = p.vary ?? 0.1
  const seam = p.seam ?? 1
  const gr = p.grain ?? 1
  const n = 512
  const seamPx = 1.4 / n
  const b = bake(n, (u0, v0, o) => {
    const u = p.vertical ? v0 : u0
    const v = p.vertical ? u0 : v0
    const row = Math.floor(v * rows)
    const fr = v * rows - row
    const off = hash(row, 3, 11) * segs
    const su = u * segs + off
    const seg = Math.floor(su)
    const fs = su - seg
    const id = hash(wrap(row, rows), wrap(seg, segs * 2), 5)
    const tone = scale(p.tone, 1 + (id - 0.5) * 2 * vary)
    const warm = (hash(row, seg, 9) - 0.5) * 6
    // grain: long streaks along the plank, a finer layer, and growth-ring waves
    const g1 = fbm(u + hash(row, 2, 4), v, 3, 3, 21 + row, rows * 2)
    const g2 = vnoise(u + id, v, 18, rows * 14, 33)
    const ring = 0.5 + 0.5 * Math.sin((v * rows * 9 + g1 * 5) * Math.PI * 2)
    const gs = ((g1 - 0.5) * 0.36 + (g2 - 0.5) * 0.24 + (ring - 0.5) * 0.12) * gr
    const dEdge = Math.min(fr, 1 - fr) / rows
    const dEnd = Math.min(fs, 1 - fs) / segs
    const groove = Math.max(1 - smooth(0, seamPx * 1.6, dEdge), 1 - smooth(0, seamPx * 1.6, dEnd)) * seam
    const k = 1 + gs - groove * 0.36
    o.r = tone[0] * k + warm; o.g = tone[1] * k + warm * 0.5; o.b = tone[2] * k
    o.h = 0.5 + gs * 0.12 - groove * 0.6
    o.rough = 0.82 + (g2 - 0.5) * 0.3 + groove * 0.1
  }, { bump: 5, rough: true, nSize: 256 })
  return { b, tileFt }
}

export interface MarbleOpts { base: Rgb; vein: Rgb; veinAmt?: number; slabFt?: number; tileFt?: number; joint?: Rgb; seed?: number; scale?: number }
function marble(p: MarbleOpts): { b: Baked; tileFt: number } {
  const tileFt = p.tileFt ?? 4
  const slabs = Math.max(1, Math.round(tileFt / (p.slabFt ?? 2)))
  const amt = p.veinAmt ?? 1
  const joint = p.joint ?? mix(p.base, [90, 90, 90], 0.25)
  const sd = p.seed ?? 3
  const n = 512
  const b = bake(n, (u, v, o) => {
    const cx = Math.floor(u * slabs), cy = Math.floor(v * slabs)
    const fx = u * slabs - cx, fy = v * slabs - cy
    const id = hash(cx, cy, sd)
    // each slab looks at a different part of one larger vein field, so neighbours differ
    const ou = hash(cx, cy, sd + 5), ov = hash(cx, cy, sd + 6)
    const uu = (fx + ou) / slabs, vv = (fy + ov) / slabs
    const warp = fbm(uu * slabs, vv * slabs, 2, 4, sd + 40) * 3.2
    const w2 = fbm(uu * slabs, vv * slabs, 3, 3, sd + 60)
    const t = Math.sin(((uu * 0.8 + vv * 0.6) * slabs * (p.scale ?? 2.4) + warp) * Math.PI * 2)
    const ridge = Math.pow(1 - Math.abs(t), 6 + 8 * (1 - amt * 0.7)) // thin dark/golden veins
    const fine = Math.pow(1 - Math.abs(Math.sin(((uu * 0.3 - vv * 0.9) * slabs * 5 + w2 * 6) * Math.PI * 2)), 14) * 0.45
    const cloud = fbm(uu * slabs, vv * slabs, 3, 4, sd + 80)
    const vm = clamp((ridge * 0.95 + fine) * amt)
    let c = mix(p.base, scale(p.base, 0.93), cloud)
    c = mix(c, p.vein, vm)
    const dE = Math.min(fx, 1 - fx, fy, 1 - fy) / slabs
    const groove = 1 - smooth(0, 1.6 / n, dE)
    c = mix(c, joint, groove * 0.85)
    const tone = 1 + (id - 0.5) * 0.04
    o.r = c[0] * tone; o.g = c[1] * tone; o.b = c[2] * tone
    o.h = 0.5 - groove * 0.5 + cloud * 0.02
    o.rough = 0.5 + cloud * 0.3 + groove * 0.3
  }, { bump: 2, rough: true, nSize: 256 })
  return { b, tileFt }
}

export interface TileOpts { color: Rgb; grout: Rgb; tileFt: number; pattern?: 'grid' | 'subway' | 'mosaic' | 'inlay'; vary?: number; speck?: number; sheetFt?: number; inlay?: Rgb }
function tile(p: TileOpts): { b: Baked; tileFt: number } {
  const pat = p.pattern ?? 'grid'
  const sheet = p.sheetFt ?? Math.max(p.tileFt * (pat === 'subway' ? 2 : 1) * (pat === 'mosaic' ? 1 : 2), 1)
  const cols = Math.max(1, Math.round(sheet / (p.tileFt * (pat === 'subway' ? 2 : 1))))
  const rows = Math.max(1, Math.round(sheet / p.tileFt))
  const vary = p.vary ?? 0.05
  const n = 512
  const gw = (pat === 'mosaic' ? 1.0 : 1.7) / n
  const b = bake(n, (u, v, o) => {
    const r = Math.floor(v * rows)
    const shift = pat === 'subway' ? (r % 2) * 0.5 : 0
    const cu = u * cols + shift
    const c = Math.floor(cu)
    const fx = cu - c, fy = v * rows - r
    const id = hash(wrap(c, cols + 1), wrap(r, rows), 7)
    const dE = Math.min(fx / cols, (1 - fx) / cols, fy / rows, (1 - fy) / rows) * sheet / sheet
    const groove = 1 - smooth(gw * 0.6, gw * 1.6, dE / 1)
    const sp = vnoise(u, v, 90, 90, 5) * (p.speck ?? 0.5) + vnoise(u, v, 24, 24, 9) * 0.5
    let col = scale(p.color, 1 + (id - 0.5) * 2 * vary + (sp - 0.5) * 0.06)
    col = mix(col, p.grout, groove)
    let hh = 0.5 - groove * 0.7 + (sp - 0.5) * 0.01
    if (pat === 'inlay') {
      // red-oxide floor tile with a white eight-petal flower in the middle, a corner dot and a fine inset border (traditional verandah floor)
      const ink = p.inlay ?? [238, 228, 208]
      const dx = fx - 0.5, dy = fy - 0.5
      const rr = Math.hypot(dx, dy), th = Math.atan2(dy, dx)
      const petal = 0.27 * (0.42 + 0.58 * Math.abs(Math.cos(4 * th)))
      const flower = 1 - smooth(petal - 0.012, petal + 0.012, rr)
      const heart = 1 - smooth(0.035, 0.05, rr)
      const corner = 1 - smooth(0.045, 0.06, Math.min(Math.hypot(fx, fy), Math.hypot(1 - fx, fy), Math.hypot(fx, 1 - fy), Math.hypot(1 - fx, 1 - fy)) - 0.02)
      const bd = Math.min(fx, 1 - fx, fy, 1 - fy)
      const border = (1 - smooth(0.004, 0.012, Math.abs(bd - 0.075))) * 0.8
      const k = Math.max(flower * (1 - heart * 0.7), corner * 0.9, border) * (1 - groove)
      col = mix(col, ink, k)
      hh += k * 0.05
    }
    o.r = col[0]; o.g = col[1]; o.b = col[2]
    o.h = hh
    o.rough = 0.35 + groove * 0.6 + (sp - 0.5) * 0.1
  }, { bump: 3, rough: true, nSize: 256 })
  return { b, tileFt: sheet }
}

export interface RoofTileOpts { color: Rgb; tileFt?: number; courses?: number; cols?: number; vary?: number }
/** Clay roof tiles (Mangalore pattern): overlapping courses, each tile with two raised ribs, a lip that catches the light and a shadow under it. */
function roofTile(p: RoofTileOpts): { b: Baked; tileFt: number } {
  const tileFt = p.tileFt ?? 3
  const rows = p.courses ?? 5, cols = p.cols ?? 5
  const vary = p.vary ?? 0.16
  const n = 512
  const b = bake(n, (u, v, o) => {
    const r = Math.floor(v * rows), fy = v * rows - r
    const cu = u * cols + (r % 2) * 0.0
    const c = Math.floor(cu), fx = cu - c
    const id = hash(wrap(c, cols + 1), wrap(r, rows), 21)
    const id2 = hash(wrap(c, cols + 1), wrap(r, rows), 22)
    const lip = smooth(0.80, 0.96, fy)                          // the exposed lower edge of a tile is thicker and lit
    const shade = 1 - smooth(0.0, 0.20, fy)                      // the top of a course sits under the tile above it
    const groove = 1 - smooth(0.025, 0.085, Math.min(fx, 1 - fx))
    const rib = 0.5 + 0.5 * Math.cos((fx - 0.5) * Math.PI * 4)
    const sp = fbm(u, v, 26, 4, 31)
    const dust = vnoise(u, v, 8, 8, 77)
    let col = scale(p.color, 0.80 + id * 0.30 * (vary / 0.16) + (id2 - 0.5) * 0.08 + (sp - 0.5) * 0.22 - shade * 0.20 - groove * 0.20 + lip * 0.10)
    col = mix(col, [150, 148, 130], clamp((dust - 0.62) * 1.2, 0, 0.35) * (1 - lip))      // weathering
    o.r = col[0]; o.g = col[1]; o.b = col[2]
    o.h = lip * 0.9 + rib * 0.25 - groove * 0.5 - shade * 0.45 + (sp - 0.5) * 0.1
    o.rough = 0.72 + (sp - 0.5) * 0.2 + groove * 0.15
  }, { bump: 7, rough: true, nSize: 256 })
  return { b, tileFt }
}

export interface ConcreteOpts { color: Rgb; panels?: boolean; tileFt?: number }
function concrete(p: ConcreteOpts): { b: Baked; tileFt: number } {
  const tileFt = p.tileFt ?? 6
  const n = 512
  const b = bake(n, (u, v, o) => {
    const big = fbm(u, v, 3, 4, 71)
    const mid = fbm(u, v, 12, 3, 91)
    const pore = hash(Math.floor(u * n), Math.floor(v * n), 3) > 0.992 ? 0.55 : 1
    let k = 0.9 + (big - 0.5) * 0.28 + (mid - 0.5) * 0.12
    k *= pore
    let groove = 0
    if (p.panels) {
      const du = Math.abs(((u * 2) % 1) - 0.5), dv = Math.abs(((v * 2) % 1) - 0.5)
      groove = Math.max(1 - smooth(0, 1.6 / n, 0.5 - du), 1 - smooth(0, 1.6 / n, 0.5 - dv)) * 0.5
      k *= 1 - groove * 0.35
    }
    o.r = p.color[0] * k; o.g = p.color[1] * k; o.b = p.color[2] * k
    o.h = 0.5 + (big - 0.5) * 0.3 + (mid - 0.5) * 0.2 - (1 - pore) * 0.5 - groove
    o.rough = 0.78 + (big - 0.5) * 0.3
  }, { bump: 4, rough: true, nSize: 256 })
  return { b, tileFt }
}

/** Fine wall texture: normal map only (the colour is the material colour), so painted walls stay light in the .glb. */
function plasterNormal(coarse: number): { b: Baked; tileFt: number } {
  const n = 256
  const b = bake(n, (u, v, o) => {
    const a = fbm(u, v, 24, 3, 12), c = fbm(u, v, 6, 3, 31)
    o.h = a * 0.5 + c * (coarse * 0.8)
    o.rough = 0.85 + (a - 0.5) * 0.2
  }, { bump: 0.55 + coarse * 2.4, albedo: false, rough: false })
  return { b, tileFt: coarse > 0.4 ? 2 : 1.4 }
}

export interface StoneOpts { color: Rgb; mortar?: Rgb; vary?: number; tileFt?: number }
function stone(p: StoneOpts): { b: Baked; tileFt: number } {
  const tileFt = p.tileFt ?? 6
  const mortar = p.mortar ?? mix(p.color, [120, 116, 108], 0.55)
  const n = 512
  // courses of different heights, blocks of different lengths
  const heights = [0.14, 0.2, 0.14, 0.26, 0.14, 0.26]
  const sum = heights.reduce((a, b) => a + b, 0)
  const b = bake(n, (u, v, o) => {
    let acc = 0, row = 0, fy = 0, hh = 0.2
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i] / sum
      if (v < acc + h) { row = i; fy = (v - acc) / h; hh = h; break }
      acc += h
    }
    const blocks = row % 2 === 0 ? 3 : 4
    const off = hash(row, 1, 3)
    const su = u * blocks + off
    const bi = Math.floor(su)
    const fx = su - bi
    const id = hash(wrap(bi, blocks + 1), row, 8)
    const dE = Math.min(fx / blocks, (1 - fx) / blocks, (fy * hh), ((1 - fy) * hh))
    const mortarK = 1 - smooth(0.0015, 0.0055, dE)
    const bevel = smooth(0.0, 0.02, dE)
    const sp = fbm(u, v, 14, 4, 99)
    let c = scale(p.color, 1 + (id - 0.5) * 2 * (p.vary ?? 0.14) + (sp - 0.5) * 0.18)
    c = mix(c, mortar, mortarK)
    o.r = c[0]; o.g = c[1]; o.b = c[2]
    o.h = bevel * 0.7 + sp * 0.18 - mortarK * 0.3
    o.rough = 0.88 + (sp - 0.5) * 0.2
  }, { bump: 6, rough: true, nSize: 256 })
  return { b, tileFt }
}

export interface BrickOpts { color: Rgb; mortar?: Rgb; tileFt?: number }
function brick(p: BrickOpts): { b: Baked; tileFt: number } {
  const tileFt = p.tileFt ?? 3.5
  const rows = 16, cols = 5
  const mortar = p.mortar ?? [196, 190, 178]
  const n = 512
  const b = bake(n, (u, v, o) => {
    const r = Math.floor(v * rows)
    const cu = u * cols + (r % 2) * 0.5
    const c = Math.floor(cu)
    const fx = cu - c, fy = v * rows - r
    const id = hash(wrap(c, cols + 1), r, 4)
    const dE = Math.min(fx / cols, (1 - fx) / cols, fy / rows, (1 - fy) / rows)
    const m = 1 - smooth(0.0016, 0.0062, dE)
    const sp = fbm(u, v, 40, 3, 4)
    let col = scale(p.color, 0.82 + id * 0.3 + (sp - 0.5) * 0.2)
    col = mix(col, mortar, m)
    o.r = col[0]; o.g = col[1]; o.b = col[2]
    o.h = (1 - m) * 0.7 + sp * 0.12
    o.rough = 0.9
  }, { bump: 5, rough: true, nSize: 256 })
  return { b, tileFt }
}

export interface GraniteOpts { base: Rgb; speck: Rgb; speck2?: Rgb; density?: number; tileFt?: number }
function granite(p: GraniteOpts): { b: Baked; tileFt: number } {
  const n = 512
  const dens = p.density ?? 0.18
  const b = bake(n, (u, v, o) => {
    const ix = Math.floor(u * n), iy = Math.floor(v * n)
    const h1 = hash(ix >> 1, iy >> 1, 17), h2 = hash(ix, iy, 23)
    const cl = fbm(u, v, 8, 4, 3)
    let c = mix(p.base, scale(p.base, 0.88), cl)
    if (h1 < dens) c = mix(c, p.speck, 0.8)
    else if (h2 < dens * 0.6) c = mix(c, p.speck2 ?? scale(p.base, 1.18), 0.8)
    o.r = c[0]; o.g = c[1]; o.b = c[2]
    o.h = 0.5 + (h1 < dens ? -0.05 : 0)
    o.rough = 0.35 + cl * 0.15
  }, { bump: 0.6, rough: true, nSize: 128 })
  return { b, tileFt: p.tileFt ?? 3 }
}

function weave(strength: number, coarse: boolean): { b: Baked; tileFt: number } {
  const n = 128
  const f = coarse ? 36 : 24
  const b = bake(n, (u, v, o) => {
    const a = Math.sin(u * f * Math.PI * 2), c = Math.sin(v * f * Math.PI * 2)
    const nz = vnoise(u, v, 32, 32, 6)
    o.h = (a * c * 0.25 + 0.25) * strength + nz * (coarse ? 0.45 : 0.15)
    o.rough = 0.92
  }, { bump: 1.3, albedo: false, rough: false })
  return { b, tileFt: coarse ? 1.0 : 0.5 }
}

function grass(base: Rgb): { b: Baked; tileFt: number } {
  const n = 512
  const b = bake(n, (u, v, o) => {
    const a = fbm(u, v, 6, 4, 40), c = vnoise(u, v, 160, 160, 3), d = fbm(u, v, 22, 3, 52)
    const k = 0.92 + (a - 0.5) * 0.5 + (c - 0.5) * 0.3 + (d - 0.5) * 0.2
    const gr = (base[0] + base[1] + base[2]) / 3 // keep the lawn natural rather than saturated
    o.r = (base[0] * 0.55 + gr * 0.45) * k * (0.92 + a * 0.12); o.g = (base[1] * 0.55 + gr * 0.45) * k; o.b = (base[2] * 0.55 + gr * 0.45) * k * 0.9
    o.h = c * 0.4 + d * 0.3
    o.rough = 1
  }, { bump: 1.6, rough: false, nSize: 256 })
  return { b, tileFt: 10 }
}

function paving(base: Rgb, joint: Rgb): { b: Baked; tileFt: number } {
  const n = 512
  const b = bake(n, (u, v, o) => {
    const r = Math.floor(v * 8)
    const cu = u * 4 + (r % 2) * 0.5
    const c = Math.floor(cu)
    const fx = cu - c, fy = v * 8 - r
    const id = hash(wrap(c, 5), r, 13)
    const dE = Math.min(fx / 4, (1 - fx) / 4, fy / 8, (1 - fy) / 8)
    const m = 1 - smooth(0.002, 0.006, dE)
    const sp = fbm(u, v, 30, 3, 8)
    let col = scale(base, 0.88 + id * 0.22 + (sp - 0.5) * 0.14)
    col = mix(col, joint, m)
    o.r = col[0]; o.g = col[1]; o.b = col[2]
    o.h = (1 - m) * 0.5 + sp * 0.1
    o.rough = 0.9
  }, { bump: 3, rough: false, nSize: 256 })
  return { b, tileFt: 4 }
}

export type RugPattern = 'chevron' | 'diamond' | 'stripe' | 'geo' | 'plain' | 'medallion'
export interface RugOpts { a: Rgb; b: Rgb; pattern: RugPattern }
function rugTex(p: RugOpts): { b: Baked; tileFt: number } {
  const n = 256
  const b = bake(n, (u, v, o) => {
    let t = 0
    if (p.pattern === 'chevron') {
      const k = 6
      const tri = Math.abs(((u * 4) % 1) - 0.5) * 2
      t = Math.floor((v * k + tri * 0.9) % 2) === 0 ? 0 : 1
      t = ((Math.floor(v * k + tri * 0.9)) & 1)
    } else if (p.pattern === 'diamond') {
      const d = Math.abs(((u * 4) % 1) - 0.5) + Math.abs(((v * 4) % 1) - 0.5)
      t = d < 0.38 ? ((d < 0.18) ? 0 : 1) : 0
    } else if (p.pattern === 'stripe') {
      t = Math.floor(v * 10) % 3 === 0 ? 1 : 0
    } else if (p.pattern === 'geo') {
      const q = (Math.floor(u * 8) + Math.floor(v * 8)) & 1
      const r = Math.abs(((u * 8) % 1) - 0.5) + Math.abs(((v * 8) % 1) - 0.5)
      t = q ? (r < 0.5 ? 1 : 0) : 0
    }
    let tone = t
    if (p.pattern === 'medallion') {
      // a traditional carpet laid out once over the whole rug: border bands, a field of small diamonds and a central medallion
      const bdr = Math.min(u, 1 - u, v, 1 - v)
      const band = bdr < 0.06 ? 1 : bdr < 0.085 ? 0 : bdr < 0.11 ? 1 : bdr < 0.125 ? 0 : -1
      const cx = u - 0.5, cy = v - 0.5
      const med = Math.abs(cx) / 0.3 + Math.abs(cy) / 0.34
      const dia = Math.abs(((u * 9) % 1) - 0.5) + Math.abs(((v * 9) % 1) - 0.5)
      if (band >= 0) tone = band
      else if (med < 0.55) tone = med < 0.22 ? 0 : med < 0.4 ? 1 : 0
      else if (med < 0.72) tone = 1
      else tone = dia < 0.22 ? 1 : 0
    }
    const pile = vnoise(u, v, 100, 100, 5)
    const c = scale(mix(p.a, p.b, tone), 0.93 + pile * 0.14)
    o.r = c[0]; o.g = c[1]; o.b = c[2]
    o.h = pile * 0.5
    o.rough = 1
  }, { bump: 1.2, rough: false, nSize: 128 })
  return { b, tileFt: 5 }
}

/* ------------------------------------------------------------------ surfaces */
export type SurfaceKind =
  | 'plank' | 'marble' | 'tile' | 'concrete' | 'plaster' | 'stone' | 'brick' | 'granite' | 'fabric'
  | 'grass' | 'paving' | 'rug' | 'solid' | 'metal' | 'glass' | 'emissive' | 'rooftile'

export interface Surface {
  kind: SurfaceKind
  color?: number            // base colour (tint); for texture kinds the colour comes from the generator parameters
  plank?: PlankOpts
  marble?: MarbleOpts
  tile?: TileOpts
  concrete?: ConcreteOpts
  stone?: StoneOpts
  brick?: BrickOpts
  granite?: GraniteOpts
  rooftile?: RoofTileOpts
  rug?: RugOpts
  coarse?: number           // plaster: 0 smooth .. 1 stucco; fabric: 1 = coarse weave
  finish?: Finish
  rough?: number            // explicit roughness for solid / metal
  metal?: number
  opacity?: number
  glow?: number
  tileFt?: number
}

const FIN: Record<Finish, number> = { matte: 1.0, satin: 0.62, gloss: 0.3 }
const texCache = new Map<string, { b: Baked; tileFt: number }>()
const matCache = new Map<string, THREE.MeshStandardMaterial>()
const keyOf = (s: Surface) => JSON.stringify(s)

function texFor(s: Surface): { b: Baked; tileFt: number } | null {
  const k = 'T' + JSON.stringify({ ...s, finish: undefined, color: undefined, rough: undefined, metal: undefined, opacity: undefined, glow: undefined })
  const hit = texCache.get(k)
  if (hit) return hit
  let t: { b: Baked; tileFt: number } | null = null
  switch (s.kind) {
    case 'plank': t = plank(s.plank!); break
    case 'marble': t = marble(s.marble!); break
    case 'tile': t = tile(s.tile!); break
    case 'concrete': t = concrete(s.concrete!); break
    case 'plaster': t = plasterNormal(s.coarse ?? 0); break
    case 'stone': t = stone(s.stone!); break
    case 'brick': t = brick(s.brick!); break
    case 'granite': t = granite(s.granite!); break
    case 'fabric': t = weave(0.6, (s.coarse ?? 0) > 0.5); break
    case 'grass': t = grass(rgb(s.color ?? 0x6a9a4a)); break
    case 'paving': t = paving(rgb(s.color ?? 0xb8b2a6), [140, 136, 128]); break
    case 'rug': t = rugTex(s.rug!); break
    case 'rooftile': t = roofTile(s.rooftile!); break
    default: t = null
  }
  if (t) texCache.set(k, t)
  return t
}

/** The shared material for a surface description. */
export function surface(s: Surface): THREE.MeshStandardMaterial {
  const key = keyOf(s)
  const hit = matCache.get(key)
  if (hit) return hit
  const fin = FIN[s.finish ?? 'satin']
  let m: THREE.MeshStandardMaterial
  if (s.kind === 'glass') {
    m = new THREE.MeshStandardMaterial({ color: s.color ?? 0xcfe6ee, roughness: 0.04, metalness: 0.0, transparent: true, opacity: s.opacity ?? 0.28, depthWrite: false, envMapIntensity: 1.6 })
  } else if (s.kind === 'metal') {
    m = new THREE.MeshStandardMaterial({ color: s.color ?? 0xcdd3d6, roughness: s.rough ?? 0.3, metalness: s.metal ?? 1 })
  } else if (s.kind === 'emissive') {
    m = new THREE.MeshStandardMaterial({ color: s.color ?? 0xfff0d0, emissive: s.color ?? 0xfff0d0, emissiveIntensity: s.glow ?? 1, roughness: 0.6 })
  } else if (s.kind === 'solid') {
    m = new THREE.MeshStandardMaterial({ color: s.color ?? 0xcccccc, roughness: s.rough ?? 0.8, metalness: s.metal ?? 0 })
  } else {
    const t = texFor(s)
    const glossy = s.kind === 'marble' || s.kind === 'granite' || (s.kind === 'plank' && s.finish === 'gloss') || (s.kind === 'tile' && s.finish !== 'matte')
    const base: Partial<THREE.MeshPhysicalMaterialParameters> = {
      color: s.kind === 'plaster' || s.kind === 'fabric' || s.kind === 'grass' || s.kind === 'paving' ? (s.color ?? 0xffffff) : 0xffffff,
      map: t?.b.map ?? null,
      normalMap: t?.b.normal ?? null,
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: t?.b.rough ?? null,
      roughness: s.kind === 'fabric' ? 0.95 : s.kind === 'plaster' ? (s.finish === 'gloss' ? 0.4 : s.finish === 'satin' ? 0.6 : 0.92) : s.kind === 'grass' || s.kind === 'paving' ? 1 : fin,
      metalness: 0,
    }
    if (glossy && (s.finish ?? 'satin') !== 'matte') {
      m = new THREE.MeshPhysicalMaterial({ ...base, clearcoat: s.finish === 'gloss' ? 0.8 : 0.35, clearcoatRoughness: s.finish === 'gloss' ? 0.06 : 0.18 })
    } else m = new THREE.MeshStandardMaterial(base as THREE.MeshStandardMaterialParameters)
    m.userData.tileFt = s.tileFt ?? t?.tileFt ?? 0
    if (t?.b.map && t.b.avg !== undefined) m.userData.planColor = t.b.avg
    if (s.kind === 'rug') { m.userData.rug = true; if (s.rug?.pattern === 'medallion') m.userData.fit = true }
    m.name = s.kind === 'rooftile' ? 'roof_tile_clay' : s.kind
  }
  m.userData.shared = true
  m.userData.surface = s.kind
  matCache.set(key, m)
  return m
}

/** Quick helper for a plain painted / coloured material. */
export const solid = (color: number, rough = 0.8, metal = 0): THREE.MeshStandardMaterial => surface({ kind: 'solid', color, rough, metal })
export const metal = (color: number, rough = 0.3): THREE.MeshStandardMaterial => surface({ kind: 'metal', color, rough })
export const glassMat = (opacity = 0.28, tint = 0xcfe6ee): THREE.MeshStandardMaterial => surface({ kind: 'glass', opacity, color: tint })

/* ------------------------------------------------------------------ geometry with true-scale texture coordinates */
/**
 * A box from (x0,y0,z0) to (x1,y1,z1) whose uv coordinates are world feet divided by the material's `tileFt`: grain, tiles and
 * bricks have their real size, and floors / walls that touch carry the same pattern on across the joint.  Materials without a
 * texture get the default 0..1 uv.
 */
export function texBox(mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
  worldUV(g, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  return g
}

/** Give any geometry (centred at cx,cy,cz once placed) world-aligned uv: feet / the material's `tileFt`. */
export function worldUV(g: THREE.BufferGeometry, mat: THREE.Material, cx: number, cy: number, cz: number): void {
  const tile = (mat.userData?.tileFt as number) || 0
  if (!tile) return
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nor = g.getAttribute('normal') as THREE.BufferAttribute
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i))
    let u: number, v: number
    if (ay > 0.5) { u = x; v = z } else if (ax > 0.5) { u = z; v = y } else { u = x; v = y }
    uv.setXY(i, u / tile, v / tile)
  }
  uv.needsUpdate = true
}

/** A box with a material per face (+x, -x, +y, -y, +z, -z): every face gets world-aligned uv at its own material's scale. */
export function texBoxMulti(mats: THREE.Material[], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nor = g.getAttribute('normal') as THREE.BufferAttribute
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let f = 0; f < 6; f++) {
    const tile = (mats[f].userData?.tileFt as number) || 0
    if (!tile) continue
    for (let i = f * 4; i < f * 4 + 4; i++) {
      const x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz
      const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i))
      let u: number, v: number
      if (ay > 0.5) { u = x; v = z } else if (ax > 0.5) { u = z; v = y } else { u = x; v = y }
      uv.setXY(i, u / tile, v / tile)
    }
  }
  uv.needsUpdate = true
  return g
}

/** Boxes whose texture should be laid out over the whole top face (rugs): uv 0..1 scaled by size / tile. */
export function rugBox(mat: THREE.Material, w: number, d: number, t: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, t, d)
  const tile = (mat.userData?.tileFt as number) || 5
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  const nor = g.getAttribute('normal') as THREE.BufferAttribute
  if (mat.userData?.fit) return g              // a medallion carpet is laid out once over the whole rug
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile)
  }
  return g
}

/* ------------------------------------------------------------------ merging (one draw call per material) */
/**
 * Merge the static meshes directly under `group` that share a material into one mesh each.  The shapes, positions and materials
 * are unchanged (the vertices are baked with each mesh's own matrix); it only cuts the number of draw calls, which makes the
 * viewer, the ambient-occlusion pass and the shadow map several times cheaper.  Sprites, lines, lights and sub-groups are kept.
 */
export function mergeByMaterial(group: THREE.Group): void {
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const keep: THREE.Object3D[] = []
  group.updateMatrixWorld(true)
  for (const o of [...group.children]) {
    const m = o as THREE.Mesh
    if (!m.isMesh || Array.isArray(m.material) || !m.geometry || !m.geometry.index || m.userData.keep) { keep.push(o); continue }
    const geo = m.geometry.clone()
    o.updateMatrix()
    geo.applyMatrix4(o.matrix)
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name)
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2))
    const list = buckets.get(m.material) ?? []
    list.push(geo)
    buckets.set(m.material, list)
    m.geometry.dispose()
  }
  group.clear()
  for (const o of keep) group.add(o)
  for (const [mat, list] of buckets) {
    const merged = mergeGeometries(list, false)
    list.forEach((g) => g.dispose())
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, mat)
    const transparent = (mat as THREE.Material).transparent
    mesh.castShadow = !transparent
    mesh.receiveShadow = true
    group.add(mesh)
  }
}

export { hexOf, rgb as toRgb, mix as mixRgb }
