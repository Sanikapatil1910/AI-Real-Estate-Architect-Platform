import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { Link } from '../router'
import ReviewEditor from '../components/upload/ReviewEditor'
import TwinViewer from '../components/TwinViewer'
import { Notice, Spinner, StylePicker } from '../components/ui'
import { STYLES } from '../components/twinStyles'
import type { Design } from '../components/twinThemes'
import { ApiError } from '../lib/http'
import { analyzeImage, buildPlan, checkDraft, importStatus, makeDraft } from '../lib/planImport'
import type { AnalyzeResult, Draft, ImportStatus, ScaleSpec } from '../lib/planImport'
import { createProject } from '../lib/projects'
import { loadPrefs } from '../lib/prefs'
import type { ArchitecturalStyle, Plan } from '@/types'

type Step = 'upload' | 'reading' | 'scale' | 'review' | 'model'
const STEPS: Array<[Step, string]> = [['upload', 'Upload'], ['reading', 'Read'], ['scale', 'Scale'], ['review', 'Review'], ['model', '3D model']]
const ROADS = ['North', 'South', 'East', 'West'] as const
const human = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export default function UploadWizard() {
  const [step, setStep] = useState<Step>('upload')
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [fileErr, setFileErr] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const abort = useRef<AbortController | null>(null)
  // scale
  const [scaleKind, setScaleKind] = useState<'approximate' | 'reference' | 'overall'>('reference')
  const [refRoom, setRefRoom] = useState('')
  const [axis, setAxis] = useState<'width' | 'length'>('width')
  const [feet, setFeet] = useState('')
  const [busy, setBusy] = useState(false)
  // review + model
  const [draft, setDraft] = useState<Draft | null>(null)
  const [style, setStyle] = useState<ArchitecturalStyle>(() => loadPrefs().style)
  const [road, setRoad] = useState<(typeof ROADS)[number]>('South')
  const [margin, setMargin] = useState(6)
  const [assumed, setAssumed] = useState(false)
  const snap = useRef<Draft | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [builtDraft, setBuiltDraft] = useState<Draft | null>(null)
  const [design, setDesign] = useState<Design | null>(null)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)

  useEffect(() => { importStatus().then(setStatus).catch(() => setStatus(null)) }, [])
  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl) }, [imgUrl])

  const maxBytes = (status?.max_mb ?? 10) * 1048576
  const pick = useCallback((f: File | undefined | null) => {
    setFileErr(null); setErr(null)
    if (!f) return
    if (!['image/png', 'image/jpeg'].includes(f.type)) return setFileErr(/pdf/i.test(f.type) ? 'PDF plans are not supported. Export the plan page as PNG or JPG and upload that.' : 'Only PNG or JPG/JPEG images can be read.')
    if (f.size > maxBytes) return setFileErr(`This image is ${kb(f.size)}; the limit is ${status?.max_mb ?? 10} MB.`)
    const url = URL.createObjectURL(f)
    const im = new Image()
    im.onload = () => {
      if (Math.min(im.naturalWidth, im.naturalHeight) < 200) { URL.revokeObjectURL(url); setFileErr('The image is too small to read (at least 200 px on each side).'); return }
      setFile(f); setImgUrl(url); setImgSize({ w: im.naturalWidth, h: im.naturalHeight }); setConsent(false); setAnalysis(null)
    }
    im.onerror = () => { URL.revokeObjectURL(url); setFileErr('This file could not be opened as an image.') }
    im.src = url
  }, [maxBytes, status?.max_mb])

  const read = async (manual: boolean) => {
    if (!file) return
    setErr(null); setStep('reading')
    abort.current = new AbortController()
    try {
      const r = await analyzeImage(file, { consent, manual }, abort.current.signal)
      setAnalysis(r)
      if (manual || r.reading.rooms.length === 0) {
        const d = await makeDraft(r.reading, { mode: 'manual' }, road)
        setDraft(d.draft); setStep('review')
      } else {
        setScaleKind(r.scale.proposal ? 'approximate' : 'reference')
        setRefRoom(r.reading.rooms[0]?.id ?? '')
        setStep('scale')
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') { setStep('upload'); return }
      setErr(e instanceof ApiError ? e : new ApiError(0, 'Something went wrong.')); setStep('upload')
    }
  }

  const scaleSpec = (): ScaleSpec | string => {
    if (scaleKind === 'approximate') return { mode: 'approximate' }
    const f = Number(feet)
    if (!(f >= 2 && f <= 250)) return 'Enter the real length in feet (between 2 and 250).'
    return scaleKind === 'overall' ? { mode: 'overall', axis, feet: f } : { mode: 'reference', room_id: refRoom, axis, feet: f }
  }
  const toReview = async () => {
    if (!analysis) return
    const spec = scaleSpec()
    if (typeof spec === 'string') return setErr(new ApiError(0, spec, 'scale'))
    setBusy(true); setErr(null)
    try { const d = await makeDraft(analysis.reading, spec, road); setDraft(d.draft); setStep('review') }
    catch (e) { setErr(e as ApiError) } finally { setBusy(false) }
  }

  // keep the server's verdict (errors / warnings / which room each door opens to) in step with the edits
  const seq = useRef(0)
  useEffect(() => {
    if (step !== 'review' || !draft) return
    const my = ++seq.current
    const t = setTimeout(() => {
      checkDraft(draft, false, road).then((r) => {
        if (my !== seq.current) return
        setDraft((cur) => cur && { ...cur, check: r.draft.check, doors: cur.doors.length === r.draft.doors.length ? cur.doors.map((d, i) => ({ ...d, connects_to: r.draft.doors[i].connects_to })) : cur.doors })
      }).catch(() => undefined)
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, draft?.rooms, draft?.doors, draft?.windows])

  // ticking "fill in standard openings" puts them into the editable draft (marked assumed) so they can be reviewed; unticking restores the drawing's own
  const toggleAssumed = async (on: boolean) => {
    if (!draft) return
    setErr(null)
    if (!on) {
      if (snap.current) setDraft({ ...draft, doors: snap.current.doors, windows: snap.current.windows, adjustments: snap.current.adjustments })
      setAssumed(false); return
    }
    setBusy(true)
    try { const r = await checkDraft(draft, true, road); snap.current = draft; setDraft({ ...r.draft }); setAssumed(true) }
    catch (e) { setErr(e as ApiError) } finally { setBusy(false) }
  }
  const build = async () => {
    if (!draft) return
    setBusy(true); setErr(null)
    try {
      const r = await buildPlan(draft, { road_side: road, architectural_style: style, site_margin_ft: margin, assumed_openings: false })
      setPlan(r.plan); setBuiltDraft(r.draft); setDesign(null); setSavedId(null); setSaveMsg(null); setStep('model')
    } catch (e) { setErr(e as ApiError) } finally { setBusy(false) }
  }
  const save = async () => {
    if (!plan || !builtDraft) return
    setBusy(true); setSaveMsg(null)
    try {
      const st = design ? STYLES[design.style].label : plan.architectural_style
      const p = await createProject({ name: `${builtDraft.floor_label || 'Uploaded plan'} – ${st}`, kind: 'upload', style: st, data: { plan: { ...plan, architectural_style: st }, draft: builtDraft, design: design ?? undefined } })
      setSavedId(p.id); setSaveMsg({ ok: true, text: `Saved as “${p.name}”.` })
    } catch (e) { setSaveMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }) } finally { setBusy(false) }
  }
  const restart = () => { setStep('upload'); setFile(null); setImgUrl(null); setImgSize(null); setAnalysis(null); setDraft(null); setPlan(null); setConsent(false); setErr(null); setFeet('') }

  const idx = STEPS.findIndex(([k]) => k === step)
  const reading = analysis?.reading
  const check = draft?.check
  const errList = check?.errors ?? []
  const designed = useMemo(() => (plan ? { ...plan } : null), [plan])

  return (
    <main className="wrap" style={{ paddingBottom: 70, width: 'min(1280px, 100% - 32px)' }}>
      <div className="page-head"><span className="eyebrow">Floor-plan upload</span><h1>Upload Your Floor Plan → Build Your 3D Dream Home</h1>
        <p>Gemini reads your drawing, you confirm the scale and review every room and opening, then the same 3D engine builds your home. Nothing is invented: what cannot be read is listed as unknown.</p></div>
      <ol className="steps" aria-label="Progress">{STEPS.map(([k, l], i) => <li key={k} aria-current={i === idx ? 'step' : undefined} className={i < idx ? 'done' : ''}><span className="n">{i < idx ? '✓' : i + 1}</span>{l}</li>)}</ol>

      {err && step !== 'reading' && (
        <div style={{ marginBottom: 16 }}><Notice kind="bad" testId="upload-error">
          <strong>{err.message}</strong>
          {err.details.length > 0 && <ul>{err.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
          {step === 'upload' && file && (<div className="row" style={{ marginTop: 10 }}>
            {err.retryable && <button type="button" className="pbtn pbtn-primary pbtn-sm" onClick={() => void read(false)} data-testid="retry-read">Try again</button>}
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => void read(true)}>Enter the rooms myself instead</button></div>)}
        </Notice></div>
      )}

      {step === 'upload' && (
        <div className="stack" style={{ gap: 18 }}>
          <label className="pcard pcard-pad" onDragOver={(e: DragEvent) => e.preventDefault()} onDrop={(e: DragEvent) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]) }}
            style={{ display: 'grid', placeItems: 'center', textAlign: 'center', minHeight: 170, borderStyle: 'dashed', borderWidth: 2, cursor: 'pointer', gap: 6 }}>
            <input type="file" accept="image/png,image/jpeg" className="sr-only" data-testid="file-input" onChange={(e: ChangeEvent<HTMLInputElement>) => pick(e.target.files?.[0])} />
            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', color: 'var(--ink)' }}>{file ? 'Choose a different image' : 'Drop your 2D floor plan here, or click to choose'}</span>
            <span className="muted small">PNG or JPG, up to {status?.max_mb ?? 10} MB. Sent as-is at its original quality.</span>
          </label>
          {fileErr && <Notice kind="bad" testId="file-error">{fileErr}</Notice>}
          {file && imgUrl && imgSize && (
            <div className="pcard pcard-pad" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 22 }} data-testid="review-before-read">
              <img src={imgUrl} alt="Your uploaded floor plan" style={{ width: '100%', maxHeight: 440, objectFit: 'contain', background: '#fff', border: '1px solid var(--line)', borderRadius: 10 }} />
              <div className="stack">
                <h2 style={{ fontSize: '1.3rem' }}>Check before it is read</h2>
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 14px' }} className="small">
                  <dt className="muted">File</dt><dd style={{ overflowWrap: 'anywhere' }}>{file.name}</dd><dt className="muted">Size</dt><dd>{kb(file.size)} · {imgSize.w} × {imgSize.h} px</dd>
                  <dt className="muted">Read by</dt><dd>{status?.gemini_available ? `Google Gemini (${status.models[0]})` : 'Not available on this server'}</dd>
                </dl>
                {status?.gemini_available ? (<>
                  <p className="small muted">{status.privacy} Reading counts against a limit of {status.per_hour} per hour.</p>
                  <label className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="consent" style={{ marginTop: 4, width: 18, height: 18 }} />
                    <span className="small">I agree that this image is sent to Google Gemini to be read.</span></label>
                  <div className="row"><button type="button" className="pbtn pbtn-primary" disabled={!consent} onClick={() => void read(false)} data-testid="read-gemini">Read my plan with Gemini</button>
                    <button type="button" className="pbtn pbtn-ghost" onClick={() => void read(true)} data-testid="read-manual">I&apos;ll enter the rooms myself</button></div>
                </>) : (<>
                  <Notice kind="warn" testId="no-gemini">Gemini is not configured on this server, so the image cannot be read automatically. You can still build a 3D model by entering the rooms yourself while looking at your drawing.</Notice>
                  <div><button type="button" className="pbtn pbtn-primary" onClick={() => void read(true)} data-testid="read-manual">Enter the rooms myself</button></div>
                </>)}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'reading' && (
        <div className="pcard pcard-pad stack" style={{ textAlign: 'center', padding: '50px 20px' }} data-testid="reading">
          <div><Spinner label="Reading your floor plan… this can take up to a minute." /></div>
          <div><button type="button" className="pbtn pbtn-ghost" onClick={() => abort.current?.abort()}>Cancel</button></div>
        </div>
      )}

      {step === 'scale' && reading && analysis && (
        <div className="stack" style={{ gap: 18 }} data-testid="scale-step">
          <div className="pcard pcard-pad stack">
            <h2 style={{ fontSize: '1.3rem' }}>What was read</h2>
            {!reading.is_floor_plan && <Notice kind="warn">Gemini does not think this image is a floor plan. Check the results carefully, or choose another image.</Notice>}
            <p>{reading.rooms.length} room(s), {reading.doors.length} door(s), {reading.windows.length} window(s){reading.floor_label ? ` · “${reading.floor_label}”` : ''} · read by {reading.model || 'Gemini'}.</p>
            <div className="row" style={{ gap: 6 }}>{reading.rooms.map((r) => <span key={r.id} className={`badge ${r.provenance === 'detected' ? 'badge-ok' : 'badge-warn'}`} title={`${r.provenance}, ${r.confidence} confidence`}>{r.label || human(r.room_type)}{r.dimension_text ? ` · ${r.dimension_text}` : ''}</span>)}</div>
            {(reading.unknown.length > 0 || reading.notes.length > 0) && <div className="notice"><strong>Not determined or uncertain</strong><ul>{[...reading.unknown, ...reading.notes].map((u, i) => <li key={i}>{u}</li>)}</ul></div>}
          </div>
          <div className="pcard pcard-pad stack">
            <h2 style={{ fontSize: '1.3rem' }}>Set the real-world scale</h2>
            <p className="muted small">A drawing has no scale unless one is given. The 3D model cannot guess it: either give one real measurement, or approve an approximate scale taken from printed dimensions.</p>
            {analysis.scale.proposal && (
              <label className="pcard pcard-pad" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', borderColor: scaleKind === 'approximate' ? 'var(--accent)' : undefined }}>
                <input type="radio" name="sc" checked={scaleKind === 'approximate'} onChange={() => setScaleKind('approximate')} data-testid="scale-approx" style={{ marginTop: 5 }} />
                <span><strong>Use the approximate scale from printed dimensions</strong><br /><span className="small muted">{analysis.scale.proposal.basis}. Real sizes may differ by several percent. By choosing this you approve the approximation.</span></span>
              </label>
            )}
            {!analysis.scale.proposal && <Notice kind="warn">{analysis.scale.disagree_pct ? `The printed dimensions disagree by ${analysis.scale.disagree_pct}%, so no approximate scale is offered.` : 'No printed dimensions were found to set a scale.'} Enter one real measurement.</Notice>}
            <label className="pcard pcard-pad stack" style={{ borderColor: scaleKind !== 'approximate' ? 'var(--accent)' : undefined }}>
              <span className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><input type="radio" name="sc" checked={scaleKind !== 'approximate'} onChange={() => setScaleKind('reference')} data-testid="scale-ref" style={{ marginTop: 5 }} /><strong>I know one real measurement</strong></span>
              <div className="row" style={{ gap: 10 }}>
                <select className="input" style={{ width: 'auto' }} value={scaleKind} onChange={(e) => setScaleKind(e.target.value as 'reference' | 'overall')} aria-label="What you measured" data-testid="scale-kind">
                  <option value="reference">A room</option><option value="overall">The whole building</option></select>
                {scaleKind !== 'overall' && <select className="input" style={{ width: 'auto' }} value={refRoom} onChange={(e) => setRefRoom(e.target.value)} aria-label="Room">{reading.rooms.map((r) => <option key={r.id} value={r.id}>{r.label || human(r.room_type)}</option>)}</select>}
                <select className="input" style={{ width: 'auto' }} value={axis} onChange={(e) => setAxis(e.target.value as 'width' | 'length')} aria-label="Direction"><option value="width">width (left to right)</option><option value="length">length (top to bottom)</option></select>
                <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="feet" value={feet} onChange={(e) => { setFeet(e.target.value); setScaleKind((k) => (k === 'approximate' ? 'reference' : k)) }} aria-label="Real length in feet" data-testid="scale-feet" />
                <span className="muted">ft</span>
              </div>
            </label>
            <div className="row"><button type="button" className="pbtn pbtn-primary" onClick={() => void toReview()} disabled={busy} data-testid="scale-continue">{busy ? <Spinner label="Building the editable plan…" /> : 'Continue to review'}</button>
              <button type="button" className="pbtn pbtn-ghost" onClick={restart}>Choose another image</button></div>
          </div>
        </div>
      )}

      {step === 'review' && draft && (
        <div className="stack" style={{ gap: 18 }} data-testid="review-step">
          <div className="notice"><strong>Layer A · Structure.</strong> Rooms, walls and openings are set here and nowhere else. After you build, the design studio changes only the look (layer B), never the structure.</div>
          <div className="pcard pcard-pad stack">
            <p className="small">{draft.scale.description}</p>
            {errList.length > 0 && <Notice kind="bad" testId="draft-errors"><strong>Fix these before building</strong><ul>{errList.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
            {(check?.warnings ?? []).length > 0 && <Notice kind="warn" testId="draft-warnings"><strong>Worth a look</strong><ul>{check!.warnings.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
            {draft.adjustments.length > 0 && <details><summary className="small"><strong>Adjustments made ({draft.adjustments.length})</strong></summary><ul style={{ marginLeft: 18 }}>{draft.adjustments.map((e, i) => <li key={i} className="small">{e}</li>)}</ul></details>}
            {draft.uncertainties.length > 0 && <details open><summary className="small"><strong>Uncertain or unknown ({draft.uncertainties.length})</strong></summary><ul style={{ marginLeft: 18 }}>{draft.uncertainties.map((e, i) => <li key={i} className="small">{e}</li>)}</ul></details>}
            {draft.assumptions.length > 0 && <details><summary className="small"><strong>Assumptions ({draft.assumptions.length})</strong></summary><ul style={{ marginLeft: 18 }}>{draft.assumptions.map((e, i) => <li key={i} className="small">{e}</li>)}</ul></details>}
          </div>
          <ReviewEditor draft={draft} onChange={setDraft} imageUrl={imgUrl} imageSize={imgSize} />
          <div className="pcard pcard-pad stack">
            <h2 style={{ fontSize: '1.25rem' }}>Layer B · Design</h2>
            <StylePicker value={style} onChange={setStyle} compact />
            <div className="row" style={{ gap: 22, alignItems: 'flex-start' }}>
              <fieldset style={{ border: 'none' }}><legend className="lbl">Which edge of the drawing faces the road?</legend>
                <div className="row" role="radiogroup">{ROADS.map((r) => <label key={r} className="row" style={{ gap: 4 }}><input type="radio" name="road" checked={road === r} onChange={() => setRoad(r)} />{r === 'North' ? 'Top' : r === 'South' ? 'Bottom' : r === 'West' ? 'Left' : 'Right'}</label>)}</div>
                <span className="hint">North is assumed to be at the top of the drawing.</span></fieldset>
              <div className="field" style={{ width: 230 }}><label htmlFor="mg">Open ground around the house (ft)</label><input id="mg" type="number" min={0} max={30} step={1} value={margin} onChange={(e) => setMargin(Math.min(30, Math.max(0, Number(e.target.value) || 0)))} data-testid="margin" /><span className="hint">Not in your drawing: an assumed yard, so the compound and garden can be shown.</span></div>
              <label className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', maxWidth: 360 }}><input type="checkbox" checked={assumed} disabled={busy} onChange={(e) => void toggleAssumed(e.target.checked)} style={{ marginTop: 4, width: 18, height: 18 }} data-testid="assumed" />
                <span className="small">Fill in standard doors and windows where the drawing shows none. They are marked <em>assumed</em>.</span></label>
            </div>
          </div>
          <div className="row"><button type="button" className="pbtn pbtn-primary pbtn-lg" onClick={() => void build()} disabled={busy || errList.length > 0 || draft.rooms.length === 0} data-testid="build-3d">{busy ? <Spinner label="Building…" /> : 'Build my 3D model'}</button>
            <button type="button" className="pbtn pbtn-ghost" onClick={restart}>Start over</button></div>
        </div>
      )}

      {step === 'model' && designed && builtDraft && (
        <div className="stack" style={{ gap: 16 }} data-testid="model-step">
          <div className="row">
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => setStep('review')} data-testid="back-to-review">← Edit structure (rooms, doors, windows)</button>
            <button type="button" className="pbtn pbtn-gold pbtn-sm" onClick={() => void save()} disabled={busy || savedId !== null} data-testid="save-upload">{savedId ? 'Saved' : 'Save to my projects'}</button>
            {savedId && <Link to={`/app/project/${savedId}`} className="pbtn pbtn-ghost pbtn-sm">Open saved project</Link>}
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={restart}>Upload another plan</button>
            {saveMsg && <span role="status" className="small" style={{ color: saveMsg.ok ? 'var(--ok)' : 'var(--bad)' }}>{saveMsg.text}</span>}
          </div>
          <Notice kind="ok"><strong>Layer B · Design.</strong> Use the design studio to change style, palette and materials. It never moves a wall, room, door or window. Download the model with the .glb button.</Notice>
          <TwinViewer plan={designed} height={640} onDesignChange={setDesign} />
          {(designed as unknown as { import_report?: { assumptions: string[]; adjustments: string[]; uncertainties: string[] } }).import_report && (() => {
            const rep = (designed as unknown as { import_report: { assumptions: string[]; adjustments: string[]; uncertainties: string[] } }).import_report
            return <details className="pcard pcard-pad"><summary><strong>What this model is based on</strong></summary>
              <div className="stack" style={{ marginTop: 10 }}>
                {[['Assumptions', rep.assumptions], ['Adjustments', rep.adjustments], ['Uncertain or unknown', rep.uncertainties]].map(([t, l]) => (l as string[]).length > 0 && <div key={t as string}><h3 style={{ fontSize: '1rem' }}>{t as string}</h3><ul style={{ marginLeft: 18 }}>{(l as string[]).map((x, i) => <li key={i} className="small">{x}</li>)}</ul></div>)}
              </div></details>
          })()}
        </div>
      )}
    </main>
  )
}
