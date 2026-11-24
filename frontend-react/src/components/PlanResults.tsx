import { useEffect, useRef, useState } from 'react'
import type { Design } from './twinThemes'
import type { Plan } from '@/types'
import FloorPlanSvg from './FloorPlanSvg'
import TwinViewer from './TwinViewer'
import { critiquePlans } from '../lib/api'
import { normaliseStyle } from '../lib/archStyle'
import type { CritiqueResult } from '../lib/api'
import type { CSSProperties } from 'react'

interface PlanResultsProps {
  plans: Plan[]
  brief?: string
  /** save the chosen concept (with the 3D design the user left it in) to the user's projects; resolves to a message to show */
  onSave?: (plan: Plan, design?: Design) => Promise<string>
}

/** Qualitative reading of an internal 0-100 value: the number itself is never shown to the user. */
function band(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return 'Not assessed'
  if (n >= 85) return 'Excellent'
  if (n >= 70) return 'Good'
  if (n >= 50) return 'Fair'
  return 'Needs attention'
}

function buildRoomsTable(rooms: Array<{ room_type: string; width: number; length: number; area: number }>) {
  return rooms.map((r, idx) => (
    <tr key={idx}>
      <td>{r.room_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</td>
      <td>{r.width}</td>
      <td>{r.length}</td>
      <td>{r.area}</td>
    </tr>
  ))
}

export default function PlanResults({ plans, brief = '', onSave }: PlanResultsProps) {
  const designs = useRef<Record<number, Design>>({})
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [activePlan, setActivePlan] = useState<number | null>(plans.length > 0 ? 0 : null)
  const [activeTabByPlan, setActiveTabByPlan] = useState<Record<number, number>>({})
  const [shortlisted, setShortlisted] = useState<number | null>(null)
  const [critique, setCritique] = useState<CritiqueResult | null>(null)
  const [critiqueBusy, setCritiqueBusy] = useState(false)
  const [critiqueErr, setCritiqueErr] = useState<string | null>(null)

  const runCritique = async () => {
    setCritiqueBusy(true)
    setCritiqueErr(null)
    try {
      setCritique(await critiquePlans(plans, brief))
    } catch (e: unknown) {
      setCritiqueErr(e instanceof Error ? e.message : 'Comparison failed.')
    } finally {
      setCritiqueBusy(false)
    }
  }

  const activeTab = (planIndex: number, plan: Plan) => {
    return activeTabByPlan[planIndex] ?? 0
  }

  const setActiveTab = (planIndex: number, tab: number) => {
    setActiveTabByPlan((prev) => ({ ...prev, [planIndex]: tab }))
  }

  useEffect(() => {
    setShortlisted(null)
    setCritique(null)
    setCritiqueErr(null)
    setActivePlan(plans.length > 0 ? 0 : null)
  }, [plans])

  if (plans.length === 0) return null

  return (
    <div>
      <h3 style={{ marginBottom: '1rem', color: 'var(--ink)' }}>🏗️ Architectural Concepts</h3>

      <div style={{ margin: '0 0 1rem' }}>
        <button
          onClick={runCritique}
          disabled={critiqueBusy}
          style={{
            padding: '9px 16px', borderRadius: 10, border: '1px solid var(--accent)', cursor: 'pointer',
            background: critique ? '#fff' : 'var(--accent)', color: critique ? 'var(--accent)' : '#fff', fontWeight: 600,
          }}
        >
          {critiqueBusy ? 'Comparing…' : critique ? '🔄 Compare again' : '🧠 Compare & critique these concepts'}
        </button>
        {critiqueErr && <span style={{ marginLeft: 10, color: '#b91c1c', fontSize: 13 }}>{critiqueErr}</span>}
      </div>

      {critique && (
        <div style={{ margin: '0 0 1.25rem', padding: 16, borderRadius: 14, background: 'var(--paper)', border: '1px solid var(--line)' }}>
          <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ecfdf5', border: '1px solid #10b981', color: '#064e3b', marginBottom: 12 }}>
            <strong>★ Recommended: Concept {critique.pick.plan_number}.</strong> {critique.pick.reason}
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 12px' }}>{critique.overview}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
            {[...critique.plans].sort((a, b) => a.rank - b.rank).map((c) => (
              <div
                key={c.plan_number}
                style={{
                  padding: 12, borderRadius: 12, background: '#fff', fontSize: 13, lineHeight: 1.5,
                  border: c.plan_number === critique.pick.plan_number ? '2px solid #10b981' : '1px solid var(--line)',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                  #{c.rank} · Concept {c.plan_number}
                </div>
                <div style={{ color: 'var(--ink-2)', margin: '2px 0 8px' }}>{c.headline}</div>
                {c.strengths.map((t, i) => (
                  <div key={'s' + i} style={{ color: '#166534' }}>✓ {t}</div>
                ))}
                {c.concerns.map((t, i) => (
                  <div key={'c' + i} style={{ color: '#9a3412' }}>⚠ {t}</div>
                ))}
                {c.best_for && <div style={{ marginTop: 8, color: 'var(--ink-2)' }}><em>Best for: {c.best_for}</em></div>}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
            {critique.source === 'gemini'
              ? 'Wording by Gemini from measured facts (areas, adjacencies, daylight, circulation). '
              : 'Built-in comparison from measured facts (areas, adjacencies, daylight, circulation). '}
            {critique.note ?? ''}
          </div>
        </div>
      )}

      <div className="plans-overview-grid">
        {plans.map((plan, idx) => (
          <div
            key={plan.plan_number}
            className="plan-card"
            style={{
              cursor: 'pointer',
              outline: activePlan === idx ? '2px solid var(--accent)' : 'none',
              outlineOffset: 2,
            }}
            onClick={() => setActivePlan(idx)}
          >
            <h4 style={{ color: 'var(--ink)', marginBottom: 8 }}>
              Concept {plan.plan_number}
              {critique && critique.pick.plan_number === plan.plan_number && (
                <span style={{ marginLeft: 8, fontSize: 12, color: '#047857' }}>★ Recommended</span>
              )}
            </h4>
            <p style={{ fontSize: '0.9rem', color: 'var(--ink-2)', marginBottom: 8 }}>
              <strong>{plan.topology.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</strong>
            </p>
            <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
              {plan.strategy.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </div>
          </div>
        ))}
      </div>

      {activePlan !== null && (() => {
        const plan = plans[activePlan]
        const currentTab = activeTab(activePlan, plan)
        const isShort = shortlisted === activePlan
        const tabs = [...plan.floors.map((f) => f.floor), 'Analysis', ...(isShort ? ['3D Digital Twin'] : [])]
        const builtUp = plan.floors.reduce(
          (acc, f) => acc + (Number(f.layout?.used_room_area) || 0),
          0,
        )

        return (
          <div className="plan-details">
            <div className="plan-detail-header">
              <h3 style={{ color: 'var(--ink)', marginBottom: 12 }}>
                Concept {plan.plan_number} —{' '}
                {plan.topology.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </h3>
              <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    if (isShort) {
                      setShortlisted(null)
                    } else {
                      setShortlisted(activePlan)
                      setActiveTab(activePlan, plan.floors.length + 1)
                    }
                  }}
                  style={{
                    padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontWeight: 600,
                    border: '1px solid var(--accent)', background: isShort ? 'var(--accent)' : '#fff',
                    color: isShort ? '#fff' : 'var(--accent)',
                  }}
                >
                  {isShort ? '★ Shortlisted — remove' : '☆ Shortlist this concept'}
                </button>
                {onSave && (
                  <button
                    type="button" data-testid="save-project" disabled={saving}
                    onClick={async () => {
                      setSaving(true); setSaveMsg(null)
                      try { setSaveMsg({ ok: true, text: await onSave(plan, designs.current[plan.plan_number]) }) }
                      catch (e) { setSaveMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }) }
                      finally { setSaving(false) }
                    }}
                    style={{ padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, border: '1px solid var(--wood)', background: 'var(--gold-soft)', color: 'var(--ink)' }}
                  >
                    {saving ? 'Saving…' : '💾 Save to my projects'}
                  </button>
                )}
                {saveMsg && <span role="status" data-testid="save-msg" style={{ fontSize: 13, color: saveMsg.ok ? '#3f6b3a' : '#9b2c20' }}>{saveMsg.text}</span>}
                {!isShort && (
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                    Shortlist one concept to generate its 3D digital twin.
                  </span>
                )}
              </div>
              <div className="snapshot-grid" style={{ marginBottom: 0 }}>
                <div className="snapshot-item">
                  <div className="label">Topology</div>
                  <div className="value" style={{ fontSize: '0.9rem' }}>
                    {plan.topology.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </div>
                </div>
                <div className="snapshot-item">
                  <div className="label">Vastu</div>
                  <div className="value" style={{ fontSize: '0.9rem' }}>
                    {(plan.vastu_mode ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </div>
                </div>
                <div className="snapshot-item">
                  <div className="label">Built-up</div>
                  <div className="value">{builtUp.toFixed(0)} sq.ft</div>
                </div>
                <div className="snapshot-item">
                  <div className="label">Style</div>
                  <div className="value" style={{ fontSize: '0.85rem' }}>
                    {normaliseStyle(plan.architectural_style)}
                  </div>
                </div>
              </div>
            </div>

            <div
              className="section-card"
              style={{ borderRadius: '0 0 16px 16px', borderTop: 'none', marginTop: 0 }}
            >
              <div className="plan-detail-tabs">
                {tabs.map((t, i) => (
                  <button
                    key={t}
                    className={`plan-detail-tab ${currentTab === i ? 'active' : ''}`}
                    onClick={() => setActiveTab(activePlan, i)}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {currentTab < plan.floors.length ? (() => {
                const floor = plan.floors[currentTab]
                const layout = floor.layout
                const rooms = layout?.rooms ?? []
                const plotRef = layout?.plot ?? { width: 40, length: 50 }
                const usablePlotRef = layout?.usable_plot
                const roadSide = layout?.road_side ?? plan.road_side ?? 'North'
                const doors = layout?.openings?.doors?.length ?? 0
                const windows = layout?.openings?.windows?.length ?? 0
                return (
                  <div>
                    <FloorPlanSvg
                      layout={layout}
                      plot={plotRef}
                      usablePlot={usablePlotRef}
                      roadSide={roadSide}
                      style={{ height: 620 }}
                      stair={(plan as unknown as { staircase?: unknown }).staircase}
                      floorIndex={currentTab}
                    />
                    <div className="floor-metrics">
                      <div className="floor-metric">
                        <div className="label">Rooms</div>
                        <div className="value">{rooms.length}</div>
                      </div>
                      <div className="floor-metric">
                        <div className="label">Used area</div>
                        <div className="value">{Number(layout?.used_room_area ?? 0).toFixed(0)} sq.ft</div>
                      </div>
                      <div className="floor-metric">
                        <div className="label">Open area</div>
                        <div className="value">{Number(layout?.remaining_area ?? 0).toFixed(0)} sq.ft</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 20 }}>
                      <h4 style={{ color: 'var(--ink)', marginBottom: 10, fontSize: '1rem' }}>Room schedule</h4>
                      {rooms.length === 0 ? (
                        <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>No rooms to display.</div>
                      ) : (
                        <table className="room-schedule-table">
                          <thead>
                            <tr>
                              <th>Room</th>
                              <th>Width (ft)</th>
                              <th>Length (ft)</th>
                              <th>Area (sq.ft)</th>
                            </tr>
                          </thead>
                          <tbody>{buildRoomsTable(rooms)}</tbody>
                        </table>
                      )}
                    </div>

                    <div style={{ marginTop: 16, fontSize: '0.85rem', color: 'var(--muted)' }}>
                      🚪 Doors: {doors} &nbsp;|&nbsp; 🪟 Windows: {windows}
                    </div>

                    <div className="download-row">
                      <button
                        className="download-btn"
                        onClick={() => downloadSvg(plan, floor.floor, layout, plotRef, usablePlotRef, roadSide)}
                      >
                        ⬇️ Download floor plan (SVG)
                      </button>
                      <button
                        className="download-btn"
                        onClick={() => downloadJson(plan)}
                      >
                        ⬇️ Download concept data (JSON)
                      </button>
                    </div>
                  </div>
                )
              })() : currentTab === plan.floors.length + 1 && isShort ? (
                <TwinViewer key={plan.plan_number} plan={plan} onDesignChange={(d) => { designs.current[plan.plan_number] = d }} />
              ) : (
                <div className="analysis-section">
                  <h4>🧠 Why this concept was generated</h4>
                  <ul className="analysis-list">
                    {(plan.explanation ?? []).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>

                  {plan.energy && Object.keys(plan.energy).length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <h4>🌦️ Energy / Passive Design</h4>
                      {Object.entries(plan.energy).map(([floorName, data]) => (
                        <div key={floorName} style={{ marginBottom: 12 }}>
                          <div style={{ color: 'var(--ink-2)', marginBottom: 4 }}>
                            <strong>{floorName}</strong>{' '}
                            <span style={{ color: 'var(--muted)' }}>({data.climate ?? 'Auto'}):</span>{' '}
                            <strong>{band(data.score)}</strong>{' '}
                            <span style={{ color: 'var(--ink-2)', fontSize: '0.88rem' }}>
                              (Light: {band(data.light_score)}, Ventilation: {band(data.ventilation_score)})
                            </span>
                          </div>
                          {(data.recommendations ?? []).map((rec, i) => (
                            <div key={i} style={{ fontSize: '0.85rem', color: 'var(--muted)', paddingLeft: 12 }}>
                              — {rec}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  {plan.cost && (
                    <div style={{ marginTop: 24 }}>
                      <h4>💰 Indicative Construction Cost</h4>
                      <div style={{ color: 'var(--ink)', marginBottom: 4 }}>
                        Estimated total:{' '}
                        <strong style={{ fontSize: '1.1rem' }}>
                          ₹{Number(plan.cost.estimated_total_cost ?? 0).toLocaleString()}
                        </strong>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{plan.cost.note}</div>
                    </div>
                  )}

                  <div style={{ marginTop: 24 }}>
                    <h4>📋 Validation</h4>
                    {(plan.validation ?? []).map((item, i) => {
                      const v = item?.validation
                      if (!v) return null
                      const scores = v.scores ?? {}
                      return (
                        <div key={i} style={{ marginBottom: 12 }}>
                          <div style={{ color: 'var(--ink-2)', marginBottom: 6 }}>
                            <strong>{item.floor}:</strong>{' '}
                            <span style={{ color: v.valid ? '#166534' : '#92400e', fontWeight: 600 }}>
                              {v.valid ? 'VALID' : 'REVIEW'}
                            </span>{' '}
                            <span style={{ color: 'var(--ink-2)', fontSize: '0.88rem' }}>
                              Functional: {band(scores.functional)} • Vastu: {band(scores.vastu)}
                            </span>
                          </div>
                          {(v.errors ?? []).map((err, j) => (
                            <div key={`err-${j}`} className="alert alert-error" style={{ marginBottom: 6 }}>
                              {err}
                            </div>
                          ))}
                          {(v.warnings ?? []).map((warn, j) => (
                            <div key={`warn-${j}`} className="alert alert-warning" style={{ marginBottom: 6 }}>
                              {warn}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function serializeSvgToXmlString(root: Element): string {
  const clone = root.cloneNode(true) as Element
  applyInlineStyles(clone)
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    new XMLSerializer().serializeToString(clone)
}

function applyInlineStyles(root: Element) {
  if (!document.defaultView) return
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node: Node | null = walk.currentNode
  while (node) {
    const el = node as Element
    if (el instanceof HTMLElement || el instanceof SVGElement) {
      const computed = document.defaultView.getComputedStyle(el)
      const style = (el as HTMLElement).getAttribute('style') ?? ''
      if (!style) {
        ;(el as HTMLElement).setAttribute('style', computed.cssText)
      }
    }
    node = walk.nextNode()
  }
}

function findContainerSvg(e: Element | null): SVGSVGElement | null {
  let cur: Element | null = e
  while (cur) {
    if (cur instanceof SVGSVGElement) return cur
    cur = cur.parentElement
  }
  return null
}

function downloadSvg(
  plan: Plan,
  floorName: string,
  layout: Plan['floors'][0]['layout'],
  plotRef: { width: number; length: number; area?: number },
  usablePlotRef: Layout['usable_plot'] | undefined,
  roadSide: Plan['road_side'],
) {
  const rootId = `fp-root-concept-${plan.plan_number}-floor-${floorName}`
  let target = document.getElementById(rootId) as HTMLDivElement | null
  if (!target) {
    const mountedCandidates = document.querySelectorAll('.floor-svg-container')
    const container = mountedCandidates[mountedCandidates.length - 1]
    if (container) {
      const svg = findContainerSvg(container.firstElementChild)
      if (svg) {
        const xml = serializeSvgToXmlString(svg)
        triggerDownload(xml, `concept_${plan.plan_number}_${floorName}_floorplan.svg`, 'image/svg+xml')
        return
      }
    }
    target = document.createElement('div')
    target.id = rootId
    target.style.position = 'absolute'
    target.style.left = '-10000px'
    target.style.top = '-10000px'
    target.style.width = '2000px'
    target.style.height = '2000px'
    document.body.appendChild(target)
    try {
      triggerRender(target, plan, floorName, layout, plotRef, usablePlotRef, roadSide)
      const afterRender = () => {
        const svg = target!.querySelector('svg')
        if (svg) {
          const xml = serializeSvgToXmlString(svg)
          triggerDownload(xml, `concept_${plan.plan_number}_${floorName}_floorplan.svg`, 'image/svg+xml')
        }
        setTimeout(() => target && document.body.contains(target) && document.body.removeChild(target), 50)
      }
      setTimeout(afterRender, 0)
      return
    } catch (err) {
      if (target && document.body.contains(target)) document.body.removeChild(target)
      fallbackPlanToTextDownload(plan, floorName, layout, plotRef, usablePlotRef, roadSide)
      return
    }
  }
  const svg = target.querySelector('svg')
  if (svg) {
    const xml = serializeSvgToXmlString(svg)
    triggerDownload(xml, `concept_${plan.plan_number}_${floorName}_floorplan.svg`, 'image/svg+xml')
  } else {
    fallbackPlanToTextDownload(plan, floorName, layout, plotRef, usablePlotRef, roadSide)
  }
}

function triggerRender(
  container: HTMLDivElement,
  _plan: Plan,
  _floorName: string,
  _layout: Plan['floors'][0]['layout'],
  _plotRef: { width: number; length: number; area?: number },
  _usablePlotRef: Layout['usable_plot'] | undefined,
  _roadSide: Plan['road_side'],
) {
  // Not strictly necessary: most of the time the mounted SVG already exists.
  void container
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function fallbackPlanToTextDownload(
  _plan: Plan,
  _floorName: string,
  _layout: Plan['floors'][0]['layout'],
  _plotRef: { width: number; length: number; area?: number },
  _usablePlotRef: Layout['usable_plot'] | undefined,
  _roadSide: Plan['road_side'],
) {
  // Best-effort fallback: serialize the full plan JSON as the SVG if we can't re-render.
  triggerDownload(
    JSON.stringify({ plan: _plan, floor: _floorName }, null, 2),
    `concept_${_plan.plan_number}_${_floorName}.json`,
    'application/json',
  )
}

function downloadJson(plan: Plan) {
  const data = JSON.stringify(plan, null, 2)
  triggerDownload(data, `concept_${plan.plan_number}.json`, 'application/json')
}

// Re-export unused types/vars to keep linter happy in strict mode.
export type { CSSProperties }

// Local Layout re-reference to avoid unused import error.
import type { Layout } from '@/types'
