import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { Plan } from '@/types'
import { buildTwin, getWallH, SLAB } from './twinBuild'
import type { TwinModel } from './twinBuild'
import { designForStyle, designKey } from './twinThemes'
import { styleIdOf } from './twinStyles'
import type { Design } from './twinThemes'
import { applyLighting, createRig, makeSkyEnv, makeStudioEnv } from './twinScene'
import type { Rig } from './twinScene'
import DesignPanel from './DesignPanel'
import { downloadSmartHouse } from '@/lib/smartHouse'

export { buildTwin }
export type { TwinModel }

interface Props {
  plan: Plan
  height?: number
  /** a saved design (style, palette, overrides, light) to open with instead of the plan's own style defaults */
  initialDesign?: Design
  /** called whenever the user changes the design (layer B): style, palette, materials, light */
  onDesignChange?: (d: Design) => void
}

interface Ctx {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  renderer: THREE.WebGLRenderer
  rig: Rig
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  day: THREE.Texture
  dusk: THREE.Texture
  studio: THREE.Texture
  model: TwinModel | null
  framed: boolean
  dirty: boolean
}

/** Frees what belongs to one model.  Materials and textures made by the material kit are shared by every model and stay cached. */
function disposeModel(m: TwinModel) {
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => {
      if (x.userData?.shared) return
      const mm = x as THREE.MeshStandardMaterial
      if (mm.map && (mm.map as THREE.Texture & { __clone?: boolean }).image) mm.map.dispose()
      x.dispose()
    })
  })
}

const LAYOUT_CSS = `
.twin-layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:12px;align-items:start}
@media (max-width:960px){.twin-layout{grid-template-columns:minmax(0,1fr)}}
`

export default function TwinViewer({ plan, height = 560, initialDesign, onDesignChange }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const ctx = useRef<Ctx | null>(null)
  const [upTo, setUpTo] = useState<number>(plan.floors.length)
  const [showLabels, setShowLabels] = useState(true)
  const [showFurniture, setShowFurniture] = useState(true)
  const [showRoof, setShowRoof] = useState(true)
  const [cutaway, setCutaway] = useState(true)
  const [doorsOpen, setDoorsOpen] = useState(true)
  const [showArcs, setShowArcs] = useState(true)
  const doorTarget = useRef(1)
  doorTarget.current = doorsOpen ? 1 : 0
  const [spin, setSpin] = useState(false)
  // the plan's own architectural style (saved projects with an old style name map to Modern Minimalistic); changing plan resets to that style
  const planStyle = styleIdOf((plan as unknown as { architectural_style?: string }).architectural_style)
  const [design, setDesign] = useState<Design>(() => initialDesign ?? designForStyle(planStyle))
  const onDesign = useRef(onDesignChange)
  onDesign.current = onDesignChange
  const firstDesign = useRef(true)
  useEffect(() => {
    if (firstDesign.current) { firstDesign.current = false; return }
    onDesign.current?.(design)
  }, [design])
  const lastPlan = useRef(plan)
  useEffect(() => {
    if (lastPlan.current === plan) return
    lastPlan.current = plan
    setDesign((d) => designForStyle(planStyle, d.time))
  }, [plan, planStyle])
  const [ao, setAo] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const orbit = useRef<{ t0: number; dur: number } | null>(null)
  const [tod, setTod] = useState(0.5) // 0 = early morning, 0.5 = noon, 1 = afternoon
  const spinRef = useRef(false)
  spinRef.current = spin
  const names = useMemo(() => plan.floors.map((f) => f.floor), [plan])
  const dKey = designKey(design)

  // renderer, scene, lights, camera (rebuilt only when the plan changes)
  useEffect(() => {
    const el = mount.current
    if (!el) return
    const w = el.clientWidth || 800
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0xdce8f2, 140, 330)
    const camera = new THREE.PerspectiveCamera(42, w / height, 0.5, 2000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(w, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.92
    el.appendChild(renderer.domElement)
    const hemi = new THREE.HemisphereLight(0xfff3e4, 0xd6ccba, 0.4)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff4e0, 3)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.04
    sun.shadow.radius = 3
    scene.add(sun, sun.target)
    const day = makeSkyEnv(renderer, 'day')
    const dusk = makeSkyEnv(renderer, 'dusk')
    const studio = makeStudioEnv(renderer)
    scene.environment = studio
    scene.background = day
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI / 2.02
    const rig = createRig(renderer, scene, camera, w, height)
    ctx.current = { scene, camera, controls, renderer, rig, sun, hemi, day, dusk, studio, model: null, framed: false, dirty: true }

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.autoRotate = spinRef.current
      controls.autoRotateSpeed = 1.2
      let draw = ctx.current?.dirty ?? true
      const mdl = ctx.current?.model
      if (mdl && Math.abs(mdl.doorAmt.v - doorTarget.current) > 0.002) {
        mdl.doorAmt.v += (doorTarget.current - mdl.doorAmt.v) * 0.18
        mdl.doors.forEach((d) => (d.pivot.rotation.y = d.phi0 + d.dphi * mdl.doorAmt.v))
        draw = true
      }
      const ob = orbit.current
      const mm = ctx.current?.model
      if (ob && mm) {
        const t = Math.min(1, (performance.now() - ob.t0) / ob.dur)
        const a0 = Math.atan2(mm.road.z, mm.road.x)
        const a = a0 + t * Math.PI * 2
        const R = mm.size * 1.9
        camera.position.set(mm.center.x + Math.cos(a) * R, mm.size * (0.42 + 0.12 * Math.sin(t * Math.PI)), mm.center.z + Math.sin(a) * R)
        controls.target.copy(mm.center)
        draw = true
      }
      // the scene is static between interactions: draw only when the camera moves, a door swings or the design / view changes
      if (controls.update() || controls.autoRotate) draw = true
      if (draw) {
        rig.render()
        if (ctx.current) ctx.current.dirty = false
      }
    }
    loop()
    const onResize = () => {
      const nw = el.clientWidth || w
      renderer.setSize(nw, height)
      rig.setSize(nw, height)
      camera.aspect = nw / height
      camera.updateProjectionMatrix()
      if (ctx.current) ctx.current.dirty = true
    }
    window.addEventListener('resize', onResize)
    // test / debugging handle: the live scene, camera and model (read-only use)
    ;(window as unknown as { __twin?: unknown }).__twin = {
      THREE,
      get model() { return ctx.current?.model },
      get camera() { return ctx.current?.camera },
      get controls() { return ctx.current?.controls },
      get renderer() { return ctx.current?.renderer },
      get scene() { return ctx.current?.scene },
      render: () => ctx.current?.rig.render(),
      invalidate: () => { if (ctx.current) ctx.current.dirty = true },
    }
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      if (ctx.current?.model) disposeModel(ctx.current.model)
      rig.dispose()
      day.dispose()
      dusk.dispose()
      studio.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
      ctx.current = null
    }
  }, [plan, height])

  const sync = (m: TwinModel) => {
    const c = ctx.current
    if (!c) return
    m.floors.forEach((g, i) => (g.visible = i < upTo))
    m.roof.visible = upTo === m.floors.length && showRoof && !cutaway
    m.labels.forEach((l) => (l.visible = showLabels))
    m.furniture.forEach((f) => (f.visible = showFurniture))
    m.ceil.forEach((f) => (f.visible = !cutaway))
    m.doors.forEach((d) => (d.arc.visible = showArcs))
    const sc = cutaway ? 0.34 : 1
    const wh = getWallH()
    m.walls.forEach((w, i) => { w.scale.y = sc; w.position.y = (i * wh + SLAB) * (1 - sc) })
    m.doors.forEach((d) => { d.pivot.scale.y = sc })
    m.exterior.visible = !cutaway
    const evening = design.time === 'evening'
    for (const s of m.lights) {
      const on = evening && (s.floor < 0 ? !cutaway : s.floor < upTo)
      s.light.intensity = on ? s.on : 0
      s.light.visible = on // an unlit light costs nothing
    }
    c.dirty = true
  }

  // model (rebuilt when the plan or the design changes; the camera is kept)
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    if (c.model) { c.scene.remove(c.model.root); disposeModel(c.model) }
    const model = buildTwin(plan, design)
    c.model = model
    c.scene.add(model.root)
    const s = model.size
    if (!c.framed) {
      const k = 1
      c.camera.position.set(model.center.x + s * 1.25 * k, s * 1.15 * k, model.center.z + s * 1.65 * k)
      c.controls.target.copy(model.center)
      c.controls.update()
      c.framed = true
    }
    const sc = c.sun.shadow.camera as THREE.OrthographicCamera
    sc.left = -s * 1.2; sc.right = s * 1.2; sc.top = s * 1.2; sc.bottom = -s * 1.2; sc.far = s * 6
    sc.updateProjectionMatrix()
    const sm = s > 90 ? 4096 : s > 60 ? 3072 : 2048 // keep about 1 inch per shadow texel
    if (c.sun.shadow.mapSize.x !== sm) { c.sun.shadow.mapSize.set(sm, sm); c.sun.shadow.map?.dispose(); c.sun.shadow.map = null }
    model.doorAmt.v = doorTarget.current
    model.doors.forEach((d) => { d.pivot.rotation.y = d.phi0 + d.dphi * model.doorAmt.v })
    sync(model)
    applyLighting(c, design.time, tod, model.center, model.size)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, height, dKey])

  // visibility toggles
  useEffect(() => {
    const m = ctx.current?.model
    if (m) sync(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upTo, showLabels, showFurniture, showRoof, showArcs, cutaway, plan, dKey])

  // time of day: the sun travels east -> south -> west and changes colour (evening: low, warm, rooms lit)
  useEffect(() => {
    const c = ctx.current
    if (!c?.model) return
    applyLighting(c, design.time, tod, c.model.center, c.model.size)
    c.dirty = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tod, plan, dKey])

  useEffect(() => { const c = ctx.current; if (c) { c.rig.setAO(ao); c.dirty = true } }, [ao, plan, height])

  const view = (kind: 'corner' | 'top' | 'front' | 'street' | 'left' | 'right' | 'rear') => {
    const c = ctx.current
    if (!c?.model) return
    const m = c.model
    const s = m.size
    c.controls.target.copy(m.center)
    if (kind === 'top') c.camera.position.set(m.center.x, s * 2.1, m.center.z + 0.01)
    else if (kind === 'front') c.camera.position.set(m.center.x, s * 0.55, m.center.z + s * 2.3)
    else if (kind === 'corner') c.camera.position.set(m.center.x + s * 1.25, s * 1.15, m.center.z + s * 1.65)
    else {
      // relative to the street: street = looking at the front, left/right = 3/4 views, rear = the back
      const a0 = Math.atan2(m.road.z, m.road.x)
      const a = a0 + (kind === 'street' ? 0 : kind === 'left' ? -0.75 : kind === 'right' ? 0.75 : Math.PI)
      const R = s * (kind === 'street' ? 2.2 : 2.0)
      c.camera.position.set(m.center.x + Math.cos(a) * R, s * (kind === 'street' ? 0.32 : 0.42), m.center.z + Math.sin(a) * R)
    }
    c.controls.update()
    c.dirty = true
  }

  const exteriorMode = () => {
    setCutaway(false)
    setShowRoof(true)
    setShowLabels(false)
    setUpTo(plan.floors.length)
    setShowArcs(false)
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const download = (href: string, name: string) => {
    const a = document.createElement('a')
    a.href = href
    a.download = name
    a.click()
  }

  /** The 3D model exactly as built for the viewer (same scene graph, no separate export geometry), as a binary glTF with its materials and textures. */
  const exportGlb = async () => {
    const c = ctx.current
    if (!c?.model || busy) return
    setBusy('Preparing the 3D file…')
    const m = c.model
    const hidden = m.labels.filter((l) => l.visible)
    hidden.forEach((l) => (l.visible = false)) // text sprites are not part of the building
    // the file is the whole building at full height: not the cut-down walls, hidden floors or hidden roof of the current view
    const saved = {
      floors: m.floors.map((g) => g.visible), roof: m.roof.visible, exterior: m.exterior.visible, ceil: m.ceil.map((g) => g.visible),
      walls: m.walls.map((w) => [w.scale.y, w.position.y] as [number, number]), doors: m.doors.map((d) => d.pivot.scale.y), arcs: m.doors.map((d) => d.arc.visible),
      lights: m.lights.map((s) => s.light.visible),
    }
    m.floors.forEach((g) => (g.visible = true))
    m.roof.visible = true
    m.exterior.visible = true
    m.ceil.forEach((g) => (g.visible = true))
    m.walls.forEach((w) => { w.scale.y = 1; w.position.y = 0 })
    m.doors.forEach((d) => { d.pivot.scale.y = 1; d.arc.visible = false })
    m.lights.forEach((s) => (s.light.visible = false)) // the room lights belong to the viewer, not to the building
    try {
      const buf = await new Promise<ArrayBuffer>((resolve, reject) =>
        new GLTFExporter().parse(c.model!.root, (r) => (r instanceof ArrayBuffer ? resolve(r) : reject(new Error('unexpected export result'))), reject, { binary: true, onlyVisible: true }))
      const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }))
      download(url, `house-${plan.plan_number}.glb`)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } finally {
      hidden.forEach((l) => (l.visible = true))
      m.floors.forEach((g, i) => (g.visible = saved.floors[i]))
      m.roof.visible = saved.roof
      m.exterior.visible = saved.exterior
      m.ceil.forEach((g, i) => (g.visible = saved.ceil[i]))
      m.walls.forEach((w, i) => { w.scale.y = saved.walls[i][0]; w.position.y = saved.walls[i][1] })
      m.doors.forEach((d, i) => { d.pivot.scale.y = saved.doors[i]; d.arc.visible = saved.arcs[i] })
      m.lights.forEach((s, i) => (s.light.visible = saved.lights[i]))
      setBusy(null)
    }
  }

  const saveStills = async () => {
    const c = ctx.current
    if (!c || busy) return
    setBusy('Saving exterior images…')
    exteriorMode()
    await sleep(500)
    for (const k of ['street', 'left', 'right', 'rear'] as const) {
      view(k)
      await sleep(250)
      c.rig.render()
      download(c.renderer.domElement.toDataURL('image/png'), `concept-${plan.plan_number}-exterior-${k}.png`)
      await sleep(350)
    }
    setBusy(null)
  }

  const recordOrbit = async () => {
    const c = ctx.current
    if (!c || busy) return
    if (typeof MediaRecorder === 'undefined') { setBusy('This browser cannot record video.'); setTimeout(() => setBusy(null), 3000); return }
    setBusy('Recording 10 s orbit…')
    exteriorMode()
    setSpin(false)
    await sleep(500)
    const stream = c.renderer.domElement.captureStream(30)
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise<void>((res) => { rec.onstop = () => res() })
    const dur = 10000
    orbit.current = { t0: performance.now(), dur }
    rec.start()
    await sleep(dur + 150)
    rec.stop()
    orbit.current = null
    await done
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
    download(url, `concept-${plan.plan_number}-orbit.webm`)
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    view('street')
    setBusy(null)
  }

  const savePng = () => {
    const c = ctx.current
    if (!c) return
    c.rig.render()
    const a = document.createElement('a')
    a.href = c.renderer.domElement.toDataURL('image/png')
    a.download = `concept-${plan.plan_number}-twin.png`
    a.click()
  }

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 8, border: '1px solid ' + (active ? '#a94a26' : '#d3c2a5'),
    background: active ? '#a94a26' : '#fff', color: active ? '#fff' : '#2b1d16', cursor: 'pointer', fontSize: 13,
  })

  return (
    <div>
      <style>{LAYOUT_CSS}</style>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <button style={btn(upTo === names.length)} onClick={() => setUpTo(names.length)}>Whole house</button>
        {names.map((n, i) => (
          <button key={n} style={btn(upTo === i + 1 && upTo !== names.length)} onClick={() => setUpTo(i + 1)}>
            Up to {n}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button style={btn(false)} onClick={() => view('corner')}>Corner</button>
        <button style={btn(false)} onClick={() => view('top')}>Top</button>
        <button style={btn(false)} onClick={() => view('front')}>Front</button>
        <span style={{ width: 8 }} />
        <button style={btn(false)} onClick={() => { exteriorMode(); setTimeout(() => view('street'), 60) }}>Exterior</button>
        <button style={btn(false)} onClick={() => view('left')}>Left</button>
        <button style={btn(false)} onClick={() => view('right')}>Right</button>
        <button style={btn(false)} onClick={() => view('rear')}>Rear</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <button style={btn(doorsOpen)} onClick={() => setDoorsOpen((v) => !v)}>Doors open</button>
        <button style={btn(showArcs)} onClick={() => setShowArcs((v) => !v)}>Swing arcs</button>
        <button style={btn(showFurniture)} onClick={() => setShowFurniture((v) => !v)}>Furniture</button>
        <button style={btn(cutaway)} onClick={() => setCutaway((v) => !v)}>Cutaway walls</button>
        <button style={btn(showRoof)} onClick={() => setShowRoof((v) => !v)}>Roof</button>
        <button style={btn(showLabels)} onClick={() => setShowLabels((v) => !v)}>Labels</button>
        <button style={btn(spin)} onClick={() => setSpin((v) => !v)}>Auto-rotate</button>
        <span style={{ flex: 1 }} />
        <button style={btn(false)} onClick={savePng}>Save image</button>
        <button style={btn(false)} disabled={!!busy} onClick={saveStills}>Save 4 exterior stills</button>
        <button style={btn(false)} disabled={!!busy} onClick={exportGlb} title="Download the 3D model as a .glb file (opens in Blender, Windows 3D Viewer, web viewers)">Download 3D model (.glb)</button>
        <button style={btn(false)} disabled={!!busy} onClick={() => downloadSmartHouse(plan)} title="Download the smart-house data (room lights, ceiling fans, wall switches) that goes with the .glb, for the Unity / Meta Quest demo">Smart-house data (.json)</button>
        <button style={btn(false)} disabled={!!busy} onClick={recordOrbit}>Record orbit video</button>
      </div>
      {busy && <div style={{ fontSize: 13, color: '#a94a26', marginBottom: 6 }}>{busy}</div>}
      <div className="twin-layout">
        <div ref={mount} data-testid="twin-canvas" style={{ width: '100%', height, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }} />
        <DesignPanel hasCourtyard={plan.floors.some((f) => (f.layout?.rooms ?? []).some((r) => r.room_type === 'courtyard'))} design={design} onChange={setDesign} ao={ao} onAo={setAo} tod={tod} onTod={setTod} height={height} />
      </div>
      <p style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
        Drag to orbit, scroll to zoom, right-drag to pan. Walls, doors, windows and stairs come from the plan&apos;s own coordinates; the design only changes finishes and lighting
        ; furniture is an illustrative layout placed clear of doors and windows.
      </p>
    </div>
  )
}
