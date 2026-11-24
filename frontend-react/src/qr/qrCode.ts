/** QR encoding for the share dialog: the text -> a square matrix of dark / light modules -> an SVG path (crisp at any size, no canvas needed). */
import qrcode from 'qrcode-generator'

/** Encodes `text` (UTF-8 bytes); medium error correction, falling back to low for very long addresses.  Throws when the text cannot fit in any QR code. */
export function qrMatrix(text: string): boolean[][] {
  for (const level of ['M', 'L'] as const) {
    try {
      const q = qrcode(0, level)
      q.addData(text, 'Byte')
      q.make()
      const n = q.getModuleCount()
      return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)))
    } catch { /* too long for this level: try the next */ }
  }
  throw new Error('This address is too long to fit in a QR code.')
}

/** one <path> for all dark modules, with the 4-module quiet zone the QR standard asks for */
export function qrSvgPath(m: boolean[][], quiet = 4): { d: string; size: number } {
  const n = m.length
  let d = ''
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!m[r][c]) { c++; continue }
      let e = c
      while (e < n && m[r][e]) e++
      d += `M${c + quiet} ${r + quiet}h${e - c}v1h-${e - c}z`
      c = e
    }
  }
  return { d, size: n + 2 * quiet }
}
