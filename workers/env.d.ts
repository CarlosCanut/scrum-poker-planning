/**
 * Bindings that are injected per deployment instead of being declared in
 * `wrangler.jsonc`, so cloning this repo never reveals anybody's domains.
 *
 * `wrangler types` only generates types for bindings it can see in the config
 * file, so this one is declared by hand and merged into the generated `Env`.
 * It is typed as a plain `string` to stay identical to the declaration wrangler
 * emits when a local `.dev.vars` happens to be present — the value really can
 * be missing at runtime, which `workers/cors.ts` treats as "unset".
 */
interface Env {
  /**
   * Comma-separated origins allowed to call the rooms API from a browser, e.g.
   * `https://poker.example.com,https://poker-preview.example.com`.
   *
   * Unset or empty means no restriction. Set it whenever the app is hosted
   * apart from this Worker; see `.dev.vars.example`.
   */
  ALLOWED_ORIGINS: string
}
