"""Build the Northeast Philadelphia sanitary sewer example.

    python scripts/build_philly_sanitary_example.py            # build from cached data
    python scripts/build_philly_sanitary_example.py --fetch    # refresh elevations not yet cached

A separate sanitary system, as in Philadelphia's Far Northeast, from house
sewers to the treatment plant:

* Bustleton collection system: one sewer under each real street (City of
  Philadelphia street centrelines), as a tree draining downhill to the creek.
  Manholes at intersections and at most 400 ft apart, 8 ft minimum cover, Ten
  States minimum slopes, pipes sized for peak dry-weather flow (Harmon peaking
  factor) plus a wet-weather allowance.
* Dry-weather flow from the city's parcels: 2.6 people per house, 2.2 per
  apartment (units from the building class), 80 gallons per person per day,
  and 0.1 gallon per square foot per day for shops, offices and restaurants.
  Weekday and weekend hourly patterns, a day-of-week pattern and a monthly one.
* Groundwater infiltration as a base inflow at each manhole (200 gallons per
  acre per day) that is higher in spring (monthly pattern).
* Rainfall-derived infiltration and inflow: RTK unit hydrographs, with wetter
  values in spring, for each manhole's sewershed area.
* A low-lying part of Bustleton by the creek drains to a pump station (wet
  well, duty and standby pumps, force main) that lifts it into the interceptor.
* The Pennypack Creek interceptor down the creek valley (USGS 3DEP ground) to
  the Delaware, then the Delaware interceptor along the riverside streets to
  the Northeast Water Pollution Control Plant at 3899 Richmond St, Bridesburg.
* The rest of the plant's separate service area (Holmesburg, Tacony, Mayfair)
  joins as three lumped trunk sewers with their own flows and RDII.
* At the plant: a diversion chamber with an off-line wet-weather equalization
  basin (filled over a side weir, drained back by a gate), the influent pump
  station's wet well with four pumps lifting to the headworks, and an
  emergency relief overflow to the Delaware.
* Control rules stage the plant pumps and the Bustleton pumps by wet-well
  level, and open the basin's drain gate only when the plant has room.

Storm: NOAA Atlas 14 2-year 24-hour (3.26 in), NRCS Type II, on the second
of three days. The real sewers and their sizes are not public: this network
is ASSUMED, for demonstrating the app. It is not PWD's system.

Outputs: examples/Philadelphia_Sanitary (app) and
frontend/public/examples/philly-sanitary (browser viewer).
"""

from __future__ import annotations

import csv
import heapq
import json
import math
import shutil
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "examples" / "Philadelphia_Sanitary"
SRC = OUT / "source"
VIEWER = REPO / "frontend" / "public" / "examples" / "philly-sanitary"
NAME = "Philadelphia_Sanitary"
EPQS = "https://epqs.nationalmap.gov/v1/json"
FETCH = "--fetch" in sys.argv

TO_FT = Transformer.from_crs("EPSG:4326", "EPSG:2272", always_xy=True)
TO_LL = Transformer.from_crs("EPSG:2272", "EPSG:4326", always_xy=True)

# The plant (PWD parcel at 3899 Richmond St) and where its works sit on the site.
PLANT = (-75.08215, 39.98778)

GPCD = 80.0  # gallons per person per day
PEOPLE_HOUSE = 2.6
PEOPLE_UNIT = 2.2
GWI_GPAD = 200.0  # groundwater infiltration, gallons per acre per day
LOT_ACRES = 0.18  # sewershed area per parcel, with its share of the street
COVER = 8.0
MAX_DEPTH = 30.0  # deeper than this, a lift station takes over
LIFT_MAX = 2.0  # an area needing more lift than this drains elsewhere
MIN_SLOPE = {8: 0.0040, 10: 0.0028, 12: 0.0022, 15: 0.0015, 18: 0.0012, 21: 0.0010, 24: 0.0008, 27: 0.0007, 30: 0.0006, 36: 0.0005, 42: 0.0004, 48: 0.0004, 54: 0.0004, 60: 0.0004, 66: 0.0004, 72: 0.0004, 78: 0.0003, 84: 0.0003, 90: 0.0003, 96: 0.0003}
SIZES = [8, 10, 12, 15, 18, 21, 24, 27, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96]
N_PIPE = 0.013
MGD_CFS = 1.547229

# ------------------------------------------------------------------- helpers


def _get(url: str, params: dict[str, str], timeout: int = 30) -> bytes:
    with urllib.request.urlopen(f"{url}?{urllib.parse.urlencode(params)}", timeout=timeout) as r:
        return r.read()


def ft(lon: float, lat: float) -> tuple[float, float]:
    return TO_FT.transform(lon, lat)


def elevations(points: list[tuple[float, float]]) -> list[float]:
    """Ground (ft, NAVD88) at lon/lat points from USGS 3DEP via EPQS, cached."""
    cache_p = SRC / "elevations.json"
    cache: dict[str, float] = json.loads(cache_p.read_text()) if cache_p.is_file() else {}
    key = lambda p: f"{p[0]:.5f},{p[1]:.5f}"  # noqa: E731
    todo = sorted({key(p) for p in points if key(p) not in cache})
    if todo and not FETCH and not cache:
        raise SystemExit("No cached elevations: run with --fetch once.")

    def one(k: str) -> tuple[str, float | None]:
        lon, lat = k.split(",")
        for _ in range(5):
            try:
                v = json.loads(_get(EPQS, {"x": lon, "y": lat, "wkid": "4326", "units": "Feet"}, 30))["value"]
                return k, round(float(v), 2)
            except Exception:  # noqa: BLE001  (the service fails now and then)
                continue
        return k, None

    if todo:
        with ThreadPoolExecutor(16) as ex:
            for k, v in ex.map(one, todo):
                if v is not None and v > -50:
                    cache[k] = v
        cache_p.write_text(json.dumps(cache, indent=0, sort_keys=True))
        print(f"sampled {len(todo)} elevations")
    out = []
    for p in points:
        v = cache.get(key(p))
        if v is None:
            # A failed sample: borrow the nearest cached point.
            best = min(cache, key=lambda k: (float(k.split(",")[0]) - p[0]) ** 2 + (float(k.split(",")[1]) - p[1]) ** 2)
            v = cache[best]
        out.append(v)
    return out


def full_flow_cfs(d_in: int, slope: float) -> float:
    d = d_in / 12
    a = math.pi * d * d / 4
    r = d / 4
    return 1.486 / N_PIPE * a * r ** (2 / 3) * math.sqrt(max(slope, 1e-5))


def size_for(q_cfs: float, slope: float, smallest: int = 8) -> int:
    for s in SIZES:
        if s >= smallest and full_flow_cfs(s, max(slope, MIN_SLOPE[s])) * 0.85 >= q_cfs:
            return s
    return SIZES[-1]


def harmon(pop: float) -> float:
    p = max(pop, 100) / 1000
    return min(4.0, 1 + 14 / (4 + math.sqrt(p)))


def along(line: list[tuple[float, float]], spacing: float) -> list[tuple[float, float]]:
    """Points every `spacing` along a polyline (projected), ends included."""
    out = [line[0]]
    carry = 0.0
    for (x0, y0), (x1, y1) in zip(line, line[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        t = spacing - carry
        while t < seg:
            out.append((x0 + (x1 - x0) * t / seg, y0 + (y1 - y0) * t / seg))
            t += spacing
        carry = (carry + seg) % spacing
    if math.dist(out[-1], line[-1]) > spacing * 0.35:
        out.append(line[-1])
    else:
        out[-1] = line[-1]
    return out


# ------------------------------------------------------------------- the model

nodes: dict[str, dict] = {}
links: list[dict] = []
vertices: dict[str, list[tuple[float, float]]] = {}


def add_node(nid: str, x: float, y: float, ground: float, kind: str = "junction", **kw) -> str:
    nodes[nid] = {"id": nid, "x": x, "y": y, "ground": ground, "kind": kind, "dwf": 0.0, "pop": 0.0, "acres": 0.0, "gwi": 0.0, **kw}
    return nid


def build() -> None:
    # ---------------------------------------------------------- source data
    streets = json.loads((SRC / "bustleton_streets.geojson").read_text())["features"]
    creek = json.loads((SRC / "pennypack_creek.geojson").read_text())["features"][0]["geometry"]["coordinates"]
    corridor = json.loads((SRC / "corridor_streets.geojson").read_text())["features"]
    parcels = list(csv.DictReader(open(SRC / "bustleton_parcels.csv")))

    # ---------------------------------------------------------- street graph (Bustleton)
    key = lambda p: (round(p[0], 6), round(p[1], 6))  # noqa: E731
    sadj: dict[tuple, list] = defaultdict(list)
    for f in streets:
        if f["properties"].get("class") in (1, 12):  # expressway lanes and ramps carry no sewer
            continue
        g = f["geometry"]
        for line in [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]:
            a, b = key(line[0]), key(line[-1])
            if a == b:
                continue
            pts = [ft(*p) for p in line]
            L = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
            sadj[a].append((b, L, pts))
            sadj[b].append((a, L, pts[::-1]))
    # Buried streams (the city's historic streams layer): the valleys the trunk
    # sewers follow. Each becomes a chain of points every 350 ft, linked to the
    # streets that cross or run beside it.
    hist = json.loads((SRC / "historic_streams.geojson").read_text())["features"]
    street_pts = [(n, ft(*n)) for n in list(sadj)]
    valley: set[tuple] = set()
    for f in hist:
        g = f["geometry"]
        for line in [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]:
            pl = [ft(*p) for p in line]
            if len(pl) < 2:
                continue
            marks = along(pl, 350)
            ks = []
            for x, y in marks:
                lon, lat = TO_LL.transform(x, y)
                ks.append(key((lon, lat)))
                valley.add(ks[-1])
            for (a_, b_), (pa, pb) in zip(zip(ks, ks[1:]), zip(marks, marks[1:])):
                L = math.dist(pa, pb)
                sadj[a_].append((b_, L * 0.7, [pa, pb]))
                sadj[b_].append((a_, L * 0.7, [pb, pa]))
            for k_, (x, y) in zip(ks, marks):
                d_, sn = min((math.dist((x, y), q), n) for n, q in street_pts)
                if d_ < 260:
                    sadj[k_].append((sn, d_, [(x, y), ft(*sn)]))
                    sadj[sn].append((k_, d_, [ft(*sn), (x, y)]))
    snodes = list(sadj)
    s_ground = dict(zip(snodes, elevations(snodes)))
    sxy = {n: ft(*n) for n in snodes}

    # ---------------------------------------------------------- Pennypack interceptor
    # From above Bustleton down the creek to the Delaware.
    start_i = min(range(len(creek)), key=lambda i: math.dist(creek[i], (-75.0578, 40.0828)))
    creek_ft = [ft(*p) for p in creek[start_i:]]
    pts = along(creek_ft, 900)
    p_ll = [TO_LL.transform(x, y) for x, y in pts]
    p_ground = elevations(p_ll)
    penny = []
    for i, ((x, y), g) in enumerate(zip(pts, p_ground)):
        penny.append(add_node(f"PI{i + 1:02d}", x, y, max(g, 6.0), interceptor="Pennypack"))
    # Creek points in between give the pipes' shapes.
    seg_pts: list[list[tuple[float, float]]] = []
    j = 0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        bend = []
        while j < len(creek_ft) and math.dist(creek_ft[j], b) > 30 and math.dist(creek_ft[j], a) < math.dist(a, b) * 1.6:
            if math.dist(creek_ft[j], a) > 30:
                bend.append(creek_ft[j])
            j += 1
        seg_pts.append(bend[::6])

    # ---------------------------------------------------------- tree: streets drain to the interceptor
    # Street nodes near the creek can connect to it; everything else drains
    # along the streets, preferring downhill.
    near = {}
    for n in snodes:
        d, k = min((math.dist(sxy[n], (nodes[p]["x"], nodes[p]["y"])), p) for p in penny)
        if d < 1000:
            near[n] = (k, d)
    dist = {n: 0.0 for n in near}
    parent: dict[tuple, tuple | None] = {n: None for n in near}
    via: dict[tuple, list] = {}
    pq = [(0.0, n) for n in near]
    heapq.heapify(pq)
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, L, geom in sadj[u]:
            # Flow goes v -> u. Uphill flow (v lower than u) costs a lot.
            rise = s_ground[u] - s_ground[v]
            cost = L * (1 + max(0.0, rise) * 4.0)
            if d + cost < dist.get(v, math.inf):
                dist[v] = d + cost
                parent[v] = u
                via[v] = geom[::-1]  # from v to u
                heapq.heappush(pq, (dist[v], v))

    reached = [n for n in snodes if n in dist]
    # Areas that would need a big lift over a ridge drain the other way (to
    # another interceptor, outside this model): leave them out.
    kids0: dict[tuple, list] = defaultdict(list)
    for n in reached:
        if parent[n] is not None:
            kids0[parent[n]].append(n)
    post: list[tuple] = []
    for r in [n for n in reached if parent[n] is None]:
        st = [(r, False)]
        while st:
            v, done = st.pop()
            if done:
                post.append(v)
                continue
            st.append((v, True))
            st += [(c, False) for c in kids0[v]]
    inv0: dict[tuple, float] = {}
    cut: set[tuple] = set()
    for v in post:
        req = s_ground[v] - COVER
        for c in kids0[v]:
            if c in cut:
                continue
            L = math.dist(sxy[c], sxy[v])
            arrive = inv0[c] - 0.004 * L
            if s_ground[v] - arrive > MAX_DEPTH + LIFT_MAX:
                cut.add(c)
                continue
            req = min(req, arrive)
        inv0[v] = req
    gone: set[tuple] = set()
    for c in cut:
        st = [c]
        while st:
            v = st.pop()
            gone.add(v)
            st += kids0[v]
    reached = [n for n in reached if n not in gone]
    print(f"left out {len(gone)} street points that drain away from Pennypack")
    sid = {n: f"BU{i + 1:03d}" for i, n in enumerate(sorted(reached, key=lambda n: (-sxy[n][1], sxy[n][0])))}
    for n in reached:
        add_node(sid[n], *sxy[n], s_ground[n])

    # Parcels -> nearest street manhole: people, flow and sewershed area.
    pts_arr = [(sid[n], sxy[n]) for n in reached]
    grid: dict[tuple[int, int], list] = defaultdict(list)
    for nid, (x, y) in pts_arr:
        grid[(int(x // 1500), int(y // 1500))].append((nid, x, y))

    def nearest(x: float, y: float) -> str:
        gx, gy = int(x // 1500), int(y // 1500)
        best = (math.inf, "")
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for nid, nx, ny in grid.get((gx + dx, gy + dy), []):
                    d = (nx - x) ** 2 + (ny - y) ** 2
                    if d < best[0]:
                        best = (d, nid)
        return best[1] or min(pts_arr, key=lambda t: math.dist(t[1], (x, y)))[0]

    total_pop = 0.0
    for p in parcels:
        desc = (p["bldg_desc"] or "").upper()
        if desc.startswith("VAC") or desc.startswith("PARKING") or not p["lon"]:
            continue
        x, y = ft(float(p["lon"]), float(p["lat"]))
        nid = nearest(x, y)
        if math.dist((x, y), (nodes[nid]["x"], nodes[nid]["y"])) > 450:
            continue  # served by sewers outside this model
        n = nodes[nid]
        gpd = 0.0
        pop = 0.0
        if desc.startswith(("S/D", "DET", "SEMI", "ROW", "HSE")):
            pop = PEOPLE_HOUSE
        elif "100 +" in desc:
            pop = 150 * PEOPLE_UNIT
        elif "51-100" in desc:
            pop = 75 * PEOPLE_UNIT
        elif "5-50" in desc:
            pop = 25 * PEOPLE_UNIT
        elif desc.startswith("APT"):
            pop = 3 * PEOPLE_UNIT
        elif desc.startswith("RES.CONDO"):
            pop = 1.8
        else:
            area = float(p["gross_area"] or 0)
            gpd = 0.1 * min(area, 200000)
        gpd += pop * GPCD
        n["pop"] += pop
        n["dwf"] += gpd / 1e6
        n["acres"] += LOT_ACRES
        total_pop += pop
    print(f"Bustleton: {len(reached)} manholes, {total_pop:,.0f} people")

    # Street pipes, split so manholes are at most 400 ft apart.
    tree_children: dict[str, list[str]] = defaultdict(list)
    roots: list[tuple] = []
    pipe_geom: dict[tuple[str, str], list] = {}
    for n in reached:
        p = parent[n]
        if p is None:
            roots.append(n)
            continue
        geom = via[n]
        L = sum(math.dist(geom[i], geom[i + 1]) for i in range(len(geom) - 1))
        parts = max(1, math.ceil(L / 400))
        chain = [sid[n]]
        if parts > 1:
            marks = along(geom, L / parts)[1:-1]
            for k, (x, y) in enumerate(marks):
                lon, lat = TO_LL.transform(x, y)
                mid = f"{sid[n]}_{k + 1}"
                add_node(mid, x, y, 0.0, _ll=(lon, lat))
                chain.append(mid)
        chain.append(sid[p])
        for a, b in zip(chain, chain[1:]):
            tree_children[b].append(a)
            pipe_geom[(a, b)] = []
        if parts == 1:
            pipe_geom[(sid[n], sid[p])] = geom[1:-1][::3]
    mids = [nid for nid, d in nodes.items() if "_ll" in d]
    for nid, g in zip(mids, elevations([nodes[m]["_ll"] for m in mids])):
        nodes[nid]["ground"] = g
        del nodes[nid]["_ll"]

    # Accumulate flows down each tree, size pipes and set inverts from the top down.
    down: dict[str, str] = {}
    for b, kids in tree_children.items():
        for a in kids:
            down[a] = b
    order: list[str] = []
    seen = set()

    def visit(u: str) -> None:
        stack = [(u, False)]
        while stack:
            v, done = stack.pop()
            if done:
                order.append(v)
                continue
            if v in seen:
                continue
            seen.add(v)
            stack.append((v, True))
            for c in tree_children.get(v, []):
                stack.append((c, False))

    for r in roots:
        visit(sid[r])
    acc = {k: {"dwf": nodes[k]["dwf"], "pop": nodes[k]["pop"], "acres": nodes[k]["acres"]} for k in order}
    for v in order:  # children before parents
        if v in down:
            for k in ("dwf", "pop", "acres"):
                acc[down[v]][k] += acc[v][k]

    def design_cfs(a: dict) -> float:
        peak_dwf = a["dwf"] * harmon(a["pop"]) * MGD_CFS
        wet = a["acres"] * 4000 / 1e6 * MGD_CFS  # wet-weather allowance, 4,000 gallons per acre per day
        return peak_dwf + wet

    invert: dict[str, float] = {}
    pipe_size: dict[tuple[str, str], int] = {}
    lifts: list[tuple[str, str]] = []
    dead: set[str] = set()
    for v in order:
        kids = tree_children.get(v, [])
        g = nodes[v]["ground"]
        req = g - COVER
        for c in kids:
            L = max(math.dist((nodes[c]["x"], nodes[c]["y"]), (nodes[v]["x"], nodes[v]["y"])), 20)
            nat = (invert[c] - (g - COVER)) / L
            s = size_for(design_cfs(acc[c]), max(nat, 0.0005))
            pipe_size[(c, v)] = s
            arrive = invert[c] - MIN_SLOPE[s] * L
            if g - arrive > MAX_DEPTH + 3:
                if acc[c]["dwf"] < 1e-5:
                    dead.add(c)  # nobody lives up there: no sewer
                    continue
                # Gravity would bury this sewer too deep (it has to climb a ridge):
                # a lift station at the low point pumps up to here instead.
                lifts.append((c, v))
                continue
            req = min(req, arrive)
        invert[v] = round(req, 2)

    # ---------------------------------------------------------- the low area by the creek: a pump station
    root_ids = [sid[r] for r in roots]
    sub_size = {r: sum(1 for v in order if _root_of(v, down) == r) for r in root_ids}
    candidates = [r for r in root_ids if sub_size[r] >= 12]

    # The pump station goes where a branch arrives deepest below the interceptor
    # it has to reach: gravity would pull the whole interceptor down to meet it.
    def deficit(r: str) -> float:
        rr = next(k for k, v in sid.items() if v == r)
        tgt = near[rr][0]
        L = near[rr][1]
        return (nodes[tgt]["ground"] - 10) - (invert[r] - 0.002 * L)

    ps_root = max(candidates or root_ids, key=deficit)
    print(f"Bustleton pump station serves {sub_size[ps_root]} manholes from {ps_root}")

    # Each root drains to its nearest interceptor manhole.
    conn: dict[str, str] = {}
    for r in roots:
        conn[sid[r]] = near[r][0]

    # ---------------------------------------------------------- lumped trunks of the rest of the service area
    lumped = [
        # id, name, people, sewershed acres, where it joins
        ("HOLMESBURG", "Holmesburg trunk sewer", 31000, 2600, "penny", 40.0440),
        ("TACONY", "Tacony trunk sewer", 42000, 3400, "delaware", -75.0400),
        ("MAYFAIR", "Mayfair trunk sewer", 48000, 3900, "delaware", -75.0580),
    ]

    # ---------------------------------------------------------- Delaware interceptor to the plant
    cadj: dict[tuple, list] = defaultdict(list)
    for f in corridor:
        g = f["geometry"]
        if not g:
            continue
        for line in [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]:
            a, b = key(line[0]), key(line[-1])
            pts_ = [ft(*p) for p in line]
            L = sum(math.dist(pts_[i], pts_[i + 1]) for i in range(len(pts_) - 1))
            cadj[a].append((b, L, pts_))
            cadj[b].append((a, L, pts_[::-1]))
    mouth = (nodes[penny[-1]]["x"], nodes[penny[-1]]["y"])
    plant = ft(*PLANT)
    c_start = min(cadj, key=lambda n: math.dist(ft(*n), mouth))
    c_end = min(cadj, key=lambda n: math.dist(ft(*n), plant))
    dist2 = {c_start: 0.0}
    prev2: dict[tuple, tuple] = {}
    pq = [(0.0, c_start)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == c_end:
            break
        if d > dist2[u]:
            continue
        for v, L, geom in cadj[u]:
            if d + L < dist2.get(v, math.inf):
                dist2[v] = d + L
                prev2[v] = (u, geom)
                heapq.heappush(pq, (dist2[v], v))
    route: list[tuple[float, float]] = []
    n = c_end
    segs = []
    while n != c_start:
        u, geom = prev2[n]
        segs.append(geom)
        n = u
    for gseg in reversed(segs):
        route += gseg if not route else gseg[1:]
    route = [mouth] + route + [plant]
    dpts = along(route, 1100)[1:]
    d_ll = [TO_LL.transform(x, y) for x, y in dpts]
    d_ground = elevations(d_ll)
    delaware = []
    for i, ((x, y), g) in enumerate(zip(dpts, d_ground)):
        delaware.append(add_node(f"DI{i + 1:02d}", x, y, max(g, 8.0), interceptor="Delaware"))
    # The last one is the plant's diversion chamber.
    nodes[delaware[-1]]["id"] = delaware[-1]
    print(f"Pennypack interceptor {len(penny)} manholes, Delaware interceptor {len(delaware)} (route {sum(math.dist(route[i], route[i + 1]) for i in range(len(route) - 1)) / 5280:.1f} mi)")

    main = penny + delaware
    main_flow = {k: {"dwf": 0.0, "pop": 0.0, "acres": 0.0} for k in main}
    for r in root_ids:
        tgt = conn[r]
        for k in ("dwf", "pop", "acres"):
            main_flow[tgt][k] += acc[r][k]
    for lid, _name, pop, acres, where, at in lumped:
        if where == "penny":
            tgt = min(penny, key=lambda k: abs(TO_LL.transform(nodes[k]["x"], nodes[k]["y"])[1] - at))
        else:
            tgt = min(delaware, key=lambda k: abs(TO_LL.transform(nodes[k]["x"], nodes[k]["y"])[0] - at))
        main_flow[tgt]["dwf"] += pop * GPCD * 1.08 / 1e6
        main_flow[tgt]["pop"] += pop
        main_flow[tgt]["acres"] += acres
        x, y = nodes[tgt]["x"], nodes[tgt]["y"]
        # The trunk comes in from inland (north-west of the river).
        tx, ty = x - 900, y + 700
        lon, lat = TO_LL.transform(tx, ty)
        tg = elevations([(lon, lat)])[0]
        add_node(f"{lid}_TRUNK", tx, ty, tg, lumped=(lid, _name, pop, acres), joins=tgt)

    # Interceptor inverts: follow the ground down (10 ft under the creek bed,
    # 12 ft under the streets), never flatter than the minimum, and below every
    # sewer that joins it.
    cum = {"dwf": 0.0, "pop": 0.0, "acres": 0.0}
    main_size: dict[str, int] = {}
    prev_inv = None
    prev_xy = None
    lowest_joining: dict[str, float] = defaultdict(lambda: math.inf)
    for r in root_ids:
        if r == ps_root:
            continue
        tgt = conn[r]
        L = math.dist((nodes[r]["x"], nodes[r]["y"]), (nodes[tgt]["x"], nodes[tgt]["y"]))
        s = size_for(design_cfs(acc[r]), 0.002)
        lowest_joining[tgt] = min(lowest_joining[tgt], invert[r] - MIN_SLOPE[s] * L)
    for k in main:
        for f in ("dwf", "pop", "acres"):
            cum[f] += main_flow[k][f]
        q = design_cfs(cum)
        depth_under = 10 if nodes[k].get("interceptor") == "Pennypack" else 12
        want = nodes[k]["ground"] - depth_under
        if prev_inv is not None:
            L = math.dist(prev_xy, (nodes[k]["x"], nodes[k]["y"]))
            size = size_for(q, 0.0004, smallest=main_size.get(main[main.index(k) - 1], 24))
            want = min(want, prev_inv - max(MIN_SLOPE[size], 0.0005) * L)
            main_size[k] = size
        else:
            main_size[k] = size_for(q, 0.001, smallest=24)
        want = min(want, lowest_joining[k] - 0.5) if lowest_joining[k] < math.inf else want
        invert[k] = round(want, 2)
        prev_inv, prev_xy = invert[k], (nodes[k]["x"], nodes[k]["y"])
    peak_cfs = design_cfs(cum) * 0.85
    print(f"Plant: {cum['pop']:,.0f} people, average dry-weather {cum['dwf']:.1f} MGD, design peak {peak_cfs / MGD_CFS:.0f} MGD")

    # ---------------------------------------------------------- assemble links
    def pipe(lid: str, a: str, b: str, d_in: int, n_: float = N_PIPE, geom: list | None = None, shape: str = "CIRCULAR") -> None:
        L = max(math.dist((nodes[a]["x"], nodes[a]["y"]), (nodes[b]["x"], nodes[b]["y"])), 15.0)
        if geom:
            L = max(L, sum(math.dist(p, q) for p, q in zip([(nodes[a]["x"], nodes[a]["y"])] + geom, geom + [(nodes[b]["x"], nodes[b]["y"])])))
        links.append({"id": lid, "kind": "conduit", "from": a, "to": b, "length": round(L, 1), "n": n_, "d": d_in, "shape": shape})
        if geom:
            vertices[lid] = geom

    # Branches with no flow that would need a lift are left out.
    dead_all: set[str] = set()
    st_ = list(dead)
    while st_:
        v = st_.pop()
        dead_all.add(v)
        st_ += tree_children.get(v, [])
    for v in dead_all:
        nodes.pop(v, None)
    for key_ in [k_ for k_ in pipe_size if k_[0] in dead_all or k_[1] in dead_all]:
        del pipe_size[key_]
    k = 0
    lifted = set(lifts)
    for (a, b), s in pipe_size.items():
        if (a, b) in lifted:
            continue
        k += 1
        pipe(f"S{k:04d}", a, b, s, geom=pipe_geom.get((a, b)) or None)
    # Lift stations: the low manhole flows into a wet well beside it, two pumps
    # (one standby) start and stop on its level, and a force main climbs to the
    # manhole uphill where gravity takes over again.
    for i, (a, b) in enumerate(lifts):
        ls = f"LS{i + 1:02d}"
        q = design_cfs(acc[a]) * 1.25 / MGD_CFS
        ax, ay = nodes[a]["x"], nodes[a]["y"]
        ww_inv = invert[a] - 5.0
        add_node(f"{ls}_WW", ax + 25, ay - 25, nodes[a]["ground"], kind="storage", invert=ww_inv, depth=round(nodes[a]["ground"] - ww_inv, 1), area=120)
        pipe(f"{ls}_INLET", a, f"{ls}_WW", max(pipe_size[(a, b)], 8))
        lift = invert[b] - ww_inv + 8
        curves[f"{ls}_CURVE"] = ("PUMP3", [(round(lift * 0.6, 1), round(q * 1.3, 3)), (round(lift, 1), round(q, 3)), (round(lift * 1.35, 1), 0.0)])
        add_node(f"{ls}_DIS", ax + 50, ay - 10, nodes[a]["ground"], invert=ww_inv + 1)
        for j in (1, 2):
            on, off = (3.0, 1.0) if j == 1 else (5.0, 2.0)
            links.append({"id": f"{ls}_P{j}", "kind": "pump", "from": f"{ls}_WW", "to": f"{ls}_DIS", "curve": f"{ls}_CURVE", "on": on, "off": off})
        L = math.dist((ax, ay), (nodes[b]["x"], nodes[b]["y"]))
        links.append({"id": f"{ls}_FM", "kind": "conduit", "from": f"{ls}_DIS", "to": b, "length": round(max(L, 30) * 1.1, 1), "n": 120, "d": 6 if q < 0.5 else 8, "shape": "FORCE_MAIN"})
    globals()["LIFTS"] = lifts
    # Connections to the interceptor (except the pumped area).
    for r in root_ids:
        tgt = conn[r]
        if r == ps_root:
            continue
        s = max(size_for(design_cfs(acc[r]), 0.002), 8)
        pipe(f"C_{r}", r, tgt, s)
    # The pump station.
    wx, wy = nodes[ps_root]["x"] + 60, nodes[ps_root]["y"] - 40
    ww_ground = nodes[ps_root]["ground"]
    add_node("PS_BUSTLETON_WW", wx, wy, ww_ground, kind="storage", invert=invert[ps_root] - 6, depth=ww_ground - (invert[ps_root] - 6), area=600)
    pipe(f"C_{ps_root}", ps_root, "PS_BUSTLETON_WW", max(size_for(design_cfs(acc[ps_root]), 0.003), 10))
    # The force main runs up the valley to an interceptor manhole two upstream of the nearest.
    # The force main crosses the creek (over it, on the bridge) to the interceptor
    # on the far bank, discharging a few feet under the ground there.
    fm_to = conn[ps_root]
    ww_inv_ps = nodes["PS_BUSTLETON_WW"]["invert"]
    g_to = nodes[fm_to]["ground"]
    fm_L = math.dist((wx, wy), (nodes[fm_to]["x"], nodes[fm_to]["y"])) * 1.3 + 60
    ps_peak = design_cfs(acc[ps_root]) / MGD_CFS
    fm_d = 6 if ps_peak < 0.4 else 8 if ps_peak < 0.8 else 10 if ps_peak < 1.3 else 12
    add_node("PS_BUSTLETON_DIS", wx + 30, wy + 30, max(ww_ground, g_to + 12), invert=ww_inv_ps + 1)
    links.append({"id": "FM_BUSTLETON", "kind": "conduit", "from": "PS_BUSTLETON_DIS", "to": fm_to, "length": round(fm_L, 1), "n": 120, "d": fm_d, "shape": "FORCE_MAIN", "out_elev": round(invert[fm_to] + 1, 2)})
    lift_to = invert[fm_to] + 1
    ps_flow = round(ps_peak * 1.3, 3)
    # A low-lift station: the force main carries the branch across the creek
    # under pressure; the pumps mostly overcome friction.
    ps_head = round(max(lift_to - ww_inv_ps + 6, 6.0), 1)
    curves["PS_BUSTLETON_CURVE"] = ("PUMP3", [(0.0, round(ps_flow * 1.5, 3)), (ps_head, ps_flow), (round(ps_head * 2.0, 1), 0.0)])
    for i in (1, 2):
        links.append({"id": f"P_BUSTLETON_{i}", "kind": "pump", "from": "PS_BUSTLETON_WW", "to": "PS_BUSTLETON_DIS", "curve": "PS_BUSTLETON_CURVE"})

    # Interceptor pipes.
    for i, (a, b) in enumerate(zip(penny, penny[1:])):
        pipe(f"PI{i + 1:02d}-{i + 2:02d}", a, b, main_size[b], geom=seg_pts[i] or None)
    pipe("PI-DI", penny[-1], delaware[0], main_size[delaware[0]])
    for i, (a, b) in enumerate(zip(delaware, delaware[1:])):
        pipe(f"DI{i + 1:02d}-{i + 2:02d}", a, b, main_size[b])
    for lid, _name, pop, acres, *_ in lumped:
        t = f"{lid}_TRUNK"
        tgt = nodes[t]["joins"]
        q = (pop * GPCD * 1.08 / 1e6) * harmon(pop) * MGD_CFS + acres * 4000 / 1e6 * MGD_CFS
        s = size_for(q, 0.0015, smallest=30)
        invert[t] = round(max(invert[tgt] + 1.5, nodes[t]["ground"] - 14), 2)  # drops into the interceptor
        pipe(f"{lid}_TRUNK_PIPE", t, tgt, s)

    # ---------------------------------------------------------- the plant
    dc = delaware[-1]  # diversion chamber
    px, py = nodes[dc]["x"], nodes[dc]["y"]
    g_plant = nodes[dc]["ground"]
    ww_inv = invert[dc] - 8
    add_node("WPCP_WETWELL", px + 250, py - 120, g_plant, kind="storage", invert=ww_inv, depth=round(g_plant - ww_inv, 1), area=18000)
    add_node("EQ_BASIN", px - 150, py - 480, g_plant, kind="storage", invert=invert[dc] - 2, depth=26.0, area=0, curve="EQ_BASIN_CURVE")
    add_node("WPCP_HEADWORKS", px + 520, py - 260, g_plant + 25, kind="outfall", invert=g_plant + 22)
    add_node("OF_RELIEF_DELAWARE", px + 380, py + 380, 6.0, kind="outfall", invert=-2.0)
    pipe("DC-WETWELL", dc, "WPCP_WETWELL", main_size[dc], n_=0.013)
    # Basin: about 6 million gallons when full.
    curves["EQ_BASIN_CURVE"] = ("STORAGE", [(0, 30000), (10, 34000), (20, 38000), (26, 40000)])
    peak_plant = peak_cfs
    pumps = [(1, 8.0, 5.0), (2, 13.0, 9.0), (3, 18.0, 13.0), (4, 23.0, 17.0)]
    head = round((g_plant + 22) - ww_inv + 12, 1)
    q_each = round(peak_plant / MGD_CFS / 2.6, 1)  # MGD: three duty pumps carry the design peak, one stands by
    curves["WPCP_PUMP_CURVE"] = ("PUMP3", [(round(head * 0.6, 1), round(q_each * 1.3, 2)), (head, q_each), (round(head * 1.35, 1), 0.0)])
    # The pumps lift into a discharge header that flows on to the headworks.
    add_node("WPCP_HEADER", px + 420, py - 200, g_plant + 30, invert=g_plant + 22.5)
    for i, _on, _off in pumps:
        links.append({"id": f"P_WPCP_{i}", "kind": "pump", "from": "WPCP_WETWELL", "to": "WPCP_HEADER", "curve": "WPCP_PUMP_CURVE"})
    links.append({"id": "WPCP_TO_HEADWORKS", "kind": "conduit", "from": "WPCP_HEADER", "to": "WPCP_HEADWORKS", "length": 120.0, "n": 0.013, "d": 72, "shape": "CIRCULAR"})
    globals()["PLANT_INFO"] = {"head": head, "q_each": q_each, "ww_inv": ww_inv, "dc": dc}
    # Side weir to the basin, and the basin's drain gate back to the wet well.
    links.append({"id": "W_EQ_INFLOW", "kind": "weir", "from": dc, "to": "EQ_BASIN", "crest": round(main_size[dc] / 12 * 0.45, 2), "length": 30.0})
    links.append({"id": "G_EQ_DRAIN", "kind": "orifice", "from": "EQ_BASIN", "to": "WPCP_WETWELL", "offset": 0.0, "h": 3.0, "w": 3.0})
    links.append({"id": "W_RELIEF", "kind": "weir", "from": "WPCP_WETWELL", "to": "OF_RELIEF_DELAWARE", "crest": round(g_plant - ww_inv - 4, 1), "length": 20.0})

    globals()["PS_INFO"] = {"root": ps_root, "head": ps_head, "flow": ps_flow, "ww_depth": nodes["PS_BUSTLETON_WW"]["depth"]}
    for nid, inv in invert.items():
        if nid in nodes and nodes[nid]["kind"] == "junction" and "invert" not in nodes[nid]:
            nodes[nid]["invert"] = inv
    # Pipes leave each manhole at its invert, so offsets keep crowns sensible.
    globals()["ACC"] = acc
    globals()["LUMPED"] = lumped


def _root_of(v: str, down: dict[str, str]) -> str:
    while v in down:
        v = down[v]
    return v


curves: dict[str, tuple[str, list]] = {}


# ------------------------------------------------------------------- writing

PATTERNS = {
    # Typical residential sewage shape (two peaks), averaging 1.
    "DWF_WEEKDAY": ("HOURLY", [0.62, 0.48, 0.41, 0.38, 0.40, 0.52, 0.86, 1.32, 1.52, 1.42, 1.28, 1.18, 1.12, 1.07, 1.02, 0.99, 1.04, 1.16, 1.31, 1.36, 1.30, 1.16, 0.96, 0.78]),
    "DWF_WEEKEND": ("WEEKEND", [0.74, 0.58, 0.49, 0.44, 0.42, 0.43, 0.52, 0.72, 1.02, 1.34, 1.48, 1.44, 1.34, 1.24, 1.15, 1.10, 1.10, 1.15, 1.25, 1.30, 1.25, 1.14, 0.99, 0.84]),
    "DWF_DAILY": ("DAILY", [1.04, 0.98, 0.99, 0.99, 1.00, 0.98, 1.02]),
    "DWF_MONTHLY": ("MONTHLY", [1.02, 1.02, 1.01, 1.00, 0.99, 0.98, 0.96, 0.96, 0.99, 1.01, 1.02, 1.04]),
    # Groundwater is highest in late winter and spring.
    "GWI_MONTHLY": ("MONTHLY", [1.15, 1.25, 1.45, 1.40, 1.15, 0.90, 0.70, 0.62, 0.68, 0.80, 0.92, 1.03]),
}


def norm(f: list[float]) -> list[float]:
    m = sum(f) / len(f)
    return [round(v / m, 3) for v in f]


TYPE2 = [(0, 0), (2, 0.022), (4, 0.048), (6, 0.080), (7, 0.098), (8, 0.120), (8.5, 0.133), (9, 0.147), (9.5, 0.163), (9.75, 0.172), (10, 0.181), (10.5, 0.204), (11, 0.235), (11.5, 0.283), (11.75, 0.357), (12, 0.663), (12.5, 0.735), (13, 0.772), (13.5, 0.799), (14, 0.820), (16, 0.880), (20, 0.952), (24, 1.0)]


def type2(h: float) -> float:
    for (h0, f0), (h1, f1) in zip(TYPE2, TYPE2[1:]):
        if h <= h1:
            return f0 + (f1 - f0) * (h - h0) / (h1 - h0)
    return 1.0


def rain_rows(total_in: float = 3.26, step_min: int = 15) -> list[str]:
    rows = []
    n = 24 * 60 // step_min
    for i in range(n):
        h0 = i * step_min / 60
        h1 = (i + 1) * step_min / 60
        depth = total_in * (type2(h1) - type2(h0))
        inten = depth * 60 / step_min
        hh, mm = divmod(i * step_min, 60)
        rows.append(f"RAIN_2YR          06/01/2024  {hh:02d}:{mm:02d}      {inten:.4f}")
    rows.append("RAIN_2YR          06/02/2024  00:00      0.0000")
    return rows


def pad(v: object, width: int) -> str:
    t = str(v)
    return t + " " * max(1, width - len(t))


def fmt(v: float, d: int = 3) -> str:
    return f"{v:.{d}f}"


def write_inp(path: Path, rdii_scale: float = 1.0, title_extra: str = "") -> None:
    L: list[str] = []
    w = L.append
    w("[TITLE]\n;;Project Title/Notes")
    w("Northeast Philadelphia separate sanitary sewer system: demo model")
    w("Bustleton collection system -> Pennypack Creek interceptor -> Delaware interceptor -> Northeast WPCP (Bridesburg).")
    w("Streets, parcels and creek: City of Philadelphia open data. Ground: USGS 3DEP lidar. Plant site: PWD parcel, 3899 Richmond St.")
    w("Pipes, pump stations, basin and flows are ASSUMED for the demo; this is not PWD's system.")
    w("Holmesburg, Tacony and Mayfair join as lumped trunks. Storm: NOAA Atlas 14 2-year 24-hour (3.26 in), NRCS Type II.")
    if title_extra:
        w(title_extra)
    w("")
    w("""[OPTIONS]
;;Option             Value
FLOW_UNITS           MGD
INFILTRATION         HORTON
FLOW_ROUTING         DYNWAVE
LINK_OFFSETS         ELEVATION
FORCE_MAIN_EQUATION  H-W
MIN_SLOPE            0
ALLOW_PONDING        NO
SKIP_STEADY_STATE    NO
START_DATE           05/31/2024
START_TIME           00:00:00
REPORT_START_DATE    05/31/2024
REPORT_START_TIME    00:00:00
END_DATE             06/03/2024
END_TIME             00:00:00
SWEEP_START          01/01
SWEEP_END            12/31
DRY_DAYS             3
REPORT_STEP          00:15:00
WET_STEP             00:05:00
DRY_STEP             01:00:00
ROUTING_STEP         0:00:10
RULE_STEP            00:01:00
INERTIAL_DAMPING     PARTIAL
NORMAL_FLOW_LIMITED  BOTH
VARIABLE_STEP        0.75
LENGTHENING_STEP     0
MIN_SURFAREA         12.566
MAX_TRIALS           8
HEAD_TOLERANCE       0.005
SYS_FLOW_TOL         5
LAT_FLOW_TOL         5
MINIMUM_STEP         0.5
THREADS              4
""")
    w("[EVAPORATION]\n;;Data Source    Parameters\nCONSTANT         0.0\nDRY_ONLY         NO\n")
    w("[RAINGAGES]\n;;Name           Format    Interval SCF      Source")
    w("RG_NORTHEAST     INTENSITY 0:15     1.0      TIMESERIES RAIN_2YR\n")

    juncs = [n for n in nodes.values() if n["kind"] == "junction"]
    w("[JUNCTIONS]\n;;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded")
    for n in juncs:
        inv = n["invert"]
        w(f"{pad(n['id'], 17)}{pad(fmt(inv, 2), 11)}{pad(fmt(max(n['ground'] - inv, 4.0), 2), 11)}0          0          0")
    w("")
    w("[OUTFALLS]\n;;Name           Elevation  Type       Stage Data       Gated    Route To")
    for n in nodes.values():
        if n["kind"] == "outfall":
            gated = "YES" if n["id"].startswith("OF_RELIEF") else "NO"
            w(f"{pad(n['id'], 20)}{pad(fmt(n['invert'], 2), 11)}FREE                        {gated}")
    w("")
    w("[STORAGE]\n;;Name           Elev.    MaxDepth   InitDepth  Shape      Curve Type/Params            SurDepth  Fevap    Psi      Ksat     IMD")
    for n in nodes.values():
        if n["kind"] == "storage":
            if n.get("curve"):
                w(f"{pad(n['id'], 17)}{pad(fmt(n['invert'], 2), 9)}{pad(fmt(n['depth'], 1), 11)}0          TABULAR    {pad(n['curve'], 29)}0         0")
            else:
                w(f"{pad(n['id'], 17)}{pad(fmt(n['invert'], 2), 9)}{pad(fmt(n['depth'], 1), 11)}0          FUNCTIONAL 0         0         {pad(n['area'], 8)}0         0")
    w("")
    w("[CONDUITS]\n;;Name              From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow")
    inv_of = lambda nid: nodes[nid]["invert"]  # noqa: E731
    for l in links:
        if l["kind"] != "conduit":
            continue
        a, b = l["from"], l["to"]
        # Elevation offsets: the pipe leaves at the upstream invert and arrives at the downstream invert (or above it).
        in_off = inv_of(a)
        out_off = l.get("out_elev", inv_of(b))
        if l["shape"] != "FORCE_MAIN" and out_off >= in_off:
            # A gravity pipe never runs uphill: drop it into the manhole instead.
            out_off = max(inv_of(b), in_off - 0.0005 * l["length"])
        w(f"{pad(l['id'], 20)}{pad(a, 17)}{pad(b, 17)}{pad(fmt(l['length'], 1), 11)}{pad(l['n'], 11)}{pad(fmt(in_off, 2), 11)}{pad(fmt(out_off, 2), 11)}0          0")
    w("")
    w("[PUMPS]\n;;Name              From Node        To Node          Pump Curve        Status   Sartup Shutoff")
    for l in links:
        if l["kind"] == "pump":
            w(f"{pad(l['id'], 20)}{pad(l['from'], 17)}{pad(l['to'], 17)}{pad(l['curve'], 18)}OFF      {l.get('on', 0)}      {l.get('off', 0)}")
    w("")
    w("[ORIFICES]\n;;Name              From Node        To Node          Type         Offset     Qcoeff     Gated    CloseTime")
    for l in links:
        if l["kind"] == "orifice":
            w(f"{pad(l['id'], 20)}{pad(l['from'], 17)}{pad(l['to'], 17)}SIDE         {pad(fmt(nodes[l['from']]['invert'], 2), 11)}0.65       YES      0.5")
    w("")
    w("[WEIRS]\n;;Name              From Node        To Node          Type         CrestHt    Qcoeff     Gated    EndCon   EndCoeff   Surcharge  RoadWidth  RoadSurf")
    for l in links:
        if l["kind"] == "weir":
            crest = nodes[l["from"]]["invert"] + l["crest"]
            w(f"{pad(l['id'], 20)}{pad(l['from'], 17)}{pad(l['to'], 17)}SIDEFLOW     {pad(fmt(crest, 2), 11)}3.0        YES      0        0          YES")
    w("")
    w("[XSECTIONS]\n;;Link              Shape        Geom1            Geom2      Geom3      Geom4      Barrels    Culvert")
    for l in links:
        if l["kind"] == "conduit":
            d = l["d"] / 12
            if l["shape"] == "FORCE_MAIN":
                w(f"{pad(l['id'], 20)}FORCE_MAIN   {pad(fmt(d, 3), 17)}120        0          0          1")
            else:
                w(f"{pad(l['id'], 20)}CIRCULAR     {pad(fmt(d, 3), 17)}0          0          0          1")
        elif l["kind"] == "orifice":
            w(f"{pad(l['id'], 20)}RECT_CLOSED  {pad(fmt(l['h'], 2), 17)}{pad(fmt(l['w'], 2), 11)}0          0")
        elif l["kind"] == "weir":
            w(f"{pad(l['id'], 20)}RECT_OPEN    {pad(fmt(3.0, 2), 17)}{pad(fmt(l['length'], 2), 11)}0          0")
    w("")
    w("[LOSSES]\n;;Link              Kentry     Kexit      Kavg       Flap Gate  Seepage")
    for l in links:
        if l["kind"] == "conduit" and l["shape"] == "FORCE_MAIN":
            w(f"{pad(l['id'], 20)}0.5        1.0        0.2        NO         0")
    w("")

    # Curves
    w("[CURVES]\n;;Name              Type       X-Value    Y-Value")
    for cid, (ctype, pts) in curves.items():
        for i, (x, y) in enumerate(pts):
            w(f"{pad(cid, 20)}{pad(ctype if i == 0 else '', 11)}{pad(x, 11)}{y}")
    w("")
    # Time series
    w("[TIMESERIES]\n;;Name           Date       Time       Value")
    for row in rain_rows():
        w(row)
    w("")
    w("[PATTERNS]\n;;Name           Type       Multipliers")
    for pid, (ptype, f) in PATTERNS.items():
        f = norm(f)
        for i in range(0, len(f), 6):
            w(f"{pad(pid, 17)}{pad(ptype if i == 0 else '', 11)}{' '.join(f'{v:.3f}' for v in f[i:i + 6])}")
    w("")

    # Dry-weather flow, groundwater infiltration and RDII.
    w("[DWF]\n;;Node           Constituent      Baseline   Patterns")
    for n in nodes.values():
        if n["dwf"] > 0:
            w(f"{pad(n['id'], 17)}FLOW             {n['dwf']:.6f}   \"DWF_MONTHLY\" \"DWF_DAILY\" \"DWF_WEEKDAY\" \"DWF_WEEKEND\"")
    for lid, _name, pop, acres, *_ in LUMPED:
        w(f"{pad(lid + '_TRUNK', 17)}FLOW             {pop * GPCD * 1.08 / 1e6:.4f}     \"DWF_MONTHLY\" \"DWF_DAILY\" \"DWF_WEEKDAY\" \"DWF_WEEKEND\"")
    w("")
    w("[INFLOWS]\n;;Node           Constituent      Time Series      Type     Mfactor  Sfactor  Baseline Pattern")
    for n in nodes.values():
        if n["acres"] > 0:
            w(f"{pad(n['id'], 17)}FLOW             \"\"               FLOW     1.0      1.0      {n['acres'] * GWI_GPAD / 1e6:.6f} GWI_MONTHLY")
    for lid, _name, pop, acres, *_ in LUMPED:
        w(f"{pad(lid + '_TRUNK', 17)}FLOW             \"\"               FLOW     1.0      1.0      {acres * GWI_GPAD * 1.3 / 1e6:.4f}   GWI_MONTHLY")
    w("")
    w("[HYDROGRAPHS]\n;;Hydrograph     Rain Gage/Month  Response R        T        K        Dmax     Drecov   Dinit")
    uhs = {
        # Newer sewers (1950s-70s), mostly tight: little fast inflow.
        "UH_BUSTLETON": {"ALL": [(0.008, 0.75, 1.5), (0.009, 3.0, 3.0), (0.012, 10.0, 5.0)], "SPRING": [(0.011, 0.75, 1.5), (0.013, 3.0, 3.0), (0.020, 10.0, 5.0)]},
        # Older trunks with more leaks and connected drains.
        "UH_OLDER_TRUNKS": {"ALL": [(0.012, 1.0, 2.0), (0.012, 4.0, 3.0), (0.016, 12.0, 5.0)], "SPRING": [(0.016, 1.0, 2.0), (0.017, 4.0, 3.0), (0.026, 12.0, 5.0)]},
    }
    for uid, sets in uhs.items():
        w(f"{pad(uid, 17)}RG_NORTHEAST")
        for month, rows in (("ALL", sets["ALL"]), ("MAR", sets["SPRING"]), ("APR", sets["SPRING"]), ("MAY", sets["SPRING"])):
            for resp, (r, t, kk) in zip(("SHORT", "MEDIUM", "LONG"), rows):
                ia = "  0.3      0.05     0.0" if resp == "LONG" else ""
                w(f"{pad(uid, 17)}{pad(month, 17)}{pad(resp, 9)}{r * rdii_scale if uid == 'UH_BUSTLETON' else r:<9.4f}{pad(t, 9)}{pad(kk, 9)}{ia}")
    w("")
    w("[RDII]\n;;Node           Unit Hydrograph  Sewer Area")
    for n in nodes.values():
        if n["acres"] > 0:
            w(f"{pad(n['id'], 17)}UH_BUSTLETON     {n['acres']:.2f}")
    for lid, _name, pop, acres, *_ in LUMPED:
        w(f"{pad(lid + '_TRUNK', 17)}UH_OLDER_TRUNKS  {acres:.1f}")
    w("")

    # Control rules.
    pi = PLANT_INFO
    ps = PS_INFO
    lvl = lambda f: round((pi["ww_inv"] and 0) + f, 1)  # noqa: E731
    w("[CONTROLS]")
    w(";; Plant influent pump station: lead, lag and lag-lag pumps by wet-well level, a standby for the highest levels.")
    stages = [(1, 7.0, 3.0), (2, 11.0, 7.5), (3, 15.0, 11.5), (4, 20.0, 16.0)]
    for i, on, off in stages:
        w(f"RULE WPCP_P{i}_ON\nIF NODE WPCP_WETWELL DEPTH > {lvl(on)}\nTHEN PUMP P_WPCP_{i} STATUS = ON\nPRIORITY 2\n")
        w(f"RULE WPCP_P{i}_OFF\nIF NODE WPCP_WETWELL DEPTH < {lvl(off)}\nTHEN PUMP P_WPCP_{i} STATUS = OFF\nPRIORITY 1\n")
    w(";; Bustleton pump station: duty pump, with the standby joining if the level keeps rising.")
    d = ps["ww_depth"]
    w(f"RULE BUSTLETON_DUTY_ON\nIF NODE PS_BUSTLETON_WW DEPTH > {round(min(5.0, d * 0.35), 1)}\nTHEN PUMP P_BUSTLETON_1 STATUS = ON\nPRIORITY 2\n")
    w(f"RULE BUSTLETON_DUTY_OFF\nIF NODE PS_BUSTLETON_WW DEPTH < {round(min(1.5, d * 0.1), 1)}\nTHEN PUMP P_BUSTLETON_1 STATUS = OFF\nPRIORITY 1\n")
    w(f"RULE BUSTLETON_STANDBY_ON\nIF NODE PS_BUSTLETON_WW DEPTH > {round(min(8.0, d * 0.55), 1)}\nTHEN PUMP P_BUSTLETON_2 STATUS = ON\nPRIORITY 2\n")
    w(f"RULE BUSTLETON_STANDBY_OFF\nIF NODE PS_BUSTLETON_WW DEPTH < {round(min(3.0, d * 0.2), 1)}\nTHEN PUMP P_BUSTLETON_2 STATUS = OFF\nPRIORITY 1\n")
    w(";; Equalization basin: drain it back only when the plant's wet well is low, and close the gate when it rises.")
    w("RULE EQ_DRAIN_OPEN\nIF NODE WPCP_WETWELL DEPTH < 8\nAND NODE EQ_BASIN DEPTH > 0.2\nTHEN ORIFICE G_EQ_DRAIN SETTING = 0.4\nPRIORITY 2\n")
    w("RULE EQ_DRAIN_CLOSE\nIF NODE WPCP_WETWELL DEPTH > 11\nTHEN ORIFICE G_EQ_DRAIN SETTING = 0\nPRIORITY 3\n")
    w("")

    w("[REPORT]\n;;Reporting Options\nSUBCATCHMENTS ALL\nNODES ALL\nLINKS ALL\n")
    w("[TAGS]")
    for n in nodes.values():
        if n["kind"] == "storage" or n["id"].endswith("_TRUNK"):
            w(f"Node       {pad(n['id'], 17)}{'PumpStation' if 'WW' in n['id'] or 'WETWELL' in n['id'] else 'Lumped' if n['id'].endswith('_TRUNK') else 'Storage'}")
    w("")
    w("[MAP]\nDIMENSIONS 0 0 10000 10000\nUnits      Feet\n")
    w("[COORDINATES]\n;;Node           X-Coord            Y-Coord")
    for n in nodes.values():
        w(f"{pad(n['id'], 17)}{n['x']:<19.3f}{n['y']:.3f}")
    w("")
    w("[VERTICES]\n;;Link           X-Coord            Y-Coord")
    for lid, pts in vertices.items():
        for x, y in pts:
            w(f"{pad(lid, 17)}{x:<19.3f}{y:.3f}")
    w("")
    w("[SYMBOLS]\n;;Gage           X-Coord            Y-Coord")
    gx = sum(n["x"] for n in nodes.values()) / len(nodes)
    gy = sum(n["y"] for n in nodes.values()) / len(nodes)
    w(f"RG_NORTHEAST     {gx:<19.3f}{gy:.3f}\n")
    path.write_text("\n".join(L) + "\n")


def run(inp: Path) -> None:
    from pyswmm import Simulation

    with Simulation(str(inp)) as sim:
        for _ in sim:
            pass


GIS_LAYERS = (
    ("pennypack_creek.geojson", "Pennypack Creek", True, {"color": "#38bdf8", "line_width": 2.5}),
    ("historic_streams.geojson", "Buried streams (1842 survey)", False, {"color": "#a78bfa", "line_width": 1.5}),
)


def gis() -> None:
    """Background layers: the viewer's GeoJSON files and the app project's registered layers."""
    vg = VIEWER / "gis"
    vg.mkdir(parents=True, exist_ok=True)
    for fname, *_ in GIS_LAYERS:
        shutil.copy(SRC / fname, vg / fname)
    from app.services.gis_service import gis_service
    from app.services.project_service import project_service

    shutil.rmtree(OUT / "gis", ignore_errors=True)
    project_service.open_project(str(OUT))
    for fname, name, visible, style in GIS_LAYERS:
        layer = gis_service.ingest_vector(str(vg / fname), name=name)
        gis_service.patch_layer(layer["id"], {"visible": visible, "style": style})
    man_p = OUT / "gis" / "layers.json"
    man = json.loads(man_p.read_text(encoding="utf-8"))
    for layer in man["layers"]:
        layer.pop("source_path", None)  # machine-specific
    man_p.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")


def storms() -> None:
    """10- and 100-year design storms in the app example's storm library, on the same day."""
    from app.services.project_service import project_service
    from app.services.storm_service import storm_service

    shutil.rmtree(OUT / "storms", ignore_errors=True)
    project_service.open_project(str(OUT))
    for rp, depth in ((10, 4.82), (100, 7.70)):
        rows = []
        for k in range(24 * 12):
            d = depth * (type2((k + 1) / 12) - type2(k / 12))
            m = k * 5
            rows.append(f"STORM 2024 6 1 {m // 60} {m % 60} {d:.4f}")
        storm_service.create(
            f"{rp}-year 24-hour", "\n".join(rows), fmt="VOLUME", interval="0:05", units="IN", after_hours=24,
            return_period=rp, duration_hr=24, note=f"NOAA Atlas 14 {rp}-year 24-hour {depth} in, NRCS Type II",
        )


def viewer_files() -> None:
    VIEWER.mkdir(parents=True, exist_ok=True)
    stem = "philly-sanitary"
    shutil.copy(OUT / f"{NAME}.inp", VIEWER / f"{stem}.inp")
    for src, dst in ((OUT, stem), (OUT / "scenarios" / "rehab", f"{stem}-rehab")):
        for ext in ("rpt", "out"):
            shutil.copy(src / f"{NAME}.{ext}", VIEWER / f"{dst}.{ext}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    build()
    inp = OUT / f"{NAME}.inp"
    write_inp(inp)
    nj = sum(1 for n in nodes.values() if n["kind"] == "junction")
    print(f"wrote {inp.name}: {nj} junctions, {sum(1 for l in links if l['kind'] == 'conduit')} conduits, {sum(1 for l in links if l['kind'] == 'pump')} pumps")
    if "--no-run" not in sys.argv:
        run(inp)
        print("ran base")
    # Scenario: Bustleton's sewers lined, RDII down 40 %.
    sc = OUT / "scenarios" / "rehab"
    sc.mkdir(parents=True, exist_ok=True)
    write_inp(sc / f"{NAME}.inp", rdii_scale=0.6, title_extra="Scenario: Bustleton sewers lined and laterals repaired (Bustleton RDII 40 % lower).")
    if "--no-run" not in sys.argv:
        run(sc / f"{NAME}.inp")
        print("ran rehab")
    (OUT / "scenarios.json").write_text(
        json.dumps(
            {
                "version": 1,
                "scenarios": [
                    {"id": "base", "name": "Existing system", "parent": None, "inp": f"{NAME}.inp", "created": "2026-11-24T00:00:00+00:00", "description": "The sewers as they are, with the 2-year storm."},
                    {"id": "s-rehab", "name": "Bustleton I/I reduction", "parent": "base", "inp": f"scenarios/rehab/{NAME}.inp", "created": "2026-11-24T00:00:00+00:00", "description": "Bustleton's sewers lined and laterals repaired: its rainfall-derived infiltration and inflow 40 % lower."},
                ],
            },
            indent=2,
        )
    )
    (OUT / ".saturday-swmm.json").write_text(json.dumps({"crs": "EPSG:2272"}, indent=2) + "\n")
    gis()
    storms()
    viewer_files()
    print("packaged: app example, storms, GIS layers, viewer files")


if __name__ == "__main__":
    main()
