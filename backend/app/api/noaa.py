from __future__ import annotations

import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse

router = APIRouter(prefix="/api/noaa", tags=["noaa"])

NOAA_URL = (
    "https://hdsc.nws.noaa.gov/cgi-bin/hdsc/new/fe_text_mean.csv"
    "?lat={lat}&lon={lon}&data=depth&units=english&series={series}"
)


@router.get("/pfds")
def get_pfds(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    series: str = Query("pds", pattern="^(pds|ams)$", description="pds = partial duration, ams = annual maximum"),
) -> PlainTextResponse:
    """Proxy NOAA Atlas 14 PFDS mean-depth CSV (same as GStorm Netlify function)."""
    url = NOAA_URL.format(lat=lat, lon=lon, series=series)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Saturday-SWMM/0.1 (local NOAA PFDS proxy)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"NOAA server responded with status {exc.code}.",
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not connect to NOAA server: {exc.reason}",
        ) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Request to NOAA timed out.") from exc

    if not raw.strip():
        raise HTTPException(status_code=502, detail="Empty response from NOAA server.")
    lower = raw.lower()
    if "no data available" in lower:
        raise HTTPException(
            status_code=404,
            detail="No NOAA data available for the selected location.",
        )
    if "an error occurred" in lower or (
        lower.lstrip().startswith("error") and "ari" not in lower[:500]
    ):
        raise HTTPException(
            status_code=502,
            detail="Received an error response from NOAA server.",
        )

    return PlainTextResponse(content=raw, media_type="text/csv")
