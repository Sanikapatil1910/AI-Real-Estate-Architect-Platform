/**
 * The two QR workflows, as modal dialogs:
 *   A. QrShareDialog  - a QR of the address of the page you are on (editable: paste the tunnel address), with the full text, Copy, Regenerate and Close.
 *   B. QrScanDialog   - opens the camera ONLY after a click, reads a QR, validates it, and shows a confirmation screen.  It never navigates by itself.
 * The camera stream, the timers and the key listener are released when a dialog closes or unmounts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { buildShareUrl, splitUrl, validateScanned } from './qrUrl'
import type { ScanResult } from './qrUrl'
import { qrMatrix, qrSvgPath } from './qrCode'
import { decodeFrame, hasNativeDetector } from './scan'

export const QR_EVENT = 'rea:qr'
export type QrKind = 'share' | 'scan'
/** any button can open a dialog: openQr('share') / openQr('scan') */
export const openQr = (kind: QrKind): void => { window.dispatchEvent(new CustomEvent<QrKind>(QR_EVENT, { detail: kind })) }

function Modal({ title, onClose, testId, children }: { title: string; onClose: () => void; testId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button, input')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Tab' && ref.current) {                                  // keep the focus inside the dialog
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href], [tabindex="0"]'))
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); prev?.focus?.() }
  }, [onClose])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,24,.62)', zIndex: 1000, display: 'grid', placeItems: 'center', padding: 16, overflowY: 'auto' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} data-testid={testId} className="pcard pcard-pad stack" style={{ width: 'min(560px, 100%)', background: '#fffdf8', maxHeight: '96vh', overflowY: 'auto' }}>
        <div className="row" style={{ alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{title}</h2>
          <span className="grow" />
          <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={onClose} data-testid={`${testId}-x`} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const warnStyle = { background: '#fff4d6', border: '1px solid #e2c36b', borderRadius: 8, padding: '8px 10px', fontSize: '.9rem' } as const
const badStyle = { background: '#fde8e6', border: '1px solid #e0a29b', borderRadius: 8, padding: '8px 10px', fontSize: '.9rem' } as const

// ====================================================================================================================== A. share
export function QrShareDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState(() => window.location.href)
  const [copied, setCopied] = useState('')
  const res = useMemo(() => buildShareUrl(window.location.href, text), [text])
  const qr = useMemo(() => { if (!res.ok) return null; try { return qrSvgPath(qrMatrix(res.url)) } catch (e) { return { error: (e as Error).message } } }, [res])
  const copy = async () => {
    if (!res.ok) return
    try { await navigator.clipboard.writeText(res.url); setCopied('Copied to the clipboard.') } catch {
      const ta = document.createElement('textarea'); ta.value = res.url; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select()
      let ok = false; try { ok = document.execCommand('copy') } catch { ok = false }
      ta.remove(); setCopied(ok ? 'Copied to the clipboard.' : 'Could not copy automatically: select the address above and copy it.')
    }
  }
  return (
    <Modal title="Open this on your phone or headset" onClose={onClose} testId="qr-share-dialog">
      <p className="small muted" style={{ margin: 0 }}>Scan with a phone camera, then open the link. The code holds the address of the page you are on right now.</p>
      <label className="small" htmlFor="qr-share-input">Address to share</label>
      <input id="qr-share-input" data-testid="qr-share-input" value={text} onChange={(e) => { setText(e.target.value); setCopied('') }} spellCheck={false} autoComplete="off" style={{ width: '100%', font: '14px ui-monospace, monospace', padding: '8px 10px', borderRadius: 8, border: '1px solid #cdbf9b' }} />
      {!res.ok && <div style={badStyle} role="alert" data-testid="qr-share-error">{res.reason}</div>}
      {res.ok && qr && 'd' in qr && (
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <svg data-testid="qr-svg" role="img" aria-label={`QR code for ${res.url}`} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" style={{ width: 'min(300px, 80vw)', height: 'auto', background: '#fff', borderRadius: 8 }}>
            <rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.d} fill="#000" />
          </svg>
        </div>
      )}
      {res.ok && qr && 'error' in qr && <div style={badStyle} role="alert">{qr.error}</div>}
      {res.ok && (
        <>
          <div className="small" data-testid="qr-scope"><strong>{res.info.label}</strong> · {res.info.secure ? 'https' : 'http'} · {res.info.vrReady ? 'VR-ready on the Quest Browser' : 'not VR-ready'}</div>
          <code data-testid="qr-url-text" style={{ display: 'block', wordBreak: 'break-all', background: '#f3eddc', borderRadius: 8, padding: '8px 10px', fontSize: '.85rem', userSelect: 'all' }}>{res.url}</code>
          {res.warnings.map((w) => <div key={w} style={warnStyle} role="note" data-testid="qr-warning">{w}</div>)}
        </>
      )}
      {copied && <div className="small" role="status" data-testid="qr-copied">{copied}</div>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="pbtn pbtn-primary pbtn-sm" onClick={() => void copy()} disabled={!res.ok} data-testid="qr-copy">Copy URL</button>
        <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => { setText(window.location.href); setCopied('') }} data-testid="qr-regenerate">Regenerate</button>
        <span className="grow" />
        <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={onClose} data-testid="qr-close">Close</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>On a Meta Quest: the headset browser cannot scan a code, so open this link on the headset by typing the address, or send it to yourself and open it there. Only https addresses can enter VR.</p>
    </Modal>
  )
}

// ====================================================================================================================== B. scan
type Phase = { s: 'idle' } | { s: 'starting' } | { s: 'live' } | { s: 'confirm'; r: ScanResult } | { s: 'error'; msg: string }

function cameraError(e: unknown): string {
  const n = (e as { name?: string } | null)?.name ?? ''
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Camera permission was denied. Allow the camera for this site in the browser, or use one of the options below.'
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device. Use one of the options below.'
  if (n === 'NotReadableError' || n === 'AbortError') return 'The camera is busy (another app may be using it). Close that app and try again.'
  return 'The camera could not be started. Use one of the options below.'
}

export function QrScanDialog({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ s: 'idle' })
  const [hint, setHint] = useState('')
  const [manual, setManual] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)
  const busy = useRef(false)
  const lastBad = useRef('')
  const scratch = useRef<HTMLCanvasElement | null>(null)
  const alive = useRef(true)
  const cameraOk = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext

  const stop = useCallback(() => {
    if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null }
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) { video.current.pause(); video.current.srcObject = null }
  }, [])
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop() } }, [stop])

  const consider = useCallback((text: string, source: 'camera' | 'other'): boolean => {
    const r = validateScanned(text, window.location.host)
    if (r.ok) { stop(); setHint(''); setPhase({ s: 'confirm', r }); return true }
    if (source === 'camera') { if (lastBad.current !== text) { lastBad.current = text; setHint(`A QR code was found, but it was not opened: ${r.reason}`) } } else setHint(r.reason)
    return false
  }, [stop])

  const start = async () => {
    setHint(''); lastBad.current = ''
    if (!cameraOk) { setPhase({ s: 'error', msg: window.isSecureContext ? 'This browser cannot open the camera from a web page.' : 'The camera needs a secure (https or localhost) page, and this page is not one.' }); return }
    setPhase({ s: 'starting' })
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (!alive.current) { s.getTracks().forEach((t) => t.stop()); return }
      stream.current = s
      setPhase({ s: 'live' })
      requestAnimationFrame(async () => {
        const v = video.current
        if (!v || !stream.current) return
        v.srcObject = stream.current
        try { await v.play() } catch { /* autoplay refused: the user already clicked, so this is rare */ }
        scratch.current ||= document.createElement('canvas')
        timer.current = window.setInterval(async () => {
          if (busy.current || !video.current || video.current.readyState < 2) return
          busy.current = true
          try { const t = await decodeFrame(video.current, scratch.current!); if (t && alive.current) consider(t, 'camera') } catch { /* a bad frame: next one */ } finally { busy.current = false }
        }, 160)
      })
    } catch (e) { stream.current?.getTracks().forEach((t) => t.stop()); setPhase({ s: 'error', msg: cameraError(e) }) }
  }

  const fromPhoto = async (f: File | undefined) => {
    if (!f) return
    setHint('')
    const url = URL.createObjectURL(f)
    try {
      const img = new Image(); img.src = url; await img.decode()
      scratch.current ||= document.createElement('canvas')
      const t = await decodeFrame(img, scratch.current)
      if (!t) setHint('No QR code was found in that picture. Try a sharper, closer photo.'); else consider(t, 'other')
    } catch { setHint('That file could not be read as a picture.') } finally { URL.revokeObjectURL(url) }
  }

  const back = () => { stop(); setHint(''); setPhase({ s: 'idle' }) }
  const open = (url: string) => { window.open(url, '_blank', 'noopener,noreferrer'); onClose() }
  const closeAll = useCallback(() => { stop(); onClose() }, [stop, onClose])

  return (
    <Modal title="Scan a QR code" onClose={closeAll} testId="qr-scan-dialog">
      {phase.s === 'confirm' ? (
        <Confirm r={phase.r} onCancel={back} onOpen={() => open(phase.r.url)} />
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>Point the camera at a QR code that holds a web address. Nothing opens until you confirm it on the next screen.</p>
          {(phase.s === 'live' || phase.s === 'starting') && (
            <div style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden', aspectRatio: '4 / 3' }}>
              <video ref={video} data-testid="qr-video" playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {phase.s === 'live' && <div aria-hidden="true" style={{ position: 'absolute', inset: '18%', border: '3px solid #ffd866', borderRadius: 12, pointerEvents: 'none' }} />}
              {phase.s === 'starting' && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff' }}>Starting the camera…</div>}
            </div>
          )}
          {phase.s === 'live' && <div className="small" role="status" data-testid="qr-live">Camera is on. Hold the code inside the frame{hasNativeDetector() ? '' : ' (using the built-in decoder)'}.</div>}
          {phase.s === 'error' && <div style={badStyle} role="alert" data-testid="qr-error">{phase.msg}</div>}
          {hint && <div style={warnStyle} role="status" data-testid="qr-hint">{hint}</div>}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {phase.s !== 'live' && phase.s !== 'starting' && <button type="button" className="pbtn pbtn-primary pbtn-sm" onClick={() => void start()} data-testid="qr-start-camera">{phase.s === 'error' ? 'Try the camera again' : 'Start camera'}</button>}
            {(phase.s === 'live' || phase.s === 'starting') && <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={back} data-testid="qr-stop-camera">Stop camera</button>}
            <label className="pbtn pbtn-ghost pbtn-sm" style={{ cursor: 'pointer' }}>Scan from a photo<input type="file" accept="image/*" data-testid="qr-file" style={{ display: 'none' }} onChange={(e) => { void fromPhoto(e.target.files?.[0]); e.target.value = '' }} /></label>
            <span className="grow" />
            <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={closeAll} data-testid="qr-scan-close">Close</button>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="small" htmlFor="qr-manual">Or type / paste the address</label>
            <div className="row">
              <input id="qr-manual" data-testid="qr-manual-input" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) consider(manual, 'other') }} placeholder="https://…" spellCheck={false} autoComplete="off" style={{ flex: 1, minWidth: 0, font: '14px ui-monospace, monospace', padding: '8px 10px', borderRadius: 8, border: '1px solid #cdbf9b' }} />
              <button type="button" className="pbtn pbtn-ghost pbtn-sm" onClick={() => consider(manual, 'other')} disabled={!manual.trim()} data-testid="qr-manual-check">Check</button>
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Meta Quest: the headset browser does not give web pages its cameras, so scanning will not work there. Use "type / paste the address", or scan on a phone and open the link on the headset.</p>
        </>
      )}
    </Modal>
  )
}

function Confirm({ r, onCancel, onOpen }: { r: ScanResult; onCancel: () => void; onOpen: () => void }) {
  const p = splitUrl(r.url)
  return (
    <div className="stack" data-testid="qr-confirm">
      <p style={{ margin: 0 }}>This code holds the address below. Open it?</p>
      <code data-testid="qr-confirm-url" style={{ display: 'block', wordBreak: 'break-all', background: '#f3eddc', borderRadius: 8, padding: '10px 12px', fontSize: '.9rem' }}>
        <span>{p.before}</span><strong style={{ background: '#ffe9a8', padding: '0 2px' }}>{p.host}</strong><span>{p.after}</span>
      </code>
      <div className="small"><strong>{r.info.label}</strong> · {r.info.secure ? 'https' : 'http'}</div>
      {r.warnings.map((w) => <div key={w} style={warnStyle} role="note" data-testid="qr-warning">{w}</div>)}
      <div className="row">
        <button type="button" className="pbtn pbtn-primary" onClick={onOpen} data-testid="qr-open">Open this address</button>
        <button type="button" className="pbtn pbtn-ghost" onClick={onCancel} data-testid="qr-cancel">Cancel</button>
      </div>
    </div>
  )
}

/** mounted once (AppShell): listens for openQr() and shows the dialog */
export function QrHost() {
  const [kind, setKind] = useState<QrKind | null>(null)
  useEffect(() => {
    const h = (e: Event) => setKind((e as CustomEvent<QrKind>).detail)
    window.addEventListener(QR_EVENT, h)
    return () => window.removeEventListener(QR_EVENT, h)
  }, [])
  const close = useCallback(() => setKind(null), [])
  return kind === 'share' ? <QrShareDialog onClose={close} /> : kind === 'scan' ? <QrScanDialog onClose={close} /> : null
}
