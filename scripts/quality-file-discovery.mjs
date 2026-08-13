import { readdir } from "node:fs/promises"
import { extname, join, relative, resolve, sep } from "node:path"

const authoredRoots = ["src", "packages", "scripts", "test"]
const authoredExtensions = new Set([".js", ".mjs", ".ts", ".tsx"])
const ignoredDirectoryNames = new Set([".git", ".worktrees", "coverage", "dist", "node_modules", "prototypes"])
const rootConfigurationPattern = /^[^/]+\.config\.(?:js|mjs|ts|tsx)$/u
const fixturePathPattern = /(?:^|\/)test\/fixtures(?:\/|$)/u

const normalizedRelativePath = (path) => path.split(sep).join("/")

const isAuthoredQualityFile = (path) => {
  const normalized = normalizedRelativePath(path)
  if (fixturePathPattern.test(normalized)) return false
  if (normalized.split("/").length === 1) return rootConfigurationPattern.test(normalized)
  return authoredExtensions.has(extname(normalized))
}

const filesBelow = async (directory, rootDirectory) => {
  const entries = (await readdir(directory, { withFileTypes: true })).toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) continue
      files.push(...(await filesBelow(join(directory, entry.name), rootDirectory)))
      continue
    }
    const path = normalizedRelativePath(relative(rootDirectory, join(directory, entry.name)))
    if (isAuthoredQualityFile(path)) files.push(path)
  }
  return files
}

const explicitQualityFiles = ({ explicitFiles, rootDirectory }) =>
  explicitFiles
    .map((file) => normalizedRelativePath(relative(rootDirectory, resolve(rootDirectory, file))))
    .filter((file) => file !== ".." && !file.startsWith("../"))
    .filter(isAuthoredQualityFile)
    .toSorted()

export const discoverQualityFiles = async ({ explicitFiles, rootDirectory = process.cwd() } = {}) => {
  if (explicitFiles !== undefined) return [...new Set(explicitQualityFiles({ explicitFiles, rootDirectory }))]

  const files = []
  for (const root of authoredRoots) {
    try {
      files.push(...(await filesBelow(join(rootDirectory, root), rootDirectory)))
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
  const rootEntries = await readdir(rootDirectory, { withFileTypes: true })
  for (const entry of rootEntries) {
    if (entry.isFile() && isAuthoredQualityFile(entry.name)) files.push(entry.name)
  }
  return [...new Set(files)].toSorted((left, right) => left.localeCompare(right))
}
