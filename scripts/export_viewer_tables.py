"""Write the SWMM tables the browser viewer shares with the backend.

    python scripts/export_viewer_tables.py          # write
    python scripts/export_viewer_tables.py --check  # fail if out of date (CI)

Single source of truth stays in backend/app/services; the viewer reads
frontend/src/viewer/tables.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services import model_tools_service as mt  # noqa: E402
from app.services import output_service as osv  # noqa: E402
from app.services import rpt_service as rs  # noqa: E402
from app.services import run_archive_service as ra  # noqa: E402

OUT = ROOT / "frontend" / "src" / "viewer" / "tables.json"


def tables() -> dict:
    return {
        "section_columns": mt.COLUMNS,
        "text_sections": sorted(mt.TEXT_SECTIONS),
        "option_groups": [[g, [[k, ch, label] for k, ch, label in items]] for g, items in mt.OPTION_GROUPS],
        "rpt_columns": rs.COLUMNS,
        "rpt_object_kind": rs.OBJECT_KIND,
        "rpt_unit_pattern": rs._UNIT.pattern,
        "out_vars": {"node": osv._NODE_VARS, "link": osv._LINK_VARS, "subcatchment": osv._SUB_VARS},
        "compare_tables": {t: [kind, cols] for t, (kind, cols) in ra.COMPARE_TABLES.items()},
        "summary_keys": list(ra.SUMMARY_KEYS),
    }


def main() -> int:
    text = json.dumps(tables(), indent=1, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        if not OUT.is_file() or OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT.relative_to(ROOT)} is out of date: run python scripts/export_viewer_tables.py")
            return 1
        print("viewer tables up to date")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
