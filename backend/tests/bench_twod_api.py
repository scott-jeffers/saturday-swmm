"""Manual benchmark for the 2D binary results API against a live backend.

Usage (backend must be running with a 2D project open):
    python tests/bench_twod_api.py [base_url]

Not collected by pytest (no test_ prefix); see docs/BENCHMARKS.md.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"


def timed(label: str, path: str) -> tuple[float, bytes, dict[str, str]]:
    url = f"{BASE}{path}"
    t0 = time.perf_counter()
    with urllib.request.urlopen(url, timeout=600) as resp:
        body = resp.read()
        headers = {k: v for k, v in resp.headers.items()}
    ms = (time.perf_counter() - t0) * 1000.0
    print(f"{label:<32} {ms:9.1f} ms  {len(body):>12,} bytes")
    return ms, body, {k.lower(): v for k, v in headers.items()}


def main() -> int:
    print(f"Base: {BASE}\n")

    _, info_body, _ = timed("2d/info", "/api/2d/info")
    info = json.loads(info_body)
    tri = int(info["triangle_count"])
    print(f"  triangles={tri:,} vertices={info['vertex_count']:,}\n")

    ms_cold, periods_body, _ = timed("2d/periods (cold)", "/api/2d/periods")
    ms_warm, _, _ = timed("2d/periods (warm)", "/api/2d/periods")
    periods = json.loads(periods_body)
    n = int(periods["period_count"])
    print(f"  period_count={n} peak_depth_max={periods.get('peak_depth_max')}\n")

    expected = tri * 4
    scrub = []
    for p in [0, 1, 2, min(50, n - 1), min(100, n - 1)]:
        ms, body, hdr = timed(
            f"snapshot/binary p={p}", f"/api/2d/snapshot/binary?period={p}&variable=depth"
        )
        scrub.append(ms)
        assert len(body) == expected, f"got {len(body)} want {expected}"
        assert int(hdr["x-triangle-count"]) == tri, hdr
        assert hdr.get("access-control-expose-headers"), "expose-headers missing"
    print()

    ms_env_cold, env_body, _ = timed("envelope/binary (cold)", "/api/2d/envelope/binary?variable=depth")
    ms_env_warm, _, _ = timed("envelope/binary (warm)", "/api/2d/envelope/binary?variable=depth")
    assert len(env_body) == expected, f"envelope {len(env_body)} want {expected}"
    print()

    ms_mesh, mesh_body, _ = timed("2d/mesh (geometry, cold)", "/api/2d/mesh")
    ms_mesh_warm, _, _ = timed("2d/mesh (geometry, warm)", "/api/2d/mesh")
    mesh = json.loads(mesh_body)
    print(
        f"  mesh vertices={len(mesh.get('vertices') or []):,} "
        f"triangles={len(mesh.get('triangles') or []):,} "
        f"geojson_features={len((mesh.get('geojson') or {}).get('features') or [])}"
    )

    print("\n--- summary ---")
    print(f"periods      cold {ms_cold:8.1f} ms   warm {ms_warm:8.1f} ms")
    print(f"snapshot     avg  {sum(scrub) / len(scrub):8.1f} ms   max {max(scrub):8.1f} ms")
    print(f"envelope     cold {ms_env_cold:8.1f} ms   warm {ms_env_warm:8.1f} ms")
    print(f"mesh geom    cold {ms_mesh:8.1f} ms   warm {ms_mesh_warm:8.1f} ms")
    print(f"payload/period {expected / 1024 / 1024:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
