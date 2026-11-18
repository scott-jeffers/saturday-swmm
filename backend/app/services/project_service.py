from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.models.schemas import ProjectInfo
from app.services.blank_inp import BLANK_INP_TEMPLATE
from app.services.fs_utils import atomic_write_text

DEFAULT_PROJECT_CRS = "EPSG:25832"
SETTINGS_NAME = ".saturday-swmm.json"
DEFAULT_SIMULATION_ENGINE = "openswmm"
VALID_SIMULATION_ENGINES = frozenset({"openswmm", "pyswmm", "flow_accum"})


def _normalize_epsg(crs: str) -> str:
    s = str(crs).strip()
    if not s:
        raise HTTPException(status_code=400, detail="CRS is required")
    if s.isdigit():
        return f"EPSG:{s}"
    if s.upper().startswith("EPSG:"):
        return f"EPSG:{s.split(':', 1)[1].strip()}"
    return s


def resolve_proj4(crs: str) -> str:
    """Return a proj4 string for the CRS (for the browser proj4.js registry)."""
    try:
        from pyproj import CRS
    except ImportError as exc:
        raise HTTPException(
            status_code=500, detail="pyproj is required for CRS support"
        ) from exc
    try:
        c = CRS.from_user_input(crs)
        proj4 = c.to_proj4()
        if not proj4:
            raise ValueError("empty proj4")
        return proj4
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Unrecognized CRS '{crs}': {exc}"
        ) from exc


class ProjectService:
    """In-memory active project for the single-user local MVP."""

    def __init__(self) -> None:
        self._root: Optional[Path] = None
        self._inp_path: Optional[Path] = None
        # Optional allowlist root; if unset, any absolute existing folder is OK.
        root_env = os.environ.get("PROJECTS_ROOT", "").strip()
        self._projects_root: Optional[Path] = (
            Path(root_env).resolve() if root_env else None
        )

    def _validate_folder(self, path: Path, *, must_exist: bool = True) -> Path:
        try:
            resolved = path.resolve()
        except OSError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid path: {exc}") from exc

        if not resolved.is_absolute():
            raise HTTPException(status_code=400, detail="Path must be absolute")
        if must_exist:
            if not resolved.exists():
                raise HTTPException(status_code=404, detail=f"Folder not found: {resolved}")
            if not resolved.is_dir():
                raise HTTPException(status_code=400, detail="Path must be a directory")

        if self._projects_root is not None:
            try:
                resolved.relative_to(self._projects_root)
            except ValueError as exc:
                raise HTTPException(
                    status_code=403,
                    detail=f"Path must be under PROJECTS_ROOT ({self._projects_root})",
                ) from exc

        return resolved

    @staticmethod
    def _find_inp(folder: Path, preferred: Optional[str] = None) -> Path:
        if preferred:
            candidate = folder / preferred
            if candidate.is_file() and candidate.suffix.lower() == ".inp":
                return candidate
            raise HTTPException(
                status_code=404, detail=f"INP file not found: {candidate}"
            )

        inps = sorted(folder.glob("*.inp"))
        if not inps:
            raise HTTPException(
                status_code=400, detail=f"No .inp file found in {folder}"
            )
        if len(inps) > 1:
            named = folder / f"{folder.name}.inp"
            if named in inps:
                return named
        return inps[0]

    def _settings_path(self) -> Path:
        return self.require_root() / SETTINGS_NAME

    def _read_settings(self) -> dict[str, Any]:
        path = self._settings_path()
        if not path.is_file():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _write_settings(self, data: dict[str, Any]) -> None:
        path = self._settings_path()
        atomic_write_text(path, json.dumps(data, indent=2) + "\n")

    def get_crs(self) -> str:
        """Active project CRS, falling back to GIS manifest then default."""
        if self._root is None:
            return DEFAULT_PROJECT_CRS
        settings = self._read_settings()
        crs = settings.get("crs")
        if isinstance(crs, str) and crs.strip():
            return _normalize_epsg(crs)
        try:
            man_path = self._root / "gis" / "layers.json"
            if man_path.is_file():
                man = json.loads(man_path.read_text(encoding="utf-8"))
                pc = man.get("project_crs")
                if isinstance(pc, str) and pc.strip():
                    return _normalize_epsg(pc)
        except Exception:
            pass
        return DEFAULT_PROJECT_CRS

    def get_crs_proj4(self) -> Optional[str]:
        if self._root is None:
            return None
        settings = self._read_settings()
        cached = settings.get("crs_proj4")
        if isinstance(cached, str) and cached.strip():
            return cached
        try:
            return resolve_proj4(self.get_crs())
        except Exception:
            return None

    def set_crs(self, crs: str) -> ProjectInfo:
        code = _normalize_epsg(crs)
        proj4 = resolve_proj4(code)
        settings = self._read_settings()
        settings["crs"] = code
        settings["crs_proj4"] = proj4
        settings["crs_source"] = "user"
        self._write_settings(settings)
        try:
            from app.services.gis_service import gis_service

            gis_service.set_project_crs(code)
        except Exception:
            pass
        return self.current()

    def get_simulation_engine(self) -> str:
        if self._root is None:
            return DEFAULT_SIMULATION_ENGINE
        settings = self._read_settings()
        eng = settings.get("simulation_engine")
        if isinstance(eng, str) and eng.strip().lower() in VALID_SIMULATION_ENGINES:
            return eng.strip().lower()
        return DEFAULT_SIMULATION_ENGINE

    def set_simulation_engine(self, engine: str) -> ProjectInfo:
        eng = str(engine).strip().lower()
        if eng not in VALID_SIMULATION_ENGINES:
            raise HTTPException(
                status_code=400,
                detail=f"simulation_engine must be one of {sorted(VALID_SIMULATION_ENGINES)}",
            )
        settings = self._read_settings()
        settings["simulation_engine"] = eng
        self._write_settings(settings)
        return self.current()

    def _ensure_crs_settings(self) -> None:
        """Persist resolved CRS/proj4 when opening a project."""
        try:
            settings = self._read_settings()
            had_crs = isinstance(settings.get("crs"), str) and bool(settings["crs"].strip())
            code = self.get_crs()
            changed = False
            if settings.get("crs") != code or not settings.get("crs_proj4"):
                settings["crs"] = code
                settings["crs_proj4"] = resolve_proj4(code)
                changed = True
            if "crs_source" not in settings:
                # Older projects that already stored a CRS count as chosen.
                gis_has = (self.require_root() / "gis" / "layers.json").is_file()
                settings["crs_source"] = "user" if had_crs or gis_has else "default"
                changed = True
            if changed:
                self._write_settings(settings)
        except Exception:
            pass

    def crs_confirmed(self) -> bool:
        if self._root is None:
            return False
        return self._read_settings().get("crs_source", "user") != "default"

    def open_project(self, path: str, inp_name: Optional[str] = None) -> ProjectInfo:
        folder = self._validate_folder(Path(path))
        inp = self._find_inp(folder, inp_name)
        if self._root is not None and folder != self._root:
            from app.api.runs import running_engine

            busy = running_engine()
            if busy:
                raise HTTPException(
                    status_code=409,
                    detail=f"A {busy} simulation is running on the current project. "
                    "Cancel it or wait for it to finish before switching projects.",
                )
        self._root = folder
        self._inp_path = inp
        self._base_inp_path = inp
        self._ensure_crs_settings()
        self._restore_active_scenario()
        info = self.current()
        try:
            from app.services.run_service import run_service

            run_service.note_project_outputs(
                inp_path=str(self._inp_path),
                rpt_path=info.rpt_path,
                out_path=info.out_path,
            )
        except Exception:
            pass
        return info

    def create_project(self, path: str, name: Optional[str] = None) -> ProjectInfo:
        folder = Path(path)
        if not folder.exists():
            try:
                folder.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise HTTPException(
                    status_code=400, detail=f"Could not create folder: {exc}"
                ) from exc
        folder = self._validate_folder(folder)

        existing = list(folder.glob("*.inp"))
        if existing:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Folder already contains an .inp file ({existing[0].name}). "
                    "Use Open project instead."
                ),
            )

        inp_name = (name or f"{folder.name}.inp").strip()
        if not inp_name.lower().endswith(".inp"):
            inp_name = f"{inp_name}.inp"
        inp_name = Path(inp_name).name
        if not inp_name or inp_name in (".", ".."):
            raise HTTPException(status_code=400, detail="Invalid INP file name")

        inp_path = folder / inp_name
        title = folder.name.replace("_", " ")
        text = BLANK_INP_TEMPLATE.format(title=title)
        try:
            atomic_write_text(inp_path, text)
        except OSError as exc:
            raise HTTPException(
                status_code=500, detail=f"Could not write INP: {exc}"
            ) from exc

        from app.services.inp_model_service import inp_model_service

        inp_model_service.invalidate()
        return self.open_project(str(folder), inp_name=inp_name)

    def current(self) -> ProjectInfo:
        if self._root is None or self._inp_path is None:
            raise HTTPException(status_code=404, detail="No project is open")
        files = sorted(
            p.name
            for p in self._root.iterdir()
            if p.is_file() and not p.name.startswith(".")
        )
        out = self._inp_path.with_suffix(".out")
        rpt = self._inp_path.with_suffix(".rpt")

        has_2d_mesh = False
        has_2d_results = False
        twod_path: Optional[str] = None
        try:
            from app.services.twod_mesh_service import twod_mesh_service

            info = twod_mesh_service.info(self._inp_path)
            has_2d_mesh = bool(info["has_mesh"])
            has_2d_results = bool(info["has_results"])
            twod_path = info.get("twod_path")
        except Exception:
            pass

        crs = self.get_crs()
        has_flow_accum = False
        try:
            from app.services.flow_accum_service import has_flow_accum_results

            has_flow_accum = has_flow_accum_results(self._root)
        except Exception:
            pass

        return ProjectInfo(
            path=str(self._root),
            inp_name=self._inp_path.name,
            inp_path=str(self._inp_path),
            scenario_id=self.active_scenario_id(),
            scenario_name=self._scenario_name(),
            files=files,
            out_path=str(out) if out.is_file() else None,
            rpt_path=str(rpt) if rpt.is_file() else None,
            has_out=out.is_file(),
            has_rpt=rpt.is_file(),
            has_2d_mesh=has_2d_mesh,
            has_2d_results=has_2d_results,
            twod_path=twod_path,
            crs=crs,
            crs_confirmed=self.crs_confirmed(),
            crs_proj4=self.get_crs_proj4(),
            simulation_engine=self.get_simulation_engine(),  # type: ignore[arg-type]
            has_flow_accum_results=has_flow_accum,
        )

    # ---------------------------------------------------------- scenarios
    def base_inp(self) -> Path:
        base = getattr(self, "_base_inp_path", None) or self._inp_path
        if base is None:
            raise HTTPException(status_code=404, detail="No project is open")
        return base

    def _scenario_name(self) -> str:
        sid = self.active_scenario_id()
        if sid == "base":
            return "Base"
        try:
            from app.services.scenario_service import scenario_service

            for sc in scenario_service.list()["scenarios"]:
                if sc["id"] == sid:
                    return sc["name"]
        except Exception:
            pass
        return sid

    def active_scenario_id(self) -> str:
        if self._root is None:
            return "base"
        sid = self._read_settings().get("active_scenario")
        return sid if isinstance(sid, str) and sid else "base"

    def _restore_active_scenario(self) -> None:
        sid = self.active_scenario_id()
        if sid == "base":
            return
        try:
            from app.services.scenario_service import scenario_service

            inp = scenario_service.inp_path(sid)
            if inp.is_file():
                self._inp_path = inp
                return
        except HTTPException:
            pass
        settings = self._read_settings()
        settings["active_scenario"] = "base"
        self._write_settings(settings)

    def set_active_scenario(self, sid: str) -> ProjectInfo:
        from app.api.runs import running_engine
        from app.services.inp_model_service import inp_model_service
        from app.services.scenario_service import scenario_service

        if running_engine():
            raise HTTPException(status_code=409, detail="Wait for the simulation to finish before switching scenarios.")
        inp = self.base_inp() if sid == "base" else scenario_service.inp_path(sid)
        if not inp.is_file():
            raise HTTPException(status_code=404, detail="That scenario's .inp file is missing.")
        settings = self._read_settings()
        settings["active_scenario"] = sid
        self._write_settings(settings)
        self._inp_path = inp
        inp_model_service.invalidate()
        for mod, name in (("app.services.output_service", "output_service"), ("app.services.twod_output_service", "twod_output_service")):
            try:
                getattr(__import__(mod, fromlist=[name]), name).invalidate()
            except Exception:
                pass
        try:
            from app.services.run_service import run_service

            info = self.current()
            run_service.note_project_outputs(inp_path=str(inp), rpt_path=info.rpt_path, out_path=info.out_path)
        except Exception:
            pass
        return self.current()

    def require_inp(self) -> Path:
        if self._inp_path is None or not self._inp_path.is_file():
            raise HTTPException(status_code=404, detail="No project is open")
        return self._inp_path

    def require_root(self) -> Path:
        if self._root is None:
            raise HTTPException(status_code=404, detail="No project is open")
        return self._root

    def read_inp(self) -> str:
        return self.require_inp().read_text(encoding="utf-8", errors="replace")

    def write_inp(self, text: str) -> None:
        atomic_write_text(self.require_inp(), text)

    def write_project_file(self, filename: str, content: str) -> ProjectInfo:
        """Write a text file into the open project folder (basename only)."""
        root = self.require_root()
        target = self._safe_project_file(root, filename)
        try:
            atomic_write_text(target, content)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Could not write file: {exc}") from exc
        return self.current()

    def read_project_file(self, filename: str, *, max_chars: int = 200_000) -> dict[str, Any]:
        root = self.require_root()
        target = self._safe_project_file(root, filename, must_exist=True)
        try:
            text = target.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Could not read file: {exc}") from exc
        truncated = len(text) > max_chars
        if truncated:
            text = text[:max_chars]
        return {
            "filename": target.name,
            "content": text,
            "truncated": truncated,
            "size_bytes": target.stat().st_size,
        }

    def delete_project_file(self, filename: str) -> ProjectInfo:
        root = self.require_root()
        target = self._safe_project_file(root, filename, must_exist=True)
        try:
            target.unlink()
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Could not delete file: {exc}") from exc
        return self.current()

    def list_dat_files(self) -> list[dict[str, Any]]:
        root = self.require_root()
        files: list[dict[str, Any]] = []
        for p in sorted(root.glob("*.dat")):
            if not p.is_file():
                continue
            files.append(
                {
                    "filename": p.name,
                    "size_bytes": p.stat().st_size,
                }
            )
        return files

    def rain_file_span(self, filename: str) -> dict[str, Any]:
        """Parse first/last timestamps from a SWMM rain FILE (.dat)."""
        import re

        root = self.require_root()
        target = self._safe_project_file(root, filename, must_exist=True)
        try:
            text = target.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Could not read file: {exc}") from exc

        # Station Year Month Day Hour Minute Value
        pat_sta = re.compile(
            r"^\s*\S+\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+([+-]?\d"
            r"+(?:\.\d+)?)\s*$"
        )
        # MM/DD/YYYY HH:MM[.SS] Value
        pat_dt = re.compile(
            r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([+-]?\d+(?:\.\d+)?)\s*$"
        )

        first: tuple[int, int, int, int, int, int] | None = None
        last: tuple[int, int, int, int, int, int] | None = None
        records = 0
        for raw in text.splitlines():
            line = raw.strip()
            if not line or line.startswith(";"):
                continue
            m = pat_sta.match(line)
            if m:
                y, mo, d, h, mi = (int(m.group(i)) for i in range(1, 6))
                sec = 0
            else:
                m = pat_dt.match(line)
                if not m:
                    continue
                mo, d, y, h, mi = (int(m.group(i)) for i in range(1, 6))
                sec = int(m.group(6) or 0)
            stamp = (y, mo, d, h, mi, sec)
            if first is None:
                first = stamp
            last = stamp
            records += 1

        def fmt(stamp: tuple[int, int, int, int, int, int] | None) -> tuple[str | None, str | None]:
            if stamp is None:
                return None, None
            y, mo, d, h, mi, sec = stamp
            return (
                f"{mo:02d}/{d:02d}/{y:04d}",
                f"{h:02d}:{mi:02d}:{sec:02d}",
            )

        sd, st = fmt(first)
        ed, et = fmt(last)
        return {
            "filename": target.name,
            "start_date": sd,
            "start_time": st,
            "end_date": ed,
            "end_time": et,
            "start": f"{sd} {st}" if sd and st else None,
            "end": f"{ed} {et}" if ed and et else None,
            "records": records,
        }

    @staticmethod
    def _safe_project_file(
        root: Path, filename: str, *, must_exist: bool = False
    ) -> Path:
        name = Path(filename).name.strip()
        if (
            not name
            or name in (".", "..")
            or "/" in filename
            or "\\" in filename
            or ".." in name
        ):
            raise HTTPException(status_code=400, detail="Invalid filename")
        target = (root / name).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Path escapes project folder"
            ) from exc
        if must_exist and not target.is_file():
            raise HTTPException(status_code=404, detail=f"File not found: {name}")
        return target

    def rpt_path(self) -> Path:
        inp = self.require_inp()
        return inp.with_suffix(".rpt")

    def out_path(self) -> Path:
        inp = self.require_inp()
        return inp.with_suffix(".out")

    def twod_h5_path(self) -> Optional[Path]:
        """Resolved 2D HDF5 path from [2D_OPTIONS] OUTPUT_FILE, or None."""
        from app.services.twod_mesh_service import twod_mesh_service

        return twod_mesh_service.resolve_h5_path(self.require_inp())


project_service = ProjectService()
