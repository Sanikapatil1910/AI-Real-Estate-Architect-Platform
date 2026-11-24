/**
 * Unit tests of the browser Smart House logic (src/vr/smart/*), run by tests/test_smart_house_web.py after bundling with esbuild for node.
 * Prints {passed, failed:[{name, error}]}.  Pure logic: no browser, no headset.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FanModel, defaultFanSpec, validateFanSpec } from '../src/vr/smart/fan'
import { SmartHouseState, LightBank, formatEnergy, formatWatts } from '../src/vr/smart/state'
import { parseCommand, normalize, VoiceStatusBoard } from '../src/vr/smart/voice'
import { PanelModel, layoutPanel, hitPanel, runPanelAction, FAN_SPEEDS, PANEL_H, PANEL_W } from '../src/vr/smart/panel'
import { layoutFanPopup } from '../src/vr/fanPopup'
import { parseSmartHouse, RoomLocator, SmartHouseFormatError } from '../src/vr/smart/document'
import { buildSmartHouse } from '../src/lib/smartHouse'
import { projectPlan } from './project_plan'

const tests: Array<[string, () => void]> = []
const test = (n: string, f: () => void) => tests.push([n, f])
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b}`)

const FIX = process.env.VR_FIXTURES ?? join(__dirname, 'fixtures')
const loadPlan = (f: string) => { const p = JSON.parse(readFileSync(join(FIX, f), 'utf8')); return p.plan ?? p }
const houseOf = (f: string) => buildSmartHouse(loadPlan(f), projectPlan)
const newState = (f = 'g2_0.json') => SmartHouseState.fromDocument(parseSmartHouse(JSON.parse(JSON.stringify(houseOf(f)))))

// ------------------------------------------------------------------ fan
test('fan: level table 0..5 gives 0/90/140/190/240/300 rpm at steady state', () => {
  const spec = defaultFanSpec()
  spec.rpm.forEach((rpm, lvl) => { const f = new FanModel(); f.setLevel(lvl); f.tick(60); near(f.velocityDegPerSec, rpm * 6); })
})
test('fan: exact angle integration is independent of the frame rate', () => {
  const a = new FanModel(), b = new FanModel(), c = new FanModel()
  for (const f of [a, b, c]) f.setLevel(5)
  a.tick(7.3)
  for (let i = 0; i < 73; i++) b.tick(0.1)
  for (let i = 0; i < 730; i++) c.tick(0.01)
  near(a.totalDeg, b.totalDeg, 1e-6); near(a.totalDeg, c.totalDeg, 1e-6)
})
test('fan: spin-up to level 5 takes ~4 s and the angle matches the analytic area under the ramp', () => {
  const f = new FanModel(); f.setLevel(5)
  f.tick(4)
  near(f.velocityDegPerSec, 1800); near(f.totalDeg, 0.5 * 450 * 16, 1e-6)       // 3600 deg after the 4 s ramp
  f.tick(1); near(f.totalDeg, 3600 + 1800, 1e-6)
})
test('fan: blades turn faster at a higher level (visible speed change)', () => {
  const speeds = [1, 2, 3, 4, 5].map((l) => { const f = new FanModel(); f.setLevel(l); f.tick(30); const t0 = f.totalDeg; f.tick(1); return f.totalDeg - t0 })
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1])
})
test('fan: level 0 brakes to a stop; lower level decelerates more gently', () => {
  const f = new FanModel(); f.setLevel(5); f.tick(10)
  f.setLevel(4); f.tick(0.5); near(f.velocityDegPerSec, 1800 - 150)
  f.setLevel(0); f.tick(0.5); near(f.velocityDegPerSec, 1650 - 300)
  f.tick(10); assert.equal(f.velocityDegPerSec, 0); assert.ok(f.isStopped)
})
test('fan: level is clamped to 0..5; bad dt is ignored; angle wraps 0..360', () => {
  const f = new FanModel(); f.setLevel(99); assert.equal(f.level, 5); f.setLevel(-3); assert.equal(f.level, 0)
  assert.equal(f.tick(NaN), 0); assert.equal(f.tick(-1), 0); assert.equal(f.tick(Infinity), 0)
  f.setLevel(5); f.tick(20); assert.ok(f.angleDeg >= 0 && f.angleDeg < 360)
})
test('fan: spec validation rejects non-monotonic rpm', () => {
  const s = defaultFanSpec(); s.rpm[3] = 100
  assert.throws(() => validateFanSpec(s))
})

// ------------------------------------------------------------------ lights / state
test('lights: ALL ON / ALL OFF reach every room and report the change count', () => {
  const st = newState(); const n = st.lights.rooms.length
  assert.equal(st.setAllLights(true, 'panel'), n); assert.equal(st.lights.onCount, n)
  assert.equal(st.setAllLights(true, 'panel'), 0)
  assert.equal(st.setAllLights(false, 'panel'), n); assert.equal(st.lights.onCount, 0)
})
test('lights: individual control changes only that room and raises one event with the source', () => {
  const st = newState(); const ev: string[] = []
  st.lights.changed.on((k, on, s) => ev.push(`${k}|${on}|${s}`))
  const k = st.lights.rooms[1].key
  assert.ok(st.lights.set(k, true, 'switch')); assert.ok(!st.lights.set(k, true, 'switch'))
  assert.equal(st.lights.onCount, 1); assert.deepEqual(ev, [`${k}|true|switch`])
})
test('fans: individual levels 0..5, only rooms that have a fan', () => {
  const st = newState(); const keys = st.fanKeys; assert.ok(keys.length > 0)
  for (let l = 0; l <= 5; l++) { st.setFanLevel(keys[0], l, 'panel'); assert.equal(st.fanLevel(keys[0]), l) }
  st.setFanLevel(keys[0], 9, 'panel'); assert.equal(st.fanLevel(keys[0]), 5)
  const noFan = st.lights.rooms.find((r) => !r.hasFan)!
  assert.equal(st.setFanLevel(noFan.key, 3, 'panel'), false)
  for (const k of keys.slice(1)) assert.equal(st.fanLevel(k), 0)
})
test('state: the fan of a room is independent of other fans (blades advance only where the level is set)', () => {
  const st = newState(); const [a, b] = st.fanKeys
  st.setFanLevel(a, 5, 'panel'); st.tick(5)
  assert.ok(st.fan(a)!.totalDeg > 1000); assert.equal(st.fan(b)!.totalDeg, 0)
})

// ------------------------------------------------------------------ automatic lighting
function autoRig() {
  const st = newState(); st.auto.useSimulatedOccupant = true
  const [r0, r1] = st.lights.rooms.map((r) => r.key)
  return { st, r0, r1 }
}
test('auto: disabled by default and does nothing', () => {
  const { st, r0 } = autoRig(); st.auto.simulatedRoomKey = r0; st.tick(1); assert.equal(st.lights.onCount, 0); assert.equal(st.auto.isEnabled, false)
})
test('auto: entering a room switches its light on; leaving switches it off after the delay (30 s)', () => {
  const { st, r0, r1 } = autoRig(); st.auto.setEnabled(true)
  st.auto.simulatedRoomKey = r0; st.tick(0.1); assert.ok(st.lights.isOn(r0))
  st.auto.simulatedRoomKey = r1; st.tick(0.1); assert.ok(st.lights.isOn(r1)); assert.ok(st.lights.isOn(r0))
  st.tick(29); assert.ok(st.lights.isOn(r0)); near(st.auto.secondsUntilOff(r0), 30 - 29.1, 1e-6)
  st.tick(1); assert.ok(!st.lights.isOn(r0)); assert.ok(st.lights.isOn(r1))
})
test('auto: coming back before the delay cancels the switch-off', () => {
  const { st, r0, r1 } = autoRig(); st.auto.setEnabled(true)
  st.auto.simulatedRoomKey = r0; st.tick(0.1); st.auto.simulatedRoomKey = r1; st.tick(20)
  st.auto.simulatedRoomKey = r0; st.tick(15); assert.ok(st.lights.isOn(r0))
})
test('auto: a manual OFF while you stand in the room is held (not switched back on) until you leave', () => {
  const { st, r0, r1 } = autoRig(); st.auto.setEnabled(true)
  st.auto.simulatedRoomKey = r0; st.tick(0.1); assert.ok(st.lights.isOn(r0))
  st.lights.set(r0, false, 'panel'); st.tick(10); assert.ok(!st.lights.isOn(r0)); assert.ok(st.auto.isHeld(r0))
  st.auto.simulatedRoomKey = r1; st.tick(31); st.auto.simulatedRoomKey = r0; st.tick(0.1); assert.ok(st.lights.isOn(r0))
})
test('auto: a light set by hand from ANOTHER room keeps its manual state (countdown cancelled)', () => {
  const { st, r0, r1 } = autoRig(); st.auto.setEnabled(true)
  st.auto.simulatedRoomKey = r0; st.tick(0.1); st.auto.simulatedRoomKey = r1; st.tick(5)
  st.lights.set(r0, true, 'panel'); st.lights.set(r0, false, 'panel'); st.lights.set(r0, true, 'panel')   // user switches it on again from elsewhere
  st.tick(60); assert.ok(st.lights.isOn(r0), 'manual ON from elsewhere is not overridden by the auto-off countdown')
})
test('auto: manual ALL OFF overrides automatic lighting in the occupied room', () => {
  const { st, r0 } = autoRig(); st.auto.setEnabled(true)
  st.auto.simulatedRoomKey = r0; st.tick(0.1); st.setAllLights(false, 'panel'); st.tick(5); assert.equal(st.lights.onCount, 0)
})
test('auto: unavailable without room data (master-light mode)', () => {
  const st = SmartHouseState.master(); assert.equal(st.auto.setEnabled(true), false); assert.match(st.auto.status, /needs room data/)
})
test('auto: tracks the player room from currentRoomKey when not simulated', () => {
  const st = newState(); st.auto.setEnabled(true); const k = st.lights.rooms[2].key
  st.currentRoomKey = k; st.tick(0.1); assert.ok(st.lights.isOn(k))
})

// ------------------------------------------------------------------ energy
test('energy: 9 W per lit light, fan watts by level, and Wh = W x s / 3600', () => {
  const st = newState(); const [f] = st.fanKeys
  st.lights.set(st.lights.rooms[0].key, true, 'code'); st.lights.set(st.lights.rooms[1].key, true, 'code'); st.setFanLevel(f, 5, 'code')
  near(st.energy.lightsWatts, 18); near(st.energy.fansWatts, 75); near(st.energy.totalWatts, 93)
  st.energy.tick(3600); near(st.energy.sessionWh, 93)
  assert.equal(formatWatts(93.4), '93 W'); assert.equal(formatEnergy(93), '93.00 Wh'); assert.equal(formatEnergy(1500), '1.500 kWh')
})
test('energy: fan at level 0 draws nothing even while coasting; energy does not accumulate with everything off', () => {
  const st = newState(); const [f] = st.fanKeys
  st.setFanLevel(f, 5, 'code'); st.tick(10); st.setFanLevel(f, 0, 'code'); near(st.energy.fansWatts, 0)
  const wh = st.energy.sessionWh; st.tick(100); near(st.energy.sessionWh, wh)
})

// ------------------------------------------------------------------ voice
test('voice parser: lights', () => {
  assert.equal(parseCommand('turn on the living room light').kind, 'lightOn')
  assert.equal(parseCommand('Turn OFF the kitchen lights!').kind, 'lightOff')
  assert.equal(parseCommand('switch the light on').kind, 'lightOn')
  assert.equal(parseCommand('turn on all the lights').room.scope, 'all')
  assert.equal(parseCommand('lights out').kind, 'lightOff')
  assert.equal(parseCommand('turn off the second bedroom light').room.ordinal, 2)
  assert.equal(parseCommand('hello there').kind, 'unknown'); assert.equal(parseCommand('').kind, 'unknown')
})
test('voice parser: fans, levels, relative, stop', () => {
  const c = parseCommand('set the bedroom two fan to speed three'); assert.equal(c.kind, 'fanSet'); assert.equal(c.level, 3); assert.equal(c.room.ordinal, 2)
  assert.equal(parseCommand('fan speed 5').level, 5); assert.equal(parseCommand('stop the fan').kind, 'fanOff')
  assert.equal(parseCommand('turn the fan faster').kind, 'fanFaster'); assert.equal(parseCommand('make the fan slower').kind, 'fanSlower')
  assert.equal(parseCommand('turn on the living room fan').kind, 'fanOn'); assert.equal(parseCommand('fan to maximum').level, 5)
})
test('voice parser: automatic lighting and the panel', () => {
  assert.equal(parseCommand('turn on automatic lighting').kind, 'autoOn'); assert.equal(parseCommand('disable the motion sensor').kind, 'autoOff')
  assert.equal(parseCommand('show the control panel').kind, 'panelShow'); assert.equal(parseCommand('hide the panel').kind, 'panelHide')
  assert.equal(normalize('  Hello,   WORLD! '), 'hello world')
})
test('voice execute: acts on named rooms, never guesses without a room, reports results', () => {
  const st = newState()
  const living = st.lights.rooms.find((r) => r.type === 'living_room')!
  let r = st.execute('turn on the living room light'); assert.ok(r.changed); assert.ok(st.lights.isOn(living.key)); assert.match(r.message, /ON/)
  r = st.execute('turn on the light'); assert.ok(!r.changed); assert.match(r.message, /Say which room/)
  st.currentRoomKey = living.key; r = st.execute('turn off the light'); assert.ok(r.changed); assert.ok(!st.lights.isOn(living.key))
  r = st.execute('turn on all lights'); assert.equal(st.lights.onCount, st.lights.rooms.length); assert.ok(r.changed)
  r = st.execute('banana'); assert.ok(!r.understood); assert.match(r.message, /Not understood/)
  assert.equal(st.execute('show the panel').panel, 'show')
  assert.ok(st.execute('turn on automatic lighting').changed); assert.ok(st.auto.isEnabled)
})
test('voice execute: fans by room, relative and clamped', () => {
  const st = newState(); const fanRoom = st.lights.rooms.find((r) => r.hasFan && r.type === 'living_room') ?? st.lights.rooms.find((r) => r.hasFan)!
  st.currentRoomKey = fanRoom.key
  st.execute('fan speed three'); assert.equal(st.fanLevel(fanRoom.key), 3)
  st.execute('faster'); st.execute('turn the fan faster'); st.execute('turn the fan faster'); assert.equal(st.fanLevel(fanRoom.key), 5)
  st.execute('stop the fan'); assert.equal(st.fanLevel(fanRoom.key), 0)
  const noFan = st.lights.rooms.find((r) => !r.hasFan)!; st.currentRoomKey = noFan.key
  assert.match(st.execute('fan speed 2').message, /No ceiling fan/)
})
test('voice status board: recognised -> completed -> idle, not understood, microphone unavailable', () => {
  const b = new VoiceStatusBoard(); assert.equal(b.headline, 'Voice: off (use the panel)')
  b.onBackendState('unavailable', 'This browser has no speech recognition'); assert.equal(b.headline, 'Microphone unavailable'); assert.equal(b.tone, 'bad'); assert.match(b.detail, /no speech recognition/)
  b.onBackendState('listening'); assert.equal(b.headline, 'Listening...'); b.onPartial('turn on'); assert.equal(b.phase, 'hearing')
  b.onCommand('turn on the light', { understood: true, changed: true, message: 'Hall light ON', roomKeys: ['0:h'] }); assert.equal(b.headline, 'Command recognized')
  b.tick(0.6); assert.equal(b.headline, 'Action completed'); assert.equal(b.detail, 'Hall light ON')
  b.tick(3.1); assert.equal(b.headline, 'Listening...')
  b.onCommand('xyz', { understood: false, changed: false, message: '', roomKeys: [] }); assert.equal(b.headline, 'Command not understood')
  b.tick(10); b.onCommand('a', { understood: true, changed: false, message: 'none', roomKeys: [] }); assert.equal(b.phase, 'noTarget')
  b.tick(100); b.tick(100)
})

// ------------------------------------------------------------------ panel
test('panel: paging, rows, actions drive the shared state', () => {
  const st = newState(); const m = new PanelModel(st)
  assert.equal(m.rows().length, Math.min(6, m.roomCount)); assert.equal(m.pageCount, Math.ceil(m.roomCount / 6))
  m.page = 99; assert.equal(m.page, m.pageCount - 1); m.page = -1; assert.equal(m.page, 0)
  const row = m.rows()[0]; m.toggleLight(row.key); assert.ok(st.lights.isOn(row.key)); assert.ok(m.rows()[0].lightOn)
  assert.equal(m.allOn(), st.lights.rooms.length - 1); assert.equal(m.allOff(), st.lights.rooms.length)
  const fr = st.fanKeys[0]; m.fanStep(fr, +1); m.fanStep(fr, +1); assert.equal(st.fanLevel(fr), 2); m.fanStep(fr, -5); assert.equal(st.fanLevel(fr), 0)
  assert.match(m.energyLines[0], /Simulated power/); assert.match(m.lightsSummary, /of \d+ lights ON/)
})
test('panel layout: every button is inside the canvas, none overlap, hit-test finds the right action', () => {
  const st = newState(); const m = new PanelModel(st)
  for (const pg of [0, m.pageCount - 1]) {
    m.page = pg
    const L = layoutPanel(m, st, { floors: 2, showExit: true })
    for (const b of L.buttons) { assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= L.width && b.y + b.h <= L.height, `${b.id} outside the panel`) }
    for (let i = 0; i < L.buttons.length; i++) for (let j = i + 1; j < L.buttons.length; j++) {
      const a = L.buttons[i], c = L.buttons[j]
      const ov = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h
      assert.ok(!ov, `${a.id} overlaps ${c.id}`)
    }
    for (const t of L.texts) assert.ok(t.y <= L.height, 'text below the panel')
  }
  m.page = 0
  const L = layoutPanel(m, st, { floors: 2, showExit: true })
  const on = L.buttons.find((b) => b.id === 'allOn')!
  const hit = hitPanel(L, on.x + 5, on.y + 5)!; assert.equal(hit.id, 'allOn')
  assert.equal(runPanelAction(hit.action!, m), null); assert.equal(st.lights.onCount, st.lights.rooms.length)
  const off = L.buttons.find((b) => b.id === 'allOff')!; runPanelAction(off.action!, m); assert.equal(st.lights.onCount, 0)
  assert.deepEqual(runPanelAction({ t: 'floor', floor: 1 }, m), { t: 'floor', floor: 1 })
  assert.deepEqual(runPanelAction({ t: 'goto', key: '0:x' }, m), { t: 'goto', key: '0:x' })
  assert.equal(hitPanel(L, -5, -5), null)
})
test('panel layout: row buttons act on THEIR room', () => {
  const st = newState(); const m = new PanelModel(st); const rows = m.rows()
  rows.forEach((r) => {
    const L = layoutPanel(m, st); const b = L.buttons.find((x) => x.id === `light:${r.key}`)!
    runPanelAction(hitPanel(L, b.x + 2, b.y + 2)!.action!, m)
    assert.ok(st.lights.isOn(r.key)); assert.equal(st.lights.onCount, rows.indexOf(r) + 1)
  })
})
test('panel layout: disabled buttons (fan − at level 0) cannot be hit into an action', () => {
  const st = newState(); const m = new PanelModel(st); const r = m.rows().find((x) => x.hasFan)
  if (!r) return
  const L = layoutPanel(m, st); const b = L.buttons.find((x) => x.id === `fan-:${r.key}`)!
  assert.equal(b.action, null)
})

// ------------------------------------------------------------------ document
test('document: every stored fixture plan produces a sidecar this viewer accepts (JSON round trip)', () => {
  let n = 0
  for (const f of readdirSync(FIX).filter((x) => x.endsWith('.json'))) {
    const p = JSON.parse(readFileSync(join(FIX, f), 'utf8')); const plan = p.plan ?? p
    if (!plan.floors?.length) continue
    const doc = parseSmartHouse(JSON.stringify(buildSmartHouse(plan, projectPlan))); assert.ok(doc.rooms.length > 0, f); n++
  }
  assert.ok(n >= 15, `only ${n} fixtures parsed`)
})
test('document: invalid / foreign / future files are rejected with a clear message', () => {
  assert.throws(() => parseSmartHouse('{not json'), SmartHouseFormatError)
  assert.throws(() => parseSmartHouse({}), /Not a smart-house file/)
  assert.throws(() => parseSmartHouse({ schema: 'realestate.smart-house/2', units: 'feet', rooms: [{}], floors: [{}] }), /Unsupported smart-house schema/)
  const d = JSON.parse(JSON.stringify(houseOf('g1_0.json')))
  const bad = JSON.parse(JSON.stringify(d)); bad.units = 'meters'; assert.throws(() => parseSmartHouse(bad), /units/)
  const dup = JSON.parse(JSON.stringify(d)); dup.rooms.push(dup.rooms[0]); assert.throws(() => parseSmartHouse(dup), /Duplicate room/)
  const norect = JSON.parse(JSON.stringify(d)); delete norect.rooms[0].rect; assert.throws(() => parseSmartHouse(norect), /rectangle/)
  const empty = JSON.parse(JSON.stringify(d)); empty.rooms = []; assert.throws(() => parseSmartHouse(empty), /no rooms/)
  assert.throws(() => parseSmartHouse([]), /not a JSON object/)
})
test('document: room locator finds the room by x/z and floor height, null outside', () => {
  const doc = parseSmartHouse(JSON.parse(JSON.stringify(houseOf('g2_0.json')))); const loc = new RoomLocator(doc.rooms)
  for (const r of doc.rooms) {
    const cx = (r.rect.x0 + r.rect.x1) / 2, cz = (r.rect.z0 + r.rect.z1) / 2
    const k = loc.locate(cx, r.floor_y + 3, cz); assert.ok(k, `${r.id} not located`)
    assert.equal(doc.rooms.find((q) => `${q.floor}:${q.id}` === k)!.floor, r.floor)
  }
  assert.equal(loc.locate(-500, 3, -500), null)
})
test('state: master-light fallback has one light and no fans', () => {
  const st = SmartHouseState.master(); assert.equal(st.lights.rooms.length, 1); assert.equal(st.fanKeys.length, 0)
  st.execute('turn on the light'); assert.equal(st.lights.onCount, 1)
  assert.ok(LightBank.master().isMaster)
})

// ------------------------------------------------------------------ in-VR fan control (panel strip, popup, voice phrases, speeds)
const fanRoom = (st: SmartHouseState) => st.lights.rooms.find((r) => r.hasFan)!
test('fan speeds 1/2/3/4/5: steady blade speed is strictly increasing (540/840/1140/1440/1800 deg/s; 4 is distinct, faster than 3 and slower than 5) and OFF decays to exactly 0', () => {
  const v = FAN_SPEEDS.map((l) => { const f = new FanModel(); f.setLevel(l); f.tick(60); return f.velocityDegPerSec })
  assert.deepEqual([...FAN_SPEEDS], [1, 2, 3, 4, 5])
  assert.deepEqual(v, [540, 840, 1140, 1440, 1800])
  const f = new FanModel(); f.setLevel(5); f.tick(10); f.setLevel(0); f.tick(10); assert.equal(f.velocityDegPerSec, 0)
})
test('voice: the eight required phrases change the real fan / light state of the room the person is in', () => {
  const st = newState(); const r = fanRoom(st); st.currentRoomKey = r.key
  const lvl = () => st.fanLevel(r.key)
  st.execute('Turn on the fan.'); assert.ok(lvl() > 0)
  st.execute('Turn off the fan.'); assert.equal(lvl(), 0)
  for (const n of [1, 2, 3, 4, 5]) { const res = st.execute(`Set fan speed to ${n}.`); assert.equal(lvl(), n, `speed ${n}: ${res.message}`) }
  st.execute('Turn on the lights.'); assert.ok(st.lights.isOn(r.key))
  st.execute('Turn off the lights.'); assert.ok(!st.lights.isOn(r.key))
})
test('voice: spoken variants (five, fan speed to five, fan to 5, speed 3) are understood; nonsense changes nothing and says so', () => {
  const st = newState(); const r = fanRoom(st); st.currentRoomKey = r.key
  st.execute('set fan speed to five'); assert.equal(st.fanLevel(r.key), 5)
  st.execute('fan speed 3'); assert.equal(st.fanLevel(r.key), 3)
  st.execute('set fan speed to four'); assert.equal(st.fanLevel(r.key), 4)
  st.execute('Set fan speed to 4'); assert.equal(st.fanLevel(r.key), 4)
  st.execute('set fan speed to for'); assert.equal(st.fanLevel(r.key), 4)   // speech recognisers often hear 'four' as 'for'
  st.execute('fan speed 3'); assert.equal(st.fanLevel(r.key), 3)
  st.execute('please turn the fan off'); assert.equal(st.fanLevel(r.key), 0)
  const bad = st.execute('open the pod bay doors'); assert.equal(bad.changed, false); assert.ok(bad.message.length > 5)
  assert.equal(st.fanLevel(r.key), 0)
})
test('state: fan ON returns to the last speed used (default 3 for a fan never run); toggle is ON <-> OFF', () => {
  const st = newState(); const r = fanRoom(st)
  assert.equal(st.fanOnLevel(r.key), 3)
  st.fanOn(r.key, 'switch'); assert.equal(st.fanLevel(r.key), 3)
  st.setFanLevel(r.key, 5, 'panel'); st.fanToggle(r.key, 'switch'); assert.equal(st.fanLevel(r.key), 0)
  st.fanToggle(r.key, 'switch'); assert.equal(st.fanLevel(r.key), 5)
  st.execute('turn off the fan'); st.currentRoomKey = r.key; st.execute('turn on the fan'); assert.equal(st.fanLevel(r.key), 5)
})
test('panel: the fan strip has FAN OFF, FAN ON and SPEED 1/2/3/4/5 in that order; every action drives the real fan; the selected one is highlighted', () => {
  const st = newState(); const r = fanRoom(st); const m = new PanelModel(st); m.focusKey = r.key
  const lay = () => layoutPanel(m, st, { floors: 2 })
  const ids = lay().buttons.filter((b) => b.id.startsWith('fanstrip:')).map((b) => b.id)
  assert.deepEqual(ids, ['fanstrip:off', 'fanstrip:on', 'fanstrip:1', 'fanstrip:2', 'fanstrip:3', 'fanstrip:4', 'fanstrip:5'])
  for (const lv of FAN_SPEEDS) {
    const b = lay().buttons.find((q) => q.id === `fanstrip:${lv}`)!; assert.ok(b.action)
    assert.equal(runPanelAction(b.action!, m), null); assert.equal(st.fanLevel(r.key), lv)
    assert.equal(lay().buttons.find((q) => q.id === `fanstrip:${lv}`)!.kind, 'on')                      // selected state
    assert.notEqual(lay().buttons.find((q) => q.id === `fanstrip:${FAN_SPEEDS.find((x) => x !== lv)}`)!.kind, 'on')
  }
  runPanelAction(lay().buttons.find((q) => q.id === 'fanstrip:off')!.action!, m); assert.equal(st.fanLevel(r.key), 0)
  runPanelAction(lay().buttons.find((q) => q.id === 'fanstrip:on')!.action!, m); assert.equal(st.fanLevel(r.key), 5)   // back to the last speed
  assert.ok(lay().texts.some((t) => /Fan - .*ON, speed 5/.test(t.text)))
})
test('panel: with no ceiling fan in focus the strip is disabled and says so; the layout stays inside the canvas and buttons do not overlap', () => {
  const st = newState(); const m = new PanelModel(st); m.focusKey = null
  const L = layoutPanel(m, st, { floors: 3, showExit: true, seat: 'sit' })
  assert.ok(L.buttons.filter((b) => b.id.startsWith('fanstrip:')).every((b) => b.kind === 'disabled' && b.action === null))
  assert.ok(L.texts.some((t) => /no ceiling fan here/.test(t.text)))
  assert.equal(L.height, PANEL_H); assert.equal(L.width, PANEL_W)
  for (const b of L.buttons) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= PANEL_W && b.y + b.h <= PANEL_H, `${b.id} outside`)
  for (const t of L.texts) assert.ok(t.y <= PANEL_H, `text '${t.text}' below the canvas`)
  for (let i = 0; i < L.buttons.length; i++) for (let j = i + 1; j < L.buttons.length; j++) {
    const a = L.buttons[i], c = L.buttons[j]
    assert.ok(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y, `${a.id} overlaps ${c.id}`)
  }
})
test('popup: hint shows no buttons; the full control has OFF,1,2,3,4,5 in order (all inside the popup, none overlapping) whose centres hit-test to the right actions; selected level is highlighted', () => {
  const info = { key: '0:living', name: 'Living Room', floor: 0, level: 3, rpm: 190 }
  assert.equal(layoutFanPopup(info, 'hint').buttons.length, 0)
  const L = layoutFanPopup(info, 'full'); assert.deepEqual(L.buttons.map((b) => b.id), ['pop:0', 'pop:1', 'pop:2', 'pop:3', 'pop:4', 'pop:5'])
  for (let i = 1; i < L.buttons.length; i++) assert.ok(L.buttons[i].x >= L.buttons[i - 1].x + L.buttons[i - 1].w, `pop button ${i} overlaps the previous one`)
  for (const b of L.buttons) {
    const hit = hitPanel(L, b.x + b.w / 2, b.y + b.h / 2); assert.equal(hit?.id, b.id)
    assert.deepEqual(b.action, { t: 'fanSet', key: info.key, level: Number(b.id.slice(4)) })
    assert.ok(b.x + b.w <= L.width && b.y + b.h <= L.height)
  }
  assert.equal(L.buttons.find((b) => b.id === 'pop:3')!.kind, 'on'); assert.notEqual(L.buttons.find((b) => b.id === 'pop:2')!.kind, 'on')
  assert.ok(L.buttons.every((b) => b.w >= 100 && b.h >= 100))                                    // large controller targets
})
test('speed 4: one state model - panel strip, popup, keyboard path (setFanLevel) and voice all land on level 4, turn the blades at 1440 deg/s, and ON remembers 4', () => {
  const st = newState(); const r = fanRoom(st); st.currentRoomKey = r.key; const m = new PanelModel(st); m.focusKey = r.key
  const lay = () => layoutPanel(m, st, { floors: 2 })
  runPanelAction(lay().buttons.find((q) => q.id === 'fanstrip:4')!.action!, m); assert.equal(st.fanLevel(r.key), 4)
  assert.equal(lay().buttons.find((q) => q.id === 'fanstrip:4')!.kind, 'on'); assert.notEqual(lay().buttons.find((q) => q.id === 'fanstrip:3')!.kind, 'on'); assert.notEqual(lay().buttons.find((q) => q.id === 'fanstrip:5')!.kind, 'on')
  assert.ok(lay().texts.some((t) => /ON, speed 4/.test(t.text)))
  const pop = layoutFanPopup({ key: r.key, name: 'x', floor: 0, level: 4, rpm: 240 }, 'full')
  assert.equal(pop.buttons.find((b) => b.id === 'pop:4')!.kind, 'on')
  st.setFanLevel(r.key, 0, 'panel'); runPanelAction(pop.buttons.find((b) => b.id === 'pop:4')!.action!, m); assert.equal(st.fanLevel(r.key), 4)
  st.setFanLevel(r.key, 0, 'switch'); st.execute('Set fan speed to 4'); assert.equal(st.fanLevel(r.key), 4)
  st.fanToggle(r.key, 'switch'); assert.equal(st.fanLevel(r.key), 0); st.fanToggle(r.key, 'switch'); assert.equal(st.fanLevel(r.key), 4)
  const f = new FanModel(); f.setLevel(3); f.tick(60); const v3 = f.velocityDegPerSec; f.setLevel(4); f.tick(60); const v4 = f.velocityDegPerSec; f.setLevel(5); f.tick(60)
  assert.equal(v4, 1440); assert.ok(v3 < v4 && v4 < f.velocityDegPerSec)
})
test('fan control: three fans in different rooms keep independent levels', () => {
  const st = newState(); const fr = st.lights.rooms.filter((r) => r.hasFan); assert.ok(fr.length >= 2)
  st.setFanLevel(fr[0].key, 5, 'panel'); st.setFanLevel(fr[1].key, 1, 'switch')
  assert.equal(st.fanLevel(fr[0].key), 5); assert.equal(st.fanLevel(fr[1].key), 1)
  st.fanToggle(fr[0].key, 'switch'); assert.equal(st.fanLevel(fr[0].key), 0); assert.equal(st.fanLevel(fr[1].key), 1)
})

const failed: Array<{ name: string; error: string }> = []
let passed = 0
for (const [name, fn] of tests) { try { fn(); passed++ } catch (e) { failed.push({ name, error: String((e as Error).message).slice(0, 400) }) } }
console.log(JSON.stringify({ passed, total: tests.length, failed }))
process.exit(failed.length ? 1 : 0)
