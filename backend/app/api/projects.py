from __future__ import annotations

from fastapi import APIRouter, HTTPException

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
    """Set simulation engine: openswmm (default) or hybrid (PySWMM + Basilisk)."""
    return project_service.set_simulation_engine(body.simulation_engine)


@router.get("/files/dat", response_model=list[ProjectDatFileInfo])
def list_dat_files() -> list[ProjectDatFileInfo]:
    return [ProjectDatFileInfo(**f) for f in project_service.list_dat_files()]


@router.get("/files/{filename}/span", response_model=RainFileSpan)
def rain_file_span(filename: str) -> RainFileSpan:
    return RainFileSpan(**project_service.rain_file_span(filename))


@router.get("/files/{filename}", response_model=ProjectFileContent)
def read_project_file(filename: str) -> ProjectFileContent:
    return ProjectFileContent(**project_service.read_project_file(filename))


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
