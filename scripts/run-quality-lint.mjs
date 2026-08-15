import { spawnSync } from "node:child_process"
import { extname, join } from "node:path"
import { discoverQualityFiles } from "./quality-file-discovery.mjs"

const options = new Set(process.argv.slice(2).filter((argument) => argument.startsWith("--")))
const explicitFiles = process.argv.slice(2).filter((argument) => !argument.startsWith("--"))
const staged = options.has("--staged")
const fix = options.has("--fix")
const allFiles = await discoverQualityFiles()
const selectedFiles = explicitFiles.length === 0 ? allFiles : await discoverQualityFiles({ explicitFiles })
const lintableExtensions = new Set([".js", ".mjs", ".ts", ".tsx"])
const typedExtensions = new Set([".ts", ".tsx"])
const executable = (name) =>
  join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name)

const run = (command, arguments_) => {
  const result = spawnSync(command, arguments_, { stdio: "inherit" })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const nativeFiles = selectedFiles.filter((file) => lintableExtensions.has(extname(file)))
if (nativeFiles.length > 0) {
  run(executable("oxlint"), ["-c", ".oxlintrc.json", "--deny-warnings", ...(fix ? ["--fix"] : []), ...nativeFiles])
}

const allCompatibilityFiles = allFiles.filter((file) => typedExtensions.has(extname(file)))
const compatibilityFileSet = new Set(allCompatibilityFiles)
const selectedCompatibilityFiles = selectedFiles.filter((file) => compatibilityFileSet.has(file))
const compatibilityFiles = staged ? allCompatibilityFiles : selectedCompatibilityFiles
const runCompatibility = (files, shouldFix) => {
  if (files.length === 0) return
  run(executable("eslint"), [
    "--config",
    "eslint.compat.config.mjs",
    "--max-warnings",
    "0",
    "--suppressions-location",
    "eslint-functional-suppressions.json",
    "--no-error-on-unmatched-pattern",
    ...(shouldFix ? ["--fix"] : []),
    ...files
  ])
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
