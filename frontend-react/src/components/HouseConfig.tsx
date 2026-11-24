import type { HouseType, BuildingType, ParkingType, KitchenType } from '@/types'

interface HouseConfigProps {
  houseType: HouseType
  setHouseType: (v: HouseType) => void
  buildingType: BuildingType
  setBuildingType: (v: BuildingType) => void
  bedrooms: number
  setBedrooms: (v: number) => void
  bathrooms: number
  setBathrooms: (v: number) => void
  parking: ParkingType
  setParking: (v: ParkingType) => void
  commonToilet: 'attached' | 'separate'
  setCommonToilet: (v: 'attached' | 'separate') => void
  living: boolean
  setLiving: (v: boolean) => void
  dining: boolean
  setDining: (v: boolean) => void
  kitchen: boolean
  setKitchen: (v: boolean) => void
  utility: boolean
  setUtility: (v: boolean) => void
  puja: boolean
  setPuja: (v: boolean) => void
  guest: boolean
  setGuest: (v: boolean) => void
  kitchenType: KitchenType
  setKitchenType: (v: KitchenType) => void
}

export default function HouseConfig({
  houseType,
  setHouseType,
  buildingType,
  setBuildingType,
  bedrooms,
  setBedrooms,
  bathrooms,
  setBathrooms,
  parking,
  setParking,
  commonToilet,
  setCommonToilet,
  living,
  setLiving,
  dining,
  setDining,
  kitchen,
  setKitchen,
  utility,
  setUtility,
  puja,
  setPuja,
  guest,
  setGuest,
  kitchenType,
  setKitchenType,
}: HouseConfigProps) {
  return (
    <div className="form-section">
      <div className="form-section-header">
        <h3>🏡 House</h3>
      </div>

      <div className="form-group">
        <label>House Type</label>
        <select value={houseType} onChange={(e) => setHouseType(e.target.value as HouseType)}>
          <option value="1 BHK">1 BHK</option>
          <option value="2 BHK">2 BHK</option>
          <option value="3 BHK">3 BHK</option>
          <option value="4 BHK">4 BHK</option>
          <option value="Custom">Custom</option>
        </select>
      </div>

      <div className="form-group">
        <label>Building Type</label>
        <select value={buildingType} onChange={(e) => setBuildingType(e.target.value as BuildingType)}>
          <option value="Ground">Ground</option>
          <option value="G+1">G+1</option>
          <option value="G+2">G+2</option>
          <option value="Duplex">Duplex</option>
          <option value="Villa">Villa</option>
        </select>
      </div>

      <div className="grid-2">
        <div className="form-group">
          <label>Bedrooms</label>
          <input
            type="number"
            min={1}
            max={8}
            step={1}
            value={bedrooms}
            onChange={(e) => setBedrooms(parseInt(e.target.value) || 1)}
          />
        </div>
        <div className="form-group">
          <label>Bathrooms</label>
          <input
            type="number"
            min={1}
            max={8}
            step={1}
            value={bathrooms}
            onChange={(e) => setBathrooms(parseInt(e.target.value) || 1)}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Common bathroom (always included)</label>
        <select value={commonToilet} onChange={(e) => setCommonToilet(e.target.value as 'attached' | 'separate')}>
          <option value="attached">Toilet + bathroom together (one room)</option>
          <option value="separate">Toilet (WC) and bathroom separate</option>
        </select>
      </div>

      <div className="form-group">
        <label>Parking</label>
        <select value={parking} onChange={(e) => setParking(e.target.value as ParkingType)}>
          <option value="No Parking">No Parking</option>
          <option value="1 Car">1 Car</option>
          <option value="2 Cars">2 Cars</option>
          <option value="Bikes">Bikes</option>
          <option value="Car + Bikes">Car + Bikes</option>
        </select>
      </div>

      <div className="checkbox-row">
        <input id="living" type="checkbox" checked={living} onChange={(e) => setLiving(e.target.checked)} />
        <label htmlFor="living">Living room</label>
      </div>
      <div className="checkbox-row">
        <input id="dining" type="checkbox" checked={dining} onChange={(e) => setDining(e.target.checked)} />
        <label htmlFor="dining">Dining room</label>
      </div>
      <div className="checkbox-row">
        <input id="kitchen" type="checkbox" checked={kitchen} onChange={(e) => setKitchen(e.target.checked)} />
        <label htmlFor="kitchen">Kitchen</label>
      </div>
      <div className="checkbox-row">
        <input id="utility" type="checkbox" checked={utility} onChange={(e) => setUtility(e.target.checked)} />
        <label htmlFor="utility">Utility / laundry</label>
      </div>
      <div className="checkbox-row">
        <input id="puja" type="checkbox" checked={puja} onChange={(e) => setPuja(e.target.checked)} />
        <label htmlFor="puja">Puja room</label>
      </div>
      <div className="checkbox-row">
        <input id="guest" type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} />
        <label htmlFor="guest">Guest bedroom</label>
      </div>

      <div className="form-group" style={{ marginTop: 12 }}>
        <label>Kitchen type</label>
        <select value={kitchenType} onChange={(e) => setKitchenType(e.target.value as KitchenType)}>
          <option value="Open">Open</option>
          <option value="Closed">Closed</option>
          <option value="Modular">Modular</option>
          <option value="Traditional">Traditional</option>
        </select>
      </div>
    </div>
  )
}
