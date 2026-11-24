/**
 * Unit tests of the customisation document and the per-room skin geometry (src/custom/*), run by tests/test_vr_webxr.py after bundling with esbuild for node.
 * Prints {passed, total, failed}.  Pure logic: no browser, no headset.  (The live changes on the loaded 3D house are tested in dev/e2e_custom.cjs.)
 */
import assert from 'node:assert/strict'
import { CustomStore } from '../src/custom/store'
import { emptyState, parseState, pruneRooms, sameState } from '../src/custom/types'
import { collectWallFaces, roomWallSegs, wallQuad, flatQuad, mergeQuads, isSkinnable } from '../src/custom/skins'
import { FLOOR_OPTIONS, WALL_PAINTS, WALL_MATERIALS, PALETTES, ROLE_OPTIONS, CEILING_COLORS } from '../src/custom/catalog'

const tests: Array<[string, () => void]> = []
const test = (n: string, f: () => void) => tests.push([n, f])
const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } } }

test('store: starts as the original design (empty)', () => { const s = new CustomStore('k'); assert.ok(sameState(s.state, emptyState())); assert.equal(s.changeCount, 0); assert.equal(s.canUndo, false) })
test('store: a change, undo, redo', () => {
  const s = new CustomStore('k')
  assert.ok(s.setRole('door', 'walnut')); assert.equal(s.state.roles.door, 'walnut')
  assert.ok(s.undo()); assert.equal(s.state.roles.door, undefined); assert.ok(s.redo()); assert.equal(s.state.roles.door, 'walnut')
  assert.equal(s.undo() && s.undo(), false)
})
test('store: an identical edit is not a history step', () => { const s = new CustomStore('k'); s.setRole('door', 'teak'); assert.equal(s.setRole('door', 'teak'), false); s.undo(); assert.equal(s.canUndo, false) })
test('store: a new edit after undo clears redo', () => { const s = new CustomStore('k'); s.setRole('door', 'teak'); s.undo(); s.setRole('door', 'white'); assert.equal(s.canRedo, false) })
test('store: editing several rooms is ONE undo step', () => {
  const s = new CustomStore('k'); s.editRooms(['0:a', '0:b', '1:c'], (r) => ({ ...r, wall: { color: '#aabbcc' } }))
  assert.equal(Object.keys(s.state.rooms).length, 3); s.undo(); assert.equal(Object.keys(s.state.rooms).length, 0)
})
test('store: reset returns to the original and is undoable', () => {
  const s = new CustomStore('k'); s.setRole('door', 'teak'); s.editRooms(['0:a'], () => ({ floor: { id: 'marble_white' } }))
  assert.ok(s.reset()); assert.ok(sameState(s.state, emptyState())); assert.equal(s.reset(), false)
  assert.ok(s.undo()); assert.equal(s.state.roles.door, 'teak'); assert.equal(s.state.rooms['0:a'].floor?.id, 'marble_white')
})
test('store: save writes to storage; a new store restores it (reload / VR re-entry)', () => {
  const st = mem(); const a = new CustomStore('proj1', st); a.setRole('upholstery', 'camel'); a.editRooms(['0:living_room'], () => ({ wall: { color: '#c98a76', finish: 'satin' } })); a.save()
  assert.ok(st.m.has('proj1'))
  const b = new CustomStore('proj1', st); assert.ok(b.hasSaved); assert.ok(sameState(b.state, a.state)); assert.equal(b.unsaved, false)
  assert.equal(new CustomStore('other', st).hasSaved, false)
})
test('store: unsaved edits are flagged and restore() brings back the saved design', () => {
  const s = new CustomStore('k', mem()); s.setRole('door', 'teak'); s.save(); s.setRole('door', 'white'); assert.ok(s.unsaved)
  assert.ok(s.restore()); assert.equal(s.state.roles.door, 'teak'); assert.equal(s.unsaved, false)
  assert.equal(new CustomStore('z').restore(), false)
})
test('store: corrupt or hostile saved data never throws and gives the original', () => {
  for (const bad of ['{not json', '[]', '"x"', 'null', JSON.stringify({ state: { roles: { door: '<script>' }, rooms: { '0:a': { wall: { color: 'red' } } } } })]) {
    const st = mem(); st.setItem('k', bad); const s = new CustomStore('k', st); assert.ok(sameState(s.state, emptyState()), bad)
  }
})
test('store: a storage that throws (private window) still lets the session work', () => {
  const st = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
  const s = new CustomStore('k', st); s.setRole('door', 'teak'); assert.doesNotThrow(() => s.save()); assert.equal(s.state.roles.door, 'teak')
})
test('store: adopt takes a design saved with the project only when nothing is saved here', () => {
  const s = new CustomStore('k'); assert.ok(s.adopt({ v: 1, roles: { door: 'teak' }, rooms: {} })); assert.equal(s.state.roles.door, 'teak'); assert.ok(s.hasSaved)
  const t = new CustomStore('k2', mem()); t.setRole('door', 'white'); t.save(); assert.equal(t.adopt({ v: 1, roles: { door: 'teak' }, rooms: {} }), false); assert.equal(t.state.roles.door, 'white')
  assert.equal(new CustomStore('k3').adopt(undefined), false)
})
test('store: prune drops rooms a new model does not have, keeps the rest and never touches roles', () => {
  const s = new CustomStore('k'); s.setRole('door', 'teak'); s.editRooms(['0:a', '0:gone'], () => ({ floor: { id: 'kota' } }))
  const dropped = s.prune(['0:a', '0:b']); assert.deepEqual(dropped, ['0:gone']); assert.ok(s.state.rooms['0:a']); assert.equal(s.state.roles.door, 'teak')
  assert.deepEqual(pruneRooms(emptyState(), []).dropped, [])
})
test('store: history is bounded', () => { const s = new CustomStore('k'); for (let i = 0; i < 150; i++) s.editRooms(['0:a'], () => ({ wall: { color: '#' + (i + 1000).toString(16).padStart(6, '0') } })); let n = 0; while (s.undo()) n++; assert.ok(n <= 100 && n >= 50) })
test('store: subscribers hear every change and can unsubscribe', () => { const s = new CustomStore('k'); const seen: string[] = []; const u = s.subscribe((_, w) => seen.push(w)); s.setRole('door', 'teak'); s.undo(); u(); s.redo(); assert.deepEqual(seen, ['role:door', 'undo']) })
test('parseState: keeps valid parts, drops malformed ones, normalises colour case', () => {
  const p = parseState({ v: 1, roles: { door: 'walnut', bad: 'A B' }, rooms: { '0:living_room': { wall: { color: '#ABCDEF', finish: 'satin' }, accent: { side: 'Q', color: '#000000' }, floor: { id: 'oak_warm', finish: 'gloss' } }, 'nonsense': { wall: { color: '#ffffff' } } } })
  assert.deepEqual(p.roles, { door: 'walnut' }); assert.equal(p.rooms['0:living_room'].wall?.color, '#abcdef'); assert.equal(p.rooms['0:living_room'].accent, undefined); assert.equal(p.rooms.nonsense, undefined)
})

// ------------------------------------------------------------------ skins
const box = (axis: 'x' | 'z', p: number, a0: number, a1: number, y0: number, y1: number, sign: 1 | -1) => ({ axis, sign, p, a0, a1, y0, y1 })
test('skins: wall faces are read from triangles (one rectangle per quad, floors and slopes ignored)', () => {
  // a +z facing quad at z=5 (x 0..4, y 0..10), and a floor quad that must be ignored
  const pos = [0, 0, 5, 4, 0, 5, 4, 10, 5, 0, 0, 5, 4, 10, 5, 0, 10, 5, 0, 0, 0, 4, 0, 0, 4, 0, 4]
  const f = collectWallFaces(pos, null)
  assert.equal(f.length, 1); assert.deepEqual([f[0].axis, f[0].sign, f[0].p, f[0].a0, f[0].a1], ['z', 1, 5, 0, 4])
  const back = collectWallFaces([0, 0, 5, 4, 10, 5, 4, 0, 5], null); assert.equal(back[0].sign, -1)
})
test('skins: a wall run that serves two rooms is clipped to each room, and only the inward-facing face counts', () => {
  const room = { key: '0:a', type: 'bedroom', x0: 0, x1: 10, z0: 0, z1: 10, y0: 0.3, y1: 10 }
  const faces = [box('z', 10 - 0.1, -5, 30, 0.3, 10, -1), box('z', 10 + 0.1, -5, 30, 0.3, 10, 1), box('x', 0.1, 0, 10, 0.3, 10, 1), box('x', 5, 0, 10, 0.3, 10, 1)]
  const segs = roomWallSegs(faces, room)
  const south = segs.filter((s) => s.side === 'S'); assert.equal(south.length, 1); assert.equal(south[0].a0, 0); assert.equal(south[0].a1, 10)        // clipped to the room, the outside face skipped
  assert.equal(segs.filter((s) => s.side === 'W').length, 1)
  assert.equal(segs.filter((s) => s.p === 5).length, 0)                                                                                      // a free-standing wall is nobody's edge
})
test('skins: the room above or below is not picked up', () => {
  const room = { key: '0:a', type: 'bedroom', x0: 0, x1: 10, z0: 0, z1: 10, y0: 0.3, y1: 10 }
  assert.equal(roomWallSegs([box('x', 0.1, 0, 10, 10.3, 20, 1)], room).length, 0)
})
test('skins: door openings stay open (faces beside / above a door give separate pieces)', () => {
  const room = { key: '0:a', type: 'bedroom', x0: 0, x1: 10, z0: 0, z1: 10, y0: 0.3, y1: 10 }
  const faces = [box('z', 0.1, 0, 3, 0.3, 10, 1), box('z', 0.1, 3, 6, 7, 10, 1), box('z', 0.1, 6, 10, 0.3, 10, 1)]
  const n = roomWallSegs(faces, room).filter((s) => s.side === 'N'); assert.equal(n.length, 3)
  assert.ok(!n.some((s) => s.a0 < 6 && s.a1 > 3 && s.y0 < 7))                                                                                // nothing covers the doorway
})
test('skins: a wall quad faces into the room, sits 3 mm in front and has tile-unit uv', () => {
  const seg = { side: 'N' as const, axis: 'z' as const, sign: 1 as const, p: 0.1, a0: 0, a1: 8, y0: 0.3, y1: 10 }
  const q = wallQuad(seg, 4)
  assert.ok(q.pos.filter((_, i) => i % 3 === 2).every((z) => Math.abs(z - 0.11) < 1e-9)); assert.deepEqual(q.nor.slice(0, 3), [0, 0, 1])
  const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = q.pos.slice(0, 9).concat([]); const a = [x1 - x0, y1 - y0, z1 - z0], b = [x2 - x0, y2 - y0, z2 - z0]
  assert.ok(a[0] * b[1] - a[1] * b[0] > 0)                                                                                                  // winding matches the normal (+z)
  assert.ok(q.uv.some((u) => Math.abs(u - 2) < 1e-9))
  const east = wallQuad({ ...seg, axis: 'x', sign: -1, p: 7.9 }, 4); assert.deepEqual(east.nor.slice(0, 3), [-1, 0, 0]); assert.ok(east.pos.filter((_, i) => i % 3 === 0).every((x) => Math.abs(x - 7.89) < 1e-9))
})
test('skins: floor faces up and ceiling faces down, merged quads index correctly', () => {
  const f = flatQuad(0, 4, 0, 5, 0.3, true, 2), c = flatQuad(0, 4, 0, 5, 9.9, false, 1)
  const wind = (q: { pos: number[] }) => { const p = q.pos, ux = p[3] - p[0], uz = p[5] - p[2], vx = p[6] - p[0], vz = p[8] - p[2]; return uz * vx - ux * vz }
  const effY = (q: { pos: number[]; index: number[] }) => (q.index[1] === 1 ? 1 : -1) * wind(q)                                       // y of the normal of the triangle as indexed
  assert.ok(effY(f) > 0); assert.ok(effY(c) < 0)
  const m = mergeQuads([f, c]); assert.equal(m.pos.length, 24); assert.equal(Math.max(...m.index), 7)
})
test('skins: stairs, terraces and parking get no floor / ceiling skin', () => { for (const t of ['staircase', 'balcony', 'open_terrace', 'parking', 'courtyard']) assert.equal(isSkinnable(t), false); for (const t of ['bedroom', 'kitchen', 'living_room']) assert.ok(isSkinnable(t)) })

// ------------------------------------------------------------------ catalogue
test('catalog: floors cover wood, marble, granite and ceramic with unique ids and real surfaces', () => {
  assert.equal(new Set(FLOOR_OPTIONS.map((f) => f.id)).size, FLOOR_OPTIONS.length)
  for (const g of ['Wood', 'Marble', 'Granite', 'Ceramic']) assert.ok(FLOOR_OPTIONS.some((f) => f.group === g), g)
  for (const f of FLOOR_OPTIONS) { const s = f.s('satin'); assert.ok(s.kind, f.id); assert.match(f.swatch, /^#[0-9a-f]{6}$/i) }
})
test('catalog: wall paints, wall materials, ceiling colours are valid colours with unique ids', () => {
  for (const l of [WALL_PAINTS, CEILING_COLORS]) { assert.equal(new Set(l.map((o) => o.id)).size, l.length); l.forEach((o) => assert.match(o.swatch, /^#[0-9a-f]{6}$/i, o.id)) }
  assert.ok(WALL_MATERIALS.length >= 4)
})
test('catalog: every role tab offers choices and "original" is never a design-studio id', () => { for (const [k, d] of Object.entries(ROLE_OPTIONS)) assert.ok(d.options.length >= 3, k) })
test('catalog: a palette fills every indoor room, skips outdoor ones and its ids parse back as a valid state', () => {
  const rooms = [{ key: '0:living', type: 'living_room' }, { key: '0:bed', type: 'bedroom' }, { key: '0:bath', type: 'bathroom' }, { key: '0:stairs', type: 'staircase' }, { key: '1:balc', type: 'balcony' }]
  for (const p of PALETTES) {
    const s = p.build(rooms); assert.deepEqual(Object.keys(s.rooms).sort(), ['0:bath', '0:bed', '0:living']); assert.ok(sameState(parseState(s), s), p.id)
    for (const r of Object.values(s.rooms)) assert.ok(FLOOR_OPTIONS.some((f) => f.id === r.floor!.id), p.id)
  }
})

const failed: Array<{ name: string; error: string }> = []
let passed = 0
for (const [name, fn] of tests) { try { fn(); passed++ } catch (e) { failed.push({ name, error: String((e as Error).message).slice(0, 400) }) } }
console.log(JSON.stringify({ passed, total: tests.length, failed }))
process.exit(failed.length ? 1 : 0)
