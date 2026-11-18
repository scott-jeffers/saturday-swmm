from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/openmeteo", tags=["openmeteo"])

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MAX_RANGE_DAYS = 366


def _parse_iso_date(value: str, field: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be YYYY-MM-DD",
        ) from exc


def _resolve_range(
    year: int | None,
    start_date: str | None,
    end_date: str | None,
) -> tuple[str, str]:
    if start_date and end_date:
        start = _parse_iso_date(start_date, "start_date")
        end = _parse_iso_date(end_date, "end_date")
        if start > end:
            raise HTTPException(
                status_code=400,
                detail="start_date must be on or before end_date",
            )
        days = (end - start).days + 1
        if days > MAX_RANGE_DAYS:
            raise HTTPException(
                status_code=400,
                detail=f"Date range cannot exceed {MAX_RANGE_DAYS} days (got {days})",
            )
        return start.isoformat(), end.isoformat()

    if year is not None:
        if year < 1940 or year > date.today().year:
            raise HTTPException(status_code=400, detail="year out of range")
        return f"{year}-01-01", f"{year}-12-31"

    # Default: previous calendar year (ERA5 archive lag)
    y = date.today().year - 1
    return f"{y}-01-01", f"{y}-12-31"


@router.get("/archive")
def get_archive(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    year: int | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
) -> JSONResponse:
    """Proxy Open-Meteo ERA5-Land hourly precipitation + temperature."""
    if (start_date is None) ^ (end_date is None):
        raise HTTPException(
            status_code=400,
            detail="Provide both start_date and end_date, or neither (use year).",
        )

    start, end = _resolve_range(year, start_date, end_date)
    params = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "start_date": start,
            "end_date": end,
            "hourly": "precipitation,temperature_2m",
            "timezone": "auto",
        }
    )
    url = f"{ARCHIVE_URL}?{params}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Saturday-SWMM/0.1 (Open-Meteo archive proxy)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")[:400]
        except Exception:
            pass
        raise HTTPException(
            status_code=502,
            detail=f"Open-Meteo responded with status {exc.code}. {body}".strip(),
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not connect to Open-Meteo: {exc.reason}",
        ) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Request to Open-Meteo timed out.") from exc

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail="Invalid JSON response from Open-Meteo.",
        ) from exc

    times = (payload.get("hourly") or {}).get("time") or []
    if not times:
        raise HTTPException(
            status_code=502,
            detail="Open-Meteo returned no hourly time series for this request.",
        )

    # Attach resolved range for clients
    payload["_saturday_swmm"] = {
        "start_date": start,
        "end_date": end,
        "source": "archive-api.open-meteo.com",
    }
    return JSONResponse(content=payload)


@router.get("/forecast")
def get_forecast(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    past_days: int = Query(default=1, ge=0, le=7),
    forecast_days: int = Query(default=7, ge=1, le=16),
) -> JSONResponse:
    """Proxy Open-Meteo's hourly precipitation forecast (same shape as the archive)."""
    params = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "hourly": "precipitation,temperature_2m",
            "past_days": past_days,
            "forecast_days": forecast_days,
            "timezone": "auto",
        }
    )
    req = urllib.request.Request(f"{FORECAST_URL}?{params}", headers={"User-Agent": "Saturday-SWMM (Open-Meteo forecast proxy)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Open-Meteo responded with status {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=503, detail=f"Could not connect to Open-Meteo: {exc.reason}") from exc
    except (TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=504, detail="Open-Meteo did not answer in time.") from exc
    times = (payload.get("hourly") or {}).get("time") or []
    if not times:
        raise HTTPException(status_code=502, detail="Open-Meteo returned no hourly forecast for this point.")
    payload["_saturday_swmm"] = {"start_date": times[0][:10], "end_date": times[-1][:10], "source": "api.open-meteo.com (forecast)"}
    return JSONResponse(content=payload)
