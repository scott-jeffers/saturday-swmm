"""Build the LID sample's two scenarios and their results.

    python scripts/build_lid_scenarios.py

* examples/LID_Sample/LID_Sample.inp is the Base scenario, named "With LID".
* scenarios/no-lid/LID_Sample.inp is "No LID (fully impervious)": the same
  model with every [LID_USAGE] row removed and every subcatchment 100 %
  impervious, so the two runs show what the green infrastructure does.

Both are run with EPA SWMM 5 (PySWMM). The .rpt/.out go next to each .inp,
so the app opens the example ready to compare, and to
frontend/public/examples/lid-sample/ for the browser viewer.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.epa_inp import sanitize_for_pyswmm  # noqa: E402  (stdlib only)
from app.services.lid_reports import report_dir, with_lid_reports  # noqa: E402

EX = ROOT / "examples" / "LID_Sample"
BASE = EX / "LID_Sample.inp"
SCEN_DIR = EX / "scenarios" / "no-lid"
VIEWER = ROOT / "frontend" / "public" / "examples" / "lid-sample"
NO_LID_NAME = "No LID (fully impervious)"

TITLE = """[TITLE]
;;Project Title/Notes
LID sample, No LID scenario: the same sewer and storm with no green infrastructure
and every subcatchment fully impervious (100 %). Compare with the With LID scenario.
"""


def no_lid(text: str) -> str:
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    section = ""
    for ln in lines:
        s = ln.strip()
        if s.startswith("[") and s.endswith("]"):
            section = s[1:-1].upper()
            out.append(ln)
            continue
        data = s and not s.startswith(";")
        if section == "LID_USAGE" and data:
            continue
        if section == "SUBCATCHMENTS" and data:
            # Name Gage Outlet Area %Imperv …: set the 5th field, keep the spacing
            m = re.match(r"^(\s*(?:\S+\s+){4})(\S+)(\s+)(.*)$", ln, re.S)
            if m:
                width = len(m.group(2)) + len(m.group(3))
                ln = m.group(1) + "100".ljust(max(width, 4)) + m.group(4)
        out.append(ln)
    text = "".join(out)
    return re.sub(r"\[TITLE\].*?(?=\n\[)", TITLE.rstrip("\n"), text, count=1, flags=re.S)


def run(inp: Path) -> tuple[Path, Path]:
    from pyswmm import Simulation

    tmp = Path(tempfile.mkdtemp())
    # Each LID unit writes its own report into .<model>.lid/ (as the app's runs do).
    text, _ = with_lid_reports(inp.read_text(encoding="utf-8"), inp)
    epa_text, _ = sanitize_for_pyswmm(text)
    epa = tmp / inp.name
    epa.write_text(epa_text, encoding="utf-8")
    rpt, out = epa.with_suffix(".rpt"), epa.with_suffix(".out")
    with Simulation(str(epa), str(rpt), str(out)) as sim:
        for _ in sim:
            pass
    return rpt, out


def main() -> int:
    base_text = BASE.read_text(encoding="utf-8")
    SCEN_DIR.mkdir(parents=True, exist_ok=True)
    child = SCEN_DIR / BASE.name
    child.write_text(no_lid(base_text), encoding="utf-8")
    # the parent as it was when the scenario was made (for "Changes vs parent")
    (SCEN_DIR / ".parent.inp").write_text(base_text, encoding="utf-8")
    index = {
        "version": 1,
        "scenarios": [
            {"id": "base", "name": "With LID", "parent": None, "inp": BASE.name, "created": "2026-11-21T00:00:00+00:00",
             "description": "Green infrastructure in every subcatchment."},
            {"id": "s-nolid", "name": NO_LID_NAME, "parent": "base", "inp": f"scenarios/no-lid/{BASE.name}",
             "created": "2026-11-21T00:00:00+00:00",
             "description": "No LID controls; every subcatchment 100 % impervious."},
        ],
    }
    (EX / "scenarios.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")

    VIEWER.mkdir(parents=True, exist_ok=True)
    for inp, viewer_stem in ((BASE, "lid-sample"), (child, "lid-sample-nolid")):
        rpt, out = run(inp)
        shutil.copy(rpt, inp.with_suffix(".rpt"))
        shutil.copy(out, inp.with_suffix(".out"))
        shutil.copy(rpt, VIEWER / f"{viewer_stem}.rpt")
        shutil.copy(out, VIEWER / f"{viewer_stem}.out")
        print(f"ran {inp.relative_to(ROOT)} -> {viewer_stem}.out ({out.stat().st_size // 1024} KB)")
    shutil.copy(BASE, VIEWER / "lid-sample.inp")
    # The viewer's copy of the LID reports, with a list it can fetch.
    vdir = VIEWER / "lid-sample.lid"
    shutil.rmtree(vdir, ignore_errors=True)
    vdir.mkdir()
    names = sorted(p.name for p in report_dir(BASE).glob("*.txt"))
    for n in names:
        shutil.copy(report_dir(BASE) / n, vdir / n)
    (vdir / "index.json").write_text(json.dumps(names, indent=1) + "\n", encoding="utf-8")
    print(f"{len(names)} LID reports")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
