/**
 * Adds the `X-Saturday-SWMM` header to every same-origin `/api` request.
 *
 * The backend refuses state-changing requests without it, which stops other
 * websites from triggering actions on the local server with a plain form post
 * (browsers won't let a foreign page set custom headers without CORS approval).
 * Installed once at startup, so every fetch — ours, react-query's, MapLibre's —
 * is covered without threading the header through each call site.
 */
export const CLIENT_HEADER = 'X-Saturday-SWMM'

function isApiUrl(input: RequestInfo | URL): boolean {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (raw.startsWith('/api/') || raw === '/api') return true
  try {
    const u = new URL(raw, window.location.href)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

export function installApiFetch(): void {
  const w = window as Window & { __saturdayFetch?: boolean }
  if (w.__saturdayFetch) return
  w.__saturdayFetch = true
  const original = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiUrl(input)) return original(input, init)
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    headers.set(CLIENT_HEADER, '1')
    return original(input, { ...init, headers })
  }
}
