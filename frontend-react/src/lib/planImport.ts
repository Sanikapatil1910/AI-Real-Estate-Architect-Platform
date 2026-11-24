import { request } from './http'
import type { Plan } from '@/types'

export type Provenance = 'detected' | 'inferred'
export type Confidence = 'high' | 'medium' | 'low'
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface ReadRoom { id: string; label: string | null; room_type: string; box: Box; shape: string; dimension_text: string | null; width_ft: number | null; length_ft: number | null; provenance: Provenance; confidence: Confidence }
export interface Reading {
  image: { width: number; height: number; mime: string; bytes: number }
  model: string; is_floor_plan: boolean; legible: boolean; floor_label: string | null; north: string | null
  rooms: ReadRoom[]; doors: unknown[]; windows: unknown[]; scale_clues: unknown[]; unknown: string[]; notes: string[]
}
export interface ScaleCandidate { room_id: string; label: string; axis: 'width' | 'length'; feet: number; ft_per_px: number }
export interface ScaleSuggestion { candidates: ScaleCandidate[]; proposal: { ft_per_px: number; n: number; spread_pct: number; basis: string } | null; needs_reference: boolean; disagree_pct?: number }
export interface AnalyzeResult { reading: Reading; scale: ScaleSuggestion; source: 'gemini' | 'manual' }

export type ScaleSpec =
  | { mode: 'approximate' }
  | { mode: 'reference'; room_id: string; axis: 'width' | 'length'; feet: number }
  | { mode: 'overall'; axis: 'width' | 'length'; feet: number }
  | { mode: 'manual' }

export type Wall = 'top' | 'bottom' | 'left' | 'right'
export type Source = 'detected' | 'inferred' | 'manual' | 'assumed'
export interface DraftRoom { id: string; name: string; room_type: string; x: number; y: number; width: number; length: number; source: Source; confidence: Confidence; note: string | null }
export interface DraftDoor { id: string; room: string; wall: Wall | ''; position: number; width: number; door_type: string; connects_to: string | null; source: Source; confidence: Confidence; width_assumed: boolean }
export interface DraftWindow { id: string; room: string; wall: Wall | ''; position: number; width: number; source: Source; confidence: Confidence; width_assumed: boolean }
export interface Draft {
  version: 1
  scale: { ft_per_px: number | null; source: string; approximate: boolean; description: string; origin_px?: { x: number; y: number } }
  floor_label: string
  rooms: DraftRoom[]; doors: DraftDoor[]; windows: DraftWindow[]
  adjustments: string[]; uncertainties: string[]; assumptions: string[]
  check?: { errors: string[]; warnings: string[] }
}
export interface ImportStatus { gemini_available: boolean; models: string[]; max_mb: number; allowed_types: string[]; per_hour: number; privacy: string }
export interface BuildOptions { road_side: string; architectural_style: string; site_margin_ft: number; assumed_openings: boolean }

export const importStatus = () => request<ImportStatus>('/plan-import/status')

export function analyzeImage(file: File, opts: { consent: boolean; manual: boolean }, signal?: AbortSignal) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('consent', String(opts.consent))
  fd.append('manual', String(opts.manual))
  return request<AnalyzeResult>('/plan-import/analyze', { method: 'POST', body: fd, signal })
}
export const makeDraft = (reading: Reading, scale: ScaleSpec, roadSide: string) =>
  request<{ draft: Draft }>('/plan-import/draft', { method: 'POST', json: { reading, scale, road_side: roadSide } })
export const checkDraft = (draft: Draft, assumed: boolean, roadSide: string) =>
  request<{ draft: Draft }>('/plan-import/check', { method: 'POST', json: { draft, assumed_openings: assumed, road_side: roadSide } })
export const buildPlan = (draft: Draft, o: BuildOptions) =>
  request<{ plan: Plan; draft: Draft }>('/plan-import/build', { method: 'POST', json: { draft, ...o } })
