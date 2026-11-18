"""EPA SWMM 5 (PySWMM) standalone engine."""

from __future__ import annotations

import shutil
import time
from pathlib import Path

import pytest

pyswmm = pytest.importorskip("pyswmm")

from app.models.schemas import RunStatus  # noqa: E402
from app.services.pyswmm_run_service import PySwmmRunService, prepare_epa_inp  # noqa: E402

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample.inp"


def _wait(svc: PySwmmRunService, timeout: float = 60.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = svc.status()
        if st.status != RunStatus.running:
            return st
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def test_prepare_strips_openswmm_only_content(tmp_path: Path):
    inp = tmp_path / "m.inp"
    inp.write_text(
        SAMPLE.read_text(encoding="utf-8") + "\n[2D_OPTIONS]\nFOO 1\n",
        encoding="utf-8",
    )
    epa, notes = prepare_epa_inp(inp)
    text = epa.read_text(encoding="utf-8")
    assert "[END]" not in text and "[2D_OPTIONS]" not in text
    assert any("2D" in n for n in notes)
    assert epa.name.startswith(".") and epa.parent == inp.parent


def test_pyswmm_run_produces_readable_out(tmp_path: Path):
    inp = tmp_path / "sample.inp"
    shutil.copy(SAMPLE, inp)
    svc = PySwmmRunService()
    st = svc.start(inp, inp.with_suffix(".rpt"), inp.with_suffix(".out"), live_rendering=True)
    assert st.engine == "pyswmm"
    st = _wait(svc)
    assert st.status == RunStatus.completed, st.error
    assert st.progress == 100.0
    # temp EPA copy is cleaned up; results are where the app expects them
    assert not list(tmp_path.glob(".*.epa-swmm5.inp"))
    from openswmm.engine import OutputReader

    r = OutputReader(str(inp.with_suffix(".out")))
    assert r.period_count > 0 and "J1" in list(r.node_ids)
    r.close()
