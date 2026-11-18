import { IS_VIEWER } from '../lib/mode'
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type CrsSearchHit } from '../api/client'
import { Button, Switch } from './ui'
import { cn } from '../lib/cn'

type CrsPickerProps = {
  value: string
  onChange: (crs: string) => void
  /** When set, shows an Apply button that calls this with the current value. */
  onApply?: (crs: string) => void
  applyDisabled?: boolean
  applyPending?: boolean
  applyLabel?: string
  className?: string
  placeholder?: string
  /** Compact layout for dialogs */
  compact?: boolean
}

function normalizeAuthCode(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^\d{3,7}$/.test(s)) return `EPSG:${s}`
  if (/^epsg:\d{3,7}$/i.test(s)) return `EPSG:${s.split(':')[1]}`
  return s
}

export function CrsPicker({
  value,
  onChange,
  onApply,
  applyDisabled,
  applyPending,
  applyLabel = 'Apply',
  className,
  placeholder = 'EPSG:2272 or Pennsylvania South',
  compact = false,
}: CrsPickerProps) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [online, setOnline] = useState(false)
  const [open, setOpen] = useState(false)
  const [debouncedQ, setDebouncedQ] = useState(value)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(value.trim()), 280)
    return () => window.clearTimeout(t)
  }, [value])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const presets = useQuery({
    queryKey: ['crs-presets'],
    queryFn: api.getCrsPresets,
    staleTime: 60 * 60_000,
  })

  const search = useQuery({
    queryKey: ['crs-search', debouncedQ, online],
    queryFn: () => api.searchCrs(debouncedQ, { online, limit: 20 }),
    enabled: debouncedQ.length >= 2,
    staleTime: 30_000,
  })

  const hits = search.data?.hits ?? []
  const warning = search.data?.warning

  const pick = (hit: CrsSearchHit | string) => {
    const code = typeof hit === 'string' ? normalizeAuthCode(hit) : hit.auth_code
    onChange(code)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className={cn('relative space-y-2', className)}>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
        />
        {onApply && (
          <Button
            size="sm"
            variant="outline"
            disabled={applyDisabled || applyPending || !value.trim()}
            onClick={() => onApply(normalizeAuthCode(value))}
          >
            {applyPending ? '…' : applyLabel}
          </Button>
        )}
      </div>

      {!IS_VIEWER && (
        <label className="flex items-center justify-between gap-2 text-[11px] text-muted">
          <span>Include online (EPSG registry)</span>
          <Switch checked={online} onCheckedChange={setOnline} />
        </label>
      )}

      {presets.data && presets.data.length > 0 && (
        <div className={cn('flex flex-wrap gap-1', compact && 'max-h-16 overflow-auto')}>
          {presets.data.map((p) => (
            <button
              key={p.auth_code}
              type="button"
              title={p.name ?? p.auth_code}
              className={cn(
                'rounded-md border border-border bg-surface/80 px-1.5 py-0.5 text-[10px] text-muted hover:border-accent hover:text-fg',
                normalizeAuthCode(value) === p.auth_code &&
                  'border-accent text-fg bg-accent/10',
              )}
              onClick={() => pick(p.auth_code)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {open && debouncedQ.length >= 2 && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-40 mt-0 max-h-56 w-full overflow-auto rounded-lg border border-border bg-elevated shadow-[var(--shadow-panel)]"
        >
          {search.isFetching && (
            <p className="px-2 py-1.5 text-[11px] text-muted">Searching…</p>
          )}
          {warning && (
            <p className="border-b border-border px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              {warning}
            </p>
          )}
          {!search.isFetching && hits.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-muted">No matches</p>
          )}
          {hits.map((hit) => (
            <button
              key={`${hit.source}-${hit.auth_code}`}
              type="button"
              role="option"
              className="flex w-full flex-col gap-0.5 border-b border-border/60 px-2 py-1.5 text-left last:border-0 hover:bg-border/30"
              onClick={() => pick(hit)}
            >
              <span className="flex items-center justify-between gap-2 text-xs font-medium text-fg">
                <span>{hit.auth_code}</span>
                <span className="text-[10px] font-normal uppercase tracking-wide text-muted">
                  {hit.source === 'local' ? 'local' : 'online'}
                </span>
              </span>
              <span className="text-[11px] text-muted line-clamp-2">{hit.name}</span>
              {hit.area_of_use && (
                <span className="text-[10px] text-muted/80 line-clamp-1">
                  {hit.area_of_use}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
