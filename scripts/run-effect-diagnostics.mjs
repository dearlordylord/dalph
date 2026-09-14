import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { changedRepositoryFileSelection } from "./changed-files.mjs"
import { diagnosticBaseInput, reportDiagnosticSelection } from "./diagnostic-selection-evidence.mjs"
import { ensureEffectTsgoPlatformBinaryExecutable } from "./effect-tsgo-platform-binary.mjs"
import { selectDiagnosticTargets } from "./effect-diagnostics-scope.mjs"

const requestedArguments = process.argv.slice(2)
const changedOnly = requestedArguments.includes("--changed")
const passedArguments = requestedArguments.filter((argument) => argument !== "--changed")
const hasTarget = passedArguments.some((argument) => argument === "--file" || argument === "--project")
const diagnosticBase = diagnosticBaseInput()
const maximumChangedFiles = Number(process.env["DALPH_DIAGNOSTICS_MAXIMUM_FILES"] ?? "12")

const diagnosticsExecutable = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "effect-tsgo.cmd" : "effect-tsgo"
)

const runDiagnostics = (targetArguments) =>
  spawnSync(
    diagnosticsExecutable,
    ["diagnostics", "--strict", "--severity", "error,warning", "--format", "json", ...targetArguments],
    { stdio: "inherit" }
  )

const settle = (result) => {
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}

ensureEffectTsgoPlatformBinaryExecutable()

if (!changedOnly || hasTarget) {
  const targetArguments = hasTarget ? passedArguments : ["--project", "tsconfig.json", ...passedArguments]
  process.exit(settle(runDiagnostics(targetArguments)))
}

const changedSelection = changedRepositoryFileSelection({ baseReference: diagnosticBase.baseReference })
const { files, scope } = selectDiagnosticTargets({
  changedFiles: changedSelection.files,
  maximumFiles: maximumChangedFiles
})
reportDiagnosticSelection({
  command: `typecheck:effect:changed:${scope}`,
  selection: changedSelection,
  selectedPaths: scope === "files" ? files : scope === "project" ? ["tsconfig.json"] : [],
  source: diagnosticBase.source
})

if (scope === "none") {
  console.log(
    `No changed TypeScript files against ${diagnosticBase.baseReference}; Effect diagnostics have nothing to check.`
  )
  process.exit(0)
}

if (scope === "project") {
  console.log(
    `More than ${maximumChangedFiles} changed TypeScript files against ${diagnosticBase.baseReference}; checking the whole project.`
  )
  process.exit(settle(runDiagnostics(["--project", "tsconfig.json", ...passedArguments])))
}

const worstStatus = files.reduce((status, file) => {
  const fileStatus = settle(runDiagnostics(["--file", file, ...passedArguments]))
  return fileStatus === 0 ? status : fileStatus
}, 0)

process.exit(worstStatus)
