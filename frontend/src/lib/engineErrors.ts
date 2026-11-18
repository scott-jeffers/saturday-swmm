/**
 * Turn SWMM / OpenSWMM engine messages ("ERROR 209: undefined object J9 at line 45
 * of [CONDUITS] section:") into a plain sentence, a hint, and the element involved.
 */

export type ExplainedMessage = {
  /** Plain-language sentence. */
  text: string
  /** What to do about it, when we know. */
  hint?: string
  /** Element ID named in the message, if any. */
  objectId?: string
  /** Object kind guessed from the wording/section. */
  objectType?: 'node' | 'link' | 'subcatchment'
  code?: number
  line?: number
  section?: string
  severity: 'error' | 'warning'
  /** Original message, for tooltips. */
  raw: string
}

type Rule = { text: string; hint?: string; type?: ExplainedMessage['objectType'] }

const RULES: Record<number, Rule> = {
  103: { text: 'The kinematic wave solver failed for link {id}.', hint: 'Check its slope and roughness, or use dynamic wave routing.', type: 'link' },
  107: { text: 'The solver could not find a valid time step.', hint: 'Reduce the routing step or look for very short conduits.' },
  108: { text: 'Subcatchment {id} has an outlet that is ambiguous.', hint: 'Its outlet must be a single node or subcatchment ID.', type: 'subcatchment' },
  110: { text: 'Ground elevation is below the water table for {id}.', hint: 'Raise the surface elevation or lower the aquifer water table.' },
  111: { text: 'Conduit {id} is too short.', hint: 'Its length must be greater than zero; set it from the drawn geometry.', type: 'link' },
  112: { text: 'Conduit {id} drops more than its length.', hint: 'The elevation drop between its ends is larger than the pipe is long. Check inverts and offsets.', type: 'link' },
  113: { text: 'Conduit {id} has an invalid roughness.', hint: "Manning's n must be greater than zero.", type: 'link' },
  114: { text: 'Conduit {id} has an invalid number of barrels.', type: 'link' },
  115: { text: 'Conduit {id} slopes uphill.', hint: 'Reverse the link, fix the inverts, or allow adverse slopes with dynamic wave routing.', type: 'link' },
  117: { text: 'Link {id} has no cross-section.', hint: 'Add a shape and size in its properties.', type: 'link' },
  119: { text: 'Link {id} has an invalid cross-section.', hint: 'Check the shape and that every dimension is above zero.', type: 'link' },
  121: { text: 'Pump {id} has a missing or invalid pump curve.', type: 'link' },
  131: { text: 'The network has a loop, which steady or kinematic wave routing cannot solve.', hint: 'Switch to dynamic wave routing or remove the loop.' },
  133: { text: 'Node {id} has more than one outlet link.', hint: 'Kinematic wave routing allows one outlet per node; use dynamic wave.', type: 'node' },
  134: { text: 'Node {id} has illegal DUMMY link connections.', type: 'node' },
  135: { text: 'Divider {id} does not have two outlet links.', type: 'node' },
  136: { text: 'Divider {id} has an invalid diversion link.', type: 'node' },
  137: { text: 'Weir divider {id} has invalid parameters.', type: 'node' },
  138: { text: 'Node {id} starts deeper than its maximum depth.', hint: 'Lower its initial depth or raise its maximum depth.', type: 'node' },
  139: { text: 'Regulator {id} is the outlet of a non-storage node.', hint: 'With kinematic wave routing, orifices, weirs and outlets must leave storage units.', type: 'link' },
  141: { text: 'Outfall {id} has more than one inlet, or an outlet link.', hint: 'An outfall takes exactly one link in and none out.', type: 'node' },
  143: { text: 'Regulator {id} has an invalid cross-section shape.', type: 'link' },
  145: { text: 'The drainage system has no outfall.', hint: 'Add at least one outfall node.' },
  151: { text: 'LID unit {id} has an invalid parameter.' },
  155: { text: 'LID area in subcatchment {id} is invalid.', hint: 'LID areas cannot exceed the subcatchment area.', type: 'subcatchment' },
  156: { text: 'Rain gages share a rainfall file and station but disagree: {id}.' },
  157: { text: 'Rain gage {id} has an inconsistent rainfall format.' },
  158: { text: 'The time series for rain gage {id} is also used by another object.' },
  159: { text: 'Rain gage {id} records less often than its time series.', hint: 'Make the gage interval no larger than the time series interval.' },
  171: { text: 'Curve {id} has invalid or out-of-order data.', hint: 'X values must increase down the curve.' },
  173: { text: 'Time series {id} has data out of order.', hint: 'Dates and times must increase down the series.' },
  191: { text: 'The simulation starts after it ends.', hint: 'Fix the start and end dates in Simulation settings.' },
  193: { text: 'Reporting starts after the simulation ends.', hint: 'Fix the report start date in Simulation settings.' },
  195: { text: 'The report step is shorter than the routing step.', hint: 'Make the routing step no longer than the report step.' },
  200: { text: 'The input file has errors.', hint: 'See the messages above for each one.' },
  201: { text: 'A line in the input file is too long.' },
  203: { text: 'A line in the input file has too few values.' },
  205: { text: 'The input file has an unknown keyword.' },
  207: { text: 'The ID {id} is used twice.', hint: 'Every node, link and subcatchment needs a unique ID.' },
  209: { text: '{id} is referred to but never defined.', hint: 'Check the ID for typos, or add the missing element.' },
  211: { text: 'The input file has a value that is not a number.' },
  213: { text: 'The input file has an invalid date or time.' },
  217: { text: 'A control rule is invalid or out of order.' },
  303: { text: 'The input file could not be opened.' },
  305: { text: 'The report file could not be opened.', hint: 'Close any program that has the .rpt file open.' },
  307: { text: 'The results file could not be opened.', hint: 'Close any program that has the .out file open.' },
  317: { text: 'The rainfall data file could not be opened.', hint: 'Check the file name in the rain gage and that the file is in the project folder.' },
  318: { text: 'Dates in the rainfall file are out of order.' },
  319: { text: 'The rainfall file is in an unknown format.' },
  321: { text: 'The rainfall file has no data for gage {id}.', hint: 'Check the station ID and the simulation dates.' },
  337: { text: 'The climate file could not be opened.' },
}

const SECTION_KIND: Record<string, ExplainedMessage['objectType']> = {
  JUNCTIONS: 'node', OUTFALLS: 'node', STORAGE: 'node', DIVIDERS: 'node', COORDINATES: 'node', INFLOWS: 'node', DWF: 'node',
  CONDUITS: 'link', PUMPS: 'link', ORIFICES: 'link', WEIRS: 'link', OUTLETS: 'link', XSECTIONS: 'link', LOSSES: 'link', VERTICES: 'link',
  SUBCATCHMENTS: 'subcatchment', SUBAREAS: 'subcatchment', INFILTRATION: 'subcatchment', POLYGONS: 'subcatchment', LID_USAGE: 'subcatchment',
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')

export function explainEngineMessage(raw: string): ExplainedMessage {
  const msg = raw.trim()
  const severity: ExplainedMessage['severity'] = /^\s*WARNING/i.test(msg) ? 'warning' : 'error'
  const m = msg.match(/^(?:ERROR|WARNING)\s*(\d+)\s*:\s*(.*)$/is)
  if (!m) return { text: msg.replace(/\s+/g, ' '), severity, raw: msg }
  const code = Number(m[1])
  const body = m[2].replace(/\s+/g, ' ').trim()
  const line = body.match(/at line (\d+)/i)?.[1]
  const section = body.match(/\[([A-Z_]+)\]/)?.[1]
  // Object id: "for Conduit C3", "Node J9", "undefined object J9", "duplicate ID name J9", "Rain Gage RG1".
  const id =
    body.match(/(?:undefined object|duplicate ID name)\s+(\S+?)(?=\s+at line|\s*$)/i)?.[1] ??
    body.match(/(?:Conduit|Link|Node|Subcatchment|Pump|Outfall|Divider|Regulator|Rain Gage|Curve|Time Series|LID unit|Storage Unit|Junction)\s+(\S+)/i)?.[1]
  const rule = RULES[code]
  const clean = (id ?? '').replace(/[.:,]$/, '')
  let objectType = rule?.type ?? (section ? SECTION_KIND[section] : undefined)
  if (!objectType && /\b(conduit|link|pump|weir|orifice|outlet|regulator)\b/i.test(body)) objectType = 'link'
  if (!objectType && /\b(node|junction|outfall|storage|divider)\b/i.test(body)) objectType = 'node'
  if (!objectType && /\bsubcatchment\b/i.test(body)) objectType = 'subcatchment'
  let text = rule ? rule.text.replace('{id}', clean || 'an element') : body.charAt(0).toUpperCase() + body.slice(1)
  if (rule && (line || section)) {
    const where = [section ? titleCase(section) : null, line ? `line ${line}` : null].filter(Boolean).join(', ')
    text += ` (${where})`
  }
  return {
    text,
    hint: rule?.hint,
    objectId: clean || undefined,
    objectType: clean ? objectType : undefined,
    code,
    line: line ? Number(line) : undefined,
    section,
    severity,
    raw: msg,
  }
}
