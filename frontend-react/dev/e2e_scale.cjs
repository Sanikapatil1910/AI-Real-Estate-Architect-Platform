/**
 * Human-scale regression (run by tests/test_vr_webxr.py).  Measures the model the VR scene really shows and compares it with reference dimensions of a residential building.
 *   node dev/e2e_scale.cjs <baseUrl> <fixture>[,<fixture>...] <outDir>
 * Prints {executed:[...]}.  Real headless Chromium; no headset.  A pass means "the model's proportions are human-scale",
 * NOT "the headset shows the right size": floor calibration on a real Quest cannot be tested here.
 */
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path')
const [BASE, FIXTURES, OUT] = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })
const results = { executed: [] }
const rec = (name, ok, detail = '') => results.executed.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) })
// reference dimensions, metres (typical residential building codes / ergonomics; deliberately wide: this catches a x0.3048 or x3.28 error, not taste)
const REF = {
  floorToFloor: [2.7, 3.4], clearCeiling: [2.4, 3.2],
  doorH: [1.9, 2.4], doorW: [0.6, 1.6],
  roomMinSide: [0.9, 99], roomMaxSide: [2.5, 16],
  riser_mm: [120, 200], tread_mm: [220, 330],
  seat: { sofa: [0.3, 0.65], chair: [0.35, 0.6], bed: [0.4, 0.75] },
  eye: [1.5, 1.8],
}
;(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const pg = await browser.newPage()
  await pg.goto(`${BASE}/dev/vr_load.html`)
  await pg.waitForFunction(() => typeof window.__dims === 'function', null, { timeout: 120000 })
  const inR = (v, [a, b]) => v >= a && v <= b
  for (const fx of FIXTURES.split(',')) {
    try {
      const d = await pg.evaluate((n) => window.__dims(n), fx)
      const L = `[${fx}] `
      rec(L + 'floor-to-floor height is a real storey height', inR(d.floorToFloor_m, REF.floorToFloor), `${d.floorToFloor_m} m`)
      rec(L + 'clear ceiling height is human-scale', inR(d.clearCeiling_m, REF.clearCeiling), `${d.clearCeiling_m} m`)
      rec(L + 'every door leaf is about door height and width', d.doors.n === 0 || (inR(d.doors.hMin, REF.doorH) && inR(d.doors.hMax, REF.doorH) && inR(d.doors.wMin, REF.doorW) && inR(d.doors.wMax, REF.doorW)), JSON.stringify(d.doors))
      rec(L + 'room sizes are room-sized (smallest and largest side)', d.rooms.minSide >= REF.roomMinSide[0] && inR(d.rooms.maxSide, REF.roomMaxSide), JSON.stringify(d.rooms))
      rec(L + 'stair risers and treads are comfortable', !d.stairs || !d.stairs.rise_mm || (inR(d.stairs.rise_mm, REF.riser_mm) && (!d.stairs.tread_mm || inR(d.stairs.tread_mm, REF.tread_mm))), JSON.stringify(d.stairs))
      rec(L + 'a door is shorter than the ceiling and taller than an adult', d.doors.n === 0 || (d.doors.hMax < d.clearCeiling_m && d.doors.hMin > 1.85), `${d.doors.hMax} < ${d.clearCeiling_m}`)
    } catch (e) { rec(`[${fx}] dimension probe`, false, e.message) }
  }
  await browser.close()

  // the runtime scale chain: ONE uniform scale feet -> metres on the house, rig scale 1, eye 1.62 m, floor on the ground (y = 0), XR reference space local-floor
  const email = `sc${Date.now()}@example.com`
  const api = async (p, opt = {}) => { const r = await fetch(BASE + p, { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) } }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
  await api('/auth/signup', { method: 'POST', body: JSON.stringify({ full_name: 'Scale', email, password: 'Passw0rd!x', role: 'home_owner' }) })
  const tok = (await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!x' }) })).access_token
  const fx = FIXTURES.split(',')[0]
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', fx + '.json'), 'utf8'))
  const p = await api('/projects', { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ name: 'scale', kind: 'generated', style: 'Modern', data: { plan } }) })
  const ctx = await (await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })).newContext({ viewport: { width: 1200, height: 800 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('rea.token', t) } catch {} }, tok)
  const v = await ctx.newPage()
  await v.goto(`${BASE}/app/vr/${p.id}?vrdebug=1`)
  await v.waitForFunction(() => !!window.__vrEngine, null, { timeout: 180000 })
  const r = await v.evaluate(() => {
    const e = window.__vrEngine; e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true); e.home.updateMatrixWorld(true)
    const V = e.camera.position.constructor
    const eye = e.camera.getWorldPosition(new V()).y
    const floorY = e.foot.y * 0.3048
    const seats = {}; for (const q of (e.house.seats || [])) if (q.measured) (seats[q.kind] ||= []).push(+((q.seatY - q.floorY) * 0.3048).toFixed(3))
    return { seats, homeScale: e.home.scale.toArray(), rigScale: e.rig.scale.toArray(), eye, eyeAboveFloor: eye - floorY, eyeOffset: e.eyeOffset, ref: e.renderer.xr.getReferenceSpace ? 'three-xr' : '' }
  })
  rec('runtime: the house is scaled ONCE, uniformly, feet to metres (0.3048)', r.homeScale.every((s) => Math.abs(s - 0.3048) < 1e-9), JSON.stringify(r.homeScale))
  rec('runtime: the player rig is not scaled (an XR rig scale would silently resize the world)', r.rigScale.every((s) => s === 1), JSON.stringify(r.rigScale))
  rec('runtime: desktop eye height above the floor is a human eye height', inR(r.eyeAboveFloor, REF.eye), `${r.eyeAboveFloor.toFixed(3)} m`)
  rec('runtime: no extra eye offset is added in VR (the headset reports its own height above the floor)', r.eyeOffset === 0, String(r.eyeOffset))
  const seatsOk = Object.entries(r.seats).every(([k, a]) => !REF.seat[k] || a.every((h) => inR(h, REF.seat[k])))
  rec('runtime: seat heights measured from the furniture geometry are seat heights (sit-down eye position depends on them)', Object.keys(r.seats).length > 0 && seatsOk, JSON.stringify(Object.fromEntries(Object.entries(r.seats).map(([k, a]) => [k, [Math.min(...a), Math.max(...a), a.length]]))))
  await v.close()
  console.log(JSON.stringify(results))
  process.exit(0)
})().catch((e) => { console.error('E2E crashed:', e); process.exit(2) })
