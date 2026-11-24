import { defaultCourtyardFor } from '@/lib/archStyle'
import { loadPrefs } from '../lib/prefs'
import { createProject } from '../lib/projects'
import { STYLES } from '../components/twinStyles'
import type { Design } from '../components/twinThemes'
import { defaultFloorCounts, flattenFloorCounts, floorCount, type FloorCounts } from '../components/FloorRooms'
import { useEffect, useMemo, useRef, useState } from 'react'
import ComplianceReport from '../components/ComplianceReport'
import '../App.css'
import Sidebar from '../components/Sidebar'
import PlanResults from '../components/PlanResults'
import { checkFeasibility, generatePlans, parseBrief, PlanConflictError, proposeAdjustments } from '../lib/api'
import type { FeasibilityReport } from '../lib/api'
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
  RoomRequest,
  FamilyContext,
  GenerateResponse,
  GenerateRequestPayload,
  AdjustmentProposals,
  Plan,
} from '../types'

function buildRooms(params: {
  living: boolean
  dining: boolean
  kitchen: boolean
  utility: boolean
  bedrooms: number
  bathrooms: number
  puja: boolean
  guest: boolean
  frequentGuests: boolean
  kitchenType: KitchenType
}): RoomRequest[] {
  const rooms: RoomRequest[] = []
  if (params.living) rooms.push({ room_type: 'living_room' })
  if (params.dining) rooms.push({ room_type: 'dining' })
  if (params.kitchen) rooms.push({ room_type: 'kitchen' })
  if (params.utility) rooms.push({ room_type: 'utility' })
  for (let i = 0; i < params.bedrooms; i++) {
    rooms.push({ room_type: i === 0 ? 'master_bedroom' : 'bedroom' })
  }
  for (let i = 0; i < params.bathrooms; i++) {
    rooms.push({ room_type: 'bathroom' })
  }
  if (params.puja) rooms.push({ room_type: 'puja_room' })
  if (params.guest || params.frequentGuests) rooms.push({ room_type: 'guest_bedroom' })
  return rooms
}

export default function Workspace() {
  const [unit, setUnit] = useState<Unit>('Feet')
  const [plotWidth, setPlotWidth] = useState<number>(40)
  const [plotLength, setPlotLength] = useState<number>(50)
  const [roadSide, setRoadSide] = useState<RoadSide>('North')
  // which plot dimension faces the road: chosen by the user, never guessed ('' = not chosen yet)
  const [frontageSide, setFrontageSide] = useState<'' | 'width' | 'length'>('')
  const [terrace, setTerrace] = useState<boolean>(false)
  const [conflict, setConflict] = useState<PlanConflictError | null>(null)
  const [proposals, setProposals] = useState<AdjustmentProposals | null>(null)
  const [approved, setApproved] = useState<string[]>([])
  const [proposing, setProposing] = useState<boolean>(false)
  const [location, setLocation] = useState<string>('Kolhapur, Maharashtra')
  const [automaticSetbacks, setAutomaticSetbacks] = useState<boolean>(true)
  const [frontSetback, setFrontSetback] = useState<number>(5)
  const [rearSetback, setRearSetback] = useState<number>(3)
  const [leftSetback, setLeftSetback] = useState<number>(3)
  const [rightSetback, setRightSetback] = useState<number>(3)

  const [houseType, setHouseType] = useState<HouseType>('3 BHK')
  const [buildingType, setBuildingType] = useState<BuildingType>('Ground')
  const [bedrooms, setBedrooms] = useState<number>(3)
  const [bathrooms, setBathrooms] = useState<number>(3)
  const [parking, setParking] = useState<ParkingType>('No Parking')
  const [allowAdjust, setAllowAdjust] = useState(false)
  const [perFloor, setPerFloor] = useState(false)
  const [floorCounts, setFloorCounts] = useState<FloorCounts>(defaultFloorCounts(2))
  const [commonToilet, setCommonToilet] = useState<'attached' | 'separate'>('attached')
  const [living, setLiving] = useState<boolean>(true)
  const [dining, setDining] = useState<boolean>(true)
  const [kitchen, setKitchen] = useState<boolean>(true)
  const [utility, setUtility] = useState<boolean>(true)
  const [puja, setPuja] = useState<boolean>(true)
  const [guest, setGuest] = useState<boolean>(false)
  const [kitchenType, setKitchenType] = useState<KitchenType>('Open')

  const [familySize, setFamilySize] = useState<number>(4)
  const [adults, setAdults] = useState<number>(2)
  const [children, setChildren] = useState<number>(1)
  const [elderly, setElderly] = useState<number>(0)
  const [frequentGuests, setFrequentGuests] = useState<boolean>(false)
  const [lifestyle, setLifestyle] = useState<Lifestyle>('Small family')

  const [vastuLabel, setVastuLabel] = useState<VastuMode>('No Preference')
  const [style, setStyle] = useState<ArchitecturalStyle>(() => loadPrefs().style)
  const [climate, setClimate] = useState<Climate>('Auto')
  const [lightPref, setLightPref] = useState<LightPref>('Balanced')
  const [ventilationPref, setVentilationPref] = useState<VentilationPref>('Balanced')
  const [pujaStyle, setPujaStyle] = useState<'closed' | 'open'>('closed')

  const defaultCourtyard = defaultCourtyardFor(style)
  const [courtyard, setCourtyard] = useState<boolean>(defaultCourtyard)
  const [garden, setGarden] = useState<boolean>(true)
  const [balcony, setBalcony] = useState<boolean>(buildingType !== 'Ground')
  // going from a Ground-only house to a multi-storey one turns the upper-floor balcony on again
  const prevBuilding = useRef<BuildingType>(buildingType)
  const keepBalcony = useRef<boolean>(false)
  useEffect(() => {
    if (prevBuilding.current === 'Ground' && buildingType !== 'Ground' && !keepBalcony.current) setBalcony(true)
    prevBuilding.current = buildingType
    keepBalcony.current = false
  }, [buildingType])
  const [floorHeight, setFloorHeight] = useState<number>(10)
  const [stairWidth, setStairWidth] = useState<number>(3.5)

  const [isGenerating, setIsGenerating] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResponse | null>(null)
  const [feas, setFeas] = useState<FeasibilityReport | null>(null)
  const [briefText, setBriefText] = useState<string>('')
  const [briefMsg, setBriefMsg] = useState<string | null>(null)
  const [briefBusy, setBriefBusy] = useState<boolean>(false)

  const factor = unit === 'Meters' ? 3.28084 : 1
  const wFt = plotWidth * factor
  const lFt = plotLength * factor
  const { fsFt, rsFt, lsFt, rgsFt } = useMemo(() => {
    if (automaticSetbacks) {
      return unit === 'Meters'
        ? { fsFt: 1.5 * factor, rsFt: 1.0 * factor, lsFt: 1.0 * factor, rgsFt: 1.0 * factor }
        : { fsFt: 5.0, rsFt: 3.0, lsFt: 3.0, rgsFt: 3.0 }
    }
    return {
      fsFt: frontSetback * factor,
      rsFt: rearSetback * factor,
      lsFt: leftSetback * factor,
      rgsFt: rightSetback * factor,
    }
  }, [automaticSetbacks, unit, factor, frontSetback, rearSetback, leftSetback, rightSetback])

  const plotArea = wFt * lFt
  // the frontage (the plot side on the road) loses the left + right setbacks, the depth loses the front + rear ones - whichever of width / length that is
  const frontageFt = frontageSide === 'length' ? lFt : wFt
  const depthFt = frontageSide === 'length' ? wFt : lFt
  const usableW = frontageFt - lsFt - rgsFt
  const usableL = depthFt - fsFt - rsFt
  const usableArea = Math.max(0, usableW * usableL)

  const flat = perFloor && floorCount(buildingType) > 1 ? flattenFloorCounts(floorCounts) : null
  const rooms = flat ? flat.rooms : buildRooms({
    living,
    dining,
    kitchen,
    utility,
    bedrooms,
    bathrooms,
    puja,
    guest,
    frequentGuests,
    kitchenType,
  })

  useEffect(() => {
    if (rooms.length === 0) {
      setFeas(null)
      return
    }
    const t = setTimeout(() => {
      checkFeasibility(buildPayload())
        .then(setFeas)
        .catch(() => setFeas(null))
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wFt, lFt, roadSide, fsFt, rsFt, lsFt, rgsFt, buildingType, bedrooms, bathrooms, parking, living,
      dining, kitchen, utility, puja, guest, kitchenType, balcony, vastuLabel, perFloor, floorCounts])

  const applyBrief = async () => {
    if (!briefText.trim()) return
    setBriefBusy(true)
    setBriefMsg(null)
    try {
      const r = await parseBrief(briefText)
      const f = r.fields as Record<string, string | number | boolean>
      if (f.unit) setUnit(f.unit as Unit)
      if (typeof f.plot_width === 'number') setPlotWidth(f.plot_width)
      if (typeof f.plot_length === 'number') setPlotLength(f.plot_length)
      if (f.road_side) setRoadSide(f.road_side as RoadSide)
      if (f.house_type) setHouseType(f.house_type as HouseType)
      if (typeof f.bedrooms === 'number') setBedrooms(f.bedrooms)
      if (typeof f.bathrooms === 'number') setBathrooms(f.bathrooms)
      if (typeof f.balcony === 'boolean') keepBalcony.current = true
      if (f.building_type) {
        setBuildingType(f.building_type as BuildingType)
        if (f.building_type !== 'Ground') setBalcony(true)
      }
      if (f.parking) setParking(f.parking as ParkingType)
      if (f.vastu_mode) setVastuLabel(f.vastu_mode as VastuMode)
      if (typeof f.puja === 'boolean') setPuja(f.puja)
      if (typeof f.utility === 'boolean') setUtility(f.utility)
      if (typeof f.dining === 'boolean') setDining(f.dining)
      if (typeof f.guest === 'boolean') setGuest(f.guest)
      if (typeof f.balcony === 'boolean') setBalcony(f.balcony)
      if (typeof f.garden === 'boolean') setGarden(f.garden)
      if (f.kitchen_type) setKitchenType(f.kitchen_type as KitchenType)
      const got = r.understood.length ? `Understood: ${r.understood.join(', ')}.` : ''
      setBriefMsg([got, ...r.notes].filter(Boolean).join(' ') + (got ? ' Check the sidebar, then press Generate.' : ''))
    } catch (e: unknown) {
      setBriefMsg(e instanceof Error ? e.message : 'Could not read the brief.')
    } finally {
      setBriefBusy(false)
    }
  }

  const buildPayload = () => {
    const parkingRequired = parking !== 'No Parking'
    const parkingSpaces = parking === 'No Parking' ? 0 : parking === '2 Cars' ? 2 : 1
    const vastuMode = { 'No Preference': 'no_preference', Basic: 'basic', Strict: 'strict' }[vastuLabel]

    const familyContext: FamilyContext = {
      family_size: familySize,
      adults,
      children,
      elderly,
      frequent_guests: frequentGuests,
      lifestyle,
    }

    const payload = {
      plot_width: wFt,
      plot_length: lFt,
      frontage_ft: frontageSide === 'width' ? wFt : frontageSide === 'length' ? lFt : undefined,
      road_side: roadSide,
      setbacks: {
        front: fsFt,
        rear: rsFt,
        left: lsFt,
        right: rgsFt,
      },
      rooms,
      building_type: buildingType,
      number_of_plans: 4,
      include_terrace: terrace,
      parking_required: parkingRequired,
      parking_spaces: parkingSpaces,
      parking_type: parking,
      floor_height: floorHeight,
      stair_width: stairWidth,
      vastu_mode: vastuMode,
      architectural_style: style,
      family_context: familyContext,
      climate,
      balcony_required: buildingType !== 'Ground' ? balcony : false,
      garden_required: garden,
      common_toilet: commonToilet,
      floor_rooms: flat ? flat.floorRooms : undefined,
      strict: !allowAdjust,
      ventilation: ventilationPref,
      puja_style: pujaStyle,
    }
    return payload
  }

  const lastRequest = useRef<Record<string, unknown>>({})
  const saveConcept = async (plan: Plan, design?: Design): Promise<string> => {
    const st = design ? STYLES[design.style].label : plan.architectural_style
    const name = `${st} ${buildingType === 'Ground' ? 'home' : buildingType} ${Math.round(wFt)} x ${Math.round(lFt)} ft (concept ${plan.plan_number})`
    const saved = await createProject({ name, kind: 'generated', style: st, data: { plan: { ...plan, architectural_style: st }, request: lastRequest.current, design } })
    return `Saved as “${saved.name}”. Open it from your dashboard.`
  }

  /** "Let the planner adjust my brief": ask the backend which preference changes would work, and show them for approval.  Nothing is applied here. */
  const handleProposeAdjustments = async () => {
    setError(null)
    setProposing(true)
    try {
      const data = await proposeAdjustments({ ...buildPayload(), strict: true })
      setProposals(data)
      setApproved([])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not work out adjustments.')
    } finally {
      setProposing(false)
    }
  }

  const handleGenerate = async (forceAdjust: boolean = false, closest: boolean = false, approvedIds: string[] = []) => {
    setError(null)
    setSuccess(null)
    setConflict(null)
    setProposals(null)

    if (frontageSide === '') {
      setError('Choose which plot side faces the road (Site & Plot → Frontage) before generating.')
      return
    }

    if (rooms.length === 0) {
      setError('Select at least one room to generate plans.')
      return
    }

    const payload: GenerateRequestPayload = { ...buildPayload(), closest_if_infeasible: closest, approved_adjustments: approvedIds.length ? approvedIds : undefined }
    if (forceAdjust === true) { payload.strict = false; setAllowAdjust(true) }

    setIsGenerating(true)
    try {
      const data = await generatePlans(payload)
      lastRequest.current = payload as unknown as Record<string, unknown>
      setResult(data)
      setSuccess(data.status === 'closest_alternative'
        ? `Not your exact brief: ${data.total_plans} closest alternatives. Every difference is listed below.`
        : data.outcome === 'mandatory_only'
          ? `Generated ${data.total_plans} concepts with the changes you approved. Every change is listed below.`
          : `Generated ${data.total_plans} architectural concepts.`)
    } catch (err: unknown) {
      if (err instanceof PlanConflictError) {
        setConflict(err)
        setResult(null)
        return
      }
      const msg = err instanceof Error ? err.message : 'Plan generation failed.'
      setError(msg)
      setResult(null)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="app">
      <Sidebar
        unit={unit}
        setUnit={setUnit}
        plotWidth={plotWidth}
        setPlotWidth={setPlotWidth}
        plotLength={plotLength}
        setPlotLength={setPlotLength}
        roadSide={roadSide}
        setRoadSide={setRoadSide}
        frontageSide={frontageSide}
        setFrontageSide={setFrontageSide}
        terrace={terrace}
        setTerrace={setTerrace}
        location={location}
        setLocation={setLocation}
        automaticSetbacks={automaticSetbacks}
        setAutomaticSetbacks={setAutomaticSetbacks}
        frontSetback={frontSetback}
        setFrontSetback={setFrontSetback}
        rearSetback={rearSetback}
        setRearSetback={setRearSetback}
        leftSetback={leftSetback}
        setLeftSetback={setLeftSetback}
        rightSetback={rightSetback}
        setRightSetback={setRightSetback}
        houseType={houseType}
        setHouseType={setHouseType}
        buildingType={buildingType}
        setBuildingType={setBuildingType}
        bedrooms={bedrooms}
        setBedrooms={setBedrooms}
        bathrooms={bathrooms}
        setBathrooms={setBathrooms}
        parking={parking}
        setParking={setParking}
        commonToilet={commonToilet}
        allowAdjust={allowAdjust}
        setAllowAdjust={setAllowAdjust}
        perFloor={perFloor}
        setPerFloor={setPerFloor}
        floorCounts={floorCounts}
        setFloorCounts={setFloorCounts}
        setCommonToilet={setCommonToilet}
        living={living}
        setLiving={setLiving}
        dining={dining}
        setDining={setDining}
        kitchen={kitchen}
        setKitchen={setKitchen}
        utility={utility}
        setUtility={setUtility}
        puja={puja}
        setPuja={setPuja}
        guest={guest}
        setGuest={setGuest}
        kitchenType={kitchenType}
        setKitchenType={setKitchenType}
        familySize={familySize}
        setFamilySize={setFamilySize}
        adults={adults}
        setAdults={setAdults}
        children={children}
        setChildren={setChildren}
        elderly={elderly}
        setElderly={setElderly}
        frequentGuests={frequentGuests}
        setFrequentGuests={setFrequentGuests}
        lifestyle={lifestyle}
        setLifestyle={setLifestyle}
        vastuLabel={vastuLabel}
        setVastuLabel={setVastuLabel}
        style={style}
        setStyle={(s) => {
          setStyle(s)
          setCourtyard(defaultCourtyardFor(s))
        }}
        climate={climate}
        setClimate={setClimate}
        lightPref={lightPref}
        setLightPref={setLightPref}
        ventilationPref={ventilationPref}
        setVentilationPref={setVentilationPref}
        pujaStyle={pujaStyle}
        setPujaStyle={setPujaStyle}
        courtyard={courtyard}
        setCourtyard={setCourtyard}
        garden={garden}
        setGarden={setGarden}
        balcony={balcony}
        setBalcony={setBalcony}
        floorHeight={floorHeight}
        setFloorHeight={setFloorHeight}
        stairWidth={stairWidth}
        setStairWidth={setStairWidth}
        isGenerating={isGenerating}
        onGenerate={() => handleGenerate()}
      />

      <main className="main-content">
        <div className="hero">
          <h1>🏠 AI Real Estate Architect</h1>
          <p>
            Architectural decision-making system for functional, Vastu-aware and explainable house
            planning.
          </p>
        </div>


        <div
          style={{
            margin: '0 0 16px', padding: 14, borderRadius: 12, background: '#fffaf1',
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6, color: '#2b1d16' }}>✍️ Describe your house</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={briefText}
              onChange={(e) => setBriefText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyBrief()}
              placeholder="e.g. 3BHK on a 30x40 ft plot, south road, G+1, one car parking, basic vastu, puja room"
              style={{ flex: 1, minWidth: 260, padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14 }}
            />
            <button
              onClick={applyBrief}
              disabled={briefBusy || !briefText.trim()}
              style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#a94a26', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
            >
              {briefBusy ? 'Reading…' : 'Fill the form'}
            </button>
          </div>
          {briefMsg && <div style={{ marginTop: 8, fontSize: 13, color: '#334155' }}>{briefMsg}</div>}
        </div>

        {error && (
          <div className="alert alert-error">
            {error}
          </div>
        )}
        {conflict && (
          <section role="alert" data-testid="conflict-report" data-verdict={conflict.verdict} data-outcome={conflict.outcome} className="alert alert-error" style={{ lineHeight: 1.5 }}>
            <strong>
              {conflict.verdict === 'infeasible'
                ? (conflict.outcome === 'needs_approval'
                  ? 'Your exact brief does not fit because of a preference you set.'
                  : 'Your exact brief cannot be planned on this plot.')
                : 'No valid arrangement was found within the search performed (this is not proof that your brief is impossible).'}
            </strong>
            <ul style={{ margin: '6px 0 0 18px' }}>
              {conflict.conflicts.length === 0 && <li>{conflict.message}</li>}
              {conflict.conflicts.map((c, i) => (
                <li key={i}>{c.message}</li>
              ))}
            </ul>
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Nothing was removed, added or relaxed behind your back: the floor count ({buildingType}), every room count, the parking and the terrace choice are exactly as you set them.
            </div>
            {conflict.diagnostic && (
              <details data-testid="diagnostic" style={{ marginTop: 8, fontSize: 13 }}>
                <summary>Why: the numbers behind this</summary>
                <p style={{ margin: '6px 0' }}>{conflict.diagnostic.summary}</p>
                <ul style={{ margin: '0 0 0 18px' }}>
                  <li>
                    Plot frontage {conflict.diagnostic.geometry.frontage_ft} ft on the {conflict.diagnostic.geometry.road_side} road, depth {conflict.diagnostic.geometry.depth_ft} ft; after the setbacks
                    {' '}{conflict.diagnostic.geometry.usable_frontage_ft} × {conflict.diagnostic.geometry.usable_depth_ft} ft = {conflict.diagnostic.geometry.usable_area_sqft} sq ft
                    {conflict.diagnostic.geometry.garden_strip_depth_ft ? `, minus an ${conflict.diagnostic.geometry.garden_strip_depth_ft} ft garden strip` : ''}.
                  </li>
                  <li>
                    Ground-floor footprint available: {conflict.diagnostic.geometry.ground_footprint_capacity_sqft} sq ft (shared by all {conflict.diagnostic.geometry.floors} floors; their areas are not added to it).
                  </li>
                  {conflict.diagnostic.floors.map((f) => (
                    <li key={f.floor}>
                      {f.floor}: {f.rooms} rooms need at least {f.min_area_needed} sq ft (about {f.practical_area_needed} with passage, {f.comfortable_area_needed} comfortable) of {f.buildable_area} sq ft: {f.status.replace('_', ' ')}.
                    </li>
                  ))}
                  {conflict.diagnostic.parking && (
                    <li>
                      Parking: {conflict.diagnostic.parking.cars} car(s), bay {conflict.diagnostic.parking.bay_ft[0]} × {conflict.diagnostic.parking.bay_ft[1]} ft (never reduced), porch {conflict.diagnostic.parking.porch_width_ft} ft wide:
                      {' '}{conflict.diagnostic.parking.fits_depth && conflict.diagnostic.parking.fits_frontage ? 'fits the plot' : 'does not fit the plot'}.
                    </li>
                  )}
                  {conflict.diagnostic.attempts.count > 0 && (
                    <li>Search: {conflict.diagnostic.attempts.count} attempts ({conflict.diagnostic.attempts.strategies?.join('; ')}).</li>
                  )}
                </ul>
              </details>
            )}
            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {conflict.closestAvailable && (
                <button type="button" className="btn" onClick={() => handleGenerate(false, true)} disabled={isGenerating || proposing}>
                  Show the closest valid alternative (every difference is listed)
                </button>
              )}
              <button type="button" className="btn" data-testid="adjust-brief" onClick={handleProposeAdjustments} disabled={isGenerating || proposing}>
                {proposing ? 'Working out adjustments…' : 'Let the planner adjust my brief (you approve each change)'}
              </button>
            </div>
            {proposals && (
              <div data-testid="adjustment-proposals" style={{ marginTop: 10, padding: 10, background: '#fffdf8', border: '1px solid #e7d9c4', borderRadius: 8, color: '#2b1d16' }}>
                <strong>Proposed adjustments</strong>
                <div style={{ fontSize: 13, margin: '4px 0 6px' }}>{proposals.note}</div>
                {proposals.proposals.length === 0 && <div style={{ fontSize: 13 }}>No preference of yours can be traded here; the brief itself would have to change (see below).</div>}
                {proposals.proposals.map((p) => (
                  <label key={p.id} style={{ display: 'block', margin: '6px 0', fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={approved.includes(p.id)}
                      disabled={p.verified === false}
                      onChange={(e) => setApproved((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
                    />{' '}
                    <strong>{p.label}</strong>
                    {p.verified === true && <span style={{ color: '#166534' }}> — with this change a valid plan was found</span>}
                    {p.verified === false && <span style={{ color: '#991b1b' }}> — on its own this still did not give a plan</span>}
                    <div style={{ fontSize: 13, marginLeft: 22 }}>Why: {p.reason}</div>
                  </label>
                ))}
                {proposals.recommended.length > 0 && (
                  <button type="button" className="btn" style={{ marginRight: 8 }} onClick={() => setApproved(proposals.recommended)}>
                    Tick the changes that worked together
                  </button>
                )}
                <button type="button" className="btn" data-testid="apply-adjustments" disabled={approved.length === 0 || isGenerating}
                  onClick={() => handleGenerate(false, false, approved)}>
                  Apply the {approved.length} approved change{approved.length === 1 ? '' : 's'} and plan
                </button>
                {proposals.mandatory_decisions.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <strong>Changes to the brief itself (only you can decide these; they are never applied by the boxes above):</strong>
                    <ul style={{ margin: '4px 0 0 18px' }}>
                      {proposals.mandatory_decisions.map((d, i) => <li key={i}>{d.label}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        {success && <div className="alert alert-success">{success}</div>}
        {result?.deviations && result.deviations.length > 0 && (
          <section data-testid="deviations" className="alert alert-info" style={{ lineHeight: 1.5 }}>
            <strong>{result.outcome === 'closest_alternative' ? 'How these plans differ from your exact brief:' : 'What differs from your original brief:'}</strong>
            <ul style={{ margin: '4px 0 0 18px' }}>
              {result.deviations.map((d, i) => (
                <li key={i}>
                  {d.label}
                  {d.kind === 'not_provided' && ` (asked ${String(d.requested)}, planned ${String(d.delivered)})`}
                  {d.kind === 'approved_change' && d.reason ? ` - ${d.reason}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}
        {courtyard && (
          <div className="alert alert-info">
            🌿 Courtyard preference noted. The planner keeps open zones on the plot, but a central courtyard room is only
            present in a plan that has one (for example an uploaded plan); it is never added by moving rooms without your approval.
          </div>
        )}

        <section>
          <h3 style={{ marginBottom: '0.75rem', color: '#2b1d16' }}>📊 Project Snapshot</h3>
          <div className="snapshot-grid">
            <div className="snapshot-item">
              <div className="label">Plot</div>
              <div className="value">
                {wFt.toFixed(0)} × {lFt.toFixed(0)} ft
              </div>
            </div>
            <div className="snapshot-item">
              <div className="label">Plot Area</div>
              <div className="value">{plotArea.toFixed(0)} sq.ft</div>
            </div>
            <div className="snapshot-item">
              <div className="label">Usable Area</div>
              <div className="value">{usableArea.toFixed(0)} sq.ft</div>
            </div>
            <div className="snapshot-item">
              <div className="label">House</div>
              <div className="value">{houseType}</div>
            </div>
            <div className="snapshot-item">
              <div className="label">Road · Frontage</div>
              <div className="value">{roadSide} · {frontageSide === 'width' ? `${wFt.toFixed(0)} ft` : frontageSide === 'length' ? `${lFt.toFixed(0)} ft` : 'not chosen'}</div>
            </div>
          </div>

          <div className="subheader-caption">
            📍 {location} &nbsp;•&nbsp; 🧭 {vastuLabel} &nbsp;•&nbsp; 🏛️ {style} &nbsp;•&nbsp; 🌦️{' '}
            {climate} &nbsp;•&nbsp; Family: {familySize}
          </div>
        </section>

        {feas && feas.status !== 'ok' && (
          <div
            role="status"
            style={{
              margin: '12px 0',
              padding: '10px 14px',
              borderRadius: 10,
              fontSize: 14,
              lineHeight: 1.5,
              background: feas.status === 'infeasible' ? '#fef2f2' : '#fffbeb',
              border: `1px solid ${feas.status === 'infeasible' ? '#ef4444' : '#f59e0b'}`,
              color: feas.status === 'infeasible' ? '#7f1d1d' : '#78350f',
            }}
          >
            <strong>
              {feas.status === 'infeasible'
                ? 'This brief will not fit as asked — plans will be adjusted automatically.'
                : 'Tight plot — expect compact rooms.'}
            </strong>
            <ul style={{ margin: '6px 0 0 18px' }}>
              {[...(feas.errors ?? []), ...(feas.warnings ?? [])].slice(0, 3).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
              {(feas.suggestions ?? []).slice(0, 2).map((x, i) => (
                <li key={'s' + i}>Try: {x.change}</li>
              ))}
            </ul>
          </div>
        )}
        {result && result.compliance && <ComplianceReport report={result.compliance} search={result.search} ledger={result.plans[0]?.ledger} status={result.status} />}
        {result && !result.compliance && result.relaxation && !result.relaxation.exact && (
          <div role="status" style={{ margin: '12px 0', padding: '12px 16px', borderRadius: 10, background: '#fffbeb', border: '1px solid #f59e0b', color: '#78350f', fontSize: 14, lineHeight: 1.5 }}>
            <strong>Your exact brief did not fit this plot, so these plans were adjusted:</strong>
            <ul style={{ margin: '6px 0 0 18px' }}>
              {result.relaxation.adjustments.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {result && result.plans && <PlanResults plans={result.plans} brief={briefText} onSave={saveConcept} />}
      </main>
    </div>
  )
}
