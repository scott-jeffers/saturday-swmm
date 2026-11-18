/** Light / dark / follow-the-system theme, applied as <html data-theme>. */
import { getPref, usePref } from './prefs'

export type ThemePref = 'system' | 'dark' | 'light'

const media = () => window.matchMedia?.('(prefers-color-scheme: light)')

export function resolvedTheme(pref = getPref('theme', 'dark') as ThemePref): 'dark' | 'light' {
  if (pref === 'system') return media()?.matches ? 'light' : 'dark'
  return pref === 'light' ? 'light' : 'dark'
}

export function applyTheme() {
  const t = resolvedTheme()
  document.documentElement.dataset.theme = t
  document.documentElement.style.colorScheme = t
}

export function installTheme() {
  applyTheme()
  window.addEventListener('saturday-swmm-prefs', applyTheme)
  window.addEventListener('storage', applyTheme)
  media()?.addEventListener?.('change', applyTheme)
}

export function useResolvedTheme(): 'dark' | 'light' {
  const pref = usePref('theme', 'dark') as ThemePref
  return resolvedTheme(pref)
}
