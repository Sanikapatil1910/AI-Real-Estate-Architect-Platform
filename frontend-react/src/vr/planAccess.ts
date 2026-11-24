/**
 * Plan-level access check: can a person get from the front door to every room through DOORS (and the stairs between floors)?
 *
 * Generated plans already pass the backend's circulation check, but plans from other sources (an uploaded drawing that shows no door into a bathroom, an old saved
 * project) can contain a room with no way in.  A room nobody can enter is never acceptable in the walk-through, so for the VR model this module finds such rooms and
 * gives each one a door on a wall it shares with a room that can already be reached.  Every door it adds is recorded (`source: "assumed_access"`) and reported, and the
 * stored plan is not changed.  If no wall can carry a door, the room is listed as unresolved - never silently accepted.
 * Pure data (feet, plan frame); no three.js.
 */
export interface PRoom { id?: string; room_type: string; x: number; y: number; x2?: number; y2?: number; width?: number; length?: number; attached_to?: string | null }
export interface PDoor { id?: string; room?: string; connects_to?: string | null; wall?: string; position?: number; width?: number; door_type?: string; x1?: number; y1?: number; x2?: number; y2?: number; source?: string }
export interface PFloor { layout?: { rooms?: PRoom[]; openings?: { doors?: PDoor[]; windows?: unknown[] } } }
export interface PPlan { floors: PFloor[] }

export interface AddedDoor { floor: number; room: string; to: string; width: number; x1: number; y1: number; x2: number; y2: number; reason: string }
export interface PlanAccessReport {
  /** rooms (floor:id) that could not be reached through doors before any repair */
  cutOff: string[]
  added: AddedDoor[]
  /** rooms that still cannot be entered because no wall could carry a door */
  unresolved: string[]
  /** rooms (floor:id) the doors reach only THROUGH a bathroom, a balcony or another bedroom: a person can walk there, but the plan's own circulation is not valid (needs a different layout) */
  throughDeadEnd: string[]
  /** every room can be reached from the front door through doors and stairs (after the repair) */
  graphOk: boolean
  /** the plan to build (a copy with the added doors; the input is untouched) */
  plan: PPlan
}

const x2 = (r: PRoom) => r.x2 ?? r.x + (r.width ?? 0)
const y2 = (r: PRoom) => r.y2 ?? r.y + (r.length ?? 0)
const rid = (r: PRoom) => r.id ?? r.room_type
const near = (a: number, b: number) => Math.abs(a - b) < 0.12
const BED = new Set(['bedroom', 'master_bedroom', 'guest_bedroom'])
const WET = new Set(['bathroom', 'toilet'])
/** open to the sky / the garden: it has no door to give and is walked into along its edge (the physical audit still has to reach it) */
const OPEN_AIR = new Set(['courtyard', 'garden', 'open_terrace', 'terrace'])
/** reached, but never a way on to other rooms */
const DEAD_END = new Set(['bathroom', 'toilet', 'balcony', 'open_terrace', 'terrace'])
/** a car bay is not a way through the house */
const BAY = new Set(['parking', 'bike_parking'])

interface Seg { axis: 'h' | 'v'; c: number; a: number; b: number }
function segOf(d: PDoor, owner?: PRoom): Seg | null {
  if (d.x1 !== undefined && d.y1 !== undefined && d.x2 !== undefined && d.y2 !== undefined) {
    return Math.abs(d.y1 - d.y2) < 0.01 ? { axis: 'h', c: d.y1, a: Math.min(d.x1, d.x2), b: Math.max(d.x1, d.x2) } : { axis: 'v', c: d.x1, a: Math.min(d.y1, d.y2), b: Math.max(d.y1, d.y2) }
  }
  if (!owner || !d.wall) return null
  const p = Number(d.position) || 0, w = Number(d.width) || 3
  if (d.wall === 'top') return { axis: 'h', c: owner.y, a: owner.x + p, b: owner.x + p + w }
  if (d.wall === 'bottom') return { axis: 'h', c: y2(owner), a: owner.x + p, b: owner.x + p + w }
  if (d.wall === 'left') return { axis: 'v', c: owner.x, a: owner.y + p, b: owner.y + p + w }
  return { axis: 'v', c: x2(owner), a: owner.y + p, b: owner.y + p + w }
}
/** ids of the rooms an opening joins (the rooms whose edge lies on its line and overlaps it) */
function joins(s: Seg, rooms: PRoom[]): string[] {
  const out: string[] = []
  for (const r of rooms) {
    const onLine = s.axis === 'h' ? (near(r.y, s.c) || near(y2(r), s.c)) && Math.min(x2(r), s.b) - Math.max(r.x, s.a) > 0.4 : (near(r.x, s.c) || near(x2(r), s.c)) && Math.min(y2(r), s.b) - Math.max(r.y, s.a) > 0.4
    if (onLine) out.push(rid(r))
  }
  return out
}

/** how good a door between a room that is cut off and a neighbour that can be reached would be (higher is better; <0 never) */
function score(r: PRoom, n: PRoom): number {
  const a = r.room_type, b = n.room_type
  if (BAY.has(b) || OPEN_AIR.has(b) || b === 'balcony') return -1
  if (WET.has(a)) {
    if (r.attached_to && r.attached_to === rid(n)) return 100
    if (b === 'passage' || b === 'family_lounge') return 80
    if (BED.has(b)) return 70
    if (b === 'living_room' || b === 'staircase') return 60
    if (b === 'dining') return 40
    if (b === 'kitchen' || b === 'puja_room' || b === 'study' || b === 'utility') return -1
    return 20
  }
  if (WET.has(b)) return -1                       // nobody walks through a bathroom to get to another room
  if (BED.has(a)) {
    if (b === 'passage') return 90
    if (b === 'living_room' || b === 'family_lounge') return 70
    if (b === 'staircase') return 55
    if (b === 'dining') return 40
    if (b === 'kitchen') return 10                  // last resort: better a door from the kitchen than a sealed bedroom
    if (b === 'utility') return -1
    return 15
  }
  if (a === 'kitchen') return b === 'dining' ? 90 : b === 'living_room' || b === 'passage' ? 70 : b === 'utility' ? 50 : BED.has(b) || WET.has(b) ? -1 : 20
  if (a === 'utility') return b === 'kitchen' ? 90 : b === 'passage' || b === 'living_room' || b === 'dining' ? 60 : BED.has(b) || WET.has(b) ? -1 : 20
  if (b === 'passage' || b === 'living_room' || b === 'dining' || b === 'family_lounge') return 60
  return 20
}

const label = (a: string, b: string) => (WET.has(a) || WET.has(b)) ? 'bathroom' : (BED.has(a) || BED.has(b)) ? 'bedroom' : a === 'puja_room' || b === 'puja_room' ? 'puja_room' : a === 'utility' || b === 'utility' ? 'utility' : 'internal'
const widthFor = (a: string, b: string) => (WET.has(a) || WET.has(b) || a === 'utility' || b === 'utility' || a === 'puja_room' || b === 'puja_room') ? 2.5 : 3.0

export function repairPlanAccess(input: PPlan): PlanAccessReport {
  // work on a copy of the door lists only (rooms are never touched)
  const floors: PFloor[] = input.floors.map((f) => ({ ...f, layout: f.layout ? { ...f.layout, openings: { ...(f.layout.openings ?? {}), doors: [...(f.layout.openings?.doors ?? [])] } } : f.layout }))
  const plan: PPlan = { ...input, floors }
  const nodes: string[] = []
  const roomOf = new Map<string, PRoom>()
  floors.forEach((f, fi) => (f.layout?.rooms ?? []).forEach((r) => { const k = `${fi}:${rid(r)}`; nodes.push(k); roomOf.set(k, r) }))

  const buildEdges = () => {
    const adj = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]))
    const link = (p: string, q: string) => { adj.get(p)?.add(q); adj.get(q)?.add(p) }
    floors.forEach((f, fi) => {
      const rooms = f.layout?.rooms ?? []
      const byId = new Map(rooms.map((r) => [rid(r), r]))
      for (const d of f.layout?.openings?.doors ?? []) {
        const owner = d.room ? byId.get(d.room) : undefined
        const s = segOf(d, owner)
        const ids = new Set<string>(s ? joins(s, rooms) : [])
        if (d.room && byId.has(d.room)) ids.add(d.room)
        if (d.connects_to && byId.has(d.connects_to)) ids.add(d.connects_to)
        const list = [...ids]
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) link(`${fi}:${list[i]}`, `${fi}:${list[j]}`)
      }
    })
    // stairs join floors: the staircase rooms stacked on each other
    for (let fi = 0; fi + 1 < floors.length; fi++) {
      for (const a of floors[fi].layout?.rooms ?? []) {
        if (a.room_type !== 'staircase') continue
        for (const b of floors[fi + 1].layout?.rooms ?? []) {
          if (b.room_type !== 'staircase') continue
          if (Math.min(x2(a), x2(b)) - Math.max(a.x, b.x) > 1 && Math.min(y2(a), y2(b)) - Math.max(a.y, b.y) > 1) link(`${fi}:${rid(a)}`, `${fi + 1}:${rid(b)}`)
        }
      }
    }
    return adj
  }
  const entry = (): string | null => {
    const rooms0 = floors[0]?.layout?.rooms ?? []
    const main = (floors[0]?.layout?.openings?.doors ?? []).find((d) => d.door_type === 'main')
    if (main?.room && rooms0.some((r) => rid(r) === main.room)) return `0:${main.room}`
    return null
  }
  const reach = (adj: Map<string, Set<string>>, from: string, mode: 'loose' | 'strict' | 'private' = 'strict'): Set<string> => {
    const seen = new Set([from]); const q = [from]
    // strict: a bathroom / toilet / balcony is a dead end - it is reached, but the way on to other rooms does not lead through it
    for (let h = 0; h < q.length; h++) {
      const t = roomOf.get(q[h])?.room_type ?? ''
      if (mode !== 'loose' && q[h] !== from && DEAD_END.has(t)) continue
      const bedroom = mode === 'private' && q[h] !== from && BED.has(t)      // a bedroom leads on only to its own bathroom / balcony
      for (const n of adj.get(q[h]) ?? []) {
        if (seen.has(n) || (bedroom && !DEAD_END.has(roomOf.get(n)?.room_type ?? ''))) continue
        seen.add(n); q.push(n)
      }
    }
    return seen
  }

  const start = entry()
  const report: PlanAccessReport = { cutOff: [], added: [], unresolved: [], throughDeadEnd: [], graphOk: true, plan }
  if (!start) { report.graphOk = false; report.unresolved = nodes.slice(); return report }     // no front door: nothing can be proven or repaired here
  let adj = buildEdges()
  let seen = reach(adj, start)
  const needsDoor = (n: string) => !OPEN_AIR.has(roomOf.get(n)?.room_type ?? '')
  report.cutOff = nodes.filter((n) => !seen.has(n) && needsDoor(n))
  const tried = new Set<string>()
  for (let pass = 0; pass < nodes.length + 2; pass++) {
    const cut = nodes.filter((n) => !seen.has(n) && !tried.has(n) && needsDoor(n))
    if (!cut.length) break
    let progressed = false
    // the room with the best available door goes first, so a room that can only be reached through another cut-off room waits for it
    // a bathroom already joined by a door to a room that is itself cut off waits for that room (it comes with it)
    const waits = (n: string) => WET.has(roomOf.get(n)?.room_type ?? '') && [...(adj.get(n) ?? [])].some((m) => !seen.has(m) && !DEAD_END.has(roomOf.get(m)?.room_type ?? '') && needsDoor(m) && !tried.has(m))
    const cutNow = cut.filter((n) => !waits(n))
    const options = (cutNow.length ? cutNow : cut).map((n) => {
      const [fi, id] = [Number(n.split(':')[0]), n.slice(n.indexOf(':') + 1)]
      const r = roomOf.get(n)!
      let best: { score: number; n: PRoom; seg: Seg; w: number } | null = null
      for (const nb of floors[fi].layout?.rooms ?? []) {
        if (rid(nb) === id || !seen.has(`${fi}:${rid(nb)}`)) continue
        const sc = score(r, nb)
        if (sc < 0) continue
        const w = widthFor(r.room_type, nb.room_type)
        // the wall the two rooms share
        const cands: Seg[] = []
        if (near(x2(r), nb.x) || near(r.x, x2(nb))) {
          const c = near(x2(r), nb.x) ? x2(r) : r.x
          const a = Math.max(r.y, nb.y), b = Math.min(y2(r), y2(nb))
          if (b - a >= w + 1.0) cands.push({ axis: 'v', c, a, b })
        }
        if (near(y2(r), nb.y) || near(r.y, y2(nb))) {
          const c = near(y2(r), nb.y) ? y2(r) : r.y
          const a = Math.max(r.x, nb.x), b = Math.min(x2(r), x2(nb))
          if (b - a >= w + 1.0) cands.push({ axis: 'h', c, a, b })
        }
        for (const seg of cands) {
          const len = seg.b - seg.a
          const s2 = sc + Math.min(len, 12) * 0.2
          if (!best || s2 > best.score) best = { score: s2, n: nb, seg, w }
        }
      }
      return { n, id, fi, r, best }
    }).filter((o) => o.best).sort((p, q) => q.best!.score - p.best!.score)
    const o = options[0]
    if (!o) break
    const { fi, r, best } = o
    const seg = best!.seg, w = best!.w
    // keep the door clear of the wall's ends (a leaf folded back against a corner has to fit) and of existing doors on that wall
    const lo = seg.a + 0.9, hi = seg.b - 0.9 - w
    const existing = (floors[fi].layout?.openings?.doors ?? []).map((d) => segOf(d, (floors[fi].layout?.rooms ?? []).find((q) => rid(q) === d.room))).filter((s): s is Seg => !!s && s.axis === seg.axis && near(s.c, seg.c))
    let pos = Math.max(lo, Math.min(hi, (seg.a + seg.b) / 2 - w / 2))
    for (const e of existing) if (pos < e.b + 0.8 && pos + w > e.a - 0.8) pos = pos <= (e.a + e.b) / 2 ? e.a - 0.8 - w : e.b + 0.8
    if (pos < lo - 1e-6 || pos > hi + 1e-6) { tried.add(o.n); continue }
    const door: PDoor = {
      id: `access_door_${report.added.length + 1}`, room: rid(r), connects_to: rid(best!.n), width: w, door_type: label(r.room_type, best!.n.room_type), source: 'assumed_access',
      ...(seg.axis === 'h' ? { x1: pos, x2: pos + w, y1: seg.c, y2: seg.c } : { x1: seg.c, x2: seg.c, y1: pos, y2: pos + w }),
    }
    floors[fi].layout!.openings!.doors!.push(door)
    report.added.push({ floor: fi, room: rid(r), to: rid(best!.n), width: w, x1: door.x1!, y1: door.y1!, x2: door.x2!, y2: door.y2!, reason: `${r.room_type.replace(/_/g, ' ')} had no door that could be reached from the front door` })
    adj = buildEdges(); seen = reach(adj, start); progressed = true
    tried.delete(o.n)
    if (!progressed) break
  }
  const loose = reach(adj, start, 'loose'), priv = reach(adj, start, 'private')
  report.unresolved = nodes.filter((n) => !loose.has(n) && needsDoor(n))
  report.throughDeadEnd = nodes.filter((n) => loose.has(n) && !priv.has(n) && needsDoor(n))
  report.graphOk = report.unresolved.length === 0
  return report
}
