/**
 * Pure URL logic of the QR feature (no DOM, no React, nothing runs at import) so it is unit-tested in node (dev/check_qr.ts).
 *
 *   classifyOrigin(url)          what kind of address is this, and can another device open it?
 *   buildShareUrl(current, over) the address a QR should carry (workflow A); backend-only addresses are refused
 *   validateScanned(text, host)  is the decoded text safe to OFFER to the person (workflow B)?  Nothing here ever navigates.
 *
 * No tunnel host name is hardcoded: the address always comes from the page being looked at, or from what the person pasted.
 */
export const MAX_URL_LENGTH = 2048
/** the FastAPI backend normally listens here; a QR must never send a phone / headset to it */
export const BACKEND_PORTS = ['8000']
/** first path segments that belong to the API (the proxy table in vite.config.ts) */
export const BACKEND_PATHS = ['docs', 'redoc', 'openapi.json', 'api', 'auth', 'projects', 'generate', 'health', 'feasibility', 'parse-brief', 'critique', 'plan-import']

export type OriginScope = 'loopback' | 'lan' | 'tunnel' | 'public' | 'invalid'
export interface OriginInfo {
  valid: boolean
  protocol: string
  hostname: string
  host: string
  scope: OriginScope
  secure: boolean
  /** can a DIFFERENT device open this address?  no = this computer only, same-network = private network only, yes = reachable over the internet */
  reachable: 'no' | 'same-network' | 'yes'
  /** https and not loopback: the Quest Browser can enter immersive VR from it (WebXR needs a secure context) */
  vrReady: boolean
  backend: null | 'port' | 'path'
  idn: boolean
  label: string
}

const INVALID: OriginInfo = { valid: false, protocol: '', hostname: '', host: '', scope: 'invalid', secure: false, reachable: 'no', vrReady: false, backend: null, idn: false, label: 'Not a web address' }

const isIPv4 = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)
function ipv4Scope(h: string): OriginScope {
  const [a, b] = h.split('.').map(Number)
  if (a === 127 || a === 0) return 'loopback'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return 'lan'
  return 'public'
}

export function classifyOrigin(raw: string): OriginInfo {
  let u: URL
  try { u = new URL(raw) } catch { return INVALID }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ...INVALID, protocol: u.protocol, label: `${u.protocol.replace(':', '')} link` }
  const hostname = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  let scope: OriginScope
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') scope = 'loopback'
  else if (isIPv4(hostname)) scope = ipv4Scope(hostname)
  else if (hostname.includes(':')) scope = /^(fc|fd|fe80)/.test(hostname) ? 'lan' : hostname === '::' ? 'loopback' : 'public'
  else if (hostname.endsWith('.local') || !hostname.includes('.')) scope = 'lan'
  else if (hostname.endsWith('.trycloudflare.com')) scope = 'tunnel'
  else scope = 'public'
  const secure = u.protocol === 'https:'
  const reachable = scope === 'loopback' ? 'no' : scope === 'lan' ? 'same-network' : 'yes'
  const firstSeg = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? ''
  const backend = BACKEND_PORTS.includes(u.port) && scope !== 'tunnel' && scope !== 'public' ? 'port' : BACKEND_PATHS.includes(firstSeg) ? 'path' : null
  const label = scope === 'loopback' ? 'This computer only (localhost)' : scope === 'lan' ? `Local network${secure ? '' : ' (http)'}` : scope === 'tunnel' ? 'Cloudflare Quick Tunnel' : 'Public website'
  return { valid: true, protocol: u.protocol, hostname, host: u.host, scope, secure, reachable, vrReady: secure && scope !== 'loopback', backend, idn: hostname.split('.').some((l) => l.startsWith('xn--')), label }
}

export type UrlResult = { ok: true; url: string; info: OriginInfo; warnings: string[] } | { ok: false; reason: string }

const CONTROL = /[\u0000- \u007f-\u009f]/

/** the shared checks: scheme, length, whitespace / control characters, credentials in the URL */
function parseWebUrl(text: string): { ok: true; u: URL } | { ok: false; reason: string } {
  const t = text.trim()
  if (!t) return { ok: false, reason: 'There is nothing to open: the code was empty.' }
  if (t.length > MAX_URL_LENGTH) return { ok: false, reason: 'That address is too long to be a normal web address.' }
  if (CONTROL.test(t)) return { ok: false, reason: 'That text contains spaces or hidden characters, so it is not a web address.' }
  let u: URL
  try { u = new URL(t) } catch { return { ok: false, reason: 'That is not a web address (it does not start with https:// or http://).' } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: `Only web addresses (https:// or http://) are accepted. This one is "${u.protocol.replace(':', '')}:", which could run code or open another app, so it was blocked.` }
  if (u.username || u.password) return { ok: false, reason: 'This address has a user name or password hidden in it, a common trick to disguise a link, so it was blocked.' }
  if (!u.hostname) return { ok: false, reason: 'That address has no host name.' }
  return { ok: true, u }
}

function warningsFor(info: OriginInfo, who: 'share' | 'scan'): string[] {
  const w: string[] = []
  if (info.scope === 'loopback') w.push(who === 'share' ? 'This address (localhost) only works on THIS computer. A phone or headset that scans this code will not reach it. Start the Cloudflare tunnel or use your computer\'s network address instead.' : 'This address points at the device itself (localhost), not at another computer.')
  if (info.scope === 'lan') w.push(who === 'share' ? 'This is a private network address: only devices on the same Wi-Fi / network can open it.' : 'This is a private network address (it only opens when you are on that network).')
  if (!info.secure && info.scope !== 'loopback') w.push('It uses http, not https. The Meta Quest Browser only allows immersive VR on https pages.')
  if (info.idn) w.push('The host name contains international characters (xn--). Check that it is really the site you expect.')
  return w
}

/** What a QR for "open this app on my phone / headset" should carry. `override` is a pasted address (for example the tunnel address) that replaces the page's own. */
export function buildShareUrl(current: string, override?: string): UrlResult {
  const src = (override ?? '').trim() || current
  const p = parseWebUrl(src)
  if (!p.ok) return p
  const u = p.u
  u.hash = ''                                       // a #fragment is private to the tab it was copied from
  const info = classifyOrigin(u.toString())
  if (info.backend) return { ok: false, reason: 'That address is the backend (API), not the website. A phone or headset cannot use it. Share the address of the web page instead (the one in the browser address bar).' }
  return { ok: true, url: u.toString(), info, warnings: warningsFor(info, 'share') }
}

export interface ScanResult { ok: true; url: string; info: OriginInfo; warnings: string[]; sameApp: boolean }
/** Is decoded QR text fit to be OFFERED to the person on a confirmation screen?  It is never opened automatically. */
export function validateScanned(text: string, currentHost?: string): ScanResult | { ok: false; reason: string } {
  const p = parseWebUrl(text)
  if (!p.ok) return p
  const info = classifyOrigin(p.u.toString())
  if (info.backend) return { ok: false, reason: 'This code points at the backend (API) of a server, not at a web page, so it was not opened.' }
  const sameApp = !!currentHost && info.host === currentHost.toLowerCase()
  const warnings = warningsFor(info, 'scan')
  if (!sameApp && currentHost) warnings.push('This is a different website from the one you are on now. Open it only if you trust where the code came from.')
  return { ok: true, url: p.u.toString(), info, warnings, sameApp }
}

/** the address with the host split out, for a confirmation screen that makes the real host obvious */
export function splitUrl(url: string): { before: string; host: string; after: string } {
  try { const u = new URL(url); const i = url.indexOf(u.host); return { before: url.slice(0, i), host: u.host, after: url.slice(i + u.host.length) } } catch { return { before: '', host: url, after: '' } }
}
