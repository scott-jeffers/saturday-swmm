"""Hybrid coupling / surface / stub surface tests (no Basilisk required)."""

from pathlib import Path

import numpy as np

from app.models.schemas import HybridCoupling, HybridCouplingPoint, HybridSurface
from app.services.hybrid.basilisk_codegen import generate_coupled_surface_c
from app.services.hybrid.basilisk_runner import create_stub_state
from app.services.hybrid.coupling_model import load_coupling, save_coupling
from app.services.hybrid.hybrid_output_service import HybridOutputService
from app.services.hybrid.surface_model import load_surface, save_surface


def test_surface_and_coupling_roundtrip(tmp_path: Path):
    surface = HybridSurface(
        domain_polygon=[[0, 0], [100, 0], [100, 80], [0, 80], [0, 0]],
        mannings_n=0.025,
        max_level=9,
        rainfall_mode="subcatchments",
    )
    save_surface(tmp_path, surface)
    loaded = load_surface(tmp_path)
    assert loaded.mannings_n == 0.025
    assert len(loaded.domain_polygon) == 5

    coupling = HybridCoupling(
        points=[
            HybridCouplingPoint(node_id="J1", x=50, y=40, cd=0.6, exchange_area=2.0),
        ]
    )
    save_coupling(tmp_path, coupling)
    c2 = load_coupling(tmp_path)
    assert len(c2.points) == 1
    assert c2.points[0].node_id == "J1"


def test_driver_refines_on_depth_and_discharge_not_terrain(tmp_path: Path):
    surface = HybridSurface(domain_polygon=[[0, 0], [200, 0], [200, 100], [0, 100]])
    coupling = HybridCoupling(points=[HybridCouplingPoint(node_id="MH1", x=100, y=50)])
    path = generate_coupled_surface_c(tmp_path, surface, coupling)
    text = path.read_text(encoding="utf-8")
    assert "adapt_wavelet" in text
    # depth + unit discharge: never eta (bare terrain), never raw velocity (thin films)
    # ("active" is the wet/dry front marker, refined alongside h and q)
    assert "adapt_wavelet ({h, q.x, q.y, active}" in text
    assert "adapt_wavelet ({eta" not in text
    # mass-conservative reconstruction: elevation-conserving refinement is off
    assert "\n  conserve_elevation();" not in text


def test_stub_surface_injects_and_samples(tmp_path: Path):
    surface = HybridSurface(domain_polygon=[[0, 0], [64, 0], [64, 64], [0, 64]])
    coupling = HybridCoupling(
        points=[HybridCouplingPoint(node_id="J1", x=32, y=32)]
    )
    stub = create_stub_state(surface, coupling, nx=16, ny=16)
    before = stub.sample_at_couplings()[0]
    stub.step(10.0, [0.5])  # 0.5 m3/s for 10 s
    after = stub.sample_at_couplings()[0]
    assert after > before


def test_hybrid_output_binary_roundtrip(tmp_path: Path):
    svc = HybridOutputService()
    depths = np.zeros((3, 16), dtype=np.float32)
    depths[1, 5] = 1.25
    svc.save_results(
        tmp_path,
        depths=depths,
        times=["t0", "t1", "t2"],
        nx=4,
        ny=4,
        xmin=0,
        ymin=0,
        xmax=40,
        ymax=40,
    )
    periods = svc.periods(tmp_path)
    assert periods["period_count"] == 3
    snap = svc.snapshot_binary(tmp_path, 1)
    # 16 cells × 2 triangles/cell for compact mesh coloring
    assert snap.triangle_count == 32
    assert snap.value_max >= 1.2
    assert len(snap.body) == 32 * 4
