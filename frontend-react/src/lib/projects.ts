import { request } from './http'
import type { Plan } from '@/types'
import type { Design } from '../components/twinThemes'

export interface ProjectSummary { floors?: number; rooms?: number; plot?: string; building_type?: string; source?: string; thumb?: { w: number; l: number; rooms: Array<[string, number, number, number, number]> } }
export interface ProjectRow {
  id: number; name: string; kind: 'generated' | 'upload'; style: string; summary: ProjectSummary; created_at: string; updated_at: string
}
export interface ProjectData {
  plan: Plan
  /** the generator form payload (so the project can be regenerated) */
  request?: Record<string, unknown>
  /** the upload review draft (layer A) */
  draft?: unknown
  /** layer B: the style / palette / materials / light last chosen in the 3D design studio */
  design?: Design
  [k: string]: unknown
}
export interface ProjectFull extends ProjectRow { data: ProjectData }

export const listProjects = (limit = 50) => request<ProjectRow[]>(`/projects?limit=${limit}`)
export const getProject = (id: number | string) => request<ProjectFull>(`/projects/${id}`)
export const createProject = (b: { name: string; kind: 'generated' | 'upload'; style: string; data: ProjectData }) => request<ProjectFull>('/projects', { method: 'POST', json: b })
export const updateProject = (id: number, b: { name?: string; style?: string; data?: ProjectData }) => request<ProjectFull>(`/projects/${id}`, { method: 'PUT', json: b })
export const deleteProject = (id: number) => request<void>(`/projects/${id}`, { method: 'DELETE' })
