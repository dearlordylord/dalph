import { spawnSync } from "node:child_process"
import { extname, join } from "node:path"
import { changedRepositoryFiles } from "./changed-files.mjs"
import { discoverQualityFiles } from "./quality-file-discovery.mjs"
import { selectCompatibilityFiles } from "./quality-lint-policy.mjs"

const options = new Set(process.argv.slice(2).filter((argument) => argument.startsWith("--")))
const explicitFiles = process.argv.slice(2).filter((argument) => !argument.startsWith("--"))
const staged = options.has("--staged")
const fix = options.has("--fix")
const changedOnly = options.has("--changed")
const baseReference = process.env["DALPH_DIAGNOSTICS_BASE"] ?? "origin/master"
const compatibility = options.has("--compatibility")
const withoutCompatibility = options.has("--without-compatibility")
const allFiles = await discoverQualityFiles()
const requestedFiles =
  changedOnly && explicitFiles.length === 0 ? changedRepositoryFiles({ baseReference }) : explicitFiles
const selectedFiles =
  requestedFiles.length === 0 && !changedOnly ? allFiles : await discoverQualityFiles({ explicitFiles: requestedFiles })
const lintableExtensions = new Set([".js", ".mjs", ".ts", ".tsx"])
// Compatibility lint loads the complete TypeScript import graph even when a
// single explicit file is selected. Give that child process enough heap for
// the repository-scale graph instead of depending on the caller's Node limit.
const compatibilityLintEnvironment = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=12288"].filter(Boolean).join(" ")
}
const executable = (name) =>
  join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name)

const run = (command, arguments_, environment = process.env) => {
  const result = spawnSync(command, arguments_, { env: environment, stdio: "inherit" })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const nativeFiles = selectedFiles.filter((file) => lintableExtensions.has(extname(file)))
if (nativeFiles.length > 0) {
  run(executable("oxlint"), ["-c", ".oxlintrc.json", "--deny-warnings", ...(fix ? ["--fix"] : []), ...nativeFiles])
}

const { compatibilityFiles } = selectCompatibilityFiles({
  allFiles,
  compatibility,
  explicit: changedOnly || explicitFiles.length > 0,
  selectedFiles,
  staged,
  withoutCompatibility
})
const runCompatibility = (files, shouldFix) => {
  if (files.length === 0) return
  run(
    executable("eslint"),
    [
      "--config",
      "eslint.compat.config.mjs",
      "--max-warnings",
      "0",
      "--suppressions-location",
      "eslint-functional-suppressions.json",
      "--no-error-on-unmatched-pattern",
      ...(shouldFix ? ["--fix"] : []),
      ...files
    ],
    compatibilityLintEnvironment
  )
}

// Any fixable diagnostic makes the complete staged check exit before a
// selected-file fix pass can run. Reaching that pass means there is no fix to
// apply, so do not load the same project graph again.
runCompatibility(compatibilityFiles, fix && !staged)

if (selectedFiles.length > 0) {
  run(executable("dprint"), [fix ? "fmt" : "check", ...selectedFiles])
}
