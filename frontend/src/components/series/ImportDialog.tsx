/**
 * Bring time series in from a file or from cells copied out of a spreadsheet:
 * SWMM time series and rain files, CSV/TSV with one or more value columns,
 * a datetime column or separate date and time columns, or elapsed hours.
 */
import { FileUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { freeName, importedToSeries, readSeriesText, type TimeSeries } from '../../lib/seriesData'
import { Button, Dialog, DialogContent, Switch } from '../ui'

export function ImportDialog({
  open,
  onOpenChange,
  taken,
  replaceName,
  onImport,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  taken: string[]
  /** When set, the first column can replace this series' values. */
  replaceName?: string | null
  onImport: (series: TimeSeries[], replace: boolean) => void
}) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [dayFirst, setDayFirst] = useState(false)
  const [use, setUse] = useState<Record<number, boolean>>({})
  const [names, setNames] = useState<Record<number, string>>({})
  const [replace, setReplace] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const imp = useMemo(() => readSeriesText(text, { dayFirst }), [text, dayFirst])
  const base = fileName.replace(/\.[^.]+$/, '')
  const nameOf = (i: number) => names[i] ?? freeName(imp.names.length > 1 || !base ? imp.names[i]! : base, taken)
  const chosen = imp.names.map((_, i) => i).filter((i) => use[i] ?? true)
  const first = imp.points[0]
  const lastP = imp.points[imp.points.length - 1]
  const reset = () => {
    setText('')
    setFileName('')
    setUse({})
    setNames({})
    setReplace(false)
  }
  const done = () => {
    const used = new Set(taken)
    const out = chosen.map((i, k) => {
      const want = replace && k === 0 && replaceName ? replaceName : freeName(nameOf(i), [...used].filter((t) => !(replace && t === replaceName)))
      used.add(want)
      return importedToSeries(imp, i, want)
    })
    onImport(out, replace && Boolean(replaceName))
    reset()
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent
        className="w-[min(640px,calc(100vw-2rem))]"
        title="Import time series"
        description="From a file (SWMM .dat, rain files, CSV, TSV, TXT) or cells copied from Excel or Google Sheets. One series is made for each value column."
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
            <FileUp className="h-3.5 w-3.5" /> Choose a file
          </Button>
          <span className="min-w-0 truncate text-[12px] text-muted">{fileName || 'or paste below'}</span>
          <input
            ref={input}
            type="file"
            accept=".dat,.txt,.csv,.tsv,.prn,.tsf,text/plain,text/csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setFileName(f.name)
              setText(await f.text())
              setUse({})
              setNames({})
              e.target.value = ''
            }}
          />
        </div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setFileName('')
          }}
          placeholder={'Paste here, for example:\nDate\tTime\tFlow\n6/1/2024\t0:00\t1.25\n6/1/2024\t0:15\t1.31'}
          spellCheck={false}
          className="field mt-2 h-32 w-full resize-y py-2 font-mono text-[12px]"
        />
        {text.trim() && (
          <div className="mt-3 rounded-lg border border-border bg-fg/[0.02] p-3 text-[12.5px]">
            {imp.points.length ? (
              <>
                <p className="m-0 text-fg">
                  Read as <span className="font-medium">{imp.format}</span>: {imp.points.length.toLocaleString()} rows
                  {first && lastP && (
                    <span className="text-muted">
                      {' '}
                      · {first.date ? `${first.date} ${first.time}` : `${first.time} h`} to {lastP.date ? `${lastP.date} ${lastP.time}` : `${lastP.time} h`}
                    </span>
                  )}
                  {imp.skipped > 0 && <span className="text-muted"> · {imp.skipped} lines skipped</span>}
                </p>
                <div className="mt-2 space-y-1.5">
                  {imp.names.map((n, i) => (
                    <label key={i} className="flex items-center gap-2">
                      <input type="checkbox" checked={use[i] ?? true} onChange={(e) => setUse({ ...use, [i]: e.target.checked })} />
                      <span className="w-28 shrink-0 truncate text-muted" title={n}>
                        {n}
                      </span>
                      <span className="text-muted">→</span>
                      <input
                        value={replace && chosen[0] === i && replaceName ? replaceName : nameOf(i)}
                        disabled={replace && chosen[0] === i && Boolean(replaceName)}
                        onChange={(e) => setNames({ ...names, [i]: e.target.value.replace(/\s+/g, '_') })}
                        aria-label={`Name for ${n}`}
                        className="field h-7 min-w-0 flex-1 font-mono text-[12px]"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-fg-soft">
                  <label className="inline-flex items-center gap-2">
                    <Switch checked={dayFirst} onCheckedChange={setDayFirst} /> Dates are day first (31/12/2024)
                  </label>
                  {replaceName && (
                    <label className="inline-flex items-center gap-2">
                      <Switch checked={replace} onCheckedChange={setReplace} /> Replace the values of <span className="font-mono text-fg">{replaceName}</span>
                    </label>
                  )}
                </div>
              </>
            ) : (
              <p className="m-0 text-warning">
                Couldn’t find times and values in this. Each row needs a time (a date and time, or hours) followed by one or more numbers.
              </p>
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!imp.points.length || !chosen.length} onClick={done}>
            {replace && replaceName ? `Replace ${replaceName}` : `Import ${chosen.length > 1 ? `${chosen.length} series` : 'series'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
