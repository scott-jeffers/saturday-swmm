/** Read-only port of backend/app/services/model_tools_service.py. */

import { isComment, tokenize, type ParsedModel } from './inp'
import T from './tables.json'

const COLUMNS = T.section_columns as Record<string, string[]>
const TEXT_SECTIONS = new Set(T.text_sections)
const OPTION_GROUPS = T.option_groups as [string, [string, string[] | null, string][]][]
const OPTION_KEYS = new Set(OPTION_GROUPS.flatMap(([, items]) => items.map(([k]) => k)))
const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/

/** Python-style number text ("3.0", not "3"), so messages match the desktop app. */
export const pyNum = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) ? n.toFixed(1) : String(n)
}

function textLines(text: string) {
  return text.split(/\r\n|\n|\r/).filter((_, i, a) => !(i === a.length - 1 && a[i] === ''))
}

export function listSections(text: string) {
  const counts = new Map<string, number>()
  const names = new Map<string, string>()
  let cur: string | null = null
  for (const ln of textLines(text)) {
    const m = SECTION_RE.exec(ln)
    if (m) {
      cur = m[1].trim()
      const up = cur.toUpperCase()
      if (!names.has(up)) names.set(up, cur)
      if (!counts.has(up)) counts.set(up, 0)
      continue
    }
    if (cur && !isComment(ln)) counts.set(cur.toUpperCase(), (counts.get(cur.toUpperCase()) ?? 0) + 1)
  }
  return {
    sections: [...counts].map(([up, n]) => ({ name: names.get(up)!, rows: n, known: up in COLUMNS, text: TEXT_SECTIONS.has(up) })),
    available: Object.keys(COLUMNS).filter((k) => !counts.has(k)),
  }
}

function span(lines: string[], name: string): [number, number] | null {
  let start: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION_RE.exec(lines[i])
    if (m) {
      if (start !== null) return [start, i]
      if (m[1].trim().toUpperCase() === name.toUpperCase()) start = i
    }
  }
  return start !== null ? [start, lines.length] : null
}

export function getSection(text: string, name: string) {
  const up = name.toUpperCase()
  const lines = textLines(text)
  const sp = span(lines, up)
  const body = sp ? lines.slice(sp[0] + 1, sp[1]) : []
  if (TEXT_SECTIONS.has(up)) {
    const data = [...body]
    while (data.length && !data[data.length - 1].trim()) data.pop()
    return { name, kind: 'text', text: data.join('\n') }
  }
  const rows: { values: string[]; comment: string }[] = []
  let width = 0
  for (const ln of body) {
    if (isComment(ln)) continue
    const vals = tokenize(ln)
    // comment: text after the first ';' outside quotes
    let q = false
    let comment = ''
    for (let i = 0; i < ln.length; i++) {
      if (ln[i] === '"') q = !q
      else if (ln[i] === ';' && !q) {
        comment = ln.slice(i).replace(/^;+/, '').trim()
        break
      }
    }
    rows.push({ values: vals, comment })
    width = Math.max(width, vals.length)
  }
  const cols = [...(COLUMNS[up] ?? [])]
  while (cols.length < width) cols.push(`Field ${cols.length + 1}`)
  return { name, kind: 'table', columns: cols, rows }
}

export function getOptions(text: string) {
  const sec = getSection(text, 'OPTIONS')
  const values: Record<string, string> = {}
  for (const r of sec.rows ?? []) if (r.values.length) values[r.values[0].toUpperCase()] = r.values.slice(1).join(' ')
  return {
    groups: OPTION_GROUPS.map(([g, items]) => ({
      name: g,
      options: items.map(([key, choices, label]) => ({ key, label, choices, value: values[key] ?? '' })),
    })),
    other: Object.fromEntries(Object.entries(values).filter(([k]) => !OPTION_KEYS.has(k))),
  }
}

type Issue = { severity: 'error' | 'warning' | 'info'; message: string; object_type: string | null; id: string | null }

export function checkModel(m: ParsedModel) {
  const issues: Issue[] = []
  const add = (severity: Issue['severity'], message: string, object_type: string | null = null, id: string | null = null) =>
    issues.push({ severity, message, object_type, id })
  const nodes = m.allNodes()
  const links = m.allLinks()

  const seen = new Map<string, string>()
  const stores: [string, Map<string, unknown>, string][] = [
    ['JUNCTIONS', m.junctions, 'node'], ['OUTFALLS', m.outfalls, 'node'], ['STORAGE', m.storage, 'node'],
    ['CONDUITS', m.conduits, 'link'], ['PUMPS', m.pumps, 'link'], ['ORIFICES', m.orifices, 'link'],
    ['WEIRS', m.weirs, 'link'], ['OUTLETS', m.outlets, 'link'], ['SUBCATCHMENTS', m.subcatchments, 'subcatchment'],
  ]
  for (const [sec, store, kind] of stores) {
    for (const oid of store.keys()) {
      if (seen.has(oid) && seen.get(oid) !== sec)
        add('error', `${oid} is used in both [${seen.get(oid)}] and [${sec}]; SWMM names must be unique.`, kind, oid)
      if (!seen.has(oid)) seen.set(oid, sec)
    }
  }
  const counts = new Map<string, number>()
  for (const sec of ['JUNCTIONS', 'CONDUITS', 'SUBCATCHMENTS', 'OUTFALLS', 'STORAGE']) {
    for (const t of m.rows(sec)) if (t.length) counts.set(`${sec}:${t[0]}`, (counts.get(`${sec}:${t[0]}`) ?? 0) + 1)
  }
  for (const [key, n] of counts) {
    if (n > 1) {
      const i = key.indexOf(':')
      add('error', `${key.slice(i + 1)} is defined ${n} times in [${key.slice(0, i)}].`, null, key.slice(i + 1))
    }
  }

  const connected = new Map<string, string[]>()
  for (const [lid, a] of links) {
    for (const end of ['from_node', 'to_node']) {
      const nid = a[end] as string
      if (!nodes.has(nid)) add('error', `Link ${lid} refers to node ${nid}, which doesn't exist.`, 'link', lid)
      else connected.set(nid, [...(connected.get(nid) ?? []), lid])
    }
    if (a.link_kind === 'conduit' && !m.xsections.has(lid)) add('error', `Conduit ${lid} has no cross-section in [XSECTIONS].`, 'link', lid)
  }
  for (const nid of nodes.keys()) {
    if (!connected.get(nid)?.length) add('warning', `Node ${nid} isn't connected to any link.`, 'node', nid)
    if (!m.coordinates.has(nid)) add('info', `Node ${nid} has no map coordinates.`, 'node', nid)
  }

  const gages = new Set(m.rows('RAINGAGES').map((t) => t[0] ?? ''))
  for (const [sid, sc] of m.subcatchments) {
    const out = sc.outlet as string
    if (!nodes.has(out) && !m.subcatchments.has(out) && out !== '*')
      add('error', `Subcatchment ${sid} drains to ${out}, which doesn't exist.`, 'subcatchment', sid)
    if (sc.raingage && !gages.has(sc.raingage as string))
      add('error', `Subcatchment ${sid} uses rain gage ${sc.raingage}, which doesn't exist.`, 'subcatchment', sid)
    if (Number(sc.area || 0) <= 0) add('warning', `Subcatchment ${sid} has zero area.`, 'subcatchment', sid)
  }

  const offsetsElev = m.rows('OPTIONS').some((t) => t[0] === 'LINK_OFFSETS' && t[1] === 'ELEVATION')
  for (const [lid, c] of m.conduits) {
    const up = nodes.get(c.from_node as string)
    const dn = nodes.get(c.to_node as string)
    if (!up || !dn) continue
    const inOff = Number(c.in_offset || 0)
    const outOff = Number(c.out_offset || 0)
    const length = Number(c.length || 0)
    if (length <= 0) {
      add('error', `Conduit ${lid} has zero length.`, 'link', lid)
      continue
    }
    const zUp = offsetsElev ? inOff : Number(up.elevation || 0) + inOff
    const zDn = offsetsElev ? outOff : Number(dn.elevation || 0) + outOff
    if (zUp < zDn - 1e-9)
      add('warning', `Conduit ${lid} slopes uphill (${zUp.toFixed(2)} → ${zDn.toFixed(2)}). Check its invert elevations or direction.`, 'link', lid)
    if (!offsetsElev) {
      for (const [nd, off, nid] of [[up, inOff, c.from_node], [dn, outOff, c.to_node]] as [Record<string, unknown>, number, string][]) {
        const md = Number(nd.max_depth || 0)
        if (md && off > md) add('warning', `Conduit ${lid} enters node ${nid} above its rim (offset ${pyNum(off)} > max depth ${pyNum(md)}).`, 'link', lid)
      }
    }
  }

  const downstream = new Map<string, string[]>()
  for (const a of links.values()) downstream.set(a.to_node as string, [...(downstream.get(a.to_node as string) ?? []), a.from_node as string])
  const reach = new Set(m.outfalls.keys())
  const q = [...m.outfalls.keys()]
  while (q.length) {
    const n = q.shift()!
    for (const u of downstream.get(n) ?? []) {
      if (!reach.has(u)) {
        reach.add(u)
        q.push(u)
      }
    }
  }
  if (m.outfalls.size) {
    const cut = [...nodes.keys()].filter((n) => !reach.has(n) && connected.get(n)?.length)
    if (cut.length) {
      const shown = cut.slice(0, 10).join(', ') + (cut.length > 10 ? ' …' : '')
      add('warning', `${cut.length} node(s) have no path to an outfall: ${shown}`, 'node', cut[0])
    }
  } else if (nodes.size) add('error', 'The model has no outfall.')

  const order = { error: 0, warning: 1, info: 2 }
  issues.sort((a, b) => order[a.severity] - order[b.severity])
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    issues: issues.slice(0, 500),
  }
}
