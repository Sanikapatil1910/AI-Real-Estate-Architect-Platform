/** One place for authenticated calls to the backend.  The token lives in localStorage (guarded: private windows can throw). */
const TOKEN_KEY = 'rea.token'
export const API_BASE = ''

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(t: string | null): void {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  status: number
  code: string
  details: string[]
  retryable: boolean
  constructor(status: number, message: string, code = '', details: string[] = [], retryable = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryable = retryable
  }
}

type Listener = () => void
const unauthorised: Listener[] = []
/** Called when the server says the token is no longer valid (expired / user removed). */
export function onUnauthorised(fn: Listener): () => void {
  unauthorised.push(fn)
  return () => { const i = unauthorised.indexOf(fn); if (i >= 0) unauthorised.splice(i, 1) }
}

function messageOf(body: unknown, status: number): { message: string; code: string; details: string[]; retryable: boolean } {
  const d = (body as { detail?: unknown } | null)?.detail
  if (typeof d === 'string') return { message: d, code: '', details: [], retryable: false }
  if (Array.isArray(d)) {   // FastAPI validation errors
    const msgs = d.map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : String(x)))
    return { message: msgs[0] || 'The request was not valid.', code: 'validation', details: msgs, retryable: false }
  }
  if (d && typeof d === 'object') {
    const o = d as { message?: unknown; code?: unknown; details?: unknown; retryable?: unknown }
    return { message: typeof o.message === 'string' ? o.message : `Request failed (${status})`, code: typeof o.code === 'string' ? o.code : '',
      details: Array.isArray(o.details) ? o.details.map(String) : [], retryable: Boolean(o.retryable) }
  }
  return { message: `Request failed (${status})`, code: '', details: [], retryable: false }
}

export async function request<T>(path: string, init: RequestInit & { json?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token && init.auth !== false) headers.set('Authorization', `Bearer ${token}`)
  let body = init.body
  if (init.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(init.json) }
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, body })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'Could not reach the server. Check your connection and that the backend is running.', 'network', [], true)
  }
  if (res.status === 204) return undefined as T
  let parsed: unknown = null
  try { parsed = await res.json() } catch { /* not JSON */ }
  if (!res.ok) {
    if (res.status === 401 && token && init.auth !== false) { setToken(null); unauthorised.slice().forEach((f) => f()) }
    const m = messageOf(parsed, res.status)
    throw new ApiError(res.status, m.message, m.code, m.details, m.retryable)
  }
  return parsed as T
}
