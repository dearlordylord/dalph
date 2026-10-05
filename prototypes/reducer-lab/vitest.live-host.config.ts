import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { alias: {
    "@dalph/contracts": fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)),
    "@dalph/dalph": fileURLToPath(new URL("../../packages/dalph/src/index.ts", import.meta.url)),
    "@dalph/orchestrator": fileURLToPath(new URL("../../packages/orchestrator/src/index.ts", import.meta.url))
  } },
  test: { include: ["prototypes/reducer-lab/test/*.test.ts"],
    testTimeout: 20000, maxWorkers: 1, environment: "node" }
})
