import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { coveragePolicy } from "./scripts/coverage-policy.mjs"

const coverageThresholds = Object.fromEntries(
  coveragePolicy.metrics.map((metric) => [metric, coveragePolicy.threshold])
)

const mbtTestPattern = "packages/**/*.mbt.test.ts"
const performanceTestPattern = "packages/**/*.performance.test.ts"
const ordinaryTestTimeoutMilliseconds = 10_000
const coverageTestTimeoutMilliseconds = 20_000
const coverageWorkerCount = 2
const ordinaryWorkerCount = 4
const ordinaryTestIncludes = [
  "src/**/*.test.ts",
  "packages/**/*.test.ts",
  "scripts/**/*.test.ts",
  "test/**/*.test.ts"
]

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@dalph/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      "@dalph/dalph": fileURLToPath(new URL("./packages/dalph/src/index.ts", import.meta.url)),
      "@dalph/executor": fileURLToPath(new URL("./packages/executor/src/index.ts", import.meta.url)),
      "@dalph/orchestrator": fileURLToPath(new URL("./packages/orchestrator/src/index.ts", import.meta.url))
    }
  },
  test: {
    coverage: {
      exclude: [
        "**/*.d.ts",
        "**/*.test.ts",
        "**/*.spec.ts",
        "test/**"
      ],
      include: ["src/**/*.ts", "packages/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: coverageThresholds
    },
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ...(mode === "coverage" ? [mbtTestPattern, performanceTestPattern] : [])
    ],
    include: mode === "mbt" ? [mbtTestPattern] : ordinaryTestIncludes,
    maxWorkers: mode === "coverage" ? coverageWorkerCount : ordinaryWorkerCount,
    testTimeout: mode === "coverage" ? coverageTestTimeoutMilliseconds : ordinaryTestTimeoutMilliseconds
  }
}))
