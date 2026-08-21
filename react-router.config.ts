import type { Config } from "@react-router/dev/config"
import { vercelPreset } from "@vercel/react-router/vite"

/**
 * Two build targets from one codebase:
 *
 * - Cloudflare Workers (default, and what `pnpm dev` runs) — serves the app
 *   *and* the room Durable Objects.
 * - Vercel (when the build runs on Vercel, which sets `VERCEL=1`) — serves the
 *   app only; the rooms API stays on the Worker, reached via VITE_API_ORIGIN.
 */
const isVercel = Boolean(process.env.VERCEL)

export default {
  ssr: true,
  ...(isVercel ? { presets: [vercelPreset()] } : {}),
} satisfies Config
