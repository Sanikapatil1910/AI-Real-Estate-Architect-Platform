/** Wall bands for the 2D plan: exterior 230 mm, interior 120 mm (feet), merged along each wall line. */
export const WALL_EXT_FT = 230 / 304.8
export const WALL_INT_FT = 120 / 304.8

export interface WallRoom { room_type: string; x: number; y: number; width: number; length: number; x2?: number; y2?: number }
export interface WallBand { axis: 'h' | 'v'; c: number; a: number; b: number; t: number; kind: 'ext' | 'int' | 'low' }

const OPEN = new Set(['open_terrace', 'balcony', 'parking'])
const k2 = (n: number) => Math.round(n * 100) / 100

function mergeIv(iv: Array<[number, number]>): Array<[number, number]> {
  const s = [...iv].sort((p, q) => p[0] - q[0])
  const out: Array<[number, number]> = []
  for (const v of s) {
    const last = out[out.length - 1]
    if (last && v[0] <= last[1] + 0.02) last[1] = Math.max(last[1], v[1])
    else out.push([v[0], v[1]])
  }
  return out
}

export function wallBands(rooms: WallRoom[]): WallBand[] {
  const closed = rooms.filter((r) => !OPEN.has(r.room_type))
  const all = rooms
  if (!all.length) return []
  const x2 = (r: WallRoom) => r.x2 ?? r.x + r.width
  const y2 = (r: WallRoom) => r.y2 ?? r.y + r.length
  const bx0 = Math.min(...all.map((r) => r.x)), bx1 = Math.max(...all.map(x2))
  const by0 = Math.min(...all.map((r) => r.y)), by1 = Math.max(...all.map(y2))
  const lines = new Map<string, { axis: 'h' | 'v'; c: number; solid: Array<[number, number]>; low: Array<[number, number]> }>()
  const touch = (axis: 'h' | 'v', c: number) => {
    const key = `${axis}${k2(c)}`
    if (!lines.has(key)) lines.set(key, { axis, c: k2(c), solid: [], low: [] })
    return lines.get(key)!
  }
  for (const r of all) {
    const open = OPEN.has(r.room_type)
    const edges: Array<['h' | 'v', number, number, number]> = [
      ['h', r.y, r.x, x2(r)], ['h', y2(r), r.x, x2(r)], ['v', r.x, r.y, y2(r)], ['v', x2(r), r.y, y2(r)],
    ]
    for (const [axis, c, a, b] of edges) {
      const ln = touch(axis, c)
      if (!open) ln.solid.push([a, b])
      else ln.low.push([a, b])
    }
  }
  void closed
  const out: WallBand[] = []
  const cuts = passageOpenings(all)
  for (const ln of lines.values()) {
    const ext = ln.axis === 'h' ? ln.c <= by0 + 0.01 || ln.c >= by1 - 0.01 : ln.c <= bx0 + 0.01 || ln.c >= bx1 - 0.01
    const solid = cutIntervals(mergeIv(ln.solid), ln.axis, ln.c, cuts)
    for (const [a, b] of solid) out.push({ axis: ln.axis, c: ln.c, a, b, t: ext ? WALL_EXT_FT : WALL_INT_FT, kind: ext ? 'ext' : 'int' })
    for (const [a, b] of mergeIv(ln.low)) {
      if (solid.some(([sa, sb]) => sa <= a + 0.02 && sb >= b - 0.02)) continue
      out.push({ axis: ln.axis, c: ln.c, a, b, t: WALL_INT_FT, kind: 'low' })
    }
  }
  return out
}

/* A passage is not a walled strip: where it runs alongside a living / dining / lounge / stair space the side is open
 * (no wall), so a corridor never has walls on both its sides there. */
const OPEN_PLAN = new Set(['living_room', 'dining', 'family_lounge', 'staircase', 'courtyard'])
export interface Cut { axis: 'h' | 'v'; c: number; a: number; b: number }

export function passageOpenings(rooms: WallRoom[]): Cut[] {
  const x2 = (r: WallRoom) => r.x2 ?? r.x + r.width
  const y2 = (r: WallRoom) => r.y2 ?? r.y + r.length
  const out: Cut[] = []
  for (const p of rooms) {
    if (p.room_type !== 'passage') continue
    for (const n of rooms) {
      if (n === p || !OPEN_PLAN.has(n.room_type)) continue
      for (const [pc, nc] of [[y2(p), n.y], [p.y, y2(n)]] as Array<[number, number]>) {
        if (Math.abs(pc - nc) < 0.05) {
          const a = Math.max(p.x, n.x), b = Math.min(x2(p), x2(n))
          if (b - a > 1) out.push({ axis: 'h', c: pc, a, b })
        }
      }
      for (const [pc, nc] of [[x2(p), n.x], [p.x, x2(n)]] as Array<[number, number]>) {
        if (Math.abs(pc - nc) < 0.05) {
          const a = Math.max(p.y, n.y), b = Math.min(y2(p), y2(n))
          if (b - a > 1) out.push({ axis: 'v', c: pc, a, b })
        }
      }
    }
  }
  return out
}

/** `iv` minus the cuts that lie on the same wall line */
export function cutIntervals(iv: Array<[number, number]>, axis: 'h' | 'v', c: number, cuts: Cut[]): Array<[number, number]> {
  let cur = iv
  for (const k of cuts) {
    if (k.axis !== axis || Math.abs(k.c - c) > 0.05) continue
    const next: Array<[number, number]> = []
    for (const [a, b] of cur) {
      if (k.b <= a || k.a >= b) { next.push([a, b]); continue }
      if (k.a > a) next.push([a, k.a])
      if (k.b < b) next.push([k.b, b])
    }
    cur = next
  }
  return cur
}
