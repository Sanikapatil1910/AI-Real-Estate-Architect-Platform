/**
 * Reads and validates a Smart House sidecar (`realestate.smart-house/1`), the same file the website's "Smart-house data (.json)" button writes
 * and `buildSmartHouse(plan)` (src/lib/smartHouse.ts) produces.  No schema change was needed for the browser version.
 */
import { SMART_HOUSE_SCHEMA } from '../../lib/smartHouse'
import type { SmartHouse, SmartRoom } from '../../lib/smartHouse'

export type { SmartHouse, SmartRoom }

export class SmartHouseFormatError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SmartHouseFormatError' }
}

export const roomKey = (r: Pick<SmartRoom, 'floor' | 'id'>): string => `${r.floor}:${r.id}`

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isV3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum)

function anchor(a: unknown, what: string): void {
  if (a === null || a === undefined) return
  const o = a as Record<string, unknown>
  if (!o || typeof o !== 'object' || !isV3(o.pos) || !isV3(o.normal)) throw new SmartHouseFormatError(`${what} has no valid position / normal.`)
}

/** Throws SmartHouseFormatError with a message a person can act on; never returns a half-valid document. */
export function parseSmartHouse(input: unknown): SmartHouse {
  let root: unknown = input
  if (typeof input === 'string') {
    try { root = JSON.parse(input) } catch { throw new SmartHouseFormatError('The smart-house data is not valid JSON.') }
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new SmartHouseFormatError('The smart-house data is not a JSON object.')
  const d = root as Partial<SmartHouse>
  if (!d.schema || !String(d.schema).startsWith('realestate.smart-house')) throw new SmartHouseFormatError(`Not a smart-house file (schema '${String(d.schema ?? '')}').`)
  if (d.schema !== SMART_HOUSE_SCHEMA) throw new SmartHouseFormatError(`Unsupported smart-house schema '${d.schema}' (this viewer reads '${SMART_HOUSE_SCHEMA}'). Re-save the project to regenerate it.`)
  if (d.units !== 'feet') throw new SmartHouseFormatError(`Unsupported units '${String(d.units)}' (expected feet).`)
  if (!Array.isArray(d.rooms) || d.rooms.length === 0) throw new SmartHouseFormatError('The smart-house data has no rooms.')
  if (!Array.isArray(d.floors) || d.floors.length === 0) throw new SmartHouseFormatError('The smart-house data has no floors.')
  const seen = new Set<string>()
  for (const r of d.rooms as SmartRoom[]) {
    if (!r || typeof r.id !== 'string' || !r.id) throw new SmartHouseFormatError('A room has no id.')
    if (!Number.isInteger(r.floor) || r.floor < 0) throw new SmartHouseFormatError(`Room ${r.id} has no valid floor.`)
    const k = roomKey(r)
    if (seen.has(k)) throw new SmartHouseFormatError(`Duplicate room ${k}.`)
    seen.add(k)
    const rc = r.rect
    if (!rc || ![rc.x0, rc.z0, rc.x1, rc.z1].every(isNum) || rc.x1 <= rc.x0 || rc.z1 <= rc.z0) throw new SmartHouseFormatError(`Room ${k} has no valid rectangle.`)
    if (!isNum(r.floor_y) || !isNum(r.ceiling_y) || r.ceiling_y <= r.floor_y) throw new SmartHouseFormatError(`Room ${k} has invalid floor / ceiling heights.`)
    if (!r.light || !isV3(r.light.pos) || !isNum(r.light.range_ft)) throw new SmartHouseFormatError(`Room ${k} has no valid light.`)
    if (r.fan) {
      if (!isV3(r.fan.pos) || !isNum(r.fan.blade_radius_ft) || r.fan.blade_radius_ft <= 0) throw new SmartHouseFormatError(`Room ${k} has an invalid fan.`)
    }
    anchor(r.switch, `Room ${k} switch`)
    anchor(r.regulator, `Room ${k} regulator`)
  }
  return d as SmartHouse
}

/** Which room a point (feet, the .glb frame) is in: x/z inside the room rectangle and y between its floor and ceiling. */
export class RoomLocator {
  constructor(private readonly rooms: SmartRoom[]) {}
  locate(x: number, y: number, z: number): string | null {
    for (const r of this.rooms) {
      const c = r.rect
      if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1 && y >= r.floor_y - 0.5 && y <= r.ceiling_y + 0.2) return roomKey(r)
    }
    return null
  }
}
