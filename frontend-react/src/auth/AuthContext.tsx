import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, getToken, onUnauthorised, request, setToken } from '../lib/http'

export type Role = 'home_owner' | 'architect' | 'civil_engineer'
export interface User { id: number; full_name: string; email: string; role: Role; created_at: string }

interface AuthState {
  user: User | null
  /** true until the first /auth/me answer (or until we know there is no token) */
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (v: { full_name: string; email: string; password: string; role: Role }) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null)

  useEffect(() => {
    if (!getToken()) { setLoading(false); return }
    let live = true
    request<User>('/auth/me')
      .then((u) => { if (live) setUser(u) })
      .catch(() => { if (live) setUser(null) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])
  useEffect(() => onUnauthorised(() => setUser(null)), [])

  const login = useCallback(async (email: string, password: string) => {
    const t = await request<{ access_token: string }>('/auth/login', { method: 'POST', json: { email, password }, auth: false })
    setToken(t.access_token)
    try { setUser(await request<User>('/auth/me')) } catch (e) { setToken(null); throw e }
  }, [])
  const signup = useCallback(async (v: { full_name: string; email: string; password: string; role: Role }) => {
    await request<User>('/auth/signup', { method: 'POST', json: v, auth: false })
    await login(v.email, v.password)
  }, [login])
  const logout = useCallback(() => { setToken(null); setUser(null) }, [])

  const value = useMemo(() => ({ user, loading, login, signup, logout }), [user, loading, login, signup, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const c = useContext(Ctx)
  if (!c) throw new ApiError(0, 'useAuth outside AuthProvider')
  return c
}
