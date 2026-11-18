"""Record backend responses for the viewer golden tests.

    python scripts/make_viewer_golden.py <model.inp> <openswmm|pyswmm> <outdir>

Runs the model, then saves model.inp/.rpt/.out and every response the viewer
must reproduce to <outdir>/golden.json (see frontend/src/viewer/golden.test.ts).
"""
import json, shutil, sys, time, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fastapi.testclient import TestClient
from app.main import app

inp, engine, outdir = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
outdir.mkdir(parents=True, exist_ok=True)
H = {"X-Saturday-SWMM": "1"}
proj = Path(tempfile.mkdtemp()) / "proj"; proj.mkdir()
shutil.copy(inp, proj / "model.inp")
for f in inp.parent.glob("*.dat"): shutil.copy(f, proj / f.name)
c = TestClient(app, base_url="http://127.0.0.1:8000")
assert c.post("/api/projects/open", json={"path": str(proj)}, headers=H).status_code == 200
c.put("/api/projects/crs", json={"crs": "EPSG:25832"}, headers=H)
r = c.post("/api/runs", json={"simulation_engine": engine}, headers=H); assert r.status_code == 200, r.text
t0=time.time()
while c.get("/api/runs/current").json()["status"] == "running": time.sleep(0.2)
st = c.get("/api/runs/current").json(); print(engine, st["status"], round(time.time()-t0,1), "s")
G = {}
def get(path, **params):
    r = c.get(path, params=params); G[path + ("?" + "&".join(f"{k}={v}" for k, v in params.items()) if params else "")] = {"status": r.status_code, "json": r.json()}
    return r.json()
net = get("/api/model/network", crs="EPSG:25832")
feats = net["geojson"]["features"]
pick = {}
for f in feats:
    pick.setdefault(f["properties"]["object_type"], []).append(f["properties"]["id"])
for kind, ids in pick.items():
    for oid in ids[:3] + ids[-2:]:
        get(f"/api/model/objects/{kind}/{oid}")
get("/api/model/objects/node/__nope__")
secs = get("/api/model/sections")
for s in secs["sections"][:40]: get(f"/api/model/sections/{s['name']}")
get("/api/model/sections/CURVES"); get("/api/model/options"); get("/api/model/check"); get("/api/model/simulation-window")
get("/api/rpt/summary")
get("/api/out/metadata"); get("/api/out/nodes"); get("/api/out/links"); get("/api/out/subcatchments")
for k in ("node", "link", "subcatchment"): get("/api/out/variables", kind=k)
nodes = c.get("/api/out/nodes").json()["ids"]; links = c.get("/api/out/links").json()["ids"]; subs = c.get("/api/out/subcatchments").json()["ids"]
for v in ("depth", "head", "overflow", "total_inflow"):
    for n in nodes[:2] + nodes[-1:]: get(f"/api/out/nodes/{n}/series", variable=v)
for v in ("flow", "velocity", "capacity"):
    for l in links[:2]: get(f"/api/out/links/{l}/series", variable=v)
for v in ("runoff", "rainfall"):
    for s in subs[:2]: get(f"/api/out/subcatchments/{s}/series", variable=v)
per = get("/api/out/periods")
for p in (0, per["period_count"] // 2, per["period_count"] - 1): get("/api/out/snapshot", period=p)
get("/api/out/envelope")
# profile between first outfall and a far node
outs = [f["properties"]["id"] for f in feats if f["properties"].get("node_kind") == "outfall"]
start = links and c.get(f"/api/model/objects/link/{links[0]}").json()["attributes"]["from_node"]
if outs and start:
    get("/api/model/profile", start=start, end=outs[0])
    pr = get("/api/model/profile", start=start, end=outs[0], period=per["period_count"] // 2)
    mid = pr["path_node_ids"][len(pr["path_node_ids"]) // 2]
    get("/api/model/profile", start=start, end=outs[0], via=mid, period=1)
(outdir / "golden.json").write_text(json.dumps(G))
shutil.copy(proj / "model.inp", outdir / "model.inp")
shutil.copy(proj / "model.rpt", outdir / "model.rpt"); shutil.copy(proj / "model.out", outdir / "model.out")
print("wrote", len(G), "responses to", outdir)
