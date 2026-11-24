/** Test harness (vite dev only): exposes the VR house loader to Playwright. */
import { prepareHouseFromPlan } from '../src/vr/houseLoader'
import { floorSpot } from '../src/vr/houseLoader'
import type { LoadedHouse } from '../src/vr/houseLoader'

const w = window as unknown as Record<string, unknown>
w.__house = null as LoadedHouse | null
w.__load = async (name: string, style?: string) => {
  const p = await (await fetch(`/dev/fixtures/${name}.json`)).json()
  const plan = p.plan ?? p
  if (style) plan.architectural_style = style
  const msgs: string[] = []
  const h = await prepareHouseFromPlan(plan, { progress: (m) => msgs.push(m) })
  w.__house = h
  w.__plan = plan
  return { stats: h.stats, spawn: h.spawn, rooms: h.smart.rooms.length, fans: h.smart.rooms.filter((r) => r.fan).length, msgs, source: h.source, floors: h.smart.floors.length }
}
w.__floorSpot = (f: number) => { const h = w.__house as LoadedHouse; return floorSpot(h.smart, h.nav, f) }
w.__walk = (x: number, y: number, z: number, dx: number, dz: number) => { const h = w.__house as LoadedHouse; return h.nav.move({ x, y, z }, dx, dz) }
w.__ready = true
document.getElementById('out')!.textContent = 'ready'

/** breadth-first walk over the nav grid from the spawn (0.5 ft steps): which rooms can the body reach, which floors, and how big is the walkable area */
w.__reach = () => {
  const h = w.__house as LoadedHouse
  // A flood fill on one fixed lattice can miss a narrow doorway or stair lane purely through alignment,
  // so the same fill is run on several lattice steps and a room counts as reachable if any of them gets in.
  const steps = (w.__reachSteps as number[] | undefined) ?? [0.5, 0.4, 0.3, 0.25]
  const flood = (step: number) => {
    const key = (x: number, z: number, y: number) => `${Math.round(x / step)},${Math.round(z / step)},${Math.round(y / 2)}`
    const start = h.spawn
    const seen = new Map<string, { x: number; y: number; z: number }>()
    const q = [start]; seen.set(key(start.x, start.z, start.y), start)
    while (q.length) {
      const p = q.pop()!
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const g = h.nav.canStand(p.x + dx, p.z + dz, p.y)
        if (g === null) continue
        const k = key(p.x + dx, p.z + dz, g)
        if (seen.has(k)) continue
        seen.set(k, { x: p.x + dx, y: g, z: p.z + dz })
        q.push(seen.get(k)!)
      }
    }
    return [...seen.values()]
  }
  const floods = steps.map(flood)
  const pts = floods.reduce((a, b) => (b.length > a.length ? b : a), floods[0])
  const maxY = Math.max(...floods.map((f) => f.reduce((m, p) => Math.max(m, p.y), -1e9)))
  const rooms = h.smart.rooms.map((r) => {
    const inside = floods.some((f) => f.some((p) => p.x >= r.rect.x0 && p.x <= r.rect.x1 && p.z >= r.rect.z0 && p.z <= r.rect.z1 && Math.abs(p.y - r.floor_y) < 1.2))
    return { id: `${r.floor}:${r.id}`, type: r.type, floor: r.floor, reached: inside }
  })
  const top = pts.reduce((a, b) => (b.y > a.y ? b : a), pts[0])
  return { cells: pts.length, maxY, rooms, top }
}

/** ASCII map of one floor: '.' standable, '#' solid in the body column, '~' ground but body does not fit (near walls), ' ' no ground */
w.__map = (floor: number, res = 0.6) => {
  const h = w.__house as LoadedHouse
  const fy = h.smart.floors[floor].floor_y
  const fp = h.smart.footprint
  const rows: string[] = []
  for (let z = fp.z0 - 2; z <= fp.z1 + 2; z += res) {
    let line = ''
    for (let x = fp.x0 - 2; x <= fp.x1 + 2; x += res) {
      const g = h.nav.groundAt(x, z, fy + 0.2)
      if (g === null) { line += ' '; continue }
      if (h.nav.canStand(x, z, fy + 0.2) !== null) line += '.'
      else line += h.nav.solidAt(x, z, g) ? '#' : '~'
    }
    rows.push(line)
  }
  return rows.join('\n')
}

/** every door of every floor: is the body able to stand in the doorway and on both sides of it? */
w.__doors = () => {
  const h = w.__house as LoadedHouse
  const plan = w.__plan as { floors: Array<{ layout: { openings?: { doors?: Array<{ room: string; connects_to?: string; x1: number; y1: number; x2: number; y2: number; width: number; door_type: string }> } } }> }
  const out: unknown[] = []
  plan.floors.forEach((f, fi) => {
    const fy = h.smart.floors[fi].floor_y
    for (const d of f.layout.openings?.doors ?? []) {
      const cx = (d.x1 + d.x2) / 2, cz = (d.y1 + d.y2) / 2
      const vertical = Math.abs(d.x1 - d.x2) < 1e-6          // wall runs along z -> walk along x
      const n: [number, number] = vertical ? [1, 0] : [0, 1]
      const at = (t: number) => h.nav.canStand(cx + n[0] * t, cz + n[1] * t, fy + 0.2)
      out.push({ floor: fi, room: d.room, to: d.connects_to, type: d.door_type, width: d.width, center: [cx, cz], vertical, before: at(-2) !== null, door: at(0) !== null, after: at(2) !== null, door_m1: at(-0.6) !== null, door_p1: at(0.6) !== null })
    }
  })
  return out
}

w.__zoom = (cx: number, cz: number, y: number, half = 5, res = 0.3) => {
  const h = w.__house as LoadedHouse
  const rows: string[] = []
  for (let z = cz - half; z <= cz + half; z += res) {
    let line = ''
    for (let x = cx - half; x <= cx + half; x += res) {
      const g = h.nav.groundAt(x, z, y)
      if (g === null) { line += ' '; continue }
      if (h.nav.canStand(x, z, y) !== null) line += '.'
      else line += h.nav.solidAt(x, z, g) ? '#' : 'o'
    }
    rows.push(line)
  }
  return rows.join('\n')
}

w.__heights = (x: number, z0: number, z1: number, dz = 0.6) => {
  const h = w.__house as LoadedHouse
  const rows: string[] = []
  for (let z = z0; z <= z1; z += dz) rows.push(`z=${z.toFixed(1)}: ${h.nav.upHeights(x, z).join(' ')}`)
  return rows.join('\n')
}

w.__why = (x: number, z: number, y: number) => {
  const h = w.__house as LoadedHouse
  const n = h.nav
  const g = n.groundAt(x, z, y)
  const out: string[] = [`ground=${g}`]
  if (g === null) return out.join(' ')
  out.push(`centerSolid=${n.solidAt(x, z, g)}`)
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    const px = x + Math.cos(a) * n.bodyRadius, pz = z + Math.sin(a) * n.bodyRadius
    const gp = n.groundAt(px, pz, g) ?? g
    const fx = x + Math.cos(a) * n.furnitureRadius, fz = z + Math.sin(a) * n.furnitureRadius
    const gf = n.groundAt(fx, fz, g) ?? g
    out.push(`[${k}] wall=${n.wallAt(px, pz, Math.max(g, gp))} gp=${gp} fur=${n.solidAt(fx, fz, Math.max(g, gf))}`)
  }
  return out.join('\n')
}

w.__solids = (x: number, z: number) => { const h = w.__house as LoadedHouse; const a = h.nav.solidHeights(x, z); return a.length ? `${a[0]}..${a[a.length - 1]} (${a.length} bins) ` + JSON.stringify(a.filter((_, i) => i % 6 === 0)) : 'none' }

/** teleport arcs from many standing spots of the loaded house: how many land, where, and is every landing standable and at a walking level */
import { aimArc } from '../src/vr/teleport'
w.__tele = () => {
  const h = w.__house as LoadedHouse
  const nav = h.nav
  const levels = [0, ...h.smart.floors.map((f) => f.floor_y)]
  // sample standing spots by flood (0.5 ft lattice)
  const step = 0.5
  const key = (x: number, z: number, y: number) => `${Math.round(x / step)},${Math.round(z / step)},${Math.round(y / 2)}`
  const seen = new Map<string, Foot3>(); type Foot3 = { x: number; y: number; z: number }
  const q: Foot3[] = [h.spawn]; seen.set(key(h.spawn.x, h.spawn.z, h.spawn.y), h.spawn)
  while (q.length) {
    const p = q.pop()!
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const g = nav.canStand(p.x + dx, p.z + dz, p.y); if (g === null) continue
      const k = key(p.x + dx, p.z + dz, g); if (seen.has(k)) continue
      const n = { x: p.x + dx, y: g, z: p.z + dz }; seen.set(k, n); q.push(n)
    }
  }
  const pts = [...seen.values()].filter((_, i) => i % 40 === 0)
  const out = { spots: pts.length, arcs: 0, valid: 0, badStand: 0, badLevel: 0, sameFloor: 0, otherFloor: 0, reasons: {} as Record<string, number>, byLevel: {} as Record<string, number>, fromStairsToOther: 0, throughCeiling: 0, crossings: 0 }
  for (const p of pts) {
    const fromStair = !levels.some((l) => Math.abs(l - p.y) < 0.5)
    for (let a = 0; a < 16; a++) for (const pitch of [-0.25, 0.3, 0.9]) {
      const az = (a / 16) * Math.PI * 2
      const dir: [number, number, number] = [Math.cos(az) * Math.cos(pitch), Math.sin(pitch), Math.sin(az) * Math.cos(pitch)]
      const r = aimArc(nav, [p.x * 0.3048, (p.y + 5.3) * 0.3048, p.z * 0.3048], dir, { levels })
      out.arcs++
      out.reasons[r.reason] = (out.reasons[r.reason] ?? 0) + 1
      if (!r.valid || !r.target) continue
      out.valid++
      const t = r.target
      if (nav.canStand(t.x, t.z, t.y) === null) out.badStand++
      const lv = levels.findIndex((l) => Math.abs(l - t.y) < 0.5)
      if (lv < 0 && nav.patchGround(t.x, t.z, t.y) === null) out.badLevel++
      const here = levels.findIndex((l) => Math.abs(l - p.y) < 0.5)
      out.byLevel[lv < 0 ? 'stair' : `L${lv}`] = (out.byLevel[lv < 0 ? 'stair' : `L${lv}`] ?? 0) + 1
      if (here >= 0 && lv >= 0 && lv !== here) out.otherFloor++
      else if (here >= 0) out.sameFloor++
      if (fromStair && lv >= 0 && Math.abs(levels[lv] - p.y) > 2) out.fromStairsToOther++
      if (here >= 0 && lv >= 0 && Math.abs(levels[lv] - p.y) > 2 && !fromStair) {
        // a cross-floor landing from a floor spot must have gone through a void in the slab: where did the arc pass the slab height?
        const slabY = (levels[lv] > p.y ? levels[lv] : p.y) * 0.3048
        let cross: [number, number, number] | null = null
        for (let i = 1; i < r.points.length; i++) { const a0 = r.points[i - 1], a1 = r.points[i]; if ((a0[1] - slabY) * (a1[1] - slabY) <= 0 && a0[1] !== a1[1]) { cross = a0; break } }
        out.crossings++
        if (cross) {
          const cx = cross[0] / 0.3048, cz = cross[2] / 0.3048
          const inVoid = h.smart.rooms.some((rm) => /stair/.test(rm.type) && cx >= rm.rect.x0 - 1 && cx <= rm.rect.x1 + 1 && cz >= rm.rect.z0 - 1 && cz <= rm.rect.z1 + 1)
          const fp = h.smart.footprint
          const inside = cx >= fp.x0 && cx <= fp.x1 && cz >= fp.z0 && cz <= fp.z1
          if (!inVoid && inside) {
            out.throughCeiling++
            const dbg = (out as unknown as { dbg?: unknown[] }).dbg ??= []
            if (dbg.length < 8) dbg.push({ from: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), to: [t.x, t.y, t.z].map((v) => +v.toFixed(1)), cross: [cx, cross[1] / 0.3048, cz].map((v) => +v.toFixed(1)), room: h.smart.rooms.filter((rm) => cx >= rm.rect.x0 && cx <= rm.rect.x1 && cz >= rm.rect.z0 && cz <= rm.rect.z1).map((rm) => `${rm.floor}:${rm.id}:${rm.type}`) })
          }
        }
      }
    }
  }
  return out
}

/** the seats of the loaded house: kinds, measured heights, a stand-up spot for each, and which kinds of room have something to sit on */
import { standSpot } from '../src/vr/seats'
w.__seats = () => {
  const h = w.__house as LoadedHouse
  const kinds: Record<string, number> = {}
  const heights: Record<string, number[]> = {}
  let measured = 0, noStand = 0, outOfRoom = 0, badHeight = 0
  const byRoomType: Record<string, number> = {}
  const bad: unknown[] = []
  for (const s of h.seats) {
    kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
    ;(heights[s.kind] ??= []).push(+(s.seatY - s.floorY).toFixed(2))
    if (s.measured) measured++
    const st = standSpot(h.nav, s, null)
    if (!st) { noStand++; if (bad.length < 4) bad.push({ noStand: [s.kind, s.x, s.z] }) }
    const room = h.smart.rooms.find((r) => `${r.floor}:${r.id}` === s.room)
    if (!room) { outOfRoom++; if (bad.length < 4) bad.push({ noRoom: [s.kind, s.x.toFixed(1), s.z.toFixed(1), s.floorY] }) } else byRoomType[room.type] = (byRoomType[room.type] ?? 0) + 1
    const dy = s.seatY - s.floorY
    if (dy < 0.9 || dy > 2.9) { badHeight++; if (bad.length < 4) bad.push({ badHeight: [s.kind, dy] }) }
  }
  const spans = Object.fromEntries(Object.entries(heights).map(([k, v]) => [k, [Math.min(...v), Math.max(...v)]]))
  const roomsWith = (re: RegExp) => h.smart.rooms.filter((r) => re.test(r.type)).map((r) => ({ id: `${r.floor}:${r.id}`, seats: h.seats.filter((s) => s.room === `${r.floor}:${r.id}`).length }))
  return { total: h.seats.length, kinds, measured, noStand, outOfRoom, badHeight, spans, byRoomType, living: roomsWith(/living|lounge/), bedrooms: roomsWith(/bedroom/), dining: roomsWith(/dining/), bad }
}

/** which room does the smart house think a person is in while standing on each stair tread (the room that drives automatic lighting)? */
import { RoomLocator } from '../src/vr/smart/document'
w.__stairRooms = () => {
  const h = w.__house as LoadedHouse
  const loc = new RoomLocator(h.smart.rooms)
  const type = (key: string | null) => (key ? h.smart.rooms.find((r) => `${r.floor}:${r.id}` === key)?.type ?? '?' : 'none')
  const counts: Record<string, number> = {}
  const gaps: unknown[] = []
  let n = 0
  for (const p of h.nav.walkPatches) {
    let cx = 0, cz = 0
    for (const q of p.pts) { cx += q[0]; cz += q[1] }
    cx /= p.pts.length; cz /= p.pts.length
    n++
    const key = loc.locate(cx, p.top + 3, cz)        // the point the engine uses: feet + 3 ft
    const t = type(key)
    counts[t] = (counts[t] ?? 0) + 1
    if (!/stair/.test(t) && gaps.length < 5) gaps.push({ at: [cx.toFixed(1), p.top.toFixed(1), cz.toFixed(1)], key, t })
  }
  return { patches: n, counts, gaps, stairRooms: h.smart.rooms.filter((r) => /stair/.test(r.type)).map((r) => `${r.floor}:${r.id}:${r.floor_y}-${r.ceiling_y}`) }
}

import { takeLayouts } from '../src/components/twinInterior'
w.__layouts = (id: string) => takeLayouts().filter((l) => (l.r.id ?? l.r.room_type) === id)

import * as THREE from 'three'
import { buildTwin } from '../src/components/twinBuild'
import { designForStyle } from '../src/components/twinThemes'
import { styleIdOf } from '../src/components/twinStyles'
/** which scene objects occupy the column at (x,z) between floor+y0 and floor+y1 (ft) in a freshly built twin */
w.__probe = (x: number, z: number, y0: number, y1: number, fy = 0.3) => {
  const plan = ((w.__house as LoadedHouse | undefined)?.access?.plan.plan ?? w.__plan) as never
  const design = designForStyle(styleIdOf((plan as { architectural_style?: string }).architectural_style))
  const model = buildTwin(plan, design, { walkable: true }) as unknown as { root: THREE.Object3D }
  model.root.updateMatrixWorld(true)
  const out: string[] = []
  const bb = new THREE.Box3()
  model.root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    bb.setFromObject(m)
    if (bb.min.x <= x && bb.max.x >= x && bb.min.z <= z && bb.max.z >= z && bb.max.y > fy + y0 && bb.min.y < fy + y1) {
      const chain: string[] = []; let p: THREE.Object3D | null = m
      while (p && p !== model.root) { chain.push(p.name || p.type); p = p.parent }
      out.push(`${chain.slice(0, 3).join('<')} x ${bb.min.x.toFixed(2)}..${bb.max.x.toFixed(2)} z ${bb.min.z.toFixed(2)}..${bb.max.z.toFixed(2)} y ${(bb.min.y - fy).toFixed(2)}..${(bb.max.y - fy).toFixed(2)}`)
    }
  })
  return out
}

import { auditAccess } from '../src/vr/access'
w.__access = (step = 0.15, fromSpawn = false) => {
  const h = w.__house as LoadedHouse
  const plan = (h.access?.plan.plan ?? w.__plan) as { floors: Array<{ layout: { openings?: { doors?: never[] } } }> }
  const md = (plan.floors[0].layout.openings?.doors ?? []).find((d: { door_type?: string }) => d.door_type === 'main') as { room?: string; x1: number; y1: number; x2: number; y2: number } | undefined
  let entrance: { x: number; y: number; z: number } | null = null
  if (md) {
    const owner = h.smart.rooms.find((r) => r.floor === 0 && r.id === md.room)
    const cx = (md.x1 + md.x2) / 2, cz = (md.y1 + md.y2) / 2
    const horizontal = Math.abs(md.y1 - md.y2) < 1e-6
    const oc = owner ? { x: (owner.rect.x0 + owner.rect.x1) / 2, z: (owner.rect.z0 + owner.rect.z1) / 2 } : { x: cx, z: cz }
    const nx = horizontal ? 0 : Math.sign(cx - oc.x) || 1, nz = horizontal ? Math.sign(cz - oc.z) || 1 : 0
    for (const d of [3.5, 4.5, 6, 2.5]) { const x = cx + nx * d, z = cz + nz * d; for (const y of [0.1, 0.35]) { const g = h.nav.canStand(x, z, y); if (g !== null) { entrance = { x, y: g, z }; break } } if (entrance) break }
  }
  return auditAccess({ nav: h.nav, spawn: h.spawn, entrance: fromSpawn ? null : entrance, rooms: h.smart.rooms.map((r) => ({ id: r.id, type: r.type, floor: r.floor, floor_y: r.floor_y, rect: r.rect })), floors: h.smart.floors, doors: plan.floors.map((f) => (f.layout.openings?.doors ?? []) as never) }, step)
}
import { walkFill } from '../src/vr/access'
w.__fmap = (x0: number, z0: number, x1: number, z1: number, y: number) => {
  const h = w.__house as LoadedHouse
  const step = 0.15
  const { nodes } = walkFill(h.nav, h.spawn, step)
  const R = new Set<string>()
  for (const p of nodes.values()) if (Math.abs(p.y - y) < 1.2) R.add(`${Math.round((p.x - x0) / step)},${Math.round((p.z - z0) / step)}`)
  const rows: string[] = []
  for (let j = 0; z0 + j * step <= z1 + 1e-6; j++) {
    const z = z0 + j * step
    let line = z.toFixed(2).padStart(6) + ' '
    for (let i = 0; x0 + i * step <= x1 + 1e-6; i++) {
      const x = x0 + i * step
      const g = h.nav.groundAt(x, z, y)
      line += R.has(`${i},${j}`) ? 'R' : h.nav.canStand(x, z, y) !== null ? '.' : g === null ? ' ' : h.nav.wallAt(x, z, g) ? 'S' : h.nav.solidAt(x, z, g) ? 'o' : '#'
    }
    rows.push(line)
  }
  return rows.join('\n')
}

/** triangle-level: which meshes (material colour, parent chain, user data) have a triangle over the column (x,z) between y0 and y1 (model frame, ft) */
w.__probeTri = (x: number, z: number, y0: number, y1: number) => {
  const plan = w.__plan as never
  const design = designForStyle(styleIdOf((plan as { architectural_style?: string }).architectural_style))
  const model = buildTwin(plan, design, { walkable: true }) as unknown as { root: THREE.Object3D }
  model.root.updateMatrixWorld(true)
  const out = new Map<string, number>()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  model.root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const geo = m.geometry; const pos = geo.attributes.position; const idx = geo.index
    const n = idx ? idx.count : pos.count
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2
      a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld)
      const minx = Math.min(a.x, b.x, c.x), maxx = Math.max(a.x, b.x, c.x), minz = Math.min(a.z, b.z, c.z), maxz = Math.max(a.z, b.z, c.z)
      if (minx > x + 0.05 || maxx < x - 0.05 || minz > z + 0.05 || maxz < z - 0.05) continue
      const miny = Math.min(a.y, b.y, c.y), maxy = Math.max(a.y, b.y, c.y)
      if (maxy < y0 || miny > y1) continue
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial
      const chain: string[] = []; let p: THREE.Object3D | null = m
      while (p && p !== model.root) { chain.push(p.name || p.type); p = p.parent }
      const k = `${chain.slice(0, 4).join('<')} col=${mat?.color?.getHexString?.()} ud=${Object.keys(m.userData).join(',')} bbox x${minx.toFixed(2)}..${maxx.toFixed(2)} z${minz.toFixed(2)}..${maxz.toFixed(2)} y${miny.toFixed(2)}..${maxy.toFixed(2)}`
      out.set(k, (out.get(k) ?? 0) + 1)
    }
  })
  return [...out.entries()].slice(0, 25).map(([k, v]) => `${v}x ${k}`)
}

/** meshes of the LOADED house (the merged GLB scene the nav grid was built from) with a triangle over (x,z) between y0..y1 */
w.__probeLoaded = (x: number, z: number, y0: number, y1: number) => {
  const h = w.__house as LoadedHouse
  h.root.updateMatrixWorld(true)
  const out = new Map<string, number>()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  h.root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.attributes.position; const idx = m.geometry.index
    const n = idx ? idx.count : pos.count
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2
      a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld)
      const S = 1
      const minx = Math.min(a.x, b.x, c.x) * S, maxx = Math.max(a.x, b.x, c.x) * S, minz = Math.min(a.z, b.z, c.z) * S, maxz = Math.max(a.z, b.z, c.z) * S
      const miny = Math.min(a.y, b.y, c.y) * S, maxy = Math.max(a.y, b.y, c.y) * S
      if (minx > x + 0.05 || maxx < x - 0.05 || minz > z + 0.05 || maxz < z - 0.05 || maxy < y0 || miny > y1) continue
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial
      const k = `${m.name || m.parent?.name || '?'} col=${mat?.color?.getHexString?.()} x${minx.toFixed(2)}..${maxx.toFixed(2)} z${minz.toFixed(2)}..${maxz.toFixed(2)} y${miny.toFixed(2)}..${maxy.toFixed(2)}`
      out.set(k, (out.get(k) ?? 0) + 1)
    }
  })
  return [...out.entries()].slice(0, 25).map(([k, v]) => `${v}x ${k}`)
}

/** exact: triangles of the loaded house whose projection on the xy plane contains (x, y) and whose z range touches z±0.05 (finds what stands in a doorway) */
w.__probeXY = (x: number, y: number, z: number) => {
  const h = w.__house as LoadedHouse
  h.root.updateMatrixWorld(true)
  const out: string[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const inTri = (px: number, py: number, p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
    const d = (q.y - r.y) * (p.x - r.x) + (r.x - q.x) * (p.y - r.y)
    if (Math.abs(d) < 1e-9) return false
    const l1 = ((q.y - r.y) * (px - r.x) + (r.x - q.x) * (py - r.y)) / d
    const l2 = ((r.y - p.y) * (px - r.x) + (p.x - r.x) * (py - r.y)) / d
    return l1 >= 0 && l2 >= 0 && l1 + l2 <= 1
  }
  h.root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.attributes.position; const idx = m.geometry.index
    const n = idx ? idx.count : pos.count
    for (let i = 0; i < n && out.length < 12; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2
      a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld)
      if (Math.min(a.z, b.z, c.z) > z + 0.05 || Math.max(a.z, b.z, c.z) < z - 0.05) continue
      if (!inTri(x, y, a, b, c)) continue
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial
      out.push(`${m.name} col=${mat?.color?.getHexString?.()} A(${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)}) B(${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}) C(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`)
    }
  })
  return out
}

/** Human-scale probe: measures the model that the VR scene really shows (metres = feet x 0.3048, the single scale the engine applies). */
w.__dims = async (name: string) => {
  const [{ buildTwin }, { takeSeats }, { designForStyle, resolveDesign: _r }] = await Promise.all([import('../src/components/twinBuild'), import('../src/components/seatRegistry'), import('../src/components/twinThemes')])
  void _r
  const FTM = 0.3048
  const p = await (await fetch(`/dev/fixtures/${name}.json`)).json()
  const plan = p.plan ?? p
  const m = buildTwin(plan, designForStyle('modern_minimalistic'), { walkable: true })
  const seats = takeSeats()
  const box = new THREE.Box3()
  // doors: the closed leaf of every door
  const doors = m.doors.map((d) => {
    const keep = d.pivot.rotation.y
    d.pivot.rotation.y = d.phi0
    d.pivot.updateMatrixWorld(true)
    box.setFromObject(d.pivot)
    const r = { h: (box.max.y - box.min.y) * FTM, w: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * FTM }
    d.pivot.rotation.y = keep
    return r
  })
  const rooms = plan.floors.flatMap((f: { layout: { rooms: Array<{ room_type: string; width: number; length: number; x: number; y: number; x2?: number; y2?: number }> } }) => f.layout.rooms)
  const dims = rooms.filter((r: { room_type: string }) => !['open_terrace', 'courtyard', 'garden', 'parking', 'passage', 'staircase', 'balcony'].includes(r.room_type))
    .map((r: { room_type: string; width: number; length: number }) => ({ t: r.room_type, w: +(r.width * FTM).toFixed(2), l: +(r.length * FTM).toFixed(2) }))
  const sc = new THREE.Box3().setFromObject(m.root)
  const seatTop: Record<string, number[]> = {}
  for (const s of seats) (seatTop[s.kind] ??= []).push(+(s.hint * FTM).toFixed(2))
  const floorH = m.wallH * FTM
  const stair = (plan.staircase ?? null) as { riser_count?: number; tread_depth_mm?: number; floor_height?: number } | null
  const out = {
    name, floors: plan.floors.length, wallH_ft: m.wallH, floorToFloor_m: +floorH.toFixed(2), clearCeiling_m: +((m.wallH - 0.3) * FTM).toFixed(2),
    doors: { n: doors.length, hMin: Math.min(...doors.map((d) => d.h)), hMax: Math.max(...doors.map((d) => d.h)), wMin: Math.min(...doors.map((d) => d.w)), wMax: Math.max(...doors.map((d) => d.w)) },
    rooms: { minSide: Math.min(...dims.map((d: { w: number; l: number }) => Math.min(d.w, d.l))), maxSide: Math.max(...dims.map((d: { w: number; l: number }) => Math.max(d.w, d.l))), n: dims.length },
    houseBox_m: { x: +((sc.max.x - sc.min.x) * FTM).toFixed(1), y: +((sc.max.y - sc.min.y) * FTM).toFixed(1), z: +((sc.max.z - sc.min.z) * FTM).toFixed(1) },
    seatHeights_m: Object.fromEntries(Object.entries(seatTop).map(([k, v]) => [k, [Math.min(...v), Math.max(...v)]])),
    stairs: stair ? { risers: stair.riser_count, rise_mm: stair.riser_count ? Math.round((m.wallH * 304.8) / stair.riser_count) : null, tread_mm: stair.tread_depth_mm } : null,
    kitchens: m.kitchens.length,
  }
  return out
}
