import FloorRooms, { type FloorCounts } from './FloorRooms'
import PlotConfig from './PlotConfig'
import HouseConfig from './HouseConfig'
import FamilyConfig from './FamilyConfig'
import PreferencesConfig from './PreferencesConfig'
import type {
  Unit,
  RoadSide,
  HouseType,
  BuildingType,
  ParkingType,
  KitchenType,
  VastuMode,
  ArchitecturalStyle,
  Climate,
  LightPref,
  VentilationPref,
  Lifestyle,
} from '@/types'

interface SidebarProps {
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
  terrace: boolean
  setTerrace: (v: boolean) => void
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
  allowAdjust: boolean
  setAllowAdjust: (v: boolean) => void
  perFloor: boolean
  setPerFloor: (v: boolean) => void
  floorCounts: FloorCounts
  setFloorCounts: (v: FloorCounts) => void
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
  floorHeight: number
  setFloorHeight: (v: number) => void
  stairWidth: number
  setStairWidth: (v: number) => void
  isGenerating: boolean
  onGenerate: () => void
}

export default function Sidebar(props: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Project Configuration</h2>
      </div>

      <PlotConfig
        unit={props.unit}
        setUnit={props.setUnit}
        plotWidth={props.plotWidth}
        setPlotWidth={props.setPlotWidth}
        plotLength={props.plotLength}
        setPlotLength={props.setPlotLength}
        roadSide={props.roadSide}
        setRoadSide={props.setRoadSide}
        frontageSide={props.frontageSide}
        setFrontageSide={props.setFrontageSide}
        location={props.location}
        setLocation={props.setLocation}
        automaticSetbacks={props.automaticSetbacks}
        setAutomaticSetbacks={props.setAutomaticSetbacks}
        frontSetback={props.frontSetback}
        setFrontSetback={props.setFrontSetback}
        rearSetback={props.rearSetback}
        setRearSetback={props.setRearSetback}
        leftSetback={props.leftSetback}
        setLeftSetback={props.setLeftSetback}
        rightSetback={props.rightSetback}
        setRightSetback={props.setRightSetback}
      />

      <FloorRooms
        buildingType={props.buildingType}
        enabled={props.perFloor}
        setEnabled={props.setPerFloor}
        counts={props.floorCounts}
        setCounts={props.setFloorCounts}
        allowAdjust={props.allowAdjust}
        setAllowAdjust={props.setAllowAdjust}
      />

      <HouseConfig
        houseType={props.houseType}
        setHouseType={props.setHouseType}
        buildingType={props.buildingType}
        setBuildingType={props.setBuildingType}
        bedrooms={props.bedrooms}
        setBedrooms={props.setBedrooms}
        bathrooms={props.bathrooms}
        setBathrooms={props.setBathrooms}
        parking={props.parking}
        setParking={props.setParking}
        commonToilet={props.commonToilet}
        setCommonToilet={props.setCommonToilet}
        living={props.living}
        setLiving={props.setLiving}
        dining={props.dining}
        setDining={props.setDining}
        kitchen={props.kitchen}
        setKitchen={props.setKitchen}
        utility={props.utility}
        setUtility={props.setUtility}
        puja={props.puja}
        setPuja={props.setPuja}
        guest={props.guest}
        setGuest={props.setGuest}
        kitchenType={props.kitchenType}
        setKitchenType={props.setKitchenType}
      />

      <FamilyConfig
        familySize={props.familySize}
        setFamilySize={props.setFamilySize}
        adults={props.adults}
        setAdults={props.setAdults}
        children={props.children}
        setChildren={props.setChildren}
        elderly={props.elderly}
        setElderly={props.setElderly}
        frequentGuests={props.frequentGuests}
        setFrequentGuests={props.setFrequentGuests}
        lifestyle={props.lifestyle}
        setLifestyle={props.setLifestyle}
      />

      <PreferencesConfig
        vastuLabel={props.vastuLabel}
        setVastuLabel={props.setVastuLabel}
        style={props.style}
        setStyle={props.setStyle}
        climate={props.climate}
        setClimate={props.setClimate}
        lightPref={props.lightPref}
        setLightPref={props.setLightPref}
        ventilationPref={props.ventilationPref}
        setVentilationPref={props.setVentilationPref}
        pujaStyle={props.pujaStyle}
        setPujaStyle={props.setPujaStyle}
        courtyard={props.courtyard}
        setCourtyard={props.setCourtyard}
        garden={props.garden}
        setGarden={props.setGarden}
        balcony={props.balcony}
        setBalcony={props.setBalcony}
        terrace={props.terrace}
        setTerrace={props.setTerrace}
        floorHeight={props.floorHeight}
        setFloorHeight={props.setFloorHeight}
        stairWidth={props.stairWidth}
        setStairWidth={props.setStairWidth}
        buildingType={props.buildingType}
      />

      <button
        className="generate-button"
        onClick={props.onGenerate}
        disabled={props.isGenerating}
      >
        {props.isGenerating ? (
          <>
            <span className="loading-spinner" />
            Generating…
          </>
        ) : (
          '✨ Generate 4 Architectural Concepts'
        )}
      </button>
    </aside>
  )
}
