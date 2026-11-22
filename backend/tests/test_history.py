"""Version history: compare restore points, optional Git, project package."""

from __future__ import annotations

import io
import shutil
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

INP = "[OPTIONS]\nFLOW_UNITS CFS\n\n[JUNCTIONS]\nJ1 10 5\nJ2 9 5\n\n[OUTFALLS]\nO1 8 FREE\n\n[CONDUITS]\nC1 J1 J2 100 0.013 0 0\nC2 J2 O1 100 0.013 0 0\n\n[XSECTIONS]\nC1 CIRCULAR 1 0 0 0 1\nC2 CIRCULAR 1 0 0 0 1\n\n[COORDINATES]\nJ1 0 0\nJ2 100 0\nO1 200 0\n"
H = {"X-Saturday-SWMM": "1"}


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    (tmp_path / "m.inp").write_text(INP, encoding="utf-8")
    (tmp_path / "rain.dat").write_text("RG1 2024 6 1 0 0 0.1\n", encoding="utf-8")
    (tmp_path / "m.out").write_bytes(b"x" * 100)
    c = TestClient(app, headers=H)
    assert c.post("/api/projects/open", json={"path": str(tmp_path)}).status_code == 200
    return c


def test_compare_a_version_with_now(client: TestClient, tmp_path: Path) -> None:
    v = client.post("/api/snapshots", json={"label": "Design 1"}).json()
    assert client.patch("/api/model/objects/node/J1", json={"elevation": 12}).status_code == 200
    r = client.get(f"/api/snapshots/{v['id']}/compare").json()
    assert r["counts"]["modified"] == 1
    assert r["changes"][0]["id"] == "J1" and r["changes"][0]["object"] == "node"


def test_project_package_leaves_results_out(client: TestClient, tmp_path: Path) -> None:
    client.post("/api/snapshots", json={"label": "Keep me"})
    z = zipfile.ZipFile(io.BytesIO(client.get("/api/projects/package/full").content))
    names = [n.split("/", 1)[1] for n in z.namelist()]
    assert "m.inp" in names and "rain.dat" in names
    assert "m.out" not in names
    assert any(n.startswith("snapshots/") and n.endswith(".inp.z") for n in names)


@pytest.mark.skipif(not shutil.which("git"), reason="git not installed")
def test_git_commit_on_save(client: TestClient, tmp_path: Path) -> None:
    assert client.get("/api/snapshots/git").json()["repo"] is False
    st = client.post("/api/snapshots/git/init").json()
    assert st["repo"] is True and "*.out" in (tmp_path / ".gitignore").read_text()
    r = client.post("/api/snapshots", json={"label": "First design", "git_commit": True}).json()
    assert r["git"]["commits"][0]["message"] == "First design"
