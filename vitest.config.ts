import { defineConfig } from "vitest/config"
import { coveragePolicy } from "./scripts/coverage-policy.mjs"

const coverageThresholds = Object.fromEntries(
  coveragePolicy.metrics.map((metric) => [metric, coveragePolicy.threshold])
)

export default defineConfig({
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
    include: [
      "src/**/*.test.ts",
      "packages/**/*.test.ts",
      "test/**/*.test.ts"
    ],
    maxWorkers: 4,
    testTimeout: 10_000
  }
})
