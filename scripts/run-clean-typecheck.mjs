import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// TypeScript's retained build-info has produced diagnostics that disappear when
// the same candidate is checked from a fresh state. Keep the edit-loop result
// independent of prior builds in this or another worktree.
const temporaryDirectory = mkdtempSync(join(tmpdir(), "dalph-typecheck-"))
let result
try {
  result = spawnSync(process.execPath, [
    join(process.cwd(), "node_modules", "@typescript", "native", "bin", "tsc"),
    "-p",
    "tsconfig.json",
    "--noEmit",
    "--tsBuildInfoFile",
    join(temporaryDirectory, "root.tsbuildinfo")
  ], { stdio: "inherit" })
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}

if (result.error !== undefined) throw result.error
if (result.signal !== null) process.kill(process.pid, result.signal)
else process.exitCode = result.status ?? 1
