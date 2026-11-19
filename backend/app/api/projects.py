from __future__ import annotations

from fastapi import APIRouter, Query, HTTPException

from app.models.schemas import (
    BrowseFileRequest,
    BrowseFileResponse,
    BrowseFolderRequest,
    BrowseFolderResponse,
    CreateProjectRequest,
    InpContent,
    OpenProjectRequest,
    ProjectCrsRequest,
    ProjectDatFileInfo,
    ProjectFileContent,
    ProjectInfo,
    ProjectSimulationEngineRequest,
    RainFileSpan,
    SaveInpRequest,
    WriteProjectFileRequest,
)
from app.services.folder_dialog import pick_file, pick_folder
from app.services.project_service import project_service

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("/browse", response_model=BrowseFolderResponse)
def browse_folder(body: BrowseFolderRequest | None = None) -> BrowseFolderResponse:
    """Open a native OS folder picker on the local machine (blocks until dismissed)."""
    req = body or BrowseFolderRequest()
    try:
        path = pick_folder(req.title, allow_new_folder=req.allow_new_folder)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Folder picker failed: {exc}"
        ) from exc
    if not path:
        return BrowseFolderResponse(path=None, cancelled=True)
    return BrowseFolderResponse(path=path, cancelled=False)


@router.post("/browse-file", response_model=BrowseFileResponse)
def browse_file(body: BrowseFileRequest | None = None) -> BrowseFileResponse:
    """Open a native OS file picker for DEM / shapefile selection."""
    req = body or BrowseFileRequest()
    try:
        path = pick_file(req.title, filetypes=req.filetypes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"File picker failed: {exc}") from exc
    if not path:
        return BrowseFileResponse(path=None, cancelled=True)
    return BrowseFileResponse(path=path, cancelled=False)


@router.post("/open", response_model=ProjectInfo)
def open_project(body: OpenProjectRequest) -> ProjectInfo:
    return project_service.open_project(body.path)


@router.post("/create", response_model=ProjectInfo)
def create_project(body: CreateProjectRequest) -> ProjectInfo:
    return project_service.create_project(body.path, name=body.name)


@router.get("/current", response_model=ProjectInfo)
def current_project() -> ProjectInfo:
    return project_service.current()


@router.put("/crs", response_model=ProjectInfo)
def set_project_crs(body: ProjectCrsRequest) -> ProjectInfo:
    """Set the active project's engineering CRS (stored in .saturday-swmm.json)."""
    return project_service.set_crs(body.crs)


@router.put("/simulation-engine", response_model=ProjectInfo)
def set_simulation_engine(body: ProjectSimulationEngineRequest) -> ProjectInfo:
    """Set simulation engine: openswmm (default), pyswmm (EPA SWMM 5) or flow_accum."""
    return project_service.set_simulation_engine(body.simulation_engine)


@router.get("/package")
def review_package():
    """The model, its results and a small manifest in one .zip for the browser viewer."""
    import io
    import json
    import zipfile
    from datetime import datetime, timezone

    from fastapi.responses import Response

    from app.version import APP_VERSION

    info = project_service.current()
    inp = project_service.require_inp()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(inp, inp.name)
        for p in (inp.with_suffix(".rpt"), inp.with_suffix(".out")):
            if p.is_file():
                z.write(p, p.name)
        z.writestr(
            "saturday-swmm-review.json",
            json.dumps(
                {
                    "model": inp.name,
                    "scenario": info.scenario_name,
                    "crs": info.crs,
                    "crs_proj4": info.crs_proj4,
                    "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "app_version": APP_VERSION,
                    "results_stale": info.results_stale,
                },
                indent=2,
            ),
        )
    name = f"{inp.stem}-{info.scenario_name}-review.zip".replace(" ", "_")
    return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/files/dat", response_model=list[ProjectDatFileInfo])
def list_dat_files() -> list[ProjectDatFileInfo]:
    return [ProjectDatFileInfo(**f) for f in project_service.list_dat_files()]


@router.get("/files/{filename}/span", response_model=RainFileSpan)
def rain_file_span(filename: str) -> RainFileSpan:
    return RainFileSpan(**project_service.rain_file_span(filename))


@router.get("/files/{filename}", response_model=ProjectFileContent)
def read_project_file(
    filename: str,
    optional: bool = Query(default=False, description="Answer exists=false instead of 404 when the file is absent"),
) -> ProjectFileContent:
    try:
        return ProjectFileContent(**project_service.read_project_file(filename))
    except HTTPException as exc:
        if optional and exc.status_code == 404:
            return ProjectFileContent(filename=filename, content="", exists=False)
        raise


@router.delete("/files/{filename}", response_model=ProjectInfo)
def delete_project_file(filename: str) -> ProjectInfo:
    return project_service.delete_project_file(filename)


@router.post("/files", response_model=ProjectInfo)
def write_project_file(body: WriteProjectFileRequest) -> ProjectInfo:
    """Write a text file (e.g. design_storm.dat) into the open project folder."""
    return project_service.write_project_file(body.filename, body.content)


inp_router = APIRouter(prefix="/api", tags=["inp"])


@inp_router.get("/inp", response_model=InpContent)
def get_inp() -> InpContent:
    return InpContent(text=project_service.read_inp())


@inp_router.put("/inp", response_model=InpContent)
def save_inp(body: SaveInpRequest) -> InpContent:
    from app.services.inp_model_service import inp_model_service

    project_service.write_inp(body.text)
    inp_model_service.invalidate()
    return InpContent(text=body.text)
