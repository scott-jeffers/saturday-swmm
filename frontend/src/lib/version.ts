/** "0.14.0 alpha" while the app is pre-1.0; plain version after that. */
export function displayVersion(v: string | null | undefined): string {
  if (!v) return ''
  return /^0\./.test(v) ? `${v} alpha` : v
}
