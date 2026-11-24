import { useMemo, useState } from 'react'
import type { Draft, DraftDoor, DraftRoom, DraftWindow, Wall } from '../../lib/planImport'

export const ROOM_TYPES = ['living_room', 'dining', 'kitchen', 'utility', 'master_bedroom', 'bedroom', 'guest_bedroom', 'bathroom', 'toilet', 'puja_room', 'study', 'family_lounge', 'staircase', 'passage', 'balcony', 'parking', 'courtyard'] as const
const WALLS: Wall[] = ['top', 'bottom', 'left', 'right']
const DOOR_TYPES = ['main', 'internal', 'bedroom', 'bathroom', 'utility', 'puja_room', 'arch']
const human = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const FILL: Record<string, string> = { detected: '#d9b99a', inferred: '#e8d9a8', manual: '#bcd0c4', assumed: '#e8d9a8' }

function wallSeg(r: DraftRoom, wall: Wall, pos: number, width: number): [number, number, number, number] {
  const x2 = r.x + r.width, y2 = r.y + r.length
  if (wall === 'top') return [r.x + pos, r.y, r.x + pos + width, r.y]
  if (wall === 'bottom') return [r.x + pos, y2, r.x + pos + width, y2]
  if (wall === 'left') return [r.x, r.y + pos, r.x, r.y + pos + width]
  return [x2, r.y + pos, x2, r.y + pos + width]
}
const srcBadge = (s: string) => <span className={`badge ${s === 'detected' ? 'badge-ok' : s === 'manual' ? '' : 'badge-warn'}`}>{s}</span>

interface Props {
  draft: Draft
  onChange: (d: Draft) => void
  imageUrl: string | null
  imageSize: { w: number; h: number } | null
}

export default function ReviewEditor({ draft, onChange, imageUrl, imageSize }: Props) {
  const [sel, setSel] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const setRoom = (i: number, p: Partial<DraftRoom>) => set({ rooms: draft.rooms.map((r, k) => (k === i ? { ...r, ...p } : r)) })
  const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v))

  const k = draft.scale.ft_per_px
  const og = draft.scale.origin_px
  const view = useMemo(() => {
    if (k && og && imageSize) return { x: -og.x * k, y: -og.y * k, w: imageSize.w * k, h: imageSize.h * k, img: true }
    const xs = draft.rooms.flatMap((r) => [r.x, r.x + r.width]), ys = draft.rooms.flatMap((r) => [r.y, r.y + r.length])
    const x0 = Math.min(0, ...xs) - 3, y0 = Math.min(0, ...ys) - 3
    return { x: x0, y: y0, w: Math.max(30, ...xs) - x0 + 3, h: Math.max(24, ...ys) - y0 + 3, img: false }
  }, [draft.rooms, k, og, imageSize])
  const sw = Math.max(view.w, view.h) / 300
  const byId = new Map(draft.rooms.map((r) => [r.id, r]))

  const addRoom = () => {
    const right = draft.rooms.length ? Math.max(...draft.rooms.map((r) => r.x + r.width)) : 0
    const id = `manual_${Date.now().toString(36)}`
    set({ rooms: [...draft.rooms, { id, name: 'New room', room_type: 'bedroom', x: right, y: 0, width: 10, length: 10, source: 'manual', confidence: 'medium', note: null }] })
    setSel(id)
  }
  const delRoom = (id: string) => set({ rooms: draft.rooms.filter((r) => r.id !== id), doors: draft.doors.filter((d) => d.room !== id), windows: draft.windows.filter((w) => w.room !== id) })
  const addDoor = () => { if (!draft.rooms.length) return; set({ doors: [...draft.doors, { id: `door_${Date.now().toString(36)}`, room: draft.rooms[0].id, wall: 'top', position: 1, width: 3, door_type: 'internal', connects_to: null, source: 'manual', confidence: 'medium', width_assumed: false }] }) }
  const addWindow = () => { if (!draft.rooms.length) return; set({ windows: [...draft.windows, { id: `window_${Date.now().toString(36)}`, room: draft.rooms[0].id, wall: 'top', position: 1, width: 3, source: 'manual', confidence: 'medium', width_assumed: false }] }) }
  const setDoor = (i: number, p: Partial<DraftDoor>) => set({ doors: draft.doors.map((d, j) => (j === i ? { ...d, ...p } : d)) })
  const setWin = (i: number, p: Partial<DraftWindow>) => set({ windows: draft.windows.map((d, j) => (j === i ? { ...d, ...p } : d)) })
  const roomSel = (value: string, onCh: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => onCh(e.target.value)} aria-label={label}>{draft.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
  )

  return (
    <div className="stack" style={{ gap: 18 }} data-testid="review-editor">
      <div className="pcard" style={{ overflow: 'hidden' }}>
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} role="img" aria-label="Editable plan preview" style={{ width: '100%', maxHeight: 560, background: '#fbf6ea', display: 'block' }} data-testid="review-svg">
          {view.img && imageUrl && <image href={imageUrl} x={view.x} y={view.y} width={view.w} height={view.h} opacity={0.42} preserveAspectRatio="none" />}
          {draft.rooms.map((r) => (
            <g key={r.id} onClick={() => setSel(r.id)} style={{ cursor: 'pointer' }}>
              <rect x={r.x} y={r.y} width={r.width} height={r.length} fill={FILL[r.source] ?? '#e6dac3'} fillOpacity={0.55} stroke={sel === r.id ? '#a94a26' : '#7a4a29'} strokeWidth={sel === r.id ? sw * 2.4 : sw} strokeDasharray={r.source === 'inferred' ? `${sw * 4} ${sw * 3}` : undefined} />
              <text x={r.x + r.width / 2} y={r.y + r.length / 2} fontSize={Math.max(0.9, Math.min(Math.min(r.width, r.length) / 5, r.width / (Math.max(4, r.name.length) * 0.62)))} textAnchor="middle" dominantBaseline="middle" fill="#2b1d16" style={{ pointerEvents: 'none' }}>{r.name}</text>
            </g>
          ))}
          {draft.windows.map((w) => { const r = byId.get(w.room); if (!r || !w.wall) return null; const [a, b, c, d] = wallSeg(r, w.wall, w.position, w.width); return <line key={w.id} x1={a} y1={b} x2={c} y2={d} stroke="#2f6f9f" strokeWidth={sw * 3} strokeLinecap="butt" strokeDasharray={w.source === 'assumed' ? `${sw * 3} ${sw * 2}` : undefined} /> })}
          {draft.doors.map((dr) => { const r = byId.get(dr.room); if (!r || !dr.wall) return null; const [a, b, c, d] = wallSeg(r, dr.wall, dr.position, dr.width); return <line key={dr.id} x1={a} y1={b} x2={c} y2={d} stroke={dr.door_type === 'main' ? '#a94a26' : '#b48a3c'} strokeWidth={sw * (dr.door_type === 'main' ? 4.5 : 3.2)} strokeDasharray={dr.source === 'assumed' ? `${sw * 3} ${sw * 2}` : undefined} /> })}
        </svg>
        <div className="row small muted" style={{ padding: '8px 14px', gap: 16 }}>
          <span>Solid outline: read from the drawing</span><span>Dashed: inferred / assumed</span><span style={{ color: '#a94a26' }}>■ main entrance</span><span style={{ color: '#b48a3c' }}>■ door</span><span style={{ color: '#2f6f9f' }}>■ window</span>
          {view.img && <span>Your image is shown faintly underneath to compare.</span>}
        </div>
      </div>

      <section className="pcard pcard-pad stack" aria-labelledby="rt">
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 id="rt" style={{ fontSize: '1.15rem' }}>Rooms (feet)</h3><button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={addRoom} data-testid="add-room">+ Add room</button></div>
        {draft.rooms.length === 0 && <p className="muted small">No rooms yet. Add each room with its position (x, y from the top-left corner of the house) and size.</p>}
        <div className="tbl-scroll"><table className="tbl" data-testid="rooms-table"><thead><tr><th>Name</th><th>Type</th><th>X</th><th>Y</th><th>Width</th><th>Length</th><th>Source</th><th /></tr></thead>
          <tbody>{draft.rooms.map((r, i) => (
            <tr key={r.id} style={{ background: sel === r.id ? 'var(--accent-soft)' : undefined }} onClick={() => setSel(r.id)}>
              <td style={{ minWidth: 130 }}><input value={r.name} maxLength={40} onChange={(e) => setRoom(i, { name: e.target.value })} aria-label="Room name" /></td>
              <td><select value={r.room_type} onChange={(e) => setRoom(i, { room_type: e.target.value })} aria-label="Room type">{ROOM_TYPES.map((t) => <option key={t} value={t}>{human(t)}</option>)}</select></td>
              {(['x', 'y', 'width', 'length'] as const).map((f) => <td key={f}><input type="number" step={0.25} value={r[f]} onChange={(e) => setRoom(i, { [f]: num(e.target.value) } as Partial<DraftRoom>)} aria-label={`${r.name} ${f}`} /></td>)}
              <td>{srcBadge(r.source)}{r.confidence === 'low' && <span className="badge badge-warn" title="Low confidence">low</span>}</td>
              <td><button type="button" className="pbtn pbtn-danger pbtn-sm" onClick={() => delRoom(r.id)} aria-label={`Delete ${r.name}`}>✕</button></td>
            </tr>))}</tbody></table></div>
      </section>

      <section className="pcard pcard-pad stack" aria-labelledby="dt">
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 id="dt" style={{ fontSize: '1.15rem' }}>Doors</h3><button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={addDoor} disabled={!draft.rooms.length} data-testid="add-door">+ Add door</button></div>
        {draft.doors.length === 0 && <p className="muted small">No doors were read from the drawing. Add them here, or tick “fill in standard doors and windows” below (they are marked as assumed).</p>}
        <div className="tbl-scroll"><table className="tbl" data-testid="doors-table"><thead><tr><th>Room</th><th>Wall</th><th>Position (ft along wall)</th><th>Width</th><th>Type</th><th>Opens to</th><th>Source</th><th /></tr></thead>
          <tbody>{draft.doors.map((d, i) => (
            <tr key={d.id}>
              <td>{roomSel(d.room, (v) => setDoor(i, { room: v }), 'Door room')}</td>
              <td><select value={d.wall} onChange={(e) => setDoor(i, { wall: e.target.value as Wall })} aria-label="Door wall">{WALLS.map((w) => <option key={w}>{w}</option>)}</select></td>
              <td><input type="number" step={0.25} value={d.position} onChange={(e) => setDoor(i, { position: num(e.target.value) })} aria-label="Door position" /></td>
              <td><input type="number" step={0.25} value={d.width} onChange={(e) => setDoor(i, { width: num(e.target.value), width_assumed: false })} aria-label="Door width" /></td>
              <td><select value={d.door_type} onChange={(e) => setDoor(i, { door_type: e.target.value })} aria-label="Door type">{DOOR_TYPES.map((t) => <option key={t} value={t}>{t === 'main' ? 'main entrance' : t.replace('_', ' ')}</option>)}</select></td>
              <td className="small muted">{d.connects_to ? byId.get(d.connects_to)?.name ?? d.connects_to : 'outside'}</td>
              <td>{srcBadge(d.source)}</td>
              <td><button type="button" className="pbtn pbtn-danger pbtn-sm" onClick={() => set({ doors: draft.doors.filter((_, j) => j !== i) })} aria-label="Delete door">✕</button></td>
            </tr>))}</tbody></table></div>
      </section>

      <section className="pcard pcard-pad stack" aria-labelledby="wt">
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 id="wt" style={{ fontSize: '1.15rem' }}>Windows</h3><button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={addWindow} disabled={!draft.rooms.length} data-testid="add-window">+ Add window</button></div>
        {draft.windows.length === 0 && <p className="muted small">No windows were read from the drawing.</p>}
        <div className="tbl-scroll"><table className="tbl" data-testid="windows-table"><thead><tr><th>Room</th><th>Wall</th><th>Position (ft along wall)</th><th>Width</th><th>Source</th><th /></tr></thead>
          <tbody>{draft.windows.map((w, i) => (
            <tr key={w.id}>
              <td>{roomSel(w.room, (v) => setWin(i, { room: v }), 'Window room')}</td>
              <td><select value={w.wall} onChange={(e) => setWin(i, { wall: e.target.value as Wall })} aria-label="Window wall">{WALLS.map((x) => <option key={x}>{x}</option>)}</select></td>
              <td><input type="number" step={0.25} value={w.position} onChange={(e) => setWin(i, { position: num(e.target.value) })} aria-label="Window position" /></td>
              <td><input type="number" step={0.25} value={w.width} onChange={(e) => setWin(i, { width: num(e.target.value), width_assumed: false })} aria-label="Window width" /></td>
              <td>{srcBadge(w.source)}</td>
              <td><button type="button" className="pbtn pbtn-danger pbtn-sm" onClick={() => set({ windows: draft.windows.filter((_, j) => j !== i) })} aria-label="Delete window">✕</button></td>
            </tr>))}</tbody></table></div>
      </section>
    </div>
  )
}
