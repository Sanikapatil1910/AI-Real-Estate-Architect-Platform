/**
 * Browser speech recognition, used ONLY if the browser really offers it.  Nothing is faked: when the Web Speech API is missing, or the microphone / the
 * browser's online speech service refuses, the status board says "Microphone unavailable" with the reason and every manual control keeps working.
 *
 * Honest limits (see docs/QUEST2_WEBXR_COMPATIBILITY.md): the Web Speech API in Chromium-based browsers sends audio to an online service of the browser vendor;
 * reports from Quest developers say the Meta Quest Browser does not expose it, and nobody has verified it inside an immersive session.  This code is
 * written to degrade cleanly and has NOT been run on a headset.
 */
import type { BackendState } from './smart/voice'

export interface VoiceSupport { available: boolean; reason: string }

interface RecogLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  start(): void; stop(): void; abort(): void
  onstart: (() => void) | null; onend: (() => void) | null
  onerror: ((e: { error: string; message?: string }) => void) | null
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null
}
type Ctor = new () => RecogLike

export function detectVoice(w: unknown = typeof window !== 'undefined' ? window : undefined): VoiceSupport {
  const win = w as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor; isSecureContext?: boolean } | undefined
  if (!win) return { available: false, reason: 'No browser window.' }
  if (win.isSecureContext === false) return { available: false, reason: 'Speech recognition needs a secure (https) page.' }
  if (!win.SpeechRecognition && !win.webkitSpeechRecognition) return { available: false, reason: 'This browser does not provide speech recognition (Web Speech API). Use the control panel or the wall switches.' }
  return { available: true, reason: '' }
}

export interface VoiceCallbacks {
  onState: (s: BackendState, detail: string) => void
  onPartial: (text: string) => void
  onFinal: (text: string) => void
}

export class VoiceInput {
  private rec: RecogLike | null = null
  private active = false
  constructor(private readonly cb: VoiceCallbacks, private readonly w: unknown = typeof window !== 'undefined' ? window : undefined, readonly lang = 'en-US') {}
  get support(): VoiceSupport { return detectVoice(this.w) }

  /** push-to-talk: listens for one phrase */
  start(): void {
    const sup = this.support
    if (!sup.available) { this.cb.onState('unavailable', sup.reason); return }
    if (this.active) return
    const win = this.w as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }
    const C = (win.SpeechRecognition ?? win.webkitSpeechRecognition) as Ctor
    let rec: RecogLike
    try { rec = new C() } catch (e) { this.cb.onState('error', `Could not start speech recognition: ${(e as Error).message}`); return }
    rec.lang = this.lang; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1
    rec.onstart = () => this.cb.onState('listening', '')
    rec.onresult = (e) => {
      let interim = '', final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0]?.transcript ?? ''
        if (r.isFinal) final += t; else interim += t
      }
      if (interim) this.cb.onPartial(interim)
      if (final) { this.cb.onState('processing', ''); this.cb.onFinal(final) }
    }
    rec.onerror = (e) => {
      this.active = false
      switch (e.error) {
        case 'not-allowed': case 'service-not-allowed': this.cb.onState('permissionDenied', 'Microphone permission was refused, or the browser blocks speech recognition here.'); break
        case 'audio-capture': this.cb.onState('unavailable', 'No microphone was found.'); break
        case 'network': this.cb.onState('unavailable', "The browser's online speech service could not be reached (speech recognition needs internet)."); break
        case 'no-speech': this.cb.onState('idle', ''); break
        case 'aborted': this.cb.onState('idle', ''); break
        default: this.cb.onState('error', `Speech recognition error: ${e.error}`)
      }
    }
    rec.onend = () => { if (this.active) { this.active = false; this.cb.onState('idle', '') } }
    this.rec = rec
    this.active = true
    this.cb.onState('requestingPermission', 'allow the microphone if the browser asks')
    try { rec.start() } catch (e) { this.active = false; this.cb.onState('error', `Could not start speech recognition: ${(e as Error).message}`) }
  }
  stop(): void { try { this.rec?.stop() } catch { /* already stopped */ } }
  get listening(): boolean { return this.active }
}
