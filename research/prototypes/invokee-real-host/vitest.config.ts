// THROWAWAY: isolated experiment config, outside the production test census.
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@effect/platform-node": fileURLToPath(new URL("../../../packages/dalph/node_modules/@effect/platform-node", import.meta.url)),
      "@dalph/contracts": fileURLToPath(new URL("../../../packages/contracts/src/index.ts", import.meta.url)),
      "@dalph/orchestrator": fileURLToPath(new URL("../../../packages/orchestrator/src/index.ts", import.meta.url)),
      "@dalph/dalph": fileURLToPath(new URL("../../../packages/dalph/src/index.ts", import.meta.url))
    }
  },
  test: {
    include: ["research/prototypes/invokee-real-host/host-probe.test.ts"],
    environment: "node",
    maxWorkers: 1,
    testTimeout: 90_000,
    hookTimeout: 15_000
  }
})
