/** Draws a PanelLayout (see smart/panel.ts) into a 2D canvas: used as the texture of the in-VR panel. */
import type { PanelLayout, PanelButton } from './smart/panel'

const FILL: Record<PanelButton['kind'], string> = { primary: '#2d6cdf', on: '#2f8f4e', off: '#58504a', neutral: '#3d4655', danger: '#b23b30', disabled: '#2a2d33' }
const HOVER: Record<PanelButton['kind'], string> = { primary: '#4a85f0', on: '#3fb866', off: '#7a6f66', neutral: '#566178', danger: '#d65346', disabled: '#2a2d33' }

export function drawPanel(ctx: CanvasRenderingContext2D, L: PanelLayout, hoverId: string | null): void {
  const { width: W, height: H } = L
  ctx.clearRect(0, 0, W, H)
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#242a35'); bg.addColorStop(1, '#171b23')
  ctx.fillStyle = bg
  roundRect(ctx, 0, 0, W, H, 28); ctx.fill()
  ctx.strokeStyle = '#d9c9a0'; ctx.lineWidth = 3; roundRect(ctx, 3, 3, W - 6, H - 6, 26); ctx.stroke()
  for (const b of L.buttons) {
    ctx.fillStyle = b.swatch ?? (b.id === hoverId && b.action ? HOVER[b.kind] : FILL[b.kind])
    roundRect(ctx, b.x, b.y, b.w, b.h, 10); ctx.fill()
    if (b.selected) { ctx.strokeStyle = '#ffd866'; ctx.lineWidth = 6; roundRect(ctx, b.x + 3, b.y + 3, b.w - 6, b.h - 6, 8); ctx.stroke() }
    if (b.id === hoverId && b.action) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; roundRect(ctx, b.x, b.y, b.w, b.h, 10); ctx.stroke() }
    ctx.fillStyle = b.swatch ? (lightHex(b.swatch) ? '#16181d' : '#ffffff') : b.kind === 'disabled' ? '#6c7079' : '#ffffff'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = `${b.size ?? (b.label.length > 12 ? 20 : b.label.length > 6 ? 24 : 32)}px system-ui, sans-serif`
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1)
  }
  ctx.textBaseline = 'alphabetic'
  for (const t of L.texts) {
    ctx.fillStyle = t.color
    ctx.textAlign = t.align ?? 'left'
    ctx.font = `${t.weight ?? 400} ${t.size}px system-ui, sans-serif`
    ctx.fillText(t.text, t.x, t.y)
  }
}

/** whether a #rrggbb colour is light (dark text reads on it) */
export function lightHex(h: string): boolean {
  const n = parseInt(h.slice(1), 16)
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}

/** a cheap signature of what the layout shows, to redraw only when something visible changed */
export function layoutSignature(L: PanelLayout, hoverId: string | null): string {
  let s = hoverId ?? '-'
  for (const b of L.buttons) s += `|${b.id}:${b.label}:${b.kind}:${b.selected ? 1 : 0}:${b.swatch ?? ''}`
  for (const t of L.texts) s += `|${t.text}`
  return s
}
