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


def app_version_key(v: str) -> str:
    """Releases 1.0.0 to 1.3.1 were renumbered 0.10.0 to 0.13.1 (still alpha).

    Compare app versions through this, so an install that still reports a
    1.x number is offered 0.14.0 and later as updates.
    """
    import re

    s = (v or "").strip().lstrip("vV")
    m = re.fullmatch(r"1\.([0-3])\.(\d+)", s)
    return f"0.{10 + int(m.group(1))}.{m.group(2)}" if m else s
