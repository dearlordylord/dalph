import { extname } from "node:path"

const typedExtensions = new Set([".ts", ".tsx"])

export const selectCompatibilityFiles = ({ allFiles, selectedFiles, staged }) => {
  const allCompatibilityFiles = allFiles.filter((file) => typedExtensions.has(extname(file)))
  const compatibilityFileSet = new Set(allCompatibilityFiles)
  const selectedCompatibilityFiles = selectedFiles.filter((file) => compatibilityFileSet.has(file))

  return { compatibilityFiles: staged ? allCompatibilityFiles : selectedCompatibilityFiles, selectedCompatibilityFiles }
}
