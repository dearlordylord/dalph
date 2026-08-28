import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { coveragePolicy } from "./scripts/coverage-policy.mjs"

const coverageThresholds = Object.fromEntries(
  coveragePolicy.metrics.map((metric) => [metric, coveragePolicy.globalThresholds[metric]])
)

const mbtTestPattern = "packages/**/*.mbt.test.ts"
const acceptedResultIntegrationMbtTestPattern =
  "packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts"
// These ordinary tests exercise production conformance seams; their exhaustive
// Quint traces remain mode-gated by quintIt itself.
const coverageExcludedMbtTestPattern =
  "packages/**/!(run-activation|run-cancellation|task-fact-reconciliation).mbt.test.ts"
const performanceTestPattern = "packages/**/*.performance.test.ts"
const ordinaryTestTimeoutMilliseconds = 10_000
const coverageTestTimeoutMilliseconds = 30_000
const ordinaryWorkerCount = 4
// V8 instrumentation and project-audit tests compete for CPU and memory. Two
// workers keep individual 30-second test budgets meaningful on the supported
// local/hosted runners instead of timing out otherwise passing tests.
const coverageWorkerCount = 2
const ordinaryTestIncludes = ["src/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.ts", "test/**/*.test.ts"]

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@dalph/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      "@dalph/dalph": fileURLToPath(new URL("./packages/dalph/src/index.ts", import.meta.url)),
      "@dalph/orchestrator": fileURLToPath(new URL("./packages/orchestrator/src/index.ts", import.meta.url))
    }
  },
  test: {
    coverage: {
      exclude: ["**/*.d.ts", "**/*.test.ts", "**/*.spec.ts", "test/**"],
      include: ["src/**/*.ts", "packages/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: coverageThresholds
    },
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ...(mode === "coverage" ? [coverageExcludedMbtTestPattern, performanceTestPattern] : [])
    ],
    include: mode === "mbt" ? [mbtTestPattern] : ordinaryTestIncludes,
    maxWorkers: mode === "coverage" ? coverageWorkerCount : ordinaryWorkerCount,
    ...(mode === "mbt"
      ? {
          // Running the accepted-result model beside the other MBTs can starve
          // their shorter deadlines. Finish the four-worker group first, then
          // give that model one worker without weakening either trace budget.
          projects: [
            {
              test: {
                exclude: [acceptedResultIntegrationMbtTestPattern],
                include: [mbtTestPattern],
                maxWorkers: ordinaryWorkerCount,
                name: "mbt",
                sequence: { groupOrder: 0 }
              }
            },
            {
              test: {
                fileParallelism: false,
                include: [acceptedResultIntegrationMbtTestPattern],
                maxWorkers: 1,
                name: "accepted-result-integration-mbt",
                sequence: { groupOrder: 1 }
              }
            }
          ]
        }
      : {}),
    testTimeout: mode === "coverage" ? coverageTestTimeoutMilliseconds : ordinaryTestTimeoutMilliseconds
  }
}))
