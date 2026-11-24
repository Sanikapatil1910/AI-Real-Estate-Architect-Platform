/**
 * Unit tests of the QR workflows' logic (src/qr/*): address classification, share-URL building, scanned-text validation, QR encode -> decode round trip.
 * Run by tests/test_vr_webxr.py after bundling with esbuild for node.  Pure logic: no browser, no camera.
 */
import assert from 'node:assert/strict'
import jsQR from 'jsqr'
import { classifyOrigin, buildShareUrl, validateScanned, splitUrl, MAX_URL_LENGTH } from '../src/qr/qrUrl'
import { qrMatrix, qrSvgPath } from '../src/qr/qrCode'

const tests: Array<[string, () => void]> = []
const test = (n: string, f: () => void) => tests.push([n, f])
const TUNNEL = 'https://random-words-here.trycloudflare.com/app/vr/12'

test('classify: localhost / 127.x / ::1 are this computer only', () => { for (const u of ['http://localhost:5173/', 'http://127.0.0.1:5173/app', 'http://[::1]:5173/']) { const i = classifyOrigin(u); assert.equal(i.scope, 'loopback', u); assert.equal(i.reachable, 'no'); assert.equal(i.vrReady, false) } })
test('classify: private network addresses are same-network only', () => { for (const u of ['http://192.168.1.20:5173/', 'https://10.0.0.5:5173/', 'http://172.16.4.2/', 'http://172.31.255.1/', 'http://mypc.local:5173/']) assert.equal(classifyOrigin(u).scope, 'lan', u); assert.equal(classifyOrigin('http://172.32.0.1/').scope, 'public') })
test('classify: a Cloudflare Quick Tunnel is reachable and VR-ready, whatever its random name', () => { for (const h of ['a-b-c.trycloudflare.com', 'zzz.trycloudflare.com']) { const i = classifyOrigin(`https://${h}/`); assert.equal(i.scope, 'tunnel'); assert.equal(i.reachable, 'yes'); assert.equal(i.vrReady, true); assert.equal(i.label, 'Cloudflare Quick Tunnel') } })
test('classify: an https LAN address is secure but not "reachable from anywhere"; http public is not VR-ready', () => { const a = classifyOrigin('https://192.168.1.4:5173/'); assert.ok(a.secure && a.vrReady && a.reachable === 'same-network'); assert.equal(classifyOrigin('http://example.com/').vrReady, false) })
test('classify: non-web schemes and junk are invalid', () => { for (const u of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://x.com', 'not a url', '']) assert.equal(classifyOrigin(u).valid, false, u) })
test('classify: the backend is recognised by port and by API path', () => { assert.equal(classifyOrigin('http://192.168.1.4:8000/').backend, 'port'); assert.equal(classifyOrigin('http://localhost:8000/docs').backend, 'port'); assert.equal(classifyOrigin('https://x.trycloudflare.com/projects/3').backend, 'path'); assert.equal(classifyOrigin('https://x.trycloudflare.com/app/vr/3').backend, null) })
test('classify: international host labels are flagged', () => { assert.equal(classifyOrigin('https://xn--pple-43d.com/').idn, true); assert.equal(classifyOrigin('https://apple.com/').idn, false) })

test('share: the QR carries the current page address as is (no hard-coded host), minus the #fragment', () => {
  const r = buildShareUrl(TUNNEL + '#secret'); assert.ok(r.ok); if (r.ok) { assert.equal(r.url, TUNNEL); assert.equal(r.warnings.length, 0) }
  const o = buildShareUrl('http://localhost:5173/app', 'https://other-name.trycloudflare.com/'); assert.ok(o.ok && o.url === 'https://other-name.trycloudflare.com/')
})
test('share: localhost and LAN addresses produce honest warnings', () => {
  const l = buildShareUrl('http://localhost:5173/app'); assert.ok(l.ok); if (l.ok) assert.ok(l.warnings.some((w) => /only works on THIS computer/.test(w)))
  const n = buildShareUrl('http://192.168.1.9:5173/app'); assert.ok(n.ok); if (n.ok) { assert.ok(n.warnings.some((w) => /same Wi-Fi/.test(w))); assert.ok(n.warnings.some((w) => /https/.test(w))) }
})
test('share: backend addresses are refused, never encoded', () => { for (const u of ['http://192.168.1.4:8000/', 'https://x.trycloudflare.com/docs', 'https://x.trycloudflare.com/projects/1']) { const r = buildShareUrl(u); assert.equal(r.ok, false, u) } })
test('share: junk and dangerous schemes are refused', () => { for (const u of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'hello', 'https://user:pw@evil.com/']) assert.equal(buildShareUrl('http://localhost/', u).ok, false, u) })

test('scan: a normal https address is offered; the real host is split out for the confirmation screen', () => {
  const r = validateScanned(TUNNEL, 'localhost:5173'); assert.ok(r.ok); if (r.ok) { assert.equal(r.url, TUNNEL); assert.equal(r.sameApp, false); assert.ok(r.warnings.some((w) => /different website/.test(w))) }
  const p = splitUrl(TUNNEL); assert.equal(p.host, 'random-words-here.trycloudflare.com'); assert.equal(p.before + p.host + p.after, TUNNEL)
})
test('scan: the same site as the page you are on is not flagged as different', () => { const r = validateScanned('https://app.example.com/app/vr/1', 'app.example.com'); assert.ok(r.ok); if (r.ok) { assert.equal(r.sameApp, true); assert.equal(r.warnings.length, 0) } })
test('scan: javascript:, data:, file:, blob:, intent:, tel:, mailto: and other schemes are rejected', () => { for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'file:///C:/x', 'blob:https://a.com/1', 'intent://x#Intent;end', 'tel:+911234', 'mailto:a@b.c', 'ftp://a.com', 'vbscript:x', 'ms-settings:']) assert.equal(validateScanned(u).ok, false, u) })
test('scan: plain text, empty text, whitespace tricks and over-long text are rejected', () => { for (const u of ['hello world', '', '   ', 'https://a.com/ x', 'https://a.com/\u0000', 'https://a.com/\nx', 'https://' + 'a'.repeat(MAX_URL_LENGTH) + '.com']) assert.equal(validateScanned(u).ok, false, JSON.stringify(u).slice(0, 40)) })
test('scan: credentials hidden in the address are rejected (user@host disguise)', () => { assert.equal(validateScanned('https://google.com@evil.com/').ok, false); assert.equal(validateScanned('https://a:b@evil.com/').ok, false) })
test('scan: a code that points at the backend is not offered', () => { assert.equal(validateScanned('http://192.168.1.4:8000/projects').ok, false) })
test('scan: http, localhost and look-alike hosts get warnings rather than silence', () => {
  const h = validateScanned('http://192.168.1.4:5173/', 'x.com'); assert.ok(h.ok); if (h.ok) assert.ok(h.warnings.some((w) => /http, not https/.test(w)))
  const l = validateScanned('http://localhost:5173/', 'x.com'); assert.ok(l.ok); if (l.ok) assert.ok(l.warnings.some((w) => /localhost/.test(w)))
  const i = validateScanned('https://xn--pple-43d.com/', 'x.com'); assert.ok(i.ok); if (i.ok) assert.ok(i.warnings.some((w) => /international/.test(w)))
})
test('scan: surrounding whitespace is trimmed, the original text is never executed', () => { const r = validateScanned('  https://a.com/x  '); assert.ok(r.ok); if (r.ok) assert.equal(r.url, 'https://a.com/x') })

// ------------------------------------------------------------------ encode -> decode
function render(m: boolean[][], scale = 6, quiet = 4): { data: Uint8ClampedArray; w: number } {
  const n = m.length + 2 * quiet, w = n * scale, data = new Uint8ClampedArray(w * w * 4).fill(255)
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) if (m[r][c]) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const o = (((r + quiet) * scale + y) * w + (c + quiet) * scale + x) * 4; data[o] = data[o + 1] = data[o + 2] = 0 }
  return { data, w }
}
test('qr: encoding then decoding returns the exact address (short, tunnel-length, long with query)', () => {
  for (const u of ['https://a.io/', TUNNEL, 'https://x.trycloudflare.com/app/vr/12?vrdebug=1&token=' + 'abc123'.repeat(40)]) {
    const { data, w } = render(qrMatrix(u)); const hit = jsQR(data, w, w); assert.equal(hit?.data, u, u.slice(0, 40))
  }
})
test('qr: the SVG path covers exactly the dark modules plus the quiet zone', () => {
  const m = qrMatrix('https://a.io/'); const { d, size } = qrSvgPath(m); assert.equal(size, m.length + 8)
  let dark = 0; for (const r of m) for (const v of r) if (v) dark++
  let area = 0; for (const t of d.matchAll(/h(\d+)v1/g)) area += Number(t[1]); assert.equal(area, dark)
})
test('qr: a non-ASCII address is percent-encoded by the share step (so it round-trips) and an impossible length is an error, not a bad code', () => {
  const r = buildShareUrl('https://a.io/é'); assert.ok(r.ok); if (!r.ok) return
  assert.match(r.url, /^[\x21-\x7e]+$/); const { data, w } = render(qrMatrix(r.url)); assert.equal(jsQR(data, w, w)?.data, r.url)
  assert.throws(() => qrMatrix('x'.repeat(4000)))
})

const failed: Array<{ name: string; error: string }> = []
let passed = 0
for (const [name, fn] of tests) { try { fn(); passed++ } catch (e) { failed.push({ name, error: String((e as Error).message).slice(0, 400) }) } }
console.log(JSON.stringify({ passed, total: tests.length, failed }))
process.exit(failed.length ? 1 : 0)
