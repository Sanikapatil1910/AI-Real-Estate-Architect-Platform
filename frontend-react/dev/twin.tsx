/**
 * Development / test harness: mounts the real TwinViewer on a saved plan (dev/fixtures/<name>.json, ?plan=g1_0; ?view=2d draws the 2D plan instead) so the 3D view can be
 * checked without running the generator.  Served by `vite` only; it is not part of the production build.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import TwinViewer from '@/components/TwinViewer'
import FloorPlanSvg from '@/components/FloorPlanSvg'
import type { Plan } from '@/types'

const q = new URLSearchParams(location.search)
const name = q.get('plan') ?? 'g1_0'
const h = Number(q.get('h') ?? 640)
const view = q.get('view') ?? '3d'
const floor = Number(q.get('floor') ?? 0)

function App() {
  const [plan, setPlan] = React.useState<Plan | null>(null)
  React.useEffect(() => { fetch(`/dev/fixtures/${name}.json`).then((r) => r.json()).then((p) => { const st = q.get('style'); if (st) p.architectural_style = st; setPlan(p) }) }, [])
  if (!plan) return <p>loading…</p>
  if (view === '2d') {                       // the 2D plan exactly as PlanResults draws it (?view=2d&floor=0)
    const layout = plan.floors[floor].layout
    return (
      <FloorPlanSvg layout={layout} plot={layout.plot ?? { width: 40, length: 50 }} usablePlot={layout.usable_plot}
        roadSide={layout.road_side ?? plan.road_side ?? 'North'} stair={(plan as unknown as { staircase?: unknown }).staircase}
        floorIndex={floor} style={{ height: 620 }} />
    )
  }
  return <TwinViewer plan={plan} height={h} />
}
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
