/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string
  export default content
}

/** App version from the repo VERSION file (injected by vite.config.ts). */
declare const __APP_VERSION__: string
