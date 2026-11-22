"""Build the Drexel University campus example: with and without LID.

    python scripts/build_drexel_example.py            # build from cached data
    python scripts/build_drexel_example.py --fetch    # refresh the public data first

Subcatchments are the Drexel-owned parcels of the Philadelphia Water
Department's parcel layer (University City). Impervious cover comes from the
city's building footprints plus an assumed paved share of the rest of each
parcel. Slopes and ground elevations come from USGS 3DEP 1 m lidar (EPQS).

The pipes are assumed: a storm sewer under the street centrelines, a tree
draining to the lowest point of the network, manholes at most 300 ft apart,
5 ft minimum cover, 0.5 % minimum slope, and pipes sized by the rational
method for a 5-year, 15-minute storm. The real sewers here are combined and
not public; this network is a stand-in for the demo.

Storm: NOAA Atlas 14 2-year 24-hour depth (3.26 in) on an NRCS Type II
distribution: an ordinary storm that the assumed pipes (sized for a 5-year
peak) still struggle with, so the green infrastructure shows.

"With LID" (the base scenario) adds green roofs on large roofs, permeable
pavement on parking lots and bioretention for the rest of the paving.
"No LID" is the same campus as it is today.

Outputs: examples/Drexel_Campus (app, with scenarios and GIS layers) and
frontend/public/examples/drexel (browser viewer).
"""

from __future__ import annotations

import csv
import heapq
import json
import math
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import transform, unary_union  # noqa: I001

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

EX = ROOT / "examples" / "Drexel_Campus"
SRC = EX / "source"
VIEWER = ROOT / "frontend" / "public" / "examples" / "drexel"
NAME = "Drexel_Campus"
CRS = "EPSG:2272"  # NAD83 / Pennsylvania South (ftUS)

BBOX = (-75.200, 39.948, -75.180, 39.964)
CARTO = "https://phl.carto.com/api/v2/sql"
AGOL = "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services"
EPQS = "https://epqs.nationalmap.gov/v1/json"

# Design values
DEPTH_2YR_24H = 3.26  # in, NOAA Atlas 14 at 39.9565, -75.1895
I_5YR_15MIN = 0.986 * 4  # in/hr, 5-year 15-minute
N_PIPE = 0.013
MIN_SLOPE = 0.005
COVER = 5.0  # ft to crown
MAX_SPACING = 300.0  # ft between manholes
SIZES_IN = [15, 18, 21, 24, 27, 30, 36, 42, 48, 54, 60, 66, 72]

to_ft = Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform
to_wgs = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True).transform


# --------------------------------------------------------------------------- data


def _get(url: str, params: dict[str, str] | None = None, timeout: int = 120) -> bytes:
    if params:
        url += "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def fetch() -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    env = f"ST_MakeEnvelope({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]},4326)"
    q = (
        "select parcelid, address, owner1, bldg_desc, gross_area, the_geom from pwd_parcels "
        f"where (owner1 ilike '%drexel%' or owner2 ilike '%drexel%') and the_geom && {env}"
    )
    (SRC / "parcels.geojson").write_bytes(_get(CARTO, {"q": q, "format": "geojson"}))
    geo = {
        "where": "1=1",
        "geometry": ",".join(map(str, BBOX)),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": "4000",
    }
    for svc, fname, fields in (
        ("LI_BUILDING_FOOTPRINTS", "buildings.geojson", "address,building_name,approx_hgt,max_hgt"),
        ("Street_Centerline", "streets.geojson", "st_name,st_type,class,seg_id"),
        ("INLETS", "inlets.geojson", "inlettype,owner,system"),
    ):
        raw = _get(f"{AGOL}/{svc}/FeatureServer/0/query", {**geo, "outFields": fields})
        (SRC / fname).write_bytes(raw)
    print("fetched source data")


def elevations(points: list[tuple[float, float]]) -> list[float]:
    """Ground elevation (ft) at WGS84 points, cached in source/elevations.json."""
    cache_p = SRC / "elevations.json"
    cache: dict[str, float] = json.loads(cache_p.read_text()) if cache_p.is_file() else {}
    key = lambda p: f"{p[0]:.6f},{p[1]:.6f}"  # noqa: E731
    todo = sorted({key(p) for p in points if key(p) not in cache})

    def one(k: str) -> tuple[str, float | None]:
        lon, lat = k.split(",")
        for _ in range(4):
            try:
                v = json.loads(_get(EPQS, {"x": lon, "y": lat, "wkid": "4326", "units": "Feet"}, 30))["value"]
                return k, round(float(v), 2)
            except Exception:  # noqa: BLE001  (transient service errors)
                continue
        return k, None

    if todo:
        with ThreadPoolExecutor(12) as ex:
            for k, v in ex.map(one, todo):
                if v is not None and v > -100:
                    cache[k] = v
        cache_p.write_text(json.dumps(cache, indent=0, sort_keys=True))
        print(f"sampled {len(todo)} elevations")
    out = []
    for p in points:
        v = cache.get(key(p))
        if v is None:
            raise RuntimeError(f"no elevation at {p}")
        out.append(v)
    return out


def load(name: str) -> list[dict]:
    return json.loads((SRC / name).read_text(encoding="utf-8"))["features"]


def ft(geom):
    return transform(to_ft, shape(geom))


# --------------------------------------------------------------------------- subcatchments


def paved_share(desc: str | None) -> float:
    """Assumed paved share of the part of a parcel not under a building."""
    d = (desc or "").upper()
    if "PARKING" in d or "PKG" in d:
        return 0.95
    if "PARK" in d:
        return 0.15
    if "VAC LAND" in d:
        return 0.30
    return 0.55  # plazas, walks, service drives, courtyards


def build_subcatchments():
    parcels = [(f["properties"], ft(f["geometry"]).buffer(0)) for f in load("parcels.geojson")]
    blds = [ft(f["geometry"]).buffer(0) for f in load("buildings.geojson") if f["geometry"]]
    subs = []
    for i, (p, g) in enumerate(sorted(parcels, key=lambda t: (-t[1].centroid.y, t[1].centroid.x))):
        if g.area < 400:
            continue
        roofs = unary_union([b.intersection(g) for b in blds if b.intersects(g)]) if blds else None
        roof = roofs.area if roofs is not None else 0.0
        big_roof = sum(r.area for r in getattr(roofs, "geoms", [roofs]) if r is not None and r.area >= 8000) if roofs else 0.0
        rest = g.area - roof
        paved = rest * paved_share(p.get("bldg_desc"))
        subs.append(
            {
                "name": f"P{i + 1:03d}",
                "address": (p.get("address") or "").title(),
                "use": (p.get("bldg_desc") or "Unclassified").strip().title(),
                "geom": g,
                "area_sf": g.area,
                "roof_sf": roof,
                "big_roof_sf": big_roof,
                "paved_sf": paved,
                "parking": "PARKING" in (p.get("bldg_desc") or "").upper() or "PKG" in (p.get("bldg_desc") or "").upper(),
            }
        )
    # slope: elevation range across the parcel over the distance between those points
    samples: list[list[tuple[float, float]]] = []
    for s in subs:
        g = s["geom"]
        hull = g.convex_hull.exterior.coords if g.convex_hull.geom_type == "Polygon" else []
        pts = [g.representative_point().coords[0]]
        step = max(1, len(hull) // 8)
        pts += [hull[k] for k in range(0, len(hull) - 1, step)][:8]
        # pull boundary points in a little so they sample the parcel, not the street
        c = g.representative_point()
        pts = [(x + (c.x - x) * 0.15, y + (c.y - y) * 0.15) for x, y in pts]
        samples.append(pts)
    flat = [to_wgs(x, y) for pts in samples for x, y in pts]
    z = elevations(flat)
    k = 0
    for s, pts in zip(subs, samples):
        zs = z[k : k + len(pts)]
        k += len(pts)
        hi, lo = max(range(len(zs)), key=zs.__getitem__), min(range(len(zs)), key=zs.__getitem__)
        dist = math.dist(pts[hi], pts[lo]) or 1.0
        s["slope_pct"] = min(8.0, max(0.5, 100 * (zs[hi] - zs[lo]) / dist))
        s["ground"] = zs[0]
    return subs


# --------------------------------------------------------------------------- network


def build_network(subs):
    keep_class = {2, 3, 4, 5, 6, 12}
    lines = []
    for f in load("streets.geojson"):
        p = f["properties"]
        name = f"{p.get('st_name') or ''} {p.get('st_type') or ''}".strip()
        if p.get("class") not in keep_class or "LOWER LEVEL" in name or "TRL" in name or not f["geometry"]:
            continue
        g = ft(f["geometry"])
        for part in getattr(g, "geoms", [g]):
            lines.append((part, name.title()))
    area = unary_union([s["geom"] for s in subs]).buffer(250)
    lines = [(g, n) for g, n in lines if g.intersects(area)]

    # graph: nodes snapped to 1 ft, long segments split for manholes
    nodes: dict[tuple[int, int], int] = {}
    xy: list[tuple[float, float]] = []
    edges: dict[int, dict[int, tuple[float, str]]] = {}

    def nid(x: float, y: float) -> int:
        k = (round(x), round(y))
        if k not in nodes:
            nodes[k] = len(xy)
            xy.append((x, y))
            edges[nodes[k]] = {}
        return nodes[k]

    for g, n in lines:
        pts = list(g.coords)
        a = nid(*pts[0][:2])
        acc = [pts[0][:2]]
        length = 0.0
        for p0, p1 in zip(pts, pts[1:]):
            length += math.dist(p0[:2], p1[:2])
            acc.append(p1[:2])
        pieces = max(1, math.ceil(length / MAX_SPACING))
        line = LineString(acc)
        prev = a
        for j in range(1, pieces + 1):
            pt = line.interpolate(length * j / pieces) if j < pieces else Point(acc[-1])
            b = nid(pt.x, pt.y)
            if b != prev:
                seg = length / pieces
                edges[prev][b] = (seg, n)
                edges[b][prev] = (seg, n)
            prev = b

    # largest connected component
    seen: set[int] = set()
    best: set[int] = set()
    for s in edges:
        if s in seen:
            continue
        comp, stack = set(), [s]
        while stack:
            u = stack.pop()
            if u in comp:
                continue
            comp.add(u)
            stack.extend(edges[u])
        seen |= comp
        if len(comp) > len(best):
            best = comp
    ids = sorted(best)
    ground = dict(zip(ids, elevations([to_wgs(*xy[i]) for i in ids])))

    # subcatchment outlets: nearest node
    for s in subs:
        c = s["geom"].representative_point()
        s["outlet"] = min(ids, key=lambda i: (xy[i][0] - c.x) ** 2 + (xy[i][1] - c.y) ** 2)
    outlets = {s["outlet"] for s in subs}

    # outfall: the lowest node; tree by Dijkstra, penalising pipes laid uphill
    out = min(ids, key=ground.__getitem__)
    dist = {out: 0.0}
    parent: dict[int, int] = {}
    pq = [(0.0, out)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, math.inf):
            continue
        for v, (length, _) in edges[u].items():
            if v not in best:
                continue
            rise = ground[u] - ground[v]  # flow v -> u; positive = uphill
            w = length * (1 + 25 * max(0.0, rise) / length)
            if d + w < dist.get(v, math.inf):
                dist[v] = d + w
                parent[v] = u
                heapq.heappush(pq, (d + w, v))
    used: set[int] = set()
    for o in outlets:
        u = o
        while u != out and u not in used:
            used.add(u)
            u = parent[u]
    used.add(out)

    # design flows (rational method), accumulated down the tree
    local: dict[int, float] = {}
    for s in subs:
        imp = s["imperv_sf"] / s["area_sf"]
        c = 0.9 * imp + 0.25 * (1 - imp)
        local[s["outlet"]] = local.get(s["outlet"], 0.0) + c * I_5YR_15MIN * s["area_sf"] / 43560
    children: dict[int, list[int]] = {}
    for v in used - {out}:
        children.setdefault(parent[v], []).append(v)
    order: list[int] = []  # upstream first

    def visit(u: int) -> None:
        for c in children.get(u, []):
            visit(c)
        order.append(u)

    sys.setrecursionlimit(10000)
    visit(out)
    q = {u: local.get(u, 0.0) for u in used}
    for u in order:
        if u != out:
            q[parent[u]] += q[u]

    # inverts and sizes: iterate as depth depends on diameter and vice versa
    diam = {u: 15 / 12 for u in used}
    for _ in range(4):
        inv: dict[int, float] = {}
        for u in order:  # upstream first
            top = ground[u] - COVER - max([diam[c] for c in children.get(u, [])] + [diam.get(u, 1.25)])
            lows = [inv[c] - MIN_SLOPE * edges[c][u][0] for c in children.get(u, [])]
            inv[u] = min([top, *lows])
        for u in used - {out}:
            length = edges[u][parent[u]][0]
            s = max(MIN_SLOPE, (inv[u] - inv[parent[u]]) / length)
            need = q[u]
            for d_in in SIZES_IN:
                d = d_in / 12
                if 0.463 / N_PIPE * d ** (8 / 3) * s**0.5 >= need:
                    break
            diam[u] = d
    return xy, ground, parent, used, out, inv, diam, edges, q


# --------------------------------------------------------------------------- LID


def lid_plan(s: dict) -> list[tuple[str, float, float, float]]:
    """[(control, area sf, width ft, FromImp %)] for one parcel."""
    plan = []
    gr = 0.4 * s["big_roof_sf"]
    if gr >= 2000:
        plan.append(("GreenRoof", gr, 0.0, 0.0))
    imp_left = s["imperv_sf"] - gr
    if s["parking"] and s["paved_sf"] > 3000:
        pp = 0.5 * s["paved_sf"]
        imp_left -= pp
        # the rest of the lot drains onto the pavers
        plan.append(("PermPave", pp, math.sqrt(pp), None))  # FromImp filled below
    # bioretention sized at 1:15 for the paving that's left (not roofs on green roofs)
    paved_left = max(0.0, s["paved_sf"] - (0.5 * s["paved_sf"] if s["parking"] and s["paved_sf"] > 3000 else 0))
    treated = paved_left + max(0.0, s["roof_sf"] - gr) * 0.5  # half the remaining roofs piped to it
    bio = treated / 15
    pervious = s["area_sf"] - s["imperv_sf"]
    bio = min(bio, 0.6 * pervious)
    if bio >= 200:
        plan.append(("BioCell", bio, 0.0, None))
    # FromImp: % of the impervious area left after the LIDs take their footprint
    lid_imp = gr + sum(a for c, a, _, _ in plan if c == "PermPave")
    rest_imp = max(1.0, s["imperv_sf"] - lid_imp)
    out = []
    for c, a, w, f in plan:
        if c == "PermPave":
            f = min(60.0, 100 * (s["paved_sf"] - a) / rest_imp)
        elif c == "BioCell":
            f = min(100.0 - sum(x[3] for x in out if x[0] == "PermPave"), 100 * min(treated, bio * 15) / rest_imp)
        out.append((c, a, w, round(max(0.0, f), 1)))
    return out


# --------------------------------------------------------------------------- INP


def type2_series(depth: float) -> list[tuple[str, float]]:
    rows = list(csv.reader(open(ROOT / "frontend/src/lib/storm/design-storms.csv", encoding="utf-8-sig")))[1:]
    per_min = [float(r[3]) for r in rows if r[3]][:1440]
    out = []
    for k in range(0, 1440, 5):
        out.append((f"{k // 60}:{k % 60:02d}", round(depth * sum(per_min[k : k + 5]) / 5, 4)))
    return out


LID_CONTROLS = """[LID_CONTROLS]
;;Name           Type/Layer Parameters
;; Extensive green roof: 4 in growing medium over a drainage mat
GreenRoof        GR
GreenRoof        SURFACE    3          0          0.1        1.0        5
GreenRoof        SOIL       4          0.5        0.2        0.1        1.0        10         3.5
GreenRoof        DRAINMAT   1          0.5        0.1
;; Porous pavement over 12 in of stone, underdrained (urban fill soils)
PermPave         PP
PermPave         SURFACE    0.05       0          0.012      1.0        5
PermPave         PAVEMENT   6          0.15       0          100        0
PermPave         STORAGE    12         0.75       0.2        0
PermPave         DRAIN      0.5        0.5        6          6
;; Bioretention: 9 in ponding, 24 in soil, 12 in stone, underdrain
BioCell          BC
BioCell          SURFACE    9          0.2        0.1        1.0        5
BioCell          SOIL       24         0.5        0.2        0.1        0.5        10         3.5
BioCell          STORAGE    12         0.75       0.2        0
BioCell          DRAIN      0.5        0.5        6          6
"""


def write_inp(subs, net, with_lid: bool) -> str:
    xy, ground, parent, used, out, inv, diam, edges, q = net
    jname = {u: f"MH{k + 1:03d}" for k, u in enumerate(sorted(used - {out}, key=lambda u: (-xy[u][1], xy[u][0])))}
    jname[out] = "OF1"
    title = (
        "Drexel University campus (University City, Philadelphia): demo model\n"
        + ("With LID: green roofs, permeable pavement and bioretention.\n" if with_lid else "No LID: the campus as it is today.\n")
        + "Subcatchments: Drexel-owned PWD parcels; impervious cover from city building footprints plus assumed paving.\n"
        + "Pipes are ASSUMED (street centrelines, 5-yr rational sizing); the real sewers here are combined.\n"
        + "Storm: NOAA Atlas 14 2-yr 24-hr (3.26 in), NRCS Type II. Ground: USGS 3DEP 1 m lidar."
    )
    L = []
    L += ["[TITLE]", ";;Project Title/Notes", title, ""]
    L += [
        "[OPTIONS]",
        ";;Option             Value",
        "FLOW_UNITS           CFS",
        "INFILTRATION         HORTON",
        "FLOW_ROUTING         DYNWAVE",
        "LINK_OFFSETS         DEPTH",
        "MIN_SLOPE            0",
        "ALLOW_PONDING        NO",
        "SKIP_STEADY_STATE    NO",
        "START_DATE           06/01/2024",
        "START_TIME           00:00:00",
        "REPORT_START_DATE    06/01/2024",
        "REPORT_START_TIME    00:00:00",
        "END_DATE             06/02/2024",
        "END_TIME             06:00:00",
        "SWEEP_START          01/01",
        "SWEEP_END            12/31",
        "DRY_DAYS             5",
        "REPORT_STEP          00:05:00",
        "WET_STEP             00:01:00",
        "DRY_STEP             00:05:00",
        "ROUTING_STEP         0:00:05",
        "INERTIAL_DAMPING     PARTIAL",
        "NORMAL_FLOW_LIMITED  BOTH",
        "FORCE_MAIN_EQUATION  H-W",
        "VARIABLE_STEP        0.75",
        "LENGTHENING_STEP     0",
        "MIN_SURFAREA         12.566",
        "MAX_TRIALS           8",
        "HEAD_TOLERANCE       0.005",
        "SYS_FLOW_TOL         5",
        "LAT_FLOW_TOL         5",
        "MINIMUM_STEP         0.5",
        "THREADS              1",
        "",
        "[EVAPORATION]",
        ";;Data Source    Parameters",
        "CONSTANT         0.0",
        "DRY_ONLY         NO",
        "",
        "[RAINGAGES]",
        ";;Name           Format    Interval SCF      Source",
        "RG1              INTENSITY 0:05     1.0      TIMESERIES 2yr24hr",
        "",
        "[SUBCATCHMENTS]",
        ";;Name           Rain Gage        Outlet           Area     %Imperv  Width    %Slope   CurbLen  SnowPack",
    ]
    lid_rows: list[str] = []
    for s in subs:
        area, imp = s["area_sf"], s["imperv_sf"]
        plan = lid_plan(s) if with_lid else []
        lid_area = sum(a for _, a, _, _ in plan)
        lid_imp = sum(a for c, a, _, _ in plan if c in ("GreenRoof", "PermPave"))
        a2 = area - lid_area  # SWMM takes the LID area out; %Imperv and Width describe the rest
        imp2 = max(0.0, imp - lid_imp)
        pct = 100 * imp2 / a2
        flow_len = min(400.0, max(50.0, 0.75 * math.sqrt(area)))
        width = a2 / flow_len
        L.append(
            f"{s['name']:<16} RG1              {jname[s['outlet']]:<16} {area / 43560:<8.4f} {pct:<8.2f} {width:<8.1f} {s['slope_pct']:<8.2f} 0"
        )
        for c, a, w, f in plan:
            lid_rows.append(f"{s['name']:<16} {c:<16} 1       {a:<10.0f} {w:<10.1f} 0          {f:<10} 0")
    L += ["", "[SUBAREAS]", ";;Subcatchment   N-Imperv   N-Perv     S-Imperv   S-Perv     PctZero    RouteTo"]
    for s in subs:
        L.append(f"{s['name']:<16} 0.012      0.15       0.05       0.1        25         OUTLET")
    L += ["", "[INFILTRATION]", ";;Subcatchment   MaxRate    MinRate    Decay      DryTime    MaxInfil"]
    for s in subs:
        # urban fill over HSG C/D soils
        L.append(f"{s['name']:<16} 3.0        0.15       4          7          0")
    if with_lid:
        L += ["", LID_CONTROLS.rstrip("\n"), "", "[LID_USAGE]",
              ";;Subcatchment   LID Process      Number  Area       Width      InitSat    FromImp    ToPerv"]
        L += lid_rows
    L += ["", "[JUNCTIONS]", ";;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded"]
    for u in sorted(used - {out}, key=jname.__getitem__):
        L.append(f"{jname[u]:<16} {inv[u]:<10.2f} {ground[u] - inv[u]:<10.2f} 0          0          0")
    L += ["", "[OUTFALLS]", ";;Name           Elevation  Type       Stage Data       Gated    Route To",
          f"OF1              {inv[out]:<10.2f} FREE                        NO", ""]
    L += ["[CONDUITS]", ";;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow"]
    links = sorted(used - {out}, key=jname.__getitem__)
    for u in links:
        L.append(f"{'C' + jname[u][2:]:<16} {jname[u]:<16} {jname[parent[u]]:<16} {edges[u][parent[u]][0]:<10.1f} {N_PIPE:<10} 0          0          0          0")
    L += ["", "[XSECTIONS]", ";;Link           Shape        Geom1            Geom2      Geom3      Geom4      Barrels"]
    for u in links:
        L.append(f"{'C' + jname[u][2:]:<16} CIRCULAR     {diam[u]:<16.2f} 0          0          0          1")
    L += ["", "[TIMESERIES]", ";;Name           Date       Time       Value",
          "; NOAA Atlas 14 2-yr 24-hr depth 3.26 in, NRCS Type II, 5-min intensities (in/hr)"]
    for t, v in type2_series(DEPTH_2YR_24H):
        L.append(f"2yr24hr                    {t:<10} {v}")
    L += ["", "[REPORT]", ";;Reporting Options", "SUBCATCHMENTS ALL", "NODES ALL", "LINKS ALL", ""]
    L += ["[TAGS]"]
    L += [f"Subcatch   {s['name']:<16} {s['use'].replace(' ', '_')[:30]}" for s in subs]
    L += ["", "[MAP]", "DIMENSIONS " + " ".join(f"{v:.2f}" for v in unary_union([s["geom"] for s in subs]).bounds), "Units      Feet", ""]
    L += ["[COORDINATES]", ";;Node           X-Coord            Y-Coord"]
    for u in sorted(used, key=jname.__getitem__):
        L.append(f"{jname[u]:<16} {xy[u][0]:<18.3f} {xy[u][1]:.3f}")
    L += ["", "[POLYGONS]", ";;Subcatchment   X-Coord            Y-Coord"]
    for s in subs:
        g = s["geom"]
        poly = max(getattr(g, "geoms", [g]), key=lambda p: p.area).simplify(1.0)
        for x, y in list(poly.exterior.coords)[:-1]:
            L.append(f"{s['name']:<16} {x:<18.3f} {y:.3f}")
    L += ["", "[SYMBOLS]", ";;Gage           X-Coord            Y-Coord"]
    c = unary_union([s["geom"] for s in subs]).centroid
    L += [f"RG1              {c.x:<18.3f} {c.y + 1500:.3f}", ""]
    return "\n".join(L) + "\n"


# --------------------------------------------------------------------------- run & package


def run(inp: Path) -> tuple[Path, Path]:
    from pyswmm import Simulation

    from app.services.epa_inp import sanitize_for_pyswmm
    from app.services.lid_reports import with_lid_reports

    tmp = Path(tempfile.mkdtemp())
    text, _ = with_lid_reports(inp.read_text(encoding="utf-8"), inp)
    epa_text, _ = sanitize_for_pyswmm(text)
    epa = tmp / inp.name
    epa.write_text(epa_text, encoding="utf-8")
    rpt, out = epa.with_suffix(".rpt"), epa.with_suffix(".out")
    with Simulation(str(epa), str(rpt), str(out)) as sim:
        for _ in sim:
            pass
    return rpt, out


def gis_layers(subs) -> None:
    """Parcels and buildings as background GIS layers (GeoJSON, WGS84)."""
    out = VIEWER / "gis"
    out.mkdir(parents=True, exist_ok=True)
    parcels = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"subcatchment": s["name"], "address": s["address"], "use": s["use"],
                               "area_sf": round(s["area_sf"]), "roof_sf": round(s["roof_sf"]),
                               "imperv_pct": round(100 * s["imperv_sf"] / s["area_sf"], 1)},
                "geometry": mapping(transform(to_wgs, s["geom"]).simplify(0.000003)),
            }
            for s in subs
        ],
    }
    (out / "drexel-parcels.geojson").write_text(json.dumps(parcels, separators=(",", ":")))
    hull = transform(to_wgs, unary_union([s["geom"] for s in subs]).buffer(800))
    blds = [f for f in load("buildings.geojson") if f["geometry"] and shape(f["geometry"]).intersects(hull)]
    for f in blds:
        f["geometry"] = mapping(shape(f["geometry"]).simplify(0.000003))
        f["properties"] = {k: f["properties"].get(k) for k in ("address", "building_name", "approx_hgt")}
    (out / "buildings.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": blds}, separators=(",", ":")))
    inlets = [f for f in load("inlets.geojson") if f["geometry"] and shape(f["geometry"]).intersects(hull)]
    (out / "inlets.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": inlets}, separators=(",", ":")))
    print(f"GIS: {len(subs)} parcels, {len(blds)} buildings, {len(inlets)} inlets")


def app_storms() -> None:
    """10- and 100-year design storms in the app example's storm library (not run:
    the Runs page shows them waiting, a click away)."""
    from app.services.project_service import project_service
    from app.services.storm_service import storm_service

    shutil.rmtree(EX / "storms", ignore_errors=True)
    project_service.open_project(str(EX))
    for rp, depth in ((10, 4.82), (100, 7.70)):
        series = type2_series(depth)  # 5-min intensities, in/hr
        rows = []
        for k, (_, v) in enumerate(series):
            m = k * 5
            rows.append(f"STORM 2024 6 1 {m // 60} {m % 60} {v / 12:.4f}")  # depth per 5 min
        storm_service.create(
            f"{rp}-year 24-hour", "\n".join(rows), fmt="VOLUME", interval="0:05", units="IN", after_hours=6,
            return_period=rp, duration_hr=24, note=f"NOAA Atlas 14 {rp}-year 24-hour {depth} in, NRCS Type II",
        )
    print("storms: 10- and 100-year")


def app_gis_layers() -> None:
    """The same layers as the viewer's, registered in the app's project (gis/layers.json)."""
    from app.services.gis_service import gis_service
    from app.services.project_service import project_service

    shutil.rmtree(EX / "gis", ignore_errors=True)
    project_service.open_project(str(EX))
    for fname, name, visible, style in (
        ("buildings.geojson", "Building footprints", True, {"color": "#6b7280", "fill_opacity": 0.35, "line_width": 0.5}),
        ("drexel-parcels.geojson", "Drexel parcels", False, {"color": "#3a86ff", "fill_opacity": 0, "line_width": 2, "label_field": "address"}),
        ("inlets.geojson", "PWD inlets", False, {"color": "#2a9d8f", "point_radius": 3}),
    ):
        layer = gis_service.ingest_vector(str(VIEWER / "gis" / fname), name=name)
        gis_service.patch_layer(layer["id"], {"visible": visible, "style": style})
    man_p = EX / "gis" / "layers.json"
    man = json.loads(man_p.read_text(encoding="utf-8"))
    for layer in man["layers"]:
        layer.pop("source_path", None)  # machine-specific
    man_p.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
    print(f"app GIS layers: {len(man['layers'])}")


def main() -> int:
    if "--fetch" in sys.argv or not (SRC / "parcels.geojson").is_file():
        fetch()
    subs = build_subcatchments()
    for s in subs:
        s["imperv_sf"] = min(0.98 * s["area_sf"], s["roof_sf"] + s["paved_sf"])
    net = build_network(subs)
    xy, ground, parent, used, out, inv, diam, edges, q = net
    print(f"{len(subs)} subcatchments, {len(used) - 1} pipes, outfall at {ground[out]:.1f} ft, max pipe {max(diam.values()) * 12:.0f} in")

    EX.mkdir(parents=True, exist_ok=True)
    (EX / ".saturday-swmm.json").write_text(json.dumps({"crs": CRS}, indent=2) + "\n")
    base = EX / f"{NAME}.inp"
    base.write_text(write_inp(subs, net, True), encoding="utf-8")
    scen = EX / "scenarios" / "no-lid"
    scen.mkdir(parents=True, exist_ok=True)
    child = scen / f"{NAME}.inp"
    child.write_text(write_inp(subs, net, False), encoding="utf-8")
    (scen / ".parent.inp").write_text(base.read_text(encoding="utf-8"), encoding="utf-8")
    (EX / "scenarios.json").write_text(
        json.dumps(
            {
                "version": 1,
                "scenarios": [
                    {"id": "base", "name": "With LID", "parent": None, "inp": base.name, "created": "2026-11-22T00:00:00+00:00",
                     "description": "Green roofs on large roofs, permeable pavement on parking lots, bioretention for the rest of the paving."},
                    {"id": "s-nolid", "name": "No LID (campus today)", "parent": "base", "inp": f"scenarios/no-lid/{base.name}",
                     "created": "2026-11-22T00:00:00+00:00", "description": "The same campus and sewers with no green infrastructure."},
                ],
            },
            indent=2,
        )
        + "\n"
    )

    from app.services.lid_reports import report_dir

    VIEWER.mkdir(parents=True, exist_ok=True)
    for inp, stem in ((base, "drexel"), (child, "drexel-nolid")):
        rpt, out_p = run(inp)
        shutil.copy(rpt, inp.with_suffix(".rpt"))
        shutil.copy(out_p, inp.with_suffix(".out"))
        shutil.copy(rpt, VIEWER / f"{stem}.rpt")
        shutil.copy(out_p, VIEWER / f"{stem}.out")
        print(f"ran {inp.relative_to(ROOT)} ({out_p.stat().st_size // 1024} KB)")
    shutil.copy(base, VIEWER / "drexel.inp")
    # LID reports are written every wet step (1 min); keep the 5-min report steps.
    for f in report_dir(base).glob("*.txt"):
        rows = f.read_text(encoding="utf-8").splitlines()
        keep = [r for r in rows if not (r[:1] == " " and r[1:3].isdigit() and r[15:17].isdigit() and int(r[15:17]) % 5)]
        f.write_text("\n".join(keep) + "\n", encoding="utf-8")
    vdir = VIEWER / "drexel.lid"
    shutil.rmtree(vdir, ignore_errors=True)
    vdir.mkdir()
    names = sorted(p.name for p in report_dir(base).glob("*.txt"))
    for n in names:
        shutil.copy(report_dir(base) / n, vdir / n)
    (vdir / "index.json").write_text(json.dumps(names, indent=1) + "\n")
    print(f"{len(names)} LID reports")
    gis_layers(subs)
    app_gis_layers()
    app_storms()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
