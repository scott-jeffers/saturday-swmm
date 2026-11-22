"""Optional Git for a project folder: if Git is installed and the project is in
(or the user turns it into) a repository, saving a version can also commit the
model files. Saturday-SWMM never pushes, pulls or touches remotes: sharing is
the user's call, with their own Git tools.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import HTTPException


#: No console window flashing up on Windows for each git call.
_NO_WINDOW = {"creationflags": 0x08000000} if sys.platform == "win32" else {}


def _git(root: Path, *args: str, check: bool = True) -> str:
    exe = shutil.which("git")
    if not exe:
        raise HTTPException(status_code=400, detail="Git isn’t installed on this computer")
    r = subprocess.run([exe, *args], cwd=root, capture_output=True, text=True, timeout=60, **_NO_WINDOW)
    if check and r.returncode != 0:
        raise HTTPException(status_code=400, detail=(r.stderr or r.stdout).strip()[:400] or "git failed")
    return r.stdout


#: What a model version is made of; results, caches and restore points stay out.
IGNORE = ["*.out", "*.rpt", "**/.storms/", "snapshots/", ".saturday-swmm/", "__pycache__/", "*.tif", "*.ss2d", "*.ss2d.gz"]


def status(root: Path) -> dict[str, Any]:
    if not shutil.which("git"):
        return {"available": False, "repo": False}
    inside = subprocess.run([shutil.which("git") or "git", "rev-parse", "--show-toplevel"], cwd=root, capture_output=True, text=True, **_NO_WINDOW)
    if inside.returncode != 0:
        return {"available": True, "repo": False}
    branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD", check=False).strip() or None
    log = _git(root, "log", "-n", "20", "--format=%H%x1f%an%x1f%aI%x1f%s", "--", ".", check=False)
    commits = []
    for line in log.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 4:
            commits.append({"hash": parts[0], "author": parts[1], "date": parts[2], "message": parts[3]})
    return {"available": True, "repo": True, "top": inside.stdout.strip(), "branch": branch, "commits": commits}


def init(root: Path) -> dict[str, Any]:
    st = status(root)
    if not st["available"]:
        raise HTTPException(status_code=400, detail="Git isn’t installed on this computer")
    if not st["repo"]:
        _git(root, "init")
        gi = root / ".gitignore"
        existing = gi.read_text(encoding="utf-8").splitlines() if gi.is_file() else []
        gi.write_text("\n".join([*existing, *[p for p in IGNORE if p not in existing]]) + "\n", encoding="utf-8")
    return status(root)


def commit(root: Path, files: list[Path], message: str) -> dict[str, Any]:
    st = status(root)
    if not st.get("repo"):
        raise HTTPException(status_code=400, detail="This project isn’t a Git repository")
    rel = [str(f.relative_to(root)) for f in files if f.exists()]
    if not rel:
        return st
    _git(root, "add", "--", *rel)
    staged = _git(root, "diff", "--cached", "--name-only", check=False).strip()
    if staged:
        # A local identity if the user hasn't set one, so the commit can't fail on it.
        env_ok = _git(root, "config", "user.email", check=False).strip()
        args = ["-c", "user.name=Saturday-SWMM", "-c", "user.email=saturday-swmm@localhost"] if not env_ok else []
        _git(root, *args, "commit", "-m", message[:200] or "Model version", "--", *rel)
    return status(root)
