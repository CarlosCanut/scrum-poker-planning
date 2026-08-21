/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the rooms API (the Cloudflare Worker), e.g.
   * `https://scrum-poker-planning.<subdomain>.workers.dev`.
   *
   * Leave unset to use the same origin as the app, which is what local
   * development and the all-Cloudflare deployment do.
   */
  readonly VITE_API_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
