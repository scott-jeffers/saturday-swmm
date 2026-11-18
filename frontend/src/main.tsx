import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { installApiFetch } from './lib/apiFetch'
import { installTheme } from './lib/theme'

import { IS_VIEWER } from './lib/mode'

installTheme()

// The viewer answers /api in the browser from dropped files; the desktop app
// talks to its local server.
if (IS_VIEWER) {
  const { installViewerFetch } = await import('./viewer/router')
  const { restore } = await import('./viewer/store')
  installViewerFetch()
  await restore()
} else {
  installApiFetch()
}
const Router = IS_VIEWER ? HashRouter : BrowserRouter

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <App />
      </Router>
    </QueryClientProvider>
  </StrictMode>,
)
