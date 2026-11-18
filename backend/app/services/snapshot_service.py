"""Named snapshots of the model file, kept in the project folder.

Undo covers a session; snapshots cover days. A snapshot is the full .inp text,
compressed, under ``<project>/snapshots/<model file stem>/``. One is taken
automatically before every run (when the model changed since the last one), and
the user can save named ones and restore any of them. Restoring goes through
the normal edit history, so it can itself be undone.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.services.fs_utils import atomic_write_text

SNAP_DIR = "snapshots"
KEEP_AUTO = 15
_ID_RE = re.compile(r"^[0-9]{8}T[0-9]{6}-[a-f0-9]{6}$")


class SnapshotService:
    def __init__(self) -> None:
        self._lock = threading.Lock()

    def _inp(self) -> Path:
        from app.services.project_service import project_service

        inp = getattr(project_service, "_inp_path", None)
        if inp is None:
            raise HTTPException(status_code=404, detail="No project is open")
        return inp

    def _dir(self) -> Path:
        from app.services.project_service import project_service

        inp = self._inp()
        return project_service.require_root() / SNAP_DIR / inp.stem

    def _entries(self) -> list[dict[str, Any]]:
        d = self._dir()
        if not d.is_dir():
            return []
        out = []
        for meta in d.glob("*.json"):
            try:
                m = json.loads(meta.read_text(encoding="utf-8"))
            except Exception:
                continue
            if (d / f"{meta.stem}.inp.z").is_file():
                out.append(m)
        out.sort(key=lambda m: m.get("created", ""), reverse=True)
        return out

    def list(self) -> dict[str, Any]:
        return {"snapshots": self._entries()}

    def create(self, label: str = "", auto: bool = False) -> dict[str, Any]:
        inp = self._inp()
        if not inp.is_file():
            raise HTTPException(status_code=404, detail="Model file not found")
        text = inp.read_text(encoding="utf-8", errors="replace")
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
        with self._lock:
            entries = self._entries()
            if auto and entries and entries[0].get("hash") == digest:
                return entries[0]  # nothing changed since the last snapshot
            d = self._dir()
            d.mkdir(parents=True, exist_ok=True)
            now = datetime.now(timezone.utc)
            sid = f"{now.strftime('%Y%m%dT%H%M%S')}-{digest[:6]}"
            (d / f"{sid}.inp.z").write_bytes(zlib.compress(text.encode("utf-8"), 6))
            meta = {
                "id": sid,
                "label": (label or ("Before run" if auto else "Snapshot")).strip()[:120],
                "created": now.isoformat(timespec="seconds"),
                "auto": auto,
                "hash": digest,
                "bytes": len(text.encode("utf-8")),
                "lines": text.count("\n") + 1,
            }
            (d / f"{sid}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
            if auto:
                autos = [e for e in self._entries() if e.get("auto")]
                for old in autos[KEEP_AUTO:]:
                    self._remove(old["id"])
            return meta

    def _path(self, sid: str) -> Path:
        if not _ID_RE.match(sid):
            raise HTTPException(status_code=400, detail="Invalid snapshot id")
        p = self._dir() / f"{sid}.inp.z"
        if not p.is_file():
            raise HTTPException(status_code=404, detail="Snapshot not found")
        return p

    def text(self, sid: str) -> str:
        return zlib.decompress(self._path(sid).read_bytes()).decode("utf-8")

    def restore(self, sid: str) -> dict[str, Any]:
        from app.services.edit_history import edit_history

        text = self.text(sid)
        meta = next((e for e in self._entries() if e["id"] == sid), {"label": sid})
        # Keep what is there now, so restoring never loses work.
        self.create(label=f"Before restoring “{meta.get('label')}”", auto=True)
        edit_history.set_label(f"Restore snapshot “{meta.get('label')}”")
        atomic_write_text(self._inp(), text)
        from app.services.inp_model_service import inp_model_service

        inp_model_service.invalidate()
        return meta

    def rename(self, sid: str, label: str) -> dict[str, Any]:
        self._path(sid)
        meta_path = self._dir() / f"{sid}.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["label"] = label.strip()[:120] or meta["label"]
        meta["auto"] = False  # a named snapshot is kept
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return meta

    def _remove(self, sid: str) -> None:
        d = self._dir()
        for suffix in (".inp.z", ".json"):
            (d / f"{sid}{suffix}").unlink(missing_ok=True)

    def delete(self, sid: str) -> dict[str, Any]:
        self._path(sid)
        self._remove(sid)
        return self.list()


snapshot_service = SnapshotService()
