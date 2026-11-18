from __future__ import annotations

import heapq
from typing import Any, Optional

from fastapi import HTTPException

from app.services.inp_model_service import ParsedModel, inp_model_service
from app.services.output_service import output_service
from app.services.project_service import project_service


class ProfileService:
    def _graph(self, model: ParsedModel) -> dict[str, list[tuple[str, str, float]]]:
        """Undirected adjacency: node -> [(neighbor, link_id, length)]."""
        adj: dict[str, list[tuple[str, str, float]]] = {}
        for lid, attrs in model.all_links().items():
            a = attrs["from_node"]
            b = attrs["to_node"]
            length = float(attrs.get("length") or 0.0)
            if length <= 0:
                # Estimate from coordinates if available
                ca = model.coordinates.get(a)
                cb = model.coordinates.get(b)
                if ca and cb:
                    length = ((ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2) ** 0.5
                else:
                    length = 1.0
            adj.setdefault(a, []).append((b, lid, length))
            adj.setdefault(b, []).append((a, lid, length))
        return adj

    def _shortest_path(
        self, adj: dict[str, list[tuple[str, str, float]]], start: str, end: str
    ) -> tuple[list[str], list[str], list[float]]:
        if start not in adj:
            raise HTTPException(status_code=404, detail=f"Start node not in network: {start}")
        if end not in adj:
            raise HTTPException(status_code=404, detail=f"End node not in network: {end}")

        dist: dict[str, float] = {start: 0.0}
        prev: dict[str, tuple[str, str, float]] = {}
        pq: list[tuple[float, str]] = [(0.0, start)]

        while pq:
            d, u = heapq.heappop(pq)
            if u == end:
                break
            if d > dist.get(u, 1e100):
                continue
            for v, lid, length in adj.get(u, []):
                nd = d + length
                if nd < dist.get(v, 1e100):
                    dist[v] = nd
                    prev[v] = (u, lid, length)
                    heapq.heappush(pq, (nd, v))

        if end not in dist:
            raise HTTPException(
                status_code=404, detail=f"No path found between {start} and {end}"
            )

        nodes: list[str] = [end]
        links: list[str] = []
        lengths: list[float] = []
        cur = end
        while cur != start:
            u, lid, length = prev[cur]
            links.append(lid)
            lengths.append(length)
            nodes.append(u)
            cur = u
        nodes.reverse()
        links.reverse()
        lengths.reverse()
        return nodes, links, lengths

    def _path_via(self, adj, start: str, end: str, via: list[str]):
        """Shortest path start → via… → end (each leg shortest on its own)."""
        stops = [start, *[v for v in via if v], end]
        nodes: list[str] = [start]
        links: list[str] = []
        lengths: list[float] = []
        for a, b in zip(stops, stops[1:]):
            if a == b:
                continue
            n, l, d = self._shortest_path(adj, a, b)
            nodes.extend(n[1:])
            links.extend(l)
            lengths.extend(d)
        return nodes, links, lengths

    def _results(self, period: Optional[int]) -> dict[str, dict[str, float]]:
        """Per-node depth/head/flooding at a period plus max depth over the run;
        per-link flow at the period and peak |flow|. Empty when there are no results."""
        out_path = project_service.out_path()
        res: dict[str, dict[str, float]] = {k: {} for k in ("depth", "head", "flood", "max_depth", "flow", "max_flow")}
        if not out_path.is_file():
            return res
        try:
            from openswmm.engine import OutLinkVar, OutNodeVar

            out = output_service._open(out_path)
            node_ids = [str(x) for x in out.node_ids]
            link_ids = [str(x) for x in out.link_ids]
            env = output_service.envelope(out_path)
            res["max_depth"] = dict(zip(env["node_ids"], env["node_depths"]))
            res["max_flow"] = dict(zip(env["link_ids"], env["link_flows"]))
            if period is not None and 0 <= period < int(out.period_count):
                res["depth"] = dict(zip(node_ids, (float(v) for v in out.node_result(period, OutNodeVar.DEPTH))))
                res["head"] = dict(zip(node_ids, (float(v) for v in out.node_result(period, OutNodeVar.HEAD))))
                res["flood"] = dict(zip(node_ids, (float(v) for v in out.node_result(period, OutNodeVar.OVERFLOW))))
                res["flow"] = dict(zip(link_ids, (float(v) for v in out.link_result(period, OutLinkVar.FLOW))))
        except Exception:
            pass
        return res

    def build_profile(
        self,
        inp_path,
        start: str,
        end: str,
        period: Optional[int] = None,
        via: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        model = inp_model_service.load(inp_path)
        nodes_attrs = model.all_nodes()
        links_attrs = model.all_links()
        adj = self._graph(model)
        path_nodes, path_links, lengths = self._path_via(adj, start, end, via or [])

        r = self._results(period)
        depths: dict[str, float] = r["depth"]
        heads: dict[str, float] = r["head"]

        profile_nodes: list[dict[str, Any]] = []
        profile_links: list[dict[str, Any]] = []
        distance = 0.0

        for i, nid in enumerate(path_nodes):
            attrs = nodes_attrs.get(nid, {"elevation": 0.0, "max_depth": 0.0})
            elev = float(attrs.get("elevation") or 0.0)
            max_depth = float(attrs.get("max_depth") or 0.0)
            ground = elev + max_depth if max_depth else elev
            water = None
            if nid in depths:
                water = elev + depths[nid]
            hgl = heads.get(nid)
            if hgl is None and water is not None:
                hgl = water
            xy = model.coordinates.get(nid)
            profile_nodes.append(
                {
                    "id": nid,
                    "distance": distance,
                    "elevation": elev,
                    "max_depth": max_depth,
                    "ground": ground,
                    "water_surface": water,
                    "hgl": hgl,
                    "x": xy[0] if xy else None,
                    "y": xy[1] if xy else None,
                    "node_kind": attrs.get("node_kind"),
                    "max_hgl": elev + r["max_depth"][nid] if nid in r["max_depth"] else None,
                    "flooding": r["flood"].get(nid),
                }
            )
            if i < len(path_links):
                lid = path_links[i]
                length = lengths[i]
                lattrs = links_attrs.get(lid, {})
                xs = model.xsections.get(lid, {})
                diameter = xs.get("geom1")
                in_off = float(lattrs.get("in_offset") or 0.0)
                out_off = float(lattrs.get("out_offset") or 0.0)
                # Determine orientation relative to path direction
                from_n = lattrs.get("from_node")
                to_n = lattrs.get("to_node")
                if from_n == nid and to_n == path_nodes[i + 1]:
                    elev_us = elev + in_off
                    elev_ds = float(nodes_attrs.get(to_n, {}).get("elevation") or 0.0) + out_off
                elif to_n == nid and from_n == path_nodes[i + 1]:
                    elev_us = elev + out_off
                    elev_ds = float(nodes_attrs.get(from_n, {}).get("elevation") or 0.0) + in_off
                else:
                    elev_us = elev + in_off
                    elev_ds = float(
                        nodes_attrs.get(path_nodes[i + 1], {}).get("elevation") or 0.0
                    ) + out_off

                diam_f = float(diameter) if diameter is not None else None
                # Default visible pipe height when xsection missing (edit-mode display)
                if diam_f is None or diam_f <= 0:
                    diam_f = 0.3
                profile_links.append(
                    {
                        "id": lid,
                        "from_node": nid,
                        "to_node": path_nodes[i + 1],
                        "length": length,
                        "start_distance": distance,
                        "end_distance": distance + length,
                        "invert_us": elev_us,
                        "invert_ds": elev_ds,
                        "diameter": diam_f,
                        "crown_us": elev_us + diam_f,
                        "crown_ds": elev_ds + diam_f,
                        "link_kind": lattrs.get("link_kind"),
                        "shape": xs.get("shape"),
                        "flow": r["flow"].get(lid),
                        "max_flow": r["max_flow"].get(lid),
                        "reversed": not (from_n == nid and to_n == path_nodes[i + 1]),
                    }
                )
                distance += length

        flow_units = (inp_model_service.get_flow_units(inp_path) or "CMS").upper()
        us = flow_units in ("CFS", "GPM", "MGD")
        return {
            "start": start,
            "end": end,
            "via": via or [],
            "length_unit": "ft" if us else "m",
            "flow_unit": flow_units,
            "total_length": distance,
            "nodes": profile_nodes,
            "links": profile_links,
            "path_node_ids": path_nodes,
            "path_link_ids": path_links,
        }


profile_service = ProfileService()
