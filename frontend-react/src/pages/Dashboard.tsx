import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from '../router'
import { useAuth } from '../auth/AuthContext'
import { PlanThumb, Notice, StylePicker } from '../components/ui'
import { deleteProject, getProject, listProjects, updateProject } from '../lib/projects'
import type { ProjectRow } from '../lib/projects'
import { loadPrefs, savePrefs } from '../lib/prefs'
import type { ArchitecturalStyle } from '@/types'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function ProjectCard({ p, onChanged }: { p: ProjectRow; onChanged: () => void }) {
  const go = useNavigate()
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view')
  const [name, setName] = useState(p.name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const t = p.summary.thumb
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null)
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }
  return (
    <article className="pcard" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }} data-testid="project-card">
      <Link to={`/app/project/${p.id}`} aria-label={`Open ${p.name}`}>
        {t ? <PlanThumb rooms={t.rooms.map(([room_type, x, y, width, length]) => ({ room_type, x, y, width, length }))} plotW={t.w} plotL={t.l} /> : <PlanThumb rooms={[]} />}
      </Link>
      <div style={{ padding: '14px 16px 16px', display: 'grid', gap: 10, flex: 1 }}>
        {mode === 'rename' ? (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { await updateProject(p.id, { name }); setMode('view'); onChanged() }) }}>
            <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" maxLength={120} autoFocus />
            <button className="pbtn pbtn-primary pbtn-sm" disabled={busy || !name.trim()} type="submit">Save</button>
            <button className="pbtn pbtn-ghost pbtn-sm" type="button" onClick={() => { setMode('view'); setName(p.name) }}>Cancel</button>
          </form>
        ) : <h3 style={{ fontSize: '1.15rem' }}>{p.name}</h3>}
        <div className="row" style={{ gap: 6 }}>
          <span className="badge badge-accent">{p.style}</span>
          <span className="badge">{p.kind === 'upload' ? 'From uploaded plan' : 'Generated'}</span>
        </div>
        <p className="small muted">{[p.summary.building_type, p.summary.floors ? `${p.summary.floors} floor${p.summary.floors > 1 ? 's' : ''}` : null, p.summary.rooms ? `${p.summary.rooms} rooms` : null, p.summary.plot].filter(Boolean).join(' · ')}<br />Updated {when(p.updated_at)}</p>
        {err && <span className="err">{err}</span>}
        {mode === 'delete' ? (
          <div className="row"><span className="small">Delete this project?</span>
            <button className="pbtn pbtn-danger pbtn-sm" disabled={busy} onClick={() => void run(async () => { await deleteProject(p.id); onChanged() })}>Yes, delete</button>
            <button className="pbtn pbtn-ghost pbtn-sm" onClick={() => setMode('view')}>Keep</button></div>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <button className="pbtn pbtn-primary pbtn-sm" onClick={() => go(`/app/project/${p.id}`)}>Open</button>
            <button className="pbtn pbtn-ghost pbtn-sm" onClick={() => go(`/app/vr/${p.id}`)} data-testid="project-vr" title="Walk through this house in VR (Meta Quest browser) or on the desktop">VR</button>
            <button className="pbtn pbtn-ghost pbtn-sm" onClick={() => setMode('rename')}>Rename</button>
            <button className="pbtn pbtn-ghost pbtn-sm" disabled={busy} onClick={() => void run(async () => { const f = await getProject(p.id); download(`${p.name.replace(/[^\w-]+/g, '_')}.plan.json`, JSON.stringify(f.data.plan, null, 2)) })} title="Download the plan as JSON">Export plan</button>
            <button className="pbtn pbtn-danger pbtn-sm" onClick={() => setMode('delete')}>Delete</button>
          </div>
        )}
      </div>
    </article>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prefs, setPrefs] = useState(loadPrefs)
  const load = useCallback(() => {
    setError(null)
    listProjects(12).then(setProjects).catch((e) => { setProjects([]); setError(e instanceof Error ? e.message : 'Could not load your projects.') })
  }, [])
  useEffect(load, [load])
  const setStyle = (s: ArchitecturalStyle) => { const n = { ...prefs, style: s }; setPrefs(n); savePrefs(n) }
  const first = user?.full_name.split(' ')[0] ?? ''
  return (
    <main className="wrap" style={{ paddingBottom: 60 }}>
      <div className="page-head"><span className="eyebrow">Dashboard</span><h1>Welcome, {first}</h1><p>Start a new design, bring in an existing floor plan, or pick up where you left off.</p></div>
      <div className="row" style={{ alignItems: 'stretch', gap: 16, marginBottom: 36 }}>
        <Link to="/app/create" className="pcard pcard-pad" style={{ flex: '1 1 280px', textDecoration: 'none', color: 'inherit' }} data-testid="dash-create">
          <span className="eyebrow">Generate</span><h2 style={{ fontSize: '1.4rem', margin: '8px 0 6px' }}>Create a new design</h2><p className="muted">Enter your plot and requirements; get four layout concepts with explanations and a 3D model.</p>
          <span className="pbtn pbtn-primary pbtn-sm" style={{ marginTop: 14 }}>Start designing</span>
        </Link>
        <Link to="/app/upload" className="pcard pcard-pad" style={{ flex: '1 1 280px', textDecoration: 'none', color: 'inherit', background: 'linear-gradient(135deg,#fffaf1,#f4e8cf)' }} data-testid="dash-upload">
          <span className="eyebrow">Upload</span><h2 style={{ fontSize: '1.4rem', margin: '8px 0 6px' }}>Upload your floor plan</h2><p className="muted">Turn a 2D plan image into an editable 3D digital twin. You approve the scale and every room.</p>
          <span className="pbtn pbtn-gold pbtn-sm" style={{ marginTop: 14 }}>Build your 3D home</span>
        </Link>
      </div>

      <section style={{ marginBottom: 40 }} aria-labelledby="sty">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 id="sty" style={{ fontSize: '1.4rem' }}>Your preferred style</h2><span className="small muted">Used as the starting style when you create or upload.</span>
        </div>
        <StylePicker value={prefs.style} onChange={setStyle} />
      </section>

      <section aria-labelledby="rec">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 id="rec" style={{ fontSize: '1.4rem' }}>Recent projects</h2>
          <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={load}>Refresh</button>
        </div>
        {error && <Notice kind="bad">{error}</Notice>}
        {projects === null && <div className="style-grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 300 }} />)}</div>}
        {projects && projects.length === 0 && !error && (
          <div className="pcard pcard-pad" style={{ textAlign: 'center', padding: '44px 20px' }} data-testid="empty-projects">
            <h3 style={{ fontSize: '1.3rem' }}>No saved projects yet</h3>
            <p className="muted" style={{ margin: '6px auto 18px', maxWidth: '46ch' }}>Generate a design or upload a floor plan, then choose “Save to my projects”. It will appear here.</p>
            <div className="row" style={{ justifyContent: 'center' }}><Link to="/app/create" className="pbtn pbtn-primary">Create a design</Link><Link to="/app/upload" className="pbtn pbtn-ghost">Upload a floor plan</Link></div>
          </div>
        )}
        {projects && projects.length > 0 && <div className="style-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>{projects.map((p) => <ProjectCard key={p.id} p={p} onChanged={load} />)}</div>}
      </section>
    </main>
  )
}
