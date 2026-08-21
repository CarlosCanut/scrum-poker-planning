import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        // Pure state-machine tests: no Cloudflare runtime needed.
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Real workerd + real Durable Objects.
        plugins: [
          cloudflareTest({
            main: "./tests/worker/test-entry.ts",
            miniflare: {
              compatibilityDate: "2026-08-01",
              compatibilityFlags: ["nodejs_compat"],
              durableObjects: {
                POKER_ROOMS: { className: "PokerRoom", useSQLite: true },
              },
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
        },
      },
    ],
  },
})
