import type { ArchitecturalStyle } from '@/types'
import { DEFAULT_ARCH_STYLE, normaliseStyle } from './archStyle'

/** Per-viewer convenience settings (kept in the browser; the account itself lives on the server). */
const KEY = 'rea.prefs'
export interface Prefs { style: ArchitecturalStyle; units: 'Feet' | 'Meters' }
export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { style: normaliseStyle(p.style ?? DEFAULT_ARCH_STYLE), units: p.units === 'Meters' ? 'Meters' : 'Feet' }
  } catch { return { style: DEFAULT_ARCH_STYLE, units: 'Feet' } }
}
export function savePrefs(p: Prefs): void { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* storage unavailable */ } }
