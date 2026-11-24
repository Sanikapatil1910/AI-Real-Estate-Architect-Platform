/**
 * Unit tests of the hands-free voice lifecycle (src/vr/continuousVoice.ts) with a FAKE recognizer, fake permissions and a virtual clock, run through
 * tests/test_vr_webxr.py (esbuild -> node).  Nothing here touches a browser, a microphone or a headset: it proves the lifecycle logic, not real speech recognition.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContinuousVoice, splitWake, hudInfo, RESTART_BASE_MS, MAX_QUICK_ENDS, DUPLICATE_WINDOW_MS, WAKE_ARMED_MS, QUICK_RUN_MS } from '../src/vr/continuousVoice'
import type { VcEnv, VcStatus, VcExecResult } from '../src/vr/continuousVoice'
import { SmartHouseState } from '../src/vr/smart/state'
import { PanelModel, layoutPanel, runPanelAction } from '../src/vr/smart/panel'
import { VoiceStatusBoard } from '../src/vr/smart/voice'
import { parseSmartHouse } from '../src/vr/smart/document'
import { buildSmartHouse } from '../src/lib/smartHouse'
import { projectPlan } from './project_plan'

const tests: Array<[string, () => void | Promise<void>]> = []
const test = (n: string, f: () => void | Promise<void>) => tests.push([n, f])
const FIX = process.env.VR_FIXTURES ?? join(__dirname, 'fixtures')
const loadPlan = (f: string) => { const p = JSON.parse(readFileSync(join(FIX, f), 'utf8')); return p.plan ?? p }
const newState = (f = 'g2_0.json') => SmartHouseState.fromDocument(parseSmartHouse(JSON.parse(JSON.stringify(buildSmartHouse(loadPlan(f), projectPlan)))))

// ------------------------------------------------------------------ fakes
class FakeRec {
  static all: FakeRec[] = []
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 1
  onstart: (() => void) | null = null; onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onresult: ((e: any) => void) | null = null
  started = false; aborted = false; ended = false
  constructor() { FakeRec.all.push(this) }
  start() { if (this.started && !this.ended) throw new Error('InvalidStateError'); this.started = true }
  stop() { this.ended = true }
  abort() { this.aborted = true; this.ended = true; this.onend?.() }          // like a real recognizer: abort() is followed by an 'end' event
  // test drivers
  fireStart() { this.onstart?.() }
  fireEnd() { this.ended = true; this.onend?.() }
  fireError(code: string) { this.onerror?.({ error: code }) }
  /** results: list of [text, isFinal, confidence?]; resultIndex = first of them */
  fireResults(items: Array<[string, boolean, number?]>, resultIndex = 0, total?: Array<[string, boolean, number?]>) {
    const all = (total ?? items).map(([t, f, c]) => Object.assign([{ transcript: t, confidence: c }], { isFinal: f }))
    this.onresult?.({ results: all, resultIndex })
  }
}
interface Timer { at: number; fn: () => void; id: number }
function makeEnv(opts: { speech?: boolean; perm?: 'granted' | 'denied' | 'prompt-deny' | 'notfound' | 'noapi'; gum?: () => Promise<any> } = {}) {
  FakeRec.all = []
  let clock = 1_000_000, nextId = 1
  const timers: Timer[] = []
  const calls = { gum: 0, tracksStopped: 0, permQuery: 0 }
  let onchange: (() => void) | null = null
  const permStatus: any = { state: opts.perm === 'denied' ? 'denied' : 'granted', get onchange() { return onchange }, set onchange(v) { onchange = v } }
  const nav: any = {
    userAgent: 'Mozilla/5.0 (X11; Linux) Chrome',
    permissions: opts.perm === 'noapi' ? undefined : { query: async () => { calls.permQuery++; return permStatus } },
    mediaDevices: {
      getUserMedia: opts.gum ?? (async () => {
        calls.gum++
        if (opts.perm === 'prompt-deny') { const e: any = new Error('denied'); e.name = 'NotAllowedError'; throw e }
        if (opts.perm === 'notfound') { const e: any = new Error('none'); e.name = 'NotFoundError'; throw e }
        return { getTracks: () => [{ stop: () => { calls.tracksStopped++ } }] }
      }),
    },
  }
  const win: any = { isSecureContext: true }
  if (opts.speech !== false) win.SpeechRecognition = FakeRec
  const env: VcEnv = {
    win, nav,
    setTimeout: (fn, ms) => { const t = { at: clock + ms, fn, id: nextId++ }; timers.push(t); return t.id },
    clearTimeout: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1) },
    now: () => clock,
  }
  const advance = (ms: number) => {
    const end = clock + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const t = timers[0]
      if (!t || t.at > end) break
      timers.shift(); clock = Math.max(clock, t.at); t.fn()
    }
    clock = end
  }
  return { env, advance, timers, calls, permStatus, nowMs: () => clock, fireRevoke: () => { permStatus.state = 'denied'; onchange?.() } }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

function makeVoice(o: Parameters<typeof makeEnv>[0] = {}, exec?: (t: string) => VcExecResult, wake?: 'optional' | 'required') {
  const e = makeEnv(o)
  const log: string[] = []
  const statuses: VcStatus[] = []
  const v = new ContinuousVoice({ env: e.env, execute: (t) => { log.push(t); return exec ? exec(t) : { understood: true, changed: true, message: 'ok ' + t } }, onStatus: (s) => statuses.push(s), wake })
  const rec = () => FakeRec.all[FakeRec.all.length - 1]
  const live = () => FakeRec.all.filter((r) => !r.ended)
  return { ...e, v, log, statuses, rec, live }
}
async function started(o: Parameters<typeof makeEnv>[0] = {}, wake?: 'optional' | 'required') {
  const h = makeVoice(o, undefined, wake)
  await h.v.start(); await flush()
  h.rec()?.fireStart()
  return h
}
const final = (h: { rec: () => FakeRec; advance: (n: number) => void }, text: string, idx = 0, conf?: number) => { h.rec().fireResults([[text, true, conf]], idx, Array.from({ length: idx + 1 }, (_, i) => (i === idx ? [text, true, conf] : ['·', true]) as [string, boolean, number?])) }

// ------------------------------------------------------------------ start / permission / support
test('entering VR: explicit microphone request, stream released immediately, ONE continuous recognizer, status "listening"', async () => {
  const h = await started()
  assert.equal(h.calls.gum, 1); assert.equal(h.calls.tracksStopped, 1)
  assert.equal(FakeRec.all.length, 1); assert.equal(h.rec().continuous, true); assert.equal(h.rec().interimResults, true); assert.ok(h.rec().started)
  assert.equal(h.v.status.phase, 'listening'); assert.equal(h.v.active, true)
  assert.ok(h.statuses.some((s) => s.phase === 'starting'), 'a "starting / asking for the microphone" status was shown first')
})
test('start() twice (or a second Enter VR) never creates a second recognizer', async () => {
  const h = await started()
  await h.v.start(); await flush(); await h.v.start(); await flush()
  assert.equal(h.live().length, 1); assert.equal(h.v.instancesCreated, 1)
})
test('unsupported browser: status "unsupported", no permission request, no recognizer, no timers (no restart loop)', async () => {
  const h = makeVoice({ speech: false })
  await h.v.start(); await flush()
  assert.equal(h.v.status.phase, 'unsupported'); assert.match(h.v.status.detail, /speech recognition/i)
  assert.equal(h.calls.gum, 0); assert.equal(FakeRec.all.length, 0); assert.equal(h.timers.length, 0); assert.equal(h.v.supported, false)
})
test('permission refused at the prompt: "denied", no recognizer, nothing retries by itself (60 s of virtual time)', async () => {
  const h = makeVoice({ perm: 'prompt-deny' })
  await h.v.start(); await flush()
  assert.equal(h.v.status.phase, 'denied'); assert.equal(FakeRec.all.length, 0)
  h.advance(60_000); assert.equal(FakeRec.all.length, 0); assert.equal(h.calls.gum, 1); assert.equal(h.timers.length, 0)
})
test('permission already blocked in the browser: "denied" without even prompting', async () => {
  const h = makeVoice({ perm: 'denied' })
  await h.v.start(); await flush()
  assert.equal(h.v.status.phase, 'denied'); assert.equal(h.calls.gum, 0); assert.equal(FakeRec.all.length, 0)
})
test('no microphone device: "unavailable" with a reason, no recognizer', async () => {
  const h = makeVoice({ perm: 'notfound' })
  await h.v.start(); await flush()
  assert.equal(h.v.status.phase, 'unavailable'); assert.match(h.v.status.detail, /No microphone/); assert.equal(FakeRec.all.length, 0)
})
test('no Permissions API (older / headset browsers): falls back to asking directly', async () => {
  const h = await started({ perm: 'noapi' })
  assert.equal(h.calls.gum, 1); assert.equal(h.v.status.phase, 'listening')
})
test('Quest Browser user agent is flagged and the unsupported message says it is unverified there', async () => {
  const e = makeEnv({ speech: false }); (e.env.nav as any).userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit OculusBrowser/30.0 Chrome/120 VR Mobile Safari'
  const v = new ContinuousVoice({ env: e.env, execute: () => ({ understood: false, changed: false, message: '' }), onStatus: () => {} })
  await v.start(); assert.equal(v.status.quest, true); assert.match(v.status.detail, /not verified/)
})

// ------------------------------------------------------------------ results
test('only FINAL results run: interim speech is shown as "partial" and never executed', async () => {
  const h = await started()
  h.rec().fireResults([['turn on the living', false]]); assert.equal(h.log.length, 0); assert.equal(h.v.status.partial, 'turn on the living')
  h.rec().fireResults([['turn on the living room lights', false]]); assert.equal(h.log.length, 0)
  h.rec().fireResults([['turn on the living room lights', true, 0.9]]); assert.deepEqual(h.log, ['turn on the living room lights']); assert.equal(h.v.status.partial, '')
})
test('a result that the engine re-delivers (same index) is executed once', async () => {
  const h = await started()
  const r = h.rec()
  r.fireResults([['turn on all lights', true]], 0); r.fireResults([['turn on all lights', true]], 0); r.fireResults([['turn on all lights', true]], 0)
  assert.equal(h.log.length, 1)
})
test('the same phrase twice within 1.5 s runs once; after the window it runs again; a different phrase runs at once', async () => {
  const h = await started()
  final(h, 'turn on all lights', 0); final(h, 'turn on all lights', 1); assert.equal(h.log.length, 1)
  final(h, 'turn off all lights', 2); assert.equal(h.log.length, 2)
  h.advance(DUPLICATE_WINDOW_MS + 100); final(h, 'turn off all lights', 3); assert.equal(h.log.length, 3)
})
test('low-confidence results (noise) are ignored; unreported confidence (0) is accepted', async () => {
  const h = await started()
  final(h, 'turn on all lights', 0, 0.12); assert.equal(h.log.length, 0)
  final(h, 'turn on all lights', 1, 0); assert.equal(h.log.length, 1)
})
test('everyday chatter that is not a Smart Home command is ignored silently (not executed, no "not understood" noise)', async () => {
  const h = await started()
  final(h, 'what time is dinner tonight', 0); final(h, 'yeah I will call you later', 1)
  assert.equal(h.log.length, 0); assert.equal(h.v.status.result, null)
})
test('a device word that cannot be parsed ("fan something") IS surfaced as not understood so the person sees feedback', async () => {
  const st = newState()
  const h = makeVoice({}, (t) => { const r = st.execute(t); return { understood: r.understood, changed: r.changed, message: r.message } })
  await h.v.start(); await flush(); h.rec().fireStart()
  final(h, 'the fan is so noisy', 0)
  assert.equal(h.log.length, 1); assert.equal(h.v.status.result?.understood, false)
})
test('the outcome is shown for 3 s, then the status returns to plain "listening"', async () => {
  const h = await started()
  final(h, 'turn on all lights', 0)
  assert.equal(h.v.status.phase, 'listening'); assert.ok(h.v.status.result); assert.equal(h.v.status.heard, 'turn on all lights')
  assert.ok(h.statuses.some((s) => s.phase === 'processing'))
  h.advance(3100); assert.equal(h.v.status.result, null)
})
test('an exception inside the command pipeline does not kill listening', async () => {
  const h = makeVoice({}, () => { throw new Error('boom') })
  await h.v.start(); await flush(); h.rec().fireStart()
  final(h, 'turn on all lights', 0)
  assert.equal(h.v.status.phase, 'listening'); assert.equal(h.v.status.result?.understood, false)
  final(h, 'turn off all lights', 1); assert.equal(h.log.length, 2)
})

// ------------------------------------------------------------------ wake phrase
test('splitWake: "Hey, Home!" at the start is stripped; elsewhere / partial words are not wake phrases', () => {
  assert.deepEqual(splitWake('Hey Home, turn on the living room lights.'), { woke: true, rest: 'turn on the living room lights' })
  assert.deepEqual(splitWake('OK home turn off all lights'), { woke: true, rest: 'turn off all lights' })
  assert.deepEqual(splitWake('hey home'), { woke: true, rest: '' })
  assert.deepEqual(splitWake('turn on the lights at home'), { woke: false, rest: 'turn on the lights at home' })
  assert.deepEqual(splitWake('hey homer turn on all lights'), { woke: false, rest: 'hey homer turn on all lights' })
})
test('wake phrase is OPTIONAL by default: a plain command runs, and "Hey Home, <command>" runs with the wake phrase stripped', async () => {
  const h = await started()
  final(h, 'turn on the kitchen lights', 0); final(h, 'Hey Home, turn on the living room lights', 1)
  assert.deepEqual(h.log, ['turn on the kitchen lights', 'turn on the living room lights'])
})
test('wake phrase REQUIRED (opt-in): plain commands are ignored, "Hey Home <command>" runs, "Hey Home" alone arms the next phrase for 8 s', async () => {
  const h = await started({}, 'required')
  final(h, 'turn on all lights', 0); assert.equal(h.log.length, 0)
  final(h, 'hey home turn on all lights', 1); assert.equal(h.log.length, 1)
  final(h, 'hey home', 2); assert.equal(h.v.status.armed, true)
  final(h, 'turn off all lights', 3); assert.equal(h.log.length, 2); assert.equal(h.v.status.armed, false)
  final(h, 'turn on all lights', 4); assert.equal(h.log.length, 2, 'armed only once')
  final(h, 'hey home', 5); h.advance(WAKE_ARMED_MS + 200); assert.equal(h.v.status.armed, false)
  final(h, 'turn off the kitchen lights', 6); assert.equal(h.log.length, 2)
})
test('switching the wake mode while listening takes effect at once', async () => {
  const h = await started()
  h.v.setWake('required'); final(h, 'turn on all lights', 0); assert.equal(h.log.length, 0)
  h.v.setWake('optional'); final(h, 'turn off all lights', 1); assert.equal(h.log.length, 1)
})

// ------------------------------------------------------------------ restart / recovery
test('an unexpected end restarts after the base delay with a NEW single instance; the old one never runs together with it', async () => {
  const h = await started()
  const first = h.rec()
  final(h, 'turn on all lights', 0)                      // a result was heard: not a "quick end"
  first.fireEnd(); assert.equal(h.live().length, 0)
  h.advance(RESTART_BASE_MS - 1); assert.equal(FakeRec.all.length, 1)
  h.advance(2); assert.equal(FakeRec.all.length, 2); assert.equal(h.live().length, 1)
  h.rec().fireStart(); assert.equal(h.v.status.phase, 'listening')
  final(h, 'turn off all lights', 0); assert.equal(h.log.length, 2, 'recognition recovered and commands work again')
})
test('silence ("no-speech") and "aborted" errors are normal: the recognizer is restarted, status stays listening', async () => {
  const h = await started()
  h.advance(5000)                                         // a long quiet run is not a quick end
  h.rec().fireError('no-speech'); h.rec().fireEnd(); h.advance(RESTART_BASE_MS + 10)
  assert.equal(FakeRec.all.length, 2); assert.equal(h.v.status.phase, 'listening')
})
test('repeated quick ends back off (300, 300, 600, 1200 ...) and finally GIVE UP: status "stopped", no more recognizers, Resume offered', async () => {
  const h = await started()
  const delays: number[] = []
  for (let i = 0; i < MAX_QUICK_ENDS + 3; i++) {
    const r = h.rec(); if (r.ended) break
    r.fireEnd()
    if (h.v.status.phase === 'stopped') break
    const t0 = h.nowMs(); let waited = 0
    while (FakeRec.all.filter((x) => !x.ended).length === 0 && waited < 20_000) { h.advance(50); waited += 50 }
    delays.push(h.nowMs() - t0)
    h.rec()?.fireStart()
  }
  assert.equal(h.v.status.phase, 'stopped'); assert.match(h.v.status.detail, /Resume/)
  assert.ok(delays[2] >= delays[0] * 2 - 60, `back-off grows: ${delays}`)
  const n = FakeRec.all.length; h.advance(120_000); assert.equal(FakeRec.all.length, n, 'no recognizer is created after giving up'); assert.equal(h.timers.length, 0)
  assert.ok(n <= MAX_QUICK_ENDS + 1)
})
test('a heard result resets the quick-end counter (a slow flaky network does not kill listening)', async () => {
  const h = await started()
  for (let i = 0; i < MAX_QUICK_ENDS * 2; i++) {
    final(h, i % 2 ? 'turn on all lights' : 'turn off all lights', 0); h.advance(DUPLICATE_WINDOW_MS + 50)
    h.rec().fireEnd(); h.advance(RESTART_BASE_MS + 10); h.rec().fireStart()
  }
  assert.equal(h.v.status.phase, 'listening')
})
test('browser errors: not-allowed / service-not-allowed => "denied", audio-capture => "unavailable"; neither restarts (no infinite loop)', async () => {
  for (const [code, phase] of [['not-allowed', 'denied'], ['service-not-allowed', 'denied'], ['audio-capture', 'unavailable'], ['language-not-supported', 'unavailable']] as const) {
    const h = await started()
    h.rec().fireError(code); h.rec().fireEnd()
    assert.equal(h.v.status.phase, phase, code)
    const n = FakeRec.all.length; h.advance(60_000); assert.equal(FakeRec.all.length, n, code + ': no restart'); assert.equal(h.timers.length, 0)
  }
})
test('"network" errors retry with back-off but count toward the give-up limit', async () => {
  const h = await started()
  for (let i = 0; i < 12 && h.v.status.phase !== 'stopped'; i++) {
    h.rec().fireError('network'); h.rec().fireEnd(); h.advance(6000); h.rec()?.fireStart()
  }
  assert.equal(h.v.status.phase, 'stopped')
})
test('permission revoked while listening (Permissions API onchange): recognizer aborted, "denied", no restart', async () => {
  const h = await started()
  const r = h.rec(); h.fireRevoke()
  assert.equal(h.v.status.phase, 'denied'); assert.ok(r.aborted); assert.equal(h.live().length, 0)
  h.advance(30_000); assert.equal(FakeRec.all.length, 1)
})

// ------------------------------------------------------------------ stop / mute / resume / re-enter
test('leaving VR: recognizer aborted, status "off", timers cleared, and a late result from the old recognizer is IGNORED', async () => {
  const h = await started()
  final(h, 'turn on all lights', 0)
  const r = h.rec(); h.v.stop()
  assert.ok(r.aborted); assert.equal(h.v.status.phase, 'off'); assert.equal(h.v.active, false); assert.equal(h.live().length, 0); assert.equal(h.v.activeInstances, 0); assert.equal(h.timers.length, 0)
  r.fireResults([['turn off all lights', true]]); r.fireEnd(); h.advance(30_000)
  assert.equal(h.log.length, 1); assert.equal(FakeRec.all.length, 1, 'nothing restarts after leaving VR')
})
test('leaving VR while the permission prompt is still open: no recognizer is ever created', async () => {
  let release: (v: any) => void = () => {}
  const h = makeVoice({ gum: () => new Promise((res) => { release = res }) })
  const p = h.v.start(); await flush()
  h.v.stop()
  release({ getTracks: () => [] }); await p; await flush()
  assert.equal(FakeRec.all.length, 0); assert.equal(h.v.status.phase, 'off')
})
test('re-entering VR after leaving: listening resumes with exactly one new recognizer', async () => {
  const h = await started()
  h.v.stop(); await h.v.start(); await flush(); h.rec().fireStart()
  assert.equal(h.v.status.phase, 'listening'); assert.equal(h.live().length, 1); assert.equal(FakeRec.all.length, 2)
  final(h, 'turn on all lights', 0); assert.equal(h.log.length, 1)
})
test('mute releases the recognizer and nothing restarts it; resume asks again and listens again', async () => {
  const h = await started()
  const r = h.rec(); h.v.mute()
  assert.equal(h.v.status.phase, 'muted'); assert.ok(r.aborted); assert.equal(h.v.active, false)
  r.fireEnd(); h.advance(60_000); assert.equal(FakeRec.all.length, 1)
  r.fireResults([['turn on all lights', true]]); assert.equal(h.log.length, 0, 'a muted microphone runs nothing')
  await h.v.resume(); await flush(); h.rec().fireStart()
  assert.equal(h.v.status.phase, 'listening'); assert.equal(h.live().length, 1); assert.equal(h.calls.gum, 2)
  final(h, 'turn on all lights', 0); assert.equal(h.log.length, 1)
})
test('Resume after giving up or after a refusal starts a fresh attempt', async () => {
  const h = makeVoice({ perm: 'prompt-deny' })
  await h.v.start(); await flush(); assert.equal(h.v.status.phase, 'denied')
  const e2 = h  // the person fixes the permission in the browser settings
  ;(e2 as any).env.nav.mediaDevices.getUserMedia = async () => ({ getTracks: () => [] })
  await h.v.resume(); await flush(); h.rec().fireStart()
  assert.equal(h.v.status.phase, 'listening')
})
test('Resume when speech recognition is unsupported stays "unsupported" (no fake listening)', async () => {
  const h = makeVoice({ speech: false })
  await h.v.start(); await h.v.resume(); await flush()
  assert.equal(h.v.status.phase, 'unsupported'); assert.equal(FakeRec.all.length, 0)
})
test('across 20 enter / leave cycles there is never more than one live recognizer and none left at the end', async () => {
  const h = makeVoice()
  for (let i = 0; i < 20; i++) {
    await h.v.start(); await flush(); h.rec().fireStart(); assert.ok(h.live().length <= 1)
    if (i % 3 === 0) { h.rec().fireEnd(); h.advance(400) }
    assert.ok(h.live().length <= 1)
    h.v.stop(); assert.equal(h.live().length, 0)
  }
  assert.equal(h.v.activeInstances, 0)
})

// ------------------------------------------------------------------ real Smart House state (same state model as buttons / typed / controllers)
async function spoken(file = 'g2_0.json') {
  const st = newState(file)
  const h = makeVoice({}, (t) => { const r = st.execute(t); return { understood: r.understood, changed: r.changed, message: r.message } })
  await h.v.start(); await flush(); h.rec().fireStart()
  let idx = 0
  const say = (t: string) => { final(h, t, idx++); h.advance(DUPLICATE_WINDOW_MS + 100) }
  return { st, h, say }
}
test('room-specific lighting by voice, WITHOUT standing in the room: living room / kitchen / bedroom / all', async () => {
  const { st, say } = await spoken()
  st.currentRoomKey = '1:master_bedroom'                  // the person is upstairs, in none of the rooms they name
  const lr = st.lights.rooms.find((r) => r.type === 'living_room')!, kit = st.lights.rooms.find((r) => r.type === 'kitchen')!
  st.setAllLights(false, 'code')
  say('Turn on the living room lights.'); assert.equal(st.lights.isOn(lr.key), true); assert.equal(st.lights.isOn(kit.key), false)
  say('Turn on the kitchen lights'); assert.equal(st.lights.isOn(kit.key), true)
  say('Turn off the kitchen lights.'); assert.equal(st.lights.isOn(kit.key), false); assert.equal(st.lights.isOn(lr.key), true)
  const beds = st.lights.rooms.filter((r) => ['bedroom', 'master_bedroom', 'guest_bedroom'].includes(r.type))
  say('Turn on the bedroom lights.'); assert.ok(beds.length > 0 && beds.every((r) => st.lights.isOn(r.key)))
  say('Turn on all lights.'); assert.ok(st.lights.rooms.every((r) => st.lights.isOn(r.key)))
  say('Turn off all lights'); assert.ok(st.lights.rooms.every((r) => !st.lights.isOn(r.key)))
})
test('room-specific fan by voice without standing there: living room ON, speed 1..5, dining room OFF, and ON restores the last speed', async () => {
  const { st, say } = await spoken()
  st.currentRoomKey = '1:master_bedroom'
  const lr = st.lights.rooms.find((r) => r.type === 'living_room' && r.hasFan)!, din = st.lights.rooms.find((r) => r.type === 'dining' && r.hasFan)!
  assert.ok(lr && din, 'fixture has a living-room fan and a dining-room fan')
  say('Turn on the living room fan.'); assert.ok(st.fanLevel(lr.key) > 0)
  for (const n of [1, 2, 3, 4, 5]) { say(`Set the living room fan speed to ${n}.`); assert.equal(st.fanLevel(lr.key), n, `speed ${n}`) }
  say('Turn off the living room fan'); assert.equal(st.fanLevel(lr.key), 0)
  say('Turn on the living room fan'); assert.equal(st.fanLevel(lr.key), 5, 'ON restores the last speed')
  say('Set the dining room fan speed to 4'); assert.equal(st.fanLevel(din.key), 4); assert.equal(st.fanLevel(lr.key), 5, 'only the named fan changed')
  say('Turn off the dining room fan.'); assert.equal(st.fanLevel(din.key), 0)
  say('Set the living room fan speed to four'); assert.equal(st.fanLevel(lr.key), 4)
  say('Hey Home, set the dining room fan speed to 2'); assert.equal(st.fanLevel(din.key), 2)
})
test('several commands in a row (lights + fan + speeds) all land in order on the shared state', async () => {
  const { st, say } = await spoken()
  const lr = st.lights.rooms.find((r) => r.type === 'living_room' && r.hasFan)!
  st.setAllLights(false, 'code'); st.setFanLevel(lr.key, 0, 'code')
  say('turn on the living room lights'); say('turn on the living room fan'); say('set the living room fan speed to 3'); say('set the living room fan speed to 5'); say('turn off the living room lights')
  assert.equal(st.lights.isOn(lr.key), false); assert.equal(st.fanLevel(lr.key), 5)
})
test('an unknown / empty-fan room reports a clear message instead of changing something else', async () => {
  const { st, h, say } = await spoken()
  const before = st.fanKeys.map((k) => st.fanLevel(k))
  say('turn on the garage fan')
  assert.deepEqual(st.fanKeys.map((k) => st.fanLevel(k)), before)
  void h
})

// ------------------------------------------------------------------ status indicator + panel MIC button
test('status indicator text/tone for every state: listening, hearing, armed, processing, executed, not understood, muted, denied, unavailable, stopped, unsupported; off shows nothing', async () => {
  const h = await started()
  const base = h.v.status
  const t = (p: Partial<typeof base>) => hudInfo({ ...base, ...p })
  assert.equal(t({ phase: 'off' }), null)
  assert.deepEqual(t({ phase: 'listening' }), { text: 'Listening', tone: 'good' })
  assert.match(t({ phase: 'listening', partial: 'turn on the' })!.text, /^Hearing: turn on the/)
  assert.match(t({ phase: 'listening', wake: 'required' })!.text, /Hey Home/)
  assert.match(t({ phase: 'listening', armed: true })!.text, /say a command/)
  assert.equal(t({ phase: 'processing' })!.text, 'Processing command…')
  assert.deepEqual(t({ phase: 'listening', result: { understood: true, changed: true, message: 'Living room light ON' } }), { text: '✓ Living room light ON', tone: 'good' })
  assert.match(t({ phase: 'listening', result: { understood: false, changed: false, message: 'Not understood' } })!.text, /^\? /)
  assert.match(t({ phase: 'muted' })!.text, /muted/i)
  assert.match(t({ phase: 'denied' })!.text, /Microphone unavailable/)
  assert.match(t({ phase: 'unavailable' })!.text, /Microphone unavailable/)
  assert.match(t({ phase: 'stopped' })!.text, /retry/i)
  assert.match(t({ phase: 'unsupported' })!.text, /unsupported/i)
  assert.ok(t({ phase: 'listening', partial: 'x'.repeat(200) })!.text.length <= 46, 'long speech is cut to fit the pill')
})
test('panel MIC button: START / LISTENING / MUTED / N/A (disabled when unsupported), inside the panel and overlapping nothing, and its action is {t:"mic"}', () => {
  const st = newState(); const m = new PanelModel(st)
  const get = () => layoutPanel(m, st, { floors: 2, showExit: true }).buttons
  const labels: Record<string, string> = { off: 'MIC: START', on: 'MIC: LISTENING', muted: 'MIC: MUTED', unsupported: 'MIC: N/A' }
  for (const hf of ['off', 'on', 'muted', 'unsupported'] as const) {
    m.voice.handsFree = hf
    const b = get().find((x) => x.id === 'mic')!
    assert.equal(b.label, labels[hf]); assert.equal(b.kind, hf === 'unsupported' ? 'disabled' : hf === 'on' ? 'on' : hf === 'muted' ? 'off' : 'neutral')
    assert.deepEqual(b.action, hf === 'unsupported' ? null : { t: 'mic' })
    const all = get()
    assert.ok(b.x >= 0 && b.x + b.w <= 1024 && b.y >= 0 && b.y + b.h <= 880)
    for (const o of all) if (o.id !== b.id) assert.ok(b.x + b.w <= o.x || o.x + o.w <= b.x || b.y + b.h <= o.y || o.y + o.h <= b.y, `mic overlaps ${o.id}`)
  }
  m.voice.handsFree = 'on'
  assert.deepEqual(runPanelAction({ t: 'mic' }, m), { t: 'mic' }, 'the engine (not the model) handles the mic action')
})
test('status board: a muted microphone reads "Voice: muted"; hands-free listening reads "Listening..." and an executed command "Action completed"', () => {
  const b = new VoiceStatusBoard(); b.setBackend(true)
  b.onBackendState('muted'); assert.equal(b.headline, 'Voice: muted')
  b.onBackendState('listening'); assert.equal(b.headline, 'Listening...')
  b.onCommand('turn on all lights', { understood: true, changed: true, message: 'All 9 lights ON', roomKeys: ['a'] }); b.tick(0.6); assert.equal(b.headline, 'Action completed')
  b.onBackendState('permissionDenied', 'x'); b.tick(10); assert.equal(b.headline, 'Microphone unavailable')
})

const run = async () => {
  const failed: Array<{ name: string; error: string }> = []
  let passed = 0
  for (const [name, fn] of tests) { try { await fn(); passed++ } catch (e) { failed.push({ name, error: String((e as Error).message).slice(0, 500) }) } }
  console.log(JSON.stringify({ passed, total: tests.length, failed }))
  process.exit(failed.length ? 1 : 0)
}
void QUICK_RUN_MS
void run()
