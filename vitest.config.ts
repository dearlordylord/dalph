import { defineConfig } from "vitest/config"
import { coveragePolicy } from "./scripts/coverage-policy.mjs"

const coverageThresholds = Object.fromEntries(
  coveragePolicy.metrics.map((metric) => [metric, coveragePolicy.threshold])
)

const mbtTestPattern = "packages/**/*.mbt.test.ts"
const ordinaryTestIncludes = [
  "src/**/*.test.ts",
  "packages/**/*.test.ts",
  "scripts/**/*.test.ts",
  "test/**/*.test.ts"
]

export default defineConfig(({ mode }) => ({
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
    exclude: mode === "coverage" ? [mbtTestPattern] : [],
    include: mode === "mbt" ? [mbtTestPattern] : ordinaryTestIncludes,
    maxWorkers: 4,
    testTimeout: 10_000
  }
}))
