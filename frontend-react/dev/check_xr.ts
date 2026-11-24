/** WebXR availability / fallback decisions with a FAKE navigator.xr (node only; nothing here talks to a headset). */
import assert from 'node:assert/strict'
import { detectXr } from '../src/vr/xrSupport'
import { detectVoice } from '../src/vr/voiceInput'

const tests: Array<[string, () => Promise<void> | void]> = []
const test = (n: string, f: () => Promise<void> | void) => tests.push([n, f])

test('supported: navigator.xr says immersive-vr is supported', async () => {
  const asked: string[] = []
  const s = await detectXr({ xr: { isSessionSupported: async (m) => { asked.push(m); return true }, requestSession: async () => ({}) } }, true)
  assert.equal(s.state, 'supported'); assert.deepEqual(asked, ['immersive-vr'])
})
test('no headset: WebXR exists but immersive-vr is not supported -> desktop fallback message', async () => {
  const s = await detectXr({ xr: { isSessionSupported: async () => false, requestSession: async () => ({}) } }, true)
  assert.equal(s.state, 'no-vr'); assert.match((s as { message: string }).message, /keyboard and mouse/)
})
test('no WebXR at all (navigator.xr missing) -> desktop fallback message', async () => {
  const s = await detectXr({}, true)
  assert.equal(s.state, 'no-webxr'); assert.match((s as { message: string }).message, /does not offer WebXR/)
  assert.equal((await detectXr(undefined, true)).state, 'no-webxr')
})
test('insecure page (plain http) -> says so and points at https, before touching navigator.xr', async () => {
  let touched = false
  const s = await detectXr({ xr: { isSessionSupported: async () => { touched = true; return true }, requestSession: async () => ({}) } }, false)
  assert.equal(s.state, 'insecure'); assert.match((s as { message: string }).message, /https/i); assert.equal(touched, false)
})
test('isSessionSupported throwing is reported, not swallowed', async () => {
  const s = await detectXr({ xr: { isSessionSupported: async () => { throw new Error('boom') }, requestSession: async () => ({}) } }, true)
  assert.equal(s.state, 'error'); assert.match((s as { message: string }).message, /boom/)
})
test('voice: no SpeechRecognition -> unavailable with a reason; webkit prefix or standard name -> available; insecure -> unavailable', () => {
  const a = detectVoice({}); assert.equal(a.available, false); assert.match(a.reason, /does not provide speech recognition/)
  assert.equal(detectVoice({ webkitSpeechRecognition: class {} }).available, true)
  assert.equal(detectVoice({ SpeechRecognition: class {} }).available, true)
  const c = detectVoice({ SpeechRecognition: class {}, isSecureContext: false }); assert.equal(c.available, false); assert.match(c.reason, /https/)
  assert.equal(detectVoice(undefined).available, false)
})

;(async () => {
  const failed: Array<{ name: string; error: string }> = []
  let passed = 0
  for (const [name, fn] of tests) { try { await fn(); passed++ } catch (e) { failed.push({ name, error: String((e as Error).message).slice(0, 300) }) } }
  console.log(JSON.stringify({ passed, total: tests.length, failed }))
  process.exit(failed.length ? 1 : 0)
})()
