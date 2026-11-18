"""Run the Bellinge example for the browser viewer's "Open the example".

    python scripts/build_viewer_example.py <outdir>

Writes bellinge.inp/.rpt/.out to <outdir> (the Website workflow uses
frontend/dist-viewer/examples). The 94 MB results of the full model are too
big for git, so they are made at deploy time: EPA SWMM 5 via PySWMM, with a
5-minute reporting step to keep the download near 20 MB.
"""

from __future__ import annotations

import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.epa_inp import sanitize_for_pyswmm  # noqa: E402  (stdlib only)

SRC = ROOT / "examples" / "Bellinge_SWMM" / "BellingeSWMM_v021_nopervious.inp"
REPORT_STEP = "00:05:00"


def main() -> int:
    out_dir = Path(sys.argv[1]).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    text = SRC.read_text(encoding="utf-8", errors="replace")
    text, n = re.subn(r"(?m)^(REPORT_STEP\s+)\S+", rf"\g<1>{REPORT_STEP}", text)
    if n != 1:
        raise SystemExit("REPORT_STEP not found in the Bellinge model")
    inp = out_dir / "bellinge.inp"
    inp.write_text(text, encoding="utf-8")

    from pyswmm import Simulation

    with tempfile.TemporaryDirectory() as tmp:
        epa_text, _ = sanitize_for_pyswmm(text)
        epa = Path(tmp) / "bellinge.inp"
        epa.write_text(epa_text, encoding="utf-8")
        rpt, out = Path(tmp) / "bellinge.rpt", Path(tmp) / "bellinge.out"
        t0 = time.time()
        with Simulation(str(epa), str(rpt), str(out)) as sim:
            for _ in sim:
                pass
        shutil.copy(rpt, out_dir / "bellinge.rpt")
        shutil.copy(out, out_dir / "bellinge.out")
    size = (out_dir / "bellinge.out").stat().st_size / 1e6
    print(f"Bellinge example ready in {out_dir} ({time.time() - t0:.0f} s, .out {size:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
