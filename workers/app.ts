import { createRequestHandler } from "react-router"

import { handleApiRequest } from "./api"
import { PokerRoom } from "./durable-objects/PokerRoom"

export { PokerRoom }

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env
      ctx: ExecutionContext
    }
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
)

/**
 * The Worker is a thin router: `/api/*` goes to the room Durable Objects,
 * everything else is rendered by React Router.
 */
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return handleApiRequest(request, env)
    }
    return requestHandler(request, { cloudflare: { env, ctx } })
  },
} satisfies ExportedHandler<Env>
