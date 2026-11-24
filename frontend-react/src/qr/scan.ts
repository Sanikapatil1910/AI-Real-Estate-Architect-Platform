/**
 * Decoding a QR code from a camera frame or a photo.  BarcodeDetector (built into Chromium / the Quest Browser where available) is used first; jsQR (pure JavaScript,
 * loaded only when needed) is the fallback.  Nothing here touches the camera by itself: the scanner component starts the stream after the person clicks.
 */
type Detector = { detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
let detector: Detector | null | undefined

function nativeDetector(): Detector | null {
  if (detector !== undefined) return detector
  try {
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
    detector = BD ? new BD({ formats: ['qr_code'] }) : null
  } catch { detector = null }
  return detector
}
export const hasNativeDetector = (): boolean => nativeDetector() !== null

/** the text of the first QR code in the frame, or null */
export async function decodeFrame(src: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, scratch: HTMLCanvasElement, maxSide = 720): Promise<string | null> {
  const d = nativeDetector()
  if (d) {
    try { const r = await d.detect(src); if (r[0]?.rawValue) return r[0].rawValue } catch { /* fall through to jsQR */ }
  }
  const w = src instanceof HTMLVideoElement ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : src.width
  const h = src instanceof HTMLVideoElement ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : src.height
  if (!w || !h) return null
  const k = Math.min(1, maxSide / Math.max(w, h))
  scratch.width = Math.max(1, Math.round(w * k)); scratch.height = Math.max(1, Math.round(h * k))
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(src, 0, 0, scratch.width, scratch.height)
  const img = ctx.getImageData(0, 0, scratch.width, scratch.height)
  const { default: jsQR } = await import('jsqr')
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
  return hit ? hit.data : null
}
