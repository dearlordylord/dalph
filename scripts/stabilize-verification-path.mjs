import { accessSync, constants, lstatSync, realpathSync } from "node:fs"
import { delimiter, dirname, isAbsolute, resolve, sep } from "node:path"

const selectedExecutable = (name, environment, worktree) => {
  const candidates =
    isAbsolute(name) || name.includes(sep)
      ? [resolve(worktree, name)]
      : (environment.PATH ?? "").split(delimiter).map((directory) => resolve(worktree, directory, name))
  for (const candidate of candidates) {
    try {
      const authored = lstatSync(candidate)
      if (!authored.isFile() && !authored.isSymbolicLink()) continue
      if (!lstatSync(realpathSync(candidate)).isFile()) continue
      accessSync(candidate, constants.X_OK)
      return resolve(candidate)
    } catch {
      // A later PATH component may still supply the declared executable.
    }
  }
  return undefined
}

const codexArgvZeroDirectory = (directory, environment) => {
  if (environment.HOME === undefined || !isAbsolute(environment.HOME) || !isAbsolute(directory)) return false
  const parent = resolve(environment.HOME, ".codex", "tmp", "arg0")
  return (
    dirname(resolve(directory)) === parent && /^codex-arg0[0-9A-Za-z]{6}$/u.test(directory.slice(parent.length + 1))
  )
}

/** Remove only Codex's per-shell argv-zero shim after proving declared executable selection is unchanged. */
export const stabilizeVerificationEnvironment = ({
  environment = process.env,
  requiredExecutables,
  worktree = process.cwd()
}) => {
  if (!Array.isArray(requiredExecutables))
    throw new Error("Verification PATH stabilization requires the complete declared tool inventory")
  const path = environment.PATH
  if (path === undefined) return { ...environment }
  const components = path.split(delimiter)
  const retained = components.filter((directory) => !codexArgvZeroDirectory(directory, environment))
  if (retained.length === components.length) return { ...environment }
  const stabilized = { ...environment, PATH: retained.join(delimiter) }
  for (const tool of requiredExecutables) {
    const before = selectedExecutable(tool, environment, worktree)
    const after = selectedExecutable(tool, stabilized, worktree)
    if (before !== after)
      throw new Error(
        `Cannot remove Codex argv-zero PATH entry because declared tool resolution changes: ${tool} (${before ?? "unavailable"} -> ${after ?? "unavailable"})`
      )
  }
  return stabilized
}
