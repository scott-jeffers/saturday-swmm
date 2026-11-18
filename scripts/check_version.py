#!/usr/bin/env python3
"""Fail if the version in VERSION, frontend/package.json and backend/pyproject.toml differ.

Optionally pass a git tag (e.g. v0.2.0) to also check the tag matches.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def versions() -> dict[str, str]:
    out = {"VERSION": (ROOT / "VERSION").read_text(encoding="utf-8").strip()}
    out["frontend/package.json"] = json.loads(
        (ROOT / "frontend" / "package.json").read_text(encoding="utf-8")
    )["version"]
    m = re.search(
        r'^version\s*=\s*"([^"]+)"',
        (ROOT / "backend" / "pyproject.toml").read_text(encoding="utf-8"),
        re.M,
    )
    out["backend/pyproject.toml"] = m.group(1) if m else "?"
    return out


def main() -> int:
    v = versions()
    if len(sys.argv) > 1:
        v["git tag"] = sys.argv[1].lstrip("vV")
    if len(set(v.values())) != 1:
        for k, val in v.items():
            print(f"  {k:24} {val}")
        print("Version mismatch. Run: python scripts/bump_version.py <version>")
        return 1
    print(f"version {v['VERSION']} consistent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
