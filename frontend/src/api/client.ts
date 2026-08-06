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
  python_version: string
  openswmm: SystemHealthOpenswmm
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

export interface ProjectInfo {
  path: string
  inp_name: string
  inp_path: string
  files: string[]
  out_path?: string | null
  rpt_path?: string | null
  has_out?: boolean
  has_rpt?: boolean
  has_2d_mesh?: boolean
  has_2d_results?: boolean
  twod_path?: string | null
  crs?: string
  crs_proj4?: string | null
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
  progress: number
  message: string
  error?: string | null
  inp_path?: string | null
  rpt_path?: string | null
  out_path?: string | null
  step_count?: number | null
  expected_steps?: number | null
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
}

export interface ConflictDetail {
  message: string
  connected_link_ids?: string[]
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
}

export interface ProfileResponse {
  start: string
  end: string
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

export interface GisLayer {
  id: string
  name: string
  type: 'dem' | 'vector'
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
}

export interface GisLayerList {
  layers: GisLayer[]
  project_crs: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    let detail: unknown = res.statusText
    let message = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
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
        } else message = JSON.stringify(body.detail)
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail, message)
  }
  return (await res.json()) as T
}

export const api = {
  health: () => request<SystemHealth>('/api/health'),
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
  createProject: (path: string, name?: string) =>
    request<ProjectInfo>('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path, name: name || null }),
    }),
  currentProject: () => request<ProjectInfo>('/api/projects/current'),
  setProjectCrs: (crs: string) =>
    request<ProjectInfo>('/api/projects/crs', {
      method: 'PUT',
      body: JSON.stringify({ crs }),
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
  startRun: () => request<RunStatusResponse>('/api/runs', { method: 'POST' }),
  getRunStatus: () => request<RunStatusResponse>('/api/runs/current'),
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
  getTwoDInfo: () => request<TwoDInfo>('/api/2d/info'),
  getTwoDMesh: (crs?: string) =>
    request<TwoDMeshResponse>(
      crs ? `/api/2d/mesh?crs=${encodeURIComponent(crs)}` : '/api/2d/mesh',
    ),
  getTwoDMetadata: () => request<TwoDMetadata>('/api/2d/metadata'),
  getTwoDSnapshot: (period: number, variable = 'depth') =>
    request<TwoDSnapshotResponse>(
      `/api/2d/snapshot?period=${period}&variable=${encodeURIComponent(variable)}`,
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
  getProfile: (start: string, end: string, period?: number) => {
    const q = new URLSearchParams({ start, end })
    if (period != null) q.set('period', String(period))
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
  getNoaaPfds: async (lat: number, lon: number) => {
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon) })
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
  writeProjectFile: (filename: string, content: string) =>
    request<ProjectInfo>('/api/projects/files', {
      method: 'POST',
      body: JSON.stringify({ filename, content }),
    }),
  listDatFiles: () =>
    request<Array<{ filename: string; size_bytes: number }>>('/api/projects/files/dat'),
  readProjectFile: (filename: string) =>
    request<{
      filename: string
      content: string
      truncated: boolean
      size_bytes: number
    }>(`/api/projects/files/${encodeURIComponent(filename)}`),
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
      }>
    >('/api/model/raingages'),
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
  patchGisLayer: (
    id: string,
    patch: { visible?: boolean; opacity?: number; z_order?: number; name?: string },
  ) =>
    request<GisLayer>(`/api/gis/layers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteGisLayer: (id: string) =>
    request<GisLayerList>(`/api/gis/layers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
}
