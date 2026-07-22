import { defineConfig } from "vitest/config"

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
      thresholds: {
        branches: 99,
        functions: 99,
        lines: 99,
        statements: 99
      }
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
