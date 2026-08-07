"""Binary 2D snapshot / envelope API contract tests."""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import pytest

h5py = pytest.importorskip("h5py")

from app.services.twod_output_service import TwoDOutputService


def _write_mini_h5(path: Path, *, n_periods: int = 3, n_faces: int = 4) -> None:
    depth = np.arange(n_periods * n_faces, dtype=np.float32).reshape(n_periods, n_faces) * 0.01
    max_depth = depth.max(axis=0)
    with h5py.File(path, "w") as f:
        f.create_dataset("Mesh2_face_depth", data=depth)
        f.create_dataset("Mesh2_face_max_depth", data=max_depth)
        f.create_dataset("time", data=np.arange(n_periods, dtype=np.float64) * 0.001)


def test_snapshot_binary_byte_length_and_minmax(tmp_path: Path):
    svc = TwoDOutputService()
    h5 = tmp_path / "t.2d.h5"
    _write_mini_h5(h5, n_periods=2, n_faces=5)
    try:
        snap = svc.snapshot_binary(h5, 1, variable="depth")
        assert snap.triangle_count == 5
        assert len(snap.body) == 5 * 4
        values = np.frombuffer(snap.body, dtype=np.float32)
        assert values.shape == (5,)
        assert abs(snap.value_min - float(values.min())) < 1e-5
        assert abs(snap.value_max - float(values.max())) < 1e-5
        assert float(values[0]) == pytest.approx(0.05, abs=1e-5)
    finally:
        svc.invalidate()


def test_envelope_binary_uses_max_depth_dataset(tmp_path: Path):
    svc = TwoDOutputService()
    h5 = tmp_path / "t.2d.h5"
    _write_mini_h5(h5, n_periods=3, n_faces=4)
    try:
        env = svc.envelope_binary(h5, variable="depth")
        assert env.period == -1
        assert len(env.body) == 4 * 4
        values = np.frombuffer(env.body, dtype=np.float32)
        assert float(values[0]) == pytest.approx(0.08, abs=1e-5)
    finally:
        svc.invalidate()


def test_periods_peak_from_max_depth_not_full_cube(tmp_path: Path):
    svc = TwoDOutputService()
    h5 = tmp_path / "t.2d.h5"
    _write_mini_h5(h5)
    try:
        resp = svc.periods(h5)
        assert resp.period_count == 3
        assert resp.peak_depth_max is not None
        assert resp.peak_depth_max == pytest.approx(0.11, abs=1e-4)
    finally:
        svc.invalidate()
