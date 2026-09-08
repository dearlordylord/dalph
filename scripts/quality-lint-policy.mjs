import { extname } from "node:path"

const typedExtensions = new Set([".ts", ".tsx"])

/**
 * The compatibility pass builds the complete TypeScript program whatever file list it receives, so an explicit-file run
 * pays whole-repository cost for a fraction of the coverage. Explicit runs therefore skip it unless they ask for it,
 * while staged and whole-repository runs keep the full compatibility graph.
 */
export const selectCompatibilityFiles = ({
  allFiles,
  compatibility = false,
  explicit = false,
  selectedFiles,
  staged,
  withoutCompatibility = false
}) => {
  const allCompatibilityFiles = allFiles.filter((file) => typedExtensions.has(extname(file)))
  const compatibilityFileSet = new Set(allCompatibilityFiles)
  const selectedCompatibilityFiles = selectedFiles.filter((file) => compatibilityFileSet.has(file))

  if (withoutCompatibility) return { compatibilityFiles: [], selectedCompatibilityFiles }
  if (staged) return { compatibilityFiles: allCompatibilityFiles, selectedCompatibilityFiles }
  if (explicit && !compatibility) return { compatibilityFiles: [], selectedCompatibilityFiles }

  return { compatibilityFiles: selectedCompatibilityFiles, selectedCompatibilityFiles }
}
