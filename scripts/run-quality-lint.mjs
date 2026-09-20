import { spawnSync } from "node:child_process"
import { extname, join } from "node:path"
import { changedRepositoryFileSelection } from "./changed-files.mjs"
import { diagnosticBaseInput, reportDiagnosticSelection } from "./diagnostic-selection-evidence.mjs"
import { discoverQualityFiles } from "./quality-file-discovery.mjs"

const options = new Set(process.argv.slice(2).filter((argument) => argument.startsWith("--")))
const explicitFiles = process.argv.slice(2).filter((argument) => !argument.startsWith("--"))
const fix = options.has("--fix")
const census = options.has("--census")
let failedChecks = 0
const changedOnly = options.has("--changed")
const diagnosticBase = diagnosticBaseInput()
const allFiles = await discoverQualityFiles()
const changedSelection =
  changedOnly && explicitFiles.length === 0
    ? changedRepositoryFileSelection({ baseReference: diagnosticBase.baseReference })
    : undefined
const requestedFiles = changedSelection?.files ?? explicitFiles
const selectedFiles =
  requestedFiles.length === 0 && !changedOnly ? allFiles : await discoverQualityFiles({ explicitFiles: requestedFiles })
if (changedSelection !== undefined)
  reportDiagnosticSelection({
    command: "lint:changed",
    selection: changedSelection,
    selectedPaths: selectedFiles,
    source: diagnosticBase.source
  })
const lintableExtensions = new Set([".js", ".mjs", ".ts", ".tsx"])
const executable = (name) =>
  join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name)

const run = (command, arguments_, environment = process.env) => {
  const result = spawnSync(command, arguments_, { env: environment, stdio: "inherit" })
  if (result.error !== undefined) {
    if (!census) throw result.error
    failedChecks += 1
    console.error(`Lint census could not start: ${command}: ${result.error.message}`)
    return
  }
  if (result.signal !== null) process.exit(1)
  if (result.status !== 0) {
    if (!census) process.exit(result.status ?? 1)
    failedChecks += 1
    console.error(`Lint census failed: ${command} ${arguments_.join(" ")} (exit ${result.status ?? 1})`)
  }
}

const nativeFiles = selectedFiles.filter((file) => lintableExtensions.has(extname(file)))
if (nativeFiles.length > 0) {
  run(executable("oxlint"), ["-c", ".oxlintrc.json", "--deny-warnings", ...(fix ? ["--fix"] : []), ...nativeFiles])
}

if (selectedFiles.length > 0) {
  run(executable("dprint"), [
    fix ? "fmt" : "check",
    ...(process.env.DALPH_DPRINT_INCREMENTAL === "disabled" ? ["--incremental=false"] : []),
    ...selectedFiles
  ])
}

if (requestedFiles.length === 0 && !changedOnly && !fix) {
  run(process.execPath, [join(process.cwd(), "scripts", "check-unused-exports.mjs")])
}

if (failedChecks > 0) process.exitCode = 1
