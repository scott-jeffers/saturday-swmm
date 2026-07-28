from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache
from typing import Any, Optional

from pyproj import CRS
from pyproj.database import query_crs_info
from pyproj.enums import PJType

# Official EPSG registry (epsg.io ?format=json now returns HTML SPA shells).
EPSG_REGISTRY_URL = "https://apps.epsg.org/api/v1/CoordRefSystem/"

PRESETS: list[dict[str, str]] = [
    {
        "auth_code": "EPSG:25832",
        "label": "UTM 32N (ETRS89)",
        "name": "ETRS89 / UTM zone 32N — Denmark / Bellinge",
    },
    {
        "auth_code": "EPSG:2272",
        "label": "PA South (ftUS)",
        "name": "NAD83 / Pennsylvania South (ftUS)",
    },
    {
        "auth_code": "EPSG:2271",
        "label": "PA North (ftUS)",
        "name": "NAD83 / Pennsylvania North (ftUS)",
    },
    {
        "auth_code": "EPSG:26918",
        "label": "UTM 18N (NAD83)",
        "name": "NAD83 / UTM zone 18N",
    },
    {
        "auth_code": "EPSG:32632",
        "label": "UTM 32N (WGS84)",
        "name": "WGS 84 / UTM zone 32N",
    },
    {
        "auth_code": "EPSG:4326",
        "label": "WGS 84",
        "name": "WGS 84 (geographic)",
    },
]


def _normalize_query(q: str) -> str:
    return re.sub(r"\s+", " ", str(q or "").strip())


def _extract_epsg_code(q: str) -> Optional[str]:
    s = _normalize_query(q)
    if not s:
        return None
    m = re.fullmatch(r"(?i)(?:EPSG:)?(\d{3,7})", s)
    if m:
        return m.group(1)
    return None


def _hit_from_crs(
    code: str,
    *,
    name: Optional[str] = None,
    area: Optional[str] = None,
    source: str = "local",
) -> Optional[dict[str, Any]]:
    auth = f"EPSG:{code}"
    try:
        c = CRS.from_user_input(auth)
        proj4 = c.to_proj4() or None
        if not name:
            name = c.name or auth
        if not area:
            try:
                aou = c.area_of_use
                area = aou.name if aou is not None else None
            except Exception:
                area = None
        return {
            "auth_code": auth,
            "name": name,
            "area_of_use": area,
            "proj4": proj4,
            "source": source,
        }
    except Exception:
        if name:
            return {
                "auth_code": auth,
                "name": name,
                "area_of_use": area,
                "proj4": None,
                "source": source,
            }
        return None


@lru_cache(maxsize=1)
def _local_crs_catalog() -> list[Any]:
    return list(
        query_crs_info(
            auth_name="EPSG",
            pj_types=[PJType.PROJECTED_CRS, PJType.GEOGRAPHIC_2D_CRS],
            allow_deprecated=False,
        )
    )


def _score_local(info: Any, tokens: list[str], exact_code: Optional[str]) -> int:
    code = str(info.code)
    name = (info.name or "").lower()
    area = ""
    try:
        if info.area_of_use is not None:
            area = (info.area_of_use.name or "").lower()
    except Exception:
        area = ""
    hay = f"{code} {name} {area}"
    if exact_code and code == exact_code:
        return 10_000
    score = 0
    for t in tokens:
        if t == code:
            score += 500
        elif t in code:
            score += 80
        if t in name:
            score += 40
        if t in area:
            score += 25
    return score


def search_local(q: str, *, limit: int = 20) -> list[dict[str, Any]]:
    query = _normalize_query(q)
    if not query:
        return []
    exact = _extract_epsg_code(query)
    # Pure EPSG code → resolve that CRS (+ optional name neighbors later via online)
    if exact and re.fullmatch(r"(?i)(?:EPSG:)?\d{3,7}", query):
        hit = _hit_from_crs(exact, source="local")
        return [hit] if hit else []

    tokens = [t.lower() for t in re.split(r"[^a-zA-Z0-9]+", query) if t]
    if not tokens:
        return []

    scored: list[tuple[int, Any]] = []
    for info in _local_crs_catalog():
        s = _score_local(info, tokens, exact)
        if s > 0:
            scored.append((s, info))
    scored.sort(key=lambda x: (-x[0], int(x[1].code) if str(x[1].code).isdigit() else 0))

    hits: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _, info in scored:
        code = str(info.code)
        if code in seen:
            continue
        area = None
        try:
            if info.area_of_use is not None:
                area = info.area_of_use.name
        except Exception:
            area = None
        hit = _hit_from_crs(code, name=info.name, area=area, source="local")
        if hit:
            hits.append(hit)
            seen.add(code)
        if len(hits) >= limit:
            break
    return hits


def search_online(q: str, *, limit: int = 20) -> tuple[list[dict[str, Any]], Optional[str]]:
    """Search EPSG registry API. Returns (hits, warning)."""
    query = _normalize_query(q)
    if not query:
        return [], None
    params = urllib.parse.urlencode(
        {
            "pageSize": min(max(limit, 1), 50),
            "keywords": query,
        }
    )
    url = f"{EPSG_REGISTRY_URL}?{params}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Saturday-SWMM/0.1 (local CRS search)",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        data = json.loads(raw)
    except urllib.error.HTTPError as exc:
        return [], f"Online CRS search failed (HTTP {exc.code})"
    except urllib.error.URLError as exc:
        return [], f"Online CRS search unavailable: {exc.reason}"
    except TimeoutError:
        return [], "Online CRS search timed out"
    except Exception as exc:
        return [], f"Online CRS search failed: {exc}"

    results = data.get("Results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        return [], "Online CRS search returned unexpected data"

    hits: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in results:
        if not isinstance(row, dict):
            continue
        code = row.get("Code")
        if code is None:
            continue
        code_s = str(code)
        if code_s in seen:
            continue
        # Prefer projected / geographic; skip compound when possible
        ctype = str(row.get("Type") or "").lower()
        if ctype in ("compound", "vertical", "engineering"):
            continue
        hit = _hit_from_crs(
            code_s,
            name=str(row.get("Name") or f"EPSG:{code_s}"),
            area=str(row.get("Area") or "") or None,
            source="epsg.io",
        )
        if hit:
            hits.append(hit)
            seen.add(code_s)
        if len(hits) >= limit:
            break
    return hits, None


def merge_hits(
    local: list[dict[str, Any]],
    online: list[dict[str, Any]],
    *,
    exact_code: Optional[str],
    limit: int,
) -> list[dict[str, Any]]:
    by_code: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    def add(hit: dict[str, Any]) -> None:
        code = hit["auth_code"].split(":", 1)[-1]
        existing = by_code.get(code)
        if existing is None:
            by_code[code] = hit
            order.append(code)
            return
        # Prefer local for proj4 / richer definition
        if existing.get("source") != "local" and hit.get("source") == "local":
            by_code[code] = {**hit, "name": hit.get("name") or existing.get("name")}
        elif existing.get("proj4") is None and hit.get("proj4"):
            existing["proj4"] = hit["proj4"]

    for h in local:
        add(h)
    for h in online:
        add(h)

    codes = list(order)
    if exact_code and exact_code in by_code:
        codes = [exact_code] + [c for c in codes if c != exact_code]
    return [by_code[c] for c in codes[:limit]]


def search(q: str, *, online: bool = False, limit: int = 20) -> dict[str, Any]:
    query = _normalize_query(q)
    limit = max(1, min(int(limit), 50))
    exact = _extract_epsg_code(query)
    local = search_local(query, limit=limit)
    warning: Optional[str] = None
    online_hits: list[dict[str, Any]] = []
    if online and query:
        online_hits, warning = search_online(query, limit=limit)
    hits = merge_hits(local, online_hits, exact_code=exact, limit=limit)
    return {
        "query": query,
        "online": online,
        "hits": hits,
        "warning": warning,
    }


def presets() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for p in PRESETS:
        hit = _hit_from_crs(p["auth_code"].split(":")[-1], name=p.get("name"), source="local")
        out.append(
            {
                "auth_code": p["auth_code"],
                "label": p["label"],
                "name": (hit or {}).get("name") or p.get("name") or p["auth_code"],
            }
        )
    return out
