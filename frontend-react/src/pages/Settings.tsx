import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Notice, StylePicker } from '../components/ui'
import { importStatus } from '../lib/planImport'
import type { ImportStatus } from '../lib/planImport'
import { loadPrefs, savePrefs } from '../lib/prefs'
import { useNavigate } from '../router'

const ROLE: Record<string, string> = { home_owner: 'Home owner', architect: 'Architect', civil_engineer: 'Civil engineer' }

export default function Settings() {
  const { user, logout } = useAuth()
  const go = useNavigate()
  const [prefs, setPrefs] = useState(loadPrefs)
  const [saved, setSaved] = useState(false)
  const [st, setSt] = useState<ImportStatus | null>(null)
  const [stErr, setStErr] = useState<string | null>(null)
  useEffect(() => { importStatus().then(setSt).catch((e) => setStErr(e instanceof Error ? e.message : 'Could not load.')) }, [])
  const update = (n: typeof prefs) => { setPrefs(n); savePrefs(n); setSaved(true); setTimeout(() => setSaved(false), 1800) }
  if (!user) return null
  return (
    <main className="wrap" style={{ paddingBottom: 60, maxWidth: 900 }}>
      <div className="page-head"><span className="eyebrow">Settings</span><h1>Your account and defaults</h1></div>
      <section className="pcard pcard-pad stack" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.25rem' }}>Account</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 18px' }}>
          <dt className="muted">Name</dt><dd data-testid="set-name">{user.full_name}</dd>
          <dt className="muted">Email</dt><dd>{user.email}</dd>
          <dt className="muted">Role</dt><dd>{ROLE[user.role] ?? user.role}</dd>
          <dt className="muted">Member since</dt><dd>{new Date(user.created_at).toLocaleDateString()}</dd>
        </dl>
        <div><button type="button" className="pbtn pbtn-ghost" onClick={() => { logout(); go('/', true) }} data-testid="settings-logout">Log out</button></div>
      </section>
      <section className="pcard pcard-pad stack" style={{ marginBottom: 20 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ fontSize: '1.25rem' }}>Design defaults</h2>{saved && <span className="badge badge-ok" role="status">Saved</span>}</div>
        <p className="muted small">Stored in this browser. Used as the starting style when you create or upload.</p>
        <StylePicker value={prefs.style} onChange={(s) => update({ ...prefs, style: s })} compact />
        <div className="field" style={{ maxWidth: 260 }}><label htmlFor="un">Units</label>
          <select id="un" value={prefs.units} onChange={(e) => update({ ...prefs, units: e.target.value as 'Feet' | 'Meters' })}><option>Feet</option><option>Meters</option></select></div>
      </section>
      <section className="pcard pcard-pad stack">
        <h2 style={{ fontSize: '1.25rem' }}>Floor-plan reading (Gemini)</h2>
        {stErr && <Notice kind="bad">{stErr}</Notice>}
        {st && (st.gemini_available
          ? <Notice kind="ok">Gemini is configured on the server. Model order: {st.models.join(', ')}. Limit: {st.per_hour} readings per hour per user, images up to {st.max_mb} MB (PNG or JPG).</Notice>
          : <Notice kind="warn">Gemini is not configured on this server (no <code>GEMINI_API_KEY</code>). Uploads still work in manual mode: you add the rooms yourself.</Notice>)}
        <p className="hint">{st?.privacy}</p>
      </section>
    </main>
  )
}
