import type { Lifestyle } from '@/types'

interface FamilyConfigProps {
  familySize: number
  setFamilySize: (v: number) => void
  adults: number
  setAdults: (v: number) => void
  children: number
  setChildren: (v: number) => void
  elderly: number
  setElderly: (v: number) => void
  frequentGuests: boolean
  setFrequentGuests: (v: boolean) => void
  lifestyle: Lifestyle
  setLifestyle: (v: Lifestyle) => void
}

export default function FamilyConfig({
  familySize,
  setFamilySize,
  adults,
  setAdults,
  children,
  setChildren,
  elderly,
  setElderly,
  frequentGuests,
  setFrequentGuests,
  lifestyle,
  setLifestyle,
}: FamilyConfigProps) {
  return (
    <div className="form-section">
      <div className="form-section-header">
        <h3>👨‍👩‍👧 Family &amp; Lifestyle</h3>
      </div>

      <div className="grid-2">
        <div className="form-group">
          <label>Total people</label>
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={familySize}
            onChange={(e) => setFamilySize(parseInt(e.target.value) || 1)}
          />
        </div>
        <div className="form-group">
          <label>Adults</label>
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={adults}
            onChange={(e) => setAdults(parseInt(e.target.value) || 1)}
          />
        </div>
        <div className="form-group">
          <label>Children</label>
          <input
            type="number"
            min={0}
            max={10}
            step={1}
            value={children}
            onChange={(e) => setChildren(parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="form-group">
          <label>Elderly family members</label>
          <input
            type="number"
            min={0}
            max={10}
            step={1}
            value={elderly}
            onChange={(e) => setElderly(parseInt(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="checkbox-row">
        <input
          id="freq-guests"
          type="checkbox"
          checked={frequentGuests}
          onChange={(e) => setFrequentGuests(e.target.checked)}
        />
        <label htmlFor="freq-guests">Guests frequently visit</label>
      </div>

      <div className="form-group" style={{ marginTop: 12 }}>
        <label>Lifestyle</label>
        <select value={lifestyle} onChange={(e) => setLifestyle(e.target.value as Lifestyle)}>
          <option value="Small family">Small family</option>
          <option value="Joint family">Joint family</option>
          <option value="Working professionals">Working professionals</option>
          <option value="Large family">Large family</option>
          <option value="Frequent guests">Frequent guests</option>
        </select>
      </div>
    </div>
  )
}
