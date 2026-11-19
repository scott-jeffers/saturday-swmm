from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.services.fs_utils import atomic_write_text


SECTION_ALIASES = {
    "POLYGONS": "Polygons",
}

US_FLOW_UNITS = frozenset({"CFS", "GPM", "MGD"})
SI_FLOW_UNITS = frozenset({"CMS", "LPS", "MLD"})


def fast_2d_solver_defaults(length_unit: str = "m") -> dict[str, Any]:
    """Unit-aware [2D_OPTIONS] defaults biased toward faster runtimes.

    Depth thresholds scale with model length unit (FLOW_UNITS). Timestep /
    relative tolerance lean toward OpenSWMM's faster end of the recommended range.
    """
    unit = "ft" if str(length_unit).lower().startswith("ft") else "m"
    if unit == "ft":
        # ~1 mm wet/dry, ~0.1 mm abs depth tolerance
        dry_depth = 0.003
        abs_tolerance = 0.0003
    else:
        dry_depth = 0.001
        abs_tolerance = 0.0001
    return {
        "report_2d": True,
        "dry_depth": dry_depth,
        "max_timestep": 10.0,
        "min_timestep": 0.001,
        "rel_tolerance": 0.005,
        "abs_tolerance": abs_tolerance,
    }


def length_unit_from_flow_units(flow_units: Optional[str]) -> Optional[str]:
    if not flow_units:
        return None
    name = str(flow_units).upper().strip()
    if name in US_FLOW_UNITS:
        return "ft"
    if name in SI_FLOW_UNITS:
        return "m"
    return None


def length_unit_from_proj4(proj4: Optional[str]) -> Optional[str]:
    if not proj4:
        return None
    s = proj4.lower()
    if "+units=us-ft" in s or "+units=ft" in s or "to_meter=0.3048" in s:
        return "ft"
    if "+units=m" in s:
        return "m"
    return None


def _is_comment(line: str) -> bool:
    s = line.strip()
    return not s or s.startswith(";;") or s.startswith(";")


def _token_spans(line: str) -> tuple[list[tuple[int, int]], int]:
    """Locate SWMM tokens in ``line``.

    Returns ``(spans, data_end)`` where each span is ``(start, end)`` of a token
    (double-quoted tokens include their quotes) and ``data_end`` is the index
    where an inline ``;`` comment starts (or ``len(line)``). Semicolons inside
    double quotes are data, not comments.
    """
    spans: list[tuple[int, int]] = []
    i, n = 0, len(line)
    while i < n:
        ch = line[i]
        if ch in " \t\r\n":
            i += 1
            continue
        if ch == ";":
            return spans, i
        start = i
        if ch == '"':
            close = line.find('"', i + 1)
            i = n if close < 0 else close + 1
        else:
            while i < n and line[i] not in " \t\r\n;":
                i += 1
        spans.append((start, i))
    return spans, n


def _unquote(tok: str) -> str:
    if len(tok) >= 2 and tok[0] == '"' and tok[-1] == '"':
        return tok[1:-1]
    return tok


def _quote_if_needed(value: str) -> str:
    v = str(value)
    if v and (any(c in v for c in " \t;") and not (v.startswith('"') and v.endswith('"'))):
        return f'"{v}"'
    return v


def _tokenize(line: str) -> list[str]:
    """Split a SWMM data line into tokens.

    Handles inline ``;`` comments and double-quoted values containing spaces
    (e.g. ``FILE "C:\\My Data\\rain.dat"``). Quotes are stripped from tokens.
    """
    if '"' not in line:
        # Fast path (almost every line): no quotes, so ';' always starts a comment.
        return line.split(";", 1)[0].split()
    spans, _ = _token_spans(line)
    return [_unquote(line[a:b]) for a, b in spans]


def _f(val: str | None, default: float | None = None) -> float | None:
    if val is None:
        return default
    try:
        return float(val)
    except ValueError:
        return default


@dataclass
class ParsedModel:
    path: Path
    mtime: float
    lines: list[str]
    sections: dict[str, list[tuple[int, str]]]  # section -> [(line_index, raw_line)]
    map_bounds: Optional[tuple[float, float, float, float]] = None
    coordinates: dict[str, tuple[float, float]] = field(default_factory=dict)
    vertices: dict[str, list[tuple[float, float]]] = field(default_factory=dict)
    polygons: dict[str, list[tuple[float, float]]] = field(default_factory=dict)
    junctions: dict[str, dict[str, Any]] = field(default_factory=dict)
    outfalls: dict[str, dict[str, Any]] = field(default_factory=dict)
    storage: dict[str, dict[str, Any]] = field(default_factory=dict)
    conduits: dict[str, dict[str, Any]] = field(default_factory=dict)
    pumps: dict[str, dict[str, Any]] = field(default_factory=dict)
    orifices: dict[str, dict[str, Any]] = field(default_factory=dict)
    weirs: dict[str, dict[str, Any]] = field(default_factory=dict)
    outlets: dict[str, dict[str, Any]] = field(default_factory=dict)
    subcatchments: dict[str, dict[str, Any]] = field(default_factory=dict)
    xsections: dict[str, dict[str, Any]] = field(default_factory=dict)

    def all_nodes(self) -> dict[str, dict[str, Any]]:
        nodes: dict[str, dict[str, Any]] = {}
        for nid, attrs in self.junctions.items():
            nodes[nid] = {**attrs, "node_kind": "junction"}
        for nid, attrs in self.outfalls.items():
            nodes[nid] = {**attrs, "node_kind": "outfall"}
        for nid, attrs in self.storage.items():
            nodes[nid] = {**attrs, "node_kind": "storage"}
        return nodes

    def all_links(self) -> dict[str, dict[str, Any]]:
        links: dict[str, dict[str, Any]] = {}
        for lid, attrs in self.conduits.items():
            links[lid] = {**attrs, "link_kind": "conduit"}
        for lid, attrs in self.pumps.items():
            links[lid] = {**attrs, "link_kind": "pump"}
        for lid, attrs in self.orifices.items():
            links[lid] = {**attrs, "link_kind": "orifice"}
        for lid, attrs in self.weirs.items():
            links[lid] = {**attrs, "link_kind": "weir"}
        for lid, attrs in self.outlets.items():
            links[lid] = {**attrs, "link_kind": "outlet"}
        return links


class InpModelService:
    # Parsed models kept by file content, so undo / redo back to a recent version
    # (and repeated requests) skip re-parsing. Edits never change a parsed model in
    # place (they copy ``lines``), so sharing one per content is safe.
    _LRU_SIZE = 4

    def __init__(self) -> None:
        self._cache: Optional[ParsedModel] = None
        self._by_content: "dict[str, ParsedModel]" = {}
        self._cache_hash: Optional[str] = None

    def invalidate(self) -> None:
        self._cache = None
        try:
            from app.services.twod_mesh_service import twod_mesh_service

            twod_mesh_service.invalidate()
        except Exception:
            pass

    def load(self, inp_path: Path) -> ParsedModel:
        if not inp_path.is_file():
            raise HTTPException(status_code=404, detail=f"INP not found: {inp_path}")
        st = inp_path.stat()
        mtime = st.st_mtime
        # Some filesystems only keep whole-second mtimes; size + ns catch quick edits.
        sig = (st.st_mtime_ns, st.st_size)
        if (
            self._cache is not None
            and self._cache.path == inp_path
            and getattr(self, "_cache_sig", None) == sig
        ):
            return self._cache
        import hashlib

        raw = inp_path.read_bytes()
        digest = hashlib.blake2b(raw, digest_size=16).hexdigest() + str(inp_path)
        model = self._by_content.pop(digest, None)
        if model is None:
            text = raw.decode("utf-8", errors="replace")
            # Keep universal-newline behaviour of read_text.
            text = text.replace("\r\n", "\n").replace("\r", "\n")
            model = self._parse(inp_path, mtime, text)
        else:
            model.mtime = mtime
        self._by_content[digest] = model  # most recent last
        while len(self._by_content) > self._LRU_SIZE:
            self._by_content.pop(next(iter(self._by_content)))
        self._cache = model
        self._cache_sig = sig
        self._cache_hash = digest
        return model

    def content_key(self, inp_path: Path) -> str:
        """A key that changes whenever the model file's content changes."""
        self.load(inp_path)
        return self._cache_hash or ""

    def parse_file_uncached(self, path: Path, *, sections_only: bool = False) -> ParsedModel:
        """Parse a file without updating the project INP cache.

        Used for sidecar formats such as OpenSWMM ``.2dm`` mesh files so that
        loading mesh geometry does not clobber the open project's cached INP.
        """
        if not path.is_file():
            raise HTTPException(status_code=404, detail=f"File not found: {path}")
        mtime = path.stat().st_mtime
        text = path.read_text(encoding="utf-8", errors="replace")
        if sections_only:
            return self._parse_sections(path, mtime, text)
        return self._parse(path, mtime, text)

    def _parse_sections(self, path: Path, mtime: float, text: str) -> ParsedModel:
        """Split bracket sections only (no 1D network object parsing)."""
        lines = text.splitlines(keepends=True)
        sections: dict[str, list[tuple[int, str]]] = defaultdict(list)
        current: Optional[str] = None

        for i, raw in enumerate(lines):
            stripped = raw.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                name = stripped[1:-1]
                current = SECTION_ALIASES.get(name.upper(), name)
                continue
            if current is None:
                continue
            sections[current].append((i, raw))

        return ParsedModel(path=path, mtime=mtime, lines=lines, sections=dict(sections))

    def _parse(self, path: Path, mtime: float, text: str) -> ParsedModel:
        lines = text.splitlines(keepends=True)
        sections: dict[str, list[tuple[int, str]]] = defaultdict(list)
        current: Optional[str] = None

        for i, raw in enumerate(lines):
            stripped = raw.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                name = stripped[1:-1]
                current = SECTION_ALIASES.get(name.upper(), name)
                continue
            if current is None:
                continue
            sections[current].append((i, raw))

        model = ParsedModel(path=path, mtime=mtime, lines=lines, sections=dict(sections))
        self._parse_map(model)
        self._parse_coordinates(model)
        self._parse_vertices(model)
        self._parse_polygons(model)
        self._parse_junctions(model)
        self._parse_outfalls(model)
        self._parse_storage(model)
        self._parse_conduits(model)
        self._parse_pumps(model)
        self._parse_orifices(model)
        self._parse_weirs(model)
        self._parse_outlets(model)
        self._parse_subcatchments(model)
        self._parse_xsections(model)
        return model

    def _parse_map(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("MAP", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 5 and toks[0].upper() == "DIMENSIONS":
                vals = [_f(t) for t in toks[1:5]]
                if all(v is not None for v in vals):
                    model.map_bounds = (vals[0], vals[1], vals[2], vals[3])  # type: ignore[assignment]

    def _parse_coordinates(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("COORDINATES", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 3:
                x, y = _f(toks[1]), _f(toks[2])
                if x is not None and y is not None:
                    model.coordinates[toks[0]] = (x, y)

    def _parse_vertices(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("VERTICES", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 3:
                x, y = _f(toks[1]), _f(toks[2])
                if x is not None and y is not None:
                    model.vertices.setdefault(toks[0], []).append((x, y))

    def _parse_polygons(self, model: ParsedModel) -> None:
        for key in ("Polygons", "POLYGONS"):
            for _, raw in model.sections.get(key, []):
                if _is_comment(raw):
                    continue
                toks = _tokenize(raw)
                if len(toks) >= 3:
                    x, y = _f(toks[1]), _f(toks[2])
                    if x is not None and y is not None:
                        model.polygons.setdefault(toks[0], []).append((x, y))

    def _parse_junctions(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("JUNCTIONS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 2:
                model.junctions[toks[0]] = {
                    "id": toks[0],
                    "elevation": _f(toks[1], 0.0),
                    "max_depth": _f(toks[2], 0.0) if len(toks) > 2 else 0.0,
                    "init_depth": _f(toks[3], 0.0) if len(toks) > 3 else 0.0,
                    "sur_depth": _f(toks[4], 0.0) if len(toks) > 4 else 0.0,
                    "aponded": _f(toks[5], 0.0) if len(toks) > 5 else 0.0,
                }

    def _parse_outfalls(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("OUTFALLS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 2:
                continue
            otype = (toks[2] if len(toks) > 2 else "FREE").upper()
            attrs: dict[str, Any] = {
                "id": toks[0],
                "elevation": _f(toks[1], 0.0),
                "type": otype,
                "stage_data": "",
                "gated": "NO",
                "route_to": "",
                "max_depth": 0.0,
            }
            # FREE/NORMAL: Name Elev Type Gated [RouteTo]
            # FIXED/TIDAL/TIMESERIES: Name Elev Type StageData Gated [RouteTo]
            if otype in ("FREE", "NORMAL"):
                if len(toks) > 3:
                    attrs["gated"] = toks[3]
                if len(toks) > 4:
                    attrs["route_to"] = toks[4]
            else:
                if len(toks) > 3:
                    attrs["stage_data"] = toks[3]
                if len(toks) > 4:
                    attrs["gated"] = toks[4]
                if len(toks) > 5:
                    attrs["route_to"] = toks[5]
            model.outfalls[toks[0]] = attrs

    def _parse_storage(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("STORAGE", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 3:
                continue
            shape = (toks[4] if len(toks) > 4 else "TABULAR").upper()
            attrs: dict[str, Any] = {
                "id": toks[0],
                "elevation": _f(toks[1], 0.0),
                "max_depth": _f(toks[2], 0.0),
                "init_depth": _f(toks[3], 0.0) if len(toks) > 3 else 0.0,
                "shape": shape,
                "curve": "",
                "coeff_a": 0.0,
                "coeff_b": 0.0,
                "coeff_c": 0.0,
                "coeff_d": 0.0,
                "fevap": 0.0,
            }
            if shape == "TABULAR":
                if len(toks) > 5:
                    attrs["curve"] = toks[5]
                if len(toks) > 6:
                    attrs["fevap"] = _f(toks[6], 0.0)
            elif shape == "FUNCTIONAL":
                if len(toks) > 5:
                    attrs["coeff_a"] = _f(toks[5], 0.0)
                if len(toks) > 6:
                    attrs["coeff_b"] = _f(toks[6], 0.0)
                if len(toks) > 7:
                    attrs["coeff_c"] = _f(toks[7], 0.0)
                if len(toks) > 8:
                    attrs["coeff_d"] = _f(toks[8], 0.0)
                if len(toks) > 9:
                    attrs["fevap"] = _f(toks[9], 0.0)
            else:
                # CYLINDER / other: keep remaining tokens as curve string
                if len(toks) > 5:
                    attrs["curve"] = " ".join(toks[5:])
            model.storage[toks[0]] = attrs

    def _parse_conduits(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("CONDUITS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 3:
                continue
            model.conduits[toks[0]] = {
                "id": toks[0],
                "from_node": toks[1],
                "to_node": toks[2],
                "length": _f(toks[3], 0.0) if len(toks) > 3 else 0.0,
                "roughness": _f(toks[4], 0.01) if len(toks) > 4 else 0.01,
                "in_offset": _f(toks[5], 0.0) if len(toks) > 5 else 0.0,
                "out_offset": _f(toks[6], 0.0) if len(toks) > 6 else 0.0,
                "init_flow": _f(toks[7], 0.0) if len(toks) > 7 else 0.0,
                "max_flow": _f(toks[8], 0.0) if len(toks) > 8 else 0.0,
            }

    def _parse_pumps(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("PUMPS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 3:
                continue
            model.pumps[toks[0]] = {
                "id": toks[0],
                "from_node": toks[1],
                "to_node": toks[2],
                "pump_curve": toks[3] if len(toks) > 3 else "*",
                "status": (toks[4] if len(toks) > 4 else "ON").upper(),
                "startup": _f(toks[5], 0.0) if len(toks) > 5 else 0.0,
                "shutoff": _f(toks[6], 0.0) if len(toks) > 6 else 0.0,
            }

    def _parse_orifices(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("ORIFICES", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 3:
                continue
            model.orifices[toks[0]] = {
                "id": toks[0],
                "from_node": toks[1],
                "to_node": toks[2],
                "orifice_type": (toks[3] if len(toks) > 3 else "SIDE").upper(),
                "offset": _f(toks[4], 0.0) if len(toks) > 4 else 0.0,
                "qcoeff": _f(toks[5], 0.65) if len(toks) > 5 else 0.65,
                "gated": (toks[6] if len(toks) > 6 else "NO").upper(),
                "close_time": _f(toks[7], 0.0) if len(toks) > 7 else 0.0,
            }

    def _parse_weirs(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("WEIRS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 3:
                continue
            model.weirs[toks[0]] = {
                "id": toks[0],
                "from_node": toks[1],
                "to_node": toks[2],
                "weir_type": (toks[3] if len(toks) > 3 else "TRANSVERSE").upper(),
                "crest_height": _f(toks[4], 0.0) if len(toks) > 4 else 0.0,
                "qcoeff": _f(toks[5], 3.33) if len(toks) > 5 else 3.33,
                "gated": (toks[6] if len(toks) > 6 else "NO").upper(),
                "end_con": _f(toks[7], 0.0) if len(toks) > 7 else 0.0,
                "end_coeff": _f(toks[8], 0.0) if len(toks) > 8 else 0.0,
            }

    def _parse_outlets(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("OUTLETS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 3:
                continue
            otype = toks[4] if len(toks) > 4 else "FUNCTIONAL/DEPTH"
            attrs: dict[str, Any] = {
                "id": toks[0],
                "from_node": toks[1],
                "to_node": toks[2],
                "offset": _f(toks[3], 0.0) if len(toks) > 3 else 0.0,
                "outlet_type": otype.upper(),
                "qcoeff_or_curve": toks[5] if len(toks) > 5 else "1.0",
                "qexpon": 0.5,
                "gated": "NO",
            }
            # FUNCTIONAL/* : Qcoeff Qexpon Gated ; TABULAR/* : Qcurve Gated
            if "FUNCTIONAL" in attrs["outlet_type"].upper():
                attrs["qexpon"] = _f(toks[6], 0.5) if len(toks) > 6 else 0.5
                attrs["gated"] = (toks[7] if len(toks) > 7 else "NO").upper()
            else:
                attrs["gated"] = (toks[6] if len(toks) > 6 else "NO").upper()
            model.outlets[toks[0]] = attrs

    def _parse_subcatchments(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("SUBCATCHMENTS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 5:
                model.subcatchments[toks[0]] = {
                    "id": toks[0],
                    "raingage": toks[1],
                    "outlet": toks[2],
                    "area": _f(toks[3], 0.0),
                    "pct_imperv": _f(toks[4], 0.0),
                    "width": _f(toks[5], 0.0) if len(toks) > 5 else 0.0,
                    "slope": _f(toks[6], 0.0) if len(toks) > 6 else 0.0,
                    "curb_len": _f(toks[7], 0.0) if len(toks) > 7 else 0.0,
                    "snow_pack": toks[8] if len(toks) > 8 else "",
                }
        # Merge SUBAREAS onto subcatchment attrs when present
        for _, raw in model.sections.get("SUBAREAS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 2 or toks[0] not in model.subcatchments:
                continue
            sc = model.subcatchments[toks[0]]
            sc["n_imperv"] = _f(toks[1], 0.0)
            sc["n_perv"] = _f(toks[2], 0.0) if len(toks) > 2 else 0.0
            sc["s_imperv"] = _f(toks[3], 0.0) if len(toks) > 3 else 0.0
            sc["s_perv"] = _f(toks[4], 0.0) if len(toks) > 4 else 0.0
            sc["pct_zero"] = _f(toks[5], 0.0) if len(toks) > 5 else 0.0
            sc["subarea_route_to"] = toks[6] if len(toks) > 6 else "OUTLET"
            sc["pct_routed"] = _f(toks[7], 100.0) if len(toks) > 7 else 100.0
        for _, raw in model.sections.get("INFILTRATION", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 2 or toks[0] not in model.subcatchments:
                continue
            sc = model.subcatchments[toks[0]]
            sc["infil_p1"] = _f(toks[1], 0.0)
            sc["infil_p2"] = _f(toks[2], 0.0) if len(toks) > 2 else 0.0
            sc["infil_p3"] = _f(toks[3], 0.0) if len(toks) > 3 else 0.0
            sc["infil_p4"] = _f(toks[4], 0.0) if len(toks) > 4 else 0.0
            sc["infil_p5"] = _f(toks[5], 0.0) if len(toks) > 5 else 0.0

    def _parse_xsections(self, model: ParsedModel) -> None:
        for _, raw in model.sections.get("XSECTIONS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 3:
                model.xsections[toks[0]] = {
                    "id": toks[0],
                    "shape": toks[1],
                    "geom1": _f(toks[2], 0.0),
                    "geom2": _f(toks[3], 0.0) if len(toks) > 3 else 0.0,
                    "geom3": _f(toks[4], 0.0) if len(toks) > 4 else 0.0,
                    "geom4": _f(toks[5], 0.0) if len(toks) > 5 else 0.0,
                    "barrels": _f(toks[6], 1.0) if len(toks) > 6 else 1.0,
                }

    def _link_coords(
        self, model: ParsedModel, link_id: str, from_node: str, to_node: str
    ) -> list[list[float]]:
        coords: list[list[float]] = []
        if from_node in model.coordinates:
            coords.append(list(model.coordinates[from_node]))
        for vx, vy in model.vertices.get(link_id, []):
            coords.append([vx, vy])
        if to_node in model.coordinates:
            coords.append(list(model.coordinates[to_node]))
        return coords

    def _simplify_ring(
        self, ring: list[tuple[float, float]], tolerance: float = 2.0
    ) -> list[list[float]]:
        """Simple radial distance simplification for large polygons."""
        if len(ring) <= 4:
            return [[x, y] for x, y in ring]
        out: list[list[float]] = [[ring[0][0], ring[0][1]]]
        last = ring[0]
        for pt in ring[1:-1]:
            if math.hypot(pt[0] - last[0], pt[1] - last[1]) >= tolerance:
                out.append([pt[0], pt[1]])
                last = pt
        out.append([ring[-1][0], ring[-1][1]])
        if out[0] != out[-1]:
            out.append(out[0][:])
        return out

    def to_geojson(self, model: ParsedModel, *, simplify_polygons: bool = True) -> dict[str, Any]:
        features: list[dict[str, Any]] = []

        for sid, attrs in model.subcatchments.items():
            ring = model.polygons.get(sid, [])
            if len(ring) < 3:
                continue
            coords = (
                self._simplify_ring(ring)
                if simplify_polygons
                else [[x, y] for x, y in ring]
            )
            if coords[0] != coords[-1]:
                coords.append(coords[0][:])
            features.append(
                {
                    "type": "Feature",
                    "id": f"subcatchment:{sid}",
                    "geometry": {"type": "Polygon", "coordinates": [coords]},
                    "properties": {
                        "object_type": "subcatchment",
                        "id": sid,
                        **attrs,
                    },
                }
            )

        for lid, attrs in model.all_links().items():
            line = self._link_coords(model, lid, attrs["from_node"], attrs["to_node"])
            if len(line) < 2:
                continue
            xs = model.xsections.get(lid, {})
            features.append(
                {
                    "type": "Feature",
                    "id": f"link:{lid}",
                    "geometry": {"type": "LineString", "coordinates": line},
                    "properties": {
                        "object_type": "link",
                        "id": lid,
                        "diameter": xs.get("geom1"),
                        "shape": xs.get("shape"),
                        **attrs,
                    },
                }
            )

        for nid, attrs in model.all_nodes().items():
            if nid not in model.coordinates:
                continue
            x, y = model.coordinates[nid]
            features.append(
                {
                    "type": "Feature",
                    "id": f"node:{nid}",
                    "geometry": {"type": "Point", "coordinates": [x, y]},
                    "properties": {
                        "object_type": "node",
                        "id": nid,
                        "x": x,
                        "y": y,
                        **attrs,
                    },
                }
            )

        return {"type": "FeatureCollection", "features": features}

    def network_payload(self, inp_path: Path, crs: str = "EPSG:25832") -> dict[str, Any]:
        model = self.load(inp_path)
        # Prefer real geometry over [MAP] DIMENSIONS (often a placeholder like 0 0 1000 1000).
        bounds = None
        if model.coordinates:
            xs = [c[0] for c in model.coordinates.values()]
            ys = [c[1] for c in model.coordinates.values()]
            bounds = {
                "minx": min(xs),
                "miny": min(ys),
                "maxx": max(xs),
                "maxy": max(ys),
            }
        elif model.map_bounds:
            minx, miny, maxx, maxy = model.map_bounds
            bounds = {"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy}

        # Union 2D mesh extents so Fit Extent covers the floodplain.
        try:
            from app.services.twod_mesh_service import twod_mesh_service

            mesh = twod_mesh_service.load(inp_path)
            mb = mesh.bounds() if mesh.has_mesh else None
            if mb:
                if bounds is None:
                    bounds = {
                        "minx": mb[0],
                        "miny": mb[1],
                        "maxx": mb[2],
                        "maxy": mb[3],
                    }
                else:
                    bounds = {
                        "minx": min(bounds["minx"], mb[0]),
                        "miny": min(bounds["miny"], mb[1]),
                        "maxx": max(bounds["maxx"], mb[2]),
                        "maxy": max(bounds["maxy"], mb[3]),
                    }
        except Exception:
            pass

        counts = {
            "nodes": len(model.all_nodes()),
            "links": len(model.all_links()),
            "subcatchments": len(model.subcatchments),
            "coordinates": len(model.coordinates),
            "junctions": len(model.junctions),
            "outfalls": len(model.outfalls),
            "storage": len(model.storage),
            "conduits": len(model.conduits),
            "pumps": len(model.pumps),
            "orifices": len(model.orifices),
            "weirs": len(model.weirs),
            "outlets": len(model.outlets),
        }
        return {
            "crs": crs,
            "bounds": bounds,
            "geojson": self.to_geojson(model),
            "counts": counts,
        }

    def get_object(
        self, inp_path: Path, object_type: str, object_id: str
    ) -> dict[str, Any]:
        model = self.load(inp_path)
        if object_type == "node":
            nodes = model.all_nodes()
            if object_id not in nodes:
                raise HTTPException(status_code=404, detail=f"Node not found: {object_id}")
            attrs = dict(nodes[object_id])
            geom = None
            if object_id in model.coordinates:
                x, y = model.coordinates[object_id]
                attrs["x"] = x
                attrs["y"] = y
                geom = {"type": "Point", "coordinates": [x, y]}
            return {
                "object_type": "node",
                "id": object_id,
                "attributes": attrs,
                "geometry": geom,
            }

        if object_type == "link":
            links = model.all_links()
            if object_id not in links:
                raise HTTPException(status_code=404, detail=f"Link not found: {object_id}")
            attrs = dict(links[object_id])
            xs = model.xsections.get(object_id, {})
            attrs["diameter"] = xs.get("geom1")
            attrs["shape"] = xs.get("shape")
            attrs["geom1"] = xs.get("geom1")
            attrs["geom2"] = xs.get("geom2")
            attrs["geom3"] = xs.get("geom3")
            attrs["geom4"] = xs.get("geom4")
            attrs["barrels"] = xs.get("barrels", 1)
            line = self._link_coords(
                model, object_id, attrs["from_node"], attrs["to_node"]
            )
            mid = model.vertices.get(object_id, [])
            attrs["vertices"] = [[x, y] for x, y in mid]
            return {
                "object_type": "link",
                "id": object_id,
                "attributes": attrs,
                "geometry": {"type": "LineString", "coordinates": line} if line else None,
            }

        if object_type == "subcatchment":
            if object_id not in model.subcatchments:
                raise HTTPException(
                    status_code=404, detail=f"Subcatchment not found: {object_id}"
                )
            attrs = dict(model.subcatchments[object_id])
            ring = model.polygons.get(object_id, [])
            geom = None
            if len(ring) >= 3:
                coords = [[x, y] for x, y in ring]
                if coords[0] != coords[-1]:
                    coords.append(coords[0][:])
                geom = {"type": "Polygon", "coordinates": [coords]}
            return {
                "object_type": "subcatchment",
                "id": object_id,
                "attributes": attrs,
                "geometry": geom,
            }

        raise HTTPException(status_code=400, detail=f"Unknown object type: {object_type}")

    def _replace_field_in_line(self, line: str, index: int, value: str) -> str:
        """Replace the token at ``index`` in place.

        Column spacing, other tokens (including quoted ones) and any inline
        ``;`` comment are preserved. Missing trailing fields are padded with 0.
        """
        newline = ""
        if line.endswith("\r\n"):
            newline = "\r\n"
            body = line[:-2]
        elif line.endswith("\n"):
            newline = "\n"
            body = line[:-1]
        else:
            body = line
        # Keep comment-only lines alone
        if _is_comment(body):
            return line
        spans, data_end = _token_spans(body)
        data, comment = body[:data_end].rstrip(), body[data_end:]
        new_val = _quote_if_needed(value)
        if index < len(spans):
            a, b = spans[index]
            data = data[:a] + new_val + data[b:]
        else:
            pad = ["0"] * (index - len(spans)) + [new_val]
            data = data + "  " + "  ".join(pad)
        if comment:
            data = data + "  " + comment
        return data + newline

    def _find_data_line(
        self, model: ParsedModel, section: str, object_id: str
    ) -> Optional[int]:
        for idx, raw in model.sections.get(section, []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if toks and toks[0] == object_id:
                return idx
        return None

    def apply_patch(
        self,
        inp_path: Path,
        object_type: str,
        object_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any]:
        model = self.load(inp_path)
        lines = list(model.lines)
        changed = False

        if object_type == "node":
            section = None
            if object_id in model.junctions:
                section = "JUNCTIONS"
            elif object_id in model.outfalls:
                section = "OUTFALLS"
            elif object_id in model.storage:
                section = "STORAGE"
            else:
                raise HTTPException(status_code=404, detail=f"Node not found: {object_id}")

            row = self._find_data_line(model, section, object_id)
            if row is None:
                raise HTTPException(status_code=404, detail=f"Node row missing: {object_id}")

            if patch.get("elevation") is not None:
                lines[row] = self._replace_field_in_line(
                    lines[row], 1, str(patch["elevation"])
                )
                changed = True

            if section == "JUNCTIONS":
                # Name Elev MaxDepth InitDepth SurDepth Aponded
                for key, idx in (
                    ("max_depth", 2),
                    ("init_depth", 3),
                    ("sur_depth", 4),
                    ("aponded", 5),
                    ("ponded_area", 5),
                ):
                    if patch.get(key) is not None:
                        lines[row] = self._replace_field_in_line(
                            lines[row], idx, str(patch[key])
                        )
                        changed = True

            elif section == "OUTFALLS":
                outfall_keys = ("type", "outfall_type", "stage_data", "gated", "route_to")
                if any(patch.get(k) is not None for k in outfall_keys):
                    # Rebuild line — token layout depends on outfall type
                    cur = dict(model.outfalls[object_id])
                    if patch.get("elevation") is not None:
                        cur["elevation"] = patch["elevation"]
                    if patch.get("type") is not None:
                        cur["type"] = str(patch["type"]).upper()
                    if patch.get("outfall_type") is not None:
                        cur["type"] = str(patch["outfall_type"]).upper()
                    if patch.get("stage_data") is not None:
                        cur["stage_data"] = str(patch["stage_data"])
                    if patch.get("gated") is not None:
                        cur["gated"] = str(patch["gated"]).upper()
                    if patch.get("route_to") is not None:
                        cur["route_to"] = str(patch["route_to"])
                    lines[row] = self._format_outfall_line(object_id, cur)
                    changed = True

            elif section == "STORAGE":
                # Name Elev MaxDepth InitDepth Shape ...
                for key, idx in (
                    ("max_depth", 2),
                    ("init_depth", 3),
                ):
                    if patch.get(key) is not None:
                        lines[row] = self._replace_field_in_line(
                            lines[row], idx, str(patch[key])
                        )
                        changed = True
                shape_changed = False
                if patch.get("shape") is not None:
                    lines[row] = self._replace_field_in_line(
                        lines[row], 4, str(patch["shape"]).upper()
                    )
                    shape_changed = True
                    changed = True
                # Re-read shape after potential update
                shape = (
                    str(patch["shape"]).upper()
                    if patch.get("shape") is not None
                    else str(model.storage[object_id].get("shape", "TABULAR")).upper()
                )
                if shape == "TABULAR":
                    if patch.get("curve") is not None:
                        lines[row] = self._replace_field_in_line(
                            lines[row], 5, str(patch["curve"])
                        )
                        changed = True
                    if patch.get("fevap") is not None:
                        lines[row] = self._replace_field_in_line(
                            lines[row], 6, str(patch["fevap"])
                        )
                        changed = True
                elif shape == "FUNCTIONAL":
                    for key, idx in (
                        ("coeff_a", 5),
                        ("coeff_b", 6),
                        ("coeff_c", 7),
                        ("coeff_d", 8),
                        ("fevap", 9),
                    ):
                        if patch.get(key) is not None:
                            lines[row] = self._replace_field_in_line(
                                lines[row], idx, str(patch[key])
                            )
                            changed = True
                elif shape_changed and patch.get("curve") is not None:
                    lines[row] = self._replace_field_in_line(
                        lines[row], 5, str(patch["curve"])
                    )
                    changed = True

            if patch.get("x") is not None or patch.get("y") is not None:
                cur = model.coordinates.get(object_id)
                if cur is None and (patch.get("x") is None or patch.get("y") is None):
                    raise HTTPException(
                        status_code=400,
                        detail="Both x and y required when creating coordinates",
                    )
                nx = float(patch["x"]) if patch.get("x") is not None else cur[0]  # type: ignore[index]
                ny = float(patch["y"]) if patch.get("y") is not None else cur[1]  # type: ignore[index]
                coord_row = self._find_data_line(model, "COORDINATES", object_id)
                new_line = f"{object_id}          {nx:.3f}         {ny:.3f}\n"
                if coord_row is not None:
                    lines[coord_row] = new_line
                else:
                    # Insert before next section after COORDINATES or append at end of COORDINATES block
                    insert_at = self._section_insert_index(model, "COORDINATES")
                    lines.insert(insert_at, new_line)
                changed = True

        elif object_type == "link":
            section = None
            kind = None
            for name, store, k in (
                ("CONDUITS", model.conduits, "conduit"),
                ("PUMPS", model.pumps, "pump"),
                ("ORIFICES", model.orifices, "orifice"),
                ("WEIRS", model.weirs, "weir"),
                ("OUTLETS", model.outlets, "outlet"),
            ):
                if object_id in store:
                    section = name
                    kind = k
                    break
            if section is None or kind is None:
                raise HTTPException(status_code=404, detail=f"Link not found: {object_id}")

            row = self._find_data_line(model, section, object_id)
            if row is None:
                raise HTTPException(status_code=404, detail=f"Link row missing: {object_id}")

            new_kind = patch.get("link_kind")
            if new_kind is not None and str(new_kind).lower() != kind:
                lines, model, section, row, kind = self._convert_link_kind(
                    lines,
                    model,
                    object_id,
                    old_section=section,
                    old_kind=kind,
                    new_kind=str(new_kind).lower(),
                    patch=patch,
                )
                changed = True

            if patch.get("from_node") is not None:
                lines[row] = self._replace_field_in_line(
                    lines[row], 1, str(patch["from_node"])
                )
                changed = True
            if patch.get("to_node") is not None:
                lines[row] = self._replace_field_in_line(
                    lines[row], 2, str(patch["to_node"])
                )
                changed = True

            if section == "CONDUITS":
                for key, idx in (
                    ("length", 3),
                    ("roughness", 4),
                    ("in_offset", 5),
                    ("out_offset", 6),
                    ("init_flow", 7),
                    ("max_flow", 8),
                ):
                    if patch.get(key) is not None:
                        lines[row] = self._replace_field_in_line(
                            lines[row], idx, str(patch[key])
                        )
                        changed = True
            elif section == "PUMPS":
                for key, idx in (
                    ("pump_curve", 3),
                    ("status", 4),
                    ("startup", 5),
                    ("shutoff", 6),
                ):
                    if patch.get(key) is not None:
                        val = str(patch[key]).upper() if key == "status" else str(patch[key])
                        lines[row] = self._replace_field_in_line(lines[row], idx, val)
                        changed = True
            elif section == "ORIFICES":
                for key, idx in (
                    ("orifice_type", 3),
                    ("offset", 4),
                    ("qcoeff", 5),
                    ("gated", 6),
                    ("close_time", 7),
                ):
                    if patch.get(key) is not None:
                        val = (
                            str(patch[key]).upper()
                            if key in ("orifice_type", "gated")
                            else str(patch[key])
                        )
                        lines[row] = self._replace_field_in_line(lines[row], idx, val)
                        changed = True
            elif section == "WEIRS":
                for key, idx in (
                    ("weir_type", 3),
                    ("crest_height", 4),
                    ("qcoeff", 5),
                    ("gated", 6),
                    ("end_con", 7),
                    ("end_coeff", 8),
                ):
                    if patch.get(key) is not None:
                        val = (
                            str(patch[key]).upper()
                            if key in ("weir_type", "gated")
                            else str(patch[key])
                        )
                        lines[row] = self._replace_field_in_line(lines[row], idx, val)
                        changed = True
            elif section == "OUTLETS":
                outlet_keys = (
                    "offset",
                    "outlet_type",
                    "qcoeff_or_curve",
                    "qexpon",
                    "gated",
                )
                if any(patch.get(k) is not None for k in outlet_keys):
                    cur = dict(model.outlets.get(object_id, {}))
                    # Refresh from/to from current line tokens after possible edits
                    toks = _tokenize(lines[row])
                    if len(toks) >= 3:
                        cur["from_node"] = toks[1]
                        cur["to_node"] = toks[2]
                    for k in outlet_keys:
                        if patch.get(k) is not None:
                            cur[k] = patch[k]
                    lines[row] = self._format_link_line("outlet", object_id, cur)
                    changed = True

            xs_row = self._find_data_line(model, "XSECTIONS", object_id)
            diam = patch.get("diameter", patch.get("geom1"))
            if diam is not None:
                if xs_row is None and kind in ("conduit", "orifice", "weir"):
                    lines = self._ensure_section(lines, "XSECTIONS")
                    model = self._parse(inp_path, model.mtime, "".join(lines))
                    lines = list(model.lines)
                    xs_row_line = (
                        f"{object_id}          CIRCULAR     {diam}              "
                        f"0          0          0          1\n"
                    )
                    xs_at = self._section_insert_index(model, "XSECTIONS")
                    lines.insert(xs_at, xs_row_line)
                    model = self._parse(inp_path, model.mtime, "".join(lines))
                    lines = list(model.lines)
                    xs_row = self._find_data_line(model, "XSECTIONS", object_id)
                    changed = True
                elif xs_row is None:
                    raise HTTPException(
                        status_code=404, detail=f"XSECTION not found for {object_id}"
                    )
                else:
                    lines[xs_row] = self._replace_field_in_line(lines[xs_row], 2, str(diam))
                    changed = True
            if xs_row is not None:
                if patch.get("shape") is not None:
                    lines[xs_row] = self._replace_field_in_line(
                        lines[xs_row], 1, str(patch["shape"]).upper()
                    )
                    changed = True
                for key, idx in (
                    ("geom2", 3),
                    ("geom3", 4),
                    ("geom4", 5),
                    ("barrels", 6),
                ):
                    if patch.get(key) is not None:
                        lines[xs_row] = self._replace_field_in_line(
                            lines[xs_row], idx, str(patch[key])
                        )
                        changed = True

            if patch.get("vertices") is not None:
                # Remove existing VERTICES lines for this link, then insert new ones
                vert_indices = [
                    idx
                    for idx, raw in model.sections.get("VERTICES", [])
                    if not _is_comment(raw) and _tokenize(raw)[:1] == [object_id]
                ]
                for idx in reversed(vert_indices):
                    del lines[idx]
                    changed = True
                text = "".join(lines)
                text = self._replace_vertices_block(text, object_id, patch["vertices"])
                lines = text.splitlines(keepends=True)
                changed = True

        elif object_type == "subcatchment":
            row = self._find_data_line(model, "SUBCATCHMENTS", object_id)
            if row is None:
                raise HTTPException(
                    status_code=404, detail=f"Subcatchment not found: {object_id}"
                )
            for key, idx in (
                ("raingage", 1),
                ("outlet", 2),
                ("area", 3),
                ("pct_imperv", 4),
                ("width", 5),
                ("slope", 6),
                ("curb_len", 7),
                ("snow_pack", 8),
            ):
                if patch.get(key) is not None:
                    lines[row] = self._replace_field_in_line(
                        lines[row], idx, str(patch[key])
                    )
                    changed = True

            subarea_keys = (
                ("n_imperv", 1),
                ("n_perv", 2),
                ("s_imperv", 3),
                ("s_perv", 4),
                ("pct_zero", 5),
                ("subarea_route_to", 6),
                ("pct_routed", 7),
            )
            if any(patch.get(k) is not None for k, _ in subarea_keys):
                sa_row = self._find_data_line(model, "SUBAREAS", object_id)
                if sa_row is None:
                    raise HTTPException(
                        status_code=404, detail=f"SUBAREAS row not found for {object_id}"
                    )
                for key, idx in subarea_keys:
                    if patch.get(key) is not None:
                        lines[sa_row] = self._replace_field_in_line(
                            lines[sa_row], idx, str(patch[key])
                        )
                        changed = True

            infil_keys = (
                ("infil_p1", 1),
                ("infil_p2", 2),
                ("infil_p3", 3),
                ("infil_p4", 4),
                ("infil_p5", 5),
            )
            if any(patch.get(k) is not None for k, _ in infil_keys):
                inf_row = self._find_data_line(model, "INFILTRATION", object_id)
                if inf_row is None:
                    raise HTTPException(
                        status_code=404,
                        detail=f"INFILTRATION row not found for {object_id}",
                    )
                for key, idx in infil_keys:
                    if patch.get(key) is not None:
                        lines[inf_row] = self._replace_field_in_line(
                            lines[inf_row], idx, str(patch[key])
                        )
                        changed = True
        else:
            raise HTTPException(status_code=400, detail=f"Unknown object type: {object_type}")

        if not changed:
            return self.get_object(inp_path, object_type, object_id)

        atomic_write_text(inp_path, "".join(lines))
        self.invalidate()
        return self.get_object(inp_path, object_type, object_id)

    def _format_outfall_line(self, object_id: str, attrs: dict[str, Any]) -> str:
        otype = str(attrs.get("type", "FREE")).upper()
        elev = attrs.get("elevation", 0.0)
        gated = str(attrs.get("gated", "NO") or "NO").upper()
        route = str(attrs.get("route_to", "") or "")
        stage = str(attrs.get("stage_data", "") or "")
        parts: list[str] = [object_id, str(elev), otype]
        if otype in ("FREE", "NORMAL"):
            parts.append(gated)
        else:
            parts.append(stage if stage else "0")
            parts.append(gated)
        if route:
            parts.append(route)
        return "  ".join(parts) + "\n"

    _LINK_KIND_SECTION = {
        "conduit": "CONDUITS",
        "pump": "PUMPS",
        "orifice": "ORIFICES",
        "weir": "WEIRS",
        "outlet": "OUTLETS",
    }

    def _default_link_attrs(
        self,
        kind: str,
        from_node: str,
        to_node: str,
        *,
        length: float = 10.0,
        roughness: float = 0.01,
    ) -> dict[str, Any]:
        base: dict[str, Any] = {"from_node": from_node, "to_node": to_node}
        if kind == "conduit":
            base.update(
                {
                    "length": length,
                    "roughness": roughness,
                    "in_offset": 0.0,
                    "out_offset": 0.0,
                    "init_flow": 0.0,
                    "max_flow": 0.0,
                }
            )
        elif kind == "pump":
            base.update(
                {
                    "pump_curve": "*",
                    "status": "ON",
                    "startup": 0.0,
                    "shutoff": 0.0,
                }
            )
        elif kind == "orifice":
            base.update(
                {
                    "orifice_type": "SIDE",
                    "offset": 0.0,
                    "qcoeff": 0.65,
                    "gated": "NO",
                    "close_time": 0.0,
                }
            )
        elif kind == "weir":
            base.update(
                {
                    "weir_type": "TRANSVERSE",
                    "crest_height": 0.0,
                    "qcoeff": 3.33,
                    "gated": "NO",
                    "end_con": 0.0,
                    "end_coeff": 0.0,
                }
            )
        elif kind == "outlet":
            base.update(
                {
                    "offset": 0.0,
                    "outlet_type": "FUNCTIONAL/DEPTH",
                    "qcoeff_or_curve": "1.0",
                    "qexpon": 0.5,
                    "gated": "NO",
                }
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unknown link kind: {kind}")
        return base

    def _format_link_line(self, kind: str, link_id: str, attrs: dict[str, Any]) -> str:
        fr = attrs.get("from_node", "")
        to = attrs.get("to_node", "")
        if kind == "conduit":
            return (
                f"{link_id}          {fr}         {to}         "
                f"{float(attrs.get('length', 0)):.3f}         "
                f"{attrs.get('roughness', 0.01)}         "
                f"{attrs.get('in_offset', 0)}         "
                f"{attrs.get('out_offset', 0)}         "
                f"{attrs.get('init_flow', 0)}         "
                f"{attrs.get('max_flow', 0)}\n"
            )
        if kind == "pump":
            return (
                f"{link_id}          {fr}         {to}         "
                f"{attrs.get('pump_curve', '*')}         "
                f"{str(attrs.get('status', 'ON')).upper()}         "
                f"{attrs.get('startup', 0)}         "
                f"{attrs.get('shutoff', 0)}\n"
            )
        if kind == "orifice":
            return (
                f"{link_id}          {fr}         {to}         "
                f"{str(attrs.get('orifice_type', 'SIDE')).upper()}         "
                f"{attrs.get('offset', 0)}         "
                f"{attrs.get('qcoeff', 0.65)}         "
                f"{str(attrs.get('gated', 'NO')).upper()}         "
                f"{attrs.get('close_time', 0)}\n"
            )
        if kind == "weir":
            return (
                f"{link_id}          {fr}         {to}         "
                f"{str(attrs.get('weir_type', 'TRANSVERSE')).upper()}         "
                f"{attrs.get('crest_height', 0)}         "
                f"{attrs.get('qcoeff', 3.33)}         "
                f"{str(attrs.get('gated', 'NO')).upper()}         "
                f"{attrs.get('end_con', 0)}         "
                f"{attrs.get('end_coeff', 0)}\n"
            )
        if kind == "outlet":
            otype = str(attrs.get("outlet_type", "FUNCTIONAL/DEPTH")).upper()
            parts = [
                link_id,
                str(fr),
                str(to),
                str(attrs.get("offset", 0)),
                otype,
                str(attrs.get("qcoeff_or_curve", "1.0")),
            ]
            if "FUNCTIONAL" in otype:
                parts.append(str(attrs.get("qexpon", 0.5)))
            parts.append(str(attrs.get("gated", "NO")).upper())
            return "  ".join(parts) + "\n"
        raise HTTPException(status_code=400, detail=f"Unknown link kind: {kind}")

    def _convert_link_kind(
        self,
        lines: list[str],
        model: ParsedModel,
        object_id: str,
        *,
        old_section: str,
        old_kind: str,
        new_kind: str,
        patch: dict[str, Any],
    ) -> tuple[list[str], ParsedModel, str, int, str]:
        if new_kind not in self._LINK_KIND_SECTION:
            raise HTTPException(status_code=400, detail=f"Invalid link_kind: {new_kind}")

        stores = {
            "conduit": model.conduits,
            "pump": model.pumps,
            "orifice": model.orifices,
            "weir": model.weirs,
            "outlet": model.outlets,
        }
        cur = dict(stores[old_kind].get(object_id, {}))
        from_node = str(patch.get("from_node") or cur.get("from_node") or "")
        to_node = str(patch.get("to_node") or cur.get("to_node") or "")
        if not from_node or not to_node:
            raise HTTPException(
                status_code=400, detail="from_node and to_node required to convert link kind"
            )

        length = float(patch["length"]) if patch.get("length") is not None else float(
            cur.get("length") or 0
        )
        if new_kind == "conduit" and length <= 0:
            length = self._gis_link_length(model, from_node, to_node)

        attrs = self._default_link_attrs(
            new_kind,
            from_node,
            to_node,
            length=length,
            roughness=float(patch.get("roughness", cur.get("roughness", 0.01))),
        )
        # Carry over shared numeric fields when present
        for key in (
            "pump_curve",
            "status",
            "startup",
            "shutoff",
            "orifice_type",
            "offset",
            "qcoeff",
            "gated",
            "close_time",
            "weir_type",
            "crest_height",
            "end_con",
            "end_coeff",
            "outlet_type",
            "qcoeff_or_curve",
            "qexpon",
            "in_offset",
            "out_offset",
            "init_flow",
            "max_flow",
        ):
            if patch.get(key) is not None:
                attrs[key] = patch[key]
            elif key in cur and key in attrs:
                attrs[key] = cur[key]

        # Drop old section row
        lines = self._delete_lines_for_id(lines, model, old_section, object_id)
        new_section = self._LINK_KIND_SECTION[new_kind]
        lines = self._ensure_section(lines, new_section)
        if new_kind in ("conduit", "orifice", "weir"):
            lines = self._ensure_section(lines, "XSECTIONS")
        model = self._parse(model.path, model.mtime, "".join(lines))
        lines = list(model.lines)

        insert_at = self._section_insert_index(model, new_section)
        lines.insert(insert_at, self._format_link_line(new_kind, object_id, attrs))
        model = self._parse(model.path, model.mtime, "".join(lines))
        lines = list(model.lines)

        # Ensure xsection for conduit/orifice/weir if missing
        if new_kind in ("conduit", "orifice", "weir"):
            xs_row = self._find_data_line(model, "XSECTIONS", object_id)
            if xs_row is None:
                diam = patch.get("diameter", patch.get("geom1", 1.0))
                xs_line = (
                    f"{object_id}          CIRCULAR     {diam}              "
                    f"0          0          0          1\n"
                )
                xs_at = self._section_insert_index(model, "XSECTIONS")
                lines.insert(xs_at, xs_line)
                model = self._parse(model.path, model.mtime, "".join(lines))
                lines = list(model.lines)

        row = self._find_data_line(model, new_section, object_id)
        if row is None:
            raise HTTPException(
                status_code=500, detail=f"Failed to convert link {object_id} to {new_kind}"
            )
        return lines, model, new_section, row, new_kind

    def _section_insert_index(self, model: ParsedModel, section: str) -> int:
        entries = model.sections.get(section, [])
        if entries:
            return entries[-1][0] + 1
        # Find section header
        header = f"[{section}]"
        for i, line in enumerate(model.lines):
            if line.strip().upper() == header.upper() or (
                section == "Polygons" and line.strip() in ("[Polygons]", "[POLYGONS]")
            ):
                return i + 1
        return len(model.lines)

    def _ensure_section(self, lines: list[str], section: str) -> list[str]:
        """Ensure [SECTION] exists; return (possibly extended) lines."""
        header = f"[{section}]"
        for line in lines:
            stripped = line.strip()
            if stripped.upper() == header.upper():
                return lines
            if section == "Polygons" and stripped in ("[Polygons]", "[POLYGONS]"):
                return lines
        # Insert before [END] when present so SWMM still reads the section
        end_idx = None
        for i, line in enumerate(lines):
            if line.strip().upper() == "[END]":
                end_idx = i
                break
        insert_at = end_idx if end_idx is not None else len(lines)
        block: list[str] = []
        if insert_at > 0 and lines[insert_at - 1].strip():
            block.append("\n")
        block.append(f"{header}\n")
        if end_idx is not None:
            block.append("\n")
        for j, row in enumerate(block):
            lines.insert(insert_at + j, row)
        return lines

    def _unique_id(self, existing: set[str], prefix: str) -> str:
        n = 1
        while f"{prefix}{n}" in existing:
            n += 1
        return f"{prefix}{n}"

    def _all_object_ids(self, model: ParsedModel) -> set[str]:
        """SWMM names must be unique across nodes, links, and subcatchments."""
        ids: set[str] = set()
        ids.update(model.all_nodes().keys())
        ids.update(model.all_links().keys())
        ids.update(model.subcatchments.keys())
        return ids

    def _write_lines(self, inp_path: Path, lines: list[str]) -> None:
        atomic_write_text(inp_path, "".join(lines))
        self.invalidate()

    def _delete_lines_for_id(
        self, lines: list[str], model: ParsedModel, section: str, object_id: str
    ) -> list[str]:
        indices = [
            idx
            for idx, raw in model.sections.get(section, [])
            if not _is_comment(raw) and _tokenize(raw)[:1] == [object_id]
        ]
        for idx in reversed(indices):
            if 0 <= idx < len(lines):
                del lines[idx]
        return lines

    def _polygon_area(self, ring: list[list[float]]) -> float:
        if len(ring) < 3:
            return 0.0
        pts = ring[:]
        if pts[0] != pts[-1]:
            pts = pts + [pts[0]]
        area = 0.0
        for i in range(len(pts) - 1):
            x1, y1 = pts[i]
            x2, y2 = pts[i + 1]
            area += x1 * y2 - x2 * y1
        return abs(area) * 0.5

    def create_node(
        self,
        inp_path: Path,
        *,
        node_kind: str,
        x: float,
        y: float,
        node_id: Optional[str] = None,
        elevation: float = 0.0,
        max_depth: float = 0.0,
    ) -> dict[str, Any]:
        model = self.load(inp_path)
        existing = self._all_object_ids(model)
        if node_id:
            if node_id in existing:
                raise HTTPException(status_code=409, detail=f"Name already in use: {node_id}")
            nid = node_id
        else:
            # Use ST for storage — S* often used by subcatchments
            prefix = {"junction": "J", "outfall": "O", "storage": "ST"}.get(node_kind, "N")
            nid = self._unique_id(existing, prefix)

        if node_kind == "junction":
            section = "JUNCTIONS"
            row = (
                f"{nid}          {elevation}         {max_depth}         "
                f"0         0         0\n"
            )
        elif node_kind == "outfall":
            section = "OUTFALLS"
            row = f"{nid}          {elevation}         FREE                        NO\n"
        elif node_kind == "storage":
            section = "STORAGE"
            # FUNCTIONAL with constant area (no curve required) — valid blank storage
            depth = max_depth if max_depth and max_depth > 0 else 5.0
            row = (
                f"{nid}          {elevation}         {depth}         "
                f"0         FUNCTIONAL  1000  0  0  0  0\n"
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unknown node_kind: {node_kind}")

        lines = list(model.lines)
        lines = self._ensure_section(lines, section)
        lines = self._ensure_section(lines, "COORDINATES")
        # Refresh indices after ensure (sections may have been appended)
        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)

        insert_at = self._section_insert_index(model, section)
        lines.insert(insert_at, row)
        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)
        coord_line = f"{nid}          {x:.3f}         {y:.3f}\n"
        coord_at = self._section_insert_index(model, "COORDINATES")
        lines.insert(coord_at, coord_line)

        self._write_lines(inp_path, lines)
        return self.get_object(inp_path, "node", nid)

    def _gis_link_length(
        self,
        model: ParsedModel,
        from_node: str,
        to_node: str,
        vertices: Optional[list[list[float]]] = None,
    ) -> float:
        """Plan-length along map geometry (projected CRS units, typically meters)."""
        c1 = model.coordinates.get(from_node)
        c2 = model.coordinates.get(to_node)
        if c1 is None or c2 is None:
            return 100.0
        pts: list[tuple[float, float]] = [(float(c1[0]), float(c1[1]))]
        if vertices:
            for v in vertices:
                if len(v) >= 2:
                    pts.append((float(v[0]), float(v[1])))
        pts.append((float(c2[0]), float(c2[1])))
        total = 0.0
        for i in range(len(pts) - 1):
            total += math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        return max(total, 0.001)

    def create_link(
        self,
        inp_path: Path,
        *,
        from_node: str,
        to_node: str,
        link_kind: str = "conduit",
        link_id: Optional[str] = None,
        length: Optional[float] = None,
        roughness: float = 0.01,
        diameter: float = 1.0,
    ) -> dict[str, Any]:
        model = self.load(inp_path)
        nodes = model.all_nodes()
        if from_node not in nodes:
            raise HTTPException(status_code=404, detail=f"From node not found: {from_node}")
        if to_node not in nodes:
            raise HTTPException(status_code=404, detail=f"To node not found: {to_node}")
        if from_node == to_node:
            raise HTTPException(status_code=400, detail="from_node and to_node must differ")

        kind = str(link_kind or "conduit").lower()
        if kind not in self._LINK_KIND_SECTION:
            raise HTTPException(status_code=400, detail=f"Unknown link kind: {kind}")

        existing = self._all_object_ids(model)
        prefixes = {
            "conduit": "C",
            "pump": "PU",
            "orifice": "OR",
            "weir": "W",
            "outlet": "OL",
        }
        lid = link_id or self._unique_id(existing, prefixes[kind])
        if lid in existing:
            raise HTTPException(status_code=409, detail=f"Name already in use: {lid}")

        if kind == "conduit" and (length is None or float(length) <= 0):
            length = self._gis_link_length(model, from_node, to_node)

        attrs = self._default_link_attrs(
            kind,
            from_node,
            to_node,
            length=float(length or 10.0),
            roughness=roughness,
        )

        section = self._LINK_KIND_SECTION[kind]
        lines = list(model.lines)
        lines = self._ensure_section(lines, section)
        if kind in ("conduit", "orifice", "weir"):
            lines = self._ensure_section(lines, "XSECTIONS")
        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)

        insert_at = self._section_insert_index(model, section)
        lines.insert(insert_at, self._format_link_line(kind, lid, attrs))

        if kind in ("conduit", "orifice", "weir"):
            model = self._parse(inp_path, model.mtime, "".join(lines))
            lines = list(model.lines)
            xs_row = f"{lid}          CIRCULAR     {diameter}              0          0          0          1\n"
            xs_at = self._section_insert_index(model, "XSECTIONS")
            lines.insert(xs_at, xs_row)

        self._write_lines(inp_path, lines)
        return self.get_object(inp_path, "link", lid)

    def create_subcatchment(
        self,
        inp_path: Path,
        *,
        outlet: str,
        polygon: list[list[float]],
        sub_id: Optional[str] = None,
        raingage: str = "RG1",
        area: Optional[float] = None,
        pct_imperv: float = 50.0,
        width: Optional[float] = None,
        slope: float = 0.5,
    ) -> dict[str, Any]:
        model = self.load(inp_path)
        if outlet not in model.all_nodes():
            raise HTTPException(status_code=404, detail=f"Outlet node not found: {outlet}")
        if len(polygon) < 3:
            raise HTTPException(status_code=400, detail="Polygon needs at least 3 vertices")

        existing = self._all_object_ids(model)
        sid = sub_id or self._unique_id(existing, "S")
        if sid in existing:
            raise HTTPException(status_code=409, detail=f"Name already in use: {sid}")

        ring = [[float(p[0]), float(p[1])] for p in polygon]
        poly_area = self._polygon_area(ring)
        # Assume projected meters → convert m² to hectares when area not provided
        if area is None:
            area = max(poly_area / 10000.0, 0.001)
        if width is None:
            width = max(math.sqrt(max(poly_area, 1.0)), 10.0)

        lines = list(model.lines)
        for sec in ("SUBCATCHMENTS", "SUBAREAS", "INFILTRATION", "Polygons"):
            lines = self._ensure_section(lines, sec)

        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)

        sub_row = (
            f"{sid}          {raingage}         {outlet}         "
            f"{area:.4f}         {pct_imperv}         {width:.3f}         {slope}         0\n"
        )
        insert_at = self._section_insert_index(model, "SUBCATCHMENTS")
        lines.insert(insert_at, sub_row)

        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)
        subarea_row = (
            f"{sid}          0.01       0.1        0.05       0.05       25         OUTLET\n"
        )
        sa_at = self._section_insert_index(model, "SUBAREAS")
        lines.insert(sa_at, subarea_row)

        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)
        infil_row = f"{sid}          3.0        0.5        4          7          0\n"
        inf_at = self._section_insert_index(model, "INFILTRATION")
        lines.insert(inf_at, infil_row)

        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)
        poly_at = self._section_insert_index(model, "Polygons")
        poly_lines = [
            f"{sid}          {x:.3f}         {y:.3f}\n" for x, y in ring
        ]
        for i, pl in enumerate(poly_lines):
            lines.insert(poly_at + i, pl)

        self._write_lines(inp_path, lines)
        return self.get_object(inp_path, "subcatchment", sid)

    # Sections whose rows are keyed (first token) by an object of each kind.
    # Deleting the object removes these rows. TAGS rows are "<Kind> <id> <tag>".
    _NODE_KEYED = (
        "JUNCTIONS", "OUTFALLS", "STORAGE", "DIVIDERS", "COORDINATES",
        "INFLOWS", "DWF", "RDII", "TREATMENT",
    )
    _LINK_KEYED = (
        "CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS",
        "XSECTIONS", "LOSSES", "VERTICES",
    )
    _SUBCATCH_KEYED = (
        "SUBCATCHMENTS", "SUBAREAS", "INFILTRATION", "Polygons",
        "COVERAGES", "LOADINGS", "LID_USAGE", "GROUNDWATER", "GWF",
    )

    def _row_indices(
        self,
        model: ParsedModel,
        keyed_sections: tuple[str, ...],
        ids: set[str],
        tag_kind: str,
    ) -> set[int]:
        """Line indices of every row that belongs to one of ``ids``."""
        out: set[int] = set()
        for sec in keyed_sections:
            for idx, raw in model.sections.get(sec, []):
                if _is_comment(raw):
                    continue
                toks = _tokenize(raw)
                if toks and toks[0] in ids:
                    out.add(idx)
        for idx, raw in model.sections.get("TAGS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 2 and toks[0].lower() == tag_kind and toks[1] in ids:
                out.add(idx)
        return out

    @staticmethod
    def _controls_mentioning(model: ParsedModel, ids: set[str]) -> list[str]:
        """Rule names in [CONTROLS] that reference any of ``ids`` (not auto-edited)."""
        hits: list[str] = []
        rule = None
        for _, raw in model.sections.get("CONTROLS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if not toks:
                continue
            if toks[0].upper() == "RULE" and len(toks) > 1:
                rule = toks[1]
                continue
            if rule and rule not in hits and any(t in ids for t in toks):
                hits.append(rule)
        return hits

    @staticmethod
    def _drop_lines(lines: list[str], indices: set[int]) -> list[str]:
        return [ln for i, ln in enumerate(lines) if i not in indices]

    def delete_object(
        self,
        inp_path: Path,
        object_type: str,
        object_id: str,
        *,
        cascade: bool = False,
    ) -> dict[str, Any]:
        """Delete a node, link or subcatchment and every row that references it.

        Leaves the model runnable: rows keyed by the object in all dependent
        sections are removed in one pass. References that cannot be safely
        removed (subcatchments draining to a node) block the delete with 409;
        [CONTROLS] rules that mention the object are reported as warnings.
        """
        model = self.load(inp_path)
        warnings: list[str] = []

        if object_type == "node":
            if object_id not in model.all_nodes():
                raise HTTPException(status_code=404, detail=f"Node not found: {object_id}")
            connected = [
                lid
                for lid, attrs in model.all_links().items()
                if attrs["from_node"] == object_id or attrs["to_node"] == object_id
            ]
            if connected and not cascade:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": f"Node {object_id} has connected links",
                        "connected_link_ids": connected,
                    },
                )
            draining = sorted(
                sid for sid, sc in model.subcatchments.items() if sc.get("outlet") == object_id
            )
            if draining:
                shown = ", ".join(draining[:5]) + (" …" if len(draining) > 5 else "")
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": (
                            f"{len(draining)} subcatchment(s) drain to {object_id} ({shown}). "
                            "Change their outlet before deleting this node."
                        ),
                        "subcatchment_ids": draining,
                    },
                )
            drop = self._row_indices(model, self._NODE_KEYED, {object_id}, "node")
            drop |= self._row_indices(model, self._LINK_KEYED, set(connected), "link")
            # Groundwater rows name the receiving node in field 3; drop the row.
            for idx, raw in model.sections.get("GROUNDWATER", []):
                toks = _tokenize(raw)
                if not _is_comment(raw) and len(toks) > 2 and toks[2] == object_id:
                    drop.add(idx)
            rules = self._controls_mentioning(model, {object_id, *connected})
            if rules:
                warnings.append(
                    "Control rules still reference deleted objects: " + ", ".join(rules)
                )
            self._write_lines(inp_path, self._drop_lines(list(model.lines), drop))
            return {
                "deleted": True,
                "object_type": "node",
                "id": object_id,
                "cascaded_link_ids": connected,
                "warnings": warnings,
            }

        if object_type == "link":
            if object_id not in model.all_links():
                raise HTTPException(status_code=404, detail=f"Link not found: {object_id}")
            drop = self._row_indices(model, self._LINK_KEYED, {object_id}, "link")
            rules = self._controls_mentioning(model, {object_id})
            if rules:
                warnings.append("Control rules still reference this link: " + ", ".join(rules))
            for _, raw in model.sections.get("DIVIDERS", []):
                toks = _tokenize(raw)
                if not _is_comment(raw) and len(toks) > 1 and toks[1] == object_id:
                    warnings.append(f"Divider {toks[0]} diverts to this link; update it.")
            self._write_lines(inp_path, self._drop_lines(list(model.lines), drop))
            return {
                "deleted": True,
                "object_type": "link",
                "id": object_id,
                "cascaded_link_ids": [],
                "warnings": warnings,
            }

        if object_type == "subcatchment":
            if object_id not in model.subcatchments:
                raise HTTPException(
                    status_code=404, detail=f"Subcatchment not found: {object_id}"
                )
            drop = self._row_indices(model, self._SUBCATCH_KEYED, {object_id}, "subcatch")
            lines = list(model.lines)
            # Subcatchments that drained into this one now drain to its outlet.
            new_outlet = model.subcatchments[object_id].get("outlet") or ""
            rerouted: list[str] = []
            for idx, raw in model.sections.get("SUBCATCHMENTS", []):
                toks = _tokenize(raw)
                if (
                    not _is_comment(raw)
                    and len(toks) > 2
                    and toks[2] == object_id
                    and toks[0] != object_id
                ):
                    lines[idx] = self._replace_field_in_line(lines[idx], 2, new_outlet)
                    rerouted.append(toks[0])
            if rerouted:
                warnings.append(
                    f"Re-routed {len(rerouted)} upstream subcatchment(s) to {new_outlet}."
                )
            self._write_lines(inp_path, self._drop_lines(lines, drop))
            return {
                "deleted": True,
                "object_type": "subcatchment",
                "id": object_id,
                "cascaded_link_ids": [],
                "rerouted_subcatchment_ids": rerouted,
                "warnings": warnings,
            }

        raise HTTPException(status_code=400, detail=f"Unknown object type: {object_type}")

    def _delete_link_lines(
        self, lines: list[str], model: ParsedModel, link_id: str
    ) -> list[str]:
        """Remove every row keyed by ``link_id`` (``lines`` must match ``model``)."""
        drop = self._row_indices(model, self._LINK_KEYED, {link_id}, "link")
        return self._drop_lines(lines, drop)

    def _replace_vertices_block(
        self, text: str, link_id: str, vertices: list[list[float]]
    ) -> str:
        lines = text.splitlines(keepends=True)
        out: list[str] = []
        in_vertices = False
        inserted = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                if in_vertices and not inserted:
                    for vx, vy in vertices:
                        out.append(f"{link_id}          {vx:.3f}         {vy:.3f}\n")
                    inserted = True
                in_vertices = stripped.upper() in ("[VERTICES]",)
                out.append(line)
                continue
            if in_vertices:
                if _is_comment(line):
                    out.append(line)
                    continue
                toks = _tokenize(line)
                if toks and toks[0] == link_id:
                    continue  # drop old
                out.append(line)
            else:
                out.append(line)
        if in_vertices and not inserted:
            for vx, vy in vertices:
                out.append(f"{link_id}          {vx:.3f}         {vy:.3f}\n")
        return "".join(out)

    def upsert_file_raingage(
        self,
        inp_path: Path,
        *,
        name: str,
        filename: str,
        rain_format: str = "VOLUME",
        interval: str = "0:05",
        scf: float = 1.0,
        units: str = "IN",
    ) -> dict[str, str]:
        """Create or replace a FILE-source raingage in [RAINGAGES].

        Prefer VOLUME (depth per interval in the rain FILE). OpenSWMM under-reads
        INTENSITY FILE rain. If the caller requests INTENSITY, the gage is written
        then converted in-place to VOLUME via convert_intensity_file_raingage_to_volume.
        """
        gage = name.strip()
        if not gage or any(c.isspace() for c in gage):
            raise HTTPException(status_code=400, detail="Invalid raingage name")
        fname = Path(filename).name.strip()
        if not fname:
            raise HTTPException(status_code=400, detail="Invalid rain file name")
        fmt = rain_format.upper()
        if fmt not in ("INTENSITY", "VOLUME"):
            raise HTTPException(status_code=400, detail="format must be INTENSITY or VOLUME")
        unit = units.upper()
        if unit not in ("IN", "MM"):
            raise HTTPException(status_code=400, detail="units must be IN or MM")

        # Name Format Interval SCF FILE "file.dat" Station Units
        line = (
            f"{gage:<16} {fmt:<9} {interval:<8} {scf:<8} "
            f'FILE       "{fname}"        {gage}     {unit}\n'
        )

        model = self.load(inp_path)
        lines = list(model.lines)
        lines = self._ensure_section(lines, "RAINGAGES")
        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)

        existing = self._find_data_line(model, "RAINGAGES", gage)
        if existing is not None:
            lines[existing] = line
        else:
            insert_at = self._section_insert_index(model, "RAINGAGES")
            lines.insert(insert_at, line)

        self._write_lines(inp_path, lines)

        if fmt == "INTENSITY":
            converted = self.convert_intensity_file_raingage_to_volume(inp_path, gage)
            if converted.get("converted"):
                gages = {g["name"]: g for g in self.list_raingages(inp_path)}
                info = gages.get(gage) or {}
                return {
                    "name": gage,
                    "filename": fname,
                    "line": (
                        f"{gage:<16} VOLUME    "
                        f"{str(info.get('interval') or interval):<8} "
                        f"{float(info.get('scf') or scf):<8} "
                        f'FILE       "{fname}"        {gage}     {unit}'
                    ).strip(),
                }

        return {"name": gage, "filename": fname, "line": line.strip()}

    def get_simulation_window(self, inp_path: Path) -> dict[str, Any]:
        """Read START/END date-time and THREADS from [OPTIONS]."""
        import os

        model = self.load(inp_path)
        opts: dict[str, str] = {}
        for _, raw in model.sections.get("OPTIONS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 2:
                opts[toks[0].upper()] = toks[1]

        start_date = opts.get("START_DATE")
        start_time = opts.get("START_TIME", "00:00:00")
        end_date = opts.get("END_DATE")
        end_time = opts.get("END_TIME", "00:00:00")
        report_start_date = opts.get("REPORT_START_DATE", start_date)
        report_start_time = opts.get("REPORT_START_TIME", start_time)

        threads = 1
        raw_threads = opts.get("THREADS")
        if raw_threads is not None:
            try:
                threads = int(float(raw_threads))
            except ValueError:
                threads = 1
        if threads < 0:
            threads = 1

        cpu_count = os.cpu_count() or 1

        def combine(d: str | None, t: str | None) -> str | None:
            if not d:
                return None
            return f"{d} {t or '00:00:00'}"

        return {
            "start": combine(start_date, start_time),
            "end": combine(end_date, end_time),
            "report_start": combine(report_start_date, report_start_time),
            "start_date": start_date,
            "start_time": start_time,
            "end_date": end_date,
            "end_time": end_time,
            "threads": threads,
            "cpu_count": cpu_count,
            "report_step": opts.get("REPORT_STEP"),
            "routing_step": opts.get("ROUTING_STEP"),
            "flow_routing": opts.get("FLOW_ROUTING"),
        }

    def _set_option_value(self, lines: list[str], model: ParsedModel, key: str, value: str) -> list[str]:
        """Set or insert an OPTIONS key/value line."""
        key_u = key.upper()
        for idx, raw in model.sections.get("OPTIONS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if toks and toks[0].upper() == key_u:
                lines[idx] = self._replace_field_in_line(raw, 1, value)
                return lines
        # Insert new option at end of OPTIONS section
        lines = self._ensure_section(lines, "OPTIONS")
        model = self._parse(model.path, model.mtime, "".join(lines))
        lines = list(model.lines)
        insert_at = self._section_insert_index(model, "OPTIONS")
        lines.insert(insert_at, f"{key_u:<20} {value}\n")
        return lines

    def set_simulation_window(
        self,
        inp_path: Path,
        *,
        start_date: str,
        start_time: str,
        end_date: str,
        end_time: str,
        sync_report_start: bool = True,
        threads: Optional[int] = None,
        report_step: Optional[str] = None,
        routing_step: Optional[str] = None,
        flow_routing: Optional[str] = None,
    ) -> dict[str, Any]:
        def norm_date(d: str) -> str:
            d = d.strip().replace("-", "/")
            parts = d.split("/")
            if len(parts) != 3:
                raise HTTPException(status_code=400, detail=f"Invalid date: {d}")
            # Accept YYYY/MM/DD or MM/DD/YYYY
            if len(parts[0]) == 4:
                y, m, day = parts
                return f"{int(m):02d}/{int(day):02d}/{int(y):04d}"
            m, day, y = parts
            return f"{int(m):02d}/{int(day):02d}/{int(y):04d}"

        def norm_time(t: str) -> str:
            t = t.strip()
            bits = t.split(":")
            if len(bits) == 2:
                return f"{int(bits[0]):02d}:{int(bits[1]):02d}:00"
            if len(bits) == 3:
                return f"{int(bits[0]):02d}:{int(bits[1]):02d}:{int(bits[2]):02d}"
            raise HTTPException(status_code=400, detail=f"Invalid time: {t}")

        sd = norm_date(start_date)
        st = norm_time(start_time)
        ed = norm_date(end_date)
        et = norm_time(end_time)

        if threads is not None:
            if threads < 0:
                raise HTTPException(
                    status_code=400, detail="threads must be >= 0 (0 = all cores)"
                )
            import os

            cpu = os.cpu_count() or 1
            if threads > cpu:
                raise HTTPException(
                    status_code=400,
                    detail=f"threads ({threads}) exceeds CPU count ({cpu})",
                )

        model = self.load(inp_path)
        lines = list(model.lines)
        lines = self._ensure_section(lines, "OPTIONS")
        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)

        for key, val in (
            ("START_DATE", sd),
            ("START_TIME", st),
            ("END_DATE", ed),
            ("END_TIME", et),
        ):
            model = self._parse(inp_path, model.mtime, "".join(lines))
            lines = list(model.lines)
            lines = self._set_option_value(lines, model, key, val)

        if sync_report_start:
            model = self._parse(inp_path, model.mtime, "".join(lines))
            lines = list(model.lines)
            lines = self._set_option_value(lines, model, "REPORT_START_DATE", sd)
            model = self._parse(inp_path, model.mtime, "".join(lines))
            lines = list(model.lines)
            lines = self._set_option_value(lines, model, "REPORT_START_TIME", st)

        if threads is not None:
            model = self._parse(inp_path, model.mtime, "".join(lines))
            lines = list(model.lines)
            lines = self._set_option_value(lines, model, "THREADS", str(int(threads)))

        if report_step is not None and str(report_step).strip():
            model = self._parse(inp_path, model.mtime, "".join(lines))
            lines = list(model.lines)
            lines = self._set_option_value(
                lines, model, "REPORT_STEP", str(report_step).strip()
            )

        if routing_step is not None and str(routing_step).strip():
            model = self._parse(inp_path, model.mtime, "".join(lines))
            lines = list(model.lines)
            lines = self._set_option_value(
                lines, model, "ROUTING_STEP", str(routing_step).strip()
            )

        if flow_routing is not None and str(flow_routing).strip():
            fr = str(flow_routing).strip().upper()
            if fr not in {"DYNWAVE", "KINWAVE", "STEADY"}:
                raise HTTPException(
                    status_code=400,
                    detail="flow_routing must be DYNWAVE, KINWAVE, or STEADY",
                )
            model = self._parse(inp_path, model.mtime, "".join(lines))
            lines = list(model.lines)
            lines = self._set_option_value(lines, model, "FLOW_ROUTING", fr)

        self._write_lines(inp_path, lines)
        return self.get_simulation_window(inp_path)

    def list_raingages(self, inp_path: Path) -> list[dict[str, Any]]:
        model = self.load(inp_path)
        out: list[dict[str, Any]] = []
        for _, raw in model.sections.get("RAINGAGES", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 5:
                continue
            entry: dict[str, Any] = {
                "name": toks[0],
                "format": toks[1],
                "interval": toks[2],
                "scf": _f(toks[3], 1.0),
                "source": toks[4].upper(),
                "filename": None,
                "station": None,
                "units": None,
            }
            if toks[4].upper() == "FILE":
                # FILE "path" [station] [units]
                rest = toks[5:]
                if rest:
                    entry["filename"] = rest[0].strip('"')
                if len(rest) >= 2 and rest[1].upper() not in ("IN", "MM"):
                    entry["station"] = rest[1]
                    if len(rest) >= 3:
                        entry["units"] = rest[2].upper()
                elif len(rest) >= 2:
                    entry["units"] = rest[1].upper()
            elif toks[4].upper() == "TIMESERIES" and len(toks) > 5:
                entry["timeseries"] = toks[5]
            out.append(entry)
        return out

    def delete_raingage(self, inp_path: Path, name: str) -> dict[str, Any]:
        gage = name.strip()
        model = self.load(inp_path)
        row = self._find_data_line(model, "RAINGAGES", gage)
        if row is None:
            raise HTTPException(status_code=404, detail=f"Raingage not found: {gage}")
        lines = list(model.lines)
        del lines[row]
        self._write_lines(inp_path, lines)
        return {"deleted": True, "name": gage}

    def apply_raingage_to_all_subcatchments(
        self, inp_path: Path, raingage: str
    ) -> dict[str, Any]:
        gage = raingage.strip()
        if not gage:
            raise HTTPException(status_code=400, detail="Raingage name required")
        model = self.load(inp_path)
        lines = list(model.lines)
        updated = 0
        for sid in list(model.subcatchments.keys()):
            row = self._find_data_line(model, "SUBCATCHMENTS", sid)
            if row is None:
                continue
            lines[row] = self._replace_field_in_line(lines[row], 1, gage)
            updated += 1
            # Keep model line indices valid: re-parse after each change is slow;
            # field replacement doesn't change line count so indices stay valid.
        if updated == 0:
            raise HTTPException(status_code=404, detail="No subcatchments in model")
        self._write_lines(inp_path, lines)
        return {"raingage": gage, "updated": updated}

    def _parse_swmm_interval_minutes(self, token: str) -> float:
        parts = token.strip().split(":")
        try:
            if len(parts) == 1:
                return max(float(parts[0]), 1e-9)
            if len(parts) == 2:
                return max(int(parts[0]) * 60 + int(parts[1]), 1e-9)
            if len(parts) >= 3:
                return max(
                    int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2]),
                    1e-9,
                ) / 60.0
        except ValueError:
            pass
        return 5.0

    def convert_intensity_file_raingage_to_volume(
        self, inp_path: Path, raingage: str
    ) -> dict[str, Any]:
        """Rewrite an INTENSITY FILE gage as VOLUME (depth/interval).

        OpenSWMM currently under-reads INTENSITY rain FILEs by treating values
        like depths; VOLUME files produce the correct intensity on the gage and
        2D mesh.
        """
        gage = raingage.strip()
        gages = {g["name"]: g for g in self.list_raingages(inp_path)}
        info = gages.get(gage)
        if info is None:
            raise HTTPException(status_code=404, detail=f"Raingage not found: {gage}")
        if str(info.get("source", "")).upper() != "FILE":
            return {"raingage": gage, "converted": False, "reason": "not a FILE gage"}
        if str(info.get("format", "")).upper() != "INTENSITY":
            return {
                "raingage": gage,
                "converted": False,
                "reason": "already VOLUME or other format",
            }
        filename = info.get("filename")
        if not filename:
            raise HTTPException(status_code=400, detail="Raingage has no rain FILE name")

        from app.services.project_service import project_service

        root = project_service.require_root()
        target = project_service._safe_project_file(root, str(filename), must_exist=True)
        interval_min = self._parse_swmm_interval_minutes(str(info.get("interval") or "0:05"))
        dt_hr = interval_min / 60.0

        # Station Year Month Day Hour Minute Value  OR  datetime Value
        sta_re = re.compile(
            r"^(\s*\S+\s+\d{4}\s+\d{1,2}\s+\d{1,2}\s+\d{1,2}\s+\d{1,2}\s+)"
            r"([+-]?\d+(?:\.\d+)?)\s*$"
        )
        dt_re = re.compile(
            r"^(\s*\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s+)"
            r"([+-]?\d+(?:\.\d+)?)\s*$"
        )

        text = target.read_text(encoding="utf-8", errors="replace")
        out_lines: list[str] = []
        converted_n = 0
        for raw in text.splitlines():
            line = raw.rstrip("\n")
            stripped = line.strip()
            if not stripped or stripped.startswith(";"):
                if "value = intensity" in stripped.lower():
                    out_lines.append(f"; value = depth per {interval_min:g} min interval")
                else:
                    out_lines.append(line)
                continue
            m = sta_re.match(line) or dt_re.match(line)
            if not m:
                out_lines.append(line)
                continue
            intensity = float(m.group(2))
            depth = intensity * dt_hr
            out_lines.append(f"{m.group(1)}{depth:.6f}")
            converted_n += 1

        header = (
            f"; Converted INTENSITY→VOLUME (× {dt_hr:.6f} hr) for OpenSWMM FILE rain\n"
        )
        if not any(l.startswith("; Converted INTENSITY") for l in out_lines[:5]):
            out_lines.insert(0, header.rstrip("\n"))
        target.write_text("\n".join(out_lines) + "\n", encoding="utf-8")

        units = str(info.get("units") or "MM").upper()
        if units not in ("IN", "MM"):
            units = "MM"
        self.upsert_file_raingage(
            inp_path,
            name=gage,
            filename=str(filename),
            rain_format="VOLUME",
            interval=str(info.get("interval") or "0:05"),
            scf=float(info.get("scf") or 1.0),
            units=units,
        )
        return {
            "raingage": gage,
            "converted": True,
            "records": converted_n,
            "filename": str(filename),
            "format": "VOLUME",
        }

    def snap_raingage_to_2d_mesh(self, inp_path: Path, raingage: str) -> dict[str, Any]:
        """Place raingage coordinates at the 2D mesh centroid ([SYMBOLS]).

        Also converts INTENSITY FILE rain to VOLUME when needed (OpenSWMM bug)
        so subcatchments and the 2D mesh receive the intended storm depths.
        """
        from app.services.twod_mesh_service import twod_mesh_service

        gage = raingage.strip()
        if not gage or any(c.isspace() for c in gage):
            raise HTTPException(status_code=400, detail="Invalid raingage name")

        gages = {g["name"] for g in self.list_raingages(inp_path)}
        if gage not in gages:
            raise HTTPException(status_code=404, detail=f"Raingage not found: {gage}")

        rain_fix = self.convert_intensity_file_raingage_to_volume(inp_path, gage)

        mesh = twod_mesh_service.load(inp_path)
        if not mesh.has_mesh:
            raise HTTPException(
                status_code=400,
                detail="No 2D mesh in this project — generate or load a mesh first",
            )
        b = mesh.bounds()
        if b is None:
            raise HTTPException(status_code=400, detail="2D mesh has no vertices")
        x = (b[0] + b[2]) / 2.0
        y = (b[1] + b[3]) / 2.0

        model = self.load(inp_path)
        lines = list(model.lines)
        lines = self._ensure_section(lines, "SYMBOLS")
        model = self._parse(inp_path, model.mtime, "".join(lines))
        lines = list(model.lines)

        symbol_line = f"{gage:<16} {x:.4f}        {y:.4f}\n"
        existing = self._find_data_line(model, "SYMBOLS", gage)
        if existing is not None:
            lines[existing] = symbol_line
        else:
            insert_at = self._section_insert_index(model, "SYMBOLS")
            lines.insert(insert_at, symbol_line)
            model = self._parse(inp_path, model.mtime, "".join(lines))
            lines = list(model.lines)

        # Refresh gage set after possible format rewrite.
        gages = {g["name"] for g in self.list_raingages(inp_path)}
        removed: list[str] = []
        symbol_rows = [
            (idx, _tokenize(raw)[0])
            for idx, raw in model.sections.get("SYMBOLS", [])
            if not _is_comment(raw) and _tokenize(raw)
        ]
        for idx, name in sorted(symbol_rows, key=lambda t: t[0], reverse=True):
            if name == gage:
                continue
            if name not in gages:
                del lines[idx]
                removed.append(name)

        self._write_lines(inp_path, lines)
        return {
            "raingage": gage,
            "x": x,
            "y": y,
            "removed_orphan_symbols": sorted(removed),
            "has_mesh": True,
            "rain_fix": rain_fix,
        }

    def apply_climate_temperature(
        self,
        inp_path: Path,
        *,
        filename: str = "climate.dat",
        dry_only: bool = True,
    ) -> dict[str, Any]:
        """Wire [TEMPERATURE] FILE + [EVAPORATION] TEMPERATURE for continuous climate.

        Expects ``filename`` to already exist in the project folder (caller writes it).
        """
        from app.services.project_service import project_service

        fname = Path(filename).name.strip()
        if not fname:
            raise HTTPException(status_code=400, detail="Invalid climate file name")

        root = project_service.require_root()
        climate_path = root / fname
        if not climate_path.is_file():
            raise HTTPException(
                status_code=404,
                detail=f"Climate file not found in project: {fname}",
            )

        dry = "YES" if dry_only else "NO"
        temp_body = [
            ';;Data Source    Parameters\n',
            f'FILE "{fname}"\n',
        ]
        evap_body = [
            ";;Data Source    Parameters\n",
            ";;-------------- ----------------\n",
            "TEMPERATURE\n",
            f"DRY_ONLY         {dry}\n",
        ]

        model = self.load(inp_path)
        lines = list(model.lines)
        lines = self._replace_or_create_section(lines, "TEMPERATURE", temp_body)
        lines = self._replace_or_create_section(lines, "EVAPORATION", evap_body)
        self._write_lines(inp_path, lines)

        return {
            "filename": fname,
            "dry_only": bool(dry_only),
            "temperature": f'FILE "{fname}"',
            "evaporation": f"TEMPERATURE / DRY_ONLY {dry}",
        }

    def _section_span(
        self, lines: list[str], section: str
    ) -> Optional[tuple[int, int]]:
        """Return [header_idx, end_idx) for a section, or None if missing."""
        header = f"[{section}]"
        start: Optional[int] = None
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.upper() == header.upper():
                start = i
                continue
            if start is not None and stripped.startswith("[") and stripped.endswith("]"):
                return (start, i)
        if start is not None:
            return (start, len(lines))
        return None

    def _remove_section(self, lines: list[str], section: str) -> list[str]:
        span = self._section_span(lines, section)
        if span is None:
            return lines
        start, end = span
        # Drop trailing blank line after section if present
        del lines[start:end]
        return lines

    def _insert_section(
        self, lines: list[str], section: str, body_lines: list[str]
    ) -> list[str]:
        """Insert a full section block before [END] (or at EOF)."""
        end_idx = None
        for i, line in enumerate(lines):
            if line.strip().upper() == "[END]":
                end_idx = i
                break
        insert_at = end_idx if end_idx is not None else len(lines)
        block: list[str] = []
        if insert_at > 0 and lines[insert_at - 1].strip():
            block.append("\n")
        block.append(f"[{section}]\n")
        block.extend(body_lines)
        if not body_lines or not body_lines[-1].endswith("\n"):
            pass
        block.append("\n")
        for j, row in enumerate(block):
            lines.insert(insert_at + j, row)
        return lines

    def _replace_or_create_section(
        self, lines: list[str], section: str, body_lines: list[str]
    ) -> list[str]:
        lines = self._remove_section(lines, section)
        return self._insert_section(lines, section, body_lines)

    def get_flow_units(self, inp_path: Path) -> Optional[str]:
        model = self.load(inp_path)
        for _, raw in model.sections.get("OPTIONS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 2 and toks[0].upper() == "FLOW_UNITS":
                return toks[1].upper()
        return None

    def detect_length_unit(self, inp_path: Path) -> str:
        """Prefer SWMM FLOW_UNITS; fall back to project CRS linear units."""
        from_flow = length_unit_from_flow_units(self.get_flow_units(inp_path))
        if from_flow:
            return from_flow
        try:
            from app.services.project_service import project_service

            from_crs = length_unit_from_proj4(project_service.get_crs_proj4())
            if from_crs:
                return from_crs
        except Exception:
            pass
        return "m"

    def write_2d_mesh(
        self,
        inp_path: Path,
        *,
        vertices: list[tuple[float, float, float]],
        triangles: list[tuple[int, int, int, float]],
        output_file: Optional[str] = None,
        dry_depth: Optional[float] = None,
        report_2d: bool = True,
        replace: bool = True,
    ) -> dict[str, Any]:
        """Write/replace [2D_OPTIONS], [2D_VERTICES], [2D_TRIANGLES]."""
        from app.services.twod_mesh_service import twod_mesh_service

        model = self.load(inp_path)
        if not replace and twod_mesh_service.has_2d_mesh(inp_path):
            raise HTTPException(
                status_code=409,
                detail="Project already has a 2D mesh. Pass replace=true to overwrite.",
            )

        defaults = fast_2d_solver_defaults(self.detect_length_unit(inp_path))
        # Keep prior solver knobs when regenerating mesh (except report/output/dry if passed).
        prior = {}
        try:
            prior = self.get_2d_options_settings(inp_path)
        except Exception:
            prior = {}

        out_name = (
            output_file
            or prior.get("output_file")
            or f"{inp_path.stem}.2d.h5"
        )
        dry = (
            float(dry_depth)
            if dry_depth is not None
            else float(prior.get("dry_depth") if prior.get("dry_depth") is not None else defaults["dry_depth"])
        )
        max_ts = float(prior.get("max_timestep") if prior.get("max_timestep") is not None else defaults["max_timestep"])
        min_ts = float(prior.get("min_timestep") if prior.get("min_timestep") is not None else defaults["min_timestep"])
        rel_tol = float(prior.get("rel_tolerance") if prior.get("rel_tolerance") is not None else defaults["rel_tolerance"])
        abs_tol = float(prior.get("abs_tolerance") if prior.get("abs_tolerance") is not None else defaults["abs_tolerance"])
        report = bool(prior.get("report_2d")) if prior.get("has_mesh") else report_2d

        options_body = [
            f"REPORT_2D                 {'YES' if report else 'NO'}\n",
            f"OUTPUT_FILE               {out_name}\n",
            f"DRY_DEPTH                 {dry}\n",
            f"MAX_TIMESTEP              {max_ts}\n",
            f"MIN_TIMESTEP              {min_ts}\n",
            f"REL_TOLERANCE             {rel_tol}\n",
            f"ABS_TOLERANCE             {abs_tol}\n",
        ]
        vert_body = [";;  X            Y            Z\n"]
        for x, y, z in vertices:
            vert_body.append(f"{x:12.3f}  {y:12.3f}  {z:10.4f}\n")
        tri_body = [";;  V1   V2   V3   MANNINGS_N\n"]
        for v1, v2, v3, n in triangles:
            tri_body.append(f"{v1:6d} {v2:6d} {v3:6d}   {n:.4f}\n")

        lines = list(model.lines)
        # Remove coupling/boundary sections so they don't reference stale indices
        for sec in (
            "2D_VERTEX_NODE_MAP",
            "2D_BOUNDARY_CONDITIONS",
            "2D_OPTIONS",
            "2D_VERTICES",
            "2D_TRIANGLES",
        ):
            lines = self._remove_section(lines, sec)

        lines = self._insert_section(lines, "2D_OPTIONS", options_body)
        lines = self._insert_section(lines, "2D_VERTICES", vert_body)
        lines = self._insert_section(lines, "2D_TRIANGLES", tri_body)
        self._write_lines(inp_path, lines)
        twod_mesh_service.invalidate()
        return {
            "vertex_count": len(vertices),
            "triangle_count": len(triangles),
            "output_file": out_name,
        }

    def get_2d_options_settings(self, inp_path: Path) -> dict[str, Any]:
        from app.services.twod_mesh_service import twod_mesh_service

        mesh = twod_mesh_service.load(inp_path)
        raw = dict(mesh.options.raw)
        flow_units = self.get_flow_units(inp_path)
        length_unit = self.detect_length_unit(inp_path)
        defaults = fast_2d_solver_defaults(length_unit)

        def _f(key: str, default: Optional[float] = None) -> Optional[float]:
            v = raw.get(key)
            if v is None:
                return default
            try:
                return float(v)
            except ValueError:
                return default

        report = mesh.options.report_2d
        if "REPORT_2D" in raw:
            report = raw["REPORT_2D"].upper() in {"YES", "Y", "TRUE", "1"}

        # Prefer INP values; if a key is missing, use unit-aware fast defaults.
        dry_fallback = (
            mesh.options.dry_depth
            if mesh.options.dry_depth is not None
            else defaults["dry_depth"]
        )

        return {
            "report_2d": report if "REPORT_2D" in raw else defaults["report_2d"],
            "output_file": mesh.options.output_file or raw.get("OUTPUT_FILE"),
            "dry_depth": _f("DRY_DEPTH", dry_fallback),
            "max_timestep": _f("MAX_TIMESTEP", defaults["max_timestep"]),
            "min_timestep": _f("MIN_TIMESTEP", defaults["min_timestep"]),
            "rel_tolerance": _f("REL_TOLERANCE", defaults["rel_tolerance"]),
            "abs_tolerance": _f("ABS_TOLERANCE", defaults["abs_tolerance"]),
            "has_mesh": mesh.has_mesh,
            "length_unit": length_unit,
            "flow_units": flow_units,
            "defaults": defaults,
        }

    def set_2d_options_settings(
        self,
        inp_path: Path,
        *,
        report_2d: Optional[bool] = None,
        dry_depth: Optional[float] = None,
        max_timestep: Optional[float] = None,
        min_timestep: Optional[float] = None,
        rel_tolerance: Optional[float] = None,
        abs_tolerance: Optional[float] = None,
    ) -> dict[str, Any]:
        """Update [2D_OPTIONS] keys in place (preserves mesh vertices/triangles)."""
        from app.services.twod_mesh_service import twod_mesh_service

        current = self.get_2d_options_settings(inp_path)
        if report_2d is not None:
            current["report_2d"] = bool(report_2d)
        if dry_depth is not None:
            current["dry_depth"] = float(dry_depth)
        if max_timestep is not None:
            current["max_timestep"] = float(max_timestep)
        if min_timestep is not None:
            current["min_timestep"] = float(min_timestep)
        if rel_tolerance is not None:
            current["rel_tolerance"] = float(rel_tolerance)
        if abs_tolerance is not None:
            current["abs_tolerance"] = float(abs_tolerance)

        out_name = current.get("output_file") or f"{inp_path.stem}.2d.h5"
        body = [
            f"REPORT_2D                 {'YES' if current['report_2d'] else 'NO'}\n",
            f"OUTPUT_FILE               {out_name}\n",
            f"DRY_DEPTH                 {current['dry_depth']}\n",
            f"MAX_TIMESTEP              {current['max_timestep']}\n",
            f"MIN_TIMESTEP              {current['min_timestep']}\n",
            f"REL_TOLERANCE             {current['rel_tolerance']}\n",
            f"ABS_TOLERANCE             {current['abs_tolerance']}\n",
        ]

        model = self.load(inp_path)
        lines = list(model.lines)
        if any(
            not _is_comment(raw)
            for _, raw in model.sections.get("2D_OPTIONS", [])
        ) or model.sections.get("2D_OPTIONS"):
            lines = self._replace_or_create_section(lines, "2D_OPTIONS", body)
        else:
            # No section yet — create empty options so user can set before meshing
            lines = self._insert_section(lines, "2D_OPTIONS", body)

        self._write_lines(inp_path, lines)
        twod_mesh_service.invalidate()
        return self.get_2d_options_settings(inp_path)

    def write_2d_boundary_conditions(
        self,
        inp_path: Path,
        items: list[dict[str, Any]],
        *,
        write_defaults: bool = False,
    ) -> dict[str, Any]:
        """Replace [2D_BOUNDARY_CONDITIONS] with the given edge BC list."""
        from app.services.twod_mesh_service import (
            BC_TYPES,
            DEFAULT_BC_TYPE,
            twod_mesh_service,
        )

        mesh = twod_mesh_service.load(inp_path)
        if not mesh.has_mesh:
            raise HTTPException(status_code=404, detail="Project has no 2D mesh")

        open_set = {
            (ti, edge) for ti, edge, _va, _vb in twod_mesh_service.open_boundary_edges(mesh)
        }
        body: list[str] = [
            ";;Triangle  Edge  Type               Param1      Param2   Group\n",
        ]
        written = 0
        allowed = {t.upper() for t in BC_TYPES}
        for item in items:
            try:
                ti = int(item["triangle_index"])
                edge = int(item["edge"])
            except (KeyError, TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=400, detail=f"Invalid boundary item: {exc}"
                ) from exc
            if (ti, edge) not in open_set:
                raise HTTPException(
                    status_code=400,
                    detail=f"Edge ({ti},{edge}) is not an open mesh boundary",
                )
            bc_type = str(item.get("bc_type") or DEFAULT_BC_TYPE).upper()
            if bc_type not in allowed:
                raise HTTPException(
                    status_code=400, detail=f"Unknown bc_type: {bc_type}"
                )
            is_default = (
                bc_type == DEFAULT_BC_TYPE
                and item.get("param1") is None
                and not item.get("param2")
                and not item.get("group")
            )
            if is_default and not write_defaults:
                continue
            parts = [f"{ti:6d}", f"{edge:4d}", f"{bc_type:18s}"]
            if item.get("param1") is not None:
                parts.append(f"{float(item['param1']):10g}")
            elif item.get("param2") or item.get("group"):
                parts.append(f"{'*':>10}")
            if item.get("param2"):
                parts.append(str(item["param2"]))
            elif item.get("group"):
                parts.append("*")
            if item.get("group"):
                parts.append(str(item["group"]))
            body.append("  ".join(parts).rstrip() + "\n")
            written += 1

        model = self.load(inp_path)
        lines = list(model.lines)
        if written == 0 and not write_defaults:
            lines = self._remove_section(lines, "2D_BOUNDARY_CONDITIONS")
        else:
            lines = self._replace_or_create_section(
                lines, "2D_BOUNDARY_CONDITIONS", body
            )
        self._write_lines(inp_path, lines)
        twod_mesh_service.invalidate()
        return {
            "written": written,
            "count": len(open_set),
            **twod_mesh_service.boundaries_payload(inp_path),
        }


inp_model_service = InpModelService()
