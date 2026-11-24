/**
 * Hands-free (continuous) voice control: a persistent speech-recognition lifecycle for the immersive VR house.
 *
 * It does NOT parse or execute anything itself: every final phrase goes to the callback `execute`, which is the engine's existing handleCommand -> SmartHouseState.execute
 * -> the same lights / fans / panel as the buttons, switches and typed commands.  This file only decides WHEN a phrase may be run:
 *
 *   - one recognizer at a time (never two instances), restarted when the browser ends it, with a back-off and a hard give-up so a failing browser cannot loop forever
 *   - a denied / revoked microphone, a missing microphone or a browser without the Web Speech API are terminal states: no restart, a clear status, manual controls keep working
 *   - only FINAL results are executed (never interim, half-heard speech), each result once, duplicate finals of the same phrase within 1.5 s are dropped,
 *     low-confidence results are dropped, and chatter that is not a Smart Home command is ignored silently
 *   - optional wake phrase ("Hey Home"): optional by default (a command works with or without it); an opt-in mode requires it
 *   - mute / resume, and stop() on leaving VR (aborts the recognizer; no audio is recorded, stored or sent by this code)
 *
 * Honest limits (docs/HANDS_FREE_VOICE.md): this is the browser's Web Speech API.  Chromium-based browsers stream the audio to the vendor's online recognizer while it
 * is on; the Meta Quest Browser is reported NOT to expose the API, and nobody has verified continuous recognition inside an immersive session on a headset.  The wake
 * phrase is matched in the recognised TEXT (there is no on-device wake-word engine), so the microphone must be listening continuously for it to work.
 *
 * Everything the browser provides (window, navigator, timers) is injected, so the whole lifecycle is unit-tested in node with a fake recognizer (dev/check_voice_continuous.ts).
 */
import { detectVoice } from './voiceInput'
import { normalize, parseCommand } from './smart/voice'

export type VcPhase = 'off' | 'starting' | 'listening' | 'processing' | 'muted' | 'denied' | 'unavailable' | 'unsupported' | 'stopped'
export type WakeMode = 'optional' | 'required'

export interface VcExecResult { understood: boolean; changed: boolean; message: string }
export interface VcStatus {
  phase: VcPhase
  /** a sentence for the person: why the microphone is unavailable, what to do, ... */
  detail: string
  /** words heard so far in the phrase being spoken (interim, never executed) */
  partial: string
  /** the last phrase that was executed */
  heard: string
  /** the outcome of that phrase */
  result: VcExecResult | null
  wake: WakeMode
  /** a wake phrase was heard and the next phrase is accepted although a wake phrase is required */
  armed: boolean
  quest: boolean
  restarts: number
}

interface RecogLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  start(): void; stop(): void; abort(): void
  onstart: (() => void) | null; onend: (() => void) | null
  onerror: ((e: { error: string; message?: string }) => void) | null
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }> & { isFinal: boolean }>; resultIndex: number }) => void) | null
}
type Ctor = new () => RecogLike
interface PermStatusLike { state: string; onchange: (() => void) | null }
interface NavLike {
  userAgent?: string
  permissions?: { query(d: { name: string }): Promise<PermStatusLike> }
  mediaDevices?: { getUserMedia(c: { audio: boolean }): Promise<{ getTracks(): Array<{ stop(): void }> }> }
}
export interface VcEnv {
  win: unknown
  nav: unknown
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
  now: () => number
}
const realEnv = (): VcEnv => ({
  win: typeof window !== 'undefined' ? window : undefined,
  nav: typeof navigator !== 'undefined' ? navigator : undefined,
  setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), now: () => Date.now(),
})

export interface VcOptions {
  /** run a final phrase through the existing command pipeline */
  execute: (text: string) => VcExecResult
  onStatus: (s: VcStatus) => void
  env?: VcEnv
  lang?: string
  wake?: WakeMode
}

// ---- tuning (milliseconds unless noted)
export const RESTART_BASE_MS = 300
export const RESTART_MAX_MS = 5000
/** a run shorter than this that produced no final result counts as a "quick end" */
export const QUICK_RUN_MS = 1500
/** this many quick ends in a row and the recognizer gives up (status 'stopped', Resume to try again) */
export const MAX_QUICK_ENDS = 6
export const DUPLICATE_WINDOW_MS = 1500
export const MIN_CONFIDENCE = 0.35
export const WAKE_ARMED_MS = 8000
/** how long the "executed" outcome stays on the status indicator before it returns to "listening" */
export const RESULT_SHOW_MS = 3000

/** wake phrases, matched at the START of a phrase after normalisation ("Hey, Home!" -> "hey home") */
export const WAKE_PHRASES = ['hey home', 'hi home', 'ok home', 'okay home', 'hey smart home']

/** text -> { woke, rest }: strips a leading wake phrase */
export function splitWake(text: string): { woke: boolean; rest: string } {
  const n = normalize(text)
  for (const w of WAKE_PHRASES) {
    if (n === w) return { woke: true, rest: '' }
    if (n.startsWith(w + ' ')) return { woke: true, rest: n.slice(w.length + 1) }
  }
  return { woke: false, rest: n }
}
const DEVICE_WORD = /\b(lights?|lamps?|fans?|lighting)\b/

export class ContinuousVoice {
  private readonly env: VcEnv
  private readonly lang: string
  private s: VcStatus
  private rec: RecogLike | null = null
  private recId = 0
  private gen = 0
  private wanted = false
  private muted = false
  private runStart = 0
  private gotResult = false
  private quick = 0
  private restartTimer: unknown = null
  private resultTimer: unknown = null
  private armedTimer: unknown = null
  private handled = new Set<string>()
  private lastText = ''
  private lastTextAt = -1e9
  private permWatch: PermStatusLike | null = null
  /** how many recognizer objects exist / were ever created (the duplicate-instance guarantee is tested on these) */
  instancesCreated = 0
  activeInstances = 0

  constructor(private readonly opt: VcOptions) {
    this.env = opt.env ?? realEnv()
    this.lang = opt.lang ?? 'en-US'
    const ua = (this.env.nav as NavLike | undefined)?.userAgent ?? ''
    this.s = { phase: 'off', detail: '', partial: '', heard: '', result: null, wake: opt.wake ?? 'optional', armed: false, quest: /OculusBrowser|Quest/i.test(ua), restarts: 0 }
  }

  get status(): VcStatus { return this.s }
  /** the recognizer is meant to be running (VR is on, not muted, not refused) */
  get active(): boolean { return this.wanted && !this.muted && (this.s.phase === 'listening' || this.s.phase === 'processing' || this.s.phase === 'starting') }
  get supported(): boolean { return detectVoice(this.env.win).available }
  get unsupportedReason(): string { return detectVoice(this.env.win).reason }

  setWake(mode: WakeMode): void { this.set({ wake: mode, armed: false }) }

  // ------------------------------------------------------------------ lifecycle
  /** call when immersive VR starts (the person pressed Enter VR): asks for the microphone, then keeps listening */
  async start(): Promise<void> {
    if (this.wanted) return
    const g = ++this.gen
    this.muted = false; this.quick = 0
    const sup = detectVoice(this.env.win)
    if (!sup.available) {
      this.set({ phase: 'unsupported', detail: sup.reason + (this.s.quest ? ' (Meta Quest Browser: hands-free recognition is not verified there.)' : '') })
      return
    }
    this.wanted = true
    this.set({ phase: 'starting', detail: 'Allow the microphone if asked', partial: '' })
    const perm = await this.requestMic()
    if (g !== this.gen || !this.wanted) return                      // VR was left (or the person muted) while the permission prompt was open
    if (!perm.ok) { this.wanted = false; this.set({ phase: perm.phase, detail: perm.detail }); return }
    void this.watchPermission(g)
    this.launch()
  }

  /** leaving VR: abort the recognizer, drop every timer and watcher.  Nothing is listening afterwards. */
  stop(): void {
    this.gen++
    this.wanted = false; this.muted = false
    this.killRecognizer()
    this.clearTimers()
    this.unwatchPermission()
    this.handled.clear()
    this.set({ phase: 'off', detail: '', partial: '', armed: false })
  }

  /** the person mutes: the microphone is released and nothing restarts it until resume() */
  mute(): void {
    if (!this.wanted) return
    this.muted = true
    this.killRecognizer()
    this.clearRestart()
    this.set({ phase: 'muted', detail: 'Hands-free listening is muted. Resume to listen again.', partial: '', armed: false })
  }

  /** the person resumes (also the way out of 'stopped' / 'denied' once they fixed the cause): a fresh start, permission checked again */
  async resume(): Promise<void> {
    if (this.s.phase === 'unsupported') return
    this.gen++
    this.wanted = false; this.muted = false
    this.killRecognizer(); this.clearTimers(); this.unwatchPermission()
    await this.start()
  }

  // ------------------------------------------------------------------ microphone permission (explicit; nothing starts without it)
  private async requestMic(): Promise<{ ok: true } | { ok: false; phase: VcPhase; detail: string }> {
    const nav = this.env.nav as NavLike | undefined
    try {
      const q = await nav?.permissions?.query({ name: 'microphone' })
      if (q && q.state === 'denied') return { ok: false, phase: 'denied', detail: 'Microphone permission is blocked for this site. Allow it in the browser settings, then press Resume. Typed commands and the control panel still work.' }
    } catch { /* the Permissions API does not know 'microphone' here: ask directly below */ }
    if (nav?.mediaDevices?.getUserMedia) {
      try {
        const stream = await nav.mediaDevices.getUserMedia({ audio: true })
        for (const t of stream.getTracks()) t.stop()                   // the prompt is answered; the stream is NOT kept (no recording, nothing held)
      } catch (e) {
        const name = (e as { name?: string }).name ?? ''
        if (name === 'NotFoundError' || name === 'OverconstrainedError') return { ok: false, phase: 'unavailable', detail: 'No microphone was found.' }
        if (name === 'NotReadableError' || name === 'AbortError') return { ok: false, phase: 'unavailable', detail: 'The microphone is in use by another app or could not be opened.' }
        return { ok: false, phase: 'denied', detail: 'Microphone permission was refused. Typed commands and the control panel still work; allow the microphone and press Resume to use your voice.' }
      }
    }
    return { ok: true }
  }

  private async watchPermission(g: number): Promise<void> {
    try {
      const q = await (this.env.nav as NavLike | undefined)?.permissions?.query({ name: 'microphone' })
      if (!q || g !== this.gen) return
      this.permWatch = q
      q.onchange = () => {
        if (g !== this.gen || !this.wanted) return
        if (q.state === 'denied') {                                    // revoked while listening: stop for good
          this.wanted = false
          this.killRecognizer(); this.clearRestart()
          this.set({ phase: 'denied', detail: 'Microphone permission was withdrawn. Allow it again and press Resume.', partial: '', armed: false })
        }
      }
    } catch { /* no Permissions API: a revocation then shows up as a 'not-allowed' recognition error */ }
  }
  private unwatchPermission(): void { if (this.permWatch) this.permWatch.onchange = null; this.permWatch = null }

  // ------------------------------------------------------------------ the recognizer (one at a time)
  private launch(): void {
    if (!this.wanted || this.muted || this.rec) return                  // already running: never a second instance
    const win = this.env.win as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }
    const C = (win.SpeechRecognition ?? win.webkitSpeechRecognition) as Ctor
    let rec: RecogLike
    try { rec = new C() } catch (e) { this.fail('unavailable', `Could not start speech recognition: ${(e as Error).message}`); return }
    const id = ++this.recId
    const g = this.gen
    this.instancesCreated++; this.activeInstances++
    rec.lang = this.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1
    rec.onstart = () => { if (this.isCurrent(id, g)) { this.runStart = this.env.now(); this.gotResult = false; if (this.s.phase === 'starting' || this.s.phase === 'stopped') this.set({ phase: 'listening', detail: '' }) } }
    rec.onresult = (e) => { if (this.isCurrent(id, g)) this.onResult(e, id) }
    rec.onerror = (e) => { if (this.isCurrent(id, g)) this.onError(e.error) }
    rec.onend = () => { this.activeInstances = Math.max(0, this.activeInstances - 1); if (this.rec === rec) this.rec = null; if (this.isCurrent(id, g, true)) this.onEnd() }
    this.rec = rec
    this.runStart = this.env.now(); this.gotResult = false
    try { rec.start() } catch (e) {
      // InvalidStateError = a previous run is still shutting down: treat as a quick end and retry with the back-off
      this.rec = null; this.activeInstances = Math.max(0, this.activeInstances - 1)
      void e
      this.scheduleRestart()
    }
  }

  private isCurrent(id: number, g: number, allowDead = false): boolean { return g === this.gen && (allowDead ? true : id === this.recId) && this.wanted && !this.muted }

  private killRecognizer(): void {
    const r = this.rec
    this.rec = null
    if (!r) return
    r.onresult = null; r.onerror = null; r.onstart = null
    r.onend = () => { this.activeInstances = Math.max(0, this.activeInstances - 1) }
    try { r.abort() } catch { try { r.stop() } catch { /* already stopped */ } }
  }

  private onEnd(): void {
    // the browser ended the recognizer (silence timeout, network blip, tab hidden, ...): restart it unless that is forbidden
    const ranMs = this.env.now() - this.runStart
    if (!this.gotResult && ranMs < QUICK_RUN_MS) this.quick++; else this.quick = 0
    if (this.quick >= MAX_QUICK_ENDS) {
      this.wanted = false
      this.set({ phase: 'stopped', detail: 'Speech recognition keeps stopping on this browser, so hands-free listening was switched off. Press Resume to try again, or use the control panel.', partial: '' })
      return
    }
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    this.clearRestart()
    const delay = Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** Math.max(0, this.quick - 1))
    const g = this.gen
    this.set({ restarts: this.s.restarts + 1 })
    this.restartTimer = this.env.setTimeout(() => { this.restartTimer = null; if (g === this.gen) this.launch() }, delay)
  }

  private onError(code: string): void {
    switch (code) {
      case 'not-allowed': case 'service-not-allowed':
        this.fail('denied', 'Microphone permission was refused or withdrawn, or this browser blocks speech recognition here. Typed commands and the control panel still work.'); break
      case 'audio-capture': this.fail('unavailable', 'No microphone was found (or it is in use by another app).'); break
      case 'language-not-supported': this.fail('unavailable', 'This browser cannot recognise the speech language (en-US).'); break
      case 'network': this.quick++; this.set({ detail: "The browser's online speech service could not be reached (speech recognition needs internet). Retrying." }); break
      case 'no-speech': case 'aborted': break                           // silence: onend follows and restarts
      default: this.quick++; this.set({ detail: `Speech recognition error: ${code}` })
    }
  }

  /** a terminal failure: nothing restarts (no infinite loop on a refusal) */
  private fail(phase: VcPhase, detail: string): void {
    this.wanted = false
    this.killRecognizer(); this.clearRestart()
    this.set({ phase, detail, partial: '', armed: false })
  }

  // ------------------------------------------------------------------ results
  private onResult(e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }> & { isFinal: boolean }>; resultIndex: number }, id: number): void {
    this.gotResult = true
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      const alt = r[0]
      if (!alt) continue
      if (!r.isFinal) { this.set({ partial: alt.transcript }); continue }   // half-heard speech is shown, never executed
      const key = `${id}:${i}`
      if (this.handled.has(key)) continue                              // this result was already run
      this.handled.add(key)
      if (this.handled.size > 400) this.handled = new Set([...this.handled].slice(-100))
      this.onFinal(alt.transcript, alt.confidence)
    }
  }

  private onFinal(text: string, confidence?: number): void {
    this.set({ partial: '' })
    if (typeof confidence === 'number' && confidence > 0 && confidence < MIN_CONFIDENCE) return   // too unsure: background noise
    const now = this.env.now()
    const { woke, rest } = splitWake(text)
    const key = normalize(text)
    if (!key) return
    if (key === this.lastText && now - this.lastTextAt < DUPLICATE_WINDOW_MS) return               // the same phrase twice in a row: once
    this.lastText = key; this.lastTextAt = now
    if (woke) { this.arm() }
    if (rest === '') return                                            // just "Hey Home": armed, waiting for the command
    const armed = this.s.armed
    if (this.s.wake === 'required' && !woke && !armed) return          // wake phrase required and not heard
    const cmd = parseCommand(rest)
    if (cmd.kind === 'unknown' && !woke && !armed && !DEVICE_WORD.test(rest)) return   // everyday chatter: ignore silently (no "not understood" noise)
    this.set({ phase: 'processing', detail: '' })
    let res: VcExecResult
    try { res = this.opt.execute(rest) } catch (err) { res = { understood: false, changed: false, message: `Error: ${(err as Error).message}` } }
    this.disarm()
    this.set({ phase: this.wanted && !this.muted ? 'listening' : this.s.phase, heard: text.trim(), result: res })
    this.clearTimer('resultTimer')
    this.resultTimer = this.env.setTimeout(() => { this.resultTimer = null; this.set({ result: null }) }, RESULT_SHOW_MS)
  }

  private arm(): void {
    this.clearTimer('armedTimer')
    this.set({ armed: true })
    this.armedTimer = this.env.setTimeout(() => { this.armedTimer = null; this.set({ armed: false }) }, WAKE_ARMED_MS)
  }
  private disarm(): void { this.clearTimer('armedTimer'); if (this.s.armed) this.set({ armed: false }) }

  // ------------------------------------------------------------------ plumbing
  private clearRestart(): void { if (this.restartTimer != null) { this.env.clearTimeout(this.restartTimer); this.restartTimer = null } }
  private clearTimer(k: 'resultTimer' | 'armedTimer'): void { const h = this[k]; if (h != null) { this.env.clearTimeout(h); this[k] = null } }
  private clearTimers(): void { this.clearRestart(); this.clearTimer('resultTimer'); this.clearTimer('armedTimer') }
  private set(p: Partial<VcStatus>): void { this.s = { ...this.s, ...p }; this.opt.onStatus(this.s) }
}

/** what the small status indicator (VR head-up pill and the desktop line) shows for a status: null = nothing to show */
export interface HudInfo { text: string; tone: 'good' | 'busy' | 'bad' | 'idle' }
export function hudInfo(s: VcStatus): HudInfo | null {
  const cut = (t: string, n = 44) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
  switch (s.phase) {
    case 'off': return null
    case 'starting': return { text: 'Allow the microphone…', tone: 'busy' }
    case 'processing': return { text: 'Processing command…', tone: 'busy' }
    case 'muted': return { text: 'Mic muted — tap MIC to resume', tone: 'idle' }
    case 'denied': return { text: 'Microphone unavailable (permission)', tone: 'bad' }
    case 'unavailable': return { text: 'Microphone unavailable', tone: 'bad' }
    case 'stopped': return { text: 'Voice stopped — tap MIC to retry', tone: 'bad' }
    case 'unsupported': return { text: 'Voice recognition unsupported', tone: 'bad' }
    case 'listening': {
      if (s.result) return { text: s.result.understood ? `✓ ${cut(s.result.message)}` : `? ${cut(s.result.message)}`, tone: s.result.understood ? 'good' : 'busy' }
      if (s.armed) return { text: 'Hey Home — say a command', tone: 'good' }
      if (s.partial) return { text: cut(`Hearing: ${s.partial}`), tone: 'good' }
      return { text: s.wake === 'required' ? 'Listening for “Hey Home”' : 'Listening', tone: 'good' }
    }
  }
}
