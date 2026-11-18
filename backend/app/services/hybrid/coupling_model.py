"""Load / save hybrid/coupling.json."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.models.schemas import HybridCoupling, HybridCouplingPoint
from app.services.hybrid.paths import coupling_path, ensure_hybrid_dir


def load_coupling(project_root: Path) -> HybridCoupling:
    path = coupling_path(project_root)
    if not path.is_file():
        return HybridCoupling()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return HybridCoupling.model_validate(data)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid hybrid/coupling.json: {exc}"
        ) from exc


def save_coupling(project_root: Path, coupling: HybridCoupling) -> HybridCoupling:
    ensure_hybrid_dir(project_root)
    seen: set[str] = set()
    cleaned: list[HybridCouplingPoint] = []
    for p in coupling.points:
        nid = str(p.node_id).strip()
        if not nid:
            raise HTTPException(status_code=400, detail="coupling point missing node_id")
        if nid in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate coupling node_id: {nid}")
        seen.add(nid)
        cleaned.append(
            HybridCouplingPoint(
                node_id=nid,
                x=float(p.x),
                y=float(p.y),
                cd=float(p.cd),
                exchange_area=max(float(p.exchange_area), 1e-6),
            )
        )
    out = HybridCoupling(
        points=cleaned,
        surface_inflows=list(coupling.surface_inflows),
        generated_by=coupling.generated_by,
    )
    path = coupling_path(project_root)
    # compact JSON: auto coupling for big models has thousands of points
    path.write_text(json.dumps(out.model_dump()) + "\n", encoding="utf-8")
    return out


def coupling_summary(project_root: Path) -> dict[str, Any]:
    path = coupling_path(project_root)
    if not path.is_file():
        return {"has_coupling": False, "coupling_count": 0}
    c = load_coupling(project_root)
    return {
        "has_coupling": True,
        "coupling_count": len(c.points),
        "surface_inflow_count": len(c.surface_inflows),
    }
