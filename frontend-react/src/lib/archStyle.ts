import type { ArchitecturalStyle } from '@/types'

/** The architectural styles the application offers (exact display names; the backend uses the same strings). */
export const ARCH_STYLES: readonly ArchitecturalStyle[] = ['Modern Minimalistic', 'Traditional Indian', 'Maharashtrian Wada'] as const
export const DEFAULT_ARCH_STYLE: ArchitecturalStyle = 'Modern Minimalistic'

const LEGACY: Record<string, ArchitecturalStyle> = {
  'minimalistic luxury': 'Modern Minimalistic',
  'contemporary indian': 'Modern Minimalistic',
  'modern indian': 'Modern Minimalistic',
  'traditional maharashtrian': 'Traditional Indian',
  'south indian traditional': 'Traditional Indian',
}

/** Any stored / received style value -> one of the supported styles (saved projects and old payloads keep opening). */
export function normaliseStyle(raw: unknown): ArchitecturalStyle {
  const k = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  for (const s of ARCH_STYLES) if (k === s.toLowerCase()) return s
  if (LEGACY[k]) return LEGACY[k]
  if (/\bwadas?\b/.test(k)) return 'Maharashtrian Wada'
  return /tradition|heritage|maharashtr|south indian|kerala|vintage|classic|nalukettu/.test(k) ? 'Traditional Indian' : DEFAULT_ARCH_STYLE
}

/** The courtyard checkbox starts on for the two traditional styles (as it did before) and off for the modern one. */
export const defaultCourtyardFor = (s: ArchitecturalStyle): boolean => s === 'Traditional Indian' || s === 'Maharashtrian Wada'
