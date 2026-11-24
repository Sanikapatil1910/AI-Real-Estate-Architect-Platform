/** Sentence -> command parser and the voice status board (ports of the tested Unity VoiceCommandParser / VoiceStatusBoard). Rule based; never guesses a room. */

export type RoomScope = 'current' | 'all' | 'type'
export interface RoomQuery {
  scope: RoomScope
  types: string[]
  /** 1-based ("bedroom two"); 0 = every match */
  ordinal: number
  floorMin: number
  floorMax: number
  label: string
}
export const newRoomQuery = (): RoomQuery => ({ scope: 'current', types: [], ordinal: 0, floorMin: 0, floorMax: Number.MAX_SAFE_INTEGER, label: '' })

export type CommandKind = 'unknown' | 'lightOn' | 'lightOff' | 'fanOn' | 'fanOff' | 'fanSet' | 'fanFaster' | 'fanSlower' | 'autoOn' | 'autoOff' | 'panelShow' | 'panelHide'
export interface VoiceCommand { kind: CommandKind; level: number; room: RoomQuery; heard: string; normalized: string }
export const isFanCommand = (k: CommandKind): boolean => k === 'fanOn' || k === 'fanOff' || k === 'fanSet' || k === 'fanFaster' || k === 'fanSlower'

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five']
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth']
const LIGHT_WORDS = new Set(['light', 'lights', 'lamp', 'lamps', 'bulb', 'bulbs', 'lighting', 'tubelight'])
const FAN_WORDS = new Set(['fan', 'fans'])
const VERBS = new Set(['turn', 'switch', 'put', 'shut', 'power', 'set'])

export function normalize(s: string | null | undefined): string {
  if (!s) return ''
  let out = ''
  let space = true
  for (const ch of s.toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(ch)) { out += ch; space = false } else if (!space) { out += ' '; space = true }
  }
  return out.trim()
}

const has = (t: string[], ...w: string[]) => w.some((x) => t.includes(x))

function action(t: string[]): number {
  for (let i = 0; i + 1 < t.length; i++) {
    if (VERBS.has(t[i])) {
      for (let j = i + 1; j < Math.min(t.length, i + 3); j++) {
        if (t[j] === 'on') return 1
        if (t[j] === 'off') return -1
      }
    }
  }
  const off = has(t, 'off', 'disable', 'deactivate', 'stop', 'kill')
  const on = has(t, 'on', 'enable', 'activate', 'start', 'illuminate')
  if (off && !on) return -1
  if (on && !off) return 1
  if (off && on) return t.lastIndexOf('off') > t.lastIndexOf('on') ? -1 : 1
  if (has(t, 'out') && has(t, 'lights', 'light')) return -1
  if (has(t, 'up') && has(t, 'light')) return 1
  return 0
}

interface Phrase { words: string[]; types: string[]; label: string }
const P = (w: string, label: string, ...types: string[]): Phrase => ({ words: w.split(' '), types, label })
const BED = ['bedroom', 'master_bedroom', 'guest_bedroom']
const ROOM_PHRASES: Phrase[] = [
  P('master bedroom', 'master bedroom', 'master_bedroom'), P('master bed room', 'master bedroom', 'master_bedroom'),
  P('guest bedroom', 'guest bedroom', 'guest_bedroom'), P('guest room', 'guest room', 'guest_bedroom'),
  P('family lounge', 'family lounge', 'family_lounge'), P('family room', 'family room', 'family_lounge'),
  P('living room', 'living room', 'living_room'), P('drawing room', 'living room', 'living_room'),
  P('dining room', 'dining room', 'dining'),
  P('puja room', 'puja room', 'puja_room'), P('pooja room', 'puja room', 'puja_room'),
  P('bed room', 'bedroom', ...BED), P('bath room', 'bathroom', 'bathroom'),
  P('bedroom', 'bedroom', ...BED), P('bedrooms', 'bedroom', ...BED),
  P('bathroom', 'bathroom', 'bathroom'), P('bathrooms', 'bathroom', 'bathroom'),
  P('washroom', 'bathroom', 'bathroom'), P('toilet', 'bathroom', 'bathroom'), P('restroom', 'bathroom', 'bathroom'), P('bath', 'bathroom', 'bathroom'),
  P('kitchen', 'kitchen', 'kitchen'),
  P('living', 'living room', 'living_room'), P('hall', 'living room', 'living_room'),
  P('lounge', 'lounge', 'family_lounge', 'living_room'),
  P('dining', 'dining room', 'dining'), P('utility', 'utility', 'utility'),
  P('pooja', 'puja room', 'puja_room'), P('puja', 'puja room', 'puja_room'), P('prayer', 'puja room', 'puja_room'),
  P('study', 'study', 'study'), P('office', 'study', 'study'),
  P('passage', 'passage', 'passage'), P('corridor', 'passage', 'passage'), P('hallway', 'passage', 'passage'),
  P('staircase', 'staircase', 'staircase'), P('stairs', 'staircase', 'staircase'), P('stair', 'staircase', 'staircase'), P('stairway', 'staircase', 'staircase'),
]

const ordinalOf = (w: string): number => { for (let i = 1; i < ORDINALS.length; i++) if (ORDINALS[i] === w) return i; return 0 }
function numberOf(w: string): number {
  for (let i = 1; i < NUMBERS.length; i++) if (NUMBERS[i] === w) return i
  if (/^[1-5]$/.test(w)) return Number(w)
  return 0
}

function rooms(t: string[]): { q: RoomQuery; ordinalIdx: number } {
  const q = newRoomQuery()
  let ordinalIdx = -1
  let phraseStart = -1, phraseEnd = -1
  for (const ph of ROOM_PHRASES) {
    for (let i = 0; i + ph.words.length <= t.length; i++) {
      if (ph.words.every((w, k) => t[i + k] === w)) {
        q.scope = 'type'; q.types = [...ph.types]; q.label = ph.label
        phraseStart = i; phraseEnd = i + ph.words.length - 1
        break
      }
    }
    if (phraseEnd >= 0) break
  }
  const floorWordIdx = new Set<number>()
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'ground' && t[i + 1] === 'floor') { q.floorMin = 0; q.floorMax = 0; floorWordIdx.add(i) }
    else if (i + 1 < t.length && t[i + 1] === 'floor') {
      const o = ordinalOf(t[i])
      if (o > 0) { q.floorMin = o; q.floorMax = o; floorWordIdx.add(i) }
    } else if (t[i] === 'upstairs' || t[i] === 'upper') { q.floorMin = 1; floorWordIdx.add(i) }
    else if (t[i] === 'downstairs' || t[i] === 'lower') { q.floorMin = 0; q.floorMax = 0; floorWordIdx.add(i) }
  }
  if (q.scope === 'type') {
    const a = phraseStart - 1, b = phraseEnd + 1
    if (a >= 0 && !floorWordIdx.has(a) && ordinalOf(t[a]) > 0) { q.ordinal = ordinalOf(t[a]); ordinalIdx = a }
    else if (b < t.length) {
      let j = b
      if ((t[j] === 'number' || t[j] === 'no') && j + 1 < t.length) j++
      const n = numberOf(t[j])
      if (n > 0) { q.ordinal = n; ordinalIdx = j }
    }
  }
  const all = has(t, 'all', 'every', 'everything', 'whole', 'entire')
  if (all && q.scope !== 'type') q.scope = 'all'
  if (q.scope === 'current' && (q.floorMin > 0 || q.floorMax < Number.MAX_SAFE_INTEGER)) q.scope = 'all'
  if (q.scope === 'all' && q.label.length === 0) q.label = 'all rooms'
  return { q, ordinalIdx }
}

function fanLevel(t: string[], ordinalIdx: number): number {
  if (has(t, 'maximum', 'max', 'full', 'highest', 'fastest')) return 5
  if (has(t, 'minimum', 'min', 'lowest', 'slowest')) return 1
  if (has(t, 'medium', 'middle')) return 3
  let found = -1
  for (let i = 0; i < t.length; i++) {
    let v = -1
    for (let k = 0; k < NUMBERS.length; k++) if (t[i] === NUMBERS[k]) v = k
    if (v < 0 && /^[0-5]$/.test(t[i])) v = Number(t[i])
    if (v < 0 && (t[i] === 'for' || t[i] === 'fore') && i === t.length - 1 && i > 0 && (t[i - 1] === 'speed' || t[i - 1] === 'level')) v = 4
    if (v < 0) continue
    if (i === ordinalIdx) continue
    found = v
  }
  return found
}

export function parseCommand(transcript: string | null | undefined): VoiceCommand {
  const cmd: VoiceCommand = { kind: 'unknown', level: 0, room: newRoomQuery(), heard: transcript ?? '', normalized: '' }
  const norm = normalize(transcript)
  cmd.normalized = norm
  if (!norm) return cmd
  const t = norm.split(' ')
  if (has(t, 'automatic', 'automatically', 'auto', 'automation', 'motion', 'sensor', 'sensors')) {
    const a = action(t)
    if (a > 0) cmd.kind = 'autoOn'; else if (a < 0) cmd.kind = 'autoOff'
    return cmd
  }
  if (has(t, 'panel', 'controls', 'menu', 'dashboard')) {
    if (has(t, 'show', 'open', 'display', 'bring', 'recall', 'where')) { cmd.kind = 'panelShow'; return cmd }
    if (has(t, 'hide', 'close', 'dismiss', 'remove')) { cmd.kind = 'panelHide'; return cmd }
  }
  const light = t.some((w) => LIGHT_WORDS.has(w))
  const fan = t.some((w) => FAN_WORDS.has(w))
  const act = action(t)
  const r = rooms(t)
  cmd.room = r.q
  if (fan && !light) {
    const lvl = fanLevel(t, r.ordinalIdx)
    if (act < 0 && lvl < 0) { cmd.kind = 'fanOff'; cmd.level = 0 }
    else if (lvl >= 0) { cmd.kind = 'fanSet'; cmd.level = lvl }
    else if (has(t, 'faster', 'increase', 'higher', 'more', 'up') && !(has(t, 'on') && !has(t, 'speed', 'faster'))) cmd.kind = 'fanFaster'
    else if (has(t, 'slower', 'decrease', 'lower', 'less', 'down', 'reduce')) cmd.kind = 'fanSlower'
    else if (act > 0) cmd.kind = 'fanOn'
    return cmd
  }
  if (light && !fan) {
    if (act > 0) cmd.kind = 'lightOn'; else if (act < 0) cmd.kind = 'lightOff'
  }
  return cmd
}

// ---------------------------------------------------------------- status board
export type BackendState = 'idle' | 'requestingPermission' | 'permissionDenied' | 'unavailable' | 'listening' | 'processing' | 'error' | 'muted'
export type VoicePhase = 'noBackend' | 'requestingPermission' | 'micUnavailable' | 'idle' | 'listening' | 'processing' | 'hearing' | 'recognized' | 'completed' | 'notUnderstood' | 'noTarget' | 'muted'
/** hands-free (continuous) listening as the panel's MIC button sees it */
export type HandsFree = 'unsupported' | 'off' | 'on' | 'muted'
export type Tone = 'neutral' | 'good' | 'warn' | 'bad'
export interface CommandResultLike { understood: boolean; changed: boolean; message: string; roomKeys: string[] }

export class VoiceStatusBoard {
  recognizedSeconds = 0.5
  resultSeconds = 3
  private hasBackend = false
  private backend: BackendState = 'idle'
  private backendDetail = ''
  private heard = ''
  private message = ''
  private transient: VoicePhase = 'noBackend'
  private transientLeft = 0
  private partial = ''
  /** the state of hands-free listening, for the panel's MIC button (the engine sets it) */
  handsFree: HandsFree = 'off'

  get backendPresent(): boolean { return this.hasBackend }
  setBackend(present: boolean): void { this.hasBackend = present; if (!present) { this.backend = 'idle'; this.backendDetail = '' } }
  onBackendState(s: BackendState, detail = ''): void { this.hasBackend = true; this.backend = s; this.backendDetail = detail }
  onPartial(text: string): void { this.partial = text ?? '' }
  onCommand(heardText: string, r: CommandResultLike | null): void {
    this.partial = ''
    this.heard = (heardText ?? '').trim()
    this.message = r ? r.message : ''
    if (!r) return
    if (!r.understood) { this.transient = 'notUnderstood'; this.transientLeft = this.resultSeconds; return }
    if (r.roomKeys.length === 0 && !r.changed) { this.transient = 'noTarget'; this.transientLeft = this.resultSeconds; return }
    this.transient = 'recognized'; this.transientLeft = this.recognizedSeconds
  }
  tick(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return
    while (this.transient !== 'noBackend' && dt > 0) {
      if (dt < this.transientLeft) { this.transientLeft -= dt; return }
      dt -= this.transientLeft
      if (this.transient === 'recognized') { this.transient = 'completed'; this.transientLeft = this.resultSeconds }
      else { this.transient = 'noBackend'; this.transientLeft = 0 }
    }
  }
  get phase(): VoicePhase {
    if (this.transient !== 'noBackend') return this.transient
    if (!this.hasBackend) return 'noBackend'
    switch (this.backend) {
      case 'requestingPermission': return 'requestingPermission'
      case 'permissionDenied': case 'unavailable': case 'error': return 'micUnavailable'
      case 'processing': return 'processing'
      case 'muted': return 'muted'
      case 'listening': return this.partial.length > 0 ? 'hearing' : 'listening'
      default: return 'idle'
    }
  }
  get headline(): string {
    switch (this.phase) {
      case 'noBackend': return 'Voice: off (use the panel)'
      case 'requestingPermission': return 'Voice: asking for microphone permission'
      case 'micUnavailable': return 'Microphone unavailable'
      case 'idle': return 'Voice: not listening'
      case 'muted': return 'Voice: muted'
      case 'listening': return 'Listening...'
      case 'hearing': return `Listening: ${this.partial}`
      case 'processing': return 'Processing...'
      case 'recognized': return 'Command recognized'
      case 'completed': return 'Action completed'
      case 'notUnderstood': return 'Command not understood'
      case 'noTarget': return 'Command recognized, nothing to act on'
    }
  }
  get detail(): string {
    switch (this.phase) {
      case 'micUnavailable': return this.backendDetail || 'check the microphone permission'
      case 'muted': return 'press MIC to listen again'
      case 'requestingPermission': return this.backendDetail
      case 'recognized': return `“${this.heard}”`
      case 'completed': case 'noTarget': return this.message
      case 'notUnderstood': return this.heard ? `“${this.heard}”` : this.message
      default: return ''
    }
  }
  get tone(): Tone {
    switch (this.phase) {
      case 'completed': case 'recognized': case 'listening': case 'hearing': return 'good'
      case 'notUnderstood': case 'noTarget': case 'requestingPermission': return 'warn'
      case 'micUnavailable': return 'bad'
      default: return 'neutral'
    }
  }
}
