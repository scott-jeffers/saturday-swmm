import * as ToastPrimitive from '@radix-ui/react-toast'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
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
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-[13px] font-semibold text-fg">
                {item.title}
              </ToastPrimitive.Title>
              {item.description && (
                <ToastPrimitive.Description className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted">
                  {item.description}
                </ToastPrimitive.Description>
              )}
            </div>
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
    </ToastContext.Provider>
  )
}
