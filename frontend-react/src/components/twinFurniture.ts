import * as THREE from 'three'

/** Finishes (floors, wall themes) for the digital twin; the furniture itself lives in twinInterior.ts. */
export { furnishRoom } from './twinInterior'
export type { Obstacles, RoomR, Wall } from './twinInterior'

/* ---------------- finishes ---------------- */
function canvasTex(draw: (c: CanvasRenderingContext2D, n: number) => void, n = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = n
  draw(c.getContext('2d')!, n)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
let _wood: THREE.CanvasTexture | null = null
let _tile: THREE.CanvasTexture | null = null
let _marble: THREE.CanvasTexture | null = null
function woodTex() {
  return (_wood ??= canvasTex((c, n) => {
    const tones = ['#b98a5a', '#c39565', '#ad7f50', '#bf9060']
    for (let i = 0; i < 4; i++) { c.fillStyle = tones[i]; c.fillRect(0, (i * n) / 4, n, n / 4) }
    c.strokeStyle = 'rgba(70,40,15,0.35)'; c.lineWidth = 2
    for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(0, (i * n) / 4); c.lineTo(n, (i * n) / 4); c.stroke() }
    c.strokeStyle = 'rgba(70,40,15,0.12)'; c.lineWidth = 1
    for (let i = 0; i < 24; i++) { const yy = Math.random() * n; c.beginPath(); c.moveTo(0, yy); c.lineTo(n, yy + (Math.random() - 0.5) * 4); c.stroke() }
  }))
}
function tileTex() {
  return (_tile ??= canvasTex((c, n) => {
    c.fillStyle = '#e9edf0'; c.fillRect(0, 0, n, n)
    c.strokeStyle = '#aab3ba'; c.lineWidth = 3; c.strokeRect(0, 0, n, n)
  }))
}
function marbleTex() {
  return (_marble ??= canvasTex((c, n) => {
    c.fillStyle = '#f1eee8'; c.fillRect(0, 0, n, n)
    c.strokeStyle = 'rgba(120,115,105,0.35)'; c.lineWidth = 1.2
    for (let i = 0; i < 7; i++) { c.beginPath(); c.moveTo(Math.random() * n, 0); c.bezierCurveTo(Math.random() * n, n * 0.3, Math.random() * n, n * 0.7, Math.random() * n, n); c.stroke() }
    c.strokeStyle = '#c8c3b8'; c.lineWidth = 2.5; c.strokeRect(0, 0, n, n)
  }))
}

export type FloorStyle = 'colour' | 'wood' | 'marble'
const WET = new Set(['bathroom', 'toilet', 'kitchen', 'utility', 'balcony', 'open_terrace', 'staircase', 'passage'])

export function floorMaterial(type: string, style: FloorStyle, w: number, d: number, base: number): THREE.MeshStandardMaterial {
  if (style === 'colour') return new THREE.MeshStandardMaterial({ color: base, roughness: 0.95 })
  let tex: THREE.CanvasTexture
  if (style === 'wood' && !WET.has(type)) tex = woodTex()
  else if (style === 'marble' && !WET.has(type)) tex = marbleTex()
  else tex = tileTex()
  const t = tex.clone()
  t.needsUpdate = true
  t.repeat.set(Math.max(1, w / 3), Math.max(1, d / 3))
  return new THREE.MeshStandardMaterial({ map: t, roughness: style === 'wood' ? 0.7 : 0.35, color: WET.has(type) ? 0xffffff : 0xffffff })
}

export type WallTheme = 'ivory' | 'grey' | 'sand' | 'sage'
export const WALL_THEMES: Record<WallTheme, { inner: number; outer: number; label: string }> = {
  ivory: { inner: 0xf3efe8, outer: 0xe9e2d6, label: 'Ivory' },
  grey: { inner: 0xe4e6e8, outer: 0xb9bfc4, label: 'Grey' },
  sand: { inner: 0xf0e2c8, outer: 0xd6b88a, label: 'Sand' },
  sage: { inner: 0xe8efe3, outer: 0xa9bf9c, label: 'Sage' },
}
