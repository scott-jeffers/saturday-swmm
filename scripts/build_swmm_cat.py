"""Build the SWMM-CAT climate data the Rainfall / Rain gages pages read.

Source: the station tables of SWMM-CAT Online
(https://github.com/scott-jeffers/swmm-cat-online, netlify/functions), which
come from EPA's SWMM-CAT 1.1 / CREAT 3.1 (CMIP5, RCP 8.5) data.

Writes frontend/public/swmm-cat/:
  index.json      every station: [id, lat, lon, has_evaporation]
  d/NN.json       station data in chunks of CHUNK stations, by index order

Per station (all monthly arrays are year (2035, 2060) x scenario
(HotDry, Central, WetWarm) x 12 months, flattened):
  t  temperature change, deg F
  p  rainfall change, percent
  e  evaporation change (scenario minus historical Hargreaves), in/day, or null
  g  24-hour design storm depths, mm, return periods RP:
     historical, 2035 stormy, 2035 less stormy, 2060 stormy, 2060 less stormy

Usage: python scripts/build_swmm_cat.py /path/to/swmm-cat-online/netlify/functions
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

YEARS = [2035, 2060]
SCENARIOS = ["HotDry", "Central", "WetWarm"]
RP = [5, 10, 15, 30, 50, 100]
CHUNK = 100

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "swmm-cat"


def table(path: Path, n: int) -> dict[str, list[float]]:
    rows: dict[str, list[float]] = {}
    lines = path.read_text(encoding="utf-8").splitlines()
    for ln in lines[1:]:
        cols = ln.strip().split("\t")
        if len(cols) < n + 1:
            continue
        try:
            rows[cols[0]] = [float(v) for v in cols[1 : n + 1]]
        except ValueError:
            continue
    return rows


def num(v: float, dp: int) -> float | int:
    r = round(v, dp)
    return int(r) if r == int(r) else r


def main(src: Path) -> None:
    stations = []
    for ln in (src / "precip.txt").read_text(encoding="utf-8").splitlines():
        cols = ln.split()
        if len(cols) >= 3:
            stations.append((cols[0], float(cols[1]), float(cols[2])))

    temp = {(y, s): table(src / f"TEMP{y}{s}.txt", 12) for y in YEARS for s in SCENARIOS}
    prec = {(y, s): table(src / f"PREC{y}{s}.txt", 12) for y in YEARS for s in SCENARIOS}
    het = {(y, s): table(src / f"HET_{y}{s}.txt", 12) for y in YEARS for s in SCENARIOS}
    het_hist = table(src / "HET_historical.txt", 12)
    gev = [table(src / "GEVdepth_historical.txt", 6)]
    for y in YEARS:
        gev.append(table(src / f"GEVdepth{y}Stormy.txt", 6))
        gev.append(table(src / f"GEVdepth{y}LessStormy.txt", 6))

    index = []
    data = []
    for sid, lat, lon in stations:
        try:
            t = [num(v, 2) for y in YEARS for s in SCENARIOS for v in temp[(y, s)][sid]]
            p = [num(v, 2) for y in YEARS for s in SCENARIOS for v in prec[(y, s)][sid]]
            g = [num(v, 2) for tab in gev for v in tab[sid]]
        except KeyError:
            continue
        e = None
        if sid in het_hist and all(sid in het[k] for k in het):
            h = het_hist[sid]
            e = [num(het[(y, s)][sid][m] - h[m], 4) for y in YEARS for s in SCENARIOS for m in range(12)]
        index.append([sid, lat, lon, 1 if e is not None else 0])
        data.append({"t": t, "p": p, "e": e, "g": g})

    (OUT / "d").mkdir(parents=True, exist_ok=True)
    for f in (OUT / "d").glob("*.json"):
        f.unlink()
    meta = {
        "v": 1,
        "chunk": CHUNK,
        "years": YEARS,
        "scenarios": SCENARIOS,
        "rp": RP,
        "source": "EPA SWMM-CAT 1.1 / CREAT 3.1 (CMIP5, RCP 8.5), via SWMM-CAT Online",
        "stations": index,
    }
    (OUT / "index.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    for i in range(0, len(data), CHUNK):
        (OUT / "d" / f"{i // CHUNK:02d}.json").write_text(
            json.dumps(data[i : i + CHUNK], separators=(",", ":")), encoding="utf-8"
        )
    print(f"{len(index)} stations, {sum(1 for s in index if s[3])} with evaporation, {(len(data) + CHUNK - 1) // CHUNK} chunks")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
