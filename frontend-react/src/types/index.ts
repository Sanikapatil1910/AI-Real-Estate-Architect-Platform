export type Unit = 'Feet' | 'Meters'
export type RoadSide = 'North' | 'South' | 'East' | 'West'
export type HouseType = '1 BHK' | '2 BHK' | '3 BHK' | '4 BHK' | 'Custom'
export type BuildingType = 'Ground' | 'G+1' | 'G+2' | 'Duplex' | 'Villa'
export type ParkingType = 'No Parking' | '1 Car' | '2 Cars' | 'Bikes' | 'Car + Bikes'
export type KitchenType = 'Open' | 'Closed' | 'Modular' | 'Traditional'
export type VastuMode = 'No Preference' | 'Basic' | 'Strict'
export type ArchitecturalStyle = 'Modern Minimalistic' | 'Traditional Indian' | 'Maharashtrian Wada'
export type Climate =
  | 'Auto'
  | 'Hot & Dry'
  | 'Warm & Humid'
  | 'Moderate'
  | 'Cold / Hilly'
  | 'Heavy Rainfall'
export type LightPref = 'Balanced' | 'High' | 'Maximum'
export type VentilationPref = 'Balanced' | 'High' | 'Cross ventilation'
export type Lifestyle =
  | 'Small family'
  | 'Joint family'
  | 'Working professionals'
  | 'Large family'
  | 'Frequent guests'

export interface Setbacks {
  front: number
  rear: number
  left: number
  right: number
}

export interface FamilyContext {
  family_size?: number
  adults?: number
  children?: number
  elderly?: number
  frequent_guests?: boolean
  lifestyle?: Lifestyle
}

export interface RoomRequest {
  room_type: string
}

export interface GenerateRequestPayload {
  plot_width: number
  plot_length: number
  frontage_ft?: number
  closest_if_infeasible?: boolean
  /** Ids of the preference changes the user approved (from POST /adjustments).  Nothing else is ever changed. */
  approved_adjustments?: string[]
  chajja_projection_ft?: number
  /** Flat-roof slab overhang beyond the wall (ft, 0.5 - 3, default 1.5); clamped by the plot margin. */
  roof_overhang_ft?: number
  /** How far an upper-floor balcony may cantilever beyond the enclosed floor (ft, 0 - 4, default 3); clamped by the setback margin. */
  balcony_projection_ft?: number
  chajja_thickness_ft?: number
  road_side: RoadSide
  setbacks: Setbacks
  rooms: RoomRequest[]
  building_type: BuildingType
  number_of_plans: number
  include_terrace: boolean
  parking_required: boolean
  parking_spaces: number
  parking_type?: string
  floor_height: number
  stair_width: number
  common_toilet?: string
  floor_rooms?: string[][]
  strict?: boolean
  ventilation?: string
  puja_style?: string
  vastu_mode: string
  architectural_style: ArchitecturalStyle
  family_context?: FamilyContext
  climate: Climate
  balcony_required: boolean
  garden_required: boolean
  terrace_features?: unknown
}

export interface Room {
  room_type: string
  width: number
  length: number
  area: number
  x: number
  y: number
  x2?: number
  y2?: number
  staircase_role?: 'ground' | 'arrival' | 'upper' | string
}

export interface Door {
  room?: string
  room_a?: string
  wall?: 'top' | 'bottom' | 'left' | 'right' | string
  wall_a?: string
  position: number
  width: number
  door_type?: 'main' | 'bedroom' | 'bathroom' | 'utility' | 'puja_room' | 'internal' | string
  [key: string]: unknown
}

/** The sun-shade slab over a window: same wall, `width` already includes the side overhang on both jambs. */
export interface Chajja {
  wall: string
  room: string
  position: number
  width: number
  projection: number
  thickness: number
  overhang: number
}

export interface Window {
  room: string
  wall: 'top' | 'bottom' | 'left' | 'right' | string
  position: number
  width: number
  chajja?: Chajja
  [key: string]: unknown
}

export interface OpenSpaces {
  regions?: Array<{
    type?: string
    x: number
    y: number
    width: number
    length: number
    [key: string]: unknown
  }>
  [key: string]: unknown
}

export interface FeatureRegion {
  exists?: boolean
  x: number
  y: number
  width: number
  length: number
  [key: string]: unknown
}

export interface TerraceFeature {
  exists?: boolean
  x: number
  y: number
  width: number
  length: number
  solar_panels?: FeatureRegion
  garden?: FeatureRegion
  [key: string]: unknown
}

/** One marked car bay (ft, real coordinates): the vehicle plus its door clearance, inside the ground-floor car porch. */
export interface ParkingBay {
  index: number
  x: number
  y: number
  width: number
  length: number
}

export interface ReservedRegion {
  x: number
  y: number
  width: number
  length: number
  bays?: ParkingBay[]
  [key: string]: unknown
}

export interface Layout {
  rooms: Room[]
  /** the open flat roof of the floor below where an upper floor is smaller than the footprint: not a room, no access */
  roof_areas?: RoofArea[]
  plot?: Plot
  usable_plot?: Plot & {
    reserved_regions?: ReservedRegion[]
    [key: string]: unknown
  }
  road_side?: RoadSide
  used_room_area?: number
  remaining_area?: number
  openings?: {
    doors?: Door[]
    windows?: Window[]
  }
  open_spaces?: OpenSpaces
  balcony?: FeatureRegion
  garden?: FeatureRegion
  terrace?: TerraceFeature
  [key: string]: unknown
}

export interface Plot {
  width: number
  length: number
  area?: number
  x?: number
  y?: number
}

export interface Floor {
  floor: string
  layout: Layout
}

export interface ValidationItem {
  floor: string
  validation: {
    valid: boolean
    overall_score: number
    scores: {
      functional: number
      vastu: number
      [key: string]: number
    }
    errors: string[]
    warnings: string[]
  }
}

export interface RoofArea { id: string; name: string; x: number; y: number; x2: number; y2: number; width: number; length: number; area: number; over?: string | null }

export interface PlanSite { frontage: number; depth: number; road_side: string; frontage_selected: boolean; entered_plot: number[]; plot_width: number; plot_length: number }

export interface LedgerViolation { code: string; message: string; floor?: string | null; hard: boolean }

export interface Ledger {
  fingerprint: string
  ok: boolean
  floors: { required: number; actual: number; met: boolean }
  totals: { type: string; label: string; required: number; actual: number; met: boolean }[]
  per_floor: { floor: string; index: number; required: Record<string, number> | null; actual: Record<string, number>; met: boolean }[]
  violations: LedgerViolation[]
}

export interface Plan {
  plan_number: number
  site?: PlanSite
  ledger?: Ledger
  chajja_spec?: { projection: number; thickness: number; overhang: number }
  topology: string
  strategy: string
  vastu_mode: string
  architectural_style: string
  road_side?: RoadSide
  floors: Floor[]
  validation?: ValidationItem[]
  explanation?: string[]
  energy?: Record<
    string,
    {
      climate?: string
      score: number
      light_score: number
      ventilation_score: number
      recommendations: string[]
    }
  >
  cost?: {
    estimated_total_cost: number
    note: string
  }
}

export interface ComplianceItem {
  key: string
  label: string
  tier: number
  requested: string | number | boolean
  delivered: string | number | boolean
  met: boolean
  detail: string
  weight: number
}

export interface ComplianceReport {
  mode: 'strict' | 'flexible'
  exact: boolean
  satisfied: number
  total: number
  score: number
  items: ComplianceItem[]
  unmet: { key: string; label: string; requested: string | number | boolean; delivered: string | number | boolean; reason: string }[]
  adjustments: string[]
  compromises: string[]
  setbacks_respected: boolean
}

export type PlanOutcome = 'exact' | 'mandatory_only' | 'needs_approval' | 'infeasible' | 'inconclusive' | 'closest_alternative'

export interface PlanDeviation {
  kind: 'approved_change' | 'not_provided' | 'compromise'
  label: string
  requested?: string | number | boolean
  delivered?: string | number | boolean
  from?: unknown
  to?: unknown
  reason?: string
}

export interface BriefDiagnostic {
  verdict: string
  outcome: PlanOutcome | string
  summary: string
  geometry: {
    frontage_ft: number; depth_ft: number; road_side: string
    usable_frontage_ft: number; usable_depth_ft: number; usable_area_sqft: number
    garden_strip_depth_ft: number; buildable_frontage_ft: number; buildable_depth_ft: number
    ground_footprint_capacity_sqft: number; floors: number; stacked_floor_area_capacity_sqft: number
    notes: string[]
  }
  floors: { floor: string; rooms: number; min_area_needed: number; practical_area_needed: number; comfortable_area_needed: number; buildable_area: number; status: string }[]
  parking: null | { cars: number; bikes: number; bay_ft: number[]; porch_width_ft: number; min_depth_ft: number; fits_depth: boolean; fits_frontage: boolean; position: string }
  failed_mandatory: { constraint: string; detail: string }[]
  blocked_by_preferences: string[]
  adjustable_preferences: { id: string; label: string; reason: string; current: unknown }[]
  mandatory: string[]
  attempts: { count: number; seconds?: number; strategies?: string[]; log: { strategy: string; compact: number; seed: number; outcome: string; seconds: number }[] }
}

export interface AdjustmentProposal {
  id: string; kind: 'preference'; label: string; reason: string; field: string; from: unknown; to: unknown
  static_status: string; verified: boolean | null
}

export interface AdjustmentProposals {
  status: 'preference_change_works' | 'no_preference_change_found' | 'no_adjustable_preference'
  recommended: string[]
  proposals: AdjustmentProposal[]
  mandatory_decisions: { kind: 'mandatory_change'; label: string; needs_explicit_decision: boolean }[]
  note: string
  elapsed_s: number
}

export interface GenerateResponse {
  status?: 'ok' | 'adjusted' | 'closest_alternative'
  outcome?: PlanOutcome
  exact?: boolean
  deviations?: PlanDeviation[]
  diagnostic?: BriefDiagnostic
  approved_adjustments?: { id: string; label: string; reason: string; from: unknown; to: unknown }[]
  total_plans: number
  plans: Plan[]
  success?: boolean
  warnings?: string[]
  compliance?: ComplianceReport
  search?: {
    elapsed_s?: number
    total_elapsed_s?: number
    candidates?: number
    best_effort?: boolean
    programmes_tried?: number
    algorithm?: string
  }
  relaxation?: {
    level: number
    exact: boolean
    adjustments: string[]
    compromises?: string[]
    unmet?: { key: string; label: string; requested: string | number | boolean; delivered: string | number | boolean; reason: string }[]
    mode?: string
  }
}
