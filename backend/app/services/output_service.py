from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Literal

from fastapi import HTTPException

from app.models.schemas import (
    IdList,
    OutMetadata,
    OutPeriodsResponse,
    OutSnapshotResponse,
    TimeSeriesResponse,
)


def _timedelta_to_seconds(value: timedelta | float | int) -> float:
    if isinstance(value, timedelta):
        return value.total_seconds()
    return float(value)


class OutputService:
    def _require_out(self, out_path: Path):
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

    def metadata(self, out_path: Path) -> OutMetadata:
        OutputReader = self._require_out(out_path)
        with OutputReader(str(out_path)) as out:
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
        OutputReader = self._require_out(out_path)
        with OutputReader(str(out_path)) as out:
            return IdList(ids=[str(x) for x in out.node_ids])

    def list_links(self, out_path: Path) -> IdList:
        OutputReader = self._require_out(out_path)
        with OutputReader(str(out_path)) as out:
            return IdList(ids=[str(x) for x in out.link_ids])

    def list_subcatchments(self, out_path: Path) -> IdList:
        OutputReader = self._require_out(out_path)
        with OutputReader(str(out_path)) as out:
            try:
                ids = [str(x) for x in out.subcatchment_ids]
            except Exception:
                ids = []
            return IdList(ids=ids)

    def _ensure_id(
        self,
        ids: list[str],
        object_id: str,
        kind: Literal["node", "link", "subcatchment"],
    ) -> None:
        if object_id not in ids:
            raise HTTPException(status_code=404, detail=f"{kind} id not found: {object_id}")

    def node_series(self, out_path: Path, node_id: str) -> TimeSeriesResponse:
        from openswmm.engine import OutNodeVar

        OutputReader = self._require_out(out_path)
        with OutputReader(str(out_path)) as out:
            ids = [str(x) for x in out.node_ids]
            self._ensure_id(ids, node_id, "node")
            periods = int(out.period_count)
            if periods < 1:
                raise HTTPException(status_code=400, detail="Output has no reporting periods")
            step = _timedelta_to_seconds(out.report_step)
            values = [float(v) for v in out.node_series(node_id, OutNodeVar.DEPTH)]
            times = [i * step for i in range(len(values))]
            labels: list[str] = []
            try:
                labels = [str(t) for t in out.period_times[: len(values)]]
            except Exception:
                labels = []
            return TimeSeriesResponse(
                object_id=node_id,
                variable="depth",
                report_step_sec=step,
                values=values,
                times_sec=times,
                times=labels,
            )

    def link_series(self, out_path: Path, link_id: str) -> TimeSeriesResponse:
        from openswmm.engine import OutLinkVar

        OutputReader = self._require_out(out_path)
        with OutputReader(str(out_path)) as out:
            ids = [str(x) for x in out.link_ids]
            self._ensure_id(ids, link_id, "link")
            periods = int(out.period_count)
            if periods < 1:
                raise HTTPException(status_code=400, detail="Output has no reporting periods")
            step = _timedelta_to_seconds(out.report_step)
            values = [float(v) for v in out.link_series(link_id, OutLinkVar.FLOW)]
            times = [i * step for i in range(len(values))]
            labels: list[str] = []
            try:
                labels = [str(t) for t in out.period_times[: len(values)]]
            except Exception:
                labels = []
            return TimeSeriesResponse(
                object_id=link_id,
                variable="flow",
                report_step_sec=step,
                values=values,
                times_sec=times,
                times=labels,
            )

    def subcatchment_series(self, out_path: Path, sub_id: str) -> TimeSeriesResponse:
        from openswmm.engine import OutSubcatchVar

        OutputReader = self._require_out(out_path)
        with OutputReader(str(out_path)) as out:
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
            step = _timedelta_to_seconds(out.report_step)
            values = [
                float(v) for v in out.subcatchment_series(sub_id, OutSubcatchVar.RUNOFF)
            ]
            times = [i * step for i in range(len(values))]
            labels: list[str] = []
            try:
                labels = [str(t) for t in out.period_times[: len(values)]]
            except Exception:
                labels = []
            return TimeSeriesResponse(
                object_id=sub_id,
                variable="runoff",
                report_step_sec=step,
                values=values,
                times_sec=times,
                times=labels,
            )

    def periods(self, out_path: Path) -> OutPeriodsResponse:
        from openswmm.engine import OutNodeVar

        OutputReader = self._require_out(out_path)
        with OutputReader(str(out_path)) as out:
            times = [str(t) for t in out.period_times]
            period_count = int(out.period_count)
            peak_period: int | None = None
            peak_max: float | None = None
            peak_time: str | None = None
            if period_count > 0:
                best_p = 0
                best_v = float("-inf")
                for p in range(period_count):
                    depths = [float(v) for v in out.node_result(p, OutNodeVar.DEPTH)]
                    if not depths:
                        continue
                    m = max(depths)
                    if m > best_v:
                        best_v = m
                        best_p = p
                peak_period = best_p
                peak_max = best_v if best_v > float("-inf") else 0.0
                try:
                    peak_time = str(out.period_times[best_p])
                except Exception:
                    peak_time = None
            return OutPeriodsResponse(
                period_count=period_count,
                report_step_sec=_timedelta_to_seconds(out.report_step),
                times=times,
                peak_depth_period=peak_period,
                peak_depth_max=peak_max,
                peak_time=peak_time,
            )

    def snapshot(self, out_path: Path, period: int) -> dict:
        from openswmm.engine import OutLinkVar, OutNodeVar, OutSubcatchVar

        OutputReader = self._require_out(out_path)
        with OutputReader(str(out_path)) as out:
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


output_service = OutputService()
