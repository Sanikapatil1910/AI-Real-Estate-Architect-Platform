import { ARCH_STYLES } from '@/lib/archStyle'
import type {
  VastuMode,
  ArchitecturalStyle,
  Climate,
  LightPref,
  VentilationPref,
} from '@/types'

interface PreferencesConfigProps {
  vastuLabel: VastuMode
  setVastuLabel: (v: VastuMode) => void
  style: ArchitecturalStyle
  setStyle: (v: ArchitecturalStyle) => void
  climate: Climate
  setClimate: (v: Climate) => void
  lightPref: LightPref
  setLightPref: (v: LightPref) => void
  ventilationPref: VentilationPref
  setVentilationPref: (v: VentilationPref) => void
  pujaStyle: 'closed' | 'open'
  setPujaStyle: (v: 'closed' | 'open') => void
  courtyard: boolean
  setCourtyard: (v: boolean) => void
  garden: boolean
  setGarden: (v: boolean) => void
  balcony: boolean
  setBalcony: (v: boolean) => void
  terrace: boolean
  setTerrace: (v: boolean) => void
  floorHeight: number
  setFloorHeight: (v: number) => void
  stairWidth: number
  setStairWidth: (v: number) => void
  buildingType: string
}

export default function PreferencesConfig({
  vastuLabel,
  setVastuLabel,
  style,
  setStyle,
  climate,
  setClimate,
  lightPref,
  setLightPref,
  ventilationPref,
  setVentilationPref,
  pujaStyle,
  setPujaStyle,
  courtyard,
  setCourtyard,
  garden,
  setGarden,
  balcony,
  setBalcony,
  terrace,
  setTerrace,
  floorHeight,
  setFloorHeight,
  stairWidth,
  setStairWidth,
  buildingType,
}: PreferencesConfigProps) {
  return (
    <>
      <div className="form-section">
        <div className="form-section-header">
          <h3>🧭 Vastu</h3>
        </div>
        <div className="form-group">
          <label>Vastu Preference</label>
          <select value={vastuLabel} onChange={(e) => setVastuLabel(e.target.value as VastuMode)}>
            <option value="No Preference">No Preference</option>
            <option value="Basic">Basic</option>
            <option value="Strict">Strict</option>
          </select>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-header">
          <h3>🏛️ Architectural Style</h3>
        </div>
        <div className="form-group">
          <label>Style</label>
          <select value={style} onChange={(e) => setStyle(e.target.value as ArchitecturalStyle)}>
            {ARCH_STYLES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-header">
          <h3>🌦️ Environment</h3>
        </div>
        <div className="form-group">
          <label>Climate</label>
          <select value={climate} onChange={(e) => setClimate(e.target.value as Climate)}>
            <option value="Auto">Auto</option>
            <option value="Hot &amp; Dry">Hot &amp; Dry</option>
            <option value="Warm &amp; Humid">Warm &amp; Humid</option>
            <option value="Moderate">Moderate</option>
            <option value="Cold / Hilly">Cold / Hilly</option>
            <option value="Heavy Rainfall">Heavy Rainfall</option>
          </select>
        </div>
        <div className="form-group">
          <label>Natural light</label>
          <select value={lightPref} onChange={(e) => setLightPref(e.target.value as LightPref)}>
            <option value="Balanced">Balanced</option>
            <option value="High">High</option>
            <option value="Maximum">Maximum</option>
          </select>
        </div>
        <div className="form-group">
          <label>Ventilation</label>
          <select
            value={ventilationPref}
            onChange={(e) => setVentilationPref(e.target.value as VentilationPref)}
          >
            <option value="Balanced">Balanced</option>
            <option value="High">High</option>
            <option value="Cross ventilation">Cross ventilation</option>
          </select>
          <small style={{ color: 'var(--muted)' }}>High / Cross ventilation: puja room and dining are open (curtain or glass), not walled.</small>
        </div>
        <div className="form-group">
          <label>Puja room</label>
          <select value={pujaStyle} onChange={(e) => setPujaStyle(e.target.value as 'closed' | 'open')}>
            <option value="closed">Closed (walls and a door)</option>
            <option value="open">Open (no wall on the shared side)</option>
          </select>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-header">
          <h3>🌿 Open Space</h3>
        </div>
        <div className="checkbox-row">
          <input
            id="courtyard"
            type="checkbox"
            checked={courtyard}
            onChange={(e) => setCourtyard(e.target.checked)}
          />
          <label htmlFor="courtyard">Prefer courtyard</label>
        </div>
        <div className="checkbox-row">
          <input
            id="garden"
            type="checkbox"
            checked={garden}
            onChange={(e) => setGarden(e.target.checked)}
          />
          <label htmlFor="garden">Front / rear garden</label>
        </div>
        <div className="checkbox-row">
          <input
            id="terrace"
            type="checkbox"
            checked={terrace}
            onChange={(e) => setTerrace(e.target.checked)}
          />
          <label htmlFor="terrace">Roof terrace (over the top floor)</label>
        </div>
        {buildingType !== 'Ground' && (
          <div className="checkbox-row">
            <input
              id="balcony"
              type="checkbox"
              checked={balcony}
              onChange={(e) => setBalcony(e.target.checked)}
            />
            <label htmlFor="balcony">Balcony on upper floor</label>
          </div>
        )}
      </div>

      <div className="form-section">
        <div className="form-section-header">
          <h3>📐 Structure</h3>
        </div>
        <div className="form-group">
          <label>Floor height (ft)</label>
          <input
            type="number"
            min={8}
            max={15}
            step={0.5}
            value={floorHeight}
            onChange={(e) => setFloorHeight(parseFloat(e.target.value) || 10)}
          />
        </div>
        <div className="form-group">
          <label>Stair width (ft)</label>
          <input
            type="number"
            min={3}
            max={6}
            step={0.5}
            value={stairWidth}
            onChange={(e) => setStairWidth(parseFloat(e.target.value) || 3.5)}
          />
        </div>
      </div>
    </>
  )
}
