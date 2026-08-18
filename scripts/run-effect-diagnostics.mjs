import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { ensureEffectTsgoPlatformBinaryExecutable } from "./effect-tsgo-platform-binary.mjs"

const requestedArguments = process.argv.slice(2)
const hasTarget = requestedArguments.some((argument) => argument === "--file" || argument === "--project")
const targetArguments = hasTarget ? requestedArguments : ["--project", "tsconfig.json", ...requestedArguments]
ensureEffectTsgoPlatformBinaryExecutable()
const result = spawnSync(
  join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "effect-tsgo.cmd" : "effect-tsgo"),
  ["diagnostics", "--strict", "--severity", "error,warning", "--format", "json", ...targetArguments],
  { stdio: "inherit" }
)

if (result.error !== undefined) throw result.error
process.exit(result.status ?? 1)
