/** Find a place by name (OpenStreetMap Nominatim), to move an empty model's
 *  map to where the model goes before drawing on it. */

import { Loader2, MapPin, Search, X } from 'lucide-react'
import { useState } from 'react'

type Hit = { name: string; detail: string; west: number; south: number; east: number; north: number }

async function search(q: string): Promise<Hit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Place search answered ${res.status}`)
  const rows = (await res.json()) as { display_name: string; name?: string; boundingbox: [string, string, string, string] }[]
  return rows.map((r) => {
    const [south, north, west, east] = r.boundingbox.map(Number)
    const parts = r.display_name.split(', ')
    return { name: r.name || parts[0], detail: parts.slice(1, 4).join(', '), west, south, east, north }
  })
}

export function PlaceSearch({ onPick, onClose }: { onPick: (b: { west: number; south: number; east: number; north: number }) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    if (!q.trim()) return
    setBusy(true)
    setError(null)
    try {
      setHits(await search(q.trim()))
    } catch (e) {
      setHits(null)
      setError(e instanceof TypeError ? 'Place search needs an internet connection.' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      aria-label="Find where the model goes"
      className="pointer-events-auto absolute left-1/2 top-16 z-30 w-[min(26rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-border bg-elevated/95 p-3 shadow-[var(--shadow-panel)] backdrop-blur"
    >
      <div className="mb-2 flex items-start gap-2">
        <p className="m-0 flex-1 text-[12.5px] text-fg-soft">
          <strong className="font-semibold text-fg">Find your site</strong> to start drawing at a street scale.
        </p>
        <button type="button" aria-label="Close" onClick={onClose} className="-m-1 rounded p-1 text-muted hover:bg-fg/[0.06] hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            className="field h-8 w-full pl-8 text-[13px]"
            placeholder="A town, street or address"
            aria-label="Place to go to"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button type="submit" disabled={busy || !q.trim()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          Go
        </button>
      </form>
      {error && <p className="m-0 mt-2 text-[12px] text-danger">{error}</p>}
      {hits && !hits.length && <p className="m-0 mt-2 text-[12px] text-muted">Nothing found. Try a town name.</p>}
      {hits && hits.length > 0 && (
        <ul className="m-0 mt-2 list-none p-0">
          {hits.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fg/[0.06]"
                onClick={() => {
                  onPick(h)
                  setHits(null)
                }}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-soft" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-fg">{h.name}</span>
                  {h.detail && <span className="block truncate text-[11.5px] text-muted">{h.detail}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 mt-2 text-[10.5px] text-muted">Search by OpenStreetMap Nominatim. Or zoom in on the map yourself.</p>
    </section>
  )
}
