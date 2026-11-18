/** Observed-vs-modelled series: parsing, alignment and goodness-of-fit numbers. */

export type Point = { t: number; v: number } // t = ms since epoch (UTC, model clock)

/** Parse "time,value" text. Time is ISO / "MM/DD/YYYY HH:MM" / hours from the model start. */
export function parseObserved(text: string, modelStartMs: number): { points: Point[]; skipped: number } {
  const points: Point[] = []
  let skipped = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const parts = line.split(/[,;\t]|\s{2,}/).map((p) => p.trim()).filter(Boolean)
    if (parts.length < 2) {
      skipped++
      continue
    }
    const v = Number(parts[parts.length - 1])
    const tt = parts.slice(0, parts.length - 1).join(' ')
    const t = parseTime(tt, modelStartMs)
    if (t == null || !Number.isFinite(v)) {
      skipped++
      continue
    }
    points.push({ t, v })
  }
  points.sort((a, b) => a.t - b.t)
  return { points, skipped }
}

function parseTime(s: string, startMs: number): number | null {
  if (/^-?\d+(\.\d+)?$/.test(s)) return startMs + Number(s) * 3_600_000 // hours
  let m = s.match(/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d?):(\d\d)(?::(\d\d))?/)
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  m = s.match(/^(\d\d?)\/(\d\d?)\/(\d{4})[ T]+(\d\d?):(\d\d)(?::(\d\d))?/)
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] ?? 0))
  return null
}

/** Linear interpolation of the modelled series at time t (null outside the run). */
export function sampleAt(series: Point[], t: number): number | null {
  if (!series.length || t < series[0].t || t > series[series.length - 1].t) return null
  let lo = 0
  let hi = series.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (series[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = series[lo]
  const b = series[hi]
  return b.t === a.t ? a.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t)
}

export type Fit = {
  n: number
  nse: number | null
  rmse: number
  peakObs: number
  peakMod: number
  peakErrPct: number | null
  peakShiftMin: number
  volErrPct: number | null
  bias: number
}

export function fitStats(observed: Point[], modelled: Point[]): Fit | null {
  const pairs: { t: number; o: number; m: number }[] = []
  for (const p of observed) {
    const m = sampleAt(modelled, p.t)
    if (m != null) pairs.push({ t: p.t, o: p.v, m })
  }
  if (pairs.length < 2) return null
  const mean = pairs.reduce((a, p) => a + p.o, 0) / pairs.length
  let ss = 0
  let st = 0
  let bias = 0
  for (const p of pairs) {
    ss += (p.o - p.m) ** 2
    st += (p.o - mean) ** 2
    bias += p.m - p.o
  }
  let po = pairs[0]
  for (const p of pairs) if (p.o > po.o) po = p
  let pm = modelled[0]
  for (const p of modelled) if (p.t >= pairs[0].t && p.t <= pairs[pairs.length - 1].t && p.v > pm.v) pm = p
  const vol = (xs: { t: number; y: number }[]) => xs.slice(1).reduce((a, p, i) => a + ((p.y + xs[i].y) / 2) * (p.t - xs[i].t), 0)
  const vo = vol(pairs.map((p) => ({ t: p.t, y: p.o })))
  const vm = vol(pairs.map((p) => ({ t: p.t, y: p.m })))
  return {
    n: pairs.length,
    nse: st > 0 ? 1 - ss / st : null,
    rmse: Math.sqrt(ss / pairs.length),
    peakObs: po.o,
    peakMod: pm.v,
    peakErrPct: po.o !== 0 ? ((pm.v - po.o) / Math.abs(po.o)) * 100 : null,
    peakShiftMin: (pm.t - po.t) / 60000,
    volErrPct: vo !== 0 ? ((vm - vo) / Math.abs(vo)) * 100 : null,
    bias: bias / pairs.length,
  }
}
