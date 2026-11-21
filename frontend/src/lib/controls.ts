/**
 * SWMM control rules ([CONTROLS]), read for display and checked for edits.
 *
 *   RULE name
 *   IF   <condition>
 *   AND  <condition>      (or OR)
 *   THEN <action>
 *   AND  <action>
 *   ELSE <action>
 *   PRIORITY value
 *
 * A condition is `Object ID Attribute Relation Value`, `SIMULATION Attribute
 * Relation Value`, or a named VARIABLE / EXPRESSION; the value can itself be
 * `Object ID Attribute`. An action is `Object ID Attribute = Value`, where the
 * value can be a number, ON/OFF, OPEN/CLOSED, CURVE x, TIMESERIES x or PID a b c.
 *
 * Each rule keeps its own text, comments and all, so saving one edited rule
 * leaves every other line of the section exactly as it was.
 */

export type ObjectKind = 'node' | 'link' | 'subcatchment' | 'gage' | 'simulation' | 'variable'

export type Operand = {
  /** SWMM keyword: NODE, PUMP, SIMULATION… or a variable's name. */
  object: string
  id?: string
  attr: string
  kind: ObjectKind
}

export type Condition = {
  join: 'IF' | 'AND' | 'OR'
  left: Operand
  op: string
  right: Operand | string
}

export type Action = {
  branch: 'THEN' | 'ELSE'
  target: Operand
  value: string
}

export type Rule = {
  name: string
  /** The rule's own lines, as written. */
  text: string
  conditions: Condition[]
  actions: Action[]
  priority: number | null
  errors: string[]
}

export type ControlsDoc = {
  /** Lines before the first rule (comments, VARIABLE and EXPRESSION lines). */
  preamble: string
  rules: Rule[]
  variables: string[]
}

const NODE_OBJ = new Set(['NODE', 'JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER'])
const LINK_OBJ = new Set(['LINK', 'CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET'])
const ACTION_OBJ = new Set(['CONDUIT', 'PUMP', 'ORIFICE', 'WEIR', 'OUTLET'])
const RELATIONS = new Set(['=', '<>', '<', '<=', '>', '>='])

function kindOf(obj: string): ObjectKind | null {
  if (NODE_OBJ.has(obj)) return 'node'
  if (LINK_OBJ.has(obj)) return 'link'
  if (obj === 'SUBCATCH' || obj === 'SUBCATCHMENT') return 'subcatchment'
  if (obj === 'GAGE' || obj === 'RAINGAGE') return 'gage'
  if (obj === 'SIMULATION') return 'simulation'
  return null
}

const stripComment = (l: string) => {
  const i = l.indexOf(';')
  return (i >= 0 ? l.slice(0, i) : l).trim()
}
const tokens = (l: string) => stripComment(l).split(/\s+/).filter(Boolean)
const isRuleLine = (l: string) => /^\s*RULE(\s|$)/i.test(l)

/**
 * Split the section into its preamble and one text block per rule. Blocks
 * keep their own trailing blank lines, so joining them with newlines gives
 * back the section exactly.
 */
function splitRaw(text: string): { preamble: string[]; blocks: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const first = lines.findIndex(isRuleLine)
  if (first < 0) return { preamble: lines, blocks: [] }
  const blocks: string[][] = []
  for (const l of lines.slice(first)) {
    if (isRuleLine(l) || !blocks.length) blocks.push([])
    blocks[blocks.length - 1].push(l)
  }
  return { preamble: lines.slice(0, first), blocks }
}

export function splitRules(text: string): { preamble: string; blocks: string[] } {
  const { preamble, blocks } = splitRaw(text)
  return { preamble: trimEnd(preamble).join('\n'), blocks: blocks.map((b) => trimEnd(b).join('\n')) }
}

function trimEnd(ls: string[]) {
  const out = [...ls]
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out
}

/** Names declared with VARIABLE or EXPRESSION, which conditions may use. */
function declared(preamble: string, blocks: string[]): string[] {
  const names: string[] = []
  for (const l of [preamble, ...blocks].join('\n').split('\n')) {
    const t = tokens(l)
    if (t.length >= 2 && /^(VARIABLE|EXPRESSION)$/i.test(t[0])) names.push(t[1].toUpperCase())
  }
  return names
}

export type KnownIds = {
  nodes?: Set<string>
  links?: Set<string>
  subcatchments?: Set<string>
  gages?: Set<string>
  /** Link id → its kind (conduit, pump…), to check the action's object. */
  linkKinds?: Map<string, string>
}

function operand(t: string[], vars: Set<string>): { op: Operand; used: number } | null {
  const obj = (t[0] ?? '').toUpperCase()
  const kind = kindOf(obj)
  if (kind === 'simulation') return t.length >= 2 ? { op: { object: obj, attr: t[1].toUpperCase(), kind }, used: 2 } : null
  if (kind) return t.length >= 3 ? { op: { object: obj, id: t[1], attr: t[2].toUpperCase(), kind }, used: 3 } : null
  if (vars.has(obj)) return { op: { object: t[0], attr: '', kind: 'variable' }, used: 1 }
  return null
}

export function parseRule(text: string, vars: Set<string> = new Set(), known: KnownIds = {}): Rule {
  const rule: Rule = { name: '', text, conditions: [], actions: [], priority: null, errors: [] }
  let phase: 'start' | 'if' | 'then' | 'else' | 'priority' = 'start'
  const err = (m: string) => rule.errors.push(m)
  const checkId = (o: Operand, line: number) => {
    if (!o.id) return
    const set = o.kind === 'node' ? known.nodes : o.kind === 'link' ? known.links : o.kind === 'subcatchment' ? known.subcatchments : o.kind === 'gage' ? known.gages : undefined
    if (set && set.size && !set.has(o.id)) err(`Line ${line}: there is no ${o.object.toLowerCase()} ${o.id} in the model.`)
    if (o.kind === 'link' && known.linkKinds && o.object !== 'LINK') {
      const k = known.linkKinds.get(o.id)
      if (k && k.toUpperCase() !== o.object) err(`Line ${line}: ${o.id} is a ${k}, not a ${o.object.toLowerCase()}.`)
    }
  }

  text.split('\n').forEach((raw, i) => {
    const line = i + 1
    const t = tokens(raw)
    if (!t.length) return
    const kw = t[0].toUpperCase()
    const rest = t.slice(1)
    if (kw === 'RULE') {
      if (phase !== 'start') err(`Line ${line}: a second RULE line; each rule starts with its own RULE.`)
      rule.name = rest.join(' ')
      if (!rule.name) err('The rule needs a name after RULE.')
      phase = 'if'
      return
    }
    if (phase === 'start') {
      err(`Line ${line}: a rule starts with RULE and its name.`)
      phase = 'if'
    }
    if (kw === 'PRIORITY') {
      const p = Number(rest[0])
      if (!Number.isFinite(p)) err(`Line ${line}: PRIORITY needs a number.`)
      else rule.priority = p
      phase = 'priority'
      return
    }
    const isCondition = kw === 'IF' || ((kw === 'AND' || kw === 'OR') && phase === 'if')
    if (isCondition) {
      if (kw === 'IF' && rule.conditions.length) err(`Line ${line}: only the first condition starts with IF; use AND or OR.`)
      if (kw !== 'IF' && !rule.conditions.length) err(`Line ${line}: the first condition starts with IF.`)
      const l = operand(rest, vars)
      if (!l) {
        err(`Line ${line}: “${rest[0] ?? ''}” isn’t a node, link, subcatchment, gage, SIMULATION or a declared variable.`)
        return
      }
      const op = rest[l.used]
      if (!op || !RELATIONS.has(op)) {
        err(`Line ${line}: expected a comparison (=, <>, <, <=, >, >=) after ${rest.slice(0, l.used).join(' ')}.`)
        return
      }
      const after = rest.slice(l.used + 1)
      if (!after.length) {
        err(`Line ${line}: the condition needs a value to compare with.`)
        return
      }
      const r = operand(after, vars)
      const right = r && r.used === after.length && r.op.kind !== 'variable' ? r.op : after.join(' ')
      checkId(l.op, line)
      if (typeof right !== 'string') checkId(right, line)
      rule.conditions.push({ join: kw as Condition['join'], left: l.op, op, right })
      return
    }
    if (kw === 'THEN' || kw === 'ELSE' || (kw === 'AND' && (phase === 'then' || phase === 'else'))) {
      if (kw === 'THEN') {
        if (phase === 'then' || phase === 'else') err(`Line ${line}: only one THEN per rule; add more actions with AND.`)
        if (!rule.conditions.length) err(`Line ${line}: THEN comes after at least one IF condition.`)
        phase = 'then'
      } else if (kw === 'ELSE') {
        if (phase !== 'then') err(`Line ${line}: ELSE comes after THEN.`)
        phase = 'else'
      }
      const obj = (rest[0] ?? '').toUpperCase()
      if (!ACTION_OBJ.has(obj)) {
        err(`Line ${line}: actions change a PUMP, ORIFICE, WEIR, OUTLET or CONDUIT, not “${rest[0] ?? ''}”.`)
        return
      }
      if (rest.length < 5 || rest[3] !== '=') {
        err(`Line ${line}: an action reads ${obj} id STATUS = value or ${obj} id SETTING = value.`)
        return
      }
      const target: Operand = { object: obj, id: rest[1], attr: rest[2].toUpperCase(), kind: 'link' }
      checkId(target, line)
      const branch = phase === 'else' ? 'ELSE' : 'THEN'
      rule.actions.push({ branch, target, value: rest.slice(4).join(' ') })
      return
    }
    err(`Line ${line}: “${t[0]}” isn’t a rule keyword (IF, AND, OR, THEN, ELSE, PRIORITY).`)
  })
  if (!rule.name && !rule.errors.length) err('The rule needs a RULE line with its name.')
  if (!rule.conditions.length && !rule.errors.some((e) => e.includes('IF'))) err('The rule has no IF condition.')
  if (!rule.actions.some((a) => a.branch === 'THEN') && !rule.errors.some((e) => e.includes('THEN'))) err('The rule has no THEN action.')
  return rule
}

export function parseControls(text: string, known: KnownIds = {}): ControlsDoc {
  const { preamble, blocks } = splitRules(text)
  const variables = declared(preamble, blocks)
  const vars = new Set(variables)
  const rules = blocks.map((b) => parseRule(b, vars, known))
  const seen = new Map<string, number>()
  for (const r of rules) {
    const k = r.name.toUpperCase()
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  for (const r of rules) if (r.name && (seen.get(r.name.toUpperCase()) ?? 0) > 1) r.errors.push(`Another rule is also named ${r.name}.`)
  return { preamble, rules, variables }
}

/**
 * The section's text with rule `index` replaced (or removed with null, or
 * appended at -1). Every other line, blank lines included, stays as it was.
 */
export function replaceRule(text: string, index: number, ruleText: string | null): string {
  const { preamble, blocks } = splitRaw(text)
  const next = blocks.map((b) => [...b])
  const fresh = ruleText == null ? null : ruleText.replace(/\s+$/, '').split('\n')
  if (index < 0) {
    if (fresh) {
      // keep the spacing the file already uses between rules
      const gap = next.length ? next[0].length - trimEnd(next[0]).length : 0
      const last = next[next.length - 1]
      if (last) {
        const body = trimEnd(last)
        next[next.length - 1] = [...body, ...Array(gap).fill('')]
      } else if (trimEnd(preamble).length) preamble.push('')
      next.push(fresh)
    }
  } else if (!fresh) next.splice(index, 1)
  else {
    const old = next[index]
    next[index] = [...fresh, ...Array(old.length - trimEnd(old).length).fill('')]
  }
  return trimEnd([...preamble, ...next.flat()]).join('\n')
}

/** Every link a rule acts on → the rules that act on it. */
export function rulesByTarget(rules: Rule[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const r of rules)
    for (const a of r.actions) {
      const id = a.target.id!
      const list = m.get(id) ?? []
      if (!list.includes(r.name)) list.push(r.name)
      m.set(id, list)
    }
  return m
}

// ------------------------------------------------------------- display text

const ATTR: Record<string, string> = {
  DEPTH: 'depth',
  MAXDEPTH: 'max depth',
  HEAD: 'head',
  VOLUME: 'volume',
  INFLOW: 'inflow',
  FLOW: 'flow',
  FULLFLOW: 'full flow',
  FULLDEPTH: 'full depth',
  VELOCITY: 'velocity',
  LENGTH: 'length',
  SLOPE: 'slope',
  STATUS: 'status',
  SETTING: 'setting',
  TIMEOPEN: 'has been open for',
  TIMECLOSED: 'has been closed for',
  RUNOFF: 'runoff',
  GWFLOW: 'groundwater flow',
  GWELEV: 'groundwater elevation',
  SOILMOIST: 'soil moisture',
  INTENSITY: 'rain intensity',
  'INTENSITY(H)': 'rain intensity',
  TIME: 'elapsed time',
  DATE: 'date',
  CLOCKTIME: 'clock time',
  DAY: 'day of week',
  MONTH: 'month',
  DAYOFYEAR: 'day of year',
}

export const attrLabel = (a: string) => ATTR[a] ?? (/^INTENSITY|^RAINFALL/.test(a) ? 'rainfall' : a.toLowerCase())

const OP: Record<string, string> = { '=': '=', '<>': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' }
export const opLabel = (o: string) => OP[o] ?? o

/** Units for a compared value, where the attribute implies one. */
export function attrUnit(attr: string, us: boolean, flowUnits: string): string {
  if (['DEPTH', 'MAXDEPTH', 'HEAD', 'FULLDEPTH', 'LENGTH', 'GWELEV'].includes(attr)) return us ? 'ft' : 'm'
  if (['FLOW', 'INFLOW', 'FULLFLOW', 'RUNOFF', 'GWFLOW'].includes(attr)) return flowUnits.toLowerCase()
  if (attr === 'VELOCITY') return us ? 'ft/s' : 'm/s'
  if (attr === 'VOLUME') return us ? 'ft³' : 'm³'
  return ''
}

/** "00:02" or "0.0333" (hours) → "2 min". */
export function hoursLabel(v: string): string {
  let h: number
  if (v.includes(':')) {
    const p = v.split(':').map(Number)
    if (p.some((x) => !Number.isFinite(x))) return v
    h = p[0] + (p[1] ?? 0) / 60 + (p[2] ?? 0) / 3600
  } else {
    h = Number(v)
    if (!Number.isFinite(h)) return v
  }
  const s = Math.round(h * 3600)
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  const m = Math.round(s / 60)
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** A starting rule for the editor. */
export function ruleTemplate(name: string, link?: { id: string; kind: string }, node?: string): string {
  const obj = (link?.kind ?? 'pump').toUpperCase()
  const act = obj === 'PUMP' ? 'STATUS = ON' : obj === 'CONDUIT' ? 'STATUS = OPEN' : 'SETTING = 1'
  const off = obj === 'PUMP' ? 'STATUS = OFF' : obj === 'CONDUIT' ? 'STATUS = CLOSED' : 'SETTING = 0'
  return [`RULE ${name}`, `IF NODE ${node ?? 'J1'} DEPTH > 1.0`, `THEN ${obj} ${link?.id ?? 'P1'} ${act}`, `ELSE ${obj} ${link?.id ?? 'P1'} ${off}`, 'PRIORITY 1'].join('\n')
}
