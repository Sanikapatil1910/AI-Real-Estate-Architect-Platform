import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from '../router'
import { PlanThumb, Notice } from '../components/ui'
import { listProjects } from '../lib/projects'
import type { ProjectRow } from '../lib/projects'
import { detectXr } from '../vr/xrSupport'
import type { XrStatus } from '../vr/xrSupport'

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** The houses of the signed-in account, as a list to pick from inside the Quest browser (big targets, one button: Enter VR). */
export default function VrHomes() {
  const go = useNavigate()
  const [rows, setRows] = useState<ProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [xr, setXr] = useState<XrStatus | null>(null)
  const load = useCallback(() => {
    setError(null)
    listProjects(60).then(setRows).catch((e) => { setRows([]); setError(e instanceof Error ? e.message : 'Could not load your houses.') })
  }, [])
  useEffect(load, [load])
  useEffect(() => { void detectXr().then(setXr) }, [])
  return (
    <main className="wrap" style={{ paddingBottom: 60 }}>
      <div className="page-head">
        <span className="eyebrow">VR walk-through</span>
        <h1>Walk through your houses in VR</h1>
        <p>Pick a saved house and choose “Enter VR”. The 3D model is built from the saved plan and loaded into the headset browser: no files to copy, no app to install.</p>
      </div>
      {xr && xr.state === 'supported' && <Notice kind="ok" testId="xr-status">VR is available in this browser.</Notice>}
      {xr && xr.state !== 'supported' && <Notice kind="warn" testId="xr-status">{xr.message}</Notice>}
      {error && <Notice kind="bad">{error}</Notice>}
      {rows === null && <p className="muted" style={{ marginTop: 20 }}>Loading your houses…</p>}
      {rows && rows.length === 0 && !error && (
        <div className="pcard pcard-pad" style={{ textAlign: 'center', padding: '44px 20px', marginTop: 20 }} data-testid="vr-empty">
          <h3 style={{ fontSize: '1.3rem' }}>No saved houses yet</h3>
          <p className="muted" style={{ margin: '6px auto 18px', maxWidth: '50ch' }}>Generate a design (or upload a floor plan) on this site, then choose “Save to my projects”. Sign in with the same account on the Quest and it appears here.</p>
          <div className="row" style={{ justifyContent: 'center' }}><Link to="/app/create" className="pbtn pbtn-primary">Create a design</Link></div>
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="style-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', marginTop: 20 }}>
          {rows.map((p) => {
            const t = p.summary.thumb
            return (
              <article key={p.id} className="pcard" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }} data-testid="vr-house">
                <div style={{ background: '#f4efe4', height: 170, display: 'grid', placeItems: 'center' }}>{t ? <PlanThumb rooms={t.rooms.map(([room_type, x, y, width, length]) => ({ room_type, x, y, width, length }))} plotW={t.w} plotL={t.l} /> : <span className="muted small">No preview</span>}</div>
                <div style={{ padding: 16, display: 'grid', gap: 8 }}>
                  <h3 style={{ fontSize: '1.15rem' }}>{p.name}</h3>
                  <p className="small muted">{p.style} · {p.summary.floors ?? '?'} floor{(p.summary.floors ?? 1) === 1 ? '' : 's'} · {p.summary.rooms ?? '?'} rooms · saved {when(p.updated_at)}</p>
                  <button type="button" className="pbtn pbtn-primary" style={{ fontSize: '1.05rem', padding: '14px 18px' }} onClick={() => go(`/app/vr/${p.id}`)} data-testid="vr-enter">Enter VR</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
