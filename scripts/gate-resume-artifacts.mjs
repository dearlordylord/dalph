import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve, relative } from "node:path"
import { digest } from "./gate-custody-records.mjs"

/** Complete membership, modes and bytes prove every retained generated tree. */
export const captureResumeArtifacts = ({ coverageDirectory, roots, worktree }) =>
  Object.fromEntries(
    roots.map((root) => {
      const fullRoot = root === "@coverage" ? resolve(coverageDirectory) : resolve(worktree, root)
      if (relative(worktree, fullRoot).startsWith("..") || fullRoot === worktree)
        throw new Error(`Artifact root escapes worktree: ${root}`)
      let status
      try {
        status = lstatSync(fullRoot)
      } catch (error) {
        if (error.code === "ENOENT") return [root, { exists: false, entries: [] }]
        throw error
      }
      if (!status.isDirectory()) throw new Error(`Unsupported artifact root: ${root}`)
      const entries = []
      const walk = (directory) => {
        for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
          const path = join(directory, name)
          const entry = lstatSync(path)
          if (entry.isDirectory()) {
            entries.push({ path: relative(fullRoot, path), kind: "directory", mode: entry.mode & 0o777 })
            walk(path)
          } else if (entry.isFile()) {
            const bytes = readFileSync(path)
            entries.push({
              path: relative(fullRoot, path),
              kind: "file",
              mode: entry.mode & 0o777,
              bytes: bytes.length,
              sha256: digest(bytes)
            })
          } else throw new Error(`Unsupported retained artifact: ${path}`)
        }
      }
      walk(fullRoot)
      return [root, { exists: true, mode: status.mode & 0o777, entries }]
    })
  )
