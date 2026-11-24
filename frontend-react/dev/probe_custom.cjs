// quick probe: node dev/probe_custom.cjs <base> <fixture> <outDir>
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path')
const [BASE, FX, OUT] = process.argv.slice(2); fs.mkdirSync(OUT, { recursive: true })
const api = async (p, opt = {}) => { const r = await fetch(BASE + p, { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) } }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }
;(async () => {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', FX + '.json'), 'utf8'))
  const email = `p${Date.now()}@example.com`
  await api('/auth/signup', { method: 'POST', body: JSON.stringify({ full_name: 'P', email, password: 'Passw0rd!x', role: 'home_owner' }) })
  const tok = (await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!x' }) })).body.access_token
  const p = await api('/projects', { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ name: 'probe', kind: 'generated', style: plan.architectural_style || 'Modern', data: { plan } }) })
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('rea.token', t) } catch {} }, tok)
  const pg = await ctx.newPage(); const errs = []
  pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  await pg.goto(`${BASE}/app/vr/${p.body.id}?vrdebug=1`)
  await pg.waitForFunction(() => !!window.__vrEngine, null, { timeout: 180000 })
  await pg.waitForTimeout(800)
  const info = await pg.evaluate(() => {
    const e = window.__vrEngine, c = e.custom, a = c.applier
    return { rooms: a.rooms.map((r) => [r.key, r.type, r.x0, r.x1, r.z0, r.z1, r.y0, r.y1]).slice(0, 4), paths: a.rolePaths.map((p) => [p, a.meshesOf(p)]), faces: a.wallFaces().length, nroom: a.rooms.length }
  })
  console.log(JSON.stringify(info))
  const shot = async (n) => { await pg.waitForTimeout(600); await pg.locator('[data-testid=vr-stage]').screenshot({ path: path.join(OUT, n + '.png') }) }
  await pg.evaluate(() => { const e = window.__vrEngine; e.goToRoom('0:living_room'); e.yaw = 0.6; e.pitch = -0.05 })
  await shot('probe_before')
  const res = await pg.evaluate(() => {
    const c = window.__vrEngine.custom
    c.target = '0:living_room'
    c.perform({ t: 'wallColor', id: 'terracotta' }); c.perform({ t: 'accentSide', side: 'N' }); c.perform({ t: 'floor', id: 'granite_black' }); c.perform({ t: 'ceilColor', id: 'c_sky' })
    c.perform({ t: 'role', key: 'door', id: 'walnut' }); c.perform({ t: 'role', key: 'upholstery', id: 'camel' }); c.perform({ t: 'role', key: 'rugs', id: 'sage' })
    return { res: c.lastResult, msg: c.message, skins: c.applier.skins.children.map((m) => [m.material.userData.surface, m.geometry.getAttribute('position').count]) }
  })
  console.log(JSON.stringify(res))
  await shot('probe_after')
  console.log('errors', errs.slice(0, 5))
  await browser.close()
})()
