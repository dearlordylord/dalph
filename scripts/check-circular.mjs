import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

const candidates = ["src", "packages", "scripts"]
const roots = candidates.filter(existsSync)

if (roots.length === 0) {
  process.exitCode = 0
} else {
  const result = spawnSync(
    "pnpm",
    ["exec", "madge", "--extensions", "ts,tsx", "--circular", ...roots],
    { stdio: "inherit" }
  )

  if (result.error !== undefined) {
    throw result.error
  }

  process.exitCode = result.status ?? 1
}
