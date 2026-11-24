/**
 * The small floating control that opens next to a ceiling fan when it is pointed at (hint) or selected (full): the room, ON / OFF, the speed, and
 * OFF | 1 | 2 | 3 | 5 buttons.  Pure layout (the same PanelLayout the big panel uses), so it is drawn by drawPanel and hit-tested by hitPanel.
 */
import type { PanelLayout, PanelButton } from './smart/panel'
import { FAN_SPEEDS } from './smart/panel'

export const POPUP_W = 720
export const POPUP_H = 300
/** size of the floating plane in feet (the smart-house group is in model feet) */
export const POPUP_FT_W = 3.6
export const POPUP_FT_H = (POPUP_FT_W * POPUP_H) / POPUP_W
export const POPUP_HIDE_SECONDS = 6

export interface FanPopupInfo { key: string; name: string; floor: number; level: number; rpm: number }

export function layoutFanPopup(info: FanPopupInfo, mode: 'hint' | 'full'): PanelLayout {
  const b: PanelButton[] = []
  const status = info.level === 0 ? 'OFF' : `ON  -  speed ${info.level}  (${info.rpm} rpm)`
  const texts: PanelLayout['texts'] = [
    { x: 28, y: 52, text: `Ceiling fan - ${info.name}`, size: 34, weight: 700, color: '#f3efe6' },
    { x: 28, y: 100, text: status, size: 32, weight: 600, color: info.level > 0 ? '#7fe3a0' : '#c9c4b6' },
  ]
  if (mode === 'hint') {
    texts.push({ x: 28, y: 160, text: 'Trigger / click: switch ON or OFF', size: 28, color: '#d9c9a0' })
    texts.push({ x: 28, y: 204, text: 'then pick a speed', size: 28, color: '#d9c9a0' })
    return { width: POPUP_W, height: POPUP_H, buttons: b, texts }
  }
  const labels: Array<[number, string]> = [[0, 'OFF'], ...FAN_SPEEDS.map((l): [number, string] => [l, String(l)])]
  const x0 = 28, gap = 10, y = 140, h = 120, bw = Math.floor((POPUP_W - 2 * x0 - gap * labels.length + gap) / labels.length)   // OFF + 5 speeds share the width
  labels.forEach(([lv, label], i) => b.push({ id: `pop:${lv}`, x: x0 + i * (bw + gap), y, w: bw, h, label, kind: info.level === lv ? 'on' : lv === 0 ? 'off' : 'neutral', action: { t: 'fanSet', key: info.key, level: lv } }))
  texts.push({ x: 28, y: 284, text: 'speed 1 = slow ... 5 = fastest', size: 20, color: '#b9b4a6' })
  return { width: POPUP_W, height: POPUP_H, buttons: b, texts }
}
