/**
 * Turn an error (from the app's API, the browser or SWMM) into what happened,
 * in plain words, and what to do about it.
 */

import { ApiError } from '../api/client'

export type Explained = {
  /** One line: what went wrong. */
  message: string
  /** What to do about it, when we know. */
  fix?: string
  /** The form field it is about (API field name), when known. */
  field?: string
  /** The original text, for copying into a bug report. */
  raw: string
  status?: number
}

/** SWMM 5 error codes that people meet most, with what to do. */
const SWMM_ERRORS: Record<number, [string, string]> = {
  103: ['SWMM could not solve the kinematic wave equations for a conduit.', 'Shorten the routing time step, or switch Simulation options → Routing to dynamic wave.'],
  107: ['SWMM could not find a time step that keeps the dynamic wave routing stable.', 'Lower the routing time step, or set a minimum variable step, in Simulation options → Time steps. Very short conduits are a common cause: lengthen them.'],
  108: ['A subcatchment’s outlet is ambiguous.', 'Give each subcatchment a single outlet node or subcatchment that exists.'],
  111: ['A conduit has an invalid length.', 'Lengths must be above 0. Check the conduit in the inspector.'],
  112: ['A conduit’s drop in elevation is larger than its length.', 'Lengthen the conduit or check its end offsets and node inverts.'],
  113: ['A conduit has an invalid roughness.', 'Manning’s n must be above 0 (0.011–0.015 for pipes).'],
  114: ['A conduit has an invalid number of barrels.', 'Barrels must be a whole number, 1 or more.'],
  115: ['A conduit slopes uphill (adverse slope) under kinematic wave routing.', 'Swap its inlet and outlet nodes, fix the inverts, or use dynamic wave routing.'],
  117: ['A link has no cross section.', 'Give it a shape and size in the inspector (or [XSECTIONS]).'],
  119: ['A link’s cross section is invalid.', 'Check its shape and sizes: the depth or diameter must be above 0.'],
  121: ['A pump has a missing or invalid pump curve.', 'Choose a pump curve that exists in [CURVES], with rising values.'],
  122: ['A pump’s startup depth is not higher than its shutoff depth.', 'Raise the startup depth above the shutoff depth, or set startup to 0.'],
  131: ['Some links form a loop that kinematic wave routing can’t handle.', 'Use dynamic wave routing, or remove the loop.'],
  133: ['A node has more than one outlet link under kinematic wave routing.', 'Use dynamic wave routing, or make a flow divider.'],
  138: ['A node starts deeper than its maximum depth.', 'Lower its initial depth or raise its max depth.'],
  141: ['An outfall has more than one link connected, or a link leaving it.', 'Connect an outfall to exactly one link, flowing into it.'],
  145: ['The drainage system has no outlet that water can leave by.', 'Add an outfall and connect the network to it.'],
  156: ['Two rain gages read the same file with conflicting station IDs.', 'Make each gage’s station ID match the one in its rain file.'],
  157: ['A rain gage’s rainfall format doesn’t match its data.', 'Set the gage’s format (intensity, depth or cumulative) to match the data, on the Rainfall page.'],
  158: ['A rain gage’s time series is also used by something else.', 'Give the gage its own time series.'],
  159: ['A rain gage’s recording interval is longer than the time between its data.', 'Set the gage’s interval to the data’s time step, on the Rainfall page.'],
  171: ['A curve has invalid or out-of-order data.', 'Sort the curve’s x values from low to high in INP text → Curves.'],
  173: ['A time series has its times out of order.', 'Sort its dates and times from earliest to latest in INP text → Time series.'],
  191: ['A subcatchment has invalid infiltration parameters.', 'Check them in the inspector: they must suit the model’s infiltration method.'],
  200: ['The input file has errors.', 'See the lines that follow in the status report (INP text → Report) for each one.'],
  205: ['A line has a keyword SWMM doesn’t recognise.', 'Check the spelling on the line given, in INP text.'],
  207: ['Two objects of the same kind have the same ID.', 'Rename one of them.'],
  209: ['Something refers to an object that doesn’t exist.', 'Check the ID on the line given: add the object, or fix the name (IDs are case-sensitive).'],
  211: ['A value that should be a number isn’t.', 'Fix the value on the line given, in INP text.'],
  213: ['A date or time is not valid.', 'Dates are MM/DD/YYYY and times HH:MM:SS. Check Simulation options → Dates.'],
  317: ['SWMM could not open a rain data file.', 'Make sure the file named in the rain gage is in the project folder, or choose another on the Rainfall page.'],
  318: ['A rain data file has its dates out of order.', 'Sort the file by date and time.'],
  319: ['SWMM does not recognise the format of a rain data file.', 'Use a standard format (station, year, month, day, hour, minute, value).'],
}

const FIELD_LABELS: Record<string, string> = {
  max_depth: 'Max depth', init_depth: 'Initial depth', elevation: 'Invert elevation', length: 'Length', roughness: "Manning's n",
  geom1: 'Depth or diameter', barrels: 'Barrels', area: 'Area', width: 'Width', slope: 'Slope', pct_imperv: '% impervious',
  outlet: 'Outlet', raingage: 'Rain gage', from_node: 'Inlet node', to_node: 'Outlet node',
}

function fromText(raw: string): Omit<Explained, 'raw'> {
  const t = raw.trim()
  const code = /ERROR\s+(\d{3})/i.exec(t)
  if (code && SWMM_ERRORS[Number(code[1])]) {
    const [message, fix] = SWMM_ERRORS[Number(code[1])]
    const what = t.replace(/^.*?ERROR\s+\d{3}:?\s*/i, '').trim()
    return { message: what ? `${message} (${what})` : message, fix }
  }
  if (/failed to fetch|networkerror|load failed/i.test(t))
    return { message: 'The app couldn’t reach its engine.', fix: 'If you use the desktop app, make sure it is still running, then try again. In the browser, check your connection and reload the page.' }
  if (/no project is open/i.test(t)) return { message: 'No model is open.', fix: 'Open a model or create a new one from Projects.' }
  if (/not found/i.test(t) && /node|link|subcatchment|object|raingage|gage/i.test(t))
    return { message: t, fix: 'It may have been deleted or renamed: refresh the map, or press Undo if you just removed it.' }
  if (/already (exists|a |an )|duplicate/i.test(t)) return { message: t, fix: 'Choose a different ID: IDs must be unique among objects of the same kind.' }
  if (/invalid .*name|whitespace|space/i.test(t)) return { message: t, fix: 'IDs can’t contain spaces or start with ;. Use letters, numbers, _ or -.' }
  if (/permission|access is denied|read-only|being used by another process/i.test(t))
    return { message: t, fix: 'The file may be open in another program (EPA SWMM, Excel) or in a read-only folder. Close it there, or save the project somewhere you can write.' }
  if (/changed on disk|modified outside|mtime/i.test(t)) return { message: t, fix: 'The file was changed by another program. Reload the project to pick up those changes.' }
  if (/timed? ?out/i.test(t)) return { message: t, fix: 'Try again; a big model can take longer. If it keeps happening, restart the app.' }
  return { message: t || 'Something went wrong.' }
}

export function explainError(err: unknown): Explained {
  if (err instanceof ApiError) {
    const d = err.detail as unknown
    if (d && typeof d === 'object' && !Array.isArray(d) && 'message' in d) {
      const o = d as { message: string; field?: string; fix?: string }
      return { message: o.message, fix: o.fix ?? fromText(o.message).fix, field: o.field, raw: err.message, status: err.status }
    }
    // FastAPI validation errors: [{loc: [..., field], msg}]
    if (Array.isArray(d) && d.length && typeof d[0] === 'object') {
      const first = d[0] as { loc?: (string | number)[]; msg?: string }
      const field = String(first.loc?.[first.loc.length - 1] ?? '')
      const label = FIELD_LABELS[field] ?? field.replace(/_/g, ' ')
      return {
        message: `${label || 'A value'}: ${(first.msg ?? 'is not valid').replace(/^Input should be/, 'should be')}.`,
        fix: label ? `Correct ${label.toLowerCase()} and it saves again.` : undefined,
        field: field || undefined,
        raw: err.message,
        status: err.status,
      }
    }
    return { ...fromText(err.message), raw: err.message, status: err.status }
  }
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
  return { ...fromText(raw), raw }
}

export const explainText = (raw: string): Explained => ({ ...fromText(raw), raw })
