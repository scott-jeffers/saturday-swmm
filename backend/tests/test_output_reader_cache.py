"""OutputReader session cache behavior."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.services.output_service import OutputService


def test_open_reuses_handle_until_invalidate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    out_file = tmp_path / "model.out"
    out_file.write_bytes(b"dummy")

    instances: list[MagicMock] = []

    class FakeReader:
        def __init__(self, path: str):
            self.path = path
            self.closed = False
            instances.append(self)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.closed = True

        def close(self):
            self.closed = True

    monkeypatch.setattr(
        "openswmm.engine.OutputReader",
        FakeReader,
        raising=False,
    )

    # Patch import path used inside _require_out
    import app.services.output_service as mod

    def fake_require(self, out_path: Path):
        if not out_path.is_file():
            raise AssertionError("missing")
        return FakeReader

    monkeypatch.setattr(OutputService, "_require_out", fake_require)

    svc = OutputService()
    h1 = svc._open(out_file)
    h2 = svc._open(out_file)
    assert h1 is h2
    assert len(instances) == 1

    svc.invalidate()
    assert instances[0].closed is True

    h3 = svc._open(out_file)
    assert h3 is not h1
    assert len(instances) == 2
    svc.invalidate()
