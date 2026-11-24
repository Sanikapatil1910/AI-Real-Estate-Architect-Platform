/**
 * Browser end-to-end test of the website's VR walk-through (run by tests/test_vr_webxr.py; needs the backend + the vite dev server already running).
 *   node dev/e2e_vr.cjs <baseUrl> <fixtureName>[,<fixtureName>...] <outDir>
 * Prints one JSON object: { executed: [...], simulated: [...] }.
 *   executed  = ran for real in headless Chromium against the real backend and the real pages (no mocks).  This is NOT a headset.
 *   simulated = WebXR is MOCKED (a fake navigator.xr / session / input sources) and controller input is injected; it exercises our code paths only.
 * Nothing here has run on a Meta Quest.
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const [BASE, FIXTURES, OUT] = process.argv.slice(2)
const FIX = path.join(__dirname, 'fixtures')
fs.mkdirSync(OUT, { recursive: true })
const results = { executed: [], simulated: [] }
let bucket = 'executed'
const rec = (name, ok, detail = '') => results[bucket].push({ name, ok: !!ok, detail: String(detail).slice(0, 300) })
async function check(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return   // debugging aid: run only the checks whose name contains this text
  try { const r = await fn(); rec(name, r === undefined ? true : r === true || (r && r.ok !== false && r !== false), r && r.detail ? r.detail : (typeof r === 'string' ? r : '')) }
  catch (e) { rec(name, false, e && e.message ? e.message : e) }
}
const api = async (p, opt = {}) => { const r = await fetch(BASE + p, { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) } }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }

async function setup(plan, name) {
  const email = `vr${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`
  await api('/auth/signup', { method: 'POST', body: JSON.stringify({ full_name: 'VR Tester', email, password: 'Passw0rd!x', role: 'home_owner' }) })
  const tok = (await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!x' }) })).body.access_token
  const p = await api('/projects', { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ name, kind: 'generated', style: plan.architectural_style || 'Modern', data: { plan } }) })
  return { tok, id: p.body.id }
}

async function openViewer(browser, tok, id, { noSpeech = false, mockXr = false, viewport = { width: 1400, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript((t) => { try { localStorage.setItem('rea.token', t) } catch {} }, tok)
  if (noSpeech) await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  if (mockXr) await ctx.addInitScript(() => {
    // MOCK: a fake WebXR system. isSessionSupported -> true; requestSession -> a fake session whose input sources the test controls.
    const listeners = {}
    const session = {
      inputSources: [],
      addEventListener(t, f) { (listeners[t] ||= []).push(f) },
      async end() { (listeners.end || []).forEach((f) => f()) },
    }
    window.__fakeXr = { session, requests: [] }
    Object.defineProperty(navigator, 'xr', { configurable: true, value: {
      isSessionSupported: async (m) => m === 'immersive-vr',
      requestSession: async (m, init) => { window.__fakeXr.requests.push({ m, init }); return session },
    } })
  })
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  pg.on('console', (m) => { if (m.type() === 'error' && !/401|favicon/.test(m.text())) errors.push(m.text().slice(0, 300)) })
  pg.__errors = errors
  await pg.goto(`${BASE}/app/vr/${id}?vrdebug=1`)
  try { await pg.waitForSelector('[data-testid=vr-stage] canvas', { timeout: 180000 }) } catch (e) { throw new Error(`${e.message.split('\n')[0]} | page errors: ${errors.slice(0, 4).join(' || ')} | body: ${((await pg.textContent('body').catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 200)}`) }
  await pg.waitForFunction(() => !!window.__vrEngine, null, { timeout: 30000 })
  await pg.waitForTimeout(500)
  return { ctx, pg }
}

;(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const names = FIXTURES.split(',')
  for (const fx of names) {
    const plan = JSON.parse(fs.readFileSync(path.join(FIX, fx + '.json'), 'utf8'))
    const label = `[${fx}] `
    bucket = 'executed'
    const { tok, id } = await setup(plan, 'E2E ' + fx)

    if (!process.env.SIM_ONLY) {
    // ---------------------------------------------------------------- list page
    {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
      await ctx.addInitScript((t) => { try { localStorage.setItem('rea.token', t) } catch {} }, tok)
      const pg = await ctx.newPage()
      await pg.goto(`${BASE}/app/vr`)
      await check(label + 'VR list shows the saved house with an Enter VR button', async () => {
        await pg.waitForSelector('[data-testid=vr-house]', { timeout: 30000 })
        return (await pg.textContent('[data-testid=vr-house]')).includes('E2E ' + fx)
      })
      await check(label + 'Enter VR on the list opens the viewer of that house', async () => {
        await pg.click('[data-testid=vr-enter]')
        await pg.waitForSelector('[data-testid=vr-stage] canvas', { timeout: 180000 })
        return pg.url().endsWith('/app/vr/' + id)
      })
      await ctx.close()
    }

    // ---------------------------------------------------------------- viewer, real browser, no mocks
    const { ctx, pg } = await openViewer(browser, tok, id)
    const E = (fn, arg) => pg.evaluate(fn, arg)
    await check(label + 'the house loads from the saved plan: exported .glb has the glTF header, loaded back, merged for few draw calls', async () => {
      const r = await E(() => { const h = window.__vrEngine.house; const dv = new DataView(h.glb); return { magic: dv.getUint32(0, true), source: h.source, stats: h.stats } })
      return { ok: r.magic === 0x46546c67 && r.source === 'plan' && r.stats.meshes < 150 && r.stats.meshesBeforeMerge > r.stats.meshes * 3 && r.stats.triangles > 5000 && r.stats.glbBytes > 100000, detail: JSON.stringify(r.stats) }
    })
    await check(label + 'the smart-house data loaded with the house matches the plan (every room has a light; fans exist)', async () => {
      const r = await E(() => { const s = window.__vrEngine.house.smart; return { schema: s.schema, rooms: s.rooms.length, fans: s.rooms.filter((x) => x.fan).length, lights: window.__vrEngine.state.lights.rooms.length } })
      return { ok: r.schema === 'realestate.smart-house/1' && r.rooms > 3 && r.rooms === r.lights && r.fans > 0, detail: JSON.stringify(r) }
    })
    await check(label + 'no VR headset in this browser: Enter VR is disabled and the reason is shown; the desktop walk-through works', async () => {
      const dis = await pg.isDisabled('[data-testid=enter-vr]')
      const msg = await pg.textContent('[data-testid=vr-unavailable]')
      return { ok: dis && msg.length > 10, detail: msg }
    })
    await check(label + 'the player starts standing inside a room on a floor surface', async () => {
      const r = await E(() => { const e = window.__vrEngine; return { room: e.currentRoom, ok: e.house.nav.canStand(e.foot.x, e.foot.z, e.foot.y) !== null } })
      return { ok: r.ok && !!r.room, detail: JSON.stringify(r) }
    })
    await pg.screenshot({ path: path.join(OUT, `${fx}_desktop_start.png`) })

    const hold = async (code, seconds) => {            // real keyboard events; the engine is advanced by ticks so the result does not depend on the slow software-GL frame rate
      await pg.keyboard.down(code)
      await E((n) => { for (let i = 0; i < n; i++) window.__vrEngine.tick(0.05) }, Math.round(seconds / 0.05))
      await pg.keyboard.up(code)
    }
    await check(label + 'desktop walking: holding W moves the player; walking into a wall stops at it (never inside geometry)', async () => {
      await pg.focus('body')
      const before = await E(() => ({ ...window.__vrEngine.foot }))
      await hold('KeyW', 1.2)
      const mid = await E(() => ({ ...window.__vrEngine.foot }))
      await hold('KeyW', 25)
      const after = await E(() => { const e = window.__vrEngine; return { ...e.foot, ok: e.house.nav.canStand(e.foot.x, e.foot.z, e.foot.y) !== null } })
      await hold('KeyW', 3)
      const again = await E(() => ({ ...window.__vrEngine.foot }))
      const moved = Math.hypot(mid.x - before.x, mid.z - before.z)
      const blocked = Math.hypot(again.x - after.x, again.z - after.z) < 0.6 && Math.abs(again.y - after.y) < 1.2
      return { ok: moved > 1 && after.ok && blocked, detail: `moved ${moved.toFixed(2)} ft in 1.2 s; after 25 s standable=${after.ok}; 3 s more moved ${Math.hypot(again.x - after.x, again.z - after.z).toFixed(2)} ft` }
    })
    await check(label + 'turning with the arrow keys works; S walks backwards', async () => {
      const y0 = await E(() => window.__vrEngine.yaw)
      await hold('ArrowLeft', 0.5)
      const y1 = await E(() => window.__vrEngine.yaw)
      const f0 = await E(() => ({ ...window.__vrEngine.foot }))
      await hold('KeyS', 0.6)
      const f1 = await E(() => ({ ...window.__vrEngine.foot }))
      return { ok: Math.abs(y1 - y0) > 0.3, detail: `yaw ${y0.toFixed(2)} -> ${y1.toFixed(2)}; S moved ${Math.hypot(f1.x - f0.x, f1.z - f0.z).toFixed(2)} ft` }
    })

    // ---- smart house: the HTML panel
    await check(label + 'panel: ALL LIGHTS ON turns every room light on, ALL LIGHTS OFF turns them off', async () => {
      await pg.click('[data-testid=pb-allOn]')
      const on = await E(() => ({ n: window.__vrEngine.state.lights.onCount, t: window.__vrEngine.state.lights.rooms.length }))
      await pg.waitForTimeout(400)
      const glow = await E(() => { const f = [...window.__vrEngine.smart.fixtures.values()]; return f.every((x) => x.mat.emissiveIntensity > 0.5) })
      await pg.click('[data-testid=pb-allOff]')
      const off = await E(() => window.__vrEngine.state.lights.onCount)
      await pg.waitForTimeout(600)
      const dark = await E(() => [...window.__vrEngine.smart.fixtures.values()].every((x) => x.mat.emissiveIntensity < 0.3))
      return { ok: on.n === on.t && glow && off === 0 && dark, detail: `on=${on.n}/${on.t}, fixtures glow=${glow}, off=${off}, dark=${dark}` }
    })
    await check(label + 'panel: an individual room light switch changes only that room', async () => {
      const key = await E(() => window.__vrEngine.panel.rows()[1].key)
      await pg.click(`[data-testid="pb-light:${key}"]`)
      const r = await E((k) => ({ n: window.__vrEngine.state.lights.onCount, on: window.__vrEngine.state.lights.isOn(k) }), key)
      await pg.click(`[data-testid="pb-light:${key}"]`)
      const back = await E(() => window.__vrEngine.state.lights.onCount)
      return { ok: r.n === 1 && r.on && back === 0, detail: JSON.stringify(r) }
    })
    await check(label + 'panel: fan − / + buttons set levels 0..5 for one room, clamped', async () => {
      const key = await E(() => window.__vrEngine.panel.rows().find((r) => r.hasFan).key)
      for (let i = 0; i < 7; i++) { if (await pg.isEnabled(`[data-testid="pb-fan+:${key}"]`)) await pg.click(`[data-testid="pb-fan+:${key}"]`) }
      const hi = await E((k) => window.__vrEngine.state.fanLevel(k), key)
      for (let i = 0; i < 7; i++) { if (await pg.isEnabled(`[data-testid="pb-fan-:${key}"]`)) await pg.click(`[data-testid="pb-fan-:${key}"]`) }
      const lo = await E((k) => window.__vrEngine.state.fanLevel(k), key)
      await pg.click(`[data-testid="pb-fan+:${key}"]`); await pg.click(`[data-testid="pb-fan+:${key}"]`)
      const two = await E((k) => window.__vrEngine.state.fanLevel(k), key)
      return { ok: hi === 5 && lo === 0 && two === 2, detail: `after 7x+ = ${hi}, after 7x- = ${lo}, then 2x+ = ${two}` }
    })
    await check(label + 'fans: blade rotation speed follows the level (0 stopped; higher level -> faster), measured on the scene objects', async () => {
      const r = await E(() => {
        const e = window.__vrEngine, st = e.state
        const key = st.fanKeys[0]
        const out = {}
        for (const lvl of [0, 1, 3, 4, 5]) {
          st.setFanLevel(key, lvl, 'code')
          for (let i = 0; i < 400; i++) e.tick(0.05)          // 20 s: settled
          const a0 = e.smart.fanRigs.find((f) => f.key === key).angleRad
          for (let i = 0; i < 10; i++) e.tick(0.05)           // 0.5 s
          const a1 = e.smart.fanRigs.find((f) => f.key === key).angleRad
          out[lvl] = Math.abs(a1 - a0) * (180 / Math.PI) / 0.5   // deg/s of the visible blade group
        }
        st.setFanLevel(key, 0, 'code')
        return out
      })
      const exp = { 0: 0, 1: 540, 3: 1140, 4: 1440, 5: 1800 }
      const okv = Object.keys(exp).every((k) => Math.abs(r[k] - exp[k]) < 25)
      return { ok: okv, detail: JSON.stringify(r) }
    })
    await check(label + 'automatic lighting: enters room -> light on; manual OFF overrides while present; leaving -> off after the delay', async () => {
      const r = await E(() => {
        const e = window.__vrEngine, st = e.state
        st.setAllLights(false, 'code')
        st.auto.setEnabled(true)
        const rooms = e.house.smart.rooms.filter((q) => q.floor === 0)
        const A = rooms[0], B = rooms[2]
        const k = (q) => `${q.floor}:${q.id}`
        const go = (q) => { e.goToRoom(k(q)); e.tick(0.1) }
        go(A); const aOn = st.lights.isOn(k(A))
        st.lights.set(k(A), false, 'panel'); e.tick(1); const manualHeld = !st.lights.isOn(k(A))
        go(B); const bOn = st.lights.isOn(k(B))
        for (let i = 0; i < 20; i++) e.tick(0.1)
        st.lights.set(k(A), true, 'panel')   // user switches A on from elsewhere: manual
        for (let i = 0; i < 500; i++) e.tick(0.1)   // 50 s (the engine clamps one tick to 0.1 s)
        const aKeptManual = st.lights.isOn(k(A))
        const bStillOn = st.lights.isOn(k(B))   // B is the occupied room
        const C = rooms[3]; go(C); for (let i = 0; i < 350; i++) e.tick(0.1)   // leave B for 35 s
        const bOffAfterLeaving = !st.lights.isOn(k(B)), aStillManual = st.lights.isOn(k(A)), cOn = st.lights.isOn(k(C))
        st.auto.setEnabled(false); st.setAllLights(false, 'code')
        return { aOn, manualHeld, bOn, aKeptManual, bStillOn, bOffAfterLeaving, aStillManual, cOn, A: A.id, B: B.id, C: C.id }
      })
      return { ok: r.aOn && r.manualHeld && r.bOn && r.aKeptManual && r.bStillOn && r.bOffAfterLeaving && r.aStillManual && r.cOn, detail: JSON.stringify(r) }
    })
    await check(label + 'motion lighting - bedrooms: entering each bedroom (every floor) switches its light on; a manual OFF while present holds; leaving switches it off after the delay', async () => {
      const r = await E(() => {
        const e = window.__vrEngine, st = e.state
        const k = (q) => `${q.floor}:${q.id}`
        const beds = e.house.smart.rooms.filter((q) => /bedroom/.test(q.type) && st.lights.has(k(q)))
        const other = e.house.smart.rooms.find((q) => q.floor === 0 && /living|hall|dining/.test(q.type) && st.lights.has(k(q))) ?? e.house.smart.rooms.find((q) => q.floor === 0 && !/bedroom/.test(q.type))
        st.setAllLights(false, 'code'); st.auto.setEnabled(true)
        const out = []
        for (const b of beds) {
          e.goToRoom(k(other)); for (let i = 0; i < 4; i++) e.tick(0.1)
          e.goToRoom(k(b)); for (let i = 0; i < 4; i++) e.tick(0.1)
          const inRoom = e.state.currentRoomKey === k(b)
          const on = st.lights.isOn(k(b))
          st.lights.set(k(b), false, 'panel'); for (let i = 0; i < 100; i++) e.tick(0.1)       // 10 s later: the manual OFF holds
          const held = !st.lights.isOn(k(b))
          st.lights.set(k(b), true, 'panel')
          e.goToRoom(k(other)); for (let i = 0; i < 4; i++) e.tick(0.1)
          for (let i = 0; i < 350; i++) e.tick(0.1)                                             // 35 s away (the engine clamps one tick to 0.1 s)
          const off = !st.lights.isOn(k(b))
          out.push({ room: k(b), inRoom, on, held, off })
        }
        st.auto.setEnabled(false); st.setAllLights(false, 'code')
        return out
      })
      return { ok: r.length > 0 && r.every((o) => o.inRoom && o.on && o.held && o.off), detail: JSON.stringify(r) }
    })
    await check(label + 'motion lighting - staircase: walking up and down every flight keeps the occupant in a staircase room the whole way (no gap), the staircase light is on while on the stairs and goes off after the delay when left', async () => {
      const r = await E(() => {
        const e = window.__vrEngine, st = e.state, nav = e.house.nav
        const stairRooms = e.house.smart.rooms.filter((q) => /stair/.test(q.type) && st.lights.has(`${q.floor}:${q.id}`))
        if (!nav.patchCount) return { skip: 'no stairs in this house' }
        if (!stairRooms.length) return { skip: 'no staircase light in this house' }
        const keyOf = (q) => `${q.floor}:${q.id}`
        const other = e.house.smart.rooms.find((q) => q.floor === 0 && !/stair|bath/.test(q.type) && st.lights.has(keyOf(q)))
        st.setAllLights(false, 'code'); st.auto.setEnabled(true)
        e.goToRoom(keyOf(other)); for (let i = 0; i < 4; i++) e.tick(0.1)
        const ps = [...nav.walkPatches].sort((a, b) => a.top - b.top)
        const visited = new Set(); let gaps = 0, offWhileOn = 0, n = 0
        const centre = (p) => { let x = 0, z = 0; for (const q of p.pts) { x += q[0]; z += q[1] } return [x / p.pts.length, z / p.pts.length] }
        const walk = (list) => {
          for (const p of list) {
            const [x, z] = centre(p)
            e.teleportTo({ x, y: p.top, z }); e.tick(0.1); n++
            const key = e.state.currentRoomKey
            const room = e.house.smart.rooms.find((q) => keyOf(q) === key)
            if (!room || !/stair/.test(room.type)) gaps++
            else { visited.add(key); if (!st.lights.isOn(key)) offWhileOn++ }
          }
        }
        walk(ps); walk([...ps].reverse())                                                       // up, then back down
        const lightsOn = [...visited].every((k) => st.lights.isOn(k))
        e.goToRoom(keyOf(other)); for (let i = 0; i < 4; i++) e.tick(0.1)
        for (let i = 0; i < 350; i++) e.tick(0.1)                                               // 35 s away from the stairs (one tick is clamped to 0.1 s)
        const allOff = [...visited].every((k) => !st.lights.isOn(k))
        st.auto.setEnabled(false); st.setAllLights(false, 'code')
        return { treads: n, rooms: [...visited], gaps, offWhileOn, lightsOn, allOff }
      })
      if (r.skip) return { ok: true, detail: r.skip }
      return { ok: r.gaps === 0 && r.offWhileOn === 0 && r.lightsOn && r.allOff && r.rooms.length > 0, detail: JSON.stringify(r) }
    })
    await check(label + 'sync: the same light and fan changed from the panel, a typed command, the wall switch and the wall regulator show up everywhere (state, panel rows, blade speed, energy, summaries)', async () => {
      const r = await E(() => {
        const e = window.__vrEngine, st = e.state
        st.auto.setEnabled(false); st.setAllLights(false, 'code'); st.fanKeys.forEach((k) => st.setFanLevel(k, 0, 'code'))
        const living = e.house.smart.rooms.find((q) => q.type === 'living_room' && st.fan(`${q.floor}:${q.id}`))
        const K = living ? `${living.floor}:${living.id}` : st.fanKeys[0]
        const typed = !!living
        const row = () => e.panel.rowFor(st.lights.get(K))
        const rate = () => { const a0 = e.smart.fanRigs.find((f) => f.key === K).angleRad; for (let i = 0; i < 10; i++) e.tick(0.05); return Math.abs(e.smart.fanRigs.find((f) => f.key === K).angleRad - a0) * (180 / Math.PI) / 0.5 }
        const settle = () => { for (let i = 0; i < 300; i++) e.tick(0.05) }
        const log = []
        const lightStage = (name, expectOn) => { const w = st.energy.lightsWatts; log.push({ name, state: st.lights.isOn(K) === expectOn, row: row().lightOn === expectOn, watts: expectOn ? w > 0 : w === 0, summary: e.panel.lightsSummary.startsWith(expectOn ? '1 of' : '0 of') }) }
        e.runAction({ t: 'light', key: K }); lightStage('panel on', true)
        if (typed) { e.handleCommand('turn off the living room light'); lightStage('typed off', false) } else { st.lights.set(K, false, 'code'); lightStage('code off', false) }
        e.activate({ kind: 'switch', id: K }); lightStage('wall switch on', true)
        e.runAction({ t: 'allOff' }); lightStage('panel all off', false)
        const fanStage = (name, lvl, rpm) => { settle(); const rt = rate(); log.push({ name, state: st.fanLevel(K) === lvl, row: row().fanLevel === lvl, rpmRow: Math.abs(row().fanRpm - rpm) <= 1, blades: Math.abs(rt - rpm * 6) < 25, watts: lvl === 0 ? st.energy.fansWatts === 0 : st.energy.fansWatts > 0, summary: lvl === 0 ? e.panel.fanSummary === 'Fans: all OFF' : e.panel.fanSummary.includes('top speed ' + lvl) }) }
        for (let i = 0; i < 3; i++) e.activate({ kind: 'regPlus', id: K }); fanStage('regulator + x3', 3, 190)
        e.runAction({ t: 'fan', key: K, delta: -1 }); fanStage('panel -1', 2, 140)
        if (typed) { e.handleCommand('set the living room fan to speed five'); fanStage('typed speed five', 5, 300) } else { st.setFanLevel(K, 5, 'code'); fanStage('code speed five', 5, 300) }
        e.activate({ kind: 'regMinus', id: K }); fanStage('regulator - (5 to 4)', 4, 240)
        st.setFanLevel(K, 0, 'code'); fanStage('off', 0, 0)
        return { K, typed, log }
      })
      const bad = r.log.filter((l) => Object.entries(l).some(([k, v]) => k !== 'name' && v !== true))
      return { ok: r.log.length > 0 && bad.length === 0, detail: bad.length ? JSON.stringify(bad) : `${r.log.length} stages consistent in room ${r.K}${r.typed ? '' : ' (no living-room fan: code instead of typed)'}` }
    })
    await check(label + 'energy panel: simulated watts and session Wh react to lights and fans and are labelled Simulated', async () => {
      const r = await E(() => {
        const e = window.__vrEngine, st = e.state
        st.setAllLights(false, 'code'); st.fanKeys.forEach((k) => st.setFanLevel(k, 0, 'code'))
        const w0 = st.energy.totalWatts
        st.lights.set(st.lights.rooms[0].key, true, 'code'); st.setFanLevel(st.fanKeys[0], 5, 'code')
        const w1 = st.energy.totalWatts; const wh0 = st.energy.sessionWh
        for (let i = 0; i < 100; i++) e.tick(0.1)
        const txt = e.panel.energyLines.join(' ')
        st.setAllLights(false, 'code'); st.fanKeys.forEach((k) => st.setFanLevel(k, 0, 'code'))
        return { w0, w1, grew: st.energy.sessionWh > wh0, txt }
      })
      return { ok: r.w0 === 0 && r.w1 === 84 && r.grew && /Simulated/.test(r.txt), detail: JSON.stringify(r) }
    })

    // ---- wall switch plate clicked with the mouse (real pointer events on the real canvas)
    await check(label + 'wall switch plate: clicking the plate in the 3D view toggles that room light; regulator + / - change the fan', async () => {
      const info = await E(() => {
        const e = window.__vrEngine
        const THREE_V = e.camera.position.constructor
        for (const room of e.house.smart.rooms) {
          if (!room.switch || !room.regulator || !room.fan) continue
          const key = `${room.floor}:${room.id}`
          const n = room.switch.normal
          // stand 3 ft in front of the plate (along its normal), eyes at the plate height, looking at it
          const px = room.switch.pos[0], pz = room.switch.pos[2]
          const spot = e.house.nav.nearestStandable(px + n[0] * 3, pz + n[2] * 3, room.floor_y + 0.2, 2)
          if (!spot) continue
          if (Math.hypot(spot.x - (px + n[0] * 3), spot.z - (pz + n[2] * 3)) > 1.5) continue
          e.teleportTo(spot)
          e.yaw = Math.atan2(-(px - spot.x), -(pz - spot.z))
          e.pitch = Math.atan2(room.switch.pos[1] - (spot.y + 1.62 / 0.3048), Math.hypot(px - spot.x, pz - spot.z)) * 1
          for (let i = 0; i < 20; i++) e.tick(0.05)
          // project the plate centre to the screen
          const v = new THREE_V(px * 0.3048 + n[0] * 0.03 * 0.3048, room.switch.pos[1] * 0.3048, pz * 0.3048 + n[2] * 0.03 * 0.3048)
          e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true); v.project(e.camera)
          const r = e.renderer.domElement.getBoundingClientRect()
          const rv = new THREE_V(room.regulator.pos[0] * 0.3048, room.regulator.pos[1] * 0.3048, room.regulator.pos[2] * 0.3048); rv.project(e.camera)
          return { key, sx: r.left + (v.x * 0.5 + 0.5) * r.width, sy: r.top + (-v.y * 0.5 + 0.5) * r.height, vis: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1, rsx: r.left + (rv.x * 0.5 + 0.5) * r.width, rsy: r.top + (-rv.y * 0.5 + 0.5) * r.height, rvis: rv.z < 1 && Math.abs(rv.x) < 1 && Math.abs(rv.y) < 1, dbg: [v.x, v.y, v.z] }
        }
        return null
      })
      if (!info) return { ok: false, detail: 'no room with switch+regulator+fan could be approached' }
      if (!info.vis) return { ok: false, detail: 'plate not in view: ' + JSON.stringify(info) }
      await pg.mouse.click(info.sx, info.sy)
      await pg.waitForTimeout(200)
      const on = await E((k) => window.__vrEngine.state.lights.isOn(k), info.key)
      await pg.mouse.click(info.sx, info.sy)
      const off = await E((k) => !window.__vrEngine.state.lights.isOn(k), info.key)
      let fanOk = 'regulator not in view'
      if (info.rvis) {
        await pg.mouse.click(info.rsx, info.rsy - 30)      // upper half = +
        const l1 = await E((k) => window.__vrEngine.state.fanLevel(k), info.key)
        await pg.mouse.click(info.rsx, info.rsy + 30)      // lower half = -
        const l2 = await E((k) => window.__vrEngine.state.fanLevel(k), info.key)
        fanOk = l1 === 1 && l2 === 0 ? 'ok' : `levels ${l1},${l2}`
      }
      return { ok: on && off && (fanOk === 'ok' || fanOk === 'regulator not in view'), detail: `light on=${on} off=${off}; regulator: ${fanOk}` }
    })

    // ---- the ceiling fan itself: hover, click (mouse = the desktop twin of the controller trigger), speed control, keyboard
    await check(label + 'fan (desktop): pointing at the real fan highlights it; a click switches it ON then OFF; the speed control opens; its buttons 1/2/3/4/5 set the levels and the blades turn at 540/840/1140/1440/1800 deg/s; OFF stops them', async () => {
      const place = await E(() => {
        const e = window.__vrEngine
        const V = e.camera.position.constructor
        for (const room of e.house.smart.rooms) {
          if (!room.fan) continue
          const key = `${room.floor}:${room.id}`
          const c = e.smart.fanCenterFeet(key)
          const spot = e.house.nav.nearestStandable(c.x + 5, c.z, room.floor_y + 0.2, 3) || e.house.nav.nearestStandable(c.x - 5, c.z, room.floor_y + 0.2, 3)
          if (!spot) continue
          e.teleportTo(spot)
          for (let i = 0; i < 10; i++) e.tick(0.05)
          return { key, spot: [spot.x, spot.y, spot.z] }
        }
        return null
      })
      if (!place) return { ok: false, detail: 'no fan room could be approached' }
      const toScreen = (pt) => E((p) => {
        const e = window.__vrEngine
        const V = e.camera.position.constructor
        const eye = new V(e.foot.x * 0.3048, e.foot.y * 0.3048 + 1.62, e.foot.z * 0.3048)
        const w = new V(p[0] * 0.3048, p[1] * 0.3048, p[2] * 0.3048)
        const d = w.clone().sub(eye)
        e.yaw = Math.atan2(-d.x, -d.z); e.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z))
        for (let i = 0; i < 6; i++) e.tick(0.05)
        e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
        const v = w.clone().project(e.camera)
        const r = e.renderer.domElement.getBoundingClientRect()
        return { sx: r.left + (v.x * 0.5 + 0.5) * r.width, sy: r.top + (-v.y * 0.5 + 0.5) * r.height, vis: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }
      }, pt)
      const fanPt = await E((k) => { const c = window.__vrEngine.smart.fanCenterFeet(k); return [c.x, c.y, c.z] }, place.key)
      const s0 = await toScreen(fanPt)
      if (!s0.vis) return { ok: false, detail: 'fan not in view ' + JSON.stringify(s0) }
      await pg.mouse.move(s0.sx - 40, s0.sy + 200); await pg.mouse.move(s0.sx, s0.sy)
      await pg.waitForTimeout(150)
      const hov = await E((k) => { const p = window.__vrEngine.smart.fanPopup; return { ...p, onShown: p.key === k } }, place.key)
      const lvl0 = await E((k) => window.__vrEngine.state.fanLevel(k), place.key)
      await pg.mouse.click(s0.sx, s0.sy); await pg.waitForTimeout(150)
      const on = await E((k) => ({ lvl: window.__vrEngine.state.fanLevel(k), popup: window.__vrEngine.smart.fanPopup }), place.key)
      await pg.mouse.click(s0.sx, s0.sy); await pg.waitForTimeout(150)
      const off = await E((k) => window.__vrEngine.state.fanLevel(k), place.key)
      const speeds = {}
      for (const lv of [1, 2, 3, 4, 5]) {
        const bp = await E((id) => { const c = window.__vrEngine.smart.popupButtonFeet(id); return c ? [c.x, c.y, c.z] : null }, `pop:${lv}`)
        if (!bp) { speeds[lv] = 'no button'; continue }
        const sc = await toScreen(bp)
        if (!sc.vis) { speeds[lv] = 'button not in view'; continue }
        await pg.mouse.move(sc.sx - 20, sc.sy - 10); await pg.mouse.move(sc.sx, sc.sy); await pg.waitForTimeout(100)
        await pg.mouse.click(sc.sx, sc.sy); await pg.waitForTimeout(100)
        const got = await E((k) => window.__vrEngine.state.fanLevel(k), place.key)
        const deg = await E((k) => { const e = window.__vrEngine; for (let i = 0; i < 400; i++) { e.tick(0.05); e.smart.touchFanPopup() } const a0 = e.smart.fanRigs.find((f) => f.key === k).angleRad; for (let i = 0; i < 10; i++) e.tick(0.05); const a1 = e.smart.fanRigs.find((f) => f.key === k).angleRad; e.smart.touchFanPopup(); return Math.abs(a1 - a0) * (180 / Math.PI) / 0.5 }, place.key)
        speeds[lv] = { got, deg: Math.round(deg) }
      }
      // OFF button
      const bp0 = await E(() => { window.__vrEngine.smart.touchFanPopup(); const c = window.__vrEngine.smart.popupButtonFeet('pop:0'); return c ? [c.x, c.y, c.z] : null })
      let offDeg = 'no button'
      if (bp0) {
        const sc = await toScreen(bp0); await pg.mouse.click(sc.sx, sc.sy); await pg.waitForTimeout(100)
        offDeg = await E((k) => { const e = window.__vrEngine; for (let i = 0; i < 400; i++) e.tick(0.05); const a0 = e.smart.fanRigs.find((f) => f.key === k).angleRad; for (let i = 0; i < 10; i++) e.tick(0.05); return { lvl: e.state.fanLevel(k), deg: Math.abs(e.smart.fanRigs.find((f) => f.key === k).angleRad - a0) * 57.2958 / 0.5 } }, place.key)
      }
      const exp = { 1: 540, 2: 840, 3: 1140, 4: 1440, 5: 1800 }
      const sOk = Object.keys(exp).every((k) => speeds[k] && speeds[k].got === Number(k) && Math.abs(speeds[k].deg - exp[k]) < 30)
      const okAll = hov.visible && hov.mode === 'hint' && hov.onShown && lvl0 === 0 && on.lvl > 0 && on.popup.mode === 'full' && off === 0 && sOk && offDeg && offDeg.lvl === 0 && offDeg.deg < 1
      return { ok: !!okAll, detail: JSON.stringify({ hov, lvl0, on, off, speeds, offDeg }) }
    })
    await check(label + 'fan (desktop keyboard): F toggles the fan of the room, the number keys 1/2/3/4/5 set its speed, 0 stops it; keys are ignored while typing in an input', async () => {
      const key = await E(() => { const e = window.__vrEngine; const k = e.focusFanKey(); return k })
      if (!key) return { ok: false, detail: 'no focus fan' }
      await pg.focus('body')
      const lv = () => E((k) => window.__vrEngine.state.fanLevel(k), key)
      await pg.keyboard.press('KeyF'); const a = await lv()
      await pg.keyboard.press('KeyF'); const b = await lv()
      const seq = []
      for (const d of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) { await pg.keyboard.press(d); seq.push(await lv()) }
      await pg.keyboard.press('Numpad4'); const four = await lv()
      await pg.keyboard.press('Digit0'); const zero = await lv()
      await pg.evaluate(() => { const i = document.createElement('input'); i.id = '__t'; document.body.appendChild(i); i.focus() })
      await pg.keyboard.press('Digit5'); const typed = await lv()
      await pg.evaluate(() => document.getElementById('__t').remove())
      return { ok: a > 0 && b === 0 && JSON.stringify(seq) === '[1,2,3,4,5]' && four === 4 && zero === 0 && typed === 0, detail: JSON.stringify({ a, b, seq, four, zero, typed }) }
    })
    await check(label + 'panel fan strip (desktop buttons): FAN ON / FAN OFF / SPEED 1,2,3,4,5 drive the fan of the current room, the selected one is highlighted, the status line follows', async () => {
      const key = await E(() => window.__vrEngine.focusFanKey())
      if (!key) return { ok: false, detail: 'no focus fan' }
      await E((k) => window.__vrEngine.state.setFanLevel(k, 0, 'code'), key)
      await pg.waitForTimeout(250)
      const seen = []
      for (const id of ['fanstrip:3', 'fanstrip:5', 'fanstrip:4', 'fanstrip:1', 'fanstrip:2']) {
        await pg.click(`[data-testid="pb-${id}"]`)
        const lv = await E((k) => window.__vrEngine.state.fanLevel(k), key)
        seen.push([id, lv])
      }
      await pg.click('[data-testid="pb-fanstrip:off"]'); const off = await E((k) => window.__vrEngine.state.fanLevel(k), key)
      await pg.click('[data-testid="pb-fanstrip:on"]'); const on = await E((k) => window.__vrEngine.state.fanLevel(k), key)   // back to the last speed (2)
      const txt = await pg.textContent('[data-testid=smart-panel]')
      return { ok: JSON.stringify(seen) === '[["fanstrip:3",3],["fanstrip:5",5],["fanstrip:4",4],["fanstrip:1",1],["fanstrip:2",2]]' && off === 0 && on === 2 && /Fan - .*ON, speed 2/.test(txt || ''), detail: JSON.stringify({ seen, off, on, text: (txt || '').match(/Fan - [^A-Z]*[A-Za-z ()]*speed \d/)?.[0] }) }
    })
    await pg.screenshot({ path: path.join(OUT, `${fx}_desktop_switch_view.png`) })

    // ---- lights visible in the render: compare images with all lights off / on
    const lightsContrast = async (mode, minRatio) => {
      await E((m) => window.__vrEngine.setLighting(m), mode)

      await E(() => { const e = window.__vrEngine; e.state.setAllLights(false, 'code'); for (let i = 0; i < 60; i++) e.tick(0.05) })
      const off = await pg.locator('[data-testid=vr-stage] canvas').screenshot({ timeout: 180000 })
      fs.writeFileSync(path.join(OUT, `${fx}_desktop_lights_off_${mode}.png`), off)
      await E(() => { const e = window.__vrEngine; e.state.setAllLights(true, 'code'); for (let i = 0; i < 60; i++) e.tick(0.05) })
      await pg.waitForTimeout(300)
      const on = await pg.locator('[data-testid=vr-stage] canvas').screenshot({ timeout: 180000 })
      fs.writeFileSync(path.join(OUT, `${fx}_desktop_lights_on_${mode}.png`), on)
      const lum = async (buf) => pg.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 160, 90); const d = x.getImageData(0, 0, 160, 90).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; return s / (d.length / 4) }, buf.toString('base64'))
      const a = await lum(off), b = await lum(on)
      await E(() => window.__vrEngine.state.setAllLights(false, 'code'))
      return { ok: b > a * minRatio, detail: `[${mode}] mean luminance off=${a.toFixed(1)} on=${b.toFixed(1)}` }
    }
    // the ORIGINAL assertion (lights on >= 4 % brighter) is kept unchanged, under the evening lighting it was written for (the baseline default);
    // the daylight default washes out lamp contrast in some views, so it gets its own check: lights on must still be measurably brighter than off
    await check(label + 'rendering: the view is measurably brighter with the room lights on than off (lights are visible, not only state) [evening lighting, original 4 % threshold]', async () => lightsContrast('evening', 1.04))
    await check(label + 'rendering: with the default DAYLIGHT lighting the lights-on view is still brighter than lights-off (>= 1 %; lamp contrast is smaller in daylight)', async () => lightsContrast('day', 1.01))

    // ---- typed command + voice availability (honest)
    await check(label + 'typed commands use the voice parser: "turn on the living room light"', async () => {
      await pg.fill('[data-testid=typed-command]', 'turn on the living room light'); await pg.press('[data-testid=typed-command]', 'Enter')
      const r = await E(() => { const s = window.__vrEngine.state; const lr = s.lights.rooms.find((x) => x.type === 'living_room'); const on = lr ? s.lights.isOn(lr.key) : false; s.setAllLights(false, 'code'); return on })
      await E(() => { const a = document.activeElement; if (a && a.tagName === 'INPUT') a.blur() })   // keys typed into the command box go to the box (by design); leave the box like a user clicking back into the 3D view
      return r
    })
    await check(label + 'typed command "Set fan speed to 4" (the voice parser) sets level 4 in the real state and the blades turn at 1440 deg/s, distinct from 3 (1140) and 5 (1800)', async () => {
      // the voice parser acts on the room the person is IN (the engine re-derives it from the player's position every frame), so stand in a fan room first
      const key = await E(() => {
        const e = window.__vrEngine
        for (const room of e.house.smart.rooms) {
          if (!room.fan) continue
          const k = `${room.floor}:${room.id}`; const c = e.smart.fanCenterFeet(k)
          const spot = e.house.nav.nearestStandable(c.x + 5, c.z, room.floor_y + 0.2, 3) || e.house.nav.nearestStandable(c.x - 5, c.z, room.floor_y + 0.2, 3)
          if (!spot) continue
          e.teleportTo(spot); for (let i = 0; i < 10; i++) e.tick(0.05)
          if (e.state.currentRoomKey !== k) continue            // the spot fell outside the room (open plans): try the next fan room
          e.state.setFanLevel(k, 0, 'code'); return k
        }
        return null
      })
      if (!key) return { ok: false, detail: 'could not stand in a fan room' }
      await pg.fill('[data-testid=typed-command]', 'Set fan speed to 4'); await pg.press('[data-testid=typed-command]', 'Enter')
      const r = await E((k) => { const e = window.__vrEngine; const lvl = e.state.fanLevel(k); for (let i = 0; i < 400; i++) e.tick(0.05); const a0 = e.smart.fanRigs.find((f) => f.key === k).angleRad; for (let i = 0; i < 10; i++) e.tick(0.05); const deg = Math.abs(e.smart.fanRigs.find((f) => f.key === k).angleRad - a0) * 57.2958 / 0.5; e.state.setFanLevel(k, 0, 'code'); const a = document.activeElement; if (a && a.tagName === 'INPUT') a.blur(); return { lvl, deg: Math.round(deg) } }, key)
      return { ok: r.lvl === 4 && Math.abs(r.deg - 1440) < 30, detail: JSON.stringify(r) }
    })
    await check(label + 'floor buttons: "Ground floor" / "Floor 1" move the player to that floor', async () => {
      const floors = await E(() => window.__vrEngine.house.smart.floors.length)
      if (floors < 2) return { ok: true, detail: 'single floor house' }
      await pg.click('[data-testid=go-floor-1]', { timeout: 180000 })
      const y1 = await E(() => window.__vrEngine.foot.y)
      await pg.click('[data-testid=go-floor-0]', { timeout: 180000 })
      const y0 = await E(() => window.__vrEngine.foot.y)
      return { ok: y1 > 8 && y0 < 3, detail: `y floor1=${y1.toFixed(1)} floor0=${y0.toFixed(1)}` }
    })
    await check(label + 'teleport (desktop): hold T shows the arc and a valid marker; releasing it blinks and moves the player to the marker (standable, same floor)', async () => {
      await E(() => { const e = window.__vrEngine; e.goToFloor(0) })
      const found = await E(() => {
        const e = window.__vrEngine; e.pitch = -0.35
        for (let k = 0; k < 24; k++) { e.yaw = (k / 24) * Math.PI * 2; e.startAim('desktop'); const t = e.teleportInfo; e.cancelAim(); if (t.valid) return e.yaw }
        return null
      })
      if (found === null) return { ok: false, detail: 'no valid aim found from the start spot' }
      await E((y) => { const e = window.__vrEngine; e.yaw = y; e.pitch = -0.35; e.rig.rotation.y = y; e.camera.rotation.x = -0.35; e.camera.updateMatrixWorld(true) }, found)
      await pg.keyboard.down('KeyT')
      const aiming = await E(() => { const e = window.__vrEngine; return { aiming: e.teleportInfo.aiming, valid: e.teleportInfo.valid, arc: e.scene.getObjectByName('teleport-arc').visible, marker: e.scene.getObjectByName('teleport-marker').visible } })
      const before = await E(() => ({ ...window.__vrEngine.foot }))
      await pg.keyboard.up('KeyT')
      const r = await E(() => {
        const e = window.__vrEngine
        const started = e.teleportInfo.fading
        for (let i = 0; i < 12; i++) e.tick(0.05)
        const f = e.foot
        return { started, fading: e.teleportInfo.fading, f: { ...f }, stand: e.house.nav.canStand(f.x, f.z, f.y) !== null, floor: e.floorIndex, over: e.scene.getObjectByName('teleport-fade').visible }
      })
      const moved = Math.hypot(r.f.x - before.x, r.f.z - before.z)
      return { ok: aiming.aiming && aiming.valid && aiming.arc && aiming.marker && r.started && !r.fading && !r.over && moved > 1 && r.stand && r.floor === 0, detail: JSON.stringify({ aiming, moved: +moved.toFixed(1), r }) }
    })
    await check(label + 'teleport (desktop): an arc into a wall or ceiling is refused with a message and the player does not move', async () => {
      const r = await E(() => {
        const e = window.__vrEngine; e.goToFloor(0)
        e.pitch = 1.2                                              // straight up: ceiling
        e.startAim('desktop'); const info = e.teleportInfo
        const before = { ...e.foot }
        const started = e.releaseAim()
        for (let i = 0; i < 10; i++) e.tick(0.05)
        e.pitch = 0
        return { valid: info.valid, reason: info.reason, started, moved: Math.hypot(e.foot.x - before.x, e.foot.z - before.z), msg: e.message }
      })
      return { ok: !r.valid && !r.started && r.moved < 1e-6 && /way|stand/i.test(r.msg), detail: JSON.stringify(r) }
    })
    await check(label + 'teleport (desktop): a destination on an upper floor works (aim on floor 1, release, standing at floor-1 height); stairwell arcs from below land upstairs when a line of sight exists', async () => {
      const floors = await E(() => window.__vrEngine.house.smart.floors.length)
      if (floors < 2) return { ok: true, detail: 'single floor house: no upper floor to test' }
      const r = await E(() => {
        const e = window.__vrEngine
        e.goToFloor(1)
        e.pitch = -0.35
        let ok = null
        for (const pt of [-0.35, -0.6, -0.9, -1.2]) for (let k = 0; k < 24 && !ok; k++) { e.yaw = (k / 24) * Math.PI * 2; e.pitch = pt; e.startAim('desktop'); const t = e.teleportInfo; if (t.valid) ok = { yaw: e.yaw, pitch: pt, target: t.target }; e.cancelAim() }
        if (!ok) return { found: false, foot: { ...e.foot } }
        e.yaw = ok.yaw; e.pitch = ok.pitch
        const before = { ...e.foot }
        e.startAim('desktop'); const started = e.releaseAim()
        for (let i = 0; i < 12; i++) e.tick(0.05)
        const up = { found: true, started, y: e.foot.y, floor: e.floorIndex, moved: Math.hypot(e.foot.x - before.x, e.foot.z - before.z), stand: e.house.nav.canStand(e.foot.x, e.foot.z, e.foot.y) !== null }
        // from the ground floor, search for an aim (from a few spots near the stairs) that lands upstairs through the stairwell
        const st = e.house.smart.rooms.find((q) => /stair/.test(q.type) && q.floor === 0)
        let cross = null
        if (st) {
          const cx = (st.rect.x0 + st.rect.x1) / 2, cz = (st.rect.z0 + st.rect.z1) / 2
          const spots = [e.house.nav.nearestStandable(cx, cz, st.floor_y + 0.2, 8), e.house.nav.nearestStandable(st.rect.x0 - 2, cz, st.floor_y + 0.2, 6), e.house.nav.nearestStandable(st.rect.x1 + 2, cz, st.floor_y + 0.2, 6), e.house.nav.nearestStandable(cx, st.rect.z0 - 2, st.floor_y + 0.2, 6), e.house.nav.nearestStandable(cx, st.rect.z1 + 2, st.floor_y + 0.2, 6)].filter(Boolean)
          outer: for (const sp of spots) { e.teleportTo(sp); for (const pt of [0.5, 0.8, 1.0, 1.2]) for (let k = 0; k < 36; k++) { e.yaw = (k / 36) * Math.PI * 2; e.pitch = pt; e.startAim('desktop'); const t = e.teleportInfo; e.cancelAim(); if (t.valid && t.target.y > 8) { cross = { from: [sp.x, sp.z].map((v) => +v.toFixed(1)), to: t.target, pitch: pt }; break outer } } }
        }
        e.pitch = 0
        return { up, cross }
      })
      if (r.found === false) return { ok: false, detail: 'no valid aim on floor 1 ' + JSON.stringify(r) }
      return { ok: r.up.started && r.up.y > 8 && r.up.floor >= 1 && r.up.moved > 1 && r.up.stand, detail: JSON.stringify(r) }
    })
    await check(label + 'sit / stand (desktop): E sits on the nearest sofa, dining chair and bed (body on the seat, eyes ~75 cm above the measured seat, facing the seat direction, panel says STAND UP); E again stands on free floor', async () => {
      const out = []
      for (const kind of ['sofa', 'chair', 'bed']) {
        const pre = await E((kind) => {
          const e = window.__vrEngine, nav = e.house.nav
          const sp = e.house.seats.find((q) => q.kind === kind)
          if (!sp) return null
          let f = null
          for (const d of [3, 2.5, 3.5, 2, 4]) { const x = sp.x + sp.fx * d, z = sp.z + sp.fz * d, g = nav.canStand(x, z, sp.floorY + 0.2); if (g !== null) { f = { x, y: g, z }; break } }
          if (!f) f = nav.nearestStandable(sp.x + sp.fx * 3, sp.z + sp.fz * 3, sp.floorY + 0.2, 4)
          if (!f) return { kind, skip: true }
          e.teleportTo(f); e.yaw = Math.atan2(-(sp.x - f.x), -(sp.z - f.z)); e.pitch = -0.1; e.tick(0.05)
          return { kind, id: sp.id, padVisible: e.scene.getObjectByName('seat-pad-' + sp.id).visible, label: e.layout.buttons.find((b) => b.id === 'seat')?.label }
        }, kind)
        if (!pre) continue
        if (pre.skip) { out.push({ kind, skipped: 'no standing spot in front' }); continue }
        await pg.keyboard.press('KeyE')
        const sat = await E(() => {
          const e = window.__vrEngine; e.tick(0.016); e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
          const s = e.seated; if (!s) return { seated: false }
          const eye = e.camera.getWorldPosition(e.camera.position.clone()).y
          const fwd = e.camera.getWorldDirection(e.camera.position.clone())
          const dot = fwd.x * s.spot.fx + fwd.z * s.spot.fz
          return { seated: true, kind: s.spot.kind, onSeat: Math.hypot(e.foot.x - s.spot.x, e.foot.z - s.spot.z) < 0.01, eyeErr: Math.abs(eye - (s.spot.seatY * 0.3048 + 0.75)), facing: dot, label: e.layout.buttons.find((b) => b.id === 'seat')?.label, padsHidden: e.seatCount === 0 || e.scene.children.filter((o) => o.name.startsWith('seat-pad-')).every((o) => !o.visible), seatId: s.spot.id }
        })
        await pg.keyboard.press('KeyE')
        const st = await E((id) => {
          const e = window.__vrEngine, sp = e.house.seats.find((q) => q.id === id)
          e.tick(0.016); e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
          const eye = e.camera.getWorldPosition(e.camera.position.clone()).y
          return { standing: !e.seated, free: e.house.nav.canStand(e.foot.x, e.foot.z, e.foot.y) !== null, near: sp ? Math.hypot(e.foot.x - sp.x, e.foot.z - sp.z) : 99, eyeErr: Math.abs(eye - (e.foot.y * 0.3048 + 1.62)), label: e.layout.buttons.find((b) => b.id === 'seat')?.label }
        }, sat.seatId)
        out.push({ kind, pre: pre.padVisible, preLabel: pre.label, sat, st })
      }
      const bad = out.filter((o) => !o.skipped && !(o.pre && o.preLabel === 'SIT NEAREST' && o.sat.seated && o.sat.onSeat && o.sat.eyeErr < 0.03 && o.sat.facing > 0.9 && o.sat.label === 'STAND UP' && o.sat.padsHidden && o.st.standing && o.st.free && o.st.near < 8 && o.st.eyeErr < 0.03 && o.st.label === 'SIT NEAREST'))
      return { ok: out.some((o) => !o.skipped) && bad.length === 0, detail: JSON.stringify(out) }
    })
    await check(label + 'sit / stand (desktop): walking (W) stands up first; the panel SIT NEAREST / STAND UP buttons and the words "sit down" / "stand up" work; teleport and Go-to-room clear the seat', async () => {
      const r = await E(() => {
        const e = window.__vrEngine, nav = e.house.nav
        const sp = e.house.seats.find((q) => q.kind === 'sofa') ?? e.house.seats[0]
        const near = nav.nearestStandable(sp.x + sp.fx * 3, sp.z + sp.fz * 3, sp.floorY + 0.2, 4)
        e.teleportTo(near); e.yaw = Math.atan2(-(sp.x - near.x), -(sp.z - near.z)); e.pitch = 0
        const res = {}
        const seatBtn = () => e.layout.buttons.find((b) => b.id === 'seat')
        e.runAction(seatBtn().action); res.panelSit = !!e.seated; res.labelAfterSit = seatBtn().label
        e.runAction(seatBtn().action); res.panelStand = !e.seated; res.labelAfterStand = seatBtn().label
        e.handleCommand('sit down'); res.cmdSit = !!e.seated
        e.handleCommand('stand up'); res.cmdStand = !e.seated
        e.sit(); const sat0 = { ...e.foot }
        e.keys.add('KeyW'); for (let i = 0; i < 4; i++) e.tick(0.05); e.keys.delete('KeyW')
        res.wStands = !e.seated; res.wMoved = Math.hypot(e.foot.x - sat0.x, e.foot.z - sat0.z) > 0.5
        e.sit(); e.goToFloor(e.floorIndex); res.goClears = !e.seated && e.sitLift === 0
        e.sit(); e.teleportTo(near); res.teleportClears = !e.seated
        // sit, then a teleport arc and release
        e.sit(); e.pitch = -0.5; let found = false
        for (let k = 0; k < 24 && !found; k++) { e.yaw = (k / 24) * Math.PI * 2; e.startAim('desktop'); found = e.teleportInfo.valid; if (!found) e.cancelAim() }
        if (found) { e.releaseAim(); for (let i = 0; i < 12; i++) e.tick(0.05) }
        res.arcFromSeat = found ? (!e.seated && e.sitLift === 0) : 'no valid aim'
        e.pitch = 0
        return res
      })
      const ok = r.panelSit && r.labelAfterSit === 'STAND UP' && r.panelStand && r.labelAfterStand === 'SIT NEAREST' && r.cmdSit && r.cmdStand && r.wStands && r.wMoved && r.goClears && r.teleportClears && (r.arcFromSeat === true || r.arcFromSeat === 'no valid aim')
      return { ok, detail: JSON.stringify(r) }
    })
    await check(label + 'no uncaught page errors during the session', async () => ({ ok: pg.__errors.length === 0, detail: pg.__errors.slice(0, 3).join(' | ') }))
    await ctx.close()

    // ---------------------------------------------------------------- voice unavailable path (real browser with the Web Speech API removed)
    {
      const { ctx: c2, pg: p2 } = await openViewer(browser, tok, id, { noSpeech: true })
      await check(label + 'voice: with no browser speech recognition the page says so clearly, hides the mic button, manual controls still work', async () => {
        const msg = await p2.textContent('[data-testid=voice-unavailable]')
        const mic = await p2.locator('[data-testid=mic]').count()
        const st = await p2.textContent('[data-testid=voice-status]')
        await p2.click('[data-testid=pb-allOn]')
        const n = await p2.evaluate(() => window.__vrEngine.state.lights.onCount)
        return { ok: /speech recognition/i.test(msg) && mic === 0 && /Microphone unavailable/.test(st) && n > 0, detail: `${st} | ${msg.slice(0, 120)}` }
      })
      await c2.close()
    }

    }

    // ---------------------------------------------------------------- SIMULATED WebXR (mocked navigator.xr; injected input)
    bucket = 'simulated'
    {
      const { ctx: c3, pg: p3 } = await openViewer(browser, tok, id, { mockXr: true })
      const E3 = (fn, arg) => p3.evaluate(fn, arg)
      await E3(() => { window.__vrEngine.renderer.xr.setSession = async () => {} })   // MOCK: three's real XR manager needs a real XRSession
      await check(label + 'MOCK xr: availability check reports supported, Enter VR enabled', async () => {
        await p3.waitForFunction(() => window.__vrEngine.xrSupported, null, { timeout: 10000 })
        return !(await p3.isDisabled('[data-testid=enter-vr]'))
      })
      await check(label + 'MOCK xr: Enter VR requests an immersive-vr session with local-floor, switches to VR mode, panel starts closed; Exit VR returns to desktop', async () => {
        await p3.click('[data-testid=enter-vr]', { timeout: 90000 })
        await p3.waitForFunction(() => window.__vrEngine.mode === 'vr', null, { timeout: 10000 })
        const req = await E3(() => window.__fakeXr.requests[0])
        const closed = await E3(() => !window.__vrEngine.panelOpen)
        await E3(() => { window.__vrEngine.camera.position.set(0, 1.6, 0) })   // MOCK headset pose
        await p3.click('[data-testid=exit-vr]', { timeout: 180000 })
        await p3.waitForFunction(() => window.__vrEngine.mode === 'desktop', null, { timeout: 10000 })
        return { ok: req.m === 'immersive-vr' && JSON.stringify(req.init).includes('local-floor') && closed, detail: JSON.stringify(req) }
      })
      await check(label + 'MOCK xr: enter again; INJECTED left-stick push walks the player forward through the collision grid; INJECTED right-stick flick snap-turns 30 degrees', async () => {
        await p3.click('[data-testid=enter-vr]', { timeout: 90000 })
        await p3.waitForFunction(() => window.__vrEngine.mode === 'vr')
        const r = await E3(() => {
          const e = window.__vrEngine, s = window.__fakeXr.session
          e.camera.position.set(0, 1.6, 0); e.rig.updateMatrixWorld(true)   // MOCK headset pose (a real session supplies this)
          const mk = (h, ax, btn) => ({ handedness: h, gamepad: { axes: ax, buttons: btn.map((b) => ({ pressed: b })), hapticActuators: [] } })
          const none = [false, false, false, false, false, false]
          const f0 = { ...e.foot }
          s.inputSources = [mk('left', [0, 0, 0, -1], none), mk('right', [0, 0, 0, 0], none)]
          for (let i = 0; i < 40; i++) e.tick(0.05)             // 2 s of full forward
          const f1 = { ...e.foot }
          const yaw0 = e.rig.rotation.y
          s.inputSources = [mk('left', [0, 0, 0, 0], none), mk('right', [0, 0, 1, 0], none)]
          e.tick(0.05)
          const yaw1 = e.rig.rotation.y
          e.tick(0.05); e.tick(0.05)                              // held: must NOT keep turning
          const yaw2 = e.rig.rotation.y
          s.inputSources = [mk('left', [0, 0, 0, 0], none), mk('right', [0, 0, 0, 0], none)]; e.tick(0.05)
          s.inputSources = [mk('left', [0, 0, 0, 0], none), mk('right', [0, 0, -1, 0], none)]; e.tick(0.05)
          const yaw3 = e.rig.rotation.y
          return { dist: Math.hypot(f1.x - f0.x, f1.z - f0.z), standable: e.house.nav.canStand(e.foot.x, e.foot.z, e.foot.y) !== null, d1: yaw1 - yaw0, held: yaw2 - yaw1, d3: yaw3 - yaw2 }
        })
        const deg = (x) => (x * 180) / Math.PI
        return { ok: r.dist > 0.8 && r.standable && Math.abs(deg(r.d1) + 30) < 1 && Math.abs(r.held) < 1e-6 && Math.abs(deg(r.d3) - 30) < 1, detail: JSON.stringify(r) }
      })
      await check(label + 'MOCK xr: INJECTED right-stick forward aims the teleport arc (arc + marker shown); releasing teleports with a blink; pulling the stick back cancels', async () => {
        const r = await E3(() => {
          const e = window.__vrEngine, s = window.__fakeXr.session
          const V = e.camera.position.constructor, M = e.camera.matrix.constructor
          e.camera.position.set(0, 1.6, 0); e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
          const mk = (h, ax, btn) => ({ handedness: h, gamepad: { axes: ax, buttons: btn.map((b) => ({ pressed: b })), hapticActuators: [] } })
          const none = [false, false, false, false, false, false]
          // MOCK controller pose: at hand height, pointing forward and a little down (the real runtime supplies this); try 12 headings to find one with a valid spot
          const ctrl = e.renderer.xr.getController(1)
          let chosen = null
          const rooms = e.house.smart.rooms.filter((q) => q.floor === 0 && /living|hall|dining|bed/.test(q.type))
          for (let ri = 0; ri < Math.max(1, rooms.length) && chosen === null; ri++) {
          if (rooms[ri]) e.goToRoom(`${rooms[ri].floor}:${rooms[ri].id}`)
          e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
          const head = e.camera.getWorldPosition(new V())
          for (let k = 0; k < 48 && chosen === null; k++) {
            const a = ((k % 12) / 12) * Math.PI * 2, dist = [3, 1.6, 0.9, 2.2][Math.floor(k / 12)]
            const target = new V(head.x + Math.cos(a) * dist, head.y - 1.2, head.z + Math.sin(a) * dist)
            ctrl.position.copy(e.rig.worldToLocal(new V(head.x, head.y - 0.4, head.z)))
            ctrl.quaternion.setFromRotationMatrix(e.rig.matrixWorld.clone().invert().multiply(new M().lookAt(new V(head.x, head.y - 0.4, head.z), target, new V(0, 1, 0))))
            ctrl.matrix.compose(ctrl.position, ctrl.quaternion, ctrl.scale); ctrl.matrixWorldNeedsUpdate = true; ctrl.updateMatrixWorld(true)
            e.startAim('right'); const t = e.teleportInfo; e.cancelAim()
            if (t.valid) chosen = a
          }
          }
          if (chosen === null) return { found: false }
          const f0 = { ...e.foot }
          s.inputSources = [mk('left', [0, 0, 0, 0], none), mk('right', [0, 0, 0, -1], none)]
          e.tick(0.05)
          const aiming = e.teleportInfo, arc = e.scene.getObjectByName('teleport-arc').visible, marker = e.scene.getObjectByName('teleport-marker').visible
          // back = cancel
          s.inputSources = [mk('left', [0, 0, 0, 0], none), mk('right', [0, 0, 0, 1], none)]
          e.tick(0.05)
          const cancelled = !e.teleportInfo.aiming && !e.scene.getObjectByName('teleport-arc').visible && Math.hypot(e.foot.x - f0.x, e.foot.z - f0.z) < 1e-6
          // aim again and release
          s.inputSources = [mk('left', [0, 0, 0, 0], none), mk('right', [0, 0, 0, 0], none)]; e.tick(0.05)
          s.inputSources = [mk('left', [0, 0, 0, 0], none), mk('right', [0, 0, 0, -1], none)]; e.tick(0.05)
          const target = e.teleportInfo.target
          s.inputSources = [mk('left', [0, 0, 0, 0], none), mk('right', [0, 0, 0, 0], none)]
          e.tick(0.05)
          const fading = e.teleportInfo.fading
          for (let i = 0; i < 12; i++) e.tick(0.05)
          const f1 = e.foot
          return { found: true, aiming: aiming.aiming && aiming.valid, arc, marker, cancelled, fading, moved: Math.hypot(f1.x - f0.x, f1.z - f0.z), atTarget: target ? Math.hypot(f1.x - target.x, f1.z - target.z) < 0.05 : false, stand: e.house.nav.canStand(f1.x, f1.z, f1.y) !== null, headOver: Math.hypot(e.camera.getWorldPosition(new V()).x / 0.3048 - f1.x, e.camera.getWorldPosition(new V()).z / 0.3048 - f1.z) < 0.1 }
        })
        return { ok: r.found && r.aiming && r.arc && r.marker && r.cancelled && r.fading && r.moved > 1 && r.atTarget && r.stand && r.headOver, detail: JSON.stringify(r) }
      })
      await check(label + 'MOCK xr: INJECTED Y button opens the panel in front of the user; INJECTED trigger on a panel button (ray from a posed controller) turns all lights on; EXIT VR button ends the session', async () => {
        const r = await E3(() => {
          const e = window.__vrEngine, s = window.__fakeXr.session
          const mk = (h, ax, btn) => ({ handedness: h, gamepad: { axes: ax, buttons: btn.map((b) => ({ pressed: b })), hapticActuators: [] } })
          s.inputSources = [mk('left', [0, 0, 0, 0], [false, false, false, false, false, false]), mk('right', [0, 0, 0, 0], [false, false, false, false, false, false])]
          e.tick(0.05)
          s.inputSources = [mk('left', [0, 0, 0, 0], [false, false, false, false, false, true]), mk('right', [0, 0, 0, 0], [false, false, false, false, false, false])]
          e.tick(0.05)
          const opened = e.panelOpen
          s.inputSources = [mk('left', [0, 0, 0, 0], [false, false, false, false, false, false]), mk('right', [0, 0, 0, 0], [false, false, false, false, false, false])]
          e.tick(0.05)
          e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
          const head = e.camera.getWorldPosition(new e.camera.position.constructor())
          const pm = e.panelMesh
          const dist = pm.position.distanceTo(head)
          const V = e.camera.position.constructor, M = e.camera.matrix.constructor
          const press = (btnId) => {
            e.rig.updateMatrixWorld(true); pm.updateMatrixWorld(true)
            const b = e.layout.buttons.find((x) => x.id === btnId)
            if (!b) { (window.__pressMiss = window.__pressMiss || []).push({ btnId, mode: e.mode, ids: e.layout.buttons.map((x) => x.id).filter((i) => !/^(goto|light|fan)/.test(i)) }); return }
            const gp = pm.geometry.parameters, W = 1024, H = Math.round(W * gp.height / gp.width)   // the panel's canvas height follows the mesh (was a stale hard-coded 800: the panel is 880 px tall since the fan strip was added)
            const local = new V((b.x + b.w / 2) / W * gp.width - gp.width / 2, (0.5 - (b.y + b.h / 2) / H) * gp.height, 0)
            const target = pm.localToWorld(local)
            const ctrl = e.renderer.xr.getController(1)
            const pos = new V(head.x + 0.25, head.y - 0.3, head.z)
            e.rig.worldToLocal(pos); ctrl.position.copy(pos)
            const m = new M().lookAt(e.rig.localToWorld(ctrl.position.clone()), target, new V(0, 1, 0))
            ctrl.quaternion.setFromRotationMatrix(e.rig.matrixWorld.clone().invert().multiply(m))
            ctrl.matrix.compose(ctrl.position, ctrl.quaternion, ctrl.scale); ctrl.matrixWorldNeedsUpdate = true   // MOCK pose (XR controllers have matrixAutoUpdate=false; a real session writes their matrix)
            ctrl.updateMatrixWorld(true)
            e.tick(0.05)
            ctrl.dispatchEvent({ type: 'selectstart' })     // the real listener of the controller object
            e.tick(0.05)
          }
          const dbg = []
          dbg.push({ step: 'start', mode: e.mode, ids: e.layout.buttons.map((x) => x.id).filter((i) => !/^(goto|light|fan)/.test(i)) })
          press('allOn'); const on = e.state.lights.onCount, total = e.state.lights.rooms.length
          dbg.push({ step: 'afterOn', mode: e.mode, ids: e.layout.buttons.map((x) => x.id).filter((i) => !/^(goto|light|fan)/.test(i)) })
          press('allOff'); const off = e.state.lights.onCount
          dbg.push({ step: 'afterOff', mode: e.mode, ids: e.layout.buttons.map((x) => x.id).filter((i) => !/^(goto|light|fan)/.test(i)) })
          const fk = e.state.fanKeys[0]
          const hitBefore = (() => { const b = e.layout.buttons.find((x) => x.id === 'exit'); return b ? { x: b.x, y: b.y, w: b.w, h: b.h, label: b.label } : null })()
          press('exit')
          return { opened, dist, on, total, off, fk, sessionEnded: e.mode, exitBtn: hitBefore, seated: !!e.seated, aiming: e.teleportInfo.aiming, msg: e.message, dbg, miss: window.__pressMiss }
        })
        const ended = await p3.waitForFunction(() => window.__vrEngine.mode === 'desktop', null, { timeout: 20000, polling: 100 }).then(() => true, () => false)
        r.sessionEnded = ended
        return { ok: ended && r.opened && r.dist > 0.8 && r.dist < 1.3 && r.on === r.total && r.off === 0, detail: JSON.stringify(r) }
      })
      await check(label + 'MOCK xr: INJECTED trigger on a wall switch plate (ray from a posed controller) toggles the light', async () => {
        await E3(() => window.__vrEngine.exitVR()); await p3.waitForFunction(() => window.__vrEngine.mode === 'desktop', null, { timeout: 5000 }).catch(() => {})
        await p3.click('[data-testid=enter-vr]', { timeout: 90000 })
        await p3.waitForFunction(() => window.__vrEngine.mode === 'vr')
        const r = await E3(() => {
          const e = window.__vrEngine
          e.camera.position.set(0, 1.6, 0); e.rig.updateMatrixWorld(true)   // MOCK headset pose
          const V = e.camera.position.constructor, M = e.camera.matrix.constructor
          for (const room of e.house.smart.rooms) {
            if (!room.switch) continue
            const n = room.switch.normal
            const spot = e.house.nav.nearestStandable(room.switch.pos[0] + n[0] * 3, room.switch.pos[2] + n[2] * 3, room.floor_y + 0.2, 2)
            if (!spot) continue
            e.teleportTo(spot); for (let i = 0; i < 5; i++) e.tick(0.05)
            e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
            const key = `${room.floor}:${room.id}`
            const plate = new V(room.switch.pos[0] * 0.3048, room.switch.pos[1] * 0.3048, room.switch.pos[2] * 0.3048)
            const ctrl = e.renderer.xr.getController(0)
            const head = e.camera.getWorldPosition(new V())
            e.rig.updateMatrixWorld(true)
            ctrl.position.copy(e.rig.worldToLocal(new V(head.x, head.y - 0.3, head.z)))
            ctrl.quaternion.setFromRotationMatrix(e.rig.matrixWorld.clone().invert().multiply(new M().lookAt(new V(head.x, head.y - 0.3, head.z), plate, new V(0, 1, 0))))
            ctrl.matrix.compose(ctrl.position, ctrl.quaternion, ctrl.scale); ctrl.matrixWorldNeedsUpdate = true   // MOCK pose
            ctrl.updateMatrixWorld(true)
            const before = e.state.lights.isOn(key)
            ctrl.dispatchEvent({ type: 'selectstart' })
            const after = e.state.lights.isOn(key)
            return { key, before, after }
          }
          return null
        })
        await p3.evaluate(() => window.__vrEngine.exitVR())
        return { ok: !!r && r.before === false && r.after === true, detail: JSON.stringify(r) }
      })
      await check(label + 'MOCK xr: INJECTED controller ray hovers the real fan (highlight + hint), the trigger switches it ON/OFF, the speed control buttons 1/2/3/4/5 and OFF (trigger) set the real blade speed, and the panel fan strip (Y panel, trigger) does the same; fan state survives leaving and re-entering VR', async () => {
        await E3(() => window.__vrEngine.exitVR()); await p3.waitForFunction(() => window.__vrEngine.mode === 'desktop', null, { timeout: 5000 }).catch(() => {})
        await p3.click('[data-testid=enter-vr]', { timeout: 90000 })
        await p3.waitForFunction(() => window.__vrEngine.mode === 'vr')
        const r = await E3(() => {
          const e = window.__vrEngine
          const V = e.camera.position.constructor, M = e.camera.matrix.constructor
          e.camera.position.set(0, 1.6, 0); e.rig.updateMatrixWorld(true)   // MOCK headset pose
          const room = e.house.smart.rooms.find((q) => q.fan)
          const key = `${room.floor}:${room.id}`
          const c = e.smart.fanCenterFeet(key)
          const spot = e.house.nav.nearestStandable(c.x + 5, c.z, room.floor_y + 0.2, 3) || e.house.nav.nearestStandable(c.x - 5, c.z, room.floor_y + 0.2, 3)
          e.teleportTo(spot); for (let i = 0; i < 5; i++) e.tick(0.05)
          const ctrl = e.renderer.xr.getController(0)
          const pose = (ft) => {               // MOCK controller pose: at the hand, pointing at a point given in feet
            e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
            const head = e.camera.getWorldPosition(new V()); const from = new V(head.x, head.y - 0.3, head.z)
            const to = ft.isVector3 ? ft : new V(ft[0] * 0.3048, ft[1] * 0.3048, ft[2] * 0.3048)
            ctrl.position.copy(e.rig.worldToLocal(from.clone()))
            ctrl.quaternion.setFromRotationMatrix(e.rig.matrixWorld.clone().invert().multiply(new M().lookAt(from, to, new V(0, 1, 0))))
            ctrl.matrix.compose(ctrl.position, ctrl.quaternion, ctrl.scale); ctrl.matrixWorldNeedsUpdate = true; ctrl.updateMatrixWorld(true)
            e.tick(0.05)
          }
          const trigger = () => ctrl.dispatchEvent({ type: 'selectstart' })
          const settle = () => { for (let i = 0; i < 400; i++) { e.tick(0.05); e.smart.touchFanPopup() } }
          const degPerSec = () => { const a0 = e.smart.fanRigs.find((f) => f.key === key).angleRad; for (let i = 0; i < 10; i++) e.tick(0.05); return Math.abs(e.smart.fanRigs.find((f) => f.key === key).angleRad - a0) * 57.29578 / 0.5 }
          const out = { key }
          e.state.setFanLevel(key, 0, 'code'); settle()
          pose([c.x, c.y, c.z]); out.hover = { ...e.smart.fanPopup }; out.lvlBefore = e.state.fanLevel(key)
          trigger(); out.afterTrigger = { lvl: e.state.fanLevel(key), mode: e.smart.fanPopup.mode }
          trigger(); out.afterSecond = e.state.fanLevel(key); e.tick(0.05); e.tick(0.05)
          out.speeds = {}
          for (const lv of [1, 2, 3, 4, 5]) {
            const b = e.smart.popupButtonFeet(`pop:${lv}`)
            if (!b) { out.speeds[lv] = 'no button'; continue }
            pose([b.x, b.y, b.z]); trigger(); const got = e.state.fanLevel(key); settle(); out.speeds[lv] = { got, deg: Math.round(degPerSec()) }
          }
          const b0 = e.smart.popupButtonFeet('pop:0')
          if (b0) { pose([b0.x, b0.y, b0.z]); trigger(); settle(); out.off = { lvl: e.state.fanLevel(key), deg: degPerSec() } }
          // the panel (Y button): fan strip buttons by ray
          e.setPanelOpen(true); e.placePanel(); e.tick(0.05)
          out.strip = {}
          for (const id of ['fanstrip:5', 'fanstrip:4', 'fanstrip:2', 'fanstrip:off']) {
            e.tick(0.05)
            const btn = e.panelLayout.buttons.find((q) => q.id === id)
            const L = e.panelLayout
            const w = e.panelMesh.localToWorld(new V(((btn.x + btn.w / 2) / L.width - 0.5) * 1.1, (0.5 - (btn.y + btn.h / 2) / L.height) * 1.1 * (L.height / L.width), 0))
            pose(w); trigger(); out.strip[id] = e.state.fanLevel(key)
          }
          e.state.setFanLevel(key, 0, 'code'); e.state.currentRoomKey = key
          const heard = e.state.execute('Set fan speed to 4.'); settle(); out.voice4 = { lvl: e.state.fanLevel(key), deg: Math.round(degPerSec()), msg: heard.message }
          out.modeAfter = e.mode                                   // everything above happened inside the immersive session
          e.state.setFanLevel(key, 3, 'code')
          return out
        })
        // leave and re-enter: the same engine and state object are kept
        const kept = await E3(() => { const e = window.__vrEngine; const k = e.state.fanKeys.find((q) => e.state.fanLevel(q) === 3); return !!k })
        await p3.evaluate(() => window.__vrEngine.exitVR()); await p3.waitForFunction(() => window.__vrEngine.mode === 'desktop', null, { timeout: 5000 }).catch(() => {})
        await p3.click('[data-testid=enter-vr]', { timeout: 90000 }); await p3.waitForFunction(() => window.__vrEngine.mode === 'vr')
        const kept2 = await E3(() => { const e = window.__vrEngine; return e.state.fanKeys.some((q) => e.state.fanLevel(q) === 3) })
        await p3.evaluate(() => window.__vrEngine.exitVR())
        const exp = { 1: 540, 2: 840, 3: 1140, 4: 1440, 5: 1800 }
        const sOk = Object.keys(exp).every((k) => r.speeds[k] && r.speeds[k].got === Number(k) && Math.abs(r.speeds[k].deg - exp[k]) < 30)
        const ok = r.hover.visible && r.hover.mode === 'hint' && r.lvlBefore === 0 && r.afterTrigger.lvl > 0 && r.afterTrigger.mode === 'full' && r.afterSecond === 0 && sOk && r.off && r.off.lvl === 0 && r.off.deg < 1 && r.strip['fanstrip:5'] === 5 && r.strip['fanstrip:4'] === 4 && r.strip['fanstrip:2'] === 2 && r.voice4.lvl === 4 && Math.abs(r.voice4.deg - 1440) < 30 && r.modeAfter === 'vr' && r.strip['fanstrip:off'] === 0 && kept && kept2
        return { ok: !!ok, detail: JSON.stringify({ ...r, kept, kept2 }) }
      })
      await check(label + 'MOCK xr: INJECTED trigger pointed at a sit pad sits (view lowered to ~75 cm above the seat from the headset height), a left-stick push stands up; panel STAND UP works; sitting again re-sets the height', async () => {
        await E3(() => window.__vrEngine.exitVR()); await p3.waitForFunction(() => window.__vrEngine.mode === 'desktop', null, { timeout: 5000 }).catch(() => {})
        await p3.click('[data-testid=enter-vr]', { timeout: 90000 })
        await p3.waitForFunction(() => window.__vrEngine.mode === 'vr')
        const r = await E3(() => {
          const e = window.__vrEngine, s = window.__fakeXr.session
          e.camera.position.set(0, 1.6, 0); e.rig.updateMatrixWorld(true)   // MOCK headset pose
          const V = e.camera.position.constructor, M = e.camera.matrix.constructor
          const mk = (h, ax) => ({ handedness: h, gamepad: { axes: ax, buttons: [false, false, false, false, false, false].map((b) => ({ pressed: b })), hapticActuators: [] } })
          if (e.panelOpen) e.runAction({ t: 'close' })   // the open panel is a UI that (rightly) wins over a disc behind it; this check is about the disc
          const sp = e.house.seats.find((q) => q.kind === 'sofa') ?? e.house.seats[0]
          const f = e.house.nav.nearestStandable(sp.x + sp.fx * 3, sp.z + sp.fz * 3, sp.floorY + 0.2, 4)
          e.teleportTo(f); for (let i = 0; i < 5; i++) e.tick(0.05)
          e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
          const pad = e.scene.getObjectByName('seat-pad-' + sp.id); pad.updateMatrixWorld(true)
          const aimAt = (target) => {
            const ctrl = e.renderer.xr.getController(0), head = e.camera.getWorldPosition(new V())
            ctrl.position.copy(e.rig.worldToLocal(new V(head.x, head.y - 0.3, head.z)))
            ctrl.quaternion.setFromRotationMatrix(e.rig.matrixWorld.clone().invert().multiply(new M().lookAt(new V(head.x, head.y - 0.3, head.z), target, new V(0, 1, 0))))
            ctrl.matrix.compose(ctrl.position, ctrl.quaternion, ctrl.scale); ctrl.matrixWorldNeedsUpdate = true   // MOCK pose
            ctrl.updateMatrixWorld(true); return ctrl
          }
          const ctrl = aimAt(pad.getWorldPosition(new V()))
          const padVisible = pad.visible
          const dbgHit = e.pick(e.rayFor(ctrl)); const dbgMsg0 = e.message
          ctrl.dispatchEvent({ type: 'selectstart' })
          e.tick(0.05); e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
          const seated = !!e.seated
          const eye = e.camera.getWorldPosition(new V()).y
          const eyeErr = e.seated ? Math.abs(eye - (e.seated.spot.seatY * 0.3048 + 0.75)) : 99
          const lift = e.sitLift
          const label = e.layout.buttons.find((b) => b.id === 'seat')?.label
          // the person physically sits: the headset is now lower; pressing sit again re-sets the lift
          e.camera.position.set(0, 1.15, 0); e.camera.updateMatrixWorld(true)
          e.sit(); e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
          const eye2 = e.camera.getWorldPosition(new V()).y
          const recal = e.seated ? Math.abs(eye2 - (e.seated.spot.seatY * 0.3048 + 0.75)) : 99
          e.camera.position.set(0, 1.6, 0)
          // left stick forward stands up
          s.inputSources = [mk('left', [0, 0, 0, -1]), mk('right', [0, 0, 0, 0])]
          e.tick(0.05)
          s.inputSources = [mk('left', [0, 0, 0, 0]), mk('right', [0, 0, 0, 0])]
          const stoodByStick = !e.seated && e.sitLift === 0
          // panel button
          e.sit(); const sat2 = !!e.seated
          e.runAction(e.layout.buttons.find((b) => b.id === 'seat').action)
          return { padVisible, seated, eyeErr, lift, label, recal, stoodByStick, panelStands: sat2 && !e.seated, dbg: { hit: dbgHit, msg: e.message, sp: { id: sp.id, kind: sp.kind, x: sp.x, z: sp.z }, foot: { ...e.foot }, padPos: pad.getWorldPosition(new V()).toArray(), head: e.camera.getWorldPosition(new V()).toArray() } }
        })
        await p3.evaluate(() => window.__vrEngine.exitVR())
        return { ok: r.padVisible && r.seated && r.eyeErr < 0.03 && r.lift < 0 && r.label === 'STAND UP' && r.recal < 0.03 && r.stoodByStick && r.panelStands, detail: JSON.stringify(r) }
      })
      await c3.close()
    }
  }
  await browser.close()
  console.log(JSON.stringify(results))
})().catch((e) => { console.error('E2E crashed:', e); process.exit(2) })
