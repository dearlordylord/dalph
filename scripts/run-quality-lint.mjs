import { spawnSync } from "node:child_process"
import { extname, join } from "node:path"
import { discoverQualityFiles } from "./quality-file-discovery.mjs"
import { selectCompatibilityFiles } from "./quality-lint-policy.mjs"

const options = new Set(process.argv.slice(2).filter((argument) => argument.startsWith("--")))
const explicitFiles = process.argv.slice(2).filter((argument) => !argument.startsWith("--"))
const staged = options.has("--staged")
const fix = options.has("--fix")
const allFiles = await discoverQualityFiles()
const selectedFiles = explicitFiles.length === 0 ? allFiles : await discoverQualityFiles({ explicitFiles })
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

const { compatibilityFiles, selectedCompatibilityFiles } = selectCompatibilityFiles({ allFiles, selectedFiles, staged })
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

if (staged && fix) {
  runCompatibility(compatibilityFiles, false)
  runCompatibility(selectedCompatibilityFiles, true)
} else {
  runCompatibility(compatibilityFiles, fix)
}

if (selectedFiles.length > 0) {
  run(executable("dprint"), [fix ? "fmt" : "check", ...selectedFiles])
}
