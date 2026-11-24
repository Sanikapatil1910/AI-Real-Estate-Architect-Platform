/**
 * Browser test of the live customisation (run by tests/test_vr_webxr.py; needs the backend + vite dev server running).
 *   node dev/e2e_custom.cjs <baseUrl> <fixture>[,<fixture>...] <outDir>
 * Prints {executed:[...], simulated:[...]}.  executed = headless Chromium against the real backend and real page (NOT a headset).
 * simulated = mocked WebXR session + synthetic controller ray.  Nothing here ran on a Meta Quest.
 */
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path')
const [BASE, FIXTURES, OUT] = process.argv.slice(2)
const FIX = path.join(__dirname, 'fixtures')
fs.mkdirSync(OUT, { recursive: true })
const results = { executed: [], simulated: [] }
let bucket = 'executed'
const rec = (name, ok, detail = '') => results[bucket].push({ name, ok: !!ok, detail: String(detail).slice(0, 400) })
async function check(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  try { const r = await fn(); rec(name, r === undefined ? true : r === true || (r && r.ok !== false && r !== false), r && r.detail ? r.detail : '') } catch (e) { rec(name, false, e && e.message ? e.message : e) }
}
const api = async (p, opt = {}) => { const r = await fetch(BASE + p, { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) } }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }
async function setup(plan, name) {
  const email = `cu${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`
  await api('/auth/signup', { method: 'POST', body: JSON.stringify({ full_name: 'Custom Tester', email, password: 'Passw0rd!x', role: 'home_owner' }) })
  const tok = (await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!x' }) })).body.access_token
  const p = await api('/projects', { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ name, kind: 'generated', style: plan.architectural_style || 'Modern', data: { plan } }) })
  return { tok, id: p.body.id }
}
async function openViewer(browser, tok, id, { mockXr = false, ctx: given = null } = {}) {
  const ctx = given || await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  if (!given) await ctx.addInitScript((t) => { try { localStorage.setItem('rea.token', t) } catch {} }, tok)
  if (mockXr) await ctx.addInitScript(() => {
    const listeners = {}
    const session = { inputSources: [], addEventListener(t, f) { (listeners[t] ||= []).push(f) }, async end() { (listeners.end || []).forEach((f) => f()) } }
    window.__fakeXr = { session, requests: [] }
    Object.defineProperty(navigator, 'xr', { configurable: true, value: { isSessionSupported: async (m) => m === 'immersive-vr', requestSession: async (m, init) => { window.__fakeXr.requests.push({ m, init }); return session } } })
  })
  const pg = await ctx.newPage(); const errors = []
  pg.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  pg.on('console', (m) => { if (m.type() === 'error' && !/401|favicon/.test(m.text())) errors.push(m.text().slice(0, 300)) })
  pg.__errors = errors
  await pg.goto(`${BASE}/app/vr/${id}?vrdebug=1`)
  await pg.waitForFunction(() => !!window.__vrEngine, null, { timeout: 180000 })
  await pg.waitForTimeout(500)
  return { ctx, pg }
}

// helpers evaluated in the page: a signature of every non-skin mesh material, so "nothing else changed" is a comparison, not a claim
const SNAP = () => {
  const e = window.__vrEngine; const out = {}
  e.house.root.traverse((o) => { if (o.isMesh && !(o.parent && o.parent.userData.custom) && !o.userData.custom) { const m = o.material; out[o.uuid] = [m.uuid, m.color ? m.color.getHex() : -1, m.map ? m.map.uuid : '', o.visible, (o.material.userData.role || '')] } })
  return out
}

;(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  for (const fx of FIXTURES.split(',')) {
    const plan = JSON.parse(fs.readFileSync(path.join(FIX, fx + '.json'), 'utf8'))
    const label = `[${fx}] `
    bucket = 'executed'
    const { tok, id } = await setup(plan, 'CUSTOM ' + fx)
    const { ctx, pg } = await openViewer(browser, tok, id)
    const E = (fn, arg) => pg.evaluate(fn, arg)
    const snapFn = `(${SNAP.toString()})()`
    const snap = () => pg.evaluate(snapFn)
    const base = await snap()
    const living = await E(() => { const r = window.__vrEngine.custom.applier.rooms.find((q) => q.type === 'living_room') || window.__vrEngine.custom.applier.rooms[0]; return r })

    await check(label + 'the loaded house carries role tags and wall faces for the customiser', async () => {
      const r = await E(() => { const a = window.__vrEngine.custom.applier; return { paths: a.rolePaths.length, faces: a.wallFaces().length, rooms: a.rooms.length } })
      return { ok: r.paths >= 8 && r.faces > 20 && r.rooms >= 4, detail: JSON.stringify(r) }
    })
    await check(label + 'per-room wall colour: skins appear, lie inside that room only, original materials untouched', async () => {
      const r = await E((k) => {
        const c = window.__vrEngine.custom; c.target = k; c.perform({ t: 'wallColor', id: 'terracotta' })
        const room = c.applier.rooms.find((q) => q.key === k)
        let n = 0, outside = 0
        c.applier.skins.traverse((o) => { if (!o.isMesh) return; n++; const p = o.geometry.getAttribute('position'); for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (x < room.x0 - 0.7 || x > room.x1 + 0.7 || z < room.z0 - 0.7 || z > room.z1 + 0.7 || y < room.y0 - 0.1 || y > room.y1 + 0.1) outside++ } })
        return { n, outside, quads: c.lastResult.skinQuads }
      }, living.key)
      const after = await snap()
      const changed = Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(after[k]))
      return { ok: r.n >= 1 && r.quads >= 2 && r.outside === 0 && changed.length === 0, detail: JSON.stringify({ ...r, changedOriginals: changed.length }) }
    })
    await check(label + 'accent wall + floor (wood, marble, granite, ceramic) + ceiling are separate skins with real textures', async () => {
      const r = await E((k) => {
        const c = window.__vrEngine.custom; c.target = k
        c.perform({ t: 'accentSide', side: 'N' })
        const out = {}
        for (const f of ['oak_light', 'marble_white', 'granite_black', 'ceramic_white']) { c.perform({ t: 'floor', id: f }); out[f] = c.applier.skins.children.filter((m) => m.material.map && m.geometry.getAttribute('position').count === 4).length }
        c.perform({ t: 'ceilColor', id: 'c_sky' }); c.perform({ t: 'ceilFinish', id: 'satin' })
        return { out, skins: c.applier.skins.children.length, accentMats: new Set(c.applier.skins.children.map((m) => m.material.uuid)).size }
      }, living.key)
      return { ok: Object.values(r.out).every((v) => v >= 1) && r.skins >= 3, detail: JSON.stringify(r) }
    })
    await check(label + 'door role: only role-tagged meshes change, others keep the very same material', async () => {
      const before = await snap()
      const r = await E(() => { const c = window.__vrEngine.custom; c.perform({ t: 'role', key: 'door', id: 'white' }); return { swapped: c.lastResult.rolesSwapped } })
      const after = await snap()
      const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      const roles = new Set(changed.map((k) => before[k][4]))
      return { ok: r.swapped >= 1 && changed.length >= 1 && [...roles].every((x) => x === 'doorMat' || x === 'mainDoorMat'), detail: JSON.stringify({ swapped: r.swapped, changed: changed.length, roles: [...roles] }) }
    })
    await check(label + 'furniture, curtains, rugs, window frames, exterior colour/trim/gate/railing roles change only their own meshes', async () => {
      const out = []
      for (const [key, choice] of [['upholstery', 'camel'], ['furnWood', 'ebony'], ['cabinets', 'white'], ['windowFrame', 'black'], ['curtains', 'blue'], ['rugs', 'rose'], ['facadeColor', 'terracotta'], ['trim', 'bronze'], ['railing', 'black'], ['gate', 'navy']]) {
        const before = await snap()
        const ok = await E(([k, ch]) => { const c = window.__vrEngine.custom; const had = c.applier.hasRole(k); const done = c.perform({ t: 'role', key: k, id: ch }); return { had, done } }, [key, choice])
        const after = await snap()
        const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
        out.push({ key, had: ok.had, changed: changed.length })
        await E(([k]) => window.__vrEngine.custom.perform({ t: 'role', key: k, id: null }), [key])
      }
      return { ok: out.every((o) => !o.had || o.changed >= 1), detail: JSON.stringify(out) }
    })
    await check(label + 'curtains "off" hides the curtain meshes; undo shows them again', async () => {
      const r = await E(() => { const c = window.__vrEngine.custom; const n = c.applier.meshesOf('furn.curtain'); if (!n) return { n: 0 }; c.perform({ t: 'role', key: 'curtains', id: 'off' }); const hidden = c.applier.roleMeshes.get('furn.curtain').every((m) => !m.visible); c.perform({ t: 'undo' }); return { n, hidden, back: c.applier.roleMeshes.get('furn.curtain').every((m) => m.visible) } })
      return { ok: r.n === 0 || (r.hidden && r.back), detail: JSON.stringify(r) }
    })
    await check(label + 'palette applies to the whole house as ONE undo step; walls/floors/ceilings of every indoor room change', async () => {
      const r = await E(() => { const c = window.__vrEngine.custom; c.perform({ t: 'reset' }); c.perform({ t: 'palette', id: 'luxury_marble' }); const n = Object.keys(c.store.state.rooms).length, q = c.lastResult.skinQuads; c.perform({ t: 'undo' }); return { n, q, afterUndo: Object.keys(c.store.state.rooms).length } })
      return { ok: r.n >= 4 && r.q > r.n && r.afterUndo === 0, detail: JSON.stringify(r) }
    })
    await check(label + 'reset puts every original material back; undo of reset brings the design back; redo/undo are exact', async () => {
      const r = await E((k) => {
        const c = window.__vrEngine.custom; c.target = k
        c.perform({ t: 'reset' }); c.perform({ t: 'wallColor', id: 'sage' }); c.perform({ t: 'role', key: 'door', id: 'teak' }); const design = JSON.stringify(c.store.state)
        c.perform({ t: 'reset' }); const resetEmpty = c.store.changeCount === 0 && c.applier.skins.children.length === 0
        c.perform({ t: 'undo' }); const back = JSON.stringify(c.store.state) === design && c.applier.skins.children.length >= 1
        c.perform({ t: 'undo' }); c.perform({ t: 'undo' }); c.perform({ t: 'redo' }); c.perform({ t: 'redo' })
        return { resetEmpty, back, same: JSON.stringify(c.store.state) === design }
      }, living.key)
      const after = await snap()
      await E(() => window.__vrEngine.custom.perform({ t: 'reset' }))
      const reset = await snap()
      const diff = Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(reset[k]))
      return { ok: r.resetEmpty && r.back && r.same && diff.length === 0 && Object.keys(after).length === Object.keys(base).length, detail: JSON.stringify({ ...r, diffAfterReset: diff.length }) }
    })
    await check(label + 'customising never changes geometry, the walking grid or collision (nothing for the nav to see)', async () => {
      const r = await E((k) => {
        const e = window.__vrEngine, c = e.custom, nav = e.house.nav
        const tri = () => { let t = 0, v = 0; e.house.root.traverse((o) => { if (o.isMesh && !o.userData.custom && !(o.parent && o.parent.userData.custom)) { const p = o.geometry.getAttribute('position'); t += o.geometry.index ? o.geometry.index.count / 3 : p.count / 3; for (let i = 0; i < p.count; i += 7) v += p.getX(i) + p.getY(i) * 3 + p.getZ(i) * 7 } }); return [t, Math.round(v * 1000)] }
        const before = tri(), navBefore = JSON.stringify(Object.keys(nav)) + nav.constructor.name
        c.target = 'all'; c.perform({ t: 'palette', id: 'earthy_terracotta' }); c.perform({ t: 'role', key: 'door', id: 'walnut' })
        const after = tri()
        return { same: before[0] === after[0] && before[1] === after[1], navSame: navBefore === JSON.stringify(Object.keys(nav)) + nav.constructor.name, before, after }
      }, living.key)
      await E(() => window.__vrEngine.custom.perform({ t: 'reset' }))
      return { ok: r.same && r.navSame, detail: JSON.stringify(r) }
    })
    await check(label + 'a room the model does not have is ignored safely (new house generated after a design was saved)', async () => {
      const r = await E(() => { const c = window.__vrEngine.custom; c.store.editRooms(['0:no_such_room_9'], () => ({ wall: { color: '#112233' } })); const res = c.lastResult; c.perform({ t: 'reset' }); return { skipped: res.skippedRooms, err: null } })
      return { ok: r.skipped.length === 1, detail: JSON.stringify(r) }
    })

    // ---------------------------------------------------------------- the desktop HTML panel (real clicks)
    await check(label + 'desktop panel: Open customization, pick a wall colour for the room, the house changes; Undo / Redo / Reset buttons work', async () => {
      await pg.click('[data-testid=toggle-custom]')
      await pg.waitForSelector('[data-testid=custom-panel]', { timeout: 10000 })
      await pg.click('[data-testid="cu:tab:walls"]')
      await pg.click('[data-testid="cu:next"]')                                   // first room
      await pg.click('[data-testid="cu:wallColor:terracotta"]')
      await pg.waitForTimeout(200)
      const a = await E(() => { const c = window.__vrEngine.custom; return { n: c.store.changeCount, skins: c.applier.skins.children.length, target: c.target } })
      await pg.click('[data-testid="cu:undo"]'); await pg.waitForTimeout(150)
      const b = await E(() => window.__vrEngine.custom.store.changeCount)
      await pg.click('[data-testid="cu:redo"]'); await pg.waitForTimeout(150)
      const c2 = await E(() => window.__vrEngine.custom.store.changeCount)
      await pg.screenshot({ path: path.join(OUT, `${fx}_desktop_custom_panel.png`) })
      await pg.click('[data-testid="cu:reset"]'); await pg.waitForTimeout(150)
      const d = await E(() => window.__vrEngine.custom.store.changeCount)
      return { ok: a.n >= 1 && a.skins >= 1 && a.target !== 'all' && b === 0 && c2 >= 1 && d === 0, detail: JSON.stringify({ a, b, c2, d }) }
    })
    await check(label + 'desktop panel: every tab opens and shows controls (Interior, Exterior, Walls, Flooring, Ceiling, Doors, Furniture, Decor, History)', async () => {
      const seen = []
      for (const t of ['interior', 'exterior', 'walls', 'flooring', 'ceiling', 'doors', 'furniture', 'decor', 'history']) {
        await pg.click(`[data-testid="cu:tab:${t}"]`); await pg.waitForTimeout(60)
        seen.push([t, await pg.locator('[data-testid=custom-panel] button:not([disabled])').count()])
      }
      return { ok: seen.every((s) => s[1] >= 7), detail: JSON.stringify(seen) }
    })
    await check(label + 'Save keeps the design with the project, in this browser, and a reload restores it live', async () => {
      await pg.click('[data-testid="cu:tab:interior"]'); await pg.click('[data-testid="cu:palette:warm_classic"]'); await pg.waitForTimeout(200)
      const state = await E(() => JSON.stringify(window.__vrEngine.custom.store.state))
      await pg.click('[data-testid="cu:save"]'); await pg.waitForTimeout(800)
      const proj = await api(`/projects/${id}`, { headers: { authorization: `Bearer ${tok}` } })
      const inProject = proj.body && proj.body.data && proj.body.data.custom && JSON.stringify(proj.body.data.custom) === state
      const ls = await E(() => Object.keys(localStorage).filter((k) => k.startsWith('rea.custom.')))
      await pg.reload(); await pg.waitForFunction(() => !!window.__vrEngine, null, { timeout: 180000 }); await pg.waitForTimeout(600)
      const r = await E(() => { const c = window.__vrEngine.custom; return { state: JSON.stringify(c.store.state), skins: c.applier.skins.children.length, unsaved: c.store.unsaved, errs: 0 } })
      return { ok: inProject && ls.length === 1 && r.state === state && r.skins >= 3 && !r.unsaved, detail: JSON.stringify({ inProject, ls, skins: r.skins, same: r.state === state }) }
    })
    await check(label + 'the saved design follows the project to a fresh browser (no localStorage) - the same look on another device', async () => {
      const fresh = await browser.newContext({ viewport: { width: 1200, height: 800 } })
      await fresh.addInitScript((t) => { try { localStorage.setItem('rea.token', t) } catch {} }, tok)
      const { pg: p2 } = await openViewer(browser, tok, id, { ctx: fresh })
      const r = await p2.evaluate(() => { const c = window.__vrEngine.custom; return { changes: c.store.changeCount, skins: c.applier.skins.children.length } })
      await p2.screenshot({ path: path.join(OUT, `${fx}_second_browser.png`) })
      await fresh.close()
      return { ok: r.changes >= 4 && r.skins >= 3, detail: JSON.stringify(r) }
    })
    await check(label + 'a labelled desktop screenshot of the customised living room (NOT a headset view)', async () => {
      await E((k) => { const e = window.__vrEngine; e.goToRoom(k); e.yaw = 0.6; e.pitch = -0.05 }, living.key)
      await pg.waitForTimeout(800)
      const bb = await pg.locator('[data-testid=vr-stage]').boundingBox(); await pg.screenshot({ path: path.join(OUT, `${fx}_customised_living_desktop.png`), clip: bb, timeout: 60000 })
      return true
    })
    await check(label + 'no page errors during customisation', async () => ({ ok: pg.__errors.length === 0, detail: pg.__errors.slice(0, 3).join(' | ') }))
    await ctx.close()

    // ---------------------------------------------------------------- SIMULATED WebXR: the floating panel
    bucket = 'simulated'
    {
      const { ctx: c3, pg: p3 } = await openViewer(browser, tok, id, { mockXr: true })
      const E3 = (fn, arg) => p3.evaluate(fn, arg)
      await E3(() => { window.__vrEngine.renderer.xr.setSession = async () => {} })
      await E3(() => window.__vrEngine.custom.perform({ t: 'reset' }))
      await p3.waitForFunction(() => window.__vrEngine.xrSupported, null, { timeout: 10000 })
      await p3.click('[data-testid=enter-vr]', { timeout: 90000 })
      await p3.waitForFunction(() => window.__vrEngine.mode === 'vr', null, { timeout: 10000 })
      await check(label + 'MOCK xr: the customisation panel opens independently of the Smart House panel, both can be open side by side', async () => {
        const r = await E3(() => {
          const e = window.__vrEngine; e.camera.position.set(0, 1.6, 0)
          e.setCustomOpen(true); const onlyCustom = e.customMesh.visible && !e.panelMesh.visible
          e.setPanelOpen(true); const both = e.customMesh.visible && e.panelMesh.visible
          const apart = e.customMesh.position.distanceTo(e.panelMesh.position)
          e.setCustomOpen(false); const smartStays = e.panelMesh.visible && !e.customMesh.visible
          e.setCustomOpen(true); e.setPanelOpen(false); const customStays = e.customMesh.visible && !e.panelMesh.visible
          return { onlyCustom, both, apart, smartStays, customStays }
        })
        return { ok: r.onlyCustom && r.both && r.apart > 0.5 && r.smartStays && r.customStays, detail: JSON.stringify(r) }
      })
      await check(label + 'MOCK xr: INJECTED right A button toggles the customisation panel; the Smart House panel has a CUSTOMIZE button that opens it', async () => {
        const r = await E3(() => {
          const e = window.__vrEngine, s = window.__fakeXr.session
          const mk = (h, btn) => ({ handedness: h, gamepad: { axes: [0, 0, 0, 0], buttons: btn.map((b) => ({ pressed: b })), hapticActuators: [] } })
          e.setCustomOpen(false); e.setPanelOpen(true)
          s.inputSources = [mk('left', [0, 0, 0, 0, 0, 0]), mk('right', [0, 0, 0, 0, 0, 0])]; e.tick(0.05)
          s.inputSources = [mk('left', [0, 0, 0, 0, 0, 0]), mk('right', [0, 0, 0, 0, true, 0])]; e.tick(0.05)
          const byA = e.customOpen
          s.inputSources = [mk('left', [0, 0, 0, 0, 0, 0]), mk('right', [0, 0, 0, 0, 0, 0])]; e.tick(0.05)
          s.inputSources = [mk('left', [0, 0, 0, 0, 0, 0]), mk('right', [0, 0, 0, 0, true, 0])]; e.tick(0.05)
          const closedByA = !e.customOpen
          s.inputSources = [mk('left', [0, 0, 0, 0, 0, 0]), mk('right', [0, 0, 0, 0, 0, 0])]; e.tick(0.05)
          const b = e.layout.buttons.find((x) => x.id === 'custom'); e.runAction(b.action)
          return { byA, closedByA, byButton: e.customOpen, label: b.label }
        })
        return { ok: r.byA && r.closedByA && r.byButton, detail: JSON.stringify(r) }
      })
      await check(label + 'MOCK xr: a controller ray at a panel button picks it (hover id), the trigger applies the change to the loaded house; tabs, wall colour, floor, ceiling, doors, furniture, undo/redo/reset/save work', async () => {
        const r = await E3(() => {
          const e = window.__vrEngine, c = e.custom
          e.rig.updateMatrixWorld(true); e.camera.updateMatrixWorld(true)
          const V = e.camera.position.constructor
          c.perform({ t: 'reset' }); c.target = c.applier.rooms[0].key
          const head = e.camera.getWorldPosition(new V())
          const miss = []
          const press = (btnId) => {
            e.rig.updateMatrixWorld(true); e.customMesh.updateMatrixWorld(true)
            const L = e.customPanelLayout, b = L.buttons.find((x) => x.id === btnId)
            if (!b) { miss.push(btnId); return null }
            const target = e.customMesh.localToWorld(new V((b.x + b.w / 2) / L.width * 1.1 - 0.55, (0.5 - (b.y + b.h / 2) / L.height) * (1.1 * L.height / L.width), 0))
            const ctrl = e.renderer.xr.getController(1)
            const pos = new V(head.x + 0.2, head.y - 0.3, head.z); e.rig.worldToLocal(pos); ctrl.position.copy(pos)
            const M = e.camera.matrix.constructor
            const m = new M().lookAt(e.rig.localToWorld(ctrl.position.clone()), target, new V(0, 1, 0))
            ctrl.quaternion.setFromRotationMatrix(e.rig.matrixWorld.clone().invert().multiply(m))
            ctrl.matrix.compose(ctrl.position, ctrl.quaternion, ctrl.scale); ctrl.matrixWorldNeedsUpdate = true   // MOCK pose (a real session writes the controller matrix)
            ctrl.updateMatrixWorld(true)
            const hit = e.pick(e.rayFor(ctrl))
            if (!hit || hit.kind !== 'cpanel' || hit.id !== btnId) { miss.push(btnId + '->' + (hit ? hit.kind + ':' + hit.id : 'none')); return null }
            e.tick(0.05)
            ctrl.dispatchEvent({ type: 'selectstart' })         // the controller's real trigger listener -> activate(pick)
            e.tick(0.05)
            return true
          }
          const steps = ['cu:tab:walls', 'cu:sec:paint', 'cu:wallColor:terracotta', 'cu:tab:flooring', 'cu:sec:Granite', 'cu:floor:granite_black', 'cu:tab:ceiling', 'cu:ceilColor:c_sky', 'cu:tab:doors', 'cu:role:door:walnut', 'cu:tab:furniture', 'cu:sec:upholstery', 'cu:role:upholstery:camel']
          steps.forEach(press)
          const afterEdits = { changes: c.store.changeCount, skins: c.applier.skins.children.length, tab: c.tab }
          press('cu:undo'); const u = c.store.changeCount; press('cu:redo'); const rd = c.store.changeCount
          press('cu:save'); const saved = c.store.hasSaved && !c.store.unsaved
          press('cu:reset'); const rs = c.store.changeCount
          press('cu:restore'); const restored = c.store.changeCount
          return { miss, afterEdits, u, rd, saved, rs, restored }
        })
        return { ok: r.miss.length === 0 && r.afterEdits.changes >= 5 && r.afterEdits.skins >= 3 && r.u === r.afterEdits.changes - 1 && r.rd === r.afterEdits.changes && r.saved && r.rs === 0 && r.restored === r.afterEdits.changes, detail: JSON.stringify(r) }
      })
      await check(label + 'MOCK xr: the VR canvas panel and the desktop panel are two views of the same state (same saved document)', async () => {
        const r = await E3(() => { const c = window.__vrEngine.custom; const l = c.layout(); const w = l.buttons.filter((b) => b.selected).length; return { sel: w, same: JSON.stringify(window.__vrEngine.customPanelLayout.buttons.map((b) => b.id)) === JSON.stringify(l.buttons.map((b) => b.id)) } })
        return { ok: r.same, detail: JSON.stringify(r) }
      })
      await check(label + 'MOCK xr: all panel buttons are inside the canvas and at least 40 px (>= ~4 cm on the 1.1 m panel) in both directions', async () => {
        const r = await E3(() => { const out = []; const c = window.__vrEngine.custom; for (const t of ['interior', 'exterior', 'walls', 'flooring', 'ceiling', 'doors', 'furniture', 'decor', 'history']) { c.perform({ t: 'tab', tab: t }); const L = c.layout(); for (const b of L.buttons) if (b.x < 0 || b.y < 0 || b.x + b.w > L.width || b.y + b.h > L.height || b.w < 40 || b.h < 40) out.push(t + ':' + b.id) } return out })
        return { ok: r.length === 0, detail: r.slice(0, 5).join(',') }
      })
      await check(label + 'MOCK xr: customisation survives leaving and re-entering VR (same document, same skins)', async () => {
        const r = await E3(async () => {
          const e = window.__vrEngine, c = e.custom; const s0 = JSON.stringify(c.store.state), k0 = c.applier.skins.children.length
          await e.exitVR(); const back = e.mode === 'desktop'
          await e.enterVR(); await new Promise((x) => setTimeout(x, 200))
          return { s: JSON.stringify(c.store.state) === s0, k: c.applier.skins.children.length === k0, back, vr: e.mode === 'vr', k0 }
        })
        return { ok: r.s && r.k && r.back && r.vr && r.k0 >= 1, detail: JSON.stringify(r) }
      })
      await check(label + 'MOCK xr: no page errors in the simulated session', async () => ({ ok: p3.__errors.length === 0, detail: p3.__errors.slice(0, 3).join(' | ') }))
      await c3.close()
    }
  }
  await browser.close()
  console.log(JSON.stringify(results))
})().catch((e) => { console.error('E2E crashed:', e); process.exit(2) })
