import { cloudflare } from "@cloudflare/vite-plugin"
import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

/** Vercel sets this during its builds; see react-router.config.ts. */
const isVercel = Boolean(process.env.VERCEL)

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // The Cloudflare plugin decides output paths from the *user* config, so they
  // are pinned here to match React Router's `build/` layout (and the
  // `assets.directory` in wrangler.jsonc). On Vercel the preset owns the
  // output, so these must not be set.
  ...(isVercel
    ? {}
    : {
        environments: {
          client: { build: { outDir: "build/client" } },
          ssr: { build: { outDir: "build/server" } },
        },
      }),
  plugins: [
    // Only the Cloudflare target bundles the Worker + Durable Object.
    ...(isVercel ? [] : [cloudflare({ viteEnvironment: { name: "ssr" } })]),
    tailwindcss(),
    reactRouter(),
  ],
})
