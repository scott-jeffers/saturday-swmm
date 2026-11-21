"""Build the browser viewer's catalog of a GitHub SWMM model library.

    python scripts/build_model_library.py <owner/repo> <branch> <out.json> [title]

Only the per-model Markdown summaries are downloaded (a sparse, blob-filtered
clone); the models stay on GitHub and the viewer fetches one when it is opened.
For each .inp the catalog keeps its path, title, the facts from the summary's
badges and tables (flow units, routing, infiltration, element counts, run
status, features) and whether a .rpt / .out sits next to it.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

BADGE = re.compile(r"img\.shields\.io/badge/([a-z_]+)-([^)]*?)-[0-9a-z]+\)")


def run(*args: str, cwd: str | None = None) -> str:
    env = {**os.environ, "GIT_LFS_SKIP_SMUDGE": "1"}
    return subprocess.run(args, cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout


def badge_value(v: str) -> str:
    return v.replace("__", "\0").replace("_", " ").replace("\0", "_").replace("--", "-")


def table_count(md: str, label: str) -> int:
    m = re.search(rf"\|\s*{re.escape(label)}\s*\|\s*([\d,]+)\s*\|", md)
    return int(m.group(1).replace(",", "")) if m else 0


def parse_summary(md: str) -> dict:
    out: dict = {}
    for key, val in BADGE.findall(md):
        val = badge_value(val)
        if key in ("nodes", "links", "subcatchments"):
            try:
                out[key[0]] = int(val.replace(",", ""))
            except ValueError:
                pass
        elif key == "flow_units":
            if re.fullmatch(r"[A-Za-z]{3}", val):
                out["u"] = val.upper()
        elif key == "routing":
            out["r"] = val.upper()
        elif key == "infiltration":
            out["i"] = val.upper()
        elif key == "status":
            s = val.lower()
            out["st"] = "ok" if "clean" in s else "warn" if "warning" in s else "err" if "error" in s else "none"
    m = re.search(r"\*\*Title:\*\*\s*(.+?)\s*$", md, re.M)
    if m and m.group(1).strip() and "no title" not in m.group(1).lower():
        out["t"] = m.group(1).strip()[:200]
    tags = []
    if "## 🌿 LID Controls" in md:
        tags.append("lid")
    if "## ⚗️ Water Quality" in md:
        tags.append("quality")
    if "## 🎛️ Control Rules" in md:
        tags.append("controls")
    if table_count(md, "Aquifers"):
        tags.append("groundwater")
    for label, tag in (("Pumps", "pumps"), ("Storage", "storage"), ("Weirs", "weirs"), ("Orifices", "orifices"), ("Outlets", "outlets")):
        if table_count(md, label):
            tags.append(tag)
    if tags:
        out["g"] = tags
    return out


def main() -> int:
    repo, branch, out_path = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    title = sys.argv[4] if len(sys.argv) > 4 else repo
    with tempfile.TemporaryDirectory() as tmp:
        d = str(Path(tmp) / "lib")
        run("git", "clone", "-q", "--depth", "1", "--branch", branch, "--filter=blob:none", "--sparse", f"https://github.com/{repo}", d)
        run("git", "sparse-checkout", "set", "--no-cone", "*.md", cwd=d)
        paths = run("git", "ls-tree", "-r", "--name-only", "HEAD", cwd=d).splitlines()
        have = {p.lower(): p for p in paths}
        models = []
        for p in sorted(paths, key=str.lower):
            if not p.lower().endswith(".inp"):
                continue
            stem = p[:-4]
            entry: dict = {"p": p}
            md = have.get((stem + ".md").lower())
            if md:
                try:
                    entry.update(parse_summary((Path(d) / md).read_text(encoding="utf-8", errors="replace")))
                except OSError:
                    pass
            if (stem + ".rpt").lower() in have:
                entry["rpt"] = have[(stem + ".rpt").lower()][len(stem):]
            if (stem + ".out").lower() in have:
                entry["out"] = have[(stem + ".out").lower()][len(stem):]
            if md:
                entry["md"] = 1
            models.append(entry)
    catalog = {
        "repo": repo,
        "branch": branch,
        "title": title,
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "count": len(models),
        "models": models,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(catalog, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{out_path}: {len(models)} models, {out_path.stat().st_size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
