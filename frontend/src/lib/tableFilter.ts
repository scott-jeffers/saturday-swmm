/**
 * Column filters and Excel paste for the Elements table.
 *
 * A filter is what an engineer would type: `> 5`, `<= 0.5`, `!= 0`, `0.1-0.5`
 * (a range) or `12` (equals) for numbers; any text is "contains" for words,
 * `=MH1` for an exact match. Blank matches everything.
 */

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`
const CMP = new RegExp(String.raw`^(>=|<=|!=|<>|>|<|=)\s*(${NUM})$`)
const RANGE = new RegExp(String.raw`^(${NUM})\s*(?:-|–|\.\.|to)\s*(${NUM})$`)

/** Does `raw` (the cell's text) pass the column filter `expr`? */
export function matchFilter(raw: string, expr: string, numeric: boolean): boolean {
  const e = expr.trim()
  if (!e) return true
  const text = raw.trim()
  if (numeric) {
    const v = Number(text)
    const has = text !== '' && Number.isFinite(v)
    const cmp = CMP.exec(e)
    if (cmp) {
      if (!has) return false
      const n = Number(cmp[2])
      switch (cmp[1]) {
        case '>': return v > n
        case '>=': return v >= n
        case '<': return v < n
        case '<=': return v <= n
        case '=': return Math.abs(v - n) < 1e-9
        default: return Math.abs(v - n) >= 1e-9 // != or <>
      }
    }
    const range = RANGE.exec(e)
    if (range) {
      if (!has) return false
      const a = Number(range[1])
      const b = Number(range[2])
      return v >= Math.min(a, b) && v <= Math.max(a, b)
    }
    if (Number.isFinite(Number(e))) return has && Math.abs(v - Number(e)) < 1e-9
  }
  if (e.startsWith('=')) return text.toLowerCase() === e.slice(1).trim().toLowerCase()
  if (e.startsWith('!=')) return !text.toLowerCase().includes(e.slice(2).trim().toLowerCase())
  return text.toLowerCase().includes(e.toLowerCase())
}

/** Is this a usable filter? (A half-typed `>` isn't, and shouldn't hide every row.) */
export function filterReady(expr: string, numeric: boolean): boolean {
  const e = expr.trim()
  if (!e) return false
  if (!numeric) return !['=', '!='].includes(e)
  return CMP.test(e) || RANGE.test(e) || Number.isFinite(Number(e)) || !/^(>=|<=|!=|<>|>|<|=)\s*$/.test(e)
}

/** Clipboard text from Excel or Sheets as rows of cells; null if it's a single value. */
export function parsePasteGrid(text: string): string[][] | null {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!t.includes('\t') && !t.includes('\n')) return null
  return t.split('\n').map((r) => r.split('\t'))
}
