import { useEffect, useState } from 'react'
import { Link, useNavigate } from '../router'
import FloorPlanSvg from '../components/FloorPlanSvg'
import TwinViewer from '../components/TwinViewer'
import PlanResults from '../components/PlanResults'
import { Notice, Spinner } from '../components/ui'
import { STYLES } from '../components/twinStyles'
import type { Design } from '../components/twinThemes'
import { ApiError } from '../lib/http'
import { generatePlans } from '../lib/api'
import { deleteProject, getProject, updateProject } from '../lib/projects'
import type { ProjectFull } from '../lib/projects'
import type { GenerateRequestPayload, Plan } from '@/types'

type Tab = '3d' | 'plan' | 'notes'

function downloadJson(name: string, obj: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ProjectPage({ id }: { id: string }) {
  const go = useNavigate()
  const [p, setP] = useState<ProjectFull | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [tab, setTab] = useState<Tab>('3d')
  const [floor, setFloor] = useState(0)
  const [name, setName] = useState('')
  const [design, setDesign] = useState<Design | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [regen, setRegen] = useState<Plan[] | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    let live = true
    setP(null); setErr(null)
    getProject(id).then((x) => { if (live) { setP(x); setName(x.name); setDesign(x.data.design ?? null) } }).catch((e) => { if (live) setErr(e as ApiError) })
    return () => { live = false }
  }, [id])

  if (err) return <main className="wrap page-head"><Notice kind="bad">{err.status === 404 ? 'This project does not exist (or belongs to another account).' : err.message}</Notice><p style={{ marginTop: 14 }}><Link to="/app" className="pbtn pbtn-ghost">Back to dashboard</Link></p></main>
  if (!p) return <main className="wrap page-head"><Spinner label="Opening project…" /></main>

  const plan = p.data.plan
  const dirty = (design !== null && JSON.stringify(design) !== JSON.stringify(p.data.design ?? null)) || name.trim() !== p.name
  const styleLabel = design ? STYLES[design.style].label : p.style
  const floors = plan.floors ?? []
  const layout = floors[Math.min(floor, floors.length - 1)]?.layout
  const report = (plan as unknown as { import_report?: { adjustments: string[]; uncertainties: string[]; assumptions: string[]; warnings: string[]; scale?: { description?: string } } }).import_report

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const next = await updateProject(p.id, { name: name.trim(), style: styleLabel, data: { ...p.data, plan: { ...plan, architectural_style: styleLabel }, design: design ?? undefined } })
      setP(next); setName(next.name); setDesign(next.data.design ?? null)
      setMsg({ ok: true, text: 'Saved.' })
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }) } finally { setBusy(false) }
  }
  const regenerate = async () => {
    const reqPayload = p.data.request as GenerateRequestPayload | undefined
    if (!reqPayload) return
    setBusy(true); setMsg(null)
    try {
      const r = await generatePlans({ ...reqPayload, architectural_style: styleLabel as GenerateRequestPayload['architectural_style'] })
      setRegen(r.plans)
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not regenerate.' }) } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true)
    try { await deleteProject(p.id); go('/app', true) } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not delete.' }); setBusy(false) }
  }

  return (
    <main className="wrap" style={{ paddingBottom: 60, width: 'min(1400px, 100% - 32px)' }}>
      <div className="page-head" style={{ paddingBottom: 10 }}>
        <Link to="/app" className="small">← All projects</Link>
        <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
          <div className="grow" style={{ minWidth: 240 }}>
            <label className="sr-only" htmlFor="pn">Project name</label>
            <input id="pn" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} style={{ font: '700 1.5rem var(--serif)', border: 'none', borderBottom: '2px solid var(--line-2)', borderRadius: 0, background: 'transparent', paddingLeft: 0 }} data-testid="project-name" />
          </div>
          <span className="badge badge-accent" data-testid="project-style">{styleLabel}</span>
          <span className="badge">{p.kind === 'upload' ? 'From uploaded plan' : 'Generated'}</span>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="pbtn pbtn-primary pbtn-sm" onClick={() => void save()} disabled={busy || !dirty} data-testid="project-save">Save changes</button>
          {p.kind === 'generated' && p.data.request && <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => void regenerate()} disabled={busy} data-testid="project-regenerate">Regenerate concepts</button>}
          <Link to={`/app/vr/${p.id}`} className="pbtn pbtn-ghost pbtn-sm" data-testid="project-vr">Walk through in VR</Link>
          <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => downloadJson(`${name.replace(/[^\w-]+/g, '_') || 'project'}.plan.json`, plan)}>Export plan (.json)</button>
          {confirmDel
            ? <span className="row"><span className="small">Delete this project?</span><button type="button" className="pbtn pbtn-danger pbtn-sm" onClick={() => void remove()} disabled={busy}>Yes, delete</button><button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => setConfirmDel(false)}>Keep</button></span>
            : <button type="button" className="pbtn pbtn-danger pbtn-sm" onClick={() => setConfirmDel(true)}>Delete</button>}
          {busy && <Spinner />}
          {msg && <span role="status" className={msg.ok ? 'small' : 'err'} style={{ color: msg.ok ? 'var(--ok)' : undefined }}>{msg.text}</span>}
        </div>
        {p.kind === 'upload' && <p className="hint" style={{ marginTop: 10 }}>Structure (rooms, walls, openings) comes from your reviewed plan and cannot be changed here. The design studio only changes how it looks.</p>}
      </div>

      {regen && (
        <section className="pcard pcard-pad stack" style={{ marginBottom: 20 }} data-testid="regen-panel">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ fontSize: '1.3rem' }}>New concepts from the saved brief</h2><button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => setRegen(null)}>Close</button></div>
          <p className="muted small">Choose “Save to my projects” on a concept to replace this project&apos;s plan with it.</p>
          <PlanResults plans={regen} onSave={async (np, d) => {
            const st = d ? STYLES[d.style].label : np.architectural_style
            const next = await updateProject(p.id, { style: st, data: { ...p.data, plan: { ...np, architectural_style: st }, design: d } })
            setP(next); setName(next.name); setDesign(next.data.design ?? null); setRegen(null);
            return 'This project now uses the new concept.'
          }} />
        </section>
      )}

      <div className="plan-detail-tabs" role="tablist" style={{ marginBottom: 14 }}>
        {([['3d', '3D digital twin'], ['plan', '2D floor plans'], ['notes', p.kind === 'upload' ? 'Import report' : 'Explanation']] as Array<[Tab, string]>).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`plan-detail-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)} data-testid={`tab-${k}`}>{l}</button>
        ))}
      </div>

      {tab === '3d' && <TwinViewer key={p.id} plan={plan} height={640} initialDesign={p.data.design} onDesignChange={setDesign} />}
      {tab === 'plan' && layout && (
        <div className="pcard pcard-pad">
          {floors.length > 1 && <div className="plan-detail-tabs" style={{ marginBottom: 10 }}>{floors.map((f, i) => <button key={f.floor} className={`plan-detail-tab ${floor === i ? 'active' : ''}`} onClick={() => setFloor(i)}>{f.floor}</button>)}</div>}
          <FloorPlanSvg layout={layout} plot={layout.plot ?? { width: 40, length: 50 }} usablePlot={layout.usable_plot} roadSide={plan.road_side} style={{ height: 620 }} stair={(plan as unknown as { staircase?: unknown }).staircase} floorIndex={floor} title={p.kind === 'upload' ? 'FLOOR PLAN FROM YOUR UPLOAD' : 'FLOOR PLAN'} />
        </div>
      )}
      {tab === 'notes' && (
        <div className="pcard pcard-pad stack">
          {(plan.explanation ?? []).length > 0 && <ul style={{ marginLeft: 18, display: 'grid', gap: 6 }}>{(plan.explanation ?? []).map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {report && (<>
            {report.assumptions.length > 0 && <div><h3 style={{ fontSize: '1.05rem' }}>Assumptions</h3><ul style={{ marginLeft: 18 }}>{report.assumptions.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {report.adjustments.length > 0 && <div><h3 style={{ fontSize: '1.05rem' }}>Adjustments made</h3><ul style={{ marginLeft: 18 }}>{report.adjustments.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {report.uncertainties.length > 0 && <div><h3 style={{ fontSize: '1.05rem' }}>Uncertain or unknown</h3><ul style={{ marginLeft: 18 }}>{report.uncertainties.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {report.warnings.length > 0 && <div><h3 style={{ fontSize: '1.05rem' }}>Warnings</h3><ul style={{ marginLeft: 18 }}>{report.warnings.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
          </>)}
        </div>
      )}
    </main>
  )
}
