/**
 * The customisation document: the ONE state that the desktop page, the 3D preview and the VR panel all edit and all render.  Pure data (no three.js), keyed by
 * stable identifiers: rooms by their smart-house key `${floor}:${roomId}` (the same key the lights and fans use), whole-house roles by the design-studio override key
 * (door, upholstery, ...).  Nothing here points into a scene graph, so it survives a new model, a reload and a new VR session.
 */
export type WallSide = 'N' | 'E' | 'S' | 'W'
export type PaintFinish = 'matte' | 'satin' | 'textured'
export type SurfaceFinish = 'matte' | 'satin' | 'gloss'

export interface RoomCustom {
  /** the room's four inner wall faces: a paint colour (#rrggbb) with a finish, or a wall material from the catalogue (wood panelling, stone, brick, concrete) */
  wall?: { color?: string; finish?: PaintFinish; material?: string }
  /** one wall of the room in another colour / material */
  accent?: { side: WallSide; color?: string; material?: string }
  floor?: { id: string; finish?: SurfaceFinish }
  ceiling?: { color?: string; finish?: 'matte' | 'satin' }
}

export interface CustomState {
  v: 1
  /** override key (design studio: door, windowFrame, curtains, upholstery, furnWood, cabinets, counter, bathTile, fixtures, facadeFinish, facadeColor, trim, railing) -> choice id */
  roles: Record<string, string>
  rooms: Record<string, RoomCustom>
}

export const emptyState = (): CustomState => ({ v: 1, roles: {}, rooms: {} })

export const isEmpty = (s: CustomState): boolean => Object.keys(s.roles).length === 0 && Object.values(s.rooms).every((r) => Object.keys(r).length === 0)

const HEX = /^#[0-9a-fA-F]{6}$/
const SIDES = new Set(['N', 'E', 'S', 'W'])
const PAINT = new Set(['matte', 'satin', 'textured'])
const SURF = new Set(['matte', 'satin', 'gloss'])
const ID = /^[a-z0-9_]{1,40}$/

/** Reads anything (a saved string, a project field) into a clean state; unknown / malformed parts are dropped, never thrown on. */
export function parseState(raw: unknown): CustomState {
  const out = emptyState()
  let v: unknown = raw
  if (typeof raw === 'string') { try { v = JSON.parse(raw) } catch { return out } }
  if (!v || typeof v !== 'object') return out
  const o = v as Record<string, unknown>
  if (o.roles && typeof o.roles === 'object') for (const [k, id] of Object.entries(o.roles as Record<string, unknown>)) if (/^[A-Za-z]{2,24}$/.test(k) && typeof id === 'string' && ID.test(id)) out.roles[k] = id
  if (o.rooms && typeof o.rooms === 'object') {
    for (const [key, rv] of Object.entries(o.rooms as Record<string, unknown>)) {
      if (!/^\d{1,2}:[\w.-]{1,60}$/.test(key) || !rv || typeof rv !== 'object') continue
      const r = rv as Record<string, Record<string, unknown> | undefined>
      const rc: RoomCustom = {}
      const w = r.wall
      if (w && typeof w === 'object') {
        const wall: NonNullable<RoomCustom['wall']> = {}
        if (typeof w.color === 'string' && HEX.test(w.color)) wall.color = w.color.toLowerCase()
        if (typeof w.finish === 'string' && PAINT.has(w.finish)) wall.finish = w.finish as PaintFinish
        if (typeof w.material === 'string' && ID.test(w.material)) wall.material = w.material
        if (Object.keys(wall).length) rc.wall = wall
      }
      const a = r.accent
      if (a && typeof a === 'object' && typeof a.side === 'string' && SIDES.has(a.side)) {
        const acc: NonNullable<RoomCustom['accent']> = { side: a.side as WallSide }
        if (typeof a.color === 'string' && HEX.test(a.color)) acc.color = a.color.toLowerCase()
        if (typeof a.material === 'string' && ID.test(a.material)) acc.material = a.material
        if (acc.color || acc.material) rc.accent = acc
      }
      const f = r.floor
      if (f && typeof f === 'object' && typeof f.id === 'string' && ID.test(f.id)) rc.floor = { id: f.id, ...(typeof f.finish === 'string' && SURF.has(f.finish) ? { finish: f.finish as SurfaceFinish } : {}) }
      const c = r.ceiling
      if (c && typeof c === 'object') {
        const ce: NonNullable<RoomCustom['ceiling']> = {}
        if (typeof c.color === 'string' && HEX.test(c.color)) ce.color = c.color.toLowerCase()
        if (c.finish === 'matte' || c.finish === 'satin') ce.finish = c.finish
        if (Object.keys(ce).length) rc.ceiling = ce
      }
      if (Object.keys(rc).length) out.rooms[key] = rc
    }
  }
  return out
}

/** the state without any room that is not in `keys` (a new model has other rooms: their entries are dropped, the rest is kept) */
export function pruneRooms(s: CustomState, keys: Iterable<string>): { state: CustomState; dropped: string[] } {
  const ok = new Set(keys)
  const rooms: Record<string, RoomCustom> = {}
  const dropped: string[] = []
  for (const [k, v] of Object.entries(s.rooms)) (ok.has(k) ? (rooms[k] = v) : dropped.push(k))
  return { state: { v: 1, roles: { ...s.roles }, rooms }, dropped }
}

export const sameState = (a: CustomState, b: CustomState): boolean => JSON.stringify(a) === JSON.stringify(b)
