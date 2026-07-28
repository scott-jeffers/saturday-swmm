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

    def build_profile(
        self,
        inp_path,
        start: str,
        end: str,
        period: Optional[int] = None,
    ) -> dict[str, Any]:
        model = inp_model_service.load(inp_path)
        nodes_attrs = model.all_nodes()
        links_attrs = model.all_links()
        adj = self._graph(model)
        path_nodes, path_links, lengths = self._shortest_path(adj, start, end)

        depths: dict[str, float] = {}
        heads: dict[str, float] = {}
        if period is not None:
            try:
                from openswmm.engine import OutNodeVar

                out_path = project_service.out_path()
                OutputReader = output_service._require_out(out_path)
                with OutputReader(str(out_path)) as out:
                    node_ids = [str(x) for x in out.node_ids]
                    depth_vals = [float(v) for v in out.node_result(period, OutNodeVar.DEPTH)]
                    depths = {nid: d for nid, d in zip(node_ids, depth_vals)}
                    try:
                        head_vals = [float(v) for v in out.node_result(period, OutNodeVar.HEAD)]
                        heads = {nid: h for nid, h in zip(node_ids, head_vals)}
                    except Exception:
                        heads = {}
            except Exception:
                depths = {}
                heads = {}

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
                    }
                )
                distance += length

        return {
            "start": start,
            "end": end,
            "total_length": distance,
            "nodes": profile_nodes,
            "links": profile_links,
            "path_node_ids": path_nodes,
            "path_link_ids": path_links,
        }


profile_service = ProfileService()
