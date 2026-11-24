/** A small History-API router (no dependency): path patterns with :params, <Link>, navigate(), and scroll-to-top on change. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'

interface Loc { path: string; search: string }
const read = (): Loc => ({ path: window.location.pathname.replace(/\/+$/, '') || '/', search: window.location.search })
const Ctx = createContext<{ loc: Loc; go: (to: string, replace?: boolean) => void } | null>(null)

export function Router({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<Loc>(read)
  useEffect(() => {
    const on = () => setLoc(read())
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  const go = useCallback((to: string, replace = false) => {
    if (replace) window.history.replaceState(null, '', to); else window.history.pushState(null, '', to)
    setLoc(read())
    window.scrollTo(0, 0)
  }, [])
  const value = useMemo(() => ({ loc, go }), [loc, go])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useCtx() {
  const c = useContext(Ctx)
  if (!c) throw new Error('Router missing')
  return c
}
export const useLocation = () => useCtx().loc
export const useNavigate = () => useCtx().go
export const useQuery = () => new URLSearchParams(useCtx().loc.search)

/** Match '/app/project/:id' against a path; returns params or null. A trailing '/*' matches any rest. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const xp = path.split('/').filter(Boolean)
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '*') return params
    if (i >= xp.length) return null
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(xp[i])
    else if (pp[i] !== xp[i]) return null
  }
  return xp.length === pp.length ? params : null
}

export function Link({ to, replace, onClick, children, ...rest }: { to: string; replace?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const go = useNavigate()
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return
    e.preventDefault()
    go(to, replace)
  }
  return <a href={to} onClick={click} {...rest}>{children}</a>
}

export function Redirect({ to }: { to: string }) {
  const go = useNavigate()
  useEffect(() => { go(to, true) }, [go, to])
  return null
}
