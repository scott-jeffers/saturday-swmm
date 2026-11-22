/**
 * Rainfall data from the web, fetched by the browser itself (the desktop app
 * fetches the same through its local server).
 *
 * NOAA Atlas 14: the Precipitation Frequency Data Server doesn't allow other
 * websites to fetch from it, but its own map loads the numbers as a small
 * script ("quantiles = [[…]]"), and any page may load a script. We load it in
 * a sandboxed frame that can't touch this page, read the table from it, and
 * rebuild the CSV the desktop's /api/noaa/pfds returns, so the Rainfall page
 * works the same in both.
 *
 * Open-Meteo allows browser requests, so it is fetched directly.
 */

const PFDS_SCRIPT = 'https://hdsc.nws.noaa.gov/cgi-bin/hdsc/new/cgi_readH5.py'
const DURATIONS = ['5-min', '10-min', '15-min', '30-min', '60-min', '2-hr', '3-hr', '6-hr', '12-hr', '24-hr', '2-day', '3-day', '4-day', '7-day', '10-day', '20-day', '30-day', '45-day', '60-day']
const ARIS = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000]

export class WebDataError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The PFDS depth table for a point: rows are durations, columns return periods (inches). */
function loadPfdsTable(lat: number, lon: number, series: 'pds' | 'ams'): Promise<string[][]> {
  const src = `${PFDS_SCRIPT}?${new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4), type: 'pf', data: 'depth', units: 'english', series })}`
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    // allow-scripts without allow-same-origin: NOAA's script runs in an opaque
    // origin and can only post a message back.
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.style.display = 'none'
    const done = (fn: () => void) => {
      window.removeEventListener('message', onMsg)
      clearTimeout(timer)
      frame.remove()
      fn()
    }
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return
      const d = e.data as { noaa?: { result: unknown; quantiles: unknown }; noaaErr?: string }
      if (d?.noaaErr) return done(() => reject(new WebDataError(503, 'Could not reach NOAA’s precipitation frequency server. Check your connection and try again.')))
      const q = d?.noaa?.quantiles
      if (d?.noaa?.result !== 'values' || !Array.isArray(q) || !q.length)
        return done(() => reject(new WebDataError(404, 'No NOAA Atlas 14 data for this location. Atlas 14 covers most of the US and its territories.')))
      done(() => resolve((q as unknown[][]).map((row) => row.map((v) => String(v)))))
    }
    const timer = setTimeout(() => done(() => reject(new WebDataError(504, 'NOAA didn’t answer in time. Try again in a minute.'))), 30000)
    window.addEventListener('message', onMsg)
    frame.srcdoc = `<!doctype html><script>
      var send = function (m) { parent.postMessage(m, '*') }
      window.onerror = function () { send({ noaaErr: 'script' }) }
    </script><script src="${src.replace(/"/g, '&quot;')}" onload="send({ noaa: { result: typeof result !== 'undefined' ? result : null, quantiles: typeof quantiles !== 'undefined' ? quantiles : null } })" onerror="send({ noaaErr: 'load' })"></script>`
    document.body.appendChild(frame)
  })
}

/** NOAA Atlas 14 depths as the CSV NOAA's own download gives (what the Rainfall page parses). */
export async function noaaPfdsCsv(lat: number, lon: number, series: 'pds' | 'ams' = 'pds'): Promise<string> {
  const table = await loadPfdsTable(lat, lon, series)
  const lines = [
    'Point precipitation frequency estimates (inches)',
    'NOAA Atlas 14',
    `Data type: Precipitation depth`,
    `Time series type: ${series === 'pds' ? 'Partial duration' : 'Annual maximum'}`,
    'Project area: (from the precipitation frequency data server)',
    `Location name (ESRI Maps): `,
    `Latitude: ${lat.toFixed(4)} Degree`,
    `Longitude: ${lon.toFixed(4)} Degree`,
    'Elevation (USGS): ',
    '',
    'PRECIPITATION FREQUENCY ESTIMATES',
    `by duration for ARI (years):, ${ARIS.join(',')}`,
    ...table.slice(0, DURATIONS.length).map((row, i) => `${DURATIONS[i]}:, ${row.slice(0, ARIS.length).join(',')}`),
  ]
  return lines.join('\n')
}

async function openMeteo(url: string, source: string, range?: { start: string; end: string }) {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new WebDataError(503, 'Could not connect to Open-Meteo. Check your connection.')
  }
  if (!res.ok) throw new WebDataError(502, `Open-Meteo responded with status ${res.status}.`)
  const payload = (await res.json()) as { hourly?: { time?: string[] } } & Record<string, unknown>
  const times = payload.hourly?.time ?? []
  if (!times.length) throw new WebDataError(502, 'Open-Meteo returned no hourly data for this point.')
  payload._saturday_swmm = { start_date: range?.start ?? times[0]!.slice(0, 10), end_date: range?.end ?? times[times.length - 1]!.slice(0, 10), source }
  return payload
}

/** ERA5-Land hourly precipitation and temperature, as the desktop's /api/openmeteo/archive. */
export function openMeteoArchive(q: URLSearchParams) {
  const year = q.get('year')
  const start = q.get('start_date') ?? (year ? `${year}-01-01` : null)
  const end = q.get('end_date') ?? (year ? `${year}-12-31` : null)
  if (!start || !end) throw new WebDataError(400, 'Give a year, or a start and end date.')
  const p = new URLSearchParams({ latitude: q.get('lat') ?? '', longitude: q.get('lon') ?? '', start_date: start, end_date: end, hourly: 'precipitation,temperature_2m', timezone: 'auto' })
  return openMeteo(`https://archive-api.open-meteo.com/v1/archive?${p}`, 'archive-api.open-meteo.com', { start, end })
}

/** The hourly forecast, as the desktop's /api/openmeteo/forecast. */
export function openMeteoForecast(q: URLSearchParams) {
  const p = new URLSearchParams({
    latitude: q.get('lat') ?? '',
    longitude: q.get('lon') ?? '',
    hourly: 'precipitation,temperature_2m',
    past_days: q.get('past_days') ?? '1',
    forecast_days: q.get('forecast_days') ?? '7',
    timezone: 'auto',
  })
  return openMeteo(`https://api.open-meteo.com/v1/forecast?${p}`, 'api.open-meteo.com (forecast)')
}
