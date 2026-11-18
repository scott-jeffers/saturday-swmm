"""Build the EPSG list the browser viewer searches: frontend/public/crs-epsg.json.

    python scripts/export_crs_catalog.py

Rows are [code, name, area of use, proj4]; only CRSs PROJ can express as a
proj4 string are kept (that is what the map reprojection needs).
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

from pyproj import CRS
from pyproj.database import query_crs_info
from pyproj.enums import PJType

OUT = Path(__file__).resolve().parents[1] / "frontend" / "public" / "crs-epsg.json"


def main() -> None:
    rows = []
    infos = query_crs_info(auth_name="EPSG", pj_types=[PJType.PROJECTED_CRS, PJType.GEOGRAPHIC_2D_CRS])
    warnings.simplefilter("ignore")
    seen: set[int] = set()
    for info in infos:
        if info.deprecated or int(info.code) in seen:
            continue
        seen.add(int(info.code))
        try:
            p4 = CRS.from_epsg(int(info.code)).to_proj4()
        except Exception:
            continue
        if not p4:
            continue
        area = info.area_of_use.name if info.area_of_use else ""
        rows.append([int(info.code), info.name, area, p4.replace(" +type=crs", "")])
    rows.sort(key=lambda r: r[0])
    OUT.write_text(json.dumps(rows, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(rows)} CRSs to {OUT}")


if __name__ == "__main__":
    main()
