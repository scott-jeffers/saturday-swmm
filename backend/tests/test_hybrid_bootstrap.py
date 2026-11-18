"""Bootstrap auto domain / coupling from a tiny INP."""

from pathlib import Path

from app.services.hybrid.bootstrap import bootstrap_hybrid
from app.services.hybrid.coupling_model import load_coupling
from app.services.hybrid.paths import basilisk_source_path, sanitized_inp_path
from app.services.hybrid.surface_model import load_surface

TINY_INP = """[TITLE]
Tiny hybrid bootstrap

[OPTIONS]
FLOW_UNITS           CMS
INFILTRATION         HORTON
FLOW_ROUTING         DYNWAVE
START_DATE           01/01/2020
START_TIME           00:00:00
END_DATE             01/01/2020
END_TIME             01:00:00
REPORT_STEP          00:05:00
ROUTING_STEP         1

[JUNCTIONS]
J1               10      2
J2               10      2
;; no coords for J3 — should be skipped
J3               10      2

[STORAGE]
S1               10      3      0      TABULAR  curve1

[OUTFALLS]
O1               9       FREE

[CONDUITS]
C1               J1      J2      50      0.01    0       0       0       0
C2               J2      O1      40      0.01    0       0       0       0

[XSECTIONS]
C1               CIRCULAR 0.5     0       0       0       1
C2               CIRCULAR 0.5     0       0       0       1

[COORDINATES]
J1               100     200
J2               150     220
S1               120     210
O1               200     230

[END]
"""


def test_bootstrap_domain_and_coupling(tmp_path: Path):
    inp = tmp_path / "tiny.inp"
    inp.write_text(TINY_INP, encoding="utf-8")

    result = bootstrap_hybrid(tmp_path, inp)
    assert result["ok"] is True
    assert result["domain_auto"] is True
    # J1, J2, S1 — J3 skipped (no coords), O1 is outfall not coupled
    assert result["coupling_count"] == 3
    from app.services.hybrid.basilisk_runner import resolve_surface_solver

    solver, _ = resolve_surface_solver()
    assert result["used_stub"] is (solver is None)

    surface = load_surface(tmp_path)
    ring = surface.domain_polygon
    assert len(ring) >= 4
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    # Network bbox 100–200 x, 200–230 y expanded 10%
    assert min(xs) < 100
    assert max(xs) > 200
    assert min(ys) < 200
    assert max(ys) > 230

    coupling = load_coupling(tmp_path)
    ids = {p.node_id for p in coupling.points}
    assert ids == {"J1", "J2", "S1"}

    assert basilisk_source_path(tmp_path).is_file()
    assert sanitized_inp_path(tmp_path).is_file()

    # Idempotent: second call keeps existing domain/coupling
    result2 = bootstrap_hybrid(tmp_path, inp)
    assert result2["domain_auto"] is False
    assert result2["coupling_count"] == 3
