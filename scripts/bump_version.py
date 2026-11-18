#!/usr/bin/env python3
"""Set the app version everywhere it is recorded.

    python scripts/bump_version.py 0.3.0

Updates VERSION, frontend/package.json (+ lockfile root) and
backend/pyproject.toml, and adds an empty section to CHANGELOG.md. Then:

    git commit -am "Release v0.3.0" && git tag v0.3.0 && git push --follow-tags

Pushing the tag makes GitHub Actions build and publish the portable release.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$")


def _json_set(path: Path, mutate) -> None:
    raw = path.read_text(encoding="utf-8")
    nl = "\r\n" if "\r\n" in raw else "\n"
    data = json.loads(raw)
    mutate(data)
    path.write_text(json.dumps(data, indent=2).replace("\n", nl) + nl, encoding="utf-8", newline="")


def main() -> int:
    if len(sys.argv) != 2 or not SEMVER.match(sys.argv[1]):
        print(__doc__)
        return 2
    v = sys.argv[1]
    (ROOT / "VERSION").write_text(v + "\n", encoding="utf-8")

    def pkg(d):
        d["version"] = v

    def lock(d):
        d["version"] = v
        if "" in d.get("packages", {}):
            d["packages"][""]["version"] = v

    _json_set(ROOT / "frontend" / "package.json", pkg)
    _json_set(ROOT / "frontend" / "package-lock.json", lock)

    pp = ROOT / "backend" / "pyproject.toml"
    pp.write_text(
        re.sub(r'^version\s*=\s*"[^"]+"', f'version = "{v}"', pp.read_text(encoding="utf-8"), count=1, flags=re.M),
        encoding="utf-8",
    )

    cl = ROOT / "CHANGELOG.md"
    text = cl.read_text(encoding="utf-8") if cl.exists() else "# Changelog\n"
    if f"## [{v}]" not in text:
        head, sep, rest = text.partition("\n## ")
        entry = f"\n## [{v}] - {dt.date.today().isoformat()}\n\n- \n"
        text = head.rstrip("\n") + "\n" + entry + (("\n## " + rest) if sep else "")
        cl.write_text(text, encoding="utf-8")
    print(f"Version set to {v}. Fill in CHANGELOG.md, then commit and tag v{v}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
