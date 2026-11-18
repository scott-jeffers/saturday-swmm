"""Single source of the app version.

The version lives in the repository's top-level ``VERSION`` file (bumped with
``python scripts/bump_version.py``). The portable build copies that file next
to the bundled backend, so the same lookup works in both places.
"""

from __future__ import annotations

import sys
from pathlib import Path


def _candidates() -> list[Path]:
    here = Path(__file__).resolve()
    out: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)  # PyInstaller one-folder bundle
    if meipass:
        out.append(Path(meipass) / "VERSION")
    out.append(here.parent / "VERSION")  # copied in by the portable build
    out.append(here.parents[2] / "VERSION")  # repo root (backend/app/version.py)
    return out


def _read_version() -> str:
    for p in _candidates():
        try:
            v = p.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if v:
            return v
    return "0.0.0"


APP_VERSION = _read_version()

# "portable" when running from a packaged release, "source" from a git checkout.
DISTRIBUTION = "portable" if getattr(sys, "frozen", False) or (Path(__file__).parent / "VERSION").is_file() else "source"

# GitHub repository that publishes releases (used for the update check).
RELEASES_REPO = "scott-jeffers/saturday-swmm"
