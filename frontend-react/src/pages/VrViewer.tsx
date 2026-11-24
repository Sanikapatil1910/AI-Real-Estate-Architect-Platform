import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '../router'
import { Notice, Spinner } from '../components/ui'
import { getProject, updateProject } from '../lib/projects'
import type { ProjectFull } from '../lib/projects'
import { ApiError } from '../lib/http'
import { prepareHouseFromPlan } from '../vr/houseLoader'
import type { LoadedHouse } from '../vr/houseLoader'
import { VrEngine } from '../vr/VrEngine'
import { hudInfo } from '../vr/continuousVoice'
import type { Mode } from '../vr/VrEngine'
import { PANEL_H, PANEL_W } from '../vr/smart/panel'
import { lightHex } from '../vr/panelCanvas'
import type { PanelButton, PanelLayout } from '../vr/smart/panel'

const TONE: Record<PanelButton['kind'], { bg: string; fg: string }> = {
  primary: { bg: '#2d6cdf', fg: '#fff' }, on: { bg: '#2f8f4e', fg: '#fff' }, off: { bg: '#58504a', fg: '#fff' },
  neutral: { bg: '#3d4655', fg: '#fff' }, danger: { bg: '#b23b30', fg: '#fff' }, disabled: { bg: '#2a2d33', fg: '#6c7079' },
}

/** The control panel for the desktop fallback: the SAME layout (rectangles + labels) the in-VR panel draws, as real buttons. */
function DomPanel({ L, press, testId = 'smart-panel', idPrefix = 'pb-' }: { L: PanelLayout; press: (b: PanelButton) => void; testId?: string; idPrefix?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(PANEL_W)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const s = Math.min(1, Math.max(0.4, w / PANEL_W))
  return (
    <div ref={ref} style={{ width: '100%', maxWidth: 760, minWidth: 0, overflow: 'hidden' }} data-testid={testId}>
      <div style={{ width: PANEL_W * s, height: PANEL_H * s }}>
        <div style={{ width: PANEL_W, height: PANEL_H, transform: `scale(${s})`, transformOrigin: '0 0', position: 'relative', background: 'linear-gradient(#242a35,#171b23)', border: '3px solid #d9c9a0', borderRadius: 28, boxSizing: 'border-box', overflow: 'hidden' }}>
          {L.buttons.map((b) => (
            <button key={b.id} type="button" disabled={!b.action} data-testid={`${idPrefix}${b.id}`} aria-pressed={b.selected || undefined} aria-label={b.swatch ? `${b.label} colour` : undefined} onClick={() => b.action && press(b)}
              style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, background: b.swatch ?? TONE[b.kind].bg, color: b.swatch ? (lightHex(b.swatch) ? '#16181d' : '#fff') : TONE[b.kind].fg, border: 'none', outline: b.selected ? '5px solid #ffd866' : 'none', outlineOffset: -5, borderRadius: 10, font: `${b.size ?? (b.label.length > 12 ? 20 : b.label.length > 6 ? 24 : 32)}px system-ui, sans-serif`, cursor: b.action ? 'pointer' : 'default', padding: 0, whiteSpace: 'nowrap' }}>
              {b.label}
            </button>
          ))}
          {L.texts.map((t, i) => (
            <div key={i} style={{ position: 'absolute', left: t.align === 'center' ? t.x - 200 : t.align === 'right' ? t.x - 600 : t.x, top: t.y - t.size, width: t.align === 'center' ? 400 : t.align === 'right' ? 600 : 'auto', textAlign: t.align ?? 'left', color: t.color, font: `${t.weight ?? 400} ${t.size}px system-ui, sans-serif`, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{t.text}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function VrViewer({ id }: { id: string }) {
  const stage = useRef<HTMLDivElement>(null)
  const engineRef = useRef<VrEngine | null>(null)
  const houseRef = useRef<LoadedHouse | null>(null)
  const [project, setProject] = useState<ProjectFull | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [progress, setProgress] = useState<{ msg: string; frac: number }>({ msg: 'Opening the house…', frac: 0 })
  const [err, setErr] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [, setTick] = useState(0)
  const [mode, setMode] = useState<Mode>('desktop')
  const [toast, setToast] = useState('')
  const [typed, setTyped] = useState('')
  const [panelShown, setPanelShown] = useState(true)

  useEffect(() => {
    let live = true
    let engine: VrEngine | null = null
    setPhase('loading'); setErr(null); setProgress({ msg: 'Opening the house…', frac: 0 })
    ;(async () => {
      try {
        const p = await getProject(id)
        if (!live) return
        setProject(p)
        const house = await prepareHouseFromPlan(p.data.plan, { design: p.data.design, progress: (msg, frac) => { if (live) setProgress({ msg, frac }) } })
        if (!live) { house.dispose(); return }
        houseRef.current = house
        if (!stage.current) throw new Error('The viewer area is not on the page.')
        const debug = new URLSearchParams(location.search).get('vrdebug') === '1'
        let storage: Storage | null = null
        try { storage = window.localStorage } catch { storage = null }
        engine = new VrEngine(stage.current, house, { plainBackground: debug && new URLSearchParams(location.search).get('plain') === '1', custom: { storage, key: `rea.custom.project.${p.id}`, saved: (p.data as { custom?: unknown }).custom }, voice: { wake: (() => { try { return window.localStorage.getItem('rea.voice.wake') === 'required' ? 'required' as const : 'optional' as const } catch { return 'optional' as const } })() } })
        // Save keeps the design with the project too, so it follows the person to the headset or another device (best effort: the local copy is already kept)
        engine.custom.onSaved = (st) => { void updateProject(p.id, { data: { ...p.data, custom: st } }).catch(() => setToast('Saved in this browser; the project copy could not be updated.')) }
        engine.onChange = () => setTick((t) => t + 1)
        engine.onMode = (m) => setMode(m)
        engine.onMessage = (m) => setToast(m)
        engineRef.current = engine
        if (debug) (window as unknown as Record<string, unknown>).__vrEngine = engine
        setPhase('ready')
      } catch (e) {
        if (!live) return
        setErr(e instanceof ApiError ? (e.status === 404 ? 'This house does not exist, or it belongs to another account.' : e.message) : e instanceof Error ? e.message : 'The VR view could not be prepared.')
        setPhase('error')
      }
    })()
    return () => { live = false; engine?.dispose(); engineRef.current = null; houseRef.current = null }
  }, [id, attempt])

  const enter = useCallback(async () => {
    try { await engineRef.current?.enterVR() } catch (e) { setToast(e instanceof Error ? e.message : 'Could not start VR.') }
  }, [])
  const downloadGlb = () => {
    const h = houseRef.current
    if (!h) return
    const url = URL.createObjectURL(new Blob([h.glb], { type: 'model/gltf-binary' }))
    const a = document.createElement('a')
    a.href = url; a.download = `${(project?.name ?? 'house').replace(/[^\w-]+/g, '_')}.glb`; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const eng = engineRef.current
  const board = eng?.panel.voice
  const floors = eng?.house.smart.floors.length ?? 1
  return (
    <main className="wrap" style={{ paddingBottom: 60, width: 'min(1400px, 100% - 32px)' }}>
      <div className="page-head" style={{ paddingBottom: 10 }}>
        <Link to="/app/vr" className="small">← All houses</Link>
        <h1 style={{ fontSize: '1.7rem', marginTop: 6 }} data-testid="vr-title">{project?.name ?? 'VR walk-through'}</h1>
      </div>

      {phase === 'loading' && (
        <div className="pcard pcard-pad stack" data-testid="vr-loading">
          <Spinner label={progress.msg} />
          <div style={{ height: 8, borderRadius: 4, background: '#e6dfcf', overflow: 'hidden' }}><div style={{ width: `${Math.round(progress.frac * 100)}%`, height: '100%', background: '#b8860b', transition: 'width .3s' }} /></div>
          <p className="small muted">The house is built from your saved plan and loaded as a .glb model. Large houses can take a few seconds, longer on a headset.</p>
        </div>
      )}
      {phase === 'error' && (
        <div className="stack" data-testid="vr-error">
          <Notice kind="bad">{err}</Notice>
          <div className="row"><button type="button" className="pbtn pbtn-primary pbtn-sm" onClick={() => setAttempt((a) => a + 1)}>Try again</button><Link to="/app/vr" className="pbtn pbtn-ghost pbtn-sm">Back to my houses</Link></div>
        </div>
      )}

      <div style={{ display: phase === 'ready' ? 'block' : 'none' }}>
        {eng && (
          <div className="row" style={{ marginBottom: 10, alignItems: 'center' }}>
            <button type="button" className="pbtn pbtn-primary" disabled={!eng.xrSupported || mode === 'vr'} onClick={() => void enter()} data-testid="enter-vr" style={{ fontSize: '1.05rem', padding: '12px 20px' }}>{mode === 'vr' ? 'In VR' : 'Enter VR'}</button>
            {mode === 'vr' && <button type="button" className="pbtn pbtn-danger" onClick={() => void eng.exitVR()} data-testid="exit-vr">Exit VR</button>}
            {!eng.xrSupported && <span className="small" style={{ color: 'var(--warn, #8a5a00)' }} data-testid="vr-unavailable">{eng.xrStatus.state === 'supported' ? '' : 'message' in eng.xrStatus ? eng.xrStatus.message : ''}</span>}
            <span className="grow" />
            <button type="button" className="pbtn pbtn-primary pbtn-sm" onClick={() => eng.toggleCustom()} data-testid="toggle-custom" aria-pressed={eng.customOpen}>{eng.customOpen ? 'Close' : 'Open'} customization</button>
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => eng.setLighting(eng.lighting === 'day' ? 'evening' : 'day')} data-testid="toggle-lighting" aria-pressed={eng.lighting === 'evening'}>{eng.lighting === 'day' ? 'Switch to evening light' : 'Switch to daylight'}</button>
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => setPanelShown((s) => !s)} data-testid="toggle-panel">{panelShown ? 'Hide' : 'Show'} Smart House panel</button>
            {Array.from({ length: Math.min(floors, 4) }, (_, f) => <button key={f} type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => eng.goToFloor(f)} data-testid={`go-floor-${f}`}>{f === 0 ? 'Ground floor' : `Floor ${f}`}</button>)}
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={downloadGlb} data-testid="download-glb" title="The exact .glb this view loaded">Download .glb</button>
          </div>
        )}
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: '1 1 560px', minWidth: 0 }}>
            <div ref={stage} data-testid="vr-stage" style={{ position: 'relative', width: '100%', height: 'min(72vh, 700px)', minHeight: 360, background: '#20242e', borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }} />
            {eng && <p className="small muted" style={{ marginTop: 6 }} data-testid="vr-hud">Now in: <b>{eng.roomName}</b> · {eng.floorIndex === 0 ? 'ground floor' : `floor ${eng.floorIndex}`}{toast ? ` · ${toast}` : ''}</p>}
            {eng && <WalkNote house={eng.house} />}
            <p className="small muted">Desktop: drag to look, W A S D / arrow keys to walk (Shift = faster), hold T and release to teleport to the green marker, click wall switches, fan regulators or a ceiling fan itself (a small OFF / 1 / 2 / 3 / 4 / 5 control opens beside it); F toggles the nearest fan and 0, 1, 2, 3, 4, 5 set its speed. Headset: left stick walks, right stick turns (push it forward and release to teleport), trigger presses, left Y shows or hides the Smart House panel, right A shows or hides the Customize panel.</p>
          </div>
          {eng && eng.customOpen && mode === 'desktop' && (
            <div style={{ flex: '1 1 420px', minWidth: 0, maxWidth: '100%' }}>
              <DomPanel L={eng.customPanelLayout} press={(b) => eng.custom.press(b.id)} testId="custom-panel" idPrefix="" />
            </div>
          )}
          {eng && panelShown && mode === 'desktop' && (
            <div style={{ flex: '1 1 420px', minWidth: 0, maxWidth: '100%', display: 'grid', gap: 10, justifyItems: 'start' }}>
              <DomPanel L={eng.layout} press={(b) => b.action && eng.runAction(b.action)} />
              <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { eng.handleCommand(typed); setTyped('') } }} style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 760 }}>
                <label className="sr-only" htmlFor="cmd">Type a command</label>
                <input id="cmd" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a command, e.g. “turn on the kitchen light”" data-testid="typed-command" />
                <button className="pbtn pbtn-ghost pbtn-sm" type="submit">Run</button>
                {eng.voiceAvailable && <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => eng.pushToTalk()} data-testid="mic">🎤 Speak</button>}
              </form>
              <p className="small" data-testid="voice-status" style={{ color: board?.tone === 'bad' ? '#a33' : undefined }}>{board?.headline}{board?.detail ? ` — ${board.detail}` : ''}</p>
              {eng.voiceAvailable && (
                <div style={{ display: 'grid', gap: 6, width: '100%', maxWidth: 760 }} data-testid="handsfree-box">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="pbtn pbtn-ghost pbtn-sm" data-testid="handsfree-toggle" onClick={() => void eng.toggleMic()}>
                      {eng.handsFree.active ? '🔇 Mute hands-free listening' : eng.handsFree.status.phase === 'muted' ? '🎙 Resume hands-free listening' : '🎙 Start hands-free listening'}
                    </button>
                    <span className="small" data-testid="handsfree-status" role="status" aria-live="polite">{hudInfo(eng.handsFree.status)?.text ?? 'Hands-free listening is off (it starts automatically when you enter VR).'}</span>
                  </div>
                  <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" data-testid="wake-required" checked={eng.handsFree.status.wake === 'required'} onChange={(e) => { const m = e.target.checked ? 'required' : 'optional'; eng.setWakeMode(m); try { window.localStorage.setItem('rea.voice.wake', m) } catch { /* private mode */ } }} />
                    Only act on commands that start with “Hey Home” (otherwise a command works with or without it)
                  </label>
                  <p className="small muted">While hands-free listening is on, your browser's speech service is listening for commands, and in Chrome-based browsers that audio is sent to the browser vendor's online service. Nothing is recorded or stored by this app. Mute or leave VR to stop it.</p>
                </div>
              )}
              {!eng.voiceAvailable && <p className="small muted" data-testid="voice-unavailable">Voice commands: {eng.voiceReason} Typed commands use the same command parser, and every control above still works.</p>}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

/** What the walk-through had to assume or could not guarantee: shown only when the plan needed it (a plan with a door for every room shows nothing). */
function WalkNote({ house }: { house: LoadedHouse }) {
  const a = house.access?.plan
  if (!a) return null
  const name = (k: string) => k.replace(/^\d+:/, '').replace(/_/g, ' ')
  const lines: string[] = []
  if (a.added.length) lines.push(`${a.added.length} door${a.added.length > 1 ? 's' : ''} ${a.added.length > 1 ? 'were' : 'was'} assumed so you can walk to every room (${a.added.map((d) => `${name(`${d.floor}:${d.room}`)} ↔ ${d.to ? name(`${d.floor}:${d.to}`) : 'outside'}`).join(', ')}). Your saved plan is unchanged.`)
  if (a.throughDeadEnd.length) lines.push(`You reach ${a.throughDeadEnd.map(name).join(', ')} only by walking through a bathroom, bedroom, balcony or terrace. The plan's circulation should be fixed (regenerate the plan).`)
  if (a.unresolved.length) lines.push(`No walkable way in was found for ${a.unresolved.map(name).join(', ')}. Use the floor buttons or teleport there, and fix the plan.`)
  if (!lines.length) return null
  return <div className="small" data-testid="walk-note" style={{ marginTop: 6, color: a.unresolved.length ? '#a33' : 'var(--warn, #8a5a00)' }}>{lines.map((l, i) => <p key={i} style={{ margin: '2px 0' }}>{l}</p>)}</div>
}
