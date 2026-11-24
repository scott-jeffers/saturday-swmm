/**
 * Keeps one broken page from taking the whole app down: the sidebar and the
 * rest stay usable, and the page shows what went wrong with a way back.
 * A page whose code can't be loaded (the site was updated while this tab was
 * open) gets a reload instead.
 */
import { Component, type ReactNode } from 'react'

export function isStaleChunkError(e: unknown) {
  const m = String((e as Error)?.message ?? e)
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|preload CSS/i.test(m)
}

const RELOAD_KEY = 'saturday-swmm.stale-reload'

/** Reload once to pick up the new version; never loop. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    /* storage blocked: still reload once */
  }
  window.location.reload()
  return true
}

type Props = { children: ReactNode; resetKey: string; /** A small inline notice (for the header), not a whole page. */ compact?: boolean }
type State = { error: Error | null; key: string }

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State) {
    // Going to another page clears the error.
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error) {
    if (isStaleChunkError(error)) reloadForNewVersion()
    console.error(error)
  }

  render() {
    const e = this.state.error
    if (!e) return this.props.children
    const stale = isStaleChunkError(e)
    if (this.props.compact)
      return (
        <span className="inline-flex min-w-0 items-center gap-2 text-[12px] text-muted" role="alert" title={e.message}>
          <span className="truncate">This part of the header hit a problem.</span>
          <button type="button" className="shrink-0 font-medium text-accent-soft hover:underline" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </span>
      )
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="m-0 text-[17px] font-semibold text-fg">{stale ? 'Saturday-SWMM was updated' : 'This page hit a problem'}</h1>
          <p className="m-0 mt-2 text-[13px] text-muted">
            {stale
              ? 'A newer version is on the site. Reload to use it; your open model stays loaded.'
              : 'The rest of the app still works. Reload, or pick another page from the sidebar.'}
          </p>
          {!stale && <pre className="mt-3 max-h-32 overflow-auto rounded-lg border border-border bg-surface p-2 text-left text-[11px] text-fg-soft">{e.message}</pre>}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-white hover:opacity-90"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
