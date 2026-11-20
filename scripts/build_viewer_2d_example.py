"""Package a finished 1D-2D run for the browser viewer.

    python scripts/build_viewer_2d_example.py <project_dir> <outdir> [name]

Reads the run through the app's own 2D API (so the mesh and the per-cell
values line up exactly as on the desktop map) and writes, into <outdir>:

    <name>.inp, <name>.rpt, <name>.out   the model and its 1D results
    <name>.ss2d.gz                       mesh + depth per report period (see
                                         frontend/src/viewer/twod.ts)

Depths are stored as whole millimetres (uint16), which keeps a day-long run
of a 150k-cell mesh to a few MB once gzipped.
"""

from __future__ import annotations

import gzip
import json
import shutil
import struct
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

H = {"X-Saturday-SWMM": "1"}
DEPTH_SCALE = 0.001  # stored unit: millimetres


def main() -> int:
    proj = Path(sys.argv[1]).resolve()
    out_dir = Path(sys.argv[2]).resolve()
    name = sys.argv[3] if len(sys.argv) > 3 else "bellinge-2d"
    out_dir.mkdir(parents=True, exist_ok=True)

    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app, base_url="http://127.0.0.1:8000")
    r = c.post("/api/projects/open", json={"path": str(proj)}, headers=H)
    r.raise_for_status()
    info = r.json()
    crs = info.get("crs")

    tinfo = c.get("/api/2d/info").json()
    mesh = c.get("/api/2d/mesh").json()
    verts = np.asarray(mesh["vertices"], dtype=np.float64)
    tris = np.asarray(mesh["triangles"], dtype=np.uint32)
    periods = c.get("/api/2d/periods").json()
    n_p = int(periods["period_count"])
    n_t = len(tris)

    def binary(path: str) -> np.ndarray:
        resp = c.get(path)
        resp.raise_for_status()
        arr = np.frombuffer(resp.content, dtype=np.float32)
        if arr.size != n_t:
            raise SystemExit(f"{path}: {arr.size} values for {n_t} triangles")
        return arr

    env = binary("/api/2d/envelope/binary?variable=depth")
    depth = np.empty((n_p, n_t), dtype=np.uint16)
    pmax: list[float] = []
    for p in range(n_p):
        v = np.nan_to_num(binary(f"/api/2d/snapshot/binary?period={p}&variable=depth"), nan=0.0)
        v = np.clip(v, 0.0, 65.535)
        depth[p] = np.rint(v / DEPTH_SCALE).astype(np.uint16)
        pmax.append(float(v.max()))

    times_sec = periods.get("times_sec") or [float(i) for i in range(n_p)]
    step = float(times_sec[1] - times_sec[0]) if len(times_sec) > 1 else 0.0
    header = {
        "crs": crs,
        "vertex_count": int(len(verts)),
        "triangle_count": int(n_t),
        "period_count": n_p,
        "times": periods.get("times") or [str(i) for i in range(n_p)],
        "times_sec": times_sec,
        "report_step_sec": step,
        "dry_depth": float(tinfo.get("dry_depth") or 0.0001),
        "depth_scale": DEPTH_SCALE,
        "unit": "m",
        "period_max": pmax,
        "peak_depth_max": float(np.nan_to_num(env).max()),
        "source": tinfo.get("mesh_file"),
    }
    hb = json.dumps(header, separators=(",", ":")).encode()
    head = b"SS2D" + struct.pack("<II", 1, len(hb)) + hb
    head += b"\0" * ((-len(head)) % 8)
    payload = b"".join(
        [
            head,
            verts.astype("<f8").tobytes(),
            tris.astype("<u4").tobytes(),
            np.nan_to_num(env).astype("<f4").tobytes(),
            depth.astype("<u2").tobytes(),
        ]
    )
    pkg = out_dir / f"{name}.ss2d.gz"
    with gzip.open(pkg, "wb", compresslevel=9) as f:
        f.write(payload)

    inp = Path(info["inp_path"])
    shutil.copy(inp, out_dir / f"{name}.inp")
    for ext in (".rpt", ".out"):
        src = inp.with_suffix(ext)
        if src.is_file():
            shutil.copy(src, out_dir / f"{name}{ext}")
    print(
        f"{pkg.name}: {pkg.stat().st_size / 1e6:.1f} MB "
        f"({len(verts):,} vertices, {n_t:,} triangles, {n_p} periods, peak {header['peak_depth_max']:.2f} m)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
