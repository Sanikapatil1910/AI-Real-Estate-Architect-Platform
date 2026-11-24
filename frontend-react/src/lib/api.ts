import type { AdjustmentProposals, BriefDiagnostic, GenerateRequestPayload, GenerateResponse } from '@/types'

const API_BASE = ''

export interface FeasibilityReport {
  feasible: boolean
  status: 'ok' | 'tight' | 'very_tight' | 'infeasible'
  errors: string[]
  warnings: string[]
  suggestions: { change: string }[]
}

export async function checkFeasibility(payload: GenerateRequestPayload): Promise<FeasibilityReport> {
  const res = await fetch(`${API_BASE}/feasibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Feasibility check failed (${res.status})`)
  return (await res.json()) as FeasibilityReport
}

export interface ParsedBrief {
  fields: Record<string, string | number | boolean>
  understood: string[]
  notes: string[]
}

export async function parseBrief(text: string): Promise<ParsedBrief> {
  const res = await fetch(`${API_BASE}/parse-brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`Could not read the brief (${res.status})`)
  return (await res.json()) as ParsedBrief
}

export interface PlanCritique {
  plan_number: number
  rank: number
  headline: string
  strengths: string[]
  concerns: string[]
  best_for?: string
}

export interface CritiqueResult {
  overview: string
  plans: PlanCritique[]
  pick: { plan_number: number; reason: string }
  source: 'rules' | 'gemini'
  note?: string
}

export async function critiquePlans(plans: unknown[], brief: string): Promise<CritiqueResult> {
  const res = await fetch(`${API_BASE}/critique`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plans, brief }),
  })
  if (!res.ok) throw new Error(`Could not compare the concepts (${res.status})`)
  return (await res.json()) as CritiqueResult
}

/** Strict mode: the exact brief cannot be planned.  Carries the precise conflicting constraints (nothing was dropped or invented). */
export class PlanConflictError extends Error {
  conflicts: { code: string; message: string; floor?: string }[]
  closestAvailable: boolean
  /** 'infeasible' (proved by the area analysis) or 'inconclusive' (the search found nothing; not a proof). */
  verdict: string
  outcome: string
  diagnostic: BriefDiagnostic | null
  constructor(message: string, conflicts: { code: string; message: string; floor?: string }[], closestAvailable: boolean,
              verdict = 'inconclusive', outcome = 'inconclusive', diagnostic: BriefDiagnostic | null = null) {
    super(message)
    this.name = 'PlanConflictError'
    this.conflicts = conflicts
    this.closestAvailable = closestAvailable
    this.verdict = verdict
    this.outcome = outcome
    this.diagnostic = diagnostic
  }
}

export async function generatePlans(
  payload: GenerateRequestPayload,
): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    let detail = `Request failed with status ${res.status}`
    try {
      const err = await res.json()
      if (err?.detail) {
        if (typeof err.detail === 'string') {
          detail = err.detail
        } else if (err.detail?.status === 'conflict') {
          throw new PlanConflictError(String(err.detail.message ?? 'The brief cannot be planned exactly.'), err.detail.conflicts ?? [], Boolean(err.detail.closest_available),
            String(err.detail.verdict ?? 'inconclusive'), String(err.detail.outcome ?? err.detail.verdict ?? 'inconclusive'), err.detail.diagnostic ?? null)
        } else if (err.detail?.message) {
          const f = err.detail.feasibility ?? {}
          const reasons: string[] = f.reasons ?? []
          const tips: string[] = (f.suggestions ?? []).map(
            (x: { change?: string } | string) => (typeof x === 'string' ? x : x.change ?? ''),
          )
          detail = [err.detail.message, ...reasons, ...(tips.length ? ['Try: ' + tips.join(' | ')] : [])]
            .filter(Boolean)
            .join(' ')
        } else {
          detail = JSON.stringify(err.detail)
        }
      }
    } catch (e) {
      if (e instanceof PlanConflictError) throw e
    }
    throw new Error(detail)
  }

  return (await res.json()) as GenerateResponse
}

/** The specific changes the planner proposes for a brief it could not plan (nothing is applied until the user approves). */
export async function proposeAdjustments(payload: GenerateRequestPayload): Promise<AdjustmentProposals> {
  const res = await fetch(`${API_BASE}/adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Could not work out adjustments (${res.status})`)
  return (await res.json()) as AdjustmentProposals
}

export async function healthCheck(): Promise<{ status: string; service: string }> {
  const res = await fetch(`${API_BASE}/health`)
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`)
  }
  return (await res.json()) as { status: string; service: string }
}
