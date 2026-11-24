/** Ceiling-fan physics (port of the tested Unity FanModel): level 0..5 -> blade speed with a linear ramp, integrated exactly so the angle after a time is frame-rate independent. */
export const MAX_FAN_LEVEL = 5

export interface FanSpec {
  /** blade revolutions per minute for levels 0..5 */
  rpm: number[]
  accelDegPerSec2: number
  decelDegPerSec2: number
  stopDecelDegPerSec2: number
  defaultOnLevel: number
}
export const defaultFanSpec = (): FanSpec => ({ rpm: [0, 90, 140, 190, 240, 300], accelDegPerSec2: 450, decelDegPerSec2: 300, stopDecelDegPerSec2: 600, defaultOnLevel: 3 })

export const clampLevel = (n: number): number => (Number.isNaN(n) ? 0 : Math.max(0, Math.min(MAX_FAN_LEVEL, Math.round(n))))

export function validateFanSpec(s: FanSpec): void {
  if (s.rpm.length !== MAX_FAN_LEVEL + 1) throw new Error(`rpm must hold ${MAX_FAN_LEVEL + 1} values (levels 0..5).`)
  if (s.rpm[0] !== 0) throw new Error('Level 0 must be 0 rpm.')
  for (let i = 1; i <= MAX_FAN_LEVEL; i++) if (!(s.rpm[i] > s.rpm[i - 1])) throw new Error(`rpm must increase with every level (level ${i}).`)
  if (!(s.accelDegPerSec2 > 0 && s.decelDegPerSec2 > 0 && s.stopDecelDegPerSec2 > 0)) throw new Error('Accelerations must be positive.')
}

export class FanModel {
  level = 0
  velocityDegPerSec = 0
  totalDeg = 0
  constructor(readonly spec: FanSpec = defaultFanSpec()) { validateFanSpec(spec) }
  get angleDeg(): number { const a = this.totalDeg % 360; return a < 0 ? a + 360 : a }
  get targetDegPerSec(): number { return this.spec.rpm[this.level] * 6 }
  get isStopped(): boolean { return this.velocityDegPerSec === 0 && this.level === 0 }
  setLevel(n: number): void { this.level = clampLevel(n) }
  /** Advances dt seconds; returns the angle turned (degrees). */
  tick(dt: number): number {
    if (!(dt > 0) || !Number.isFinite(dt)) return 0
    let turned = 0
    let remaining = dt
    const target = this.targetDegPerSec
    while (remaining > 0) {
      const v = this.velocityDegPerSec
      if (v === target) { turned += v * remaining; break }
      const a = target > v ? this.spec.accelDegPerSec2 : target === 0 ? this.spec.stopDecelDegPerSec2 : this.spec.decelDegPerSec2
      const tReach = Math.abs(target - v) / a
      if (tReach > remaining) {
        const vn = v + (target > v ? 1 : -1) * a * remaining
        turned += ((v + vn) / 2) * remaining
        this.velocityDegPerSec = vn
        remaining = 0
      } else {
        turned += ((v + target) / 2) * tReach
        this.velocityDegPerSec = target
        remaining -= tReach
      }
    }
    this.totalDeg += turned
    return turned
  }
}
