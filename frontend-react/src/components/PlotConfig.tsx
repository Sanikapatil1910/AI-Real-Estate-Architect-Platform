import type { Unit, RoadSide } from '@/types'

interface PlotConfigProps {
  unit: Unit
  setUnit: (v: Unit) => void
  plotWidth: number
  setPlotWidth: (v: number) => void
  plotLength: number
  setPlotLength: (v: number) => void
  roadSide: RoadSide
  setRoadSide: (v: RoadSide) => void
  frontageSide: '' | 'width' | 'length'
  setFrontageSide: (v: '' | 'width' | 'length') => void
  location: string
  setLocation: (v: string) => void
  automaticSetbacks: boolean
  setAutomaticSetbacks: (v: boolean) => void
  frontSetback: number
  setFrontSetback: (v: number) => void
  rearSetback: number
  setRearSetback: (v: number) => void
  leftSetback: number
  setLeftSetback: (v: number) => void
  rightSetback: number
  setRightSetback: (v: number) => void
}

export default function PlotConfig({
  unit,
  setUnit,
  plotWidth,
  setPlotWidth,
  plotLength,
  setPlotLength,
  roadSide,
  setRoadSide,
  frontageSide,
  setFrontageSide,
  location,
  setLocation,
  automaticSetbacks,
  setAutomaticSetbacks,
  frontSetback,
  setFrontSetback,
  rearSetback,
  setRearSetback,
  leftSetback,
  setLeftSetback,
  rightSetback,
  setRightSetback,
}: PlotConfigProps) {
  return (
    <div className="form-section">
      <div className="form-section-header">
        <h3>📍 Site &amp; Plot</h3>
      </div>

      <div className="form-group">
        <label>Unit</label>
        <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          <option value="Feet">Feet</option>
          <option value="Meters">Meters</option>
        </select>
      </div>

      <div className="grid-2">
        <div className="form-group">
          <label>Plot Width</label>
          <input
            type="number"
            min={10}
            max={300}
            step={1}
            value={plotWidth}
            onChange={(e) => setPlotWidth(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="form-group">
          <label>Plot Length</label>
          <input
            type="number"
            min={10}
            max={300}
            step={1}
            value={plotLength}
            onChange={(e) => setPlotLength(parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="frontage-side">Frontage (the plot side that faces the road)</label>
        <select
          id="frontage-side"
          data-testid="frontage-select"
          value={frontageSide}
          onChange={(e) => setFrontageSide(e.target.value as '' | 'width' | 'length')}
          style={frontageSide === '' ? { borderColor: '#dc2626' } : undefined}
        >
          <option value="">Choose the road-facing side…</option>
          <option value="width">{plotWidth || 0} {unit === 'Meters' ? 'm' : 'ft'} side (plot width) faces the road</option>
          <option value="length">{plotLength || 0} {unit === 'Meters' ? 'm' : 'ft'} side (plot length) faces the road</option>
        </select>
        <small style={{ color: 'var(--muted)' }}>
          {frontageSide === 'width'
            ? `Frontage ${plotWidth} × depth ${plotLength}.`
            : frontageSide === 'length'
              ? `Frontage ${plotLength} × depth ${plotWidth}.`
              : 'Required: the planner never guesses which side is the road frontage.'}
        </small>
      </div>

      <div className="form-group">
        <label>Road Side</label>
        <select value={roadSide} onChange={(e) => setRoadSide(e.target.value as RoadSide)}>
          <option value="North">North</option>
          <option value="South">South</option>
          <option value="East">East</option>
          <option value="West">West</option>
        </select>
      </div>

      <div className="form-group">
        <label>Location</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      <div className="checkbox-row">
        <input
          id="auto-setbacks"
          type="checkbox"
          checked={automaticSetbacks}
          onChange={(e) => setAutomaticSetbacks(e.target.checked)}
        />
        <label htmlFor="auto-setbacks">Automatic setbacks</label>
      </div>

      {!automaticSetbacks && (
        <div style={{ marginTop: 12 }}>
          <div className="grid-2">
            <div className="form-group">
              <label>Front</label>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={frontSetback}
                onChange={(e) => setFrontSetback(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="form-group">
              <label>Rear</label>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={rearSetback}
                onChange={(e) => setRearSetback(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="form-group">
              <label>Left</label>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={leftSetback}
                onChange={(e) => setLeftSetback(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="form-group">
              <label>Right</label>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={rightSetback}
                onChange={(e) => setRightSetback(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
