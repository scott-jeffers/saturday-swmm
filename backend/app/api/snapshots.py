"""Named model snapshots (services/snapshot_service.py)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.services.snapshot_service import snapshot_service

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


class SnapshotCreate(BaseModel):
    label: str = ""
    #: Also commit the model files to Git (when the project is a repository).
    git_commit: bool = False


class SnapshotRename(BaseModel):
    label: str


@router.get("")
def list_snapshots() -> dict:
    return snapshot_service.list()


@router.post("")
def create_snapshot(body: SnapshotCreate) -> dict:
    meta = snapshot_service.create(body.label, auto=False)
    if body.git_commit:
        from app.services import git_service
        from app.services.project_service import project_service

        root = project_service.require_root()
        files = [project_service.require_inp()]
        for extra in ("scenarios.json", ".gitignore"):
            files.append(root / extra)
        for d in ("scenarios", "storms"):
            if (root / d).is_dir():
                files += [p for p in (root / d).rglob("*") if p.is_file() and p.suffix.lower() in (".inp", ".json", ".dat", ".txt") and ".storms" not in p.parts]
        files += [p for p in root.glob("*") if p.is_file() and p.suffix.lower() in (".dat", ".txt", ".csv") and p.stat().st_size < 50_000_000]
        meta = {**meta, "git": git_service.commit(root, files, body.label or meta["label"])}
    return meta


@router.get("/git")
def git_status() -> dict:
    """Whether Git is installed and the project is a repository, with its recent commits."""
    from app.services import git_service
    from app.services.project_service import project_service

    return git_service.status(project_service.require_root())


@router.post("/git/init")
def git_init() -> dict:
    """Turn the project folder into a Git repository (results and caches ignored)."""
    from app.services import git_service
    from app.services.project_service import project_service

    return git_service.init(project_service.require_root())


@router.get("/{sid}/compare")
def compare_snapshot(sid: str, against: str = "current") -> dict:
    """Element by element: what changed from this version to the model now (or to another version)."""
    from app.services.project_service import project_service
    from app.services.scenario_service import compare_inp

    old = snapshot_service.text(sid)
    new = project_service.require_inp().read_text(encoding="utf-8", errors="replace") if against == "current" else snapshot_service.text(against)
    changes = compare_inp(old, new)
    counts = {k: sum(1 for c in changes if c["change"] == k) for k in ("added", "removed", "modified")}
    return {"from": sid, "to": against, "changes": changes, "counts": counts}


@router.get("/{sid}/text", response_class=PlainTextResponse)
def snapshot_text(sid: str) -> str:
    return snapshot_service.text(sid)


@router.post("/{sid}/restore")
def restore_snapshot(sid: str) -> dict:
    return snapshot_service.restore(sid)


@router.patch("/{sid}")
def rename_snapshot(sid: str, body: SnapshotRename) -> dict:
    return snapshot_service.rename(sid, body.label)


@router.delete("/{sid}")
def delete_snapshot(sid: str) -> dict:
    return snapshot_service.delete(sid)
