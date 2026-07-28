from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    idle = "idle"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class OpenProjectRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a project folder containing an .inp file")


class CreateProjectRequest(BaseModel):
    path: str = Field(..., description="Absolute path to an empty or new project folder")
    name: Optional[str] = Field(
        default=None,
        description="Optional INP file name (defaults to <folder>.inp)",
    )


class BrowseFolderRequest(BaseModel):
    title: str = Field(default="Select project folder")
    allow_new_folder: bool = True


class BrowseFolderResponse(BaseModel):
    path: Optional[str] = None
    cancelled: bool = False


class BrowseFileRequest(BaseModel):
    title: str = Field(default="Select file")
    filetypes: list[str] = Field(
        default_factory=lambda: ["*.*"],
        description="File dialog filters, e.g. ['*.tif', '*.tiff'] or ['*.zip']",
    )


class BrowseFileResponse(BaseModel):
    path: Optional[str] = None
    cancelled: bool = False


class ProjectInfo(BaseModel):
    path: str
    inp_name: str
    inp_path: str
    files: list[str]
    out_path: Optional[str] = None
    rpt_path: Optional[str] = None
    has_out: bool = False
    has_rpt: bool = False


class InpContent(BaseModel):
    text: str


class SaveInpRequest(BaseModel):
    text: str


class RunStatusResponse(BaseModel):
    status: RunStatus
    progress: float = 0.0
    message: str = ""
    error: Optional[str] = None
    inp_path: Optional[str] = None
    rpt_path: Optional[str] = None
    out_path: Optional[str] = None


class RptContent(BaseModel):
    text: str
    path: str


class OutMetadata(BaseModel):
    node_count: int
    link_count: int
    subcatchment_count: int = 0
    period_count: int
    report_step_sec: float
    path: str


class IdList(BaseModel):
    ids: list[str]


class OutVariableInfo(BaseModel):
    id: str
    label: str
    unit: str = ""


class VariableListResponse(BaseModel):
    kind: str
    variables: list[OutVariableInfo]


class TimeSeriesResponse(BaseModel):
    object_id: str
    variable: str
    variable_label: str = ""
    unit: str = ""
    report_step_sec: float
    values: list[float]
    times_sec: list[float]
    times: list[str] = Field(default_factory=list)


class MapBounds(BaseModel):
    minx: float
    miny: float
    maxx: float
    maxy: float


class ModelNetwork(BaseModel):
    crs: str = "EPSG:25832"
    bounds: Optional[MapBounds] = None
    geojson: dict[str, Any]
    counts: dict[str, int]


class ModelObjectResponse(BaseModel):
    object_type: Literal["node", "link", "subcatchment"]
    id: str
    attributes: dict[str, Any]
    geometry: Optional[dict[str, Any]] = None


class ModelObjectPatch(BaseModel):
    # Node common / coordinates
    x: Optional[float] = None
    y: Optional[float] = None
    elevation: Optional[float] = None
    max_depth: Optional[float] = None
    # Junction
    init_depth: Optional[float] = None
    sur_depth: Optional[float] = None
    aponded: Optional[float] = None
    ponded_area: Optional[float] = None
    # Outfall
    type: Optional[str] = None
    outfall_type: Optional[str] = None
    stage_data: Optional[str] = None
    gated: Optional[str] = None
    route_to: Optional[str] = None
    # Storage
    shape: Optional[str] = None
    curve: Optional[str] = None
    coeff_a: Optional[float] = None
    coeff_b: Optional[float] = None
    coeff_c: Optional[float] = None
    coeff_d: Optional[float] = None
    fevap: Optional[float] = None
    # Link common
    link_kind: Optional[Literal["conduit", "pump", "orifice", "weir", "outlet"]] = None
    from_node: Optional[str] = None
    to_node: Optional[str] = None
    # Conduit
    length: Optional[float] = None
    roughness: Optional[float] = None
    in_offset: Optional[float] = None
    out_offset: Optional[float] = None
    init_flow: Optional[float] = None
    max_flow: Optional[float] = None
    diameter: Optional[float] = None
    geom1: Optional[float] = None
    geom2: Optional[float] = None
    geom3: Optional[float] = None
    geom4: Optional[float] = None
    barrels: Optional[float] = None
    vertices: Optional[list[list[float]]] = None
    # Pump
    pump_curve: Optional[str] = None
    status: Optional[str] = None
    startup: Optional[float] = None
    shutoff: Optional[float] = None
    # Orifice
    orifice_type: Optional[str] = None
    offset: Optional[float] = None
    qcoeff: Optional[float] = None
    close_time: Optional[float] = None
    # Weir
    weir_type: Optional[str] = None
    crest_height: Optional[float] = None
    end_con: Optional[float] = None
    end_coeff: Optional[float] = None
    # Outlet
    outlet_type: Optional[str] = None
    qcoeff_or_curve: Optional[str] = None
    qexpon: Optional[float] = None
    # Subcatchment
    area: Optional[float] = None
    pct_imperv: Optional[float] = None
    outlet: Optional[str] = None
    raingage: Optional[str] = None
    width: Optional[float] = None
    slope: Optional[float] = None
    curb_len: Optional[float] = None
    snow_pack: Optional[str] = None
    n_imperv: Optional[float] = None
    n_perv: Optional[float] = None
    s_imperv: Optional[float] = None
    s_perv: Optional[float] = None
    pct_zero: Optional[float] = None
    subarea_route_to: Optional[str] = None
    pct_routed: Optional[float] = None
    infil_p1: Optional[float] = None
    infil_p2: Optional[float] = None
    infil_p3: Optional[float] = None
    infil_p4: Optional[float] = None
    infil_p5: Optional[float] = None


class NodeCreateRequest(BaseModel):
    id: Optional[str] = None
    node_kind: Literal["junction", "outfall", "storage"] = "junction"
    x: float
    y: float
    elevation: float = 0.0
    max_depth: float = 0.0


class LinkCreateRequest(BaseModel):
    id: Optional[str] = None
    link_kind: Literal["conduit", "pump", "orifice", "weir", "outlet"] = "conduit"
    from_node: str
    to_node: str
    length: Optional[float] = None
    roughness: float = 0.01
    diameter: float = 1.0


class SubcatchmentCreateRequest(BaseModel):
    id: Optional[str] = None
    outlet: str
    raingage: str = "RG1"
    area: Optional[float] = None
    pct_imperv: float = 50.0
    width: Optional[float] = None
    slope: float = 0.5
    polygon: list[list[float]] = Field(..., min_length=3)


class DeleteObjectResponse(BaseModel):
    deleted: bool
    object_type: Literal["node", "link", "subcatchment"]
    id: str
    cascaded_link_ids: list[str] = Field(default_factory=list)


class OutPeriodsResponse(BaseModel):
    period_count: int
    report_step_sec: float
    times: list[str]
    peak_depth_period: Optional[int] = None
    peak_depth_max: Optional[float] = None
    peak_time: Optional[str] = None


class OutSnapshotResponse(BaseModel):
    period: int
    time: Optional[str] = None
    node_ids: list[str]
    link_ids: list[str]
    subcatchment_ids: list[str] = Field(default_factory=list)
    node_depths: list[float]
    link_flows: list[float]
    subcatchment_runoffs: list[float] = Field(default_factory=list)
    node_depth_min: float
    node_depth_max: float
    link_flow_min: float
    link_flow_max: float
    subcatchment_runoff_min: float = 0.0
    subcatchment_runoff_max: float = 0.0


class WriteProjectFileRequest(BaseModel):
    filename: str = Field(..., description="Basename only, e.g. design_storm.dat")
    content: str


class ProjectFileContent(BaseModel):
    filename: str
    content: str
    truncated: bool = False
    size_bytes: int = 0


class ProjectDatFileInfo(BaseModel):
    filename: str
    size_bytes: int


class FileRaingageRequest(BaseModel):
    name: str = Field(default="RG1", description="Raingage ID")
    filename: str = Field(..., description="Rain FILE basename in the project folder")
    format: Literal["INTENSITY", "VOLUME"] = "INTENSITY"
    interval: str = Field(default="0:05", description="SWMM time interval, e.g. 0:05")
    scf: float = Field(default=1.0)
    units: Literal["IN", "MM"] = "IN"


class FileRaingageResponse(BaseModel):
    name: str
    filename: str
    line: str


class RaingageInfo(BaseModel):
    name: str
    format: str
    interval: str
    scf: float = 1.0
    source: str
    filename: Optional[str] = None
    station: Optional[str] = None
    units: Optional[str] = None
    timeseries: Optional[str] = None


class ApplyRaingageRequest(BaseModel):
    name: str = Field(..., description="Raingage ID to assign to all subcatchments")


class ApplyRaingageResponse(BaseModel):
    raingage: str
    updated: int


class SimulationWindow(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None
    report_start: Optional[str] = None
    start_date: Optional[str] = None
    start_time: Optional[str] = None
    end_date: Optional[str] = None
    end_time: Optional[str] = None


class SimulationWindowUpdate(BaseModel):
    start_date: str = Field(..., description="MM/DD/YYYY")
    start_time: str = Field(default="00:00:00", description="HH:MM:SS")
    end_date: str = Field(..., description="MM/DD/YYYY")
    end_time: str = Field(default="00:00:00", description="HH:MM:SS")
    sync_report_start: bool = True


class RainFileSpan(BaseModel):
    filename: str
    start_date: Optional[str] = None
    start_time: Optional[str] = None
    end_date: Optional[str] = None
    end_time: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    records: int = 0


class ProfileNode(BaseModel):
    id: str
    distance: float
    elevation: float
    max_depth: Optional[float] = None
    ground: Optional[float] = None
    water_surface: Optional[float] = None
    hgl: Optional[float] = None
    x: Optional[float] = None
    y: Optional[float] = None


class ProfileLink(BaseModel):
    id: str
    from_node: str
    to_node: str
    length: float
    start_distance: float
    end_distance: float
    invert_us: float
    invert_ds: float
    diameter: Optional[float] = None
    crown_us: Optional[float] = None
    crown_ds: Optional[float] = None


class ProfileResponse(BaseModel):
    start: str
    end: str
    total_length: float
    nodes: list[ProfileNode]
    links: list[ProfileLink]
    path_node_ids: list[str]
    path_link_ids: list[str]


class GisBounds(BaseModel):
    """WGS84 southwest / northeast corners for MapLibre image sources."""

    west: float
    south: float
    east: float
    north: float


class GisLayer(BaseModel):
    id: str
    name: str
    type: Literal["dem", "vector"]
    crs: str
    source_crs: Optional[str] = None
    visible: bool = True
    opacity: float = 0.7
    z_order: int = 0
    bounds: Optional[GisBounds] = None
    feature_count: Optional[int] = None
    geometry_types: list[str] = Field(default_factory=list)
    cell_size: Optional[float] = None
    warning: Optional[str] = None
    preview_url: Optional[str] = None


class GisLayerList(BaseModel):
    layers: list[GisLayer]
    project_crs: str = "EPSG:25832"


class GisIngestRequest(BaseModel):
    source_path: str = Field(..., description="Absolute path to DEM or shapefile zip")
    name: Optional[str] = None
    source_crs: Optional[str] = Field(
        default=None,
        description="EPSG code when source has no CRS (e.g. EPSG:25832)",
    )


class GisLayerPatch(BaseModel):
    visible: Optional[bool] = None
    opacity: Optional[float] = None
    z_order: Optional[int] = None
    name: Optional[str] = None


class GisLayerInfo(BaseModel):
    id: str
    name: str
    type: Literal["dem", "vector"]
    crs: str
    source_crs: Optional[str] = None
    bounds: Optional[GisBounds] = None
    feature_count: Optional[int] = None
    geometry_types: list[str] = Field(default_factory=list)
    cell_size: Optional[float] = None
    source_path: Optional[str] = None
    warning: Optional[str] = None
