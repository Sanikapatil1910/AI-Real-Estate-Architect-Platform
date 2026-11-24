/**
 * Walkable surfaces of a stair, taken from the SAME geometry the 3D builder uses (stairLocal / toPlanRect), for the VR walk-through.
 * Pure data, no three.js.  The builder registers them here as it draws each flight; the VR loader reads them after the build.
 * Units: feet, model frame (x, z in the plan, y up).  Nothing here changes what is drawn.
 */
import { stairLocal, toPlanRect } from './stairSpec'
import type { RoomR, StairSpec } from './stairSpec'

/** A flat walkable quad (4 corners, x/z in feet) at an absolute height. */
export interface WalkPatch { pts: Array<[number, number]>; top: number; kind: 'tread' | 'landing' }

let PATCHES: WalkPatch[] = []
export function resetStairWalk(): void { PATCHES = [] }
export function takeStairWalk(): WalkPatch[] { return PATCHES.slice() }
export function registerStairWalk(p: WalkPatch[]): void { PATCHES.push(...p) }

/** The treads and landings of one stair flight set on the floor whose surface is at `lvl`. */
export function stairWalkPatches(r: RoomR, lvl: number, spec: StairSpec, entryHigh = false): WalkPatch[] {
  const P = toPlanRect(r, entryHigh, spec.axis)
  const G = stairLocal(spec, P.L, P.W)
  const out: WalkPatch[] = []
  const rect = (u0: number, u1: number, v0: number, v1: number, top: number, kind: WalkPatch['kind']) => {
    const b = P.map(u0, u1, v0, v1)
    out.push({ pts: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], top: lvl + top, kind })
  }
  for (const t of G.treads) {
    if (t.rot) {
      const { cu, cv, ang, len, wid } = t.rot
      const c = Math.cos(ang), s = Math.sin(ang)
      const q = ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as Array<[number, number]>).map(([a, b]) => {
        const p = P.pt(cu + (a * len * c) / 2 - (b * wid * s) / 2, cv + (a * len * s) / 2 + (b * wid * c) / 2)
        return [p.x, p.y] as [number, number]
      })
      out.push({ pts: q, top: lvl + t.top, kind: 'tread' })
    } else rect(t.u0, t.u1, t.v0, t.v1, t.top, 'tread')
  }
  for (const ld of G.landings) rect(ld.u0, ld.u1, ld.v0, ld.v1, ld.top, 'landing')
  return out
}
