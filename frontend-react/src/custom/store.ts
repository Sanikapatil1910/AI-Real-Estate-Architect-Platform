/**
 * Undo / redo / reset / save / restore of the customisation document.  Pure (a storage object is injected), so it is unit-tested without a browser.
 * - the ORIGINAL design is the reset baseline: reset() goes back to the empty document (nothing overridden); it is itself undoable.
 * - save() writes the current document under a key (localStorage in the page; the page also copies it into the project record), restore() loads it back.
 */
import { emptyState, parseState, pruneRooms, sameState } from './types'
import type { CustomState, RoomCustom } from './types'

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const MAX_HISTORY = 100
export type StoreListener = (s: CustomState, why: string) => void

const clone = (s: CustomState): CustomState => JSON.parse(JSON.stringify(s)) as CustomState

export class CustomStore {
  private cur: CustomState = emptyState()
  private past: CustomState[] = []
  private future: CustomState[] = []
  private saved: CustomState | null = null
  private listeners = new Set<StoreListener>()
  lastSavedAt: number | null = null

  constructor(readonly key: string, private readonly storage: StorageLike | null = null) {
    this.loadSaved()
    if (this.saved) this.cur = clone(this.saved)
  }

  get state(): CustomState { return this.cur }
  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }
  get hasSaved(): boolean { return this.saved !== null }
  get savedState(): CustomState | null { return this.saved ? clone(this.saved) : null }
  /** true when the document differs from what was last saved (or from the original, when nothing was ever saved) */
  get unsaved(): boolean { return !sameState(this.cur, this.saved ?? emptyState()) }
  get changeCount(): number { return Object.keys(this.cur.roles).length + Object.values(this.cur.rooms).reduce((n, r) => n + Object.keys(r).length, 0) }

  subscribe(fn: StoreListener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit(why: string): void { for (const l of [...this.listeners]) l(this.cur, why) }

  private commit(next: CustomState, why: string): boolean {
    if (sameState(next, this.cur)) return false
    this.past.push(this.cur)
    if (this.past.length > MAX_HISTORY) this.past.shift()
    this.future = []
    this.cur = next
    this.emit(why)
    return true
  }

  /** sets or clears (choice === null) a whole-house role: 'door', 'upholstery', ... */
  setRole(key: string, choice: string | null): boolean {
    const n = clone(this.cur)
    if (choice === null) delete n.roles[key]; else n.roles[key] = choice
    return this.commit(n, `role:${key}`)
  }
  /** edits several rooms at once (one history step); `patch` returns the new RoomCustom of a room (undefined removes its customisation) */
  editRooms(keys: string[], patch: (r: RoomCustom, key: string) => RoomCustom | undefined, why = 'rooms'): boolean {
    const n = clone(this.cur)
    for (const k of keys) {
      const r = patch(clone({ v: 1, roles: {}, rooms: { x: n.rooms[k] ?? {} } }).rooms.x, k)
      if (!r || Object.keys(r).length === 0) delete n.rooms[k]; else n.rooms[k] = r
    }
    return this.commit(n, why)
  }
  /** applies a whole look (palette) in one history step */
  replace(next: CustomState, why = 'replace'): boolean { return this.commit(parseState(next), why) }

  undo(): boolean {
    const p = this.past.pop()
    if (!p) return false
    this.future.push(this.cur); this.cur = p; this.emit('undo'); return true
  }
  redo(): boolean {
    const f = this.future.pop()
    if (!f) return false
    this.past.push(this.cur); this.cur = f; this.emit('redo'); return true
  }
  /** back to the original generated design (nothing overridden); undo brings the changes back */
  reset(): boolean { return this.commit(emptyState(), 'reset') }

  save(): boolean {
    this.saved = clone(this.cur)
    this.lastSavedAt = Date.now()
    try { this.storage?.setItem(this.key, JSON.stringify({ v: 1, savedAt: this.lastSavedAt, state: this.saved })) } catch { /* private mode / quota: the in-memory copy still works */ }
    this.emit('save')
    return true
  }
  /** back to the last saved document (an undoable step); false when nothing was saved */
  restore(): boolean {
    if (!this.saved) return false
    return this.commit(clone(this.saved), 'restore')
  }
  /** a copy of the document saved elsewhere (the project record): used when nothing is saved locally yet */
  adopt(saved: unknown): boolean {
    const s = parseState(saved)
    if (this.saved || sameState(s, emptyState())) return false
    this.saved = s; this.cur = clone(s); this.past = []; this.future = []
    this.emit('adopt'); return true
  }
  /** drops what belongs to rooms the current model does not have */
  prune(roomKeys: Iterable<string>): string[] {
    const { state, dropped } = pruneRooms(this.cur, roomKeys)
    if (dropped.length) { this.cur = state; this.emit('prune') }
    return dropped
  }
  clearSaved(): void { this.saved = null; try { this.storage?.removeItem(this.key) } catch { /* ignore */ } this.emit('clear') }

  private loadSaved(): void {
    try {
      const raw = this.storage?.getItem(this.key)
      if (!raw) return
      const o = JSON.parse(raw) as { savedAt?: number; state?: unknown }
      this.saved = parseState(o.state)
      this.lastSavedAt = typeof o.savedAt === 'number' ? o.savedAt : null
    } catch { this.saved = null }
  }
}
