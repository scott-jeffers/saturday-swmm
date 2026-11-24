"""Draw the overview pictures of the browser viewer's example models from their .inp files.

Run from anywhere: python scripts/make_example_thumbs.py (writes frontend/public/examples/thumbs/*.svg)."""
import re, sys, pathlib
EX = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "examples"
OUT = EX / "thumbs"
W, H, PAD = 320, 180, 12

def sections(text):
    cur = None; out = {}
    for ln in text.splitlines():
        s = ln.strip()
        if not s or s.startswith(";"): continue
        m = re.match(r"\[(.+)\]", s)
        if m: cur = m.group(1).upper(); out.setdefault(cur, []); continue
        if cur: out[cur].append(s.split())
    return out

def draw(inp, name, flood=False):
    sec = sections(inp.read_text(errors="replace"))
    xy = {r[0]: (float(r[1]), float(r[2])) for r in sec.get("COORDINATES", []) if len(r) >= 3}
    polys = {}
    for r in sec.get("POLYGONS", []):
        if len(r) >= 3: polys.setdefault(r[0], []).append((float(r[1]), float(r[2])))
    links = []
    for s in ("CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"):
        links += [(r[1], r[2]) for r in sec.get(s, []) if len(r) >= 3]
    outfalls = {r[0] for r in sec.get("OUTFALLS", [])}
    storage = {r[0] for r in sec.get("STORAGE", [])}
    pts = list(xy.values()) + [p for ps in polys.values() for p in ps]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    sc = min((W - 2 * PAD) / max(x1 - x0, 1e-9), (H - 2 * PAD) / max(y1 - y0, 1e-9))
    ox = (W - (x1 - x0) * sc) / 2; oy = (H - (y1 - y0) * sc) / 2
    nd = 0 if len(xy) > 300 else 1
    T = lambda p: (round(ox + (p[0] - x0) * sc, nd), round(H - (oy + (p[1] - y0) * sc), nd))
    big = len(links) > 200
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">']
    o.append(f'<rect width="{W}" height="{H}" fill="#eef2f5"/>')
    if flood:
        # A 2D surface mesh under the network: a light triangle grid.
        o.append('<defs><pattern id="m" width="10" height="8.66" patternUnits="userSpaceOnUse"><path d="M0 0H10L5 8.66Z M5 8.66H15 M-5 8.66H5" fill="none" stroke="#93c5fd" stroke-width="0.5"/></pattern></defs>')
        o.append(f'<rect width="{W}" height="{H}" fill="#e0efff"/><rect width="{W}" height="{H}" fill="url(#m)"/>')
    o.append(f'<g fill="#{"8fc9a3" if not flood else "7fb4e0"}" fill-opacity="{0.4 if big else 0.45}" stroke="#{"4f9d6e" if not flood else "3b82c4"}" stroke-opacity="0.45" stroke-width="0.5">')
    for ps in polys.values():
        q = list(dict.fromkeys(map(T, ps)))
        if len(q) < 3: continue
        d = " ".join(f"{a:g},{b:g}" for a, b in q)
        o.append(f'<polygon points="{d}"/>')
    o.append("</g>")
    lw = 0.9 if big else 2.2
    segs = []
    for a, b in links:
        if a in xy and b in xy:
            (p, q), (r, s) = T(xy[a]), T(xy[b])
            segs.append(f"M{p:g} {q:g}L{r:g} {s:g}")
    o.append(f'<path d="{"".join(segs)}" stroke="#2563eb" stroke-width="{lw}" stroke-linecap="round" fill="none"/>')
    if not big:
        for n, p in xy.items():
            if n in outfalls or n in storage: continue
            a, b = T(p); o.append(f'<circle cx="{a}" cy="{b}" r="2.6" fill="#2563eb" stroke="#fff" stroke-width="1"/>')
    for n in storage:
        if n in xy:
            a, b = T(xy[n]); o.append(f'<rect x="{a-3}" y="{b-3}" width="6" height="6" fill="#f59e0b" stroke="#fff" stroke-width="0.8"/>')
    for n in outfalls:
        if n in xy:
            a, b = T(xy[n]); o.append(f'<path d="M{a} {b-4.5} L{a+4.5} {b+3.5} L{a-4.5} {b+3.5} Z" fill="#dc2626" stroke="#fff" stroke-width="0.8"/>')
    o.append("</svg>")
    (OUT / f"{name}.svg").write_text("".join(o))
    print(name, len(links), "links", len(polys), "subs")

draw(EX / "bellinge.inp", "bellinge")
draw(EX / "bellinge-2d/bellinge-2d.inp", "bellinge-2d", flood=True)
draw(EX / "lid-sample/lid-sample.inp", "lid")
draw(EX / "drexel/drexel.inp", "drexel")
draw(EX / "philly-sanitary/philly-sanitary.inp", "philly-sanitary")
