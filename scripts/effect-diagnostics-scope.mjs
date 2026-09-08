import { extname } from "node:path"

const diagnosableExtensions = new Set([".ts", ".tsx"])

export const isDiagnosableFile = (file) => diagnosableExtensions.has(extname(file))

/**
 * The Effect language service accepts one `--file` per invocation and reloads the program each time, so a changed-file
 * pass is cheaper than the project pass only while the changed set stays small. Beyond the threshold the project pass
 * is both faster and stronger, so it is selected instead.
 */
export const selectDiagnosticTargets = ({ changedFiles, maximumFiles }) => {
  const files = [...new Set(changedFiles.filter(isDiagnosableFile))].toSorted((left, right) =>
    left.localeCompare(right)
  )
  if (files.length === 0) return { files: [], scope: "none" }
  if (files.length > maximumFiles) return { files: [], scope: "project" }
  return { files, scope: "files" }
}
