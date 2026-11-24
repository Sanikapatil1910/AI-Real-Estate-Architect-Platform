/**
 * Browser end-to-end test of HANDS-FREE (continuous) voice control (run by hand / tests/test_vr_webxr.py with VR_E2E=1; needs the backend + vite dev server running).
 *   node dev/e2e_voice.cjs <baseUrl> <fixtureName> <outDir>
 * Prints { executed: [...], simulated: [...] }.
 *   executed  = real Chromium, the real pages and the real engine, desktop mode (no headset).
 *   simulated = WebXR is MOCKED (a fake navigator.xr / session / input sources) and controller input is injected.
 * IMPORTANT: speech recognition itself is FAKED in every check here (a scripted SpeechRecognition class, a scripted getUserMedia and Permissions API): this proves our
 * lifecycle, parsing and state wiring, NOT that a real microphone / the Meta Quest Browser recognises speech.  Nothing here has run on a Meta Quest.
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const [BASE, FX, OUT] = process.argv.slice(2)
const FIX = path.join(__dirname, 'fixtures')
fs.mkdirSync(OUT, { recursive: true })
const results = { executed: [], simulated: [] }
let bucket = 'executed'
const rec = (name, ok, detail = '') => results[bucket].push({ name, ok: !!ok, detail: String(detail).slice(0, 400) })
async function check(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  try { const r = await fn(); rec(name, r === undefined ? true : r === true || (r && r.ok !== false && r !== false), r && r.detail ? r.detail : '') }
  catch (e) { rec(name, false, e && e.message ? e.message : e) }
}
const api = async (p, opt = {}) => { const r = await fetch(BASE + p, { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) } }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }

async function setup(plan, name) {
  const email = `vv${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`
  await api('/auth/signup', { method: 'POST', body: JSON.stringify({ full_name: 'Voice Tester', email, password: 'Passw0rd!x', role: 'home_owner' }) })
  const tok = (await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!x' }) })).body.access_token
  const p = await api('/projects', { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ name, kind: 'generated', style: plan.architectural_style || 'Modern', data: { plan } }) })
  return { tok, id: p.body.id }
}

/** the scripted browser: a fake SpeechRecognition, getUserMedia and Permissions API that the test drives from window.__vf */
function installFakes({ speech = true }) {
  window.__vf = { gum: 'granted', gumCalls: 0, tracksStopped: 0, instances: [], starts: 0, permState: 'granted', permStatus: null, permQueries: 0 }
  if (speech) {
    class FakeSR {
      constructor() { this.alive = false; this._res = []; window.__vf.instances.push(this) }
      start() { if (this.alive) throw new DOMException('already started', 'InvalidStateError'); this.alive = true; window.__vf.starts++; setTimeout(() => this.onstart && this.onstart(), 5) }
      stop() { this._end() }
      abort() { this._end() }
      _end() { if (!this.alive) return; this.alive = false; setTimeout(() => this.onend && this.onend(), 5) }
      say(text, conf = 0.92, isFinal = true) {
        const idx = this._res.length
        this._res.push(Object.assign([{ transcript: text, confidence: conf }], { isFinal }))
        this.onresult && this.onresult({ results: this._res.slice(), resultIndex: idx })
      }
      /** the engine re-delivers the last result (some browsers do) */
      redeliver() { this.onresult && this.onresult({ results: this._res.slice(), resultIndex: this._res.length - 1 }) }
    }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR
  } else { delete window.SpeechRecognition; delete window.webkitSpeechRecognition }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
    window.__vf.gumCalls++
    if (window.__vf.gum === 'denied') { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e }
    return { getTracks: () => [{ stop() { window.__vf.tracksStopped++ } }] }
  } } })
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => {
    window.__vf.permQueries++
    if (!window.__vf.permStatus) { let oc = null; window.__vf.permStatus = { get state() { return window.__vf.permState }, get onchange() { return oc }, set onchange(v) { oc = v } } }
    return window.__vf.permStatus
  } } })
  // MOCK WebXR
  const listeners = {}
  const session = { inputSources: [], addEventListener(t, f) { (listeners[t] ||= []).push(f) }, async end() { (listeners.end || []).forEach((f) => f()) } }
  window.__fakeXr = { session, requests: [] }
  Object.defineProperty(navigator, 'xr', { configurable: true, value: { isSessionSupported: async (m) => m === 'immersive-vr', requestSession: async (m, init) => { window.__fakeXr.requests.push({ m, init }); return session } } })
}

async function openViewer(browser, tok, id, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('rea.token', t) } catch {} }, tok)
  await ctx.addInitScript(installFakes, opts)
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  pg.on('console', (m) => { if (m.type() === 'error' && !/401|favicon/.test(m.text())) errors.push(m.text().slice(0, 300)) })
  pg.__errors = errors
  await pg.goto(`${BASE}/app/vr/${id}?vrdebug=1`)
  await pg.waitForSelector('[data-testid=vr-stage] canvas', { timeout: 240000 })
  await pg.waitForFunction(() => !!window.__vrEngine, null, { timeout: 30000 })
  await pg.waitForTimeout(500)
  return { ctx, pg }
}

;(async () => {
  const plan = JSON.parse(fs.readFileSync(path.join(FIX, FX + '.json'), 'utf8'))
  const { tok, id } = await setup(plan.plan ?? plan, 'voice ' + FX)
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const label = `[${FX}] `

  // ======================================================================== page 1: fake speech available
  const { ctx, pg } = await openViewer(browser, tok, id, { speech: true })
  const E = (fn, arg) => pg.evaluate(fn, arg)
  const wait = (cond, arg, t = 90000) =>   // the software-rendered browser here is slow: generous waits
    pg.waitForFunction(cond, arg, { timeout: t })
  const live = () => E(() => window.__vf.instances.filter((i) => i.alive).length)
  const say = async (text, conf) => { await pg.waitForFunction(() => window.__vf.instances.some((x) => x.alive), null, { timeout: 30000 }).catch(() => {}); return E(([t, c]) => { const i = window.__vf.instances.filter((x) => x.alive)[0]; if (!i) return false; i.say(t, c); return true }, [text, conf ?? 0.92]) }
  const hf = () => E(() => { const s = window.__vrEngine.handsFree.status; return { phase: s.phase, hud: window.__vrEngine.hudText, hudVisible: window.__vrEngine.hud.visible, gum: window.__vf.gumCalls, starts: window.__vf.starts, live: window.__vf.instances.filter((i) => i.alive).length } })
  const advance = () => pg.waitForTimeout(1700)       // lets the 1.5 s "same phrase twice" window pass between repeated commands
  await E(() => { window.__vrEngine.renderer.xr.setSession = async () => {} })   // MOCK: three's real XR manager needs a real XRSession (same stub as dev/e2e_vr.cjs)
  await E(() => window.__vrEngine.setPanelOpen(true))

  // ---------------- desktop (no headset, no VR session)
  await check(label + 'DESKTOP: before VR / before any click nothing listens: no recognizer, no microphone request, hands-free status off', async () => {
    const r = await hf()
    await pg.waitForTimeout(1500)
    const r2 = await hf()
    return { ok: r.phase === 'off' && r.live === 0 && r.gum === 0 && r2.starts === 0 && r2.gum === 0, detail: JSON.stringify(r2) }
  })
  await check(label + 'DESKTOP: typed commands still work through the same parser ("turn on the living room light")', async () => {
    await pg.fill('[data-testid=typed-command]', 'turn off all lights'); await pg.press('[data-testid=typed-command]', 'Enter')
    await pg.fill('[data-testid=typed-command]', 'turn on the living room light'); await pg.press('[data-testid=typed-command]', 'Enter')
    const r = await E(() => { const s = window.__vrEngine.state; const lr = s.lights.rooms.find((x) => x.type === 'living_room'); return { lr: s.lights.isOn(lr.key), others: s.lights.rooms.filter((x) => x.key !== lr.key && s.lights.isOn(x.key)).length } })
    return { ok: r.lr && r.others === 0, detail: JSON.stringify(r) }
  })
  await check(label + 'DESKTOP: the hands-free button asks for the microphone (explicit click), starts ONE recognizer and shows "Listening"; a spoken command works with no Speak click', async () => {
    await pg.click('[data-testid=handsfree-toggle]')
    await wait(() => window.__vrEngine.handsFree.status.phase === 'listening')
    const l = await live(), g = await E(() => window.__vf.gumCalls), stopped = await E(() => window.__vf.tracksStopped)
    const status = await pg.textContent('[data-testid=handsfree-status]')
    await say('turn on the kitchen lights')
    const on = await E(() => { const s = window.__vrEngine.state; const k = s.lights.rooms.find((x) => x.type === 'kitchen'); return s.lights.isOn(k.key) })
    return { ok: l === 1 && g === 1 && stopped === 1 && /Listening|Kitchen/.test(status) && on, detail: JSON.stringify({ l, g, stopped, status, on }) }
  })
  await check(label + 'DESKTOP: mute releases the recognizer (0 live) and a muted microphone runs nothing; resume listens again', async () => {
    await pg.click('[data-testid=handsfree-toggle]')
    await wait(() => window.__vrEngine.handsFree.status.phase === 'muted')
    const l0 = await live(); const label0 = (await pg.textContent('[data-testid=handsfree-toggle]')).trim()
    await E(() => window.__vrEngine.state.setAllLights(false, 'code'))
    const heard = await say('turn on all lights'); await pg.waitForTimeout(300)
    const still = await E(() => window.__vrEngine.state.lights.rooms.every((r) => !window.__vrEngine.state.lights.isOn(r.key)))
    await pg.click('[data-testid=handsfree-toggle]')
    await wait(() => window.__vrEngine.handsFree.status.phase === 'listening')
    const l1 = await live()
    return { ok: l0 === 0 && /Resume/.test(label0) && heard === false && still && l1 === 1, detail: JSON.stringify({ l0, label0, heard, still, l1 }) }
  })
  await check(label + 'DESKTOP: the wake phrase is optional by default; with "Only act on commands that start with Hey Home" ticked, plain commands are ignored and "Hey Home, ..." works', async () => {
    await E(() => window.__vrEngine.state.setAllLights(false, 'code'))
    await advance(); await say('turn on the kitchen lights')
    const plain = await E(() => { const s = window.__vrEngine.state; return s.lights.isOn(s.lights.rooms.find((x) => x.type === 'kitchen').key) })
    await pg.check('[data-testid=wake-required]')
    await E(() => window.__vrEngine.state.setAllLights(false, 'code'))
    await advance(); await say('turn on the kitchen lights'); await pg.waitForTimeout(200)
    const ignored = await E(() => { const s = window.__vrEngine.state; return !s.lights.isOn(s.lights.rooms.find((x) => x.type === 'kitchen').key) })
    await advance(); await say('Hey Home, turn on the kitchen lights')
    const woke = await E(() => { const s = window.__vrEngine.state; return s.lights.isOn(s.lights.rooms.find((x) => x.type === 'kitchen').key) })
    await pg.uncheck('[data-testid=wake-required]')
    return { ok: plain && ignored && woke, detail: JSON.stringify({ plain, ignored, woke }) }
  })
  await check(label + 'DESKTOP: push-to-talk (Speak) still works and never runs together with hands-free (no second recognizer)', async () => {
    await pg.click('[data-testid=handsfree-toggle]')                      // mute hands-free
    await wait(() => window.__vrEngine.handsFree.status.phase === 'muted')
    await pg.click('[data-testid=mic]')                                   // the existing Speak button: HANDS-FREE is muted, so this resumes listening (one recognizer)
    await pg.waitForTimeout(600)
    const l = await live()
    const phase = await E(() => window.__vrEngine.handsFree.status.phase)
    return { ok: l <= 1 && phase === 'listening', detail: JSON.stringify({ l, phase }) }
  })
  await pg.screenshot({ path: path.join(OUT, `${FX}_desktop_handsfree_controls.png`), clip: await pg.locator('[data-testid=handsfree-box]').boundingBox() })   // desktop browser, not a headset

  // ---------------- simulated VR
  bucket = 'simulated'
  await E(() => { const e = window.__vrEngine; e.handsFree.stop() })           // start from a clean state: hands-free off
  const fanRoomKey = await E(() => { const s = window.__vrEngine.state; const r = s.lights.rooms.find((x) => x.type === 'living_room' && x.hasFan); return r ? r.key : null })
  await check(label + 'MOCK xr: Enter VR starts hands-free listening AUTOMATICALLY after the (mock) microphone permission: one recognizer, status Listening, status pill visible, no Speak click', async () => {
    const before = await E(() => window.__vf.gumCalls)
    await pg.click('[data-testid=enter-vr]', { timeout: 180000 })
    await wait(() => window.__vrEngine.mode === 'vr')
    await wait(() => window.__vrEngine.handsFree.status.phase === 'listening')
    const r = await hf()
    return { ok: r.phase === 'listening' && r.live === 1 && r.gum === before + 1 && r.hud === 'Listening' && r.hudVisible, detail: JSON.stringify(r) }
  })
  await check(label + 'MOCK xr: a lighting command is spoken (no click): "turn on all lights" then "turn off all lights"', async () => {
    await E(() => window.__vrEngine.state.setAllLights(false, 'code'))
    await say('Turn on all lights.')
    const on = await E(() => window.__vrEngine.state.lights.rooms.every((r) => window.__vrEngine.state.lights.isOn(r.key)))
    const hud = await E(() => window.__vrEngine.hudText)
    await advance(); await say('Turn off all lights.')
    const off = await E(() => window.__vrEngine.state.lights.rooms.every((r) => !window.__vrEngine.state.lights.isOn(r.key)))
    return { ok: on && off && /^✓/.test(hud), detail: JSON.stringify({ on, off, hud }) }
  })
  await check(label + 'MOCK xr: room-specific lighting while standing in ANOTHER room: living room ON, kitchen ON / OFF, only the named room changes', async () => {
    const here = await E(() => { const e = window.__vrEngine; e.state.setAllLights(false, 'code'); return e.state.currentRoomKey })
    await advance(); await say('Turn on the living room lights.')
    const a = await E(() => { const s = window.__vrEngine.state; const lr = s.lights.rooms.find((x) => x.type === 'living_room'); return { lr: s.lights.isOn(lr.key), others: s.lights.rooms.filter((x) => x.key !== lr.key && s.lights.isOn(x.key)).length, cur: s.currentRoomKey } })
    await advance(); await say('Turn on the kitchen lights.'); await advance(); await say('Turn off the kitchen lights.')
    const b = await E(() => { const s = window.__vrEngine.state; const k = s.lights.rooms.find((x) => x.type === 'kitchen'); const lr = s.lights.rooms.find((x) => x.type === 'living_room'); return { kitchen: s.lights.isOn(k.key), lr: s.lights.isOn(lr.key) } })
    return { ok: a.lr && a.others === 0 && b.kitchen === false && b.lr === true, detail: JSON.stringify({ here, a, b }) }
  })
  await check(label + 'MOCK xr: fan ON / OFF by room ("turn on the living room fan", "turn off the living room fan") updates the shared state and the 3D blades', async () => {
    if (!fanRoomKey) return { ok: false, detail: 'fixture has no living-room fan' }
    await E((k) => window.__vrEngine.state.setFanLevel(k, 0, 'code'), fanRoomKey)
    await advance(); await say('Turn on the living room fan.')
    const on = await E((k) => { const e = window.__vrEngine; const lvl = e.state.fanLevel(k); for (let i = 0; i < 400; i++) e.tick(0.05); const ang = () => e.smart.fanRigs.find((f) => f.key === k).angleRad; const a0 = ang(); for (let i = 0; i < 10; i++) e.tick(0.05); return { lvl, deg: Math.round(Math.abs(ang() - a0) * 57.2958 / 0.5) } }, fanRoomKey)
    await advance(); await say('Turn off the living room fan.')
    const off = await E((k) => { const e = window.__vrEngine; for (let i = 0; i < 400; i++) e.tick(0.05); return e.state.fanLevel(k) }, fanRoomKey)
    return { ok: on.lvl > 0 && on.deg > 0 && off === 0, detail: JSON.stringify({ on, off }) }
  })
  await check(label + 'MOCK xr: "Set the living room fan speed to N" for N = 1,2,3,4,5 sets that level and the blades turn at 540 / 840 / 1140 / 1440 / 1800 deg/s (distinct and increasing)', async () => {
    const expect = { 1: 540, 2: 840, 3: 1140, 4: 1440, 5: 1800 }
    const got = {}
    for (const n of [1, 2, 3, 4, 5]) {
      await advance(); await say(`Set the living room fan speed to ${n}.`)
      got[n] = await E((k) => { const e = window.__vrEngine; const lvl = e.state.fanLevel(k); for (let i = 0; i < 400; i++) e.tick(0.05); const ang = () => e.smart.fanRigs.find((f) => f.key === k).angleRad; const a0 = ang(); for (let i = 0; i < 10; i++) e.tick(0.05); return { lvl, deg: Math.round(Math.abs(ang() - a0) * 57.2958 / 0.5) } }, fanRoomKey)
    }
    const ok = [1, 2, 3, 4, 5].every((n) => got[n].lvl === n && Math.abs(got[n].deg - expect[n]) < 30)
    return { ok, detail: JSON.stringify(got) }
  })
  await check(label + 'MOCK xr: several commands in a row (light, fan, speed, speed, light) all apply, in order, on the one shared state', async () => {
    await E((k) => { const s = window.__vrEngine.state; s.setAllLights(false, 'code'); s.setFanLevel(k, 0, 'code') }, fanRoomKey)
    for (const t of ['turn on the living room lights', 'turn on the living room fan', 'set the living room fan speed to 3', 'set the living room fan speed to 5', 'turn off the living room lights']) { await advance(); await say(t) }
    const r = await E((k) => { const s = window.__vrEngine.state; const lr = s.lights.rooms.find((x) => x.type === 'living_room'); return { light: s.lights.isOn(lr.key), fan: s.fanLevel(k) } }, fanRoomKey)
    return { ok: r.light === false && r.fan === 5, detail: JSON.stringify(r) }
  })
  await check(label + 'MOCK xr: a result the engine delivers twice, and the same phrase repeated within 1.5 s, is processed ONCE ("faster" raises the fan by exactly one level)', async () => {
    await E((k) => window.__vrEngine.state.setFanLevel(k, 1, 'code'), fanRoomKey)
    await advance()
    await E(() => { const i = window.__vf.instances.filter((x) => x.alive)[0]; i.say('make the living room fan faster'); i.redeliver(); i.redeliver(); i.say('make the living room fan faster') })
    const lvl = await E((k) => window.__vrEngine.state.fanLevel(k), fanRoomKey)
    return { ok: lvl === 2, detail: 'level ' + lvl }
  })
  await check(label + 'MOCK xr: half-heard (interim) speech and low-confidence noise run nothing; ordinary chatter is ignored silently', async () => {
    await E(() => window.__vrEngine.state.setAllLights(false, 'code'))
    await advance()
    await E(() => { const i = window.__vf.instances.filter((x) => x.alive)[0]; i.say('turn on all', 0.9, false) })
    const partial = await E(() => ({ on: window.__vrEngine.state.lights.rooms.some((r) => window.__vrEngine.state.lights.isOn(r.key)), hud: window.__vrEngine.hudText }))
    await say('turn on all lights', 0.1)
    await say('what are we having for dinner tonight')
    const none = await E(() => window.__vrEngine.state.lights.rooms.every((r) => !window.__vrEngine.state.lights.isOn(r.key)))
    return { ok: !partial.on && none && /Hearing/.test(partial.hud), detail: JSON.stringify(partial) }
  })
  await check(label + 'MOCK xr: the recognizer is stopped unexpectedly (browser ends it): it restarts by itself, never two at once, and the next command works', async () => {
    const before = await E(() => window.__vf.starts)
    await E(() => { window.__vf.instances.filter((i) => i.alive).forEach((i) => i._end()) })
    await wait((b) => window.__vf.starts > b && window.__vf.instances.filter((i) => i.alive).length === 1, before, 60000)
    const r = await hf()
    await E(() => window.__vrEngine.state.setAllLights(false, 'code')); await advance()
    await say('turn on all lights')
    const on = await E(() => window.__vrEngine.state.lights.rooms.every((x) => window.__vrEngine.state.lights.isOn(x.key)))
    return { ok: r.live === 1 && r.phase === 'listening' && on, detail: JSON.stringify(r) }
  })
  await check(label + 'MOCK xr: "no-speech" silence errors do not break listening (still one recognizer after several)', async () => {
    for (let i = 0; i < 3; i++) {
      const b = await E(() => window.__vf.starts)
      await E(() => { const x = window.__vf.instances.filter((q) => q.alive)[0]; x.onerror && x.onerror({ error: 'no-speech' }); x._end() })
      await wait((bb) => window.__vf.starts > bb && window.__vf.instances.filter((q) => q.alive).length === 1, b, 60000)
    }
    const r = await hf()
    return { ok: r.live === 1 && r.phase === 'listening', detail: JSON.stringify(r) }
  })
  await check(label + 'MOCK xr: panel MIC button mutes (recognizer released, pill says muted, commands ignored) and resumes; the panel board mirrors it; the push-to-talk call never adds a second recognizer', async () => {
    const lay = () => E(() => window.__vrEngine.layout.buttons.find((b) => b.id === 'mic'))
    const b0 = await lay()
    await E(() => { const e = window.__vrEngine; e.runAction({ t: 'mic' }) })
    await wait(() => window.__vrEngine.handsFree.status.phase === 'muted')
    const m = await hf(); const b1 = await lay(); await E(() => { for (let i = 0; i < 80; i++) window.__vrEngine.tick(0.05) }); const head = await E(() => window.__vrEngine.panel.voice.headline)   // the mocked session runs no animation frames, so step the engine 4 s: a 3 s 'Action completed' banner may still be showing
    await E(() => window.__vrEngine.state.setAllLights(false, 'code'))
    await E(() => { const i = window.__vf.instances[window.__vf.instances.length - 1]; i.onresult && i.onresult({ results: [Object.assign([{ transcript: 'turn on all lights', confidence: 0.9 }], { isFinal: true })], resultIndex: 0 }) })
    const ignored = await E(() => window.__vrEngine.state.lights.rooms.every((r) => !window.__vrEngine.state.lights.isOn(r.key)))
    await E(() => { const e = window.__vrEngine; e.runAction({ t: 'mic' }) })
    await wait(() => window.__vrEngine.handsFree.status.phase === 'listening')
    await E(() => window.__vrEngine.pushToTalk())
    await pg.waitForTimeout(400)
    const r = await hf(); const b2 = await lay()
    return { ok: b0.label === 'MIC: LISTENING' && m.phase === 'muted' && m.live === 0 && /muted/i.test(m.hud) && b1.label === 'MIC: MUTED' && /muted/i.test(head) && ignored && r.phase === 'listening' && r.live === 1 && b2.label === 'MIC: LISTENING', detail: JSON.stringify({ b0: b0.label, b1: b1.label, head, m, r }) }
  })
  await check(label + 'MOCK xr: INJECTED left-thumbstick click (button 3) toggles mute / resume', async () => {
    const press = (down) => E((d) => { const s = window.__fakeXr.session; const mk = (h, btn) => ({ handedness: h, gamepad: { axes: [0, 0, 0, 0], buttons: btn.map((b) => ({ pressed: b })), hapticActuators: [] } }); s.inputSources = [mk('left', [false, false, false, d, false, false]), mk('right', [false, false, false, false, false, false])]; for (let i = 0; i < 3; i++) window.__vrEngine.tick(0.05) }, down)
    await press(true); await press(false)
    const muted = (await hf()).phase
    await press(true); await press(false)
    await wait(() => window.__vrEngine.handsFree.status.phase === 'listening')
    const back = await hf()
    return { ok: muted === 'muted' && back.phase === 'listening' && back.live === 1, detail: JSON.stringify({ muted, back }) }
  })
  await check(label + 'MOCK xr: panel and pill textures drawn (MIC button + status pill) - images saved for review', async () => {
    const urls = await E(() => ({ panel: window.__vrEngine.panelCtx.canvas.toDataURL('image/png'), hud: window.__vrEngine.hudCtx.canvas.toDataURL('image/png') }))
    fs.writeFileSync(path.join(OUT, `${FX}_vr_panel_texture_with_mic_button.png`), Buffer.from(urls.panel.split(',')[1], 'base64'))
    fs.writeFileSync(path.join(OUT, `${FX}_vr_status_pill_texture.png`), Buffer.from(urls.hud.split(',')[1], 'base64'))
    return { ok: urls.panel.length > 5000 && urls.hud.length > 500 }
  })
  await check(label + 'MOCK xr: Exit VR stops listening: recognizer aborted (0 live), status off, pill hidden; a late result from the old recognizer is ignored; nothing restarts', async () => {
    await E(() => window.__vrEngine.state.setAllLights(false, 'code'))
    await pg.click('[data-testid=exit-vr]', { timeout: 180000 })
    await wait(() => window.__vrEngine.mode === 'desktop')
    await pg.waitForTimeout(200)
    const r = await hf(); const startsAfterExit = r.starts
    await E(() => { const i = window.__vf.instances[window.__vf.instances.length - 1]; i.onresult && i.onresult({ results: [Object.assign([{ transcript: 'turn on all lights', confidence: 0.9 }], { isFinal: true })], resultIndex: 0 }) })
    await pg.waitForTimeout(2500)
    const r2 = await hf()
    const ignored = await E(() => window.__vrEngine.state.lights.rooms.every((x) => !window.__vrEngine.state.lights.isOn(x.key)))
    return { ok: r.phase === 'off' && r.live === 0 && !r.hudVisible && ignored && r2.starts === startsAfterExit && r2.live === 0, detail: JSON.stringify({ r, r2, ignored }) }
  })
  await check(label + 'MOCK xr: re-enter VR: listening resumes with exactly one new recognizer and commands work again', async () => {
    const g0 = await E(() => window.__vf.gumCalls)
    await pg.click('[data-testid=enter-vr]', { timeout: 180000 })
    await wait(() => window.__vrEngine.mode === 'vr')
    await wait(() => window.__vrEngine.handsFree.status.phase === 'listening')
    const r = await hf()
    await say('turn on all lights')
    const on = await E(() => window.__vrEngine.state.lights.rooms.every((x) => window.__vrEngine.state.lights.isOn(x.key)))
    return { ok: r.live === 1 && r.gum === g0 + 1 && on && r.hudVisible, detail: JSON.stringify(r) }
  })
  await check(label + 'MOCK xr: microphone permission REVOKED while listening: recognizer stopped, status denied, nothing retries', async () => {
    await E(() => { window.__vf.permState = 'denied'; window.__vf.permStatus.onchange && window.__vf.permStatus.onchange() })
    await wait(() => window.__vrEngine.handsFree.status.phase === 'denied', null, 30000)
    const r = await hf(); await pg.waitForTimeout(3000); const r2 = await hf()
    await E(() => { window.__vf.permState = 'granted' })
    return { ok: r.live === 0 && /permission/i.test(r.hud) && r2.starts === r.starts, detail: JSON.stringify({ r, r2 }) }
  })
  await check(label + 'MOCK xr: Exit and re-enter with the microphone REFUSED: graceful fallback (status denied, pill says so, no recognizer, no retry loop); the panel, switches-style controls and typed commands still work', async () => {
    await pg.click('[data-testid=exit-vr]', { timeout: 180000 }); await wait(() => window.__vrEngine.mode === 'desktop')
    await E(() => { window.__vf.gum = 'denied' })
    await pg.click('[data-testid=enter-vr]', { timeout: 180000 }); await wait(() => window.__vrEngine.mode === 'vr')
    await wait(() => window.__vrEngine.handsFree.status.phase === 'denied', null, 60000)
    const r = await hf(); await pg.waitForTimeout(4000); const r2 = await hf()
    const head = await E(() => window.__vrEngine.panel.voice.headline)
    // everything manual keeps working inside VR: the panel's light button and a typed command
    await E(() => { const e = window.__vrEngine; e.state.setAllLights(false, 'code'); const b = e.layout.buttons.find((x) => x.id === 'allOn'); e.runAction(b.action) })
    const panelOk = await E(() => window.__vrEngine.state.lights.rooms.every((x) => window.__vrEngine.state.lights.isOn(x.key)))
    const typed = await E(() => { const e = window.__vrEngine; e.handleCommand('turn off all lights'); return e.state.lights.rooms.every((x) => !e.state.lights.isOn(x.key)) })
    const mic = await E(() => window.__vrEngine.layout.buttons.find((b) => b.id === 'mic').label)
    return { ok: r.phase === 'denied' && r.live === 0 && /permission/i.test(r.hud) && r2.starts === r.starts && /unavailable/i.test(head) && panelOk && typed, detail: JSON.stringify({ r, r2, head, mic }) }
  })
  await check(label + 'MOCK xr: after the person allows the microphone again, MIC (resume) starts listening again', async () => {
    await E(() => { window.__vf.gum = 'granted' })
    await E(() => { window.__vrEngine.runAction({ t: 'mic' }) })
    await wait(() => window.__vrEngine.handsFree.status.phase === 'listening', null, 60000)
    const r = await hf()
    return { ok: r.live === 1, detail: JSON.stringify(r) }
  })
  await pg.click('[data-testid=exit-vr]', { timeout: 180000 }).catch(() => {})
  await check(label + 'no uncaught page errors during the voice scenarios', async () => ({ ok: pg.__errors.length === 0, detail: pg.__errors.slice(0, 3).join(' | ') }))
  await ctx.close()

  // ======================================================================== page 2: browser WITHOUT speech recognition
  const p2 = await openViewer(browser, tok, id, { speech: false })
  const E2 = (fn, arg) => p2.pg.evaluate(fn, arg)
  await E2(() => { window.__vrEngine.renderer.xr.setSession = async () => {} })
  await check(label + 'MOCK xr, browser WITHOUT SpeechRecognition: Enter VR shows "Voice recognition unsupported" (pill + panel), creates no recognizer, never asks for the microphone; the MIC button is disabled; typed commands and the panel still work', async () => {
    await p2.pg.click('[data-testid=enter-vr]', { timeout: 180000 })
    await p2.pg.waitForFunction(() => window.__vrEngine.mode === 'vr', null, { timeout: 90000 })
    await p2.pg.waitForFunction(() => window.__vrEngine.handsFree.status.phase === 'unsupported', null, { timeout: 60000 })
    await p2.pg.waitForTimeout(2000)
    const r = await E2(() => { const e = window.__vrEngine; return { hud: e.hudText, vis: e.hud.visible, gum: window.__vf.gumCalls, n: window.__vf.instances.length, mic: e.layout.buttons.find((b) => b.id === 'mic'), head: e.panel.voice.headline } })
    const typed = await E2(() => { const e = window.__vrEngine; e.state.setAllLights(false, 'code'); e.handleCommand('turn on all lights'); return e.state.lights.rooms.every((x) => e.state.lights.isOn(x.key)) })
    await E2(() => { window.__vrEngine.pushToTalk() })      // B button path
    const after = await E2(() => ({ n: window.__vf.instances.length, gum: window.__vf.gumCalls }))
    return { ok: /unsupported/i.test(r.hud) && r.vis && r.gum === 0 && r.n === 0 && r.mic.kind === 'disabled' && r.mic.label === 'MIC: N/A' && typed && after.n === 0 && after.gum === 0, detail: JSON.stringify({ r, typed, after }) }
  })
  await p2.ctx.close()
  await browser.close()
  console.log(JSON.stringify(results))
})().catch((e) => { console.error(e); console.log(JSON.stringify({ ...results, fatal: String(e && e.message || e) })); process.exit(1) })
