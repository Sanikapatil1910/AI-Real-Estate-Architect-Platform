import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Redirect, useNavigate, useQuery } from '../router'
import { useAuth } from '../auth/AuthContext'
import type { Role } from '../auth/AuthContext'
import { ApiError } from '../lib/http'
import { Logo, Notice, Spinner } from '../components/ui'
import { PublicNav } from './Landing'

const ROLES: Array<[Role, string]> = [['home_owner', 'Home owner'], ['architect', 'Architect'], ['civil_engineer', 'Civil engineer']]
const safeNext = (n: string | null) => (n && n.startsWith('/app') ? n : '/app')

export default function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const { user, loading, login, signup } = useAuth()
  const go = useNavigate()
  const next = safeNext(useQuery().get('next'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('home_owner')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSignup = mode === 'signup'

  if (!loading && user) return <Redirect to={next} />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (isSignup && name.trim().length < 1) return setError('Enter your name.')
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.')
    if (password.length < 6) return setError(isSignup ? 'Choose a password of at least 6 characters.' : 'Enter your password.')
    setBusy(true)
    try {
      if (isSignup) await signup({ full_name: name.trim(), email: email.trim(), password, role })
      else await login(email.trim(), password)
      go(next, true)
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 401 ? 'Email or password is not correct.' : err.message) : 'Something went wrong. Try again.')
    } finally { setBusy(false) }
  }

  return (
    <>
      <PublicNav />
      <main className="wrap" style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100vh - 140px)', padding: '30px 0' }}>
        <form className="pcard pcard-pad stack" style={{ width: 'min(440px, 100%)', gap: 16 }} onSubmit={submit} noValidate data-testid={`${mode}-form`}>
          <div className="row" style={{ gap: 12 }}><Logo /><div><h1 style={{ fontSize: '1.6rem' }}>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
            <p className="muted small">{isSignup ? 'Save projects, upload plans and revisit your designs.' : 'Log in to your dashboard.'}</p></div></div>
          {isSignup && <div className="field"><label htmlFor="nm">Full name</label><input id="nm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>}
          <div className="field"><label htmlFor="em">Email</label><input id="em" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
            {isSignup && <span className="hint">At least 6 characters.</span>}</div>
          {isSignup && <div className="field"><label htmlFor="rl">I am a</label><select id="rl" value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>}
          {error && <Notice kind="bad" testId="auth-error">{error}</Notice>}
          <button type="submit" className="pbtn pbtn-primary" disabled={busy} data-testid="auth-submit">{busy ? <Spinner label={isSignup ? 'Creating account…' : 'Logging in…'} /> : isSignup ? 'Create account' : 'Log in'}</button>
          <p className="small muted" style={{ textAlign: 'center' }}>
            {isSignup ? <>Already have an account? <Link to={`/login${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`}>Log in</Link></> : <>New here? <Link to={`/signup${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link></>}
          </p>
        </form>
      </main>
    </>
  )
}
