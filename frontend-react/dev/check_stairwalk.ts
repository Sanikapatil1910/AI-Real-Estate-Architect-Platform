/** Unit test of the stair walk surfaces (src/components/stairWalk.ts): every shape, mirrored or not, several room sizes. node only. */
import assert from 'node:assert/strict'
import { stairSpec } from '../src/components/stairSpec'
import type { StairShape, RoomR } from '../src/components/stairSpec'
import { stairWalkPatches } from '../src/components/stairWalk'

const fails: string[] = []
let n = 0
for (const shape of ['u', 'straight', 'l', 'double_l', 'spiral'] as StairShape[]) for (const mirror of [false, true]) for (const entryHigh of [false, true]) for (const [L, W] of [[17, 7.5], [16, 8], [14, 7], [12, 10]]) {
  const tag = `${shape}${mirror ? '-m' : ''}${entryHigh ? '-hi' : ''} ${L}x${W}`
  n++
  try {
    const spec = { ...stairSpec(null, 10), shape, mirror }
    const room: RoomR = { room_type: 'staircase', x: 5, y: 7, x2: 5 + L, y2: 7 + W }
    const lvl = 0.3
    const patches = stairWalkPatches(room, lvl, spec, entryHigh)
    assert.ok(patches.length >= spec.n - 2, `too few patches (${patches.length} for ${spec.n} risers)`)
    for (const p of patches) {
      assert.equal(p.pts.length, 4)
      for (const [x, z] of p.pts) assert.ok(x >= 5 - 0.2 && x <= 5 + L + 0.2 && z >= 7 - 0.2 && z <= 7 + W + 0.2, `patch corner more than 0.2 ft outside the stair room: ${x},${z}`)
      assert.ok(p.top >= lvl - 1e-6 && p.top <= lvl + spec.n * spec.riser + 1e-6, `patch height out of range: ${p.top}`)
    }
    const tops = [...new Set(patches.map((p) => +p.top.toFixed(3)))].sort((a, b) => a - b)
    for (let i = 1; i < tops.length; i++) assert.ok(tops[i] - tops[i - 1] <= spec.riser * 1.02 + 1e-6, `gap of ${(tops[i] - tops[i - 1]).toFixed(2)} ft between walk levels`)
    assert.ok(tops[tops.length - 1] >= lvl + (spec.n - 1) * spec.riser - 1e-6, 'the patches reach the upper floor')
  } catch (e) { fails.push(`${tag}: ${(e as Error).message}`) }
}
console.log(JSON.stringify({ passed: n - fails.length, total: n, failed: fails.slice(0, 10) }))
process.exit(fails.length ? 1 : 0)
