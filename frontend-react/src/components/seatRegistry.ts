/**
 * Places where a person can sit, taken from the SAME furniture placement the 3D builder uses (dining and desk chairs, sofa cushions, armchairs, beds, the bench
 * at the foot of a bed, kitchen stools), so it works for every newly generated house and every furniture style, not only for sample houses.
 * Pure data, no three.js.  The builder registers a seat as it draws the piece; the VR loader reads them after the build and takes the real seat height
 * from the loaded mesh.  Nothing here changes what is drawn.  Units: feet, model frame (x, z in the plan).
 */
export type SeatKind = 'chair' | 'sofa' | 'bed' | 'bench' | 'stool'
export interface SeatSite {
  kind: SeatKind
  /** centre of the seat in the plan */
  x: number
  z: number
  /** the floor surface the furniture stands on */
  y: number
  /** footprint of the seat (along its width, along its depth) */
  w: number
  d: number
  /** unit vector in the plan: the way a person sitting there faces */
  fx: number
  fz: number
  /** expected seat height above the floor (ft); the real height is read from the mesh at load */
  hint: number
}

let SEATS: SeatSite[] = []
export function resetSeats(): void { SEATS = [] }
export function takeSeats(): SeatSite[] { return SEATS.slice() }
export function registerSeat(s: SeatSite): void { if (Number.isFinite(s.x + s.z + s.y)) SEATS.push(s) }
/** Used when a room's furnishing is taken back and redone, so seats of the discarded layout never reach the VR scene. */
export function seatCount(): number { return SEATS.length }
export function seatTruncate(n: number): void { SEATS.length = Math.min(SEATS.length, n) }
