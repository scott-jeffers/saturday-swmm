/**
 * Print or export the map as a page: title block, the map as it is on screen
 * (with labels), its legend, a scale bar, a north arrow and the date. Prints
 * through the browser (so "Save as PDF" works) or downloads a PNG.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Printer } from 'lucide-react'
import { Button, Dialog, DialogContent, useToast } from '../ui'
import { getCurrentMap } from '../../lib/mapRegistry'

const PAPERS = {
  letter: { label: 'Letter landscape (11 × 8.5 in)', css: 'letter landscape', w: 1056, h: 816 },
  tabloid: { label: 'Tabloid landscape (17 × 11 in)', css: '17in 11in', w: 1632, h: 1056 },
  a4: { label: 'A4 landscape', css: 'A4 landscape', w: 1123, h: 794 },
  a3: { label: 'A3 landscape', css: 'A3 landscape', w: 1587, h: 1123 },
} as const
type Paper = keyof typeof PAPERS

/** A round length for a scale bar about `target` long. */
function niceLength(target: number) {
  const p = 10 ** Math.floor(Math.log10(target))
  for (const m of [5, 2, 1]) if (m * p <= target) return m * p
  return p
}

function haversineM(a: [number, number], b: [number, number]) {
  const R = 6371008.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

type Capture = { img: string; cssWidth: number; metersPerPx: number; bearing: number; legends: string[] }

async function captureMap(): Promise<Capture | null> {
  const map = getCurrentMap()
  if (!map) return null
  const img = await new Promise<string>((resolve) => {
    map.once('render', () => {
      const base = map.getCanvas()
      const out = document.createElement('canvas')
      out.width = base.width
      out.height = base.height
      const ctx = out.getContext('2d')!
      ctx.drawImage(base, 0, 0)
      // Labels are drawn on their own canvas over the map.
      const labels = map.getContainer().querySelector<HTMLCanvasElement>('canvas.ss-map-labels')
      if (labels) ctx.drawImage(labels, 0, 0, out.width, out.height)
      resolve(out.toDataURL('image/png'))
    })
    map.triggerRepaint()
  })
  const el = map.getContainer()
  const y = el.clientHeight / 2
  const a = map.unproject([el.clientWidth / 2 - 50, y])
  const b = map.unproject([el.clientWidth / 2 + 50, y])
  const metersPerPx = haversineM([a.lng, a.lat], [b.lng, b.lat]) / 100
  // The legends on screen (results colours, element types, a colour-by theme).
  const scope = el.closest('main') ?? document
  const legends = [...scope.querySelectorAll<HTMLElement>('.map-overlay')]
    .filter((n) => /legend|element types|color|colour/i.test(n.textContent?.slice(0, 40) ?? '') && n.offsetParent !== null && n.tagName !== 'BUTTON')
    .map((n) => {
      const c = n.cloneNode(true) as HTMLElement
      // Buttons with words (a legend's max value) become plain text; icon-only ones go.
      c.querySelectorAll('button, [role="button"]').forEach((x) => {
        const t = x.textContent?.trim()
        if (t) {
          const span = document.createElement('span')
          span.textContent = t
          x.replaceWith(span)
        } else x.remove()
      })
      // On-screen hints ("Click a max to…", "Switch to Results…") mean nothing on paper.
      c.querySelectorAll('p, div, span').forEach((x) => {
        if (x.children.length === 0 && /^(click|switch|tap|drag)\b/i.test(x.textContent?.trim() ?? '')) x.remove()
      })
      return c.innerHTML
    })
  return { img, cssWidth: el.clientWidth, metersPerPx, bearing: map.getBearing(), legends }
}

export function PrintMapDialog({
  open,
  onOpenChange,
  defaultTitle,
  defaultSubtitle,
  us,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultTitle: string
  defaultSubtitle: string
  us: boolean
}) {
  const { toast } = useToast()
  const [cap, setCap] = useState<Capture | null>(null)
  const [title, setTitle] = useState(defaultTitle)
  const [subtitle, setSubtitle] = useState(defaultSubtitle)
  const [notes, setNotes] = useState('')
  const [paper, setPaper] = useState<Paper>(us ? 'letter' : 'a4')
  const [withLegend, setWithLegend] = useState(true)
  const [printing, setPrinting] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle(defaultTitle)
    setSubtitle(defaultSubtitle)
    setCap(null)
    void captureMap().then(setCap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const P = PAPERS[paper]
  const margin = 36
  const titleH = 64
  const mapW = P.w - margin * 2
  const mapH = P.h - margin * 2 - titleH - 28
  // Scale bar: the map image is drawn mapW wide; it was cssWidth on screen.
  const scale = useMemo(() => {
    if (!cap) return null
    const mPerPagePx = cap.metersPerPx * (cap.cssWidth / mapW)
    const unit = us ? 0.3048 : 1
    const targetUnits = (mapW / 5) * mPerPagePx / unit
    const big = us ? targetUnits >= 5280 : targetUnits >= 1000
    const len = big ? niceLength(targetUnits / (us ? 5280 : 1000)) * (us ? 5280 : 1000) : niceLength(targetUnits)
    const px = (len * unit) / mPerPagePx
    const label = big ? `${len / (us ? 5280 : 1000)} ${us ? 'mi' : 'km'}` : `${len.toLocaleString('en-US')} ${us ? 'ft' : 'm'}`
    return { px, label }
  }, [cap, mapW, us])
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

  const page = (
    <div
      ref={pageRef}
      className="ss-print-page"
      style={{ width: P.w, height: P.h, padding: margin, background: '#fff', color: '#111', fontFamily: 'Inter, system-ui, sans-serif', position: 'relative', boxSizing: 'border-box' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: titleH, borderBottom: '2px solid #111', paddingBottom: 8, boxSizing: 'border-box' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 650, lineHeight: 1.15 }}>{title || 'Untitled map'}</div>
          {subtitle && <div style={{ fontSize: 12.5, color: '#444', marginTop: 4 }}>{subtitle}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#444', lineHeight: 1.4 }}>
          {today}
          <br />
          Saturday-SWMM
        </div>
      </div>
      <div style={{ position: 'relative', width: mapW, height: mapH, marginTop: 12, border: '1px solid #999', overflow: 'hidden', background: '#f3f3f3' }}>
        {cap ? (
          <img src={cap.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#666', fontSize: 13 }}>Capturing the map…</div>
        )}
        {withLegend && cap && cap.legends.length > 0 && (
          <div className="ss-print-legend" style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            {cap.legends.map((html, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.94)', border: '1px solid #bbb', borderRadius: 6, padding: 10, fontSize: 11, width: 190 }} dangerouslySetInnerHTML={{ __html: html }} />
            ))}
          </div>
        )}
        {cap && (
          <div style={{ position: 'absolute', left: 10, top: 10, width: 38, height: 52, background: 'rgba(255,255,255,0.94)', border: '1px solid #bbb', borderRadius: 6, display: 'grid', placeItems: 'center' }}>
            <svg width="22" height="40" viewBox="0 0 22 40" style={{ transform: `rotate(${-cap.bearing}deg)` }} aria-label="North">
              <path d="M11 2 L19 26 L11 21 L3 26 Z" fill="#111" />
              <text x="11" y="38" textAnchor="middle" fontSize="10" fontWeight="700" fill="#111">N</text>
            </svg>
          </div>
        )}
        {scale && (
          <div style={{ position: 'absolute', left: 10, bottom: 10, background: 'rgba(255,255,255,0.94)', border: '1px solid #bbb', borderRadius: 6, padding: '6px 10px', fontSize: 11 }}>
            <div style={{ display: 'flex', width: scale.px, height: 7, border: '1px solid #111' }}>
              <div style={{ flex: 1, background: '#111' }} />
              <div style={{ flex: 1, background: '#fff' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: scale.px, marginTop: 2 }}>
              <span>0</span>
              <span>{scale.label}</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 8, fontSize: 10.5, color: '#444' }}>
        <span style={{ whiteSpace: 'pre-wrap' }}>{notes}</span>
        <span style={{ flexShrink: 0 }}>Basemap © OpenStreetMap contributors. Model results: EPA SWMM / OpenSWMM.</span>
      </div>
    </div>
  )

  const doPrint = () => {
    setPrinting(true)
    const style = document.createElement('style')
    style.textContent = `@page { size: ${P.css}; margin: 0 }`
    document.head.appendChild(style)
    document.body.classList.add('ss-printing-map')
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print()
        document.body.classList.remove('ss-printing-map')
        style.remove()
        setPrinting(false)
      }),
    )
  }
  const doPng = async () => {
    if (!pageRef.current) return
    try {
      const { toPng } = await import('html-to-image')
      const url = await toPng(pageRef.current, { pixelRatio: 2, backgroundColor: '#ffffff' })
      const a = document.createElement('a')
      a.href = url
      a.download = `${(title || 'map').replace(/[^\w.-]+/g, '_')}.png`
      a.click()
    } catch (e) {
      toast({ title: 'Couldn’t make the image', description: (e as Error).message, tone: 'danger' })
    }
  }

  const previewScale = Math.min(1, 760 / P.w)
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title="Print or export the map" description="The map as it is on screen, with a title, legend, scale bar and north arrow." className="w-[min(1100px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto">
          <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
            <div className="space-y-3 text-[12.5px]">
              <label className="block font-medium text-fg-soft">
                Title
                <input className="field mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="block font-medium text-fg-soft">
                Subtitle
                <input className="field mt-1 w-full" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
              </label>
              <label className="block font-medium text-fg-soft">
                Notes
                <textarea className="field mt-1 h-20 w-full py-1.5" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Prepared by…, figure number, disclaimers" />
              </label>
              <label className="block font-medium text-fg-soft">
                Paper
                <select className="field mt-1 w-full" value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
                  {(Object.keys(PAPERS) as Paper[]).map((k) => (
                    <option key={k} value={k}>
                      {PAPERS[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-fg-soft">
                <input type="checkbox" checked={withLegend} onChange={(e) => setWithLegend(e.target.checked)} /> Legend
                {cap && cap.legends.length === 0 && <span className="text-[11px] text-muted">(none on the map)</span>}
              </label>
              <p className="m-0 text-[11.5px] text-muted">Pan, zoom and turn on labels or results on the map first; close this and reopen to refresh.</p>
              <div className="flex flex-col gap-2 pt-1">
                <Button variant="primary" disabled={!cap || printing} onClick={doPrint}>
                  <Printer className="h-3.5 w-3.5" /> Print or save as PDF
                </Button>
                <Button variant="outline" disabled={!cap} onClick={() => void doPng()}>
                  <Download className="h-3.5 w-3.5" /> Download PNG
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-border bg-fg/5 p-3">
              <div style={{ width: P.w * previewScale, height: P.h * previewScale }}>
                <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left', boxShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>{page}</div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {printing && createPortal(<div className="ss-print-root">{page}</div>, document.body)}
    </>
  )
}
