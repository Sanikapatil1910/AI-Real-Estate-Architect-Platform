/**
 * Browser test of both QR workflows (run by tests/test_vr_webxr.py; needs the backend + vite dev server running; ffmpeg and python `qrcode` make the test videos).
 *   node dev/e2e_qr.cjs <baseUrl> <outDir>
 * executed  = real headless Chromium with Chromium's FAKE CAMERA device playing a video of a QR code (the real getUserMedia -> decoder path; NOT a phone/headset camera).
 * simulated = getUserMedia / mediaDevices replaced by a stub to produce the "permission denied" and "no camera API" situations.
 * Nothing here used a real Cloudflare tunnel or a Meta Quest.
 */
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process')
const [BASE, OUT] = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })
const results = { executed: [], simulated: [] }
let bucket = 'executed'
const rec = (name, ok, detail = '') => results[bucket].push({ name, ok: !!ok, detail: String(detail).slice(0, 400) })
async function check(name, fn) { try { const r = await fn(); rec(name, r === undefined ? true : r === true || (r && r.ok !== false && r !== false), r && r.detail ? r.detail : '') } catch (e) { rec(name, false, e && e.message ? e.message : e) } }
const api = async (p, opt = {}) => { const r = await fetch(BASE + p, { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) } }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }
const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

function makeVideo(name, text) {
  const png = path.join(OUT, `${name}.png`), y4m = path.join(OUT, `${name}.y4m`)
  execFileSync('python3', ['-c', `import qrcode,sys\nq=qrcode.QRCode(border=4,box_size=10,error_correction=qrcode.constants.ERROR_CORRECT_M)\nq.add_data(sys.argv[2]);q.make(fit=True)\nq.make_image(fill_color='black',back_color='white').save(sys.argv[1])`, png, text])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-t', '4', '-r', '15', '-vf', 'scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:white', '-pix_fmt', 'yuv420p', y4m])
  return { png, y4m }
}
const TRACK_SPY = () => {                               // records every stream the page opens so the test can prove the tracks are stopped
  window.__streams = []
  const md = navigator.mediaDevices
  if (md && md.getUserMedia) { const orig = md.getUserMedia.bind(md); md.getUserMedia = async (c) => { const s = await orig(c); window.__streams.push(s); return s } }
  window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null }
}

;(async () => {
  const email = `qr${Date.now()}@example.com`
  await api('/auth/signup', { method: 'POST', body: JSON.stringify({ full_name: 'QR Tester', email, password: 'Passw0rd!x', role: 'home_owner' }) })
  const tok = (await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!x' }) })).body.access_token
  const TUNNEL = 'https://demo-abc-123.trycloudflare.com/app/vr/7'

  // ------------------------------------------------------------------ A. share dialog
  const b1 = await chromium.launch({ args: GL })
  const c1 = await b1.newContext({ viewport: { width: 1200, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await c1.addInitScript((t) => { try { localStorage.setItem('rea.token', t) } catch {} }, tok)
  const p1 = await c1.newPage(); const errs = []
  p1.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))
  await p1.goto(`${BASE}/app/vr`); await p1.waitForSelector('[data-testid=qr-share-open]', { timeout: 60000 })
  await check('share: the header button opens a dialog with a QR (SVG), the full address, Copy URL, Regenerate and Close', async () => {
    await p1.click('[data-testid=qr-share-open]'); await p1.waitForSelector('[data-testid=qr-share-dialog]')
    const url = await p1.textContent('[data-testid=qr-url-text]')
    const svg = await p1.locator('[data-testid=qr-svg] path').count()
    const btns = ['qr-copy', 'qr-regenerate', 'qr-close'].every(async (t) => (await p1.locator(`[data-testid=${t}]`).count()) === 1)
    return { ok: url === (await p1.evaluate(() => location.href)) && svg === 1 && btns, detail: url }
  })
  await check('share: the address is dynamic (taken from the page you are on, not hard-coded)', async () => {
    const dyn = await p1.evaluate(() => document.querySelector('[data-testid=qr-url-text]').textContent === location.href)
    return dyn && !(fs.readFileSync(path.join(__dirname, '..', 'src', 'qr', 'qrUrl.ts'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'qr', 'QrDialogs.tsx'), 'utf8')).match(/https?:\/\/[a-z0-9-]+\.trycloudflare\.com/)
  })
  await check('share: running on localhost shows the honest "only works on this computer" warning, VR-ready = no', async () => {
    const w = await p1.locator('[data-testid=qr-warning]').allTextContents(); const scope = await p1.textContent('[data-testid=qr-scope]')
    return { ok: w.some((x) => /THIS computer/.test(x)) && /not VR-ready/.test(scope), detail: scope }
  })
  await check('share: pasting a tunnel address regenerates the QR; Regenerate goes back to the current page', async () => {
    await p1.fill('[data-testid=qr-share-input]', TUNNEL)
    const shown = await p1.textContent('[data-testid=qr-url-text]'); const scope = await p1.textContent('[data-testid=qr-scope]'); const warn = await p1.locator('[data-testid=qr-warning]').count()
    await p1.locator('[data-testid=qr-svg]').screenshot({ path: path.join(OUT, 'share_tunnel_qr.png') })
    await p1.click('[data-testid=qr-regenerate]')
    const back = await p1.evaluate(() => document.querySelector('[data-testid=qr-url-text]').textContent === location.href)
    return { ok: shown === TUNNEL && /Cloudflare Quick Tunnel/.test(scope) && /VR-ready/.test(scope) && !/not VR-ready/.test(scope) && warn === 0 && back, detail: scope }
  })
  await check('share: Copy URL puts the full address on the clipboard and says so', async () => {
    await p1.fill('[data-testid=qr-share-input]', TUNNEL); await p1.click('[data-testid=qr-copy]'); await p1.waitForSelector('[data-testid=qr-copied]')
    return (await p1.evaluate(() => navigator.clipboard.readText())) === TUNNEL
  })
  await check('share: javascript:, data: and backend addresses are refused (no QR is drawn, an explanation is shown)', async () => {
    const out = []
    for (const t of ['javascript:alert(1)', 'data:text/html,hi', 'http://localhost:8000/docs', 'https://x.trycloudflare.com/projects/1']) {
      await p1.fill('[data-testid=qr-share-input]', t)
      out.push([t, await p1.locator('[data-testid=qr-svg]').count(), await p1.locator('[data-testid=qr-share-error]').count()])
    }
    return { ok: out.every((o) => o[1] === 0 && o[2] === 1), detail: JSON.stringify(out) }
  })
  await check('share: Escape closes the dialog, and the Close button too', async () => {
    await p1.press('body', 'Escape'); const gone = (await p1.locator('[data-testid=qr-share-dialog]').count()) === 0
    await p1.click('[data-testid=qr-share-open]'); await p1.click('[data-testid=qr-close]'); const gone2 = (await p1.locator('[data-testid=qr-share-dialog]').count()) === 0
    return gone && gone2
  })
  await check('share: the dialog is keyboard-reachable and labelled (role=dialog, aria-modal, labelled SVG)', async () => {
    await p1.click('[data-testid=qr-share-open]')
    const r = await p1.evaluate(() => { const d = document.querySelector('[role=dialog]'); const s = document.querySelector('[data-testid=qr-svg]'); return { modal: d.getAttribute('aria-modal'), label: !!d.getAttribute('aria-label'), svgLabel: !!s.getAttribute('aria-label'), focusInside: d.contains(document.activeElement) } })
    await p1.press('body', 'Escape')
    return { ok: r.modal === 'true' && r.label && r.svgLabel && r.focusInside, detail: JSON.stringify(r) }
  })
  await check('share: no page errors', async () => ({ ok: errs.length === 0, detail: errs.join(' | ') }))
  await b1.close()

  // ------------------------------------------------------------------ B. scan dialog with a REAL (fake-device) camera stream
  const cases = {
    good: makeVideo('scan_good', TUNNEL),
    js: makeVideo('scan_javascript', 'javascript:alert(document.domain)'),
    text: makeVideo('scan_text', 'hello world, not a link'),
    data: makeVideo('scan_data', 'data:text/html,<script>alert(1)</script>'),
    backend: makeVideo('scan_backend', 'http://192.168.1.4:8000/projects'),
    cred: makeVideo('scan_creds', 'https://google.com@evil.example/login'),
  }
  async function scanBrowser(video, { permissions = ['camera'], init = null } = {}) {
    const b = await chromium.launch({ args: [...GL, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${video}`] })
    const c = await b.newContext({ viewport: { width: 1200, height: 900 }, permissions })
    await c.addInitScript((t) => { try { localStorage.setItem('rea.token', t) } catch {} }, tok)
    await c.addInitScript(TRACK_SPY)
    if (init) await c.addInitScript(init)
    const p = await c.newPage(); p.__errs = []; p.on('pageerror', (e) => p.__errs.push(String(e).slice(0, 200)))
    await p.goto(`${BASE}/app/vr`); await p.waitForSelector('[data-testid=qr-scan-open]', { timeout: 60000 })
    return { b, p }
  }
  {
    const { b, p } = await scanBrowser(cases.good.y4m)
    await check('scan: the camera does NOT start until the person clicks Start camera', async () => {
      await p.click('[data-testid=qr-scan-open]'); await p.waitForSelector('[data-testid=qr-scan-dialog]')
      await p.waitForTimeout(800)
      return (await p.evaluate(() => window.__streams.length)) === 0
    })
    await check('scan: Start camera -> live preview, the QR in the video is decoded, a confirmation screen shows the full address and does NOT navigate', async () => {
      const before = await p.evaluate(() => location.href)
      await p.click('[data-testid=qr-start-camera]')
      await p.waitForSelector('[data-testid=qr-video]', { timeout: 15000 })
      await p.waitForSelector('[data-testid=qr-confirm]', { timeout: 40000 })
      const shown = await p.textContent('[data-testid=qr-confirm-url]'); const warn = await p.locator('[data-testid=qr-warning]').allTextContents()
      const opened = await p.evaluate(() => window.__opened.length); const same = (await p.evaluate(() => location.href)) === before
      await p.screenshot({ path: path.join(OUT, 'scan_confirmation.png') })
      return { ok: shown === TUNNEL && opened === 0 && same && warn.some((w) => /different website/.test(w)), detail: shown }
    })
    await check('scan: the camera stops as soon as a code is accepted (all tracks ended)', async () => {
      const st = await p.evaluate(() => window.__streams.map((s) => s.getTracks().map((t) => t.readyState)))
      return { ok: st.length >= 1 && st.every((a) => a.every((x) => x === 'ended')), detail: JSON.stringify(st) }
    })
    await check('scan: Cancel returns to the scanner without opening anything; Start camera works a second time', async () => {
      await p.click('[data-testid=qr-cancel]'); await p.waitForSelector('[data-testid=qr-start-camera]')
      const opened = await p.evaluate(() => window.__opened.length)
      await p.click('[data-testid=qr-start-camera]'); await p.waitForSelector('[data-testid=qr-confirm]', { timeout: 40000 })
      return opened === 0
    })
    await check('scan: Open this address opens exactly the scanned address in a new tab with noopener (only after the click)', async () => {
      await p.click('[data-testid=qr-open]')
      const o = await p.evaluate(() => window.__opened)
      return { ok: o.length === 1 && o[0][0] === TUNNEL && o[0][1] === '_blank' && /noopener/.test(o[0][2]), detail: JSON.stringify(o) }
    })
    await check('scan: the dialog closed after Open, and every stream the page ever opened has ended tracks', async () => {
      const gone = (await p.locator('[data-testid=qr-scan-dialog]').count()) === 0
      const st = await p.evaluate(() => window.__streams.map((s) => s.getTracks().every((t) => t.readyState === 'ended')))
      return { ok: gone && st.length >= 2 && st.every(Boolean), detail: JSON.stringify(st) }
    })
    await check('scan: closing the dialog while the camera is live stops the camera', async () => {
      await p.click('[data-testid=qr-scan-open]'); await p.click('[data-testid=qr-start-camera]'); await p.waitForSelector('[data-testid=qr-video]')
      await p.waitForTimeout(300)
      await p.press('body', 'Escape'); await p.waitForTimeout(300)
      const st = await p.evaluate(() => window.__streams.map((s) => s.getTracks().every((t) => t.readyState === 'ended')))
      return { ok: st.every(Boolean), detail: JSON.stringify(st) }
    })
    await check('scan: a photo of a QR code can be scanned instead of the live camera (file input)', async () => {
      await p.click('[data-testid=qr-scan-open]')
      await p.setInputFiles('[data-testid=qr-file]', cases.good.png)
      await p.waitForSelector('[data-testid=qr-confirm]', { timeout: 20000 })
      return (await p.textContent('[data-testid=qr-confirm-url]')) === TUNNEL
    })
    await check('scan: no page errors', async () => ({ ok: p.__errs.length === 0, detail: p.__errs.join(' | ') }))
    await b.close()
  }
  for (const [k, why] of [['js', /Only web addresses/], ['text', /not a web address/], ['data', /Only web addresses/], ['backend', /backend/], ['cred', /user name or password/]]) {
    const { b, p } = await scanBrowser(cases[k].y4m)
    await check(`scan: a QR holding ${k === 'js' ? 'javascript:' : k === 'data' ? 'data:' : k === 'text' ? 'plain text' : k === 'backend' ? 'a backend address' : 'hidden credentials'} is rejected with a message; no confirmation, nothing opened`, async () => {
      await p.click('[data-testid=qr-scan-open]'); await p.click('[data-testid=qr-start-camera]')
      await p.waitForSelector('[data-testid=qr-hint]', { timeout: 40000 })
      const hint = await p.textContent('[data-testid=qr-hint]'); const confirm = await p.locator('[data-testid=qr-confirm]').count(); const opened = await p.evaluate(() => window.__opened.length)
      await p.press('body', 'Escape'); await p.waitForTimeout(200)
      const st = await p.evaluate(() => window.__streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')))
      return { ok: why.test(hint) && confirm === 0 && opened === 0 && st, detail: hint }
    })
    await b.close()
  }
  {
    const { b, p } = await scanBrowser(cases.good.y4m)
    await check('scan: typing / pasting an address uses the same validation and confirmation (the Quest fallback)', async () => {
      await p.click('[data-testid=qr-scan-open]')
      await p.fill('[data-testid=qr-manual-input]', 'javascript:alert(1)'); await p.click('[data-testid=qr-manual-check]')
      const rej = (await p.locator('[data-testid=qr-hint]').count()) === 1 && (await p.locator('[data-testid=qr-confirm]').count()) === 0
      await p.fill('[data-testid=qr-manual-input]', TUNNEL); await p.click('[data-testid=qr-manual-check]')
      await p.waitForSelector('[data-testid=qr-confirm]')
      return rej && (await p.textContent('[data-testid=qr-confirm-url]')) === TUNNEL && (await p.evaluate(() => window.__streams.length)) === 0
    })
    await check('scan: the Quest note and the manual fallback are on screen', async () => {
      await p.click('[data-testid=qr-cancel]')
      const t = await p.textContent('[data-testid=qr-scan-dialog]'); return /Meta Quest/.test(t) && /type \/ paste the address/.test(t)
    })
    await b.close()
  }

  // ------------------------------------------------------------------ simulated failure modes
  bucket = 'simulated'
  {
    const { b, p } = await scanBrowser(cases.good.y4m, { init: () => { navigator.mediaDevices.getUserMedia = async () => { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e } } })
    await check('MOCK getUserMedia: permission denied -> a clear message, manual / photo options remain, no crash', async () => {
      await p.click('[data-testid=qr-scan-open]'); await p.click('[data-testid=qr-start-camera]'); await p.waitForSelector('[data-testid=qr-error]')
      const msg = await p.textContent('[data-testid=qr-error]')
      const still = (await p.locator('[data-testid=qr-manual-input]').count()) === 1 && (await p.locator('[data-testid=qr-file]').count()) === 1 && /Try the camera again/.test(await p.textContent('[data-testid=qr-start-camera]'))
      return { ok: /permission was denied/i.test(msg) && still && p.__errs.length === 0, detail: msg }
    })
    await b.close()
  }
  {
    const { b, p } = await scanBrowser(cases.good.y4m, { init: () => { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }) } })
    await check('MOCK no camera API: the dialog explains it, offers manual entry, does not throw', async () => {
      await p.click('[data-testid=qr-scan-open]'); await p.click('[data-testid=qr-start-camera]'); await p.waitForSelector('[data-testid=qr-error]')
      const msg = await p.textContent('[data-testid=qr-error]')
      return { ok: /cannot open the camera|secure/.test(msg) && (await p.locator('[data-testid=qr-manual-input]').count()) === 1 && p.__errs.length === 0, detail: msg }
    })
    await b.close()
  }
  {
    const { b, p } = await scanBrowser(cases.good.y4m, { init: () => { navigator.mediaDevices.getUserMedia = async () => { const e = new Error('none'); e.name = 'NotFoundError'; throw e } } })
    await check('MOCK getUserMedia: no camera device -> "No camera was found" message', async () => {
      await p.click('[data-testid=qr-scan-open]'); await p.click('[data-testid=qr-start-camera]'); await p.waitForSelector('[data-testid=qr-error]')
      return /No camera was found/.test(await p.textContent('[data-testid=qr-error]'))
    })
    await b.close()
  }
  console.log(JSON.stringify(results))
})().catch((e) => { console.error('E2E crashed:', e); process.exit(2) })
