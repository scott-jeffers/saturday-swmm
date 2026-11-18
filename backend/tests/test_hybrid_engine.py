"""Coupling-law and Basilisk surface tests (solver tests skip without one)."""

import numpy as np
import pytest

from app.services.hybrid.basilisk_ipc import fill_nodata
from app.services.hybrid.coupled_engine import MassBalance, drain_requests


def _drain(**kw):
    base = dict(
        head=np.array([0.0]), flooding=np.array([0.0]), depth_m=np.array([0.2]),
        bed_m=np.array([10.0]), cell_area_m2=np.array([100.0]), cd=np.array([0.67]),
        area_m2=np.array([0.1]), len_to_m=1.0, dt=10.0, dry=1e-3, max_fraction=0.9,
    )
    base.update(kw)
    return drain_requests(**base)


def test_free_drainage_uses_surface_depth():
    q = _drain(head=np.array([8.0]))  # pipe head below ground
    assert q[0] == pytest.approx(0.67 * 0.1 * np.sqrt(2 * 9.81 * 0.2))


def test_no_drainage_when_dry_flooding_or_pipe_above_surface():
    assert _drain(depth_m=np.array([0.0]))[0] == 0.0
    assert _drain(flooding=np.array([1.0]))[0] == 0.0
    assert _drain(head=np.array([10.5]))[0] == 0.0     # pipe head above WSE 10.2


def test_drainage_limited_by_available_volume():
    q = _drain(head=np.array([0.0]), area_m2=np.array([100.0]))
    assert q[0] == pytest.approx(0.9 * 0.2 * 100.0 / 10.0)


def test_mass_balance_error():
    m = MassBalance(flood_to_2d_m3=100, runoff_to_2d_m3=50, drained_from_2d_m3=30,
                    boundary_loss_m3=20, stored_2d_m3=100)
    assert m.error_m3 == pytest.approx(0.0)


def test_fill_nodata_has_no_holes():
    a = np.random.rand(64, 64).astype("f4")
    a[10:50, 5:30] = np.nan
    f = fill_nodata(a)
    assert np.isfinite(f).all()
    assert f.min() >= a[np.isfinite(a)].min() - 1e-6


def test_basilisk_solver_self_test_if_available():
    from app.services.hybrid.basilisk_runner import resolve_surface_solver, self_test

    solver, log = resolve_surface_solver(refresh=True)
    if solver is None:
        pytest.skip("no Basilisk surface solver on this machine: " + log[-200:])
    ok, msg = self_test(solver.command)
    assert ok, msg
