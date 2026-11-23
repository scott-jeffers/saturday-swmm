import type { FeatureCollection } from 'geojson'
import { readStoredProjectPath } from '../lib/projectSession'

export type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface SystemHealthOpenswmm {
  installed: boolean
  version: string | null
  import_ok: boolean
  error: string | null
}

export interface SystemHealthGis {
  rasterio: boolean
  pyogrio: boolean
  shapely: boolean
  pyproj: boolean
  pillow: boolean
  geopandas: boolean
}

export interface SystemHealth {
  status: 'ok' | 'degraded'
  app_version: string
  distribution?: 'portable' | 'source'
  python_version: string
  openswmm: SystemHealthOpenswmm
  pyswmm?: { installed: boolean; version: string | null; swmm_version: string | null; error: string | null }
  gis: SystemHealthGis
}

export interface EngineStatus {
  package: string
  installed_version: string | null
  import_ok: boolean
  import_error?: string | null
  current: string | null
  previous: string | null
  last_ok: string | null
  updated_at: string | null
  can_rollback: boolean
  restart_required_hint?: string
  latest?: string | null
  versions?: string[]
  update_available?: boolean
  checked_at?: string
  changed?: boolean
  message?: string
  restart_required?: boolean
}

export type SimulationEngine = 'openswmm' | 'pyswmm' | 'flow_accum'
export type SimulationEngineChoice = SimulationEngine | 'auto'

/** Display names for each engine (header badge, run toasts, settings). */
export const ENGINE_LABELS: Record<SimulationEngine, string> = {
  openswmm: 'OpenSWMM 6',
  pyswmm: 'EPA SWMM 5.2',
  flow_accum: 'Flow accumulation',
}

export interface EngineInfo {
  id: SimulationEngine
  label: string
  description: string
  available: boolean
  version: string | null
  error: string | null
  note?: string | null
}

export interface AppInfo {
  name: string
  version: string
  distribution: 'portable' | 'source'
  releases_url: string
  /** True when started by the launcher (portable build): show a Quit button. */
  can_quit?: boolean
  engines: EngineInfo[]
}

export interface Scenario {
  id: string
  name: string
  parent: string | null
  inp: string
  created: string
  description: string
  exists: boolean
  has_results: boolean
  children: string[]
  /** Frozen: can't be edited, and waits for its parent's changes until unlocked. */
  locked?: boolean
  /** How many fields or objects differ from its parent. */
  changes?: number
  /** Places where the parent changed a value this scenario also changed. */
  flags?: number
  /** Changes in the parent not taken yet (while locked). */
  behind?: number
  results_stale?: boolean
}

/** One of a scenario's own changes from its parent: a field, or a whole object. */
export interface InheritedChange {
  section: string
  id: string
  object: 'node' | 'link' | 'subcatchment' | null
  change: 'added' | 'removed' | 'modified'
  field: number | null
  key?: string
  label?: string
  parent?: string | string[] | null
  value?: string | string[] | null
}

/** The parent changed a value this scenario has its own value for (or removed an object it changed). */
export interface InheritFlag {
  section: string
  id: string
  field: number | null
  key?: string
  label: string
  kind: 'parent_changed' | 'removed_in_parent'
  parent_old?: string | null
  parent_new?: string | null
  mine?: string | null
}

export interface Inheritance {
  id: string
  parent: string | null
  parent_name: string | null
  locked: boolean
  changes: InheritedChange[]
  flags: InheritFlag[]
  behind: number
}

export type ChangeRef = { section: string; id: string; field: number | null }

export interface ScenarioList {
  active: string
  scenarios: Scenario[]
}

export interface ScenarioChange {
  section: string
  id: string
  change: 'added' | 'removed' | 'modified'
}

export interface ScenarioDiff {
  vs_parent: ScenarioChange[]
  own_changes: ScenarioChange[]
  parent_updates: ScenarioChange[]
}

export interface RptTable {
  title: string
  object: 'node' | 'link' | 'subcatchment' | null
  columns: string[]
  units: string[]
  rows: (string | number | null)[][]
}

export interface RptSummary {
  available: boolean
  engine?: string | null
  runoff_continuity_pct?: number | null
  routing_continuity_pct?: number | null
  flooded_nodes?: number
  flood_volume?: number
  flood_volume_units?: string
  surcharged_nodes?: number
  surcharged_conduits?: number
  warnings?: string[]
  errors?: string[]
  elapsed?: string | null
  highest_continuity_errors?: string[]
  tables?: RptTable[]
}

export interface UpdateComponent {
  id: string
  name: string
  role: string
  installed: string | null
  loaded?: string | null
  latest: string | null
  update_available: boolean
  can_update: boolean
  how_to_update?: string | null
  notes_url?: string | null
  notes?: string
  download_size?: number | null
  previous?: string | null
  error?: string | null
}

export interface UpdatesStatus {
  checked_at: string
  distribution: 'portable' | 'source'
  restart_required: boolean
  can_restart: boolean
  updates_available: number
  components: UpdateComponent[]
  changed?: boolean
  message?: string
  path?: string
  version?: string
}

export interface UpdateCheck {
  ok: boolean
  current: string
  latest: string | null
  url: string | null
  notes: string
  update_available: boolean
  error: string | null
}

export interface ProjectInfo {
  path: string
  inp_name: string
  inp_path: string
  scenario_id?: string
  scenario_name?: string
  storm_id?: string
  storm_name?: string
  flow_units?: string | null
  infiltration?: string | null
  files: string[]
  out_path?: string | null
  rpt_path?: string | null
  has_out?: boolean
  has_rpt?: boolean
  has_2d_mesh?: boolean
  has_2d_results?: boolean
  twod_path?: string | null
  crs?: string
  crs_confirmed?: boolean
  crs_proj4?: string | null
  /** Where the CRS is meant to be used: [west, south, east, north] degrees. */
  crs_area?: [number, number, number, number] | null
  simulation_engine?: SimulationEngine
  /** What the user picked; 'auto' resolves per model. */
  simulation_engine_choice?: SimulationEngineChoice
  simulation_engine_reason?: string
  has_flow_accum_results?: boolean
  results_stale?: boolean
}

export interface FlowAccumInfo {
  available: boolean
  bounds?: {
    west: number
    south: number
    east: number
    north: number
  } | null
  png_url?: string | null
  geojson_url?: string | null
  width?: number | null
  height?: number | null
  cell_area_m2?: number | null
  max_area_m2?: number | null
  hand_max?: number | null
  polygon_count?: number | null
}

export interface CrsSearchHit {
  auth_code: string
  name: string
  area_of_use?: string | null
  proj4?: string | null
  source: 'local' | 'epsg.io'
}

export interface CrsSearchResponse {
  query: string
  online: boolean
  hits: CrsSearchHit[]
  warning?: string | null
}

export interface CrsPreset {
  auth_code: string
  label: string
  name?: string | null
}

export interface InpContent {
  text: string
}

export interface RunStatusResponse {
  status: RunStatus
  engine?: SimulationEngine | null
  progress: number
  message: string
  error?: string | null
  inp_path?: string | null
  rpt_path?: string | null
  out_path?: string | null
  step_count?: number | null
  expected_steps?: number | null
  live_rendering?: boolean
}

export interface LiveSnapshotResponse {
  available: boolean
  time?: string | null
  node_ids: string[]
  link_ids: string[]
  subcatchment_ids?: string[]
  node_depths: number[]
  link_flows: number[]
  subcatchment_runoffs?: number[]
  node_depth_min: number
  node_depth_max: number
  link_flow_min: number
  link_flow_max: number
  subcatchment_runoff_min?: number
  subcatchment_runoff_max?: number
  has_twod?: boolean
  twod_triangle_count?: number
  twod_values?: number[]
  twod_value_min?: number
  twod_value_max?: number
}

export interface RptContent {
  text: string
  path: string
}

export interface OutMetadata {
  node_count: number
  link_count: number
  subcatchment_count?: number
  period_count: number
  report_step_sec: number
  path: string
}

export interface IdList {
  ids: string[]
}

export interface OutVariableInfo {
  id: string
  label: string
  unit: string
}

export interface VariableListResponse {
  kind: string
  variables: OutVariableInfo[]
}

export interface TimeSeriesResponse {
  object_id: string
  variable: string
  variable_label?: string
  unit?: string
  report_step_sec: number
  values: number[]
  times_sec: number[]
  times?: string[]
}

export interface MapBounds {
  minx: number
  miny: number
  maxx: number
  maxy: number
}

export interface ModelNetwork {
  crs: string
  bounds: MapBounds | null
  geojson: import('geojson').FeatureCollection
  counts: Record<string, number>
}

export interface ModelObjectResponse {
  object_type: 'node' | 'link' | 'subcatchment'
  id: string
  attributes: Record<string, unknown>
  geometry?: import('geojson').Geometry | null
}

export interface ModelObjectPatch {
  x?: number
  y?: number
  elevation?: number
  max_depth?: number
  init_depth?: number
  sur_depth?: number
  aponded?: number
  ponded_area?: number
  type?: string
  outfall_type?: string
  stage_data?: string
  gated?: string
  route_to?: string
  shape?: string
  curve?: string
  coeff_a?: number
  coeff_b?: number
  coeff_c?: number
  coeff_d?: number
  fevap?: number
  from_node?: string
  to_node?: string
  link_kind?: 'conduit' | 'pump' | 'orifice' | 'weir' | 'outlet'
  length?: number
  roughness?: number
  in_offset?: number
  out_offset?: number
  init_flow?: number
  max_flow?: number
  diameter?: number
  geom1?: number
  geom2?: number
  geom3?: number
  geom4?: number
  barrels?: number
  vertices?: number[][]
  pump_curve?: string
  status?: string
  startup?: number
  shutoff?: number
  orifice_type?: string
  offset?: number
  qcoeff?: number
  close_time?: number
  weir_type?: string
  crest_height?: number
  end_con?: number
  end_coeff?: number
  outlet_type?: string
  qcoeff_or_curve?: string
  qexpon?: number
  area?: number
  pct_imperv?: number
  outlet?: string
  raingage?: string
  width?: number
  slope?: number
  curb_len?: number
  snow_pack?: string
  n_imperv?: number
  n_perv?: number
  s_imperv?: number
  s_perv?: number
  pct_zero?: number
  subarea_route_to?: string
  pct_routed?: number
  infil_p1?: number
  infil_p2?: number
  infil_p3?: number
  infil_p4?: number
  infil_p5?: number
}

export interface NodeCreateRequest {
  id?: string
  node_kind: 'junction' | 'outfall' | 'storage'
  x: number
  y: number
  elevation?: number
  max_depth?: number
}

export interface LinkCreateRequest {
  id?: string
  link_kind?: 'conduit' | 'pump' | 'orifice' | 'weir' | 'outlet'
  from_node: string
  to_node: string
  length?: number
  roughness?: number
  diameter?: number
}

export interface SubcatchmentCreateRequest {
  id?: string
  outlet: string
  raingage?: string
  area?: number
  pct_imperv?: number
  width?: number
  slope?: number
  polygon: number[][]
}

export interface DeleteObjectResponse {
  deleted: boolean
  object_type: 'node' | 'link' | 'subcatchment'
  id: string
  cascaded_link_ids: string[]
  rerouted_subcatchment_ids?: string[]
  /** Things the user should review (e.g. control rules naming the object). */
  warnings?: string[]
}

export interface ConflictDetail {
  message: string
  connected_link_ids?: string[]
  /** Subcatchments draining to the node — must be re-pointed before delete. */
  subcatchment_ids?: string[]
}

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown, message: string) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

export interface OutPeriodsResponse {
  period_count: number
  report_step_sec: number
  times: string[]
  peak_depth_period?: number | null
  peak_depth_max?: number | null
  peak_time?: string | null
  peak_flow_max?: number | null
  peak_runoff_max?: number | null
}

export interface OutSnapshotResponse {
  period: number
  time?: string | null
  node_ids: string[]
  link_ids: string[]
  subcatchment_ids?: string[]
  node_depths: number[]
  link_flows: number[]
  subcatchment_runoffs?: number[]
  node_depth_min: number
  node_depth_max: number
  link_flow_min: number
  link_flow_max: number
  subcatchment_runoff_min?: number
  subcatchment_runoff_max?: number
}

export interface TwoDInfo {
  has_mesh: boolean
  vertex_count: number
  triangle_count: number
  output_file?: string | null
  report_2d?: boolean
  dry_depth?: number | null
  twod_path?: string | null
  has_results: boolean
  mesh_file?: string | null
  boundary_edge_count?: number
}

export interface TwoDBoundaryItem {
  triangle_index: number
  edge: number
  bc_type: string
  param1?: number | null
  param2?: string | null
  group?: string | null
}

export interface TwoDBoundariesResponse {
  crs: string
  geojson: {
    type: 'FeatureCollection'
    features: Array<{
      type: 'Feature'
      id?: string | number
      geometry: { type: string; coordinates: number[][] } | null
      properties: Record<string, unknown> | null
    }>
  }
  count: number
  bc_types: string[]
}

export interface TwoDMeshResponse {
  crs: string
  bounds?: {
    minx: number
    miny: number
    maxx: number
    maxy: number
  } | null
  geojson: import('geojson').FeatureCollection
  /** Compact XY vertices when geojson is empty for large meshes. */
  vertices?: number[][] | null
  /** Compact triangle index triples [i,j,k] aligned with vertices. */
  triangles?: number[][] | null
  counts: { vertices: number; triangles: number }
  options?: Record<string, unknown>
  mesh_file?: string | null
}

export interface TwoDSnapshotResponse {
  period: number
  time?: string | null
  triangle_count: number
  values: number[]
  value_min: number
  value_max: number
  variable: string
  unit: string
}

export interface TwoDFaceInfo {
  triangle_index: number
  mannings_n: number
  z_min: number
  z_max: number
  z_mean: number
  area?: number | null
  coupled_node?: string | null
  cd?: number | null
  coupling_area?: number | null
  vertices: number[][]
}

/** Binary 2D snapshot (float32 LE body + metadata headers). */
export interface TwoDBinarySnapshot {
  values: Float32Array
  period: number
  triangle_count: number
  value_min: number
  value_max: number
  variable: string
  unit: string
  time?: string | null
}

export interface TwoDPeriodsResponse {
  period_count: number
  times: string[]
  times_sec: number[]
  peak_depth_max?: number | null
}

export interface TwoDMetadata {
  path: string
  period_count: number
  triangle_count: number
  variables: OutVariableInfo[]
  report_step_sec?: number | null
  out_period_count?: number | null
  periods_match_out?: boolean | null
}

export interface MeshBBox {
  minx: number
  miny: number
  maxx: number
  maxy: number
}

export interface MeshGenerateRequest {
  bbox?: MeshBBox | null
  /** Project-CRS ring [[x,y], ...] — preferred AOI; clips the regular grid. */
  polygon?: number[][] | null
  cell_size: number
  dem_layer_id?: string | null
  mannings_n?: number
  constant_z?: number | null
  replace?: boolean
}

export interface MeshPreviewResponse {
  crs: string
  bounds?: MeshBBox | null
  geojson: import('geojson').FeatureCollection
  counts: { vertices: number; triangles: number; nx?: number; ny?: number }
  warnings: string[]
  cell_size: number
  mannings_n: number
  dem_layer_id?: string | null
}

export interface MeshGenerateResponse {
  info: TwoDInfo
  mesh: TwoDMeshResponse
  warnings: string[]
  written: Record<string, unknown>
}

export interface ProfileNode {
  id: string
  distance: number
  elevation: number
  max_depth?: number | null
  ground?: number | null
  water_surface?: number | null
  hgl?: number | null
  x?: number | null
  y?: number | null
  node_kind?: string | null
  /** Highest water level over the whole run. */
  max_hgl?: number | null
  /** Flooding (overflow) rate at the shown time. */
  flooding?: number | null
}

export interface ProfileLink {
  id: string
  from_node: string
  to_node: string
  length: number
  start_distance: number
  end_distance: number
  invert_us: number
  invert_ds: number
  diameter?: number | null
  crown_us?: number | null
  crown_ds?: number | null
  link_kind?: string | null
  shape?: string | null
  flow?: number | null
  max_flow?: number | null
  /** The path runs against the link's from→to direction. */
  reversed?: boolean
}

export interface ProfileResponse {
  start: string
  end: string
  via?: string[]
  length_unit?: 'ft' | 'm'
  flow_unit?: string
  total_length: number
  nodes: ProfileNode[]
  links: ProfileLink[]
  path_node_ids: string[]
  path_link_ids: string[]
}

export interface GisBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface GisLayerStyle {
  color?: string
  line_width?: number
  fill_opacity?: number
  point_radius?: number
  label_field?: string
}

export interface GisWebSource {
  kind: 'xyz' | 'wms' | 'arcgis'
  url: string
  wms_layers?: string
  attribution?: string
}

export interface GisLayer {
  id: string
  name: string
  type: 'dem' | 'vector' | 'tiles'
  crs: string
  source_crs?: string | null
  visible: boolean
  opacity: number
  z_order: number
  bounds?: GisBounds | null
  feature_count?: number | null
  geometry_types?: string[]
  cell_size?: number | null
  warning?: string | null
  preview_url?: string | null
  style?: GisLayerStyle | null
  web?: GisWebSource | null
  fields?: string[]
  /** Browser viewer: the layer's features (no server to fetch them from). */
  data?: FeatureCollection
}

export interface GisLayerList {
  layers: GisLayer[]
  project_crs: string
}

/** Coalesce concurrent "no project open" recoveries into one reopen. */
let reopenInFlight: Promise<void> | null = null


export type SectionSummary = { name: string; rows: number; known: boolean; text: boolean }
export type SectionData = {
  name: string
  kind: 'table' | 'text'
  columns?: string[]
  rows?: { values: string[]; comment: string }[]
  text?: string
}
export type Delineation = {
  polygon: number[][]
  polygon_wgs84: number[][]
  outlet: [number, number]
  outlet_wgs84: [number, number]
  snapped: boolean
  cells: number
  area: number
  area_units: 'ac' | 'ha'
  slope_pct: number
  flow_length: number
  width: number | null
  pct_imperv: number | null
  cell_size: number
}
export type SimOption = { key: string; label: string; choices: string[] | null; value: string }
export type SimOptions = { groups: { name: string; options: SimOption[] }[]; other: Record<string, string> }
export type ModelIssue = { severity: 'error' | 'warning' | 'info'; message: string; object_type: string | null; id: string | null }
export type SiteImpervious = { source: string; file?: string; subcatchments: { id: string; current: number | null; nlcd: number; cells: number }[] }
export type SiteSoils = {
  method: string
  units: string
  map_units?: number
  subcatchments: { id: string; hsg: string; hsg_share: Record<string, number>; covered_pct: number; params: Record<string, number> }[]
}

export type ModelSnapshot = { id: string; label: string; created: string; auto: boolean; bytes: number; lines: number }
export type VersionChange = { section: string; id: string; change: 'added' | 'removed' | 'modified'; a: string[]; b: string[]; object: 'node' | 'link' | 'subcatchment' | null }
export type VersionCompare = { from: string; to: string; changes: VersionChange[]; counts: { added: number; removed: number; modified: number } }
export type GitStatus = { available: boolean; repo: boolean; top?: string; branch?: string | null; commits?: { hash: string; author: string; date: string; message: string }[] }

export type ModelCheck = { errors: number; warnings: number; issues: ModelIssue[] }


export type ArchivedRun = {
  id: string
  label: string
  pinned: boolean
  engine: SimulationEngine
  scenario_id: string
  scenario_name: string
  inp_name: string
  started: string
  finished: string
  size_bytes: number
  summary: Record<string, number | string | null>
}
export type CompareTarget = {
  id: string
  kind: 'scenario' | 'run'
  label: string
  scenario_id?: string | null
  storm_id?: string | null
  finished?: string
  engine?: string
  has_results: boolean
}
export type CompareTargets = { current: { id: string; label: string; scenario_id?: string | null; storm_id?: string | null }; targets: CompareTarget[] }

/** A rainfall event in the project's storm library ("model" = the model's own rain gages). */
export type Storm = {
  id: string
  name: string
  kind: 'model' | 'design' | 'record'
  file: string | null
  format: string | null
  interval: string | null
  units: string | null
  start: string | null
  end: string | null
  after_hours: number | null
  total: number | null
  return_period: number | null
  duration_hr: number | null
  note: string | null
}
export type StormList = { active: string; storms: Storm[] }
export type RunSummary = {
  flooded_nodes?: number | null
  flood_volume?: number | null
  surcharged_nodes?: number | null
  surcharged_conduits?: number | null
  runoff_continuity_pct?: number | null
  routing_continuity_pct?: number | null
  flood_volume_units?: string | null
}
export type RunCell = { id: string; scenario: string; storm: string; has_results: boolean; stale: boolean; finished: string | null; summary: RunSummary | null }
export type RunMatrix = {
  active: { scenario: string; storm: string }
  scenarios: { id: string; name: string; parent: string | null; description?: string }[]
  storms: Storm[]
  cells: RunCell[]
}
export type BatchStatus = { running: boolean; items: { scenario: string; storm: string; state: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled'; progress: number; note: string | null }[] }
export type RunComparison = {
  a: string
  b: string
  summary: { key: string; a: number | null; b: number | null; delta: number | null }[]
  flood_volume_units?: string
  tables: {
    title: string
    object: 'node' | 'link' | 'subcatchment'
    columns: string[]
    units: string[]
    total: number
    rows: { id: string; values: { a: number | null; b: number | null; delta: number | null }[] }[]
  }[]
}

async function ensureStoredProjectOpen(): Promise<void> {
  if (reopenInFlight) return reopenInFlight
  const path = readStoredProjectPath()
  if (!path) {
    throw new ApiError(404, 'No project is open', 'No project is open')
  }
  reopenInFlight = (async () => {
    const res = await fetch('/api/projects/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (!res.ok) {
      let message = res.statusText
      try {
        const body = (await res.json()) as { detail?: unknown }
        if (typeof body.detail === 'string') message = body.detail
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, message, message)
    }
  })().finally(() => {
    reopenInFlight = null
  })
  return reopenInFlight
}

function parseErrorBody(body: { detail?: unknown }, fallback: string): {
  detail: unknown
  message: string
} {
  let detail: unknown = fallback
  let message = fallback
  if (body.detail != null) {
    detail = body.detail
    if (typeof body.detail === 'string') message = body.detail
    else if (
      typeof body.detail === 'object' &&
      body.detail &&
      'message' in body.detail &&
      typeof (body.detail as { message: unknown }).message === 'string'
    ) {
      message = (body.detail as { message: string }).message
    } else if (Array.isArray(body.detail)) {
      // FastAPI validation: [{loc: [..., field], msg}] → "field: msg"
      message = (body.detail as { loc?: unknown[]; msg?: string }[])
        .map((d) => `${String(d.loc?.[d.loc.length - 1] ?? 'value').replace(/_/g, ' ')}: ${d.msg ?? 'invalid'}`)
        .join('; ')
    } else message = JSON.stringify(body.detail)
  }
  return { detail, message }
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    let detail: unknown = res.statusText
    let message = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      ;({ detail, message } = parseErrorBody(body, res.statusText))
    } catch {
      /* ignore */
    }

    if (
      !retried &&
      res.status === 404 &&
      message === 'No project is open' &&
      path !== '/api/projects/open' &&
      readStoredProjectPath()
    ) {
      await ensureStoredProjectOpen()
      return request<T>(path, init, true)
    }

    throw new ApiError(res.status, detail, message)
  }
  return (await res.json()) as T
}

async function requestBinarySnapshot(path: string, signal?: AbortSignal): Promise<TwoDBinarySnapshot> {
  const res = await fetch(path, { signal })
  if (!res.ok) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    let message = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message, message)
  }
  const buf = await res.arrayBuffer()
  const values = new Float32Array(buf)
  const hdr = (name: string) => res.headers.get(name)
  return {
    values,
    triangle_count: Number(hdr('X-Triangle-Count') ?? values.length),
    period: Number(hdr('X-Period') ?? 0),
    value_min: Number(hdr('X-Value-Min') ?? 0),
    value_max: Number(hdr('X-Value-Max') ?? 0),
    variable: hdr('X-Variable') ?? 'depth',
    unit: hdr('X-Unit') ?? '',
    time: hdr('X-Time') || null,
  }
}

export const api = {
  health: () => request<SystemHealth>('/api/health'),
  appInfo: () => request<AppInfo>('/api/app'),
  examples: () => request<{ name: string; path: string }[]>('/api/app/examples'),
  listScenarios: () => request<ScenarioList>('/api/scenarios'),
  createScenario: (name: string, parent?: string, description = '') =>
    request<ScenarioList>('/api/scenarios', { method: 'POST', body: JSON.stringify({ name, parent, description }) }),
  setActiveScenario: (id: string) =>
    request<ScenarioList>('/api/scenarios/active', { method: 'PUT', body: JSON.stringify({ id }) }),
  updateScenario: (id: string, body: { name?: string; description?: string }) =>
    request<ScenarioList>(`/api/scenarios/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteScenario: (id: string, branch = false) =>
    request<ScenarioList>(`/api/scenarios/${encodeURIComponent(id)}${branch ? '?branch=true' : ''}`, { method: 'DELETE' }),
  scenarioInheritance: (id = 'active') => request<Inheritance>(`/api/scenarios/${encodeURIComponent(id)}/inheritance`),
  resetChanges: (id: string, items: ChangeRef[]) =>
    request<Inheritance>(`/api/scenarios/${encodeURIComponent(id)}/reset`, { method: 'POST', body: JSON.stringify({ items }) }),
  keepMine: (id: string, items: ChangeRef[]) =>
    request<Inheritance>(`/api/scenarios/${encodeURIComponent(id)}/keep`, { method: 'POST', body: JSON.stringify({ items }) }),
  pushToParent: (id: string, items: ChangeRef[]) =>
    request<Inheritance>(`/api/scenarios/${encodeURIComponent(id)}/push`, { method: 'POST', body: JSON.stringify({ items }) }),
  applyToSiblings: (id: string, items: ChangeRef[]) =>
    request<Inheritance & { applied_to: string[] }>(`/api/scenarios/${encodeURIComponent(id)}/apply-to-siblings`, { method: 'POST', body: JSON.stringify({ items }) }),
  lockScenario: (id: string, locked: boolean) =>
    request<ScenarioList>(`/api/scenarios/${encodeURIComponent(id)}/lock`, { method: 'POST', body: JSON.stringify({ locked }) }),
  reparentScenario: (id: string, parent: string) =>
    request<ScenarioList>(`/api/scenarios/${encodeURIComponent(id)}/reparent`, { method: 'POST', body: JSON.stringify({ parent }) }),
  duplicateScenario: (id: string, name: string) =>
    request<ScenarioList>(`/api/scenarios/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }),
  insertParentScenario: (id: string, name: string) =>
    request<ScenarioList>(`/api/scenarios/${encodeURIComponent(id)}/insert-parent`, { method: 'POST', body: JSON.stringify({ name }) }),
  scenarioRemovedGeojson: (id: string) => request<FeatureCollection>(`/api/scenarios/${encodeURIComponent(id)}/removed-geojson`),
  makeBase: (id: string) => request<ScenarioList>(`/api/scenarios/${encodeURIComponent(id)}/make-base`, { method: 'POST' }),
  compareScenarios: (a: string, b: string) =>
    request<{ a: string; b: string; changes: (ScenarioChange & { a: string[]; b: string[]; object: 'node' | 'link' | 'subcatchment' | null })[] }>(
      `/api/scenarios/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    ),
  scenarioDiff: (id: string) => request<ScenarioDiff>(`/api/scenarios/${encodeURIComponent(id)}/diff`),
  syncScenario: (id: string) =>
    request<ScenarioList & { applied: ScenarioChange[]; conflicts: { section: string; id: string }[] }>(
      `/api/scenarios/${encodeURIComponent(id)}/sync`,
      { method: 'POST' },
    ),
  listSections: () => request<{ sections: SectionSummary[]; available: string[] }>('/api/model/sections'),
  getSection: (name: string) => request<SectionData>(`/api/model/sections/${encodeURIComponent(name)}`),
  putSection: (name: string, body: { rows?: SectionData['rows']; text?: string }) =>
    request<SectionData>(`/api/model/sections/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) }),
  getSimOptions: () => request<SimOptions>('/api/model/options'),
  putSimOptions: (values: Record<string, string>) =>
    request<SimOptions>('/api/model/options', { method: 'PUT', body: JSON.stringify({ values }) }),
  checkModel: () => request<ModelCheck>('/api/model/check'),
  listRuns: () => request<{ runs: ArchivedRun[]; keep_unpinned: number }>('/api/runs/archive'),
  updateRun: (id: string, body: { label?: string; pinned?: boolean }) =>
    request<{ runs: ArchivedRun[] }>(`/api/runs/archive/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRun: (id: string) =>
    request<{ runs: ArchivedRun[] }>(`/api/runs/archive/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  compareRuns: (a: string, b: string) =>
    request<RunComparison>(`/api/runs/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  runSeries: (id: string, kind: 'node' | 'link' | 'subcatchment', objectId: string, variable?: string) =>
    request<TimeSeriesResponse>(
      `/api/runs/archive/${encodeURIComponent(id)}/series/${kind}/${encodeURIComponent(objectId)}${variable ? `?variable=${encodeURIComponent(variable)}` : ''}`,
    ),
  getSystemVariables: () => request<{ variables: { id: string; label: string; unit: string }[] }>('/api/out/system/variables'),
  getSystemSeries: (variable: string) => request<TimeSeriesResponse>(`/api/out/system/series?variable=${encodeURIComponent(variable)}`),
  runSystemSeries: (id: string, variable: string) =>
    request<TimeSeriesResponse>(`/api/runs/archive/${encodeURIComponent(id)}/system?variable=${encodeURIComponent(variable)}`),
  /** Each LID unit's report text for a run ('current', a scenario 'scen-…' or a viewer result set). */
  lidReports: (id = 'current') =>
    request<{ reports: { file: string; text: string | null; subcatchment: string | null; lid: string | null; note: string | null }[] }>(
      `/api/runs/archive/${encodeURIComponent(id)}/lid-reports`,
    ),
  getCompareTargets: () => request<CompareTargets>('/api/runs/targets'),
  runMatrix: () => request<RunMatrix>('/api/runs/matrix'),
  startBatch: (cells: { scenario: string; storm: string }[]) => request<BatchStatus>('/api/runs/batch', { method: 'POST', body: JSON.stringify({ cells }) }),
  batchStatus: () => request<BatchStatus>('/api/runs/batch'),
  cancelBatch: () => request<BatchStatus>('/api/runs/batch', { method: 'DELETE' }),
  listStorms: () => request<StormList>('/api/storms'),
  createStorm: (body: {
    name: string
    text: string
    format: 'VOLUME' | 'INTENSITY' | 'CUMULATIVE'
    interval: string
    units: 'IN' | 'MM'
    after_hours?: number
    kind?: 'design' | 'record'
    return_period?: number
    duration_hr?: number
    note?: string
    replace?: boolean
  }) => request<Storm>('/api/storms', { method: 'POST', body: JSON.stringify(body) }),
  updateStorm: (id: string, body: { name?: string; after_hours?: number }) =>
    request<Storm>(`/api/storms/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteStorm: (id: string) => request<StormList>(`/api/storms/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setActiveStorm: (id: string) => request<ProjectInfo>('/api/storms/active', { method: 'PUT', body: JSON.stringify({ id }) }),
  runEnvelope: (id: string) => request<OutSnapshotResponse>(`/api/runs/archive/${encodeURIComponent(id)}/envelope`),
  runSnapshot: (id: string, period: number) => request<OutSnapshotResponse>(`/api/runs/archive/${encodeURIComponent(id)}/snapshot?period=${period}`),
  runPeriods: (id: string) => request<OutPeriodsResponse>(`/api/runs/archive/${encodeURIComponent(id)}/periods`),
  bulkPatch: (items: { object_type: 'node' | 'link' | 'subcatchment'; id: string; patch: Record<string, unknown> }[]) =>
    request<{ changed: string[]; errors: { id: string; detail: unknown }[] }>('/api/model/objects/bulk-patch', { method: 'POST', body: JSON.stringify({ items }) }),
  bulkDelete: (items: { object_type: 'node' | 'link' | 'subcatchment'; id: string }[], cascade = true) =>
    request<{ deleted: { object_type: string; id: string }[]; cascaded_link_ids: string[]; errors: { id: string; detail: string }[] }>(
      '/api/model/objects/bulk-delete',
      { method: 'POST', body: JSON.stringify({ items, cascade }) },
    ),
  networkTool: <T = Record<string, unknown>>(tool: 'reverse' | 'lengths' | 'rims-from-dem' | 'interpolate' | 'split' | 'merge', body: Record<string, unknown>) =>
    request<T>(`/api/model/tools/${tool}`, { method: 'POST', body: JSON.stringify(body) }),
  siteDem: (resolution_m: number) =>
    request<{ file: string; width: number; height: number; vertical_unit: string; note: string | null }>('/api/site-data/dem', { method: 'POST', body: JSON.stringify({ resolution_m }) }),
  siteImpervious: (download: boolean) =>
    request<SiteImpervious>('/api/site-data/impervious', download ? { method: 'POST' } : undefined),
  siteImperviousApply: (ids?: string[]) => request<{ changed: string[] }>('/api/site-data/impervious/apply', { method: 'POST', body: JSON.stringify({ ids: ids ?? null }) }),
  siteSoils: (download: boolean) => request<SiteSoils>('/api/site-data/soils', download ? { method: 'POST' } : undefined),
  siteSoilsApply: (ids?: string[]) => request<{ changed: string[] }>('/api/site-data/soils/apply', { method: 'POST', body: JSON.stringify({ ids: ids ?? null }) }),
  runScript: (code: string, timeout = 60) =>
    request<{ exit_code: number; stdout: string; stderr: string }>('/api/scripts/run', { method: 'POST', body: JSON.stringify({ code, timeout }) }),
  listSnapshots: () => request<{ snapshots: ModelSnapshot[] }>('/api/snapshots'),
  createSnapshot: (label: string) => request<ModelSnapshot>('/api/snapshots', { method: 'POST', body: JSON.stringify({ label }) }),
  saveVersion: (label: string, gitCommit = false) =>
    request<ModelSnapshot & { git?: GitStatus }>('/api/snapshots', { method: 'POST', body: JSON.stringify({ label, git_commit: gitCommit }) }),
  renameSnapshot: (id: string, label: string) =>
    request<ModelSnapshot>(`/api/snapshots/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  compareSnapshot: (id: string, against = 'current') =>
    request<VersionCompare>(`/api/snapshots/${encodeURIComponent(id)}/compare?against=${encodeURIComponent(against)}`),
  gitStatus: () => request<GitStatus>('/api/snapshots/git'),
  gitInit: () => request<GitStatus>('/api/snapshots/git/init', { method: 'POST' }),
  restoreSnapshot: (id: string) => request<ModelSnapshot>(`/api/snapshots/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  deleteSnapshot: (id: string) => request<{ snapshots: ModelSnapshot[] }>(`/api/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getEdits: () => request<{ undo: string[]; redo: string[] }>('/api/edits'),
  undoEdit: () => request<{ undo: string[]; redo: string[]; applied: string }>('/api/edits/undo', { method: 'POST' }),
  redoEdit: () => request<{ undo: string[]; redo: string[]; applied: string }>('/api/edits/redo', { method: 'POST' }),
  getRptSummary: () => request<RptSummary>('/api/rpt/summary'),
  /** Update every engine with a newer version, then the app (portable build). */
  updateAll: () =>
    request<UpdatesStatus & { message?: string; results?: { id: string; ok: boolean; message: string }[]; path?: string; version?: string }>(
      '/api/updates/all',
      { method: 'POST' },
    ),
  getUpdates: (force = false) => request<UpdatesStatus>(`/api/updates${force ? '?force=true' : ''}`),
  installUpdate: (id: string, version?: string) =>
    request<UpdatesStatus>(`/api/updates/${encodeURIComponent(id)}/install`, {
      method: 'POST',
      body: JSON.stringify({ version: version ?? null }),
    }),
  rollbackUpdate: (id: string) =>
    request<UpdatesStatus>(`/api/updates/${encodeURIComponent(id)}/rollback`, { method: 'POST' }),
  restartApp: (into?: string) =>
    request<{ ok: boolean }>('/api/updates/restart', { method: 'POST', body: JSON.stringify({ into: into ?? null }) }),
  checkForUpdate: (force = false) =>
    request<UpdateCheck>(`/api/app/update-check${force ? '?force=true' : ''}`),
  getEngineStatus: () => request<EngineStatus>('/api/engine'),
  checkEngineUpdates: () =>
    request<EngineStatus>('/api/engine/check', { method: 'POST', body: '{}' }),
  updateEngine: (version?: string) =>
    request<EngineStatus>('/api/engine/update', {
      method: 'POST',
      body: JSON.stringify({ version: version ?? null }),
    }),
  rollbackEngine: () =>
    request<EngineStatus>('/api/engine/rollback', { method: 'POST', body: '{}' }),
  browseFolder: (
    title = 'Select project folder',
    allowNewFolder = true,
    signal?: AbortSignal,
  ) =>
    request<{ path: string | null; cancelled: boolean }>('/api/projects/browse', {
      method: 'POST',
      body: JSON.stringify({ title, allow_new_folder: allowNewFolder }),
      signal,
    }),
  browseFile: (title = 'Select file', filetypes: string[] = ['*.*'], signal?: AbortSignal) =>
    request<{ path: string | null; cancelled: boolean }>('/api/projects/browse-file', {
      method: 'POST',
      body: JSON.stringify({ title, filetypes }),
      signal,
    }),
  openProject: (path: string) =>
    request<ProjectInfo>('/api/projects/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createProject: (
    path: string,
    name?: string,
    opts: { flow_units?: string; infiltration?: string; routing?: string; start_date?: string; crs?: string | null } = {},
  ) =>
    request<ProjectInfo>('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path, name: name || null, ...opts }),
    }),
  currentProject: () => request<ProjectInfo>('/api/projects/current'),
  setProjectCrs: (crs: string) =>
    request<ProjectInfo>('/api/projects/crs', {
      method: 'PUT',
      body: JSON.stringify({ crs }),
    }),
  setSimulationEngine: (simulation_engine: SimulationEngineChoice) =>
    request<ProjectInfo>('/api/projects/simulation-engine', {
      method: 'PUT',
      body: JSON.stringify({ simulation_engine }),
    }),
  searchCrs: (q: string, opts?: { online?: boolean; limit?: number }) => {
    const params = new URLSearchParams()
    params.set('q', q)
    if (opts?.online) params.set('online', 'true')
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    return request<CrsSearchResponse>(`/api/crs/search?${params.toString()}`)
  },
  getCrsPresets: () =>
    request<{ presets: CrsPreset[] }>('/api/crs/presets').then((r) => r.presets),
  getInp: () => request<InpContent>('/api/inp'),
  saveInp: (text: string) =>
    request<InpContent>('/api/inp', {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),
  startRun: (opts?: { live_rendering?: boolean; simulation_engine?: SimulationEngine }) =>
    request<RunStatusResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        live_rendering: Boolean(opts?.live_rendering),
        simulation_engine: opts?.simulation_engine ?? null,
      }),
    }),
  getRunStatus: () => request<RunStatusResponse>('/api/runs/current'),
  getLiveSnapshot: () => request<LiveSnapshotResponse>('/api/runs/current/live'),
  cancelRun: () => request<RunStatusResponse>('/api/runs/current', { method: 'DELETE' }),
  getRpt: () => request<RptContent>('/api/rpt'),
  getOutMetadata: () => request<OutMetadata>('/api/out/metadata'),
  getNodes: () => request<IdList>('/api/out/nodes'),
  getLinks: () => request<IdList>('/api/out/links'),
  getSubcatchments: () => request<IdList>('/api/out/subcatchments'),
  getOutVariables: (kind: 'node' | 'link' | 'subcatchment') =>
    request<VariableListResponse>(`/api/out/variables?kind=${encodeURIComponent(kind)}`),
  getNodeSeries: (id: string, variable?: string) =>
    request<TimeSeriesResponse>(
      `/api/out/nodes/${encodeURIComponent(id)}/series${
        variable ? `?variable=${encodeURIComponent(variable)}` : ''
      }`,
    ),
  getLinkSeries: (id: string, variable?: string) =>
    request<TimeSeriesResponse>(
      `/api/out/links/${encodeURIComponent(id)}/series${
        variable ? `?variable=${encodeURIComponent(variable)}` : ''
      }`,
    ),
  getSubcatchmentSeries: (id: string, variable?: string) =>
    request<TimeSeriesResponse>(
      `/api/out/subcatchments/${encodeURIComponent(id)}/series${
        variable ? `?variable=${encodeURIComponent(variable)}` : ''
      }`,
    ),
  getOutPeriods: () => request<OutPeriodsResponse>('/api/out/periods'),
  getOutSnapshot: (period: number) =>
    request<OutSnapshotResponse>(`/api/out/snapshot?period=${period}`),
  getOutEnvelope: () => request<OutSnapshotResponse>('/api/out/envelope'),
  getTwoDInfo: () => request<TwoDInfo>('/api/2d/info'),
  getTwoDMesh: (crs?: string) =>
    request<TwoDMeshResponse>(
      crs ? `/api/2d/mesh?crs=${encodeURIComponent(crs)}` : '/api/2d/mesh',
    ),
  getTwoDBoundaries: (crs?: string) =>
    request<TwoDBoundariesResponse>(
      crs
        ? `/api/2d/boundaries?crs=${encodeURIComponent(crs)}`
        : '/api/2d/boundaries',
    ),
  writeTwoDBoundaries: (body: {
    items: TwoDBoundaryItem[]
    write_defaults?: boolean
  }) =>
    request<TwoDBoundariesResponse>('/api/2d/boundaries', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getTwoDMetadata: () => request<TwoDMetadata>('/api/2d/metadata'),
  getTwoDPeriods: () => request<TwoDPeriodsResponse>('/api/2d/periods'),
  getTwoDSnapshot: (period: number, variable = 'depth') =>
    request<TwoDSnapshotResponse>(
      `/api/2d/snapshot?period=${period}&variable=${encodeURIComponent(variable)}`,
    ),
  getTwoDEnvelope: (variable = 'depth') =>
    request<TwoDSnapshotResponse>(
      `/api/2d/envelope?variable=${encodeURIComponent(variable)}`,
    ),
  getTwoDFaceSeries: (faceIndex: number, variable = 'depth') =>
    request<TimeSeriesResponse>(
      `/api/2d/faces/${faceIndex}/series?variable=${encodeURIComponent(variable)}`,
    ),
  getTwoDFaceInfo: (faceIndex: number) =>
    request<TwoDFaceInfo>(`/api/2d/faces/${faceIndex}`),
  fetchTwoDSnapshotBinary: (period: number, variable = 'depth', signal?: AbortSignal) =>
    requestBinarySnapshot(
      `/api/2d/snapshot/binary?period=${period}&variable=${encodeURIComponent(variable)}`,
      signal,
    ),
  fetchTwoDEnvelopeBinary: (variable = 'depth', signal?: AbortSignal) =>
    requestBinarySnapshot(
      `/api/2d/envelope/binary?variable=${encodeURIComponent(variable)}`,
      signal,
    ),
  previewTwoDMesh: (body: MeshGenerateRequest) =>
    request<MeshPreviewResponse>('/api/2d/mesh/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  generateTwoDMesh: (body: MeshGenerateRequest) =>
    request<MeshGenerateResponse>('/api/2d/mesh/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getNetwork: (crs?: string) =>
    request<ModelNetwork>(
      crs ? `/api/model/network?crs=${encodeURIComponent(crs)}` : '/api/model/network',
    ),
  getObject: (type: 'node' | 'link' | 'subcatchment', id: string) =>
    request<ModelObjectResponse>(
      `/api/model/objects/${type}/${encodeURIComponent(id)}`,
    ),
  patchObject: (
    type: 'node' | 'link' | 'subcatchment',
    id: string,
    patch: ModelObjectPatch,
  ) =>
    request<ModelObjectResponse>(
      `/api/model/objects/${type}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),
  createNode: (body: NodeCreateRequest) =>
    request<ModelObjectResponse>('/api/model/objects/node', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createLink: (body: LinkCreateRequest) =>
    request<ModelObjectResponse>('/api/model/objects/link', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** The area draining to a point (project coordinates), from the project's DEM. Desktop only. */
  delineate: (body: { x: number; y: number; snap?: number }) =>
    request<Delineation>('/api/gis/delineate', { method: 'POST', body: JSON.stringify(body) }),
  createSubcatchment: (body: SubcatchmentCreateRequest) =>
    request<ModelObjectResponse>('/api/model/objects/subcatchment', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteObject: (
    type: 'node' | 'link' | 'subcatchment',
    id: string,
    cascade = false,
  ) =>
    request<DeleteObjectResponse>(
      `/api/model/objects/${type}/${encodeURIComponent(id)}?cascade=${cascade}`,
      { method: 'DELETE' },
    ),
  saveModel: () => request<{ status: string }>('/api/model/save', { method: 'POST' }),
  getProfile: (start: string, end: string, period?: number, via: string[] = []) => {
    const q = new URLSearchParams({ start, end })
    if (period != null) q.set('period', String(period))
    if (via.length) q.set('via', via.join(','))
    return request<ProfileResponse>(`/api/model/profile?${q.toString()}`)
  },
  getSimulationWindow: () =>
    request<{
      start?: string | null
      end?: string | null
      report_start?: string | null
      start_date?: string | null
      start_time?: string | null
      end_date?: string | null
      end_time?: string | null
      threads?: number
      cpu_count?: number
      report_step?: string | null
      routing_step?: string | null
      flow_routing?: string | null
    }>('/api/model/simulation-window'),
  setSimulationWindow: (body: {
    start_date: string
    start_time: string
    end_date: string
    end_time: string
    sync_report_start?: boolean
    threads?: number
    report_step?: string
    routing_step?: string
    flow_routing?: string
  }) =>
    request<{
      start?: string | null
      end?: string | null
      report_start?: string | null
      start_date?: string | null
      start_time?: string | null
      end_date?: string | null
      end_time?: string | null
      threads?: number
      cpu_count?: number
      report_step?: string | null
      routing_step?: string | null
      flow_routing?: string | null
    }>('/api/model/simulation-window', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getTwoDOptions: () =>
    request<{
      report_2d: boolean
      output_file?: string | null
      dry_depth?: number | null
      max_timestep?: number | null
      min_timestep?: number | null
      rel_tolerance?: number | null
      abs_tolerance?: number | null
      has_mesh: boolean
      length_unit?: string
      flow_units?: string | null
      defaults?: {
        report_2d: boolean
        dry_depth: number
        max_timestep: number
        min_timestep: number
        rel_tolerance: number
        abs_tolerance: number
      } | null
    }>('/api/model/2d-options'),
  setTwoDOptions: (body: {
    report_2d?: boolean
    dry_depth?: number
    max_timestep?: number
    min_timestep?: number
    rel_tolerance?: number
    abs_tolerance?: number
  }) =>
    request<{
      report_2d: boolean
      output_file?: string | null
      dry_depth?: number | null
      max_timestep?: number | null
      min_timestep?: number | null
      rel_tolerance?: number | null
      abs_tolerance?: number | null
      has_mesh: boolean
      length_unit?: string
      flow_units?: string | null
      defaults?: {
        report_2d: boolean
        dry_depth: number
        max_timestep: number
        min_timestep: number
        rel_tolerance: number
        abs_tolerance: number
      } | null
    }>('/api/model/2d-options', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getRainFileSpan: (filename: string) =>
    request<{
      filename: string
      start_date?: string | null
      start_time?: string | null
      end_date?: string | null
      end_time?: string | null
      start?: string | null
      end?: string | null
      records: number
    }>(`/api/projects/files/${encodeURIComponent(filename)}/span`),
  getNoaaPfds: async (lat: number, lon: number, series: 'pds' | 'ams' = 'pds') => {
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon), series })
    const res = await fetch(`/api/noaa/pfds?${q.toString()}`)
    if (!res.ok) {
      let message = res.statusText
      try {
        const body = (await res.json()) as { detail?: unknown }
        if (typeof body.detail === 'string') message = body.detail
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, message, message)
    }
    return res.text()
  },
  fetchOpenMeteoArchive: (opts: {
    lat: number
    lon: number
    year?: number
    startDate?: string
    endDate?: string
  }) => {
    const q = new URLSearchParams({
      lat: String(opts.lat),
      lon: String(opts.lon),
    })
    if (opts.year != null) q.set('year', String(opts.year))
    if (opts.startDate) q.set('start_date', opts.startDate)
    if (opts.endDate) q.set('end_date', opts.endDate)
    return request<Record<string, unknown>>(`/api/openmeteo/archive?${q.toString()}`)
  },
  fetchOpenMeteoForecast: (opts: { lat: number; lon: number }) =>
    request<Record<string, unknown>>(`/api/openmeteo/forecast?lat=${opts.lat}&lon=${opts.lon}&past_days=1&forecast_days=7`),
  applyClimateTemperature: (body?: { filename?: string; dry_only?: boolean; latitude?: number }) =>
    request<{
      filename: string
      dry_only: boolean
      temperature: string
      evaporation: string
    }>('/api/model/climate-temperature', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  writeProjectFile: (filename: string, content: string) =>
    request<ProjectInfo>('/api/projects/files', {
      method: 'POST',
      body: JSON.stringify({ filename, content }),
    }),
  listDatFiles: () =>
    request<Array<{ filename: string; size_bytes: number }>>('/api/projects/files/dat'),
  /** `optional`: a missing file answers `exists: false` instead of a 404. */
  readProjectFile: (filename: string, opts?: { optional?: boolean }) =>
    request<{
      filename: string
      content: string
      truncated: boolean
      size_bytes: number
      exists?: boolean
    }>(`/api/projects/files/${encodeURIComponent(filename)}${opts?.optional ? '?optional=true' : ''}`),
  deleteProjectFile: (filename: string) =>
    request<ProjectInfo>(`/api/projects/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),
  upsertFileRaingage: (body: {
    name?: string
    filename: string
    format?: 'INTENSITY' | 'VOLUME'
    interval?: string
    scf?: number
    units?: 'IN' | 'MM'
  }) =>
    request<{ name: string; filename: string; line: string }>(
      '/api/model/raingages/file',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  listRaingages: () =>
    request<
      Array<{
        name: string
        format: string
        interval: string
        scf: number
        source: string
        filename?: string | null
        station?: string | null
        units?: string | null
        timeseries?: string | null
        subcatchments?: number
        subcatchments_total?: number
      }>
    >('/api/model/raingages'),
  saveRaingage: (name: string, body: import('../components/storm/RainGageList').GageSave) =>
    request<{ name: string; created: boolean; subcatchments_renamed: number; line: string }>(
      `/api/model/raingages/${encodeURIComponent(name)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  deleteRaingage: (name: string) =>
    request<{ deleted: boolean; name: string }>(
      `/api/model/raingages/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    ),
  applyRaingageToAll: (name: string) =>
    request<{ raingage: string; updated: number }>('/api/model/raingages/apply-all', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  snapRaingageToMesh: (name: string) =>
    request<{
      raingage: string
      x: number
      y: number
      removed_orphan_symbols: string[]
      has_mesh: boolean
      rain_fix?: {
        converted?: boolean
        reason?: string
        records?: number
        filename?: string
        format?: string
      } | null
    }>('/api/model/raingages/snap-to-mesh', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  listGisLayers: () => request<GisLayerList>('/api/gis/layers'),
  ingestGisDem: (body: { source_path: string; name?: string; source_crs?: string }) =>
    request<GisLayer>('/api/gis/layers/dem', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ingestGisVector: (body: { source_path: string; name?: string; source_crs?: string }) =>
    request<GisLayer>('/api/gis/layers/vector', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  addGisWebLayer: (body: { name: string; web: GisWebSource }) =>
    request<GisLayer>('/api/gis/layers/web', { method: 'POST', body: JSON.stringify(body) }),
  addGisGeoJsonLayer: (body: { name: string; geojson: FeatureCollection; source?: string }) =>
    request<GisLayer>('/api/gis/layers/geojson', { method: 'POST', body: JSON.stringify(body) }),
  patchGisLayer: (
    id: string,
    patch: { visible?: boolean; opacity?: number; z_order?: number; name?: string; style?: GisLayerStyle },
  ) =>
    request<GisLayer>(`/api/gis/layers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteGisLayer: (id: string) =>
    request<GisLayerList>(`/api/gis/layers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getFlowAccumInfo: () => request<FlowAccumInfo>('/api/gis/flow/info'),
}
