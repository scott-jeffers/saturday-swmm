/** Upstream / downstream tracing on the network (link direction = from → to). */

import type { ModelNetwork } from '../api/client'

export type Graph = {
  down: Map<string, { link: string; node: string }[]>
  up: Map<string, { link: string; node: string }[]>
  nodeKind: Map<string, string>
  linkEnds: Map<string, [string, string]>
}

export function buildGraph(net: ModelNetwork): Graph {
  const down = new Map<string, { link: string; node: string }[]>()
  const up = new Map<string, { link: string; node: string }[]>()
  const nodeKind = new Map<string, string>()
  const linkEnds = new Map<string, [string, string]>()
  for (const f of net.geojson.features) {
    const p = f.properties ?? {}
    if (p.object_type === 'node') nodeKind.set(String(p.id), String(p.node_kind ?? 'junction'))
    if (p.object_type === 'link' && p.from_node != null && p.to_node != null) {
      const a = String(p.from_node)
      const b = String(p.to_node)
      const id = String(p.id)
      linkEnds.set(id, [a, b])
      if (!down.has(a)) down.set(a, [])
      if (!up.has(b)) up.set(b, [])
      down.get(a)!.push({ link: id, node: b })
      up.get(b)!.push({ link: id, node: a })
    }
  }
  return { down, up, nodeKind, linkEnds }
}

/** Every node and link reachable going upstream (or downstream) from a node. */
export function trace(g: Graph, start: string, dir: 'up' | 'down') {
  const adj = dir === 'up' ? g.up : g.down
  const nodes = new Set([start])
  const links = new Set<string>()
  const q = [start]
  while (q.length) {
    const n = q.shift()!
    for (const e of adj.get(n) ?? []) {
      links.add(e.link)
      if (!nodes.has(e.node)) {
        nodes.add(e.node)
        q.push(e.node)
      }
    }
  }
  return { nodes: [...nodes], links: [...links] }
}

/** Nearest outfall downstream of a node (fewest links), with the route. */
export function routeToOutfall(g: Graph, start: string): { outfall: string; nodes: string[] } | null {
  const prev = new Map<string, string>([[start, '']])
  const q = [start]
  while (q.length) {
    const n = q.shift()!
    if (n !== start && (g.nodeKind.get(n) === 'outfall' || !(g.down.get(n)?.length))) {
      const path = [n]
      let c = n
      while (prev.get(c)) {
        c = prev.get(c)!
        path.unshift(c)
      }
      return { outfall: n, nodes: path }
    }
    for (const e of g.down.get(n) ?? []) {
      if (!prev.has(e.node)) {
        prev.set(e.node, n)
        q.push(e.node)
      }
    }
  }
  return null
}

/** Furthest upstream node from a node along its longest branch (for "profile from top"). */
export function topOfBranch(g: Graph, start: string): string {
  let cur = start
  const seen = new Set([start])
  for (;;) {
    const ups = (g.up.get(cur) ?? []).filter((e) => !seen.has(e.node))
    if (!ups.length) return cur
    // follow the branch that drains the most upstream nodes
    let best = ups[0]!
    let bestN = -1
    for (const e of ups) {
      const n = trace(g, e.node, 'up').nodes.length
      if (n > bestN) {
        bestN = n
        best = e
      }
    }
    seen.add(best.node)
    cur = best.node
  }
}
