/**
 * Cross-origin access to the rooms API.
 *
 * When the app and the Worker share an origin (local development, and the
 * all-Cloudflare deployment) none of this matters — the browser never sends a
 * cross-origin request. It only comes into play when the app is hosted
 * elsewhere, e.g. on Vercel, and calls the Worker directly.
 *
 * `ALLOWED_ORIGINS` is a comma-separated allowlist, injected per deployment
 * rather than committed (see `.dev.vars.example`). Leaving it empty keeps the
 * API open, which is fine for local work but should be set in production.
 */

function allowlist(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean)
}

/**
 * Returns the origin to echo back, or null when the request needs no CORS
 * headers (same-origin, or no Origin header at all) or must be refused.
 */
export function resolveAllowedOrigin(
  request: Request,
  env: Env
): string | null {
  const origin = request.headers.get("Origin")
  if (!origin) return null

  // The Worker also serves the app, so its own origin is always allowed.
  if (origin === new URL(request.url).origin) return origin

  const allowed = allowlist(env)
  if (allowed.length === 0) return origin
  return allowed.includes(origin) ? origin : null
}

/**
 * True when a cross-origin request must be refused. WebSocket upgrades are not
 * covered by CORS, so the Origin header is checked explicitly instead.
 */
export function isForbiddenOrigin(request: Request, env: Env): boolean {
  // No Origin header is not a browser cross-origin request, so nothing to
  // refuse. Otherwise an unresolvable origin is one the allowlist rejected.
  if (!request.headers.get("Origin")) return false
  return resolveAllowedOrigin(request, env) === null
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    // The allowed origin varies per request, so caches must key on it.
    vary: "Origin",
  }
}

/** Answers the preflight the browser sends before a JSON POST. */
export function preflightResponse(request: Request, env: Env): Response | null {
  if (request.method !== "OPTIONS") return null

  const origin = resolveAllowedOrigin(request, env)
  if (!origin) return new Response(null, { status: 403 })

  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers":
        request.headers.get("Access-Control-Request-Headers") ?? "content-type",
      "access-control-max-age": "86400",
    },
  })
}

/**
 * Copies a response, adding the CORS headers for this request.
 *
 * Only for ordinary JSON responses — a 101 upgrade must be returned untouched,
 * and WebSocket handshakes are not subject to CORS anyway.
 */
export function withCors(response: Response, origin: string | null): Response {
  if (!origin) return response

  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
