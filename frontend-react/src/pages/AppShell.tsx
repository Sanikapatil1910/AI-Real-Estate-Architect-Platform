import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Redirect, useLocation, useNavigate } from '../router'
import { useAuth } from '../auth/AuthContext'
import { Logo, Spinner } from '../components/ui'
import { QrHost, openQr } from '../qr/QrDialogs'

const LINKS: Array<[string, string, (p: string) => boolean]> = [
  ['/app', 'Dashboard', (p) => p === '/app' || p.startsWith('/app/project')],
  ['/app/create', 'Create a design', (p) => p === '/app/create'],
  ['/app/upload', 'Upload a floor plan', (p) => p === '/app/upload'],
  ['/app/vr', 'VR walk-through', (p) => p.startsWith('/app/vr')],
  ['/app/settings', 'Settings', (p) => p === '/app/settings'],
]

/** Protected frame: signed-out visitors are sent to /login and come back to where they were going. */
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth()
  const { path, search } = useLocation()
  const go = useNavigate()
  const signOut = () => { go('/', true); logout() }
  const [open, setOpen] = useState(false)
  if (loading) return <div className="wrap" style={{ padding: 60 }}><Spinner label="Loading your workspace…" /></div>
  if (!user) return <Redirect to={`/login?next=${encodeURIComponent(path + search)}`} />
  return (
    <>
      <header className={`nav${open ? ' open' : ''}`}>
        <div className="wrap nav-in" style={{ width: 'min(1500px, 100% - 32px)' }}>
          <Link to="/" className="brand"><Logo />AI Architect</Link>
          <nav className="nav-links" aria-label="Main" onClick={() => setOpen(false)}>
            {LINKS.map(([to, label, on]) => <Link key={to} to={to} aria-current={on(path) ? 'page' : undefined}>{label}</Link>)}
          </nav>
          <div className="nav-end">
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => openQr('share')} data-testid="qr-share-open" title="Show a QR code of this page's address">Share QR</button>
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => openQr('scan')} data-testid="qr-scan-open" title="Scan a QR code that holds a web address">Scan QR</button>
            <span className="small muted" data-testid="user-name">{user.full_name}</span>
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={signOut} data-testid="logout">Log out</button>
          </div>
          <button type="button" className="nav-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={open ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
          </button>
        </div>
      </header>
      {children}
      <QrHost />
    </>
  )
}
