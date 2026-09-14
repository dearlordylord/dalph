import { extname } from "node:path"

const typedExtensions = new Set([".ts", ".tsx"])

/**
 * The compatibility pass builds the complete TypeScript program whatever file list it receives, so a file-scoped run
 * pays whole-program setup cost even for a bounded file list. The development
 * tier still runs its rules only against changed TypeScript files; explicit
 * and staged runs preserve their opt-in behavior, and repository runs keep the
 * full compatibility graph.
 */
export const selectCompatibilityFiles = ({
  allFiles,
  changed = false,
  compatibility = false,
  scoped = false,
  selectedFiles,
  withoutCompatibility = false
}) => {
  const allCompatibilityFiles = allFiles.filter((file) => typedExtensions.has(extname(file)))
  const compatibilityFileSet = new Set(allCompatibilityFiles)
  const selectedCompatibilityFiles = selectedFiles.filter((file) => compatibilityFileSet.has(file))

  if (withoutCompatibility) return { compatibilityFiles: [], selectedCompatibilityFiles }
  if (scoped && !changed && !compatibility) return { compatibilityFiles: [], selectedCompatibilityFiles }

  return { compatibilityFiles: selectedCompatibilityFiles, selectedCompatibilityFiles }
}
