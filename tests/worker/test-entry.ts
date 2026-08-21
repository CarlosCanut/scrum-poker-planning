/**
 * Worker entry used by the integration tests.
 *
 * It mounts the exact same API router and Durable Object as production, minus
 * the React Router handler (whose virtual server build only exists inside the
 * app's Vite build).
 */
import { handleApiRequest } from "../../workers/api"
import { PokerRoom } from "../../workers/durable-objects/PokerRoom"

export { PokerRoom }

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return handleApiRequest(request, env)
    }
    return new Response("Not found", { status: 404 })
  },
} satisfies ExportedHandler<Env>
