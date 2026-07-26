import { startVitest } from "vitest/node"

const context = await startVitest(
  "test",
  [],
  { run: true },
  { test: { include: ["src/**/*.test.mts"] } }
)

await context?.close()
