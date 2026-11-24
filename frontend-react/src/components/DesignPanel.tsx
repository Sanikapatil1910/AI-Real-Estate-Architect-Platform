import { useEffect, useState } from 'react'
import { CHOICES, THEMES, designForStyle, overridesCount } from './twinThemes'
import { STYLES, STYLE_ORDER } from './twinStyles'
import type { Design, Overrides, ThemeId } from './twinThemes'
import { themeThumbnails } from './twinThumbs'

/**
 * Design studio of the 3D viewer: seven themes (each card is a render of that theme's own materials), day / evening light, and
 * separate Interior and Exterior controls.  Every control writes into `Design.over`; nothing here touches the plan's geometry.
 */

interface Props {
  design: Design
  onChange: (d: Design) => void
  ao: boolean
  onAo: (v: boolean) => void
  tod: number
  onTod: (v: number) => void
  height: number
  /** whether the plan itself contains a courtyard room (only then can the 3D show a real open court) */
  hasCourtyard?: boolean
}

type Choice = { id: string; label: string; swatch: string }
type OptKey = keyof Overrides

const INTERIOR: Array<{ key: OptKey; title: string; kind: 'swatch' | 'seg'; furn?: boolean }> = [
  { key: 'floor', title: 'Floor material', kind: 'swatch' },
  { key: 'floorFinish', title: 'Floor finish', kind: 'seg' },
  { key: 'wallColor', title: 'Wall colour', kind: 'swatch' },
  { key: 'wallFinish', title: 'Wall finish', kind: 'seg' },
  { key: 'ceiling', title: 'Ceiling style', kind: 'seg' },
  { key: 'furnWood', title: 'Furniture wood', kind: 'swatch', furn: true },
  { key: 'upholstery', title: 'Sofa & chair fabric', kind: 'swatch', furn: true },
  { key: 'cabinets', title: 'Kitchen cabinets', kind: 'swatch', furn: true },
  { key: 'counter', title: 'Countertop', kind: 'swatch', furn: true },
  { key: 'bathTile', title: 'Bathroom tiles', kind: 'swatch', furn: true },
  { key: 'fixtures', title: 'Bathroom fixtures', kind: 'swatch', furn: true },
  { key: 'door', title: 'Doors', kind: 'swatch' },
  { key: 'windowFrame', title: 'Window frames', kind: 'swatch' },
  { key: 'curtains', title: 'Curtains', kind: 'swatch', furn: true },
]
const EXTERIOR: Array<{ key: OptKey; title: string; kind: 'swatch' | 'seg' }> = [
  { key: 'facadeFinish', title: 'Facade finish', kind: 'seg' },
  { key: 'facadeColor', title: 'Facade colour', kind: 'swatch' },
  { key: 'trim', title: 'Trim & frames', kind: 'swatch' },
  { key: 'railing', title: 'Balcony railing', kind: 'seg' },
]

const CSS = `
.dp{--dp-bd:var(--line);--dp-fg:var(--ink);--dp-mut:var(--muted);--dp-acc:var(--accent);background:#fff;border:1px solid var(--dp-bd);border-radius:12px;padding:12px;font-size:13px;color:var(--dp-fg);overflow:auto;max-height:var(--dp-h);box-sizing:border-box}
.dp h3{margin:0;font-size:15px}
.dp h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--dp-mut)}
.dp-top{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.dp-styles{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px;margin-bottom:12px}
.dp-style{display:flex;flex-direction:column;gap:3px;text-align:left;padding:8px 9px;border:2px solid var(--dp-bd);border-radius:10px;background:#fff;cursor:pointer;color:var(--dp-fg)}
.dp-style b{font-size:12.5px}.dp-style span{font-size:10.5px;color:var(--dp-mut);line-height:1.3}
.dp-style:hover{box-shadow:0 2px 10px rgba(15,23,42,.15)}
.dp-style[aria-pressed=true]{border-color:var(--dp-acc);box-shadow:0 0 0 2px rgba(169,74,38,.22);background:var(--paper)}
.dp-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}
.dp-card{padding:0;border:2px solid var(--dp-bd);border-radius:10px;overflow:hidden;background:#fff;cursor:pointer;text-align:left;transition:box-shadow .15s,border-color .15s}
.dp-card:hover{box-shadow:0 2px 10px rgba(15,23,42,.15)}
.dp-card[aria-pressed=true]{border-color:var(--dp-acc);box-shadow:0 0 0 2px rgba(169,74,38,.22)}
.dp-card:focus-visible{outline:2px solid var(--dp-acc);outline-offset:2px}
.dp-img{display:block;width:100%;aspect-ratio:320/220;object-fit:cover;background:#e5e7eb}
.dp-cap{padding:6px 8px 7px}
.dp-cap b{display:block;font-size:12.5px}
.dp-cap span{display:block;font-size:11px;color:var(--dp-mut);line-height:1.3;margin-top:1px}
.dp-sec{border-top:1px solid var(--dp-bd);padding:8px 0}
.dp-sec>summary{cursor:pointer;font-weight:600;font-size:13.5px;list-style:none;display:flex;justify-content:space-between;align-items:center}
.dp-sec>summary::-webkit-details-marker{display:none}
.dp-sec>summary::after{content:'▾';color:var(--dp-mut)}
.dp-sec:not([open])>summary::after{content:'▸'}
.dp-row{margin:9px 0}
.dp-row>label,.dp-lbl{display:flex;justify-content:space-between;font-size:12px;color:var(--ink-2);margin-bottom:4px}
.dp-sw{display:flex;flex-wrap:wrap;gap:6px}
.dp-dot{width:26px;height:26px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px var(--line-2);cursor:pointer;padding:0}
.dp-dot[aria-pressed=true]{box-shadow:0 0 0 2px var(--dp-acc)}
.dp-dot:focus-visible{outline:2px solid var(--dp-acc);outline-offset:2px}
.dp-seg{display:flex;gap:0;border:1px solid var(--line-2);border-radius:8px;overflow:hidden}
.dp-seg button{flex:1;padding:5px 6px;border:0;background:#fff;cursor:pointer;font-size:12px;color:var(--dp-fg);border-right:1px solid var(--line)}
.dp-seg button:last-child{border-right:0}
.dp-seg button[aria-pressed=true]{background:var(--dp-acc);color:#fff}
.dp-btn{padding:5px 10px;border-radius:8px;border:1px solid var(--line-2);background:#fff;cursor:pointer;font-size:12px;color:var(--dp-fg)}
.dp-btn:hover{background:var(--ivory-2)}
.dp-link{background:none;border:0;color:var(--dp-acc);cursor:pointer;font-size:12px;padding:0}
.dp-chk{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:12.5px}
.dp-note{font-size:11.5px;color:var(--dp-mut);margin:6px 0 0}
@media (max-width:960px){.dp{max-height:none}.dp-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:620px){.dp-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
`

export default function DesignPanel({ design, onChange, ao, onAo, tod, onTod, height, hasCourtyard = true }: Props) {
  const [thumbs, setThumbs] = useState<Partial<Record<ThemeId, string>>>({})
  useEffect(() => {
    const id = window.setTimeout(() => {
      try { setThumbs(themeThumbnails()) } catch { /* no WebGL for the previews: the cards fall back to colour chips */ }
    }, 30)
    return () => window.clearTimeout(id)
  }, [])

  const def = THEMES[design.theme]
  const valOf = (k: OptKey): string => String((design.over[k] as unknown) ?? (def.o as unknown as Record<string, unknown>)[k])
  const set = (k: OptKey, v: unknown) => {
    const over: Record<string, unknown> = { ...design.over }
    if (v === (def.o as unknown as Record<string, unknown>)[k]) delete over[k]
    else over[k] = v
    onChange({ ...design, over: over as Overrides })
  }
  const clear = (keys: OptKey[]) => {
    const over: Record<string, unknown> = { ...design.over }
    for (const k of keys) delete over[k]
    onChange({ ...design, over: over as Overrides })
  }
  const choices = (k: OptKey): Choice[] => (CHOICES as unknown as Record<string, Choice[]>)[k] ?? []

  const control = (o: { key: OptKey; title: string; kind: 'swatch' | 'seg' }) => {
    const list = choices(o.key)
    const cur = valOf(o.key)
    const curLabel = list.find((c) => c.id === cur)?.label ?? ''
    return (
      <div className="dp-row" key={o.key} data-testid={`row-${o.key}`}>
        <div className="dp-lbl"><span>{o.title}</span><span style={{ color: 'var(--muted)' }}>{curLabel}</span></div>
        {o.kind === 'swatch' ? (
          <div className="dp-sw" role="group" aria-label={o.title}>
            {list.map((c) => (
              <button key={c.id} type="button" className="dp-dot" style={{ background: c.swatch }} title={c.label} aria-label={`${o.title}: ${c.label}`}
                aria-pressed={cur === c.id} data-testid={`opt-${o.key}-${c.id}`} onClick={() => set(o.key, c.id)} />
            ))}
          </div>
        ) : (
          <div className="dp-seg" role="group" aria-label={o.title}>
            {list.map((c) => (
              <button key={c.id} type="button" aria-pressed={cur === c.id} data-testid={`opt-${o.key}-${c.id}`} onClick={() => set(o.key, c.id)}>{c.label}</button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const interior = INTERIOR
  const exterior = EXTERIOR
  const nOver = overridesCount(design)
  const fl = CHOICES.floor.find((c) => c.id === def.o.floor)
  const wl = CHOICES.wallColor.find((c) => c.id === def.o.wallColor)

  return (
    <aside className="dp" style={{ ['--dp-h' as string]: `${height}px` }} data-testid="design-panel" aria-label="Design studio">
      <style>{CSS}</style>
      <div className="dp-top">
        <h3 style={{ flex: 1 }}>Design studio</h3>
        <button type="button" className="dp-btn" data-testid="design-reset" onClick={() => { onChange(designForStyle(design.style)); onAo(true); onTod(0.5) }} title="Back to this style's default palette, daylight and no customisation">Reset to default</button>
      </div>

      <div className="dp-styles" role="group" aria-label="Architectural style" data-testid="style-picker">
        {STYLE_ORDER.map((id) => (
          <button key={id} type="button" className="dp-style" aria-pressed={design.style === id} data-testid={`style-${id}`}
            onClick={() => { if (design.style !== id) onChange(designForStyle(id, design.time)) }} title={STYLES[id].blurb}>
            <b>{STYLES[id].label}</b><span>{STYLES[id].blurb}</span>
          </button>
        ))}
      </div>

      {design.style === 'maharashtrian_wada' && !hasCourtyard && (
        <p className="dp-note" data-testid="wada-court-note" style={{ marginTop: 0 }}>
          A Wada is traditionally built around a central courtyard (chowk). This plan has no courtyard room and adding one would move rooms and walls,
          so it is never done automatically: the 3D shows a front angan with tulsi and rangoli instead. For a real courtyard, upload or regenerate a plan that includes one.
        </p>
      )}

      <div className="dp-cards" role="group" aria-label="Design themes">
        {STYLES[design.style].themes.map((id) => {
          const t = THEMES[id]
          const f = CHOICES.floor.find((c) => c.id === t.o.floor)
          const w = CHOICES.wallColor.find((c) => c.id === t.o.wallColor)
          return (
            <button key={id} type="button" className="dp-card" aria-pressed={design.theme === id} data-testid={`theme-${id}`} onClick={() => onChange({ ...design, theme: id, over: {} })} title={t.blurb}>
              {thumbs[id]
                ? <img className="dp-img" src={thumbs[id]} alt={`${t.label} interior preview`} />
                : <span className="dp-img" style={{ background: `linear-gradient(180deg, ${w?.swatch ?? '#eee'} 0 62%, ${f?.swatch ?? '#ccc'} 62% 100%)` }} />}
              <span className="dp-cap"><b>{t.label}</b><span>{t.blurb}</span></span>
            </button>
          )
        })}
      </div>

      <details className="dp-sec" open>
        <summary>Lighting</summary>
        <div className="dp-row">
          <div className="dp-seg" role="group" aria-label="Lighting">
            <button type="button" aria-pressed={design.time === 'day'} data-testid="time-day" onClick={() => onChange({ ...design, time: 'day' })}>☀ Daylight</button>
            <button type="button" aria-pressed={design.time === 'evening'} data-testid="time-evening" onClick={() => onChange({ ...design, time: 'evening' })}>🌙 Warm evening</button>
          </div>
        </div>
        <div className="dp-row" style={{ opacity: design.time === 'day' ? 1 : 0.45 }}>
          <div className="dp-lbl"><span>Sun position</span><span>{tod < 0.25 ? 'Morning' : tod < 0.75 ? 'Midday' : 'Afternoon'}</span></div>
          <input type="range" min={0} max={1} step={0.01} value={tod} disabled={design.time !== 'day'} onChange={(e) => onTod(Number(e.target.value))} aria-label="Sun position" style={{ width: '100%' }} />
        </div>
        <label className="dp-chk"><input type="checkbox" checked={ao} onChange={(e) => onAo(e.target.checked)} data-testid="ao-toggle" /> Ambient occlusion (soft contact shadows)</label>
      </details>

      <details className="dp-sec" open data-testid="section-interior">
        <summary>Interior</summary>
        {interior.map(control)}
        <button type="button" className="dp-link" onClick={() => clear(INTERIOR.map((o) => o.key))}>Use the theme&apos;s own interior</button>
      </details>

      <details className="dp-sec" open data-testid="section-exterior">
        <summary>Exterior</summary>
        {exterior.map(control)}
        <label className="dp-chk"><input type="checkbox" checked={Boolean(design.over.landscaping ?? def.o.landscaping)} data-testid="opt-landscaping" onChange={(e) => set('landscaping', e.target.checked)} /> Garden planting (only in the plan&apos;s green areas)</label>
        <label className="dp-chk"><input type="checkbox" checked={Boolean(design.over.extLights ?? def.o.extLights)} data-testid="opt-extLights" onChange={(e) => set('extLights', e.target.checked)} /> Exterior lights (lit in the evening)</label>
        <button type="button" className="dp-link" onClick={() => clear([...EXTERIOR.map((o) => o.key), 'landscaping', 'extLights'])}>Use the theme&apos;s own exterior</button>
      </details>

      <p className="dp-note" data-testid="design-summary">
        {STYLES[design.style].label} · {def.label}{nOver ? ` · ${nOver} customised` : ''} · {design.time === 'day' ? 'daylight' : 'evening'}.
        {' '}Floor {fl?.label.toLowerCase()}, walls {wl?.label.toLowerCase()} by default. Changing the design never moves a room, wall, door or window.
      </p>
    </aside>
  )
}
