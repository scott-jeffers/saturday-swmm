/** The SWMM status report (.rpt), readable: its sections, warnings and errors
 *  and continuity errors at a glance, and search. */

import { AlertTriangle, ChevronDown, ChevronUp, Copy, Download, FileText, Search, XCircle } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Button, Tooltip, useToast } from './ui'

export type ReportSection = { id: string; title: string; lines: string[] }
export type ParsedReport = {
  sections: ReportSection[]
  warnings: number
  errors: number
  continuity: { label: string; value: number }[]
  engine: string | null
  elapsed: string | null
}

const BANNER = /^\s*\*{5,}/

/** Split a report at its "*****" banners; the text before the first is its header. */
export function parseReport(text: string): ParsedReport {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const sections: ReportSection[] = []
  let cur: ReportSection = { id: 'rpt-header', title: 'Header and messages', lines: [] }
  let lastTitle = ''
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (BANNER.test(ln) && i + 2 < lines.length && BANNER.test(lines[i + 2]) && lines[i + 1].trim()) {
      if (cur.lines.some((l) => l.trim())) sections.push(cur)
      lastTitle = lines[i + 1].trim().split(/\s{2,}/)[0]
      cur = { id: `rpt-${sections.length}-${lastTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, title: lastTitle, lines: [ln, lines[i + 1], lines[i + 2]] }
      i += 2
      continue
    }
    cur.lines.push(ln)
  }
  if (cur.lines.some((l) => l.trim())) sections.push(cur)

  const continuity: { label: string; value: number }[] = []
  let errors = 0
  let warnings = 0
  for (const s of sections) {
    for (const l of s.lines) {
      if (/^\s*ERROR\b/i.test(l)) errors++
      else if (/^\s*WARNING\b/i.test(l)) warnings++
      const m = l.match(/Continuity Error \(%\)\s*\.+\s*(-?[\d.]+)/)
      if (m) continuity.push({ label: s.title.replace(/ Continuity$/, ''), value: Number(m[1]) })
    }
  }
  const engine = lines.find((l) => /SWMM.*VERSION/i.test(l))?.trim() ?? null
  const elapsed = lines.find((l) => /Total elapsed time/i.test(l))?.split(':').slice(1).join(':').trim() ?? null
  return { sections, warnings, errors, continuity, engine, elapsed }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function Chip({ tone, children, title }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium tabular-nums',
        tone === 'ok' && 'bg-success/12 text-success',
        tone === 'warn' && 'bg-warning/15 text-warning',
        tone === 'bad' && 'bg-danger/12 text-danger',
        tone === 'muted' && 'bg-fg/[0.06] text-fg-soft',
      )}
    >
      {children}
    </span>
  )
}

/** One line, coloured when it is an error, warning or continuity error. */
function Line({ text, query, hitBase, current, role }: { text: string; query: RegExp | null; hitBase: number; current: number; role?: 'banner' | 'title' }) {
  const err = /^\s*ERROR\b/i.test(text)
  const warn = !err && /^\s*WARNING\b/i.test(text)
  const cont = /Continuity Error \(%\)/.test(text)
  let body: ReactNode = text || ' '
  if (query && text) {
    const parts = text.split(query)
    let k = hitBase
    body = parts.map((p, i) =>
      i % 2 === 1 ? (
        <mark key={i} data-hit={k} className={cn('rounded-sm', k++ === current ? 'bg-accent text-white' : 'bg-warning/35 text-fg')}>
          {p}
        </mark>
      ) : (
        <Fragment key={i}>{p}</Fragment>
      ),
    )
  }
  if (role === 'banner' && !query) {
    const m = text.match(/^(\s*\*+)(.*)$/)
    if (m) body = [<span key="s" className="text-muted/45">{m[1]}</span>, <Fragment key="r">{m[2]}</Fragment>]
  }
  return (
    <div
      className={cn(
        'whitespace-pre px-4',
        err && 'bg-danger/10 text-danger',
        warn && 'bg-warning/10 text-warning',
        cont && 'font-semibold text-fg',
        role === 'title' && 'font-semibold text-accent-soft',
      )}
    >
      {body}
    </div>
  )
}

export function ReportNav({ report, active, onPick, className }: { report: ParsedReport; active: string | null; onPick: (id: string) => void; className?: string }) {
  return (
    <div className={className}>
      {report.sections.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s.id)}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs',
            active === s.id ? 'bg-accent/15 text-fg' : 'text-fg-soft hover:bg-fg/5',
          )}
        >
          <span className="min-w-0 flex-1 truncate">{s.title}</span>
          {s.id === 'rpt-header' && report.errors > 0 && <XCircle className="h-3 w-3 shrink-0 text-danger" aria-label="has errors" />}
          {s.id === 'rpt-header' && !report.errors && report.warnings > 0 && <AlertTriangle className="h-3 w-3 shrink-0 text-warning" aria-label="has warnings" />}
        </button>
      ))}
    </div>
  )
}

export function scrollToReportSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function StatusReportView({
  text,
  fileName,
  report,
  onActive,
}: {
  text: string
  fileName: string
  report: ParsedReport
  /** The section at the top of the view, as it scrolls. */
  onActive?: (id: string) => void
}) {
  const { toast } = useToast()
  const [q, setQ] = useState('')
  const [current, setCurrent] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const query = useMemo(() => (q.trim().length >= 2 ? new RegExp(`(${escapeRe(q.trim())})`, 'gi') : null), [q])

  // Hits per line, so each <mark> gets a running number.
  const { bases, total } = useMemo(() => {
    const out: number[][] = []
    let n = 0
    for (const s of report.sections) {
      out.push(
        s.lines.map((l) => {
          const b = n
          if (query) n += (l.match(new RegExp(query.source, 'gi')) ?? []).length
          return b
        }),
      )
    }
    return { bases: out, total: n }
  }, [report, query])
  useEffect(() => setCurrent(0), [query])
  useEffect(() => {
    if (!total) return
    scroller.current?.querySelector(`[data-hit="${current}"]`)?.scrollIntoView({ block: 'center' })
  }, [current, total, query])

  // Which section is at the top.
  useEffect(() => {
    const root = scroller.current
    if (!root || !onActive) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) onActive(top.target.id)
      },
      { root, rootMargin: '0px 0px -80% 0px' },
    )
    root.querySelectorAll('section[id^="rpt-"]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [report, onActive])

  const step = (d: number) => total && setCurrent((c) => (c + d + total) % total)
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = fileName
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
  const contTone = (v: number) => (Math.abs(v) <= 1 ? 'ok' : Math.abs(v) <= 5 ? 'warn' : 'bad')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-elevated">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-fg">{fileName}</div>
          <div className="truncate text-[11px] text-muted">
            {[report.engine, report.elapsed && `ran in ${report.elapsed}`].filter(Boolean).join(' · ') || 'Status report'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {report.errors > 0 && <Chip tone="bad"><XCircle className="h-3 w-3" aria-hidden />{report.errors} error{report.errors === 1 ? '' : 's'}</Chip>}
          <Chip tone={report.warnings ? 'warn' : 'ok'}>
            {report.warnings ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
            {report.warnings ? `${report.warnings} warning${report.warnings === 1 ? '' : 's'}` : 'No warnings'}
          </Chip>
          {report.continuity.map((c) => (
            <Chip key={c.label} tone={contTone(c.value)} title={`${c.label} continuity error. Under 1 % is good; over 5 % needs a look.`}>
              {c.label} {c.value > 0 ? '+' : ''}{c.value.toFixed(2)} %
            </Chip>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
            <input
              className="field h-8 w-48 pl-8 pr-14 text-[12.5px]"
              placeholder="Find in report"
              aria-label="Find in report"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
                if (e.key === 'Escape') setQ('')
              }}
            />
            {query && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted">{total ? `${current + 1}/${total}` : '0'}</span>}
          </div>
          <Tooltip content="Previous (Shift+Enter)">
            <button type="button" aria-label="Previous match" disabled={!total} onClick={() => step(-1)} className="inline-flex h-8 w-7 items-center justify-center rounded-md text-muted hover:bg-fg/[0.06] hover:text-fg disabled:opacity-40">
              <ChevronUp className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content="Next (Enter)">
            <button type="button" aria-label="Next match" disabled={!total} onClick={() => step(1)} className="inline-flex h-8 w-7 items-center justify-center rounded-md text-muted hover:bg-fg/[0.06] hover:text-fg disabled:opacity-40">
              <ChevronDown className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content="Copy the report">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Copy the report"
              onClick={() => void navigator.clipboard.writeText(text).then(() => toast({ title: 'Report copied', tone: 'success' }))}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={`Download ${fileName}`}>
            <Button size="sm" variant="ghost" aria-label={`Download ${fileName}`} onClick={download}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto py-2 font-mono text-[12px] leading-[1.55] text-fg-soft">
        {report.sections.map((s, si) => (
          <section key={s.id} id={s.id} className="scroll-mt-2">
            {s.lines.map((l, li) => (
              <Line
                key={li}
                text={l}
                query={query}
                hitBase={bases[si]?.[li] ?? 0}
                current={current}
                role={s.id !== 'rpt-header' && li < 3 ? (li === 1 ? 'title' : 'banner') : undefined}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
