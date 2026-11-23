import * as ToastPrimitive from '@radix-ui/react-toast'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ChevronRight, Copy, Lightbulb, X } from 'lucide-react'
import { explainError, explainText, type Explained } from '../../lib/explainError'
import { Dialog, DialogContent } from './Dialog'
import { cn } from '../../lib/cn'
import { IconButton } from './IconButton'

type ToastTone = 'default' | 'success' | 'danger'

interface ToastItem {
  id: string
  title: string
  description?: string
  tone?: ToastTone
  /** Override Radix auto-dismiss ms. Danger defaults longer so errors can be read. */
  duration?: number
  /** One button, e.g. Undo. */
  action?: { label: string; onClick: () => void }
  /** Toasts with the same key replace each other instead of stacking. */
  key?: string
  /** The error behind a danger toast, for a better explanation than its text. */
  error?: unknown
  /** "Show me" for an error: select the element, open the page… */
  goTo?: { label: string; onClick: () => void }
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, 'id'>) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DEFAULT_DURATION = 4200
const DANGER_DURATION = 12000

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const [details, setDetails] = useState<{ title: string; e: Explained; goTo?: ToastItem['goTo'] } | null>(null)
  const explain = (item: ToastItem): Explained =>
    item.error != null ? explainError(item.error) : item.description ? explainText(item.description) : { message: '', raw: '' }

  const toast = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setItems((prev) => [...(item.key ? prev.filter((t) => t.key !== item.key) : prev), { ...item, id }])
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={DEFAULT_DURATION}>
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            open
            duration={
              item.duration ??
              (item.tone === 'danger' ? DANGER_DURATION : DEFAULT_DURATION)
            }
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((t) => t.id !== item.id))
            }}
            className={cn(
              'pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-[10px] border bg-elevated p-3 shadow-[var(--shadow-panel)]',
              item.tone === 'success' && 'border-success/40',
              item.tone === 'danger' && 'border-danger/50',
              (!item.tone || item.tone === 'default') && 'border-border',
            )}
          >
            {item.tone === 'danger' ? (
              // Errors open a fuller explanation, with how to fix it.
              <button
                type="button"
                className="group min-w-0 flex-1 text-left"
                onClick={() => setDetails({ title: item.title, e: explain(item), goTo: item.goTo })}
              >
                <ToastPrimitive.Title className="text-[13px] font-semibold text-fg">{item.title}</ToastPrimitive.Title>
                {explain(item).message && (
                  <ToastPrimitive.Description className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted">
                    {explain(item).message}
                  </ToastPrimitive.Description>
                )}
                {(explain(item).fix || explain(item).raw) && <span className="mt-1.5 inline-flex items-center gap-0.5 text-[11.5px] font-medium text-accent-soft group-hover:underline">
                  {explain(item).fix ? 'How to fix this' : 'Details'}
                  <ChevronRight className="h-3 w-3" aria-hidden />
                </span>}
              </button>
            ) : (
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-[13px] font-semibold text-fg">{item.title}</ToastPrimitive.Title>
                {item.description && (
                  <ToastPrimitive.Description className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted">
                    {item.description}
                  </ToastPrimitive.Description>
                )}
              </div>
            )}
            {item.action && (
              <ToastPrimitive.Action altText={item.action.label} asChild>
                <button
                  type="button"
                  onClick={item.action.onClick}
                  className="h-7 shrink-0 rounded-md px-2 text-[12px] font-medium text-accent-soft hover:bg-fg/[0.06]"
                >
                  {item.action.label}
                </button>
              </ToastPrimitive.Action>
            )}
            <ToastPrimitive.Close asChild>
              <IconButton label="Dismiss" variant="ghost" size="icon" className="h-7 w-7">
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
      <Dialog open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
        {details && (
          <DialogContent title={details.title} className="w-[min(32rem,calc(100vw-2rem))]">
            <ErrorExplanation e={details.e} />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {details.goTo && (
                <button
                  type="button"
                  onClick={() => {
                    details.goTo!.onClick()
                    setDetails(null)
                  }}
                  className="h-8 rounded-md bg-accent px-3 text-[12.5px] font-medium text-white hover:brightness-110"
                >
                  {details.goTo.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(details.e.raw)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-fg-soft hover:bg-fg/[0.06] hover:text-fg"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden /> Copy the error
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </ToastContext.Provider>
  )
}

/** What went wrong, how to fix it, and the original message. */
export function ErrorExplanation({ e }: { e: Explained }) {
  return (
    <div className="space-y-3 text-[13px]">
      <p className="m-0 leading-relaxed text-fg">{e.message}</p>
      {e.fix && (
        <div className="flex gap-2.5 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2.5">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" aria-hidden />
          <div>
            <div className="text-[11.5px] font-semibold text-fg">How to fix it</div>
            <p className="m-0 mt-0.5 leading-relaxed text-fg-soft">{e.fix}</p>
          </div>
        </div>
      )}
      {e.raw && e.raw !== e.message && (
        <details className="text-[12px] text-muted">
          <summary className="cursor-pointer select-none hover:text-fg">Original message{e.status ? ` (${e.status})` : ''}</summary>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-2 font-mono text-[11px] text-fg-soft">{e.raw}</pre>
        </details>
      )}
    </div>
  )
}
