/**
 * Audit of the smart-house data (run by tests/test_smart_house.py after bundling with esbuild): reads every stored plan fixture given on the command
 * line, builds the smart-house description and prints a JSON object {bad: [...], stats: {...}}.  `bad` must be empty.
 */
import { buildSmartHouse, SWITCH_HEIGHT_FT } from '../src/lib/smartHouse'
import { projectPlan } from './project_plan'
import { passageOpenings } from '../src/components/walls'
import { readFileSync } from 'node:fs'

const bad: string[] = []
const stats = { plans: 0, rooms: 0, switches: 0, fans: 0, regulators: 0, noSwitch: 0 }
for (const file of process.argv.slice(2)) {
  let plan = JSON.parse(readFileSync(file, 'utf8'))
  plan = plan.plan ?? plan
  if (!plan.floors?.length) continue
  const tag = file.split('/').pop()
  const sh = buildSmartHouse(plan, projectPlan)
  stats.plans++
  const raw = plan.floors.map((f: any) => f.layout)
  const seen = new Set<string>()
  for (const r of sh.rooms) {
    stats.rooms++
    const k = `${r.floor}:${r.id}`
    if (seen.has(k)) bad.push(`${tag}: duplicate room ${k}`)
    seen.add(k)
    const w = r.rect.x1 - r.rect.x0, d = r.rect.z1 - r.rect.z0
    const inside = (p: number[], m = 0) => p[0] >= r.rect.x0 + m && p[0] <= r.rect.x1 - m && p[2] >= r.rect.z0 + m && p[2] <= r.rect.z1 - m
    if (!inside(r.light.pos) || r.light.pos[1] > r.ceiling_y || r.light.pos[1] < r.ceiling_y - 0.5) bad.push(`${tag}: ${k} light outside its room / not under the ceiling`)
    if (r.ceiling_y - r.floor_y < 8) bad.push(`${tag}: ${k} clear height under 8 ft`)
    if (r.fan) {
      stats.fans++
      const f = r.fan
      if (!inside(f.pos)) bad.push(`${tag}: ${k} fan outside its room`)
      if (Math.min(w, d) < 9) bad.push(`${tag}: ${k} fan in a room narrower than 9 ft`)
      if (f.blade_radius_ft + 2 > Math.min(w, d) / 2 + 1e-6) bad.push(`${tag}: ${k} blade tip closer than 2 ft to a wall`)
      if (f.blade_plane_above_floor_ft < 7.25) bad.push(`${tag}: ${k} blades ${f.blade_plane_above_floor_ft} ft above the floor (< 7.25)`)
      if (f.pos[1] > r.ceiling_y + 1e-6) bad.push(`${tag}: ${k} fan above the ceiling`)
      if (!r.switch || !r.regulator) bad.push(`${tag}: ${k} has a fan but no reachable regulator`)
    }
    if (!r.switch) { stats.noSwitch++; continue }
    stats.switches++
    const s = r.switch
    const h = s.pos[1] - r.floor_y
    if (Math.abs(h - SWITCH_HEIGHT_FT) > 0.01) bad.push(`${tag}: ${k} switch at ${h} ft`)
    const edgeC = { top: r.rect.z0, bottom: r.rect.z1, left: r.rect.x0, right: r.rect.x1 }[s.wall]
    const horiz = s.wall === 'top' || s.wall === 'bottom'
    const onC = horiz ? s.pos[2] : s.pos[0]
    const along = horiz ? s.pos[0] : s.pos[2]
    const lo = horiz ? r.rect.x0 : r.rect.z0, hi = horiz ? r.rect.x1 : r.rect.z1
    if (Math.abs(onC - edgeC) > 0.01) bad.push(`${tag}: ${k} switch is not on the ${s.wall} wall line`)
    if (along < lo + 0.6 || along > hi - 0.6) bad.push(`${tag}: ${k} switch within 0.6 ft of a corner`)
    const into = s.wall === 'top' ? [0, 0, 1] : s.wall === 'bottom' ? [0, 0, -1] : s.wall === 'left' ? [1, 0, 0] : [-1, 0, 0]
    if (s.normal.join() !== into.join()) bad.push(`${tag}: ${k} switch normal does not point into the room`)
    const lay = raw[r.floor]
    for (const cut of passageOpenings(lay.rooms ?? [])) {           // where a passage is open to a living / dining / stair space there is no wall at all
      if (cut.axis !== (horiz ? 'h' : 'v') || Math.abs(cut.c - edgeC) > 0.05) continue
      for (const [name, p] of [['switch', along], ...(r.regulator ? [['regulator', horiz ? r.regulator.pos[0] : r.regulator.pos[2]]] : [])] as Array<[string, number]>)
        if (p > cut.a - 0.1 && p < cut.b + 0.1) bad.push(`${tag}: ${k} ${name} in a passage opening (no wall there)`)
    }
    let nearest = Infinity
    const gp = r.regulator ? (horiz ? r.regulator.pos[0] : r.regulator.pos[2]) : null
    for (const dr of lay.openings?.doors ?? []) {
      if (dr.room !== r.id && dr.connects_to !== r.id) continue
      const on = horiz ? Math.abs(dr.y1 - edgeC) < 0.2 && Math.abs(dr.y2 - edgeC) < 0.2 : Math.abs(dr.x1 - edgeC) < 0.2 && Math.abs(dr.x2 - edgeC) < 0.2
      if (!on) continue
      const a = horiz ? Math.min(dr.x1, dr.x2) : Math.min(dr.y1, dr.y2), b = horiz ? Math.max(dr.x1, dr.x2) : Math.max(dr.y1, dr.y2)
      for (const [name, p] of [['switch', along], ...(gp !== null ? [['regulator', gp]] : [])] as Array<[string, number]>) {
        if (p > a - 0.3 && p < b + 0.3) bad.push(`${tag}: ${k} ${name} inside a door opening`)
      }
      nearest = Math.min(nearest, Math.abs(along - a), Math.abs(along - b))
    }
    if (nearest !== Infinity && nearest > 1.6 && r.type !== 'passage') bad.push(`${tag}: ${k} switch ${nearest.toFixed(1)} ft from the nearest door on its wall`)
    for (const wn of lay.openings?.windows ?? []) {
      if (wn.room !== r.id || wn.wall !== s.wall) continue
      const a = lo + wn.position, b = a + wn.width
      if (along > a - 0.3 && along < b + 0.3) bad.push(`${tag}: ${k} switch under a window`)
      if (gp !== null && gp > a - 0.3 && gp < b + 0.3) bad.push(`${tag}: ${k} regulator under a window`)
    }
    if (r.regulator && gp !== null) {
      stats.regulators++
      const g = r.regulator
      if (g.wall !== s.wall) bad.push(`${tag}: ${k} regulator not on the switch's wall`)
      if (Math.abs(gp - along) < 0.6) bad.push(`${tag}: ${k} regulator overlaps the switch`)
      if (Math.abs(gp - along) > 1.6) bad.push(`${tag}: ${k} regulator too far from the switch`)
      if (gp < lo + 0.6 || gp > hi - 0.6) bad.push(`${tag}: ${k} regulator within 0.6 ft of a corner`)
    }
  }
  if (!sh.rooms.length) bad.push(`${tag}: no rooms`)
}
console.log(JSON.stringify({ bad, stats }))
