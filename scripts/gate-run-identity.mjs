import { spawnSync } from "node:child_process"
import { lstatSync, readFileSync, readlinkSync, statSync } from "node:fs"
import { join } from "node:path"
import { digest } from "./gate-custody-records.mjs"
import { resolveQualityGateBase } from "./resolve-quality-gate-base.mjs"

const gitOutput = (worktree, args, encoding = "utf8") => {
  const result = spawnSync("git", args, { cwd: worktree, encoding })
  if (result.error !== undefined || result.status !== 0)
    throw new Error(`Cannot fingerprint Git inputs: ${args.join(" ")}`)
  return result.stdout
}
/** All tracked content and unignored untracked content identify the current candidate; ignored tooling output is excluded. */
export const currentSourceInputDigest = (worktree) => {
  const paths = [
    ...new Set(
      gitOutput(worktree, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean)
    )
  ].sort((left, right) => left.localeCompare(right))
  const entries = paths.map((path) => {
    const fullPath = join(worktree, path)
    let status
    try {
      status = lstatSync(fullPath)
    } catch (error) {
      if (error.code === "ENOENT") return [path, "deleted"]
      throw error
    }
    if (status.isSymbolicLink()) {
      if (!statSync(fullPath).isFile()) throw new Error(`Cannot fingerprint a candidate directory symlink: ${path}`)
      return [path, "symlink", digest(readlinkSync(fullPath)), digest(readFileSync(fullPath))]
    }
    if (status.isDirectory()) return [path, "submodule", currentSourceInputDigest(fullPath)]
    if (!status.isFile()) throw new Error(`Unsupported candidate input: ${path}`)
    return [path, status.mode & 0o777, digest(readFileSync(fullPath))]
  })
  return digest(JSON.stringify({ head: gitOutput(worktree, ["rev-parse", "HEAD"]).trim(), entries }))
}
export const createRunInputIdentity = ({ commandArguments, environment = process.env, worktree }) => {
  const candidate = commandArguments
    .find((argument) => argument.startsWith("--candidate="))
    ?.slice("--candidate=".length)
  // Existing base resolution runs in the worktree admitted by the wrapper.
  const baseSha = resolveQualityGateBase({ candidateBase: candidate, hostedBase: environment.DALPH_COVERAGE_BASE_SHA })
  const sourceInputDigest = currentSourceInputDigest(worktree)
  const relevantEnvironment = [
    "NODE_OPTIONS",
    "CI",
    "DALPH_GATE_SLOTS",
    "DALPH_FULL_GATE",
    "DALPH_COVERAGE_BASE_SHA",
    "QUINT_HOME",
    "JAVA_HOME",
    "PATH",
    "DALPH_OXLINT_BIN"
  ]
  const identity = {
    version: 1,
    worktree,
    sourceInputDigest,
    baseSha,
    commandArguments,
    node: { executable: process.execPath, version: process.version },
    pnpm:
      environment.npm_execpath === undefined
        ? null
        : { executable: environment.npm_execpath, digest: digest(readFileSync(environment.npm_execpath)) },
    environmentDigests: Object.fromEntries(
      relevantEnvironment.map((name) => [name, digest(environment[name] ?? "<unset>")])
    )
  }
  return { ...identity, inputDigest: digest(JSON.stringify(identity)) }
}
