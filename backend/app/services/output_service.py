from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import HTTPException

from app.models.schemas import (
    IdList,
    OutEnvelopeResponse,
    OutMetadata,
    OutPeriodsResponse,
    OutSnapshotResponse,
    OutVariableInfo,
    TimeSeriesResponse,
    VariableListResponse,
)

ObjectKind = Literal["node", "link", "subcatchment"]

# (id, label, unit_key) — unit_key resolved via flow_units system
_NODE_VARS: list[tuple[str, str, str]] = [
    ("depth", "Depth", "length"),
    ("head", "Head", "length"),
    ("volume", "Volume", "volume"),
    ("lateral_inflow", "Lateral inflow", "flow"),
    ("total_inflow", "Total inflow", "flow"),
    ("overflow", "Overflow / flooding", "flow"),
]

_LINK_VARS: list[tuple[str, str, str]] = [
    ("flow", "Flow", "flow"),
    ("depth", "Depth", "length"),
    ("velocity", "Velocity", "velocity"),
    ("volume", "Volume", "volume"),
    ("capacity", "Capacity (fraction full)", "fraction"),
]

_SUB_VARS: list[tuple[str, str, str]] = [
    ("rainfall", "Rainfall", "rainfall"),
    ("snow_depth", "Snow depth", "length"),
    ("evap", "Evaporation loss", "rainfall"),
    ("infil", "Infiltration loss", "rainfall"),
    ("runoff", "Runoff rate", "flow"),
    ("gw_flow", "Groundwater flow", "flow"),
    ("gw_elev", "Groundwater elevation", "length"),
    ("soil_moist", "Soil moisture", "fraction"),
]

_DEFAULT_VAR: dict[ObjectKind, str] = {
    "node": "depth",
    "link": "flow",
    "subcatchment": "runoff",
}


def _timedelta_to_seconds(value: timedelta | float | int) -> float:
    if isinstance(value, timedelta):
        return value.total_seconds()
    return float(value)


def _is_us_units(flow_units: Any) -> bool:
    name = str(getattr(flow_units, "name", flow_units)).upper()
    return name in {"CFS", "GPM", "MGD"}


def _unit_for(unit_key: str, flow_units: Any) -> str:
    flow_name = str(getattr(flow_units, "name", flow_units)).upper()
    us = _is_us_units(flow_units)
    if unit_key == "flow":
        return flow_name
    if unit_key == "length":
        return "ft" if us else "m"
    if unit_key == "velocity":
        return "ft/s" if us else "m/s"
    if unit_key == "volume":
        return "ft³" if us else "m³"
    if unit_key == "rainfall":
        return "in/hr" if us else "mm/hr"
    if unit_key == "fraction":
        return ""
    return ""


def _catalog(kind: ObjectKind) -> list[tuple[str, str, str]]:
    if kind == "node":
        return _NODE_VARS
    if kind == "link":
        return _LINK_VARS
    return _SUB_VARS


def _resolve_var_meta(
    kind: ObjectKind, variable: str | None, flow_units: Any
) -> tuple[str, str, str, Any]:
    """Return (var_id, label, unit, enum_member)."""
    from openswmm.engine import OutLinkVar, OutNodeVar, OutSubcatchVar

    catalog = _catalog(kind)
    var_id = (variable or _DEFAULT_VAR[kind]).strip().lower()
    match = next((row for row in catalog if row[0] == var_id), None)
    if match is None:
        allowed = ", ".join(r[0] for r in catalog)
        raise HTTPException(
            status_code=400,
            detail=f"Unknown {kind} variable '{var_id}'. Allowed: {allowed}",
        )
    _, label, unit_key = match
    unit = _unit_for(unit_key, flow_units)

    enum_map: dict[str, Any]
    if kind == "node":
        enum_map = {
            "depth": OutNodeVar.DEPTH,
            "head": OutNodeVar.HEAD,
            "volume": OutNodeVar.VOLUME,
            "lateral_inflow": OutNodeVar.LATERAL_INFLOW,
            "total_inflow": OutNodeVar.TOTAL_INFLOW,
            "overflow": OutNodeVar.OVERFLOW,
        }
    elif kind == "link":
        enum_map = {
            "flow": OutLinkVar.FLOW,
            "depth": OutLinkVar.DEPTH,
            "velocity": OutLinkVar.VELOCITY,
            "volume": OutLinkVar.VOLUME,
            "capacity": OutLinkVar.CAPACITY,
        }
    else:
        enum_map = {
            "rainfall": OutSubcatchVar.RAINFALL,
            "snow_depth": OutSubcatchVar.SNOW_DEPTH,
            "evap": OutSubcatchVar.EVAP,
            "infil": OutSubcatchVar.INFIL,
            "runoff": OutSubcatchVar.RUNOFF,
            "gw_flow": OutSubcatchVar.GW_FLOW,
            "gw_elev": OutSubcatchVar.GW_ELEV,
            "soil_moist": OutSubcatchVar.SOIL_MOIST,
        }
    return var_id, label, unit, enum_map[var_id]


class OutputService:
    def __init__(self) -> None:
        self._cache_path: Optional[Path] = None
        self._cache_mtime: float = 0.0
        self._cache_handle: Any = None
        # Peak stats / envelope memoized by out_path + mtime
        self._peaks_key: Optional[tuple[str, float]] = None
        self._peaks: Optional[dict[str, Any]] = None
        self._envelope_key: Optional[tuple[str, float]] = None
        self._envelope: Optional[dict[str, Any]] = None

    def invalidate(self) -> None:
        if self._cache_handle is not None:
            try:
                close = getattr(self._cache_handle, "close", None)
                if callable(close):
                    close()
                else:
                    exit_fn = getattr(self._cache_handle, "__exit__", None)
                    if callable(exit_fn):
                        exit_fn(None, None, None)
            except Exception:
                pass
        self._cache_path = None
        self._cache_mtime = 0.0
        self._cache_handle = None
        self._peaks_key = None
        self._peaks = None
        self._envelope_key = None
        self._envelope = None

    def _require_out(self, out_path: Path):
        """Return OutputReader class (kept for profile_service / tests)."""
        if not out_path.is_file():
            raise HTTPException(
                status_code=404,
                detail=f"Output file not found: {out_path}. Run a simulation first.",
            )
        try:
            from openswmm.engine import OutputReader
        except ImportError as exc:
            raise HTTPException(
                status_code=500, detail=f"openswmm is not installed: {exc}"
            ) from exc
        return OutputReader

    def _open(self, out_path: Path) -> Any:
        OutputReader = self._require_out(out_path)
        mtime = out_path.stat().st_mtime
        if (
            self._cache_handle is not None
            and self._cache_path == out_path
            and abs(self._cache_mtime - mtime) < 1e-9
        ):
            return self._cache_handle
        self.invalidate()
        handle = OutputReader(str(out_path))
        enter = getattr(handle, "__enter__", None)
        if callable(enter):
            handle = enter()
        self._cache_path = out_path
        self._cache_mtime = mtime
        self._cache_handle = handle
        return handle

    def _mtime_key(self, out_path: Path) -> tuple[str, float]:
        return (str(out_path), out_path.stat().st_mtime)

    def _compute_peaks(self, out: Any) -> dict[str, Any]:
        """Single-pass peak depth/flow/runoff over all periods."""
        from openswmm.engine import OutLinkVar, OutNodeVar, OutSubcatchVar

        period_count = int(out.period_count)
        peak_period: int | None = None
        peak_max: float | None = None
        peak_time: str | None = None
        peak_flow_max: float | None = None
        peak_runoff_max: float | None = None
        if period_count > 0:
            best_p = 0
            best_v = float("-inf")
            best_flow = 0.0
            best_runoff = 0.0
            has_subs = True
            for p in range(period_count):
                depths = [float(v) for v in out.node_result(p, OutNodeVar.DEPTH)]
                if depths:
                    m = max(depths)
                    if m > best_v:
                        best_v = m
                        best_p = p
                flows = [float(v) for v in out.link_result(p, OutLinkVar.FLOW)]
                if flows:
                    best_flow = max(best_flow, max(abs(f) for f in flows))
                if has_subs:
                    try:
                        runoffs = [
                            float(v)
                            for v in out.subcatchment_result(p, OutSubcatchVar.RUNOFF)
                        ]
                        if runoffs:
                            best_runoff = max(
                                best_runoff, max(abs(r) for r in runoffs)
                            )
                    except Exception:
                        has_subs = False
            peak_period = best_p
            peak_max = best_v if best_v > float("-inf") else 0.0
            peak_flow_max = best_flow
            peak_runoff_max = best_runoff
            try:
                peak_time = str(out.period_times[best_p])
            except Exception:
                peak_time = None
        return {
            "peak_depth_period": peak_period,
            "peak_depth_max": peak_max,
            "peak_time": peak_time,
            "peak_flow_max": peak_flow_max,
            "peak_runoff_max": peak_runoff_max,
        }

    def _peaks_cached(self, out_path: Path, out: Any) -> dict[str, Any]:
        key = self._mtime_key(out_path)
        if self._peaks is not None and self._peaks_key == key:
            return self._peaks
        peaks = self._compute_peaks(out)
        self._peaks_key = key
        self._peaks = peaks
        return peaks

    def metadata(self, out_path: Path) -> OutMetadata:
        out = self._open(out_path)
        sub_count = 0
        try:
            sub_count = int(out.subcatchment_count)
        except Exception:
            sub_count = 0
        return OutMetadata(
            node_count=int(out.node_count),
            link_count=int(out.link_count),
            subcatchment_count=sub_count,
            period_count=int(out.period_count),
            report_step_sec=_timedelta_to_seconds(out.report_step),
            path=str(out_path),
        )

    def list_nodes(self, out_path: Path) -> IdList:
        out = self._open(out_path)
        return IdList(ids=[str(x) for x in out.node_ids])

    def list_links(self, out_path: Path) -> IdList:
        out = self._open(out_path)
        return IdList(ids=[str(x) for x in out.link_ids])

    def list_subcatchments(self, out_path: Path) -> IdList:
        out = self._open(out_path)
        try:
            ids = [str(x) for x in out.subcatchment_ids]
        except Exception:
            ids = []
        return IdList(ids=ids)

    def list_variables(self, out_path: Path, kind: ObjectKind) -> VariableListResponse:
        out = self._open(out_path)
        flow_units = out.flow_units
        variables = [
            OutVariableInfo(
                id=vid,
                label=label,
                unit=_unit_for(unit_key, flow_units),
            )
            for vid, label, unit_key in _catalog(kind)
        ]
        return VariableListResponse(kind=kind, variables=variables)

    def _ensure_id(
        self,
        ids: list[str],
        object_id: str,
        kind: ObjectKind,
    ) -> None:
        if object_id not in ids:
            raise HTTPException(status_code=404, detail=f"{kind} id not found: {object_id}")

    def _series_response(
        self,
        *,
        object_id: str,
        var_id: str,
        label: str,
        unit: str,
        step: float,
        values: list[float],
        labels: list[str],
    ) -> TimeSeriesResponse:
        times = [i * step for i in range(len(values))]
        return TimeSeriesResponse(
            object_id=object_id,
            variable=var_id,
            variable_label=label,
            unit=unit,
            report_step_sec=step,
            values=values,
            times_sec=times,
            times=labels,
        )

    def node_series(
        self, out_path: Path, node_id: str, variable: str | None = None
    ) -> TimeSeriesResponse:
        out = self._open(out_path)
        ids = [str(x) for x in out.node_ids]
        self._ensure_id(ids, node_id, "node")
        periods = int(out.period_count)
        if periods < 1:
            raise HTTPException(status_code=400, detail="Output has no reporting periods")
        var_id, label, unit, enum_var = _resolve_var_meta(
            "node", variable, out.flow_units
        )
        step = _timedelta_to_seconds(out.report_step)
        values = [float(v) for v in out.node_series(node_id, enum_var)]
        labels: list[str] = []
        try:
            labels = [str(t) for t in out.period_times[: len(values)]]
        except Exception:
            labels = []
        return self._series_response(
            object_id=node_id,
            var_id=var_id,
            label=label,
            unit=unit,
            step=step,
            values=values,
            labels=labels,
        )

    def link_series(
        self, out_path: Path, link_id: str, variable: str | None = None
    ) -> TimeSeriesResponse:
        out = self._open(out_path)
        ids = [str(x) for x in out.link_ids]
        self._ensure_id(ids, link_id, "link")
        periods = int(out.period_count)
        if periods < 1:
            raise HTTPException(status_code=400, detail="Output has no reporting periods")
        var_id, label, unit, enum_var = _resolve_var_meta(
            "link", variable, out.flow_units
        )
        step = _timedelta_to_seconds(out.report_step)
        values = [float(v) for v in out.link_series(link_id, enum_var)]
        labels: list[str] = []
        try:
            labels = [str(t) for t in out.period_times[: len(values)]]
        except Exception:
            labels = []
        return self._series_response(
            object_id=link_id,
            var_id=var_id,
            label=label,
            unit=unit,
            step=step,
            values=values,
            labels=labels,
        )

    def subcatchment_series(
        self, out_path: Path, sub_id: str, variable: str | None = None
    ) -> TimeSeriesResponse:
        out = self._open(out_path)
        try:
            ids = [str(x) for x in out.subcatchment_ids]
        except Exception as exc:
            raise HTTPException(
                status_code=404, detail=f"No subcatchment results in output: {exc}"
            ) from exc
        self._ensure_id(ids, sub_id, "subcatchment")
        periods = int(out.period_count)
        if periods < 1:
            raise HTTPException(status_code=400, detail="Output has no reporting periods")
        var_id, label, unit, enum_var = _resolve_var_meta(
            "subcatchment", variable, out.flow_units
        )
        step = _timedelta_to_seconds(out.report_step)
        values = [float(v) for v in out.subcatchment_series(sub_id, enum_var)]
        labels: list[str] = []
        try:
            labels = [str(t) for t in out.period_times[: len(values)]]
        except Exception:
            labels = []
        return self._series_response(
            object_id=sub_id,
            var_id=var_id,
            label=label,
            unit=unit,
            step=step,
            values=values,
            labels=labels,
        )

    def periods(self, out_path: Path) -> OutPeriodsResponse:
        out = self._open(out_path)
        times = [str(t) for t in out.period_times]
        period_count = int(out.period_count)
        peaks = self._peaks_cached(out_path, out) if period_count > 0 else {
            "peak_depth_period": None,
            "peak_depth_max": None,
            "peak_time": None,
            "peak_flow_max": None,
            "peak_runoff_max": None,
        }
        return OutPeriodsResponse(
            period_count=period_count,
            report_step_sec=_timedelta_to_seconds(out.report_step),
            times=times,
            peak_depth_period=peaks["peak_depth_period"],
            peak_depth_max=peaks["peak_depth_max"],
            peak_time=peaks["peak_time"],
            peak_flow_max=peaks["peak_flow_max"],
            peak_runoff_max=peaks["peak_runoff_max"],
        )

    def envelope(self, out_path: Path) -> dict:
        """Per-element max-over-time for depth / |flow| / |runoff|."""
        from openswmm.engine import OutLinkVar, OutNodeVar, OutSubcatchVar

        key = self._mtime_key(out_path)
        if self._envelope is not None and self._envelope_key == key:
            return self._envelope

        out = self._open(out_path)
        period_count = int(out.period_count)
        if period_count < 1:
            raise HTTPException(status_code=400, detail="Output has no reporting periods")
        node_ids = [str(x) for x in out.node_ids]
        link_ids = [str(x) for x in out.link_ids]
        n_nodes = len(node_ids)
        n_links = len(link_ids)
        node_max = [0.0] * n_nodes
        link_max = [0.0] * n_links
        sub_ids: list[str] = []
        runoff_max: list[float] = []
        has_subs = True
        try:
            sub_ids = [str(x) for x in out.subcatchment_ids]
            runoff_max = [0.0] * len(sub_ids)
        except Exception:
            has_subs = False
            sub_ids = []
            runoff_max = []

        for p in range(period_count):
            depths = [float(v) for v in out.node_result(p, OutNodeVar.DEPTH)]
            for i, d in enumerate(depths):
                if i < n_nodes and d > node_max[i]:
                    node_max[i] = d
            flows = [float(v) for v in out.link_result(p, OutLinkVar.FLOW)]
            for i, f in enumerate(flows):
                af = abs(f)
                if i < n_links and af > link_max[i]:
                    link_max[i] = af
            if has_subs and runoff_max:
                try:
                    runoffs = [
                        float(v)
                        for v in out.subcatchment_result(p, OutSubcatchVar.RUNOFF)
                    ]
                    for i, r in enumerate(runoffs):
                        ar = abs(r)
                        if i < len(runoff_max) and ar > runoff_max[i]:
                            runoff_max[i] = ar
                except Exception:
                    has_subs = False

        result = {
            "period": -1,
            "time": "max envelope",
            "node_ids": node_ids,
            "link_ids": link_ids,
            "subcatchment_ids": sub_ids,
            "node_depths": node_max,
            "link_flows": link_max,
            "subcatchment_runoffs": runoff_max,
            "node_depth_min": min(node_max) if node_max else 0.0,
            "node_depth_max": max(node_max) if node_max else 0.0,
            "link_flow_min": min(link_max) if link_max else 0.0,
            "link_flow_max": max(link_max) if link_max else 0.0,
            "subcatchment_runoff_min": min(runoff_max) if runoff_max else 0.0,
            "subcatchment_runoff_max": max(runoff_max) if runoff_max else 0.0,
        }
        self._envelope_key = key
        self._envelope = result
        return result

    def snapshot(self, out_path: Path, period: int) -> dict:
        from openswmm.engine import OutLinkVar, OutNodeVar, OutSubcatchVar

        out = self._open(out_path)
        periods = int(out.period_count)
        if periods < 1:
            raise HTTPException(status_code=400, detail="Output has no reporting periods")
        if period < 0 or period >= periods:
            raise HTTPException(
                status_code=400,
                detail=f"period must be in [0, {periods - 1}]",
            )
        node_ids = [str(x) for x in out.node_ids]
        link_ids = [str(x) for x in out.link_ids]
        depths = [float(v) for v in out.node_result(period, OutNodeVar.DEPTH)]
        flows = [float(v) for v in out.link_result(period, OutLinkVar.FLOW)]

        sub_ids: list[str] = []
        runoffs: list[float] = []
        try:
            sub_ids = [str(x) for x in out.subcatchment_ids]
            runoffs = [
                float(v) for v in out.subcatchment_result(period, OutSubcatchVar.RUNOFF)
            ]
        except Exception:
            sub_ids = []
            runoffs = []

        time = None
        try:
            time = str(out.period_times[period])
        except Exception:
            time = None
        return {
            "period": period,
            "time": time,
            "node_ids": node_ids,
            "link_ids": link_ids,
            "subcatchment_ids": sub_ids,
            "node_depths": depths,
            "link_flows": flows,
            "subcatchment_runoffs": runoffs,
            "node_depth_min": min(depths) if depths else 0.0,
            "node_depth_max": max(depths) if depths else 0.0,
            "link_flow_min": min(flows) if flows else 0.0,
            "link_flow_max": max(abs(f) for f in flows) if flows else 0.0,
            "subcatchment_runoff_min": min(runoffs) if runoffs else 0.0,
            "subcatchment_runoff_max": max(abs(r) for r in runoffs) if runoffs else 0.0,
        }

    def snapshot_response(self, out_path: Path, period: int) -> OutSnapshotResponse:
        return OutSnapshotResponse(**self.snapshot(out_path, period))

    def envelope_response(self, out_path: Path) -> OutEnvelopeResponse:
        return OutEnvelopeResponse(**self.envelope(out_path))


output_service = OutputService()
