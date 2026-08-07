"""Ensure periods() never materializes a large Mesh2_face_depth cube."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.services.twod_output_service import TwoDOutputService


def test_periods_omits_peak_when_max_depth_missing(monkeypatch: pytest.MonkeyPatch):
    svc = TwoDOutputService()

    class FakeDepth:
        shape = (10_000, 50_000)  # huge on purpose

        def __getitem__(self, key):
            raise AssertionError("Mesh2_face_depth must not be fully sliced for periods()")

    handle = {
        "Mesh2_face_depth": FakeDepth(),
        # no Mesh2_face_max_depth
    }

    monkeypatch.setattr(svc, "_open", lambda path: handle)
    monkeypatch.setattr(svc, "_period_count", lambda h: 10_000)
    monkeypatch.setattr(svc, "_time_labels", lambda h, n: ([str(i) for i in range(n)], list(range(n))))

    resp = svc.periods(Path("fake.2d.h5"))
    assert resp.period_count == 10_000
    assert resp.peak_depth_max is None


def test_envelope_chunked_path_never_full_slice(monkeypatch: pytest.MonkeyPatch):
    svc = TwoDOutputService()
    import numpy as np

    n_periods, n_faces = 64, 8
    data = np.arange(n_periods * n_faces, dtype=np.float32).reshape(n_periods, n_faces)

    class FakeDs:
        shape = (n_periods, n_faces)
        dtype = np.dtype("float32")

        def __getitem__(self, key):
            # Allow row / chunk slices only — reject bare [:]
            if key == slice(None) or key == ():
                raise AssertionError("full ds[:] not allowed for large envelope")
            return data[key]

    handle = {
        "Mesh2_face_depth": FakeDs(),
        "Mesh2_face_vx": FakeDs(),  # unused
    }
    # Force large-file path
    monkeypatch.setattr(
        "app.services.twod_output_service._dataset_size_bytes",
        lambda ds: 200 * 1024 * 1024,
    )
    monkeypatch.setattr(svc, "_open", lambda path: handle)

    env = svc.envelope_binary(Path("fake.2d.h5"), variable="depth")
    values = np.frombuffer(env.body, dtype=np.float32)
    expected = data.max(axis=0)
    assert np.allclose(values, expected)
