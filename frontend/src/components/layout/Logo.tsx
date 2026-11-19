/**
 * The Saturday-SWMM mark: a pipe cross-section flowing part full. Kept in sync
 * with public/favicon.svg so the browser tab and the app show the same logo.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="ss-logo-pipe">
          <circle cx="16" cy="16" r="8.4" />
        </clipPath>
      </defs>
      <rect width="32" height="32" rx="8" fill="#18252D" />
      <g clipPath="url(#ss-logo-pipe)">
        <path
          d="M3 16.4 C5.2 14.9 7.4 14.9 9.6 16.4 S14 17.9 16.2 16.4 S20.6 14.9 22.8 16.4 S27.2 17.9 29.4 16.4 V28 H3 Z"
          fill="#3B8FE0"
        />
      </g>
      <circle cx="16" cy="16" r="9.6" fill="none" stroke="#E7ECEE" strokeWidth="2.4" />
    </svg>
  )
}
