import type { CSSProperties } from 'react'
import * as THREE from 'three'
import type { Layout, Plot, RoadSide, Room, Door, Window } from '@/types'
import { furnishFloor, projectTopDown } from './twinFloor'
import type { PlanShape, RoomT } from './twinFloor'
import { stairLocal, stairSpec, stairVariant, toPlanRect } from './stairSpec'
import type { StairDrawn } from './stairSpec'
import type { StairSpec } from './stairSpec'
import { stairEntryHigh, swingRoom } from './twinDoorsStairs'
import type { RoomR } from './twinDoorsStairs'
import { wallBands } from './walls'

interface FloorPlanSvgProps {
  layout: Layout
  plot: Plot
  usablePlot?: Layout['usable_plot']
  roadSide?: RoadSide
  style?: CSSProperties
  scale?: number
  title?: string
  /** the plan's `staircase` block (risers, treads, landings) */
  stair?: unknown
  /** index of the floor being drawn (0 = ground) */
  floorIndex?: number
}

const ROOM_LABELS: Record<string, string> = {
  living_room: 'LIVING ROOM',
  dining: 'DINING',
  kitchen: 'KITCHEN',
  master_bedroom: 'MASTER BEDROOM',
  bedroom: 'BEDROOM',
  guest_bedroom: 'GUEST BEDROOM',
  bathroom: 'BATHROOM',
  toilet: 'TOILET (WC)',
  parking: 'CAR PARKING',
  utility: 'UTILITY',
  dressing: 'DRESSING',
  puja_room: 'PUJA',
  staircase: 'STAIRCASE',
  foyer: 'FOYER',
}

const OPEN_SPACE_LABELS: Record<string, string> = {
  front_open_space: 'FRONT YARD',
  rear_open_space: 'REAR YARD',
  side_open_space: 'SIDE YARD',
  courtyard: 'COURTYARD',
  circulation: 'CIRCULATION',
  future_expansion: 'FUTURE EXPANSION',
}

const ROOM_STYLE: Record<
  string,
  { fill: string; pattern?: 'wood' | 'tile' | 'marble' }
> = {
  living_room: { fill: '#f6efe1', pattern: 'wood' },
  dining: { fill: '#f6efe1', pattern: 'wood' },
  master_bedroom: { fill: '#f2e7d6', pattern: 'wood' },
  bedroom: { fill: '#f2e7d6', pattern: 'wood' },
  guest_bedroom: { fill: '#f2e7d6', pattern: 'wood' },
  kitchen: { fill: '#efe7d4', pattern: 'tile' },
  bathroom: { fill: '#eef3f1', pattern: 'marble' },
  toilet: { fill: '#eef3f1', pattern: 'marble' },
  parking: { fill: '#d9d6cf' },
  utility: { fill: '#efe7d4', pattern: 'tile' },
  dressing: { fill: '#f2e7d6', pattern: 'wood' },
  puja_room: { fill: '#f7ecd2', pattern: 'wood' },
  staircase: { fill: '#e8dfd1', pattern: 'wood' },
  foyer: { fill: '#f5ede0', pattern: 'wood' },
}

function labelForRoom(roomType: string): string {
  return (
    ROOM_LABELS[roomType] ??
    roomType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

function getPatternId(
  roomType: string,
): { fill: string; patternId: string | null } {
  const style = ROOM_STYLE[roomType] ?? { fill: '#f6efe1', pattern: 'wood' as const }
  if (style.pattern === 'wood') return { fill: '', patternId: 'fp-wood' }
  if (style.pattern === 'tile') return { fill: '', patternId: 'fp-tile' }
  if (style.pattern === 'marble') return { fill: '', patternId: 'fp-marble' }
  return { fill: style.fill, patternId: null }
}

/* ---------------- Wall segment helper ---------------- */
type WallEnds = { x1: number; y1: number; x2: number; y2: number }

function wallSegment(
  room: Room,
  wall: 'top' | 'bottom' | 'left' | 'right' | string,
  position: number,
  width: number,
  scale: number,
  originX: number,
  originY: number,
): WallEnds {
  const x = originX + room.x * scale
  const y = originY + room.y * scale
  const w = room.width * scale
  const h = room.length * scale
  const pos = position * scale
  const opening = Math.max(12, width * scale)
  if (wall === 'top') return { x1: x + pos, y1: y, x2: x + pos + opening, y2: y }
  if (wall === 'bottom') return { x1: x + pos, y1: y + h, x2: x + pos + opening, y2: y + h }
  if (wall === 'left') return { x1: x, y1: y + pos, x2: x, y2: y + pos + opening }
  return { x1: x + w, y1: y + pos, x2: x + w, y2: y + pos + opening }
}

/* ---------------- Staircase ---------------- */
/**
 * Stair drawn from the real rules (150 mm risers, 300 mm treads, 1 m landings) in whichever shape it has
 * (U, straight, L, double L, spiral): every tread at true size, landings, the well, the flight above the 1.2 m cut
 * plane dashed (ground floor) and an UP / DN arrow along the walking line.  Same geometry as the 3D twin.
 */
function StaircaseSvg({
  room,
  scale,
  originX,
  originY,
  entryHigh,
  upper,
  spec,
}: {
  room: { x: number; y: number; x2: number; y2: number }
  scale: number
  originX: number
  originY: number
  entryHigh: boolean
  upper: boolean
  spec: StairSpec
}) {
  const P = toPlanRect({ room_type: 'staircase', ...room }, entryHigh, spec.axis)
  const G = stairLocal(spec, P.L, P.W)
  const px = (ft: number, axis: 'x' | 'y') => (axis === 'x' ? originX : originY) + ft * scale
  const rect = (u0: number, u1: number, v0: number, v1: number) => {
    const b = P.map(u0, u1, v0, v1)
    return { x: px(b.x0, 'x'), y: px(b.y0, 'y'), w: (b.x1 - b.x0) * scale, h: (b.y1 - b.y0) * scale }
  }
  const pt = (u: number, v: number) => {
    const b = P.pt(u, v)
    return [px(b.x, 'x'), px(b.y, 'y')] as const
  }
  const ink = '#3b2d20'
  const cutRise = 1.2 * 3.2808 // plan cut plane, ft above the floor
  const lines: JSX.Element[] = []
  const dashedFor = (t: { flight: number; top: number }) => (!upper && t.top > cutRise) || (upper && t.flight < G.nFlights)
  G.treads.forEach((t, i) => {
    const dashed = dashedFor(t)
    const common = {
      fill: dashed ? 'none' : '#efe6d4', stroke: ink, strokeWidth: dashed ? 0.9 : 1.2,
      strokeDasharray: dashed ? '4 3' : undefined, opacity: dashed ? 0.8 : 1,
    }
    if (t.rot) {
      // wedge of a spiral: a rotated rectangle about its own centre
      const c = pt(t.rot.cu, t.rot.cv)
      const d = pt(t.rot.cu + Math.cos(t.rot.ang), t.rot.cv + Math.sin(t.rot.ang))
      const deg = (Math.atan2(d[1] - c[1], d[0] - c[0]) * 180) / Math.PI
      lines.push(
        <rect key={`t${i}`} x={c[0] - (t.rot.len * scale) / 2} y={c[1] - (t.rot.wid * scale) / 2} width={t.rot.len * scale}
          height={t.rot.wid * scale} transform={`rotate(${deg} ${c[0]} ${c[1]})`} {...common} />,
      )
      return
    }
    const r = rect(t.u0, t.u1, t.v0, t.v1)
    lines.push(<rect key={`t${i}`} x={r.x} y={r.y} width={r.w} height={r.h} {...common} />)
  })
  const foot = rect(G.foot.u0, G.foot.u1, G.foot.v0, G.foot.v1)
  const path = G.arrow.map(([u, v]) => pt(u, v))
  if (upper) path.reverse()
  const last = path[path.length - 1]
  const prev = path[path.length - 2] ?? path[0]
  const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0])
  const ah = 7
  const head = `${last[0]},${last[1]} ${last[0] - ah * Math.cos(ang - 0.45)},${last[1] - ah * Math.sin(ang - 0.45)} ${last[0] - ah * Math.cos(ang + 0.45)},${last[1] - ah * Math.sin(ang + 0.45)}`
  const label = upper ? 'DN' : 'UP'
  const tp = path[0]
  const caption = `${spec.n} R @ ${Math.round(spec.riser * 304.8)} · T 300`
  const well = G.well ? rect(G.well.u0, G.well.u1, G.well.v0, G.well.v1) : null
  const ldMain = G.landings[0] ? rect(G.landings[0].u0, G.landings[0].u1, G.landings[0].v0, G.landings[0].v1) : null
  return (
    <g>
      <rect x={foot.x} y={foot.y} width={foot.w} height={foot.h} fill="#f6f0e2" stroke={ink} strokeWidth={0.8} strokeDasharray="2 3" />
      {G.landings.map((l, i) => {
        const q = rect(l.u0, l.u1, l.v0, l.v1)
        return <rect key={`l${i}`} x={q.x} y={q.y} width={q.w} height={q.h} fill="#d9cdb6" stroke={ink} strokeWidth={1.3} />
      })}
      {lines}
      {well && <rect x={well.x} y={well.y} width={well.w} height={well.h} fill="#5b3f26" opacity={0.55} />}
      {G.column && (() => {
        const c = pt(G.column.u, G.column.v)
        return <circle cx={c[0]} cy={c[1]} r={G.column.r * scale} fill="#5b3f26" opacity={0.85} />
      })()}
      <polyline points={path.map((p) => `${p[0]},${p[1]}`).join(' ')} fill="none" stroke="#1a1410" strokeWidth={1.8} />
      <polygon points={head} fill="#1a1410" />
      <text x={tp[0]} y={tp[1] - 4} fontFamily="Arial, sans-serif" fontSize={10} fontWeight={800} fill="#1a1410">{label}</text>
      {ldMain && Math.min(P.L, P.W) * scale > 70 && G.landings.length === 1 && (
        <text x={ldMain.x + ldMain.w / 2} y={ldMain.y + ldMain.h / 2 + 3} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={8.5} fill="#4a3a2a">
          {caption}
        </text>
      )}
    </g>
  )
}

/* ---------------- Furniture: living ---------------- */
function LivingFurniture({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const edge = '#4b3a2b'
  const fabric = '#c8b8a2'
  const fabricDark = '#a8957d'
  const woodDark = '#8a6b4d'
  const woodLight = '#b5906d'
  const green = '#6b8a4c'
  const side = Math.min(width, height)
  const sofaX = x + width * 0.12
  const sofaY = y + height * 0.18
  const sofaW = width * 0.54
  const sofaH = height * 0.3
  const sofaRx = side * 0.06
  const planterR = side * 0.048
  const planterCx = x + width * 0.88
  const planterCy = y + height * 0.8

  const tableCx = x + width * 0.4
  const tableCy = y + height * 0.6
  const tableRx = width * 0.14
  const tableRy = height * 0.08

  const rugCx = x + width * 0.4
  const rugCy = y + height * 0.52
  const rugRx = width * 0.28
  const rugRy = height * 0.22

  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <ellipse
        cx={rugCx}
        cy={rugCy}
        rx={rugRx}
        ry={rugRy}
        fill="#e6d4b8"
        stroke="#bfa985"
        strokeWidth={1.2}
        strokeDasharray="3 3"
        opacity={0.55}
      />
      <rect
        x={sofaX - sofaW * 0.06}
        y={sofaY}
        width={sofaW * 0.08}
        height={sofaH}
        rx={4}
        fill={fabricDark}
        stroke={edge}
        strokeWidth={1.2}
      />
      <rect
        x={sofaX + sofaW * 0.98}
        y={sofaY}
        width={sofaW * 0.08}
        height={sofaH}
        rx={4}
        fill={fabricDark}
        stroke={edge}
        strokeWidth={1.2}
      />
      <rect
        x={sofaX}
        y={sofaY}
        width={sofaW}
        height={sofaH}
        rx={sofaRx}
        fill={fabric}
        stroke={edge}
        strokeWidth={1.4}
      />
      <rect
        x={sofaX + sofaW * 0.05}
        y={sofaY + sofaH * 0.05}
        width={sofaW * 0.9}
        height={sofaH * 0.25}
        rx={sofaRx * 0.7}
        fill={fabricDark}
        stroke="none"
        opacity={0.55}
      />
      <line
        x1={sofaX + sofaW * 0.34}
        y1={sofaY + sofaH * 0.32}
        x2={sofaX + sofaW * 0.34}
        y2={sofaY + sofaH * 0.92}
        stroke={fabricDark}
        strokeWidth={1.1}
      />
      <line
        x1={sofaX + sofaW * 0.67}
        y1={sofaY + sofaH * 0.32}
        x2={sofaX + sofaW * 0.67}
        y2={sofaY + sofaH * 0.92}
        stroke={fabricDark}
        strokeWidth={1.1}
      />
      <ellipse
        cx={tableCx}
        cy={tableCy}
        rx={tableRx}
        ry={tableRy}
        fill={woodLight}
        stroke={edge}
        strokeWidth={1.4}
      />
      <ellipse
        cx={tableCx}
        cy={tableCy}
        rx={tableRx * 0.72}
        ry={tableRy * 0.72}
        fill="none"
        stroke={woodDark}
        strokeWidth={1}
        opacity={0.6}
      />
      <rect
        x={x + width * 0.7}
        y={y + height * 0.14}
        width={width * 0.2}
        height={height * 0.08}
        rx={2}
        fill={woodDark}
        stroke={edge}
        strokeWidth={1.2}
      />
      <rect
        x={x + width * 0.68}
        y={y + height * 0.22}
        width={width * 0.24}
        height={height * 0.07}
        fill={woodLight}
        stroke={edge}
        strokeWidth={1.2}
      />
      <circle cx={planterCx} cy={planterCy} r={planterR} fill="#c8a980" stroke={edge} strokeWidth={1.2} />
      <path
        d={`M${planterCx},${planterCy + planterR * 0.2} C${planterCx - planterR * 1.5},${planterCy - planterR * 1.8} ${
          planterCx - planterR * 1.8
        },${planterCy - planterR * 0.8} ${planterCx - planterR * 0.4},${planterCy - planterR * 0.4}`}
        fill="none"
        stroke={green}
        strokeWidth={2}
      />
      <path
        d={`M${planterCx},${planterCy + planterR * 0.2} C${planterCx + planterR * 1.5},${planterCy - planterR * 1.8} ${
          planterCx + planterR * 1.8
        },${planterCy - planterR * 0.8} ${planterCx + planterR * 0.4},${planterCy - planterR * 0.4}`}
        fill="none"
        stroke={green}
        strokeWidth={2}
      />
    </g>
  )
}

/* ---------------- Furniture: bedroom ---------------- */
function BedroomFurniture({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const edge = '#4b3a2b'
  const bedding = '#e8e0d3'
  const beddingAccent = '#c9a47c'
  const woodHead = '#8a6a4d'
  const woodBase = '#a3805e'
  const rugFill = '#e2cfae'
  const bedX = x + width * 0.22
  const bedY = y + height * 0.26
  const bedW = width * 0.52
  const bedH = height * 0.4
  const bedRx = Math.min(width, height) * 0.04
  const pillowW = bedW * 0.3
  const pillowH = bedH * 0.18
  const sideSq = Math.min(width, height) * 0.1

  const rugX = x + width * 0.16
  const rugY = y + height * 0.22
  const rugW = width * 0.64
  const rugH = height * 0.5
  const rugRx = Math.min(width, height) * 0.08

  return (
    <g>
      <rect
        x={rugX}
        y={rugY}
        width={rugW}
        height={rugH}
        rx={rugRx}
        fill={rugFill}
        stroke="#c6a97e"
        strokeWidth={1.2}
        opacity={0.5}
      />
      <rect
        x={bedX - bedW * 0.05}
        y={bedY - bedH * 0.1}
        width={bedW * 1.1}
        height={bedH * 0.12}
        rx={2}
        fill={woodHead}
        stroke={edge}
        strokeWidth={1.3}
      />
      <rect
        x={bedX}
        y={bedY}
        width={bedW}
        height={bedH}
        rx={bedRx}
        fill={bedding}
        stroke={edge}
        strokeWidth={1.5}
      />
      <rect
        x={bedX + bedW * 0.04}
        y={bedY + bedH * 0.58}
        width={bedW * 0.92}
        height={bedH * 0.38}
        rx={bedRx * 0.7}
        fill={beddingAccent}
        stroke="none"
        opacity={0.5}
      />
      <path
        d={`M${bedX + bedW * 0.06},${bedY + bedH * 0.58} Q${bedX + bedW * 0.5},${bedY + bedH * 0.7} ${
          bedX + bedW * 0.94
        },${bedY + bedH * 0.58}`}
        fill="none"
        stroke="#a07e57"
        strokeWidth={1.2}
        opacity={0.7}
      />
      {[bedX + bedW * 0.08, bedX + bedW * 0.62].map((px, i) => (
        <g key={i}>
          <rect
            x={px}
            y={bedY + bedH * 0.1}
            width={pillowW}
            height={pillowH}
            rx={pillowH * 0.4}
            fill="#fbf7f0"
            stroke="#7a6856"
            strokeWidth={1}
          />
          <path
            d={`M${px + pillowW * 0.15},${bedY + bedH * 0.1 + pillowH * 0.5} Q${px + pillowW * 0.5},${
              bedY + bedH * 0.1 + pillowH * 0.3
            } ${px + pillowW * 0.85},${bedY + bedH * 0.1 + pillowH * 0.5}`}
            fill="none"
            stroke="#c6b59d"
            strokeWidth={1}
          />
        </g>
      ))}
      {[bedX - sideSq * 1.35, bedX + bedW + sideSq * 0.35].map((sx, i) => (
        <g key={i}>
          <rect
            x={sx}
            y={bedY + bedH * 0.22}
            width={sideSq}
            height={sideSq}
            rx={3}
            fill={woodBase}
            stroke={edge}
            strokeWidth={1.2}
          />
          <circle
            cx={sx + sideSq / 2}
            cy={bedY + bedH * 0.22 + sideSq * 0.35}
            r={sideSq * 0.1}
            fill="#e2cfad"
            stroke={edge}
            strokeWidth={0.8}
          />
        </g>
      ))}
      <rect
        x={x + width * 0.06}
        y={y + height * 0.76}
        width={width * 0.36}
        height={height * 0.15}
        fill={woodBase}
        stroke={edge}
        strokeWidth={1.3}
      />
      <line
        x1={x + width * 0.06 + width * 0.18}
        y1={y + height * 0.76}
        x2={x + width * 0.06 + width * 0.18}
        y2={y + height * 0.76 + height * 0.15}
        stroke={edge}
        strokeWidth={1.3}
      />
      <circle cx={x + width * 0.06 + width * 0.16} cy={y + height * 0.76 + height * 0.075} r={1.6} fill="#f4e6cb" />
      <circle cx={x + width * 0.06 + width * 0.2} cy={y + height * 0.76 + height * 0.075} r={1.6} fill="#f4e6cb" />
      <line
        x1={x + width * 0.06}
        y1={y + height * 0.76 + height * 0.06}
        x2={x + width * 0.06 + width * 0.36}
        y2={y + height * 0.76 + height * 0.06}
        stroke="#d9c29a"
        strokeWidth={1}
        opacity={0.7}
      />
    </g>
  )
}

/* ---------------- Furniture: dining ---------------- */
function DiningFurniture({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const edge = '#4b3a2b'
  const tableTop = '#d8b990'
  const chairFabric = '#d9cab3'
  const tableX = x + width * 0.22
  const tableY = y + height * 0.28
  const tableW = width * 0.56
  const tableH = height * 0.34
  const tableRx = Math.min(width, height) * 0.08
  const chairW = width * 0.13
  const chairH = height * 0.12
  const chairs: Array<[number, number]> = [
    [tableX + tableW * 0.18, tableY - chairH * 1.35],
    [tableX + tableW * 0.68, tableY - chairH * 1.35],
    [tableX + tableW * 0.18, tableY + tableH + chairH * 0.35],
    [tableX + tableW * 0.68, tableY + tableH + chairH * 0.35],
    [tableX - chairW * 1.3, tableY + tableH * 0.3],
    [tableX + tableW + chairW * 0.3, tableY + tableH * 0.3],
  ]

  const rugX = x + width * 0.1
  const rugY = y + height * 0.12
  const rugW = width * 0.8
  const rugH = height * 0.76
  const rugRx = Math.min(width, height) * 0.08

  return (
    <g>
      <rect
        x={rugX}
        y={rugY}
        width={rugW}
        height={rugH}
        rx={rugRx}
        fill="#ead9bc"
        stroke="#c9ab80"
        strokeWidth={1.2}
        opacity={0.45}
      />
      <rect
        x={tableX}
        y={tableY}
        width={tableW}
        height={tableH}
        rx={tableRx}
        fill={tableTop}
        stroke={edge}
        strokeWidth={1.5}
      />
      <rect
        x={tableX + tableW * 0.08}
        y={tableY + tableH * 0.12}
        width={tableW * 0.84}
        height={tableH * 0.76}
        rx={tableRx * 0.7}
        fill="none"
        stroke="#a8845a"
        strokeWidth={1}
        opacity={0.65}
      />
      {chairs.map(([cx, cy], i) => (
        <g key={i}>
          <rect
            x={cx}
            y={cy}
            width={chairW}
            height={chairH}
            rx={4}
            fill={chairFabric}
            stroke={edge}
            strokeWidth={1.2}
          />
          <rect
            x={cx}
            y={cy}
            width={chairW}
            height={chairH * 0.35}
            rx={3}
            fill="#bca98c"
            stroke={edge}
            strokeWidth={1}
          />
          <line
            x1={cx + chairW * 0.2}
            y1={cy + chairH * 0.28}
            x2={cx + chairW * 0.8}
            y2={cy + chairH * 0.28}
            stroke="#8f7a5c"
            strokeWidth={1}
          />
        </g>
      ))}
    </g>
  )
}

/* ---------------- Furniture: kitchen ---------------- */
function KitchenFurniture({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const edge = '#4b3a2b'
  const cabinet = '#b59876'
  const counter = '#d7c6a4'
  const steel = '#7899a8'
  const counterX = x + width * 0.08
  const counterY = y + height * 0.1
  const counterW = width * 0.84
  const counterH = height * 0.18
  const sinkX = counterX + counterW * 0.5
  const sinkY = counterY + counterH * 0.22
  const sinkW = counterW * 0.18
  const sinkH = counterH * 0.55
  const burnerR = Math.min(width, height) * 0.038

  return (
    <g>
      <rect
        x={counterX}
        y={counterY + counterH}
        width={counterW}
        height={height * 0.26}
        fill={cabinet}
        stroke={edge}
        strokeWidth={1.3}
      />
      <line
        x1={counterX + counterW * 0.33}
        y1={counterY + counterH}
        x2={counterX + counterW * 0.33}
        y2={counterY + counterH + height * 0.26}
        stroke="#7f6343"
        strokeWidth={1.1}
      />
      <line
        x1={counterX + counterW * 0.66}
        y1={counterY + counterH}
        x2={counterX + counterW * 0.66}
        y2={counterY + counterH + height * 0.26}
        stroke="#7f6343"
        strokeWidth={1.1}
      />
      <rect
        x={counterX}
        y={counterY}
        width={counterW}
        height={counterH}
        fill={counter}
        stroke={edge}
        strokeWidth={1.3}
      />
      <rect
        x={sinkX}
        y={sinkY}
        width={sinkW}
        height={sinkH}
        rx={4}
        fill="#eaf1f4"
        stroke={steel}
        strokeWidth={1.2}
      />
      <line
        x1={sinkX}
        y1={sinkY + sinkH / 2}
        x2={sinkX + sinkW}
        y2={sinkY + sinkH / 2}
        stroke={steel}
        strokeWidth={1}
        opacity={0.5}
      />
      <path
        d={`M${sinkX + sinkW * 0.1},${sinkY - 2.5} v${6}`}
        stroke={steel}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <circle cx={sinkX + sinkW * 0.1} cy={sinkY - 2.5} r={1.8} fill={steel} />
      {[counterX + counterW * 0.15, counterX + counterW * 0.26].map((bx, i) => (
        <g key={i}>
          <circle
            cx={bx}
            cy={counterY + counterH * 0.55}
            r={burnerR}
            fill="none"
            stroke={edge}
            strokeWidth={1.1}
          />
          <circle cx={bx} cy={counterY + counterH * 0.55} r={burnerR * 0.35} fill={edge} />
          <circle
            cx={bx}
            cy={counterY + counterH * 0.55}
            r={burnerR * 0.15}
            fill="#d7c6a4"
          />
        </g>
      ))}
      <rect
        x={x + width * 0.72}
        y={y + height * 0.46}
        width={width * 0.18}
        height={height * 0.38}
        rx={3}
        fill="#eef2f3"
        stroke={edge}
        strokeWidth={1.3}
      />
      <line
        x1={x + width * 0.72}
        y1={y + height * 0.46 + height * 0.18}
        x2={x + width * 0.9}
        y2={y + height * 0.46 + height * 0.18}
        stroke={edge}
        strokeWidth={1.2}
      />
      <line
        x1={x + width * 0.72 + width * 0.14}
        y1={y + height * 0.46 + height * 0.08}
        x2={x + width * 0.72 + width * 0.14}
        y2={y + height * 0.46 + height * 0.13}
        stroke={edge}
        strokeWidth={1.2}
      />
      <line
        x1={x + width * 0.72 + width * 0.14}
        y1={y + height * 0.46 + height * 0.26}
        x2={x + width * 0.72 + width * 0.14}
        y2={y + height * 0.46 + height * 0.31}
        stroke={edge}
        strokeWidth={1.2}
      />
    </g>
  )
}

/* ---------------- Furniture: bathroom ---------------- */
function BathroomFurniture({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const edge = '#4b3a2b'
  const porcelain = '#f7f7f3'
  const chrome = '#5f8594'
  const tileAccent = '#8ca5a9'
  const toiletX = x + width * 0.24
  const toiletY = y + height * 0.26
  const basinX = x + width * 0.72
  const basinY = y + height * 0.22
  const showerX = x + width * 0.54
  const showerY = y + height * 0.72
  const showerR = Math.min(width, height) * 0.04
  const basinRx = width * 0.12
  const basinRy = height * 0.085
  const toiletBaseRx = width * 0.105
  const toiletBaseRy = height * 0.14

  return (
    <g>
      <rect
        x={toiletX - width * 0.1}
        y={toiletY - height * 0.12}
        width={width * 0.2}
        height={height * 0.1}
        rx={3}
        fill={porcelain}
        stroke={tileAccent}
        strokeWidth={1.1}
      />
      <ellipse
        cx={toiletX}
        cy={toiletY + height * 0.04}
        rx={toiletBaseRx}
        ry={toiletBaseRy}
        fill={porcelain}
        stroke={tileAccent}
        strokeWidth={1.1}
      />
      <ellipse
        cx={toiletX}
        cy={toiletY + height * 0.05}
        rx={toiletBaseRx * 0.52}
        ry={toiletBaseRy * 0.52}
        fill="none"
        stroke={tileAccent}
        strokeWidth={1}
      />
      <rect
        x={basinX - width * 0.14}
        y={basinY - height * 0.12}
        width={width * 0.28}
        height={height * 0.12}
        rx={2}
        fill="#c9b290"
        stroke={edge}
        strokeWidth={1.1}
      />
      <ellipse cx={basinX} cy={basinY} rx={basinRx} ry={basinRy} fill={porcelain} stroke={chrome} strokeWidth={1.2} />
      <circle cx={basinX} cy={basinY} r={Math.min(width, height) * 0.02} fill={chrome} />
      <path
        d={`M${basinX - 1.5},${basinY - basinRy - 2} q1.5,-4 3,0`}
        fill="none"
        stroke={chrome}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <rect
        x={x + width * 0.34}
        y={y + height * 0.52}
        width={width * 0.46}
        height={height * 0.38}
        rx={6}
        fill="none"
        stroke={chrome}
        strokeDasharray="4 3"
        strokeWidth={1.3}
      />
      <line
        x1={x + width * 0.34}
        y1={y + height * 0.52 + height * 0.08}
        x2={x + width * 0.34 + width * 0.46}
        y2={y + height * 0.52 + height * 0.08}
        stroke={chrome}
        strokeWidth={1.4}
      />
      <circle cx={showerX} cy={showerY} r={showerR} fill="none" stroke={chrome} strokeWidth={1.3} />
      <circle cx={showerX} cy={showerY} r={showerR * 0.35} fill={chrome} />
      <path
        d={`M${showerX - showerR * 0.6},${showerY} q${showerR * 0.6},${showerR * 0.4} ${showerR * 1.2},0`}
        fill="none"
        stroke={chrome}
        strokeWidth={1}
        opacity={0.7}
      />
    </g>
  )
}

/* ---------------- Furniture: utility ---------------- */
function UtilityFurniture({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const edge = '#4b3a2b'
  const cabinet = '#b59876'
  const counter = '#d7c6a4'
  const counterY = y + height * 0.18
  const ms = Math.min(width, height) * 0.3
  const mx = x + width * 0.18
  const my = y + height * 0.42
  return (
    <g>
      <rect
        x={x + width * 0.08}
        y={counterY + height * 0.12}
        width={width * 0.78}
        height={height * 0.22}
        fill={cabinet}
        stroke={edge}
        strokeWidth={1.2}
      />
      <line
        x1={x + width * 0.08 + width * 0.39}
        y1={counterY + height * 0.12}
        x2={x + width * 0.08 + width * 0.39}
        y2={counterY + height * 0.12 + height * 0.22}
        stroke="#7f6343"
        strokeWidth={1}
      />
      <line
        x1={x + width * 0.08}
        y1={counterY + height * 0.1}
        x2={x + width * 0.86}
        y2={counterY + height * 0.1}
        stroke={counter}
        strokeWidth={Math.max(2, Math.min(width, height) * 0.035)}
        strokeLinecap="round"
      />
      <rect
        x={mx}
        y={my}
        width={ms}
        height={ms}
        rx={5}
        fill="#e8eae7"
        stroke={edge}
        strokeWidth={1.2}
      />
      <circle
        cx={mx + ms / 2}
        cy={my + ms / 2}
        r={ms * 0.3}
        fill="none"
        stroke="#5f8594"
        strokeWidth={2}
      />
      <circle cx={mx + ms / 2} cy={my + ms / 2} r={ms * 0.08} fill="#5f8594" />
    </g>
  )
}


/** Top-down furniture from the same layout engine as the 3D twin (door-aware, so it matches). */
function ProjectedFurniture({ shapes, scale, originX, originY }: { shapes: PlanShape[]; scale: number; originX: number; originY: number }) {
  const sx = (s: PlanShape) => originX + (s.cx - s.w / 2) * scale
  const sy = (s: PlanShape) => originY + (s.cz - s.d / 2) * scale
  return (
    <g>
      {/* soft shadows first, so tall pieces look raised */}
      {shapes.filter((s) => s.top > 1 && s.alpha === 1).map((s, i) =>
        s.kind === 'circle'
          ? <circle key={`sh${i}`} cx={originX + s.cx * scale + 1.8} cy={originY + s.cz * scale + 2.2} r={Math.max(0.6, s.r * scale)} fill="rgba(60,40,20,0.18)" />
          : <rect key={`sh${i}`} x={sx(s) + 1.8} y={sy(s) + 2.2} width={Math.max(0.6, s.w * scale)} height={Math.max(0.6, s.d * scale)} rx={2} fill="rgba(60,40,20,0.18)" />)}
      {shapes.map((s, i) => {
        const raised = s.top > 0.2
        const common = {
          fill: s.color,
          fillOpacity: s.alpha,
          stroke: raised ? 'rgba(45,30,16,0.6)' : 'none',
          strokeWidth: 0.7,
        }
        if (s.kind === 'circle') {
          const rr = Math.max(0.6, s.r * scale)
          return (
            <g key={i}>
              <circle cx={originX + s.cx * scale} cy={originY + s.cz * scale} r={rr} {...common} />
              {raised && rr > 4 && <circle cx={originX + s.cx * scale - rr * 0.22} cy={originY + s.cz * scale - rr * 0.22} r={rr * 0.45} fill="#fff" fillOpacity={0.16} />}
            </g>
          )
        }
        const w = Math.max(0.6, s.w * scale)
        const h = Math.max(0.6, s.d * scale)
        return (
          <g key={i}>
            <rect x={sx(s)} y={sy(s)} width={w} height={h} rx={s.top > 1 ? 1.6 : 0} {...common} />
            {raised && s.alpha === 1 && w > 9 && h > 9 && (
              <rect x={sx(s) + 1.4} y={sy(s) + 1.4} width={w - 2.8} height={h - 2.8} rx={1.2} fill="#fff" fillOpacity={0.1 + Math.min(0.12, s.top * 0.02)} />
            )}
          </g>
        )
      })}
    </g>
  )
}

function FurnitureByRoom({
  roomType,
  x,
  y,
  width,
  height,
}: {
  roomType: string
  x: number
  y: number
  width: number
  height: number
}) {
  if (roomType === 'parking' || roomType === 'bike_parking') {
    // top view of the vehicle, centred in the porch and facing along its depth
    const cw = Math.min(width * 0.62, height * 0.34), cl = Math.min(height * 0.72, cw * 2.3)
    const cx = x + width / 2 - cw / 2, cy = y + height / 2 - cl / 2 - 6
    if (roomType === 'bike_parking') {
      return (
        <g stroke="#4a4036" strokeWidth={1.2} fill="#cfc9bd">
          <rect x={x + width / 2 - 4} y={y + height / 2 - cl / 3} width={8} height={cl * 0.66} rx={4} />
        </g>
      )
    }
    return (
      <g stroke="#4a4036" strokeWidth={1.3}>
        <rect x={cx} y={cy} width={cw} height={cl} rx={cw * 0.18} fill="#c9ced3" />
        <rect x={cx + cw * 0.12} y={cy + cl * 0.2} width={cw * 0.76} height={cl * 0.2} rx={3} fill="#eaf2f7" />
        <rect x={cx + cw * 0.12} y={cy + cl * 0.68} width={cw * 0.76} height={cl * 0.12} rx={3} fill="#eaf2f7" />
        <line x1={x + 4} y1={y + height - 3} x2={x + width - 4} y2={y + height - 3} strokeDasharray="6 4" stroke="#7a6a58" />
      </g>
    )
  }

  switch (roomType) {
    case 'living_room':
      return <LivingFurniture x={x} y={y} width={width} height={height} />
    case 'master_bedroom':
    case 'bedroom':
    case 'guest_bedroom':
      return <BedroomFurniture x={x} y={y} width={width} height={height} />
    case 'dining':
      return <DiningFurniture x={x} y={y} width={width} height={height} />
    case 'kitchen':
      return <KitchenFurniture x={x} y={y} width={width} height={height} />
    case 'toilet':
    case 'bathroom':
      return <BathroomFurniture x={x} y={y} width={width} height={height} />
    case 'utility':
      return <UtilityFurniture x={x} y={y} width={width} height={height} />
    case 'dressing': {
      // wardrobe along the long wall: doors, hanging-rail ticks and a mirror unit
      const horiz = width >= height
      const th = Math.min(Math.min(width, height) * 0.34, 14)
      const wx = horiz ? x + 3 : x + 3
      const wy = horiz ? y + 3 : y + 3
      const ww = horiz ? width - 6 : th
      const wh = horiz ? th : height - 6
      const n = Math.max(2, Math.round((horiz ? ww : wh) / 24))
      return (
        <g stroke="#4b3a2b" strokeWidth={1.1} fill="#d8c3a0" strokeLinejoin="round">
          <rect x={wx} y={wy} width={ww} height={wh} rx={1.5} />
          {Array.from({ length: n - 1 }, (_, i) => horiz
            ? <line key={i} x1={wx + ((i + 1) * ww) / n} y1={wy} x2={wx + ((i + 1) * ww) / n} y2={wy + wh} />
            : <line key={i} x1={wx} y1={wy + ((i + 1) * wh) / n} x2={wx + ww} y2={wy + ((i + 1) * wh) / n} />)}
          <line x1={wx + 3} y1={wy + wh / 2} x2={wx + ww - 3} y2={wy + wh / 2} strokeDasharray="2 3" opacity={0.6} />
        </g>
      )
    }
    default:
      return null
  }
}

/* ---------------- Doors & Windows ---------------- */
function DoorGlyphs({
  doors,
  rooms,
  scale,
  originX,
  originY,
}: {
  doors: Door[] | undefined
  rooms: Room[]
  scale: number
  originX: number
  originY: number
}) {
  if (!doors || doors.length === 0) return null
  const roomMap = new Map<string, Room>()
  for (const r of rooms) roomMap.set(r.room_type, r)
  for (const r of rooms) { const id = (r as { id?: string }).id; if (id) roomMap.set(id, r) }

  return (
    <g>
      {doors.map((d, i) => {
        const roomName = d.room ?? d.room_a
        const wall = d.wall ?? d.wall_a ?? 'top'
        if (!roomName || !wall) return null
        const room = roomMap.get(roomName)
        if (!room) return null
        const pos = Number(d.position) || 0
        const w = Number(d.width) || 3
        const seg = wallSegment(room, wall, pos, w, scale, originX, originY)
        // the same rule as the 3D twin (twinDoorsStairs.swingRoom): an arch, or a link between two open-plan spaces, has no door leaf
        const otherRoom = (d as { connects_to?: string | null }).connects_to ? roomMap.get((d as { connects_to?: string | null }).connects_to as string) : undefined
        const noLeaf = d.door_type === 'arch' || swingRoom(d.door_type === 'main' ? 'main' : 'door', d.door_type, room as unknown as RoomR, otherRoom as unknown as RoomR | undefined) === null
        if (noLeaf) {
          // open / glass / curtain link (kitchen - dining): a wide gap with a thin glass line, no door leaf
          return (
            <g key={`door-${i}`} data-testid="door" data-from={roomName} data-to={(d as { connects_to?: string | null }).connects_to ?? ''}>
              <line x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke="#fdf6e7" strokeWidth={8} strokeLinecap="butt" />
              <line x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke="#5b9fc4" strokeWidth={1.6} strokeDasharray="5 3" />
            </g>
          )
        }
        const isMain = d.door_type === 'main'
        const color = isMain ? '#8a5a2e' : '#6f5840'
        const leafW = isMain ? 2.6 : 2
        let leafX2: number, leafY2: number
        let ctrlX: number, ctrlY: number
        if (wall === 'top' || wall === 'bottom') {
          const inward = wall === 'top' ? 1 : -1
          const span = seg.x2 - seg.x1
          leafX2 = seg.x1
          leafY2 = seg.y1 + inward * span
          ctrlX = seg.x1 + span * 0.52
          ctrlY = seg.y1 + inward * span * 0.92
        } else {
          const inward = wall === 'left' ? 1 : -1
          const span = seg.y2 - seg.y1
          leafX2 = seg.x1 + inward * span
          leafY2 = seg.y1
          ctrlX = seg.x1 + inward * span * 0.92
          ctrlY = seg.y1 + span * 0.52
        }
        return (
          <g key={`door-${i}`} data-testid="door" data-from={roomName} data-to={(d as { connects_to?: string | null }).connects_to ?? ''}>
            <line
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke="#fdf6e7"
              strokeWidth={isMain ? Math.max(8, 0.8 * scale + 2) : 6}
              strokeLinecap="butt"
            />
            <line
              x1={seg.x1}
              y1={seg.y1}
              x2={leafX2}
              y2={leafY2}
              stroke={color}
              strokeWidth={leafW}
              strokeLinecap="round"
            />
            <path
              d={`M${seg.x2},${seg.y2} Q${ctrlX},${ctrlY} ${leafX2},${leafY2}`}
              fill="none"
              stroke={color}
              strokeWidth={isMain ? 1.4 : 1.2}
              strokeDasharray="2 2.5"
            />
            {isMain && (
              <line
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke="#4c3113"
                strokeWidth={1.6}
                strokeDasharray="0"
                opacity={0.35}
              />
            )}
          </g>
        )
      })}
    </g>
  )
}

function WindowGlyphs({
  windows,
  rooms,
  scale,
  originX,
  originY,
}: {
  windows: Window[] | undefined
  rooms: Room[]
  scale: number
  originX: number
  originY: number
}) {
  if (!windows || windows.length === 0) return null
  const roomMap = new Map<string, Room>()
  for (const r of rooms) roomMap.set(r.room_type, r)
  for (const r of rooms) { const id = (r as { id?: string }).id; if (id) roomMap.set(id, r) }

  return (
    <g>
      {windows.map((w, i) => {
        const room = roomMap.get(w.room)
        if (!room) return null
        const seg = wallSegment(room, w.wall, Number(w.position) || 0, Number(w.width) || 3, scale, originX, originY)
        const dx = seg.x2 - seg.x1
        const dy = seg.y2 - seg.y1
        const len = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const nx = -dy / len
        const ny = dx / len
        const frameOffsets = [-4, -1.5, 1.5, 4]
        const lines = frameOffsets.map((off, idx) => {
          const sx = seg.x1 + nx * off
          const sy = seg.y1 + ny * off
          const ex = seg.x2 + nx * off
          const ey = seg.y2 + ny * off
          const isOuter = idx === 0 || idx === frameOffsets.length - 1
          return (
            <line
              key={`w-${i}-${off}`}
              x1={sx}
              y1={sy}
              x2={ex}
              y2={ey}
              stroke={isOuter ? '#3a4a4f' : '#b6d0d6'}
              strokeWidth={isOuter ? 1.4 : 1}
              strokeLinecap="round"
            />
          )
        })
        const midOffsets = [0.33, 0.5, 0.67]
        // chajja: the sun-shade slab over this window, drawn on the outdoor side of its wall (dashed: it is above the cut plane)
        const cj = w.chajja
        let chajja: React.ReactNode = null
        if (cj) {
          const ux = dx / len, uy = dy / len
          const out = w.wall === 'top' ? { x: 0, y: -1 } : w.wall === 'bottom' ? { x: 0, y: 1 } : w.wall === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 }
          const ov = cj.overhang * scale, pr = cj.projection * scale
          const p0 = { x: seg.x1 - ux * ov, y: seg.y1 - uy * ov }, p1 = { x: seg.x2 + ux * ov, y: seg.y2 + uy * ov }
          const pts = [p0, p1, { x: p1.x + out.x * pr, y: p1.y + out.y * pr }, { x: p0.x + out.x * pr, y: p0.y + out.y * pr }]
          chajja = <polygon data-testid="chajja" data-room={w.room} data-wall={w.wall} points={pts.map((q) => `${q.x},${q.y}`).join(' ')} fill="#d9d4c8" fillOpacity={0.55} stroke="#6f6a5e" strokeWidth={0.9} strokeDasharray="3 2" />
        }
        return (
          <g key={`window-${i}`}>
            {chajja}
            <line x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke="#fdf6e7" strokeWidth={Math.max(8, 0.8 * scale + 1)} />
            {lines}
            {midOffsets.map((m, idx) => {
              const t = m
              const mx = seg.x1 + dx * t
              const my = seg.y1 + dy * t
              return (
                <circle
                  key={`wm-${i}-${idx}`}
                  cx={mx + nx * -2}
                  cy={my + ny * -2}
                  r={0.6}
                  fill="#708088"
                  opacity={0.8}
                />
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

/* ---------------- Road ---------------- */
function RoadSvg({
  plotX,
  plotY,
  plotW,
  plotH,
  roadSide,
}: {
  plotX: number
  plotY: number
  plotW: number
  plotH: number
  roadSide: RoadSide
}) {
  const size = 48
  if (roadSide === 'North') {
    return (
      <g>
        <rect x={plotX} y={plotY - size} width={plotW} height={size} fill="#d6d6d6" stroke="#888" strokeWidth={1.5} />
        <line
          x1={plotX}
          y1={plotY - size / 2}
          x2={plotX + plotW}
          y2={plotY - size / 2}
          stroke="#fafafa"
          strokeWidth={2}
          strokeDasharray="14 10"
        />
        <text
          x={plotX + plotW / 2}
          y={plotY - 15}
          textAnchor="middle"
          fontFamily="'Helvetica Neue', Arial, sans-serif"
          fontSize={15}
          fontWeight="700"
          fill="#3a3a3a"
          letterSpacing={0.6}
        >
          ROAD — NORTH
        </text>
      </g>
    )
  }
  if (roadSide === 'South') {
    return (
      <g>
        <rect x={plotX} y={plotY + plotH} width={plotW} height={size} fill="#d6d6d6" stroke="#888" strokeWidth={1.5} />
        <line
          x1={plotX}
          y1={plotY + plotH + size / 2}
          x2={plotX + plotW}
          y2={plotY + plotH + size / 2}
          stroke="#fafafa"
          strokeWidth={2}
          strokeDasharray="14 10"
        />
        <text
          x={plotX + plotW / 2}
          y={plotY + plotH + 30}
          textAnchor="middle"
          fontFamily="'Helvetica Neue', Arial, sans-serif"
          fontSize={15}
          fontWeight="700"
          fill="#3a3a3a"
          letterSpacing={0.6}
        >
          ROAD — SOUTH
        </text>
      </g>
    )
  }
  if (roadSide === 'East') {
    const tx = plotX + plotW + 32
    const ty = plotY + plotH / 2
    return (
      <g>
        <rect x={plotX + plotW} y={plotY} width={size} height={plotH} fill="#d6d6d6" stroke="#888" strokeWidth={1.5} />
        <line
          x1={plotX + plotW + size / 2}
          y1={plotY}
          x2={plotX + plotW + size / 2}
          y2={plotY + plotH}
          stroke="#fafafa"
          strokeWidth={2}
          strokeDasharray="14 10"
        />
        <text
          x={tx}
          y={ty}
          textAnchor="middle"
          fontFamily="'Helvetica Neue', Arial, sans-serif"
          fontSize={15}
          fontWeight="700"
          fill="#3a3a3a"
          letterSpacing={0.6}
          transform={`rotate(90 ${tx} ${ty})`}
        >
          ROAD — EAST
        </text>
      </g>
    )
  }
  const tx = plotX - 32
  const ty = plotY + plotH / 2
  return (
    <g>
      <rect x={plotX - size} y={plotY} width={size} height={plotH} fill="#d6d6d6" stroke="#888" strokeWidth={1.5} />
      <line
        x1={plotX - size / 2}
        y1={plotY}
        x2={plotX - size / 2}
        y2={plotY + plotH}
        stroke="#fafafa"
        strokeWidth={2}
        strokeDasharray="14 10"
      />
      <text
        x={tx}
        y={ty}
        textAnchor="middle"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontSize={15}
        fontWeight="700"
        fill="#3a3a3a"
        letterSpacing={0.6}
        transform={`rotate(-90 ${tx} ${ty})`}
      >
        ROAD — WEST
      </text>
    </g>
  )
}

/* ---------------- Open spaces (landscaped greens) ---------------- */
function OpenSpaceSvg({
  layout,
  usablePlot,
  scale,
  originX,
  originY,
}: {
  layout: Layout
  usablePlot: NonNullable<Layout['usable_plot']>
  scale: number
  originX: number
  originY: number
}) {
  const openSpaces = layout.open_spaces
  if (!openSpaces) return null
  const regions = openSpaces.regions ?? []
  if (!regions || regions.length === 0) return null

  const plotX = usablePlot.x ?? 0
  const plotY = usablePlot.y ?? 0
  const plotX2 = plotX + (usablePlot.width ?? 0)
  const plotY2 = plotY + (usablePlot.length ?? 0)

  const GREEN_ZONES = new Set(['courtyard', 'front_open_space', 'rear_open_space', 'side_open_space'])

  return (
    <g>
      {regions.map((region, i) => {
        const rx = Math.max(plotX, region.x)
        const ry = Math.max(plotY, region.y)
        const rw = Math.min(plotX2, region.x + region.width) - rx
        const rh = Math.min(plotY2, region.y + region.length) - ry
        if (rw <= 0 || rh <= 0) return null
        const sx = originX + rx * scale
        const sy = originY + ry * scale
        const sw = rw * scale
        const sh = rh * scale
        const type = region.type ?? 'open_space'
        const label = OPEN_SPACE_LABELS[type] ?? type.replace(/_/g, ' ').toUpperCase()
        const fontSize = Math.max(8, Math.min(14, Math.min(sw, sh) * 0.14))
        const dimSize = Math.max(7, Math.min(10, fontSize * 0.72))

        const isGreen = GREEN_ZONES.has(type)

        const bg = isGreen
          ? sw > 40 && sh > 40
            ? `url(#fp-grass)`
            : '#d9e8ca'
          : type === 'circulation'
            ? '#efe6d4'
            : type === 'future_expansion'
              ? '#f3ece0'
              : '#ece8de'

        const stroke = isGreen ? '#8aa977' : type === 'circulation' ? '#c9b999' : '#c4b497'

        return (
          <g key={`os-${i}`}>
            <rect
              x={sx}
              y={sy}
              width={sw}
              height={sh}
              fill={bg}
              fillOpacity={0.85}
              stroke={stroke}
              strokeWidth={1.1}
              strokeDasharray="4 4"
            />
            {isGreen && sw >= 55 && sh >= 40 && (
              <g opacity={0.9}>
                {Array.from({ length: Math.max(2, Math.min(6, Math.floor((sw * sh) / 2600))) }).map((_, idx) => {
                  const jitterX = 0.22 + ((idx * 0.23) % 0.62)
                  const jitterY = 0.25 + (((idx + 1) * 0.31) % 0.62)
                  const cx = sx + sw * jitterX
                  const cy = sy + sh * jitterY
                  const cr = Math.min(sw, sh) * 0.05 + (idx % 3) * 0.6
                  return (
                    <g key={`os-plant-${i}-${idx}`}>
                      <circle cx={cx} cy={cy + cr * 0.35} r={cr * 0.35} fill="#8a6a47" stroke="#5f4627" strokeWidth={0.8} />
                      <circle cx={cx} cy={cy} r={cr * 1.2} fill="#83a86a" stroke="#547a3e" strokeWidth={0.9} />
                      <path
                        d={`M${cx - cr * 0.5},${cy - cr * 0.2} q${cr * 0.2},-${cr * 0.9} ${cr},0 q${cr * 0.8},${cr * 0.9} 0,0 q-${cr * 0.2},${cr * 0.5} -${cr},0 q-${cr * 0.8},-${cr * 0.5} 0,0 z`}
                        fill="#6f9754"
                        opacity={0.75}
                      />
                    </g>
                  )
                })}
              </g>
            )}
            <text
              x={sx + sw / 2}
              y={sy + sh / 2 - (isGreen ? Math.min(fontSize, 12) * 0.6 : 0)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="'Helvetica Neue', Arial, sans-serif"
              fontSize={fontSize}
              fontWeight="700"
              fill={isGreen ? '#445e34' : '#5a4a35'}
              letterSpacing={0.4}
            >
              {label}
            </text>
            {sw >= 48 && sh >= 32 && (
              <text
                x={sx + sw / 2}
                y={sy + sh / 2 + fontSize + 3}
                textAnchor="middle"
                fontFamily="'Helvetica Neue', Arial, sans-serif"
                fontSize={dimSize}
                fill={isGreen ? '#5a7048' : '#6f5e47'}
              >
                {rw.toFixed(0)} × {rh.toFixed(0)} ft
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/* ---------------- Features (balcony, garden, terrace) ---------------- */
function FeatureSvg({
  layout,
  scale,
  originX,
  originY,
}: {
  layout: Layout
  scale: number
  originX: number
  originY: number
}) {
  const balcony = layout.balcony
  const garden = layout.garden
  const terrace = layout.terrace

  return (
    <g>
      {balcony && balcony.exists !== false && (
        <g>
          <rect
            x={originX + balcony.x * scale}
            y={originY + balcony.y * scale}
            width={balcony.width * scale}
            height={balcony.length * scale}
            fill="url(#fp-grass)"
            fillOpacity={0.7}
            stroke="#6e8f58"
            strokeWidth={1.8}
            strokeDasharray="5 3"
          />
          <line
            x1={originX + balcony.x * scale}
            y1={originY + balcony.y * scale + balcony.length * scale}
            x2={originX + balcony.x * scale + balcony.width * scale}
            y2={originY + balcony.y * scale + balcony.length * scale}
            stroke="#6b4e34"
            strokeWidth={3}
          />
          <line
            x1={originX + balcony.x * scale + balcony.width * scale * 0.45}
            y1={originY + balcony.y * scale + balcony.length * scale}
            x2={originX + balcony.x * scale + balcony.width * scale * 0.45}
            y2={originY + balcony.y * scale + balcony.length * scale * 0.6}
            stroke="#6b4e34"
            strokeWidth={3}
          />
          <text
            x={originX + balcony.x * scale + (balcony.width * scale) / 2}
            y={originY + balcony.y * scale + (balcony.length * scale) / 2}
            textAnchor="middle"
            fontFamily="'Helvetica Neue', Arial, sans-serif"
            fontSize={11}
            fontWeight="700"
            fill="#3c552b"
            letterSpacing={0.4}
          >
            BALCONY
          </text>
        </g>
      )}
      {garden && garden.exists !== false && (
        <g>
          <rect
            x={originX + garden.x * scale}
            y={originY + garden.y * scale}
            width={garden.width * scale}
            height={garden.length * scale}
            fill="url(#fp-grass)"
            fillOpacity={0.85}
            stroke="#5a7e47"
            strokeWidth={2}
          />
          <text
            x={originX + garden.x * scale + (garden.width * scale) / 2}
            y={originY + garden.y * scale + (garden.length * scale) / 2}
            textAnchor="middle"
            fontFamily="'Helvetica Neue', Arial, sans-serif"
            fontSize={11}
            fontWeight="700"
            fill="#3c552b"
            letterSpacing={0.4}
          >
            GARDEN
          </text>
          {[
            [0.22, 0.28],
            [0.55, 0.72],
            [0.78, 0.28],
            [0.38, 0.62],
            [0.7, 0.5],
          ].map(([ox, oy], idx) => {
            const w = garden.width * scale
            const h = garden.length * scale
            const cx = originX + garden.x * scale + w * ox
            const cy = originY + garden.y * scale + h * oy
            const cr = Math.min(w, h) * 0.06
            return (
              <g key={`g-tree-${idx}`}>
                <circle cx={cx} cy={cy + cr * 0.6} r={cr * 0.35} fill="#8a6a47" stroke="#5c4326" strokeWidth={1} />
                <circle cx={cx} cy={cy} r={cr * 1.5} fill="#7aa360" stroke="#4d6f37" strokeWidth={1.1} />
                <path
                  d={`M${cx - cr * 0.6},${cy + cr * 0.2} q${cr * 0.2},-${cr * 1.3} ${cr * 1.2},0 q${cr},${cr * 1.2} 0,0 q-${cr * 0.3},${cr * 0.5} -${cr * 1.2},0 q-${cr * 0.9},-${cr * 0.6} 0,0 z`}
                  fill="#668a4d"
                  opacity={0.75}
                />
              </g>
            )
          })}
        </g>
      )}
      {terrace && terrace.exists !== false && (() => {
        const terrXPx = originX + terrace.x * scale
        const terrYPx = originY + terrace.y * scale
        const terrWPx = terrace.width * scale
        const terrHPx = terrace.length * scale
        const solar = terrace.solar_panels
        const terGarden = terrace.garden
        return (
          <g>
            <rect
              x={terrXPx}
              y={terrYPx}
              width={terrWPx}
              height={terrHPx}
              fill="url(#fp-wood)"
              fillOpacity={0.82}
              stroke="#6a543d"
              strokeWidth={2}
              strokeDasharray="5 3"
            />
            <text
              x={terrXPx + terrWPx / 2}
              y={terrYPx + terrHPx / 2}
              textAnchor="middle"
              fontFamily="'Helvetica Neue', Arial, sans-serif"
              fontSize={11}
              fontWeight="700"
              fill="#443221"
              letterSpacing={0.4}
            >
              TERRACE
            </text>
            {solar && (() => {
              const sx = originX + solar.x * scale
              const sy = originY + solar.y * scale
              const sw = solar.width * scale
              const sh = solar.length * scale
              return (
                <g>
                  <rect
                    x={sx}
                    y={sy}
                    width={sw}
                    height={sh}
                    fill="#4a6f8c"
                    stroke="#21384c"
                    strokeWidth={2}
                  />
                  {[1, 2, 3].map((idx) => (
                    <line
                      key={idx}
                      x1={sx + (sw * idx) / 4}
                      y1={sy}
                      x2={sx + (sw * idx) / 4}
                      y2={sy + sh}
                      stroke="#b7d1e0"
                      strokeWidth={1.1}
                    />
                  ))}
                  <line
                    x1={sx}
                    y1={sy + sh / 2}
                    x2={sx + sw}
                    y2={sy + sh / 2}
                    stroke="#b7d1e0"
                    strokeWidth={1.1}
                  />
                  <text
                    x={sx + sw / 2}
                    y={sy + sh / 2 + 4}
                    textAnchor="middle"
                    fontFamily="'Helvetica Neue', Arial, sans-serif"
                    fontSize={10}
                    fontWeight="700"
                    fill="#eef3f7"
                  >
                    SOLAR
                  </text>
                </g>
              )
            })()}
            {terGarden && (() => {
              const gx = originX + terGarden.x * scale
              const gy = originY + terGarden.y * scale
              const gw = terGarden.width * scale
              const gh = terGarden.length * scale
              return (
                <g>
                  <rect
                    x={gx}
                    y={gy}
                    width={gw}
                    height={gh}
                    fill="url(#fp-grass)"
                    stroke="#5a7e47"
                    strokeWidth={1.8}
                  />
                  <text
                    x={gx + gw / 2}
                    y={gy + gh / 2}
                    textAnchor="middle"
                    fontFamily="'Helvetica Neue', Arial, sans-serif"
                    fontSize={10}
                    fontWeight="700"
                    fill="#3c552b"
                  >
                    ROOFTOP GARDEN
                  </text>
                </g>
              )
            })()}
          </g>
        )
      })()}
    </g>
  )
}

/* ---------------- Parking ---------------- */
function ParkingSvg({
  usablePlot,
  scale,
  originX,
  originY,
}: {
  usablePlot: NonNullable<Layout['usable_plot']>
  scale: number
  originX: number
  originY: number
}) {
  const regions = usablePlot.reserved_regions
  if (!regions || regions.length === 0) return null
  return (
    <g>
      {regions.map((p, i) => {
        const sx = originX + p.x * scale
        const sy = originY + p.y * scale
        const sw = p.width * scale
        const sh = p.length * scale
        return (
          <g key={`park-${i}`}>
            <rect
              x={sx}
              y={sy}
              width={sw}
              height={sh}
              fill="#cfc8bc"
              stroke="#8f8375"
              strokeWidth={1.4}
            />
            <line
              x1={sx}
              y1={sy + sh / 2}
              x2={sx + sw}
              y2={sy + sh / 2}
              stroke="#ecebe8"
              strokeWidth={1.8}
              strokeDasharray="10 8"
            />
            {(p.bays ?? []).map((b) => (
              <g key={`bay-${b.index}`} data-testid="parking-bay">
                <rect x={originX + b.x * scale} y={originY + b.y * scale} width={b.width * scale} height={b.length * scale}
                  fill="none" stroke="#f4f1ea" strokeWidth={2} strokeDasharray="7 5" />
                <text x={originX + (b.x + b.width / 2) * scale} y={originY + (b.y + b.length) * scale - 5} textAnchor="middle"
                  fontSize={9} fontWeight={700} fill="#5a4d3e">{`CAR BAY ${b.width % 1 ? b.width.toFixed(1) : b.width} × ${b.length % 1 ? b.length.toFixed(1) : b.length} ft`}</text>
              </g>
            ))}
            {sw >= 80 && sh >= 140 && (() => {
              const bay0 = p.bays?.[0]
              const bx0 = bay0 ? originX + bay0.x * scale : sx
              const by0 = bay0 ? originY + bay0.y * scale : sy
              const bwr = bay0 ? bay0.width * scale : sw
              const bhr = bay0 ? bay0.length * scale : sh
              const turned = Boolean(bay0) && bwr > bhr          // road on the east / west: the car lies along x
              const bw0 = turned ? bhr : bwr
              const bh0 = turned ? bwr : bhr
              const carW = Math.min(bw0 * 0.58, 70)
              const carH = Math.min(bh0 * 0.74, 130)
              const mx = bx0 + bwr / 2, my = by0 + bhr / 2
              const cx = mx - carW / 2
              const cy = my - carH / 2
              return (
                <g transform={turned ? `rotate(90 ${mx} ${my})` : undefined}>
                  <rect
                    x={cx}
                    y={cy}
                    width={carW}
                    height={carH}
                    rx={12}
                    fill="#b8a289"
                    stroke="#6b4f33"
                    strokeWidth={1.6}
                  />
                  <rect
                    x={cx + carW * 0.16}
                    y={cy + carH * 0.16}
                    width={carW * 0.68}
                    height={carH * 0.26}
                    rx={5}
                    fill="#dde8ea"
                    stroke="#6a8088"
                    strokeWidth={1.2}
                  />
                  <circle cx={cx + carW * 0.2} cy={cy + carH} r={3.5} fill="#3a2e22" />
                  <circle cx={cx + carW * 0.8} cy={cy + carH} r={3.5} fill="#3a2e22" />
                  <circle cx={cx + carW * 0.2} cy={cy} r={3.5} fill="#3a2e22" />
                  <circle cx={cx + carW * 0.8} cy={cy} r={3.5} fill="#3a2e22" />
                </g>
              )
            })()}
          </g>
        )
      })}
    </g>
  )
}

/* ---------------- Main component ---------------- */
export default function FloorPlanSvg({
  layout,
  plot,
  usablePlot,
  roadSide = 'North',
  style,
  scale = 12,
  title = 'AI GENERATED FLOOR PLAN',
  stair,
  floorIndex = 0,
}: FloorPlanSvgProps) {
  const rooms = layout.rooms ?? []
  const hasFeatures = Boolean(layout.balcony || layout.garden || layout.terrace)
  if (rooms.length === 0 && !hasFeatures) {
    return (
      <div className="floor-svg-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>
          No rooms allocated to this floor.
        </div>
      </div>
    )
  }

  // furniture: one layout for the whole floor, then split per room
  const fgp = new THREE.Group()
  furnishFloor(rooms as unknown as RoomT[], layout.openings, 0, fgp, new THREE.Group())
  const allShapes = projectTopDown(fgp)

  const margin = 110
  const plotW = plot.width
  const plotH = plot.length
  const svgW = plotW * scale + margin * 2
  const svgH = plotH * scale + margin * 2
  const originX = margin
  const originY = margin

  const plotXPx = originX
  const plotYPx = originY
  const plotWPx = plotW * scale
  const plotHPx = plotH * scale

  const usable = usablePlot ?? { x: 0, y: 0, width: plotW, length: plotH }
  const usableXPx = originX + (usable.x ?? 0) * scale
  const usableYPx = originY + (usable.y ?? 0) * scale
  const usableWPx = (usable.width ?? plotW) * scale
  const usableHPx = (usable.length ?? plotH) * scale

  return (
    <div className="floor-svg-container" style={style}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${svgW} ${svgH}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        <defs>
          <filter id="fp-room-shadow" x="-8%" y="-8%" width="116%" height="116%">
            <feDropShadow dx="2.2" dy="2.6" stdDeviation="2.3" floodColor="#5c4a38" floodOpacity="0.28" />
          </filter>
          <filter id="fp-card-shadow" x="-5%" y="-5%" width="110%" height="110%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#000" floodOpacity="0.08" />
          </filter>
          <pattern id="fp-wood" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(0)">
            <rect width="16" height="16" fill="#e9d8b8" />
            <path d="M0 3 H16 M0 8 H16 M0 13 H16" stroke="#c9a97b" strokeWidth="0.55" opacity="0.85" />
            <path d="M2 1 Q6 2 10 1 T18 1" fill="none" stroke="#b69063" strokeWidth="0.5" opacity="0.55" />
            <path d="M-2 6 Q6 7 14 6" fill="none" stroke="#b69063" strokeWidth="0.5" opacity="0.45" />
            <path d="M-1 11 Q6 12 15 11" fill="none" stroke="#b69063" strokeWidth="0.5" opacity="0.45" />
          </pattern>
          <pattern id="fp-tile" width="16" height="16" patternUnits="userSpaceOnUse">
            <rect width="16" height="16" fill="#f3ead3" />
            <path d="M0 0H16M0 0V16" stroke="#d7c59c" strokeWidth="0.7" />
            <rect x="2" y="2" width="12" height="12" fill="none" stroke="#cbb184" strokeWidth="0.5" opacity="0.6" />
          </pattern>
          <pattern id="fp-marble" width="16" height="16" patternUnits="userSpaceOnUse">
            <rect width="16" height="16" fill="#eef2ee" />
            <path d="M0 4 Q4 2 8 5 T16 4" fill="none" stroke="#c5d2cf" strokeWidth="0.7" opacity="0.85" />
            <path d="M0 11 Q6 9 10 12 T16 11" fill="none" stroke="#c5d2cf" strokeWidth="0.6" opacity="0.65" />
          </pattern>
          <pattern id="fp-roof" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="#ece9e1" />
            <line x1="0" y1="0" x2="0" y2="10" stroke="#c9c4b8" strokeWidth="1.2" />
          </pattern>
          <pattern id="fp-grass" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="#dce9c9" />
            <path d="M0 10 Q1.5 6 3 10 M6 11 Q7.5 7 9 11 M10 9.5 Q11 7 12 9.5" stroke="#8eb36f" strokeWidth="0.8" fill="none" opacity="0.8" />
            <circle cx="2.5" cy="3" r="0.8" fill="#92b874" opacity="0.8" />
            <circle cx="9.5" cy="5.5" r="0.8" fill="#92b874" opacity="0.8" />
          </pattern>
          <linearGradient id="fp-bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fffdf7" />
            <stop offset="100%" stopColor="#f5ecdc" />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={svgW} height={svgH} fill="url(#fp-bg)" />
        <rect
          x={margin - 20}
          y={margin - 20}
          width={svgW - (margin - 20) * 2}
          height={svgH - (margin - 20) * 2}
          rx={10}
          fill="#fff9ed"
          stroke="#c9b58e"
          strokeWidth="1.4"
          opacity="0.92"
          filter="url(#fp-card-shadow)"
        />

        <RoadSvg plotX={plotXPx} plotY={plotYPx} plotW={plotWPx} plotH={plotHPx} roadSide={roadSide} />

        <rect
          x={plotXPx}
          y={plotYPx}
          width={plotWPx}
          height={plotHPx}
          fill="#f8efdc"
          stroke="#2d2318"
          strokeWidth={4.5}
          rx={2}
        />
        <rect
          x={usableXPx}
          y={usableYPx}
          width={usableWPx}
          height={usableHPx}
          fill="none"
          stroke="#6f5940"
          strokeWidth={2.2}
          strokeDasharray="9 6"
        />

        <OpenSpaceSvg layout={layout} usablePlot={usable} scale={scale} originX={originX} originY={originY} />
        <FeatureSvg layout={layout} scale={scale} originX={originX} originY={originY} />
        <ParkingSvg usablePlot={usable} scale={scale} originX={originX} originY={originY} />
        {(layout.roof_areas ?? []).map((ra) => (
          <g key={ra.id} data-testid="roof-area">
            <rect x={originX + ra.x * scale} y={originY + ra.y * scale} width={ra.width * scale} height={ra.length * scale} fill="url(#fp-roof)" stroke="#8a8478" strokeWidth={1.2} strokeDasharray="6 4" />
            <text x={originX + (ra.x + ra.width / 2) * scale} y={originY + (ra.y + ra.length / 2) * scale} textAnchor="middle" fontSize={11} fill="#6b665b" fontFamily="'Helvetica Neue', Arial, sans-serif">FLAT ROOF (NOT ACCESSIBLE)</text>
          </g>
        ))}

        {rooms.map((room, idx) => {
          const x = originX + room.x * scale
          const y = originY + room.y * scale
          const width = room.width * scale
          const height = room.length * scale
          const label = ((room as { name?: string }).name ?? '').toUpperCase() || labelForRoom(room.room_type)
          const styleCfg = getPatternId(room.room_type)
          const fillValue = styleCfg.patternId ? `url(#${styleCfg.patternId})` : styleCfg.fill
          const clipId = `fp-clip-${room.room_type}-${idx}`
          const fontSize = Math.max(10, Math.min(width, height) * 0.058)
          const dimSize = Math.max(8, fontSize * 0.78)
          const sq = Math.round(Number(room.area || room.width * room.length))
          let dimText = `${room.width} × ${room.length} ft · ${sq} sqft`
          if (dimText.length * dimSize * 0.56 + 10 > width - 4) dimText = `${room.width} × ${room.length} ft`
          if (dimText.length * dimSize * 0.56 + 10 > width - 4) dimText = `${sq} sqft`
          const dimPill = dimText.length * dimSize * 0.56 + 10
          const labelY = room.room_type === 'staircase' ? y + height - 10 : y + height - 12

          return (
            <g key={`room-${room.room_type}-${idx}`}>
              <defs>
                <clipPath id={clipId}>
                  <rect x={x} y={y} width={width} height={height} />
                </clipPath>
              </defs>
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={fillValue}
                stroke="#3a2d20"
                strokeWidth={3.2}
                filter="url(#fp-room-shadow)"
              />
              <rect
                x={x + 1.2}
                y={y + 1.2}
                width={width - 2.4}
                height={height - 2.4}
                fill="none"
                stroke="#fbf3df"
                strokeWidth={0.8}
                opacity={0.55}
              />
              {room.room_type === 'staircase' ? (
                (() => {
                  const rs = room as unknown as { id?: string; stair?: StairDrawn | null }
                  const base = stairEntryHigh(
                    { id: rs.id, room_type: 'staircase', x: room.x, y: room.y, x2: room.x + room.width, y2: room.y + room.length, stair: rs.stair },
                    (layout.openings?.doors ?? []) as never,
                  )
                  const sp0 = stairSpec(stair as never, Number((stair as { floor_height?: number } | undefined)?.floor_height) || 10)
                  const v = stairVariant(sp0, base, floorIndex)
                  return (
                    <StaircaseSvg
                      room={{ x: room.x, y: room.y, x2: room.x + room.width, y2: room.y + room.length }}
                      scale={scale}
                      originX={originX}
                      originY={originY}
                      entryHigh={v.entryHigh}
                      upper={floorIndex > 0}
                      spec={v.spec}
                    />
                  )
                })()
              ) : (
                <g clipPath={`url(#${clipId})`}>
                  {(() => {
                    const mine = allShapes.filter((s) => s.cx > room.x && s.cx < room.x + room.width && s.cz > room.y && s.cz < room.y + room.length)
                    return mine.length ? (
                      <ProjectedFurniture shapes={mine} scale={scale} originX={originX} originY={originY} />
                    ) : (
                      <FurnitureByRoom roomType={room.room_type} x={x} y={y} width={width} height={height} />
                    )
                  })()}
                </g>
              )}
              {room.room_type !== 'passage' && (
              <>
              <rect
                x={x + width / 2 - (fontSize * (label.length / 1.6)) / 2 - 6}
                y={labelY - fontSize + 2}
                width={fontSize * (label.length / 1.6) + 12}
                height={fontSize + 4}
                rx={4}
                fill="#fbf3df"
                opacity={0.92}
              />
              <text
                x={x + width / 2}
                y={labelY}
                textAnchor="middle"
                fontFamily="'Helvetica Neue', Arial, sans-serif"
                fontSize={fontSize}
                fontWeight="800"
                fill="#1a1107"
                letterSpacing={0.5}
              >
                {label}
              </text>
              <rect
                x={x + width / 2 - dimPill / 2}
                y={y + 7}
                width={dimPill}
                height={dimSize + 5}
                rx={4}
                fill="#fbf3df"
                opacity={0.93}
              />
              <text
                x={x + width / 2}
                y={y + 7 + dimSize + 1}
                textAnchor="middle"
                fontFamily="'Helvetica Neue', Arial, sans-serif"
                fontSize={dimSize}
                fontWeight="700"
                fill="#3a2d20"
              >
                {dimText}
              </text>
              </>
              )}
            </g>
          )
        })}

        {/* walls: 230 mm exterior, 120 mm interior, drawn over the room outlines */}
        <g>
          {wallBands(rooms as never).map((w, i) => {
            const half = (w.t * scale) / 2
            const c = (w.axis === 'h' ? originY : originX) + w.c * scale
            const a = (w.axis === 'h' ? originX : originY) + w.a * scale - half
            const b = (w.axis === 'h' ? originX : originY) + w.b * scale + half
            const fill = w.kind === 'ext' ? '#241a12' : w.kind === 'int' ? '#3f3226' : '#8a7a68'
            return w.axis === 'h'
              ? <rect key={`wb${i}`} x={a} y={c - half} width={b - a} height={half * 2} fill={fill} />
              : <rect key={`wb${i}`} x={c - half} y={a} width={half * 2} height={b - a} fill={fill} />
          })}
        </g>

        <DoorGlyphs
          doors={layout.openings?.doors}
          rooms={rooms}
          scale={scale}
          originX={originX}
          originY={originY}
        />
        {((layout as unknown as { ducts?: Array<{ x: number; y: number; width: number; length: number }> }).ducts ?? []).map((d, i) => (
          <g key={`duct-${i}`}>
            <rect x={originX + d.x * scale} y={originY + d.y * scale} width={d.width * scale} height={d.length * scale}
              fill="#d8d2c4" stroke="#6b5d4a" strokeWidth={1} />
            <line x1={originX + d.x * scale} y1={originY + d.y * scale} x2={originX + (d.x + d.width) * scale} y2={originY + (d.y + d.length) * scale} stroke="#6b5d4a" strokeWidth={0.8} />
            <line x1={originX + (d.x + d.width) * scale} y1={originY + d.y * scale} x2={originX + d.x * scale} y2={originY + (d.y + d.length) * scale} stroke="#6b5d4a" strokeWidth={0.8} />
          </g>
        ))}
        <WindowGlyphs
          windows={layout.openings?.windows}
          rooms={rooms}
          scale={scale}
          originX={originX}
          originY={originY}
        />

        <g>
          <circle cx={svgW - 70} cy={72} r={26} fill="#ffffff" stroke="#2b2016" strokeWidth={1.2} opacity={0.9} />
          <text
            x={svgW - 70}
            y={62}
            textAnchor="middle"
            fontFamily="'Helvetica Neue', Arial, sans-serif"
            fontSize={18}
            fontWeight="800"
            fill="#1a1107"
            letterSpacing={1.2}
          >
            N
          </text>
          <line
            x1={svgW - 70}
            y1={72 + 30}
            x2={svgW - 70}
            y2={72 - 14}
            stroke="#1a1107"
            strokeWidth={3.2}
            strokeLinecap="round"
          />
          <polygon
            points={`${svgW - 70},${72 - 14} ${svgW - 79},${72 + 10} ${svgW - 61},${72 + 10}`}
            fill="#1a1107"
          />
        </g>

        <rect
          x={svgW / 2 - 180}
          y={22}
          width={360}
          height={36}
          rx={8}
          fill="#fff4d9"
          stroke="#a9895b"
          strokeWidth="1.4"
          opacity={0.95}
        />
        <text
          x={svgW / 2}
          y={48}
          textAnchor="middle"
          fontFamily="'Helvetica Neue', Arial, sans-serif"
          fontSize={22}
          fontWeight="800"
          fill="#3a2816"
          letterSpacing={1.4}
        >
          {title}
        </text>
      </svg>
    </div>
  )
}
