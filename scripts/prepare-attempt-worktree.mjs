import { execFileSync } from "node:child_process"
import { readFile, realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const SECOND = 1_000

export class AttemptWorktreePreparationFailure extends Error {
  constructor(stage, detail) {
    super(detail)
    this.name = "AttemptWorktreePreparationFailure"
    this.stage = stage
  }
}

const requiredNode = (manifest) => {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/u.exec(manifest.engines?.node ?? "")
  if (match === null) throw new AttemptWorktreePreparationFailure("manifest", "unsupported Node engine range")
  return match.slice(1).map(Number)
}

const matchesNode = (version, [major, minor, patch]) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version.trim())
  if (match === null) return false
  const [, actualMajor, actualMinor, actualPatch] = match.map(Number)
  return actualMajor === major && (actualMinor > minor || (actualMinor === minor && actualPatch >= patch))
}

/** Prepare one exact Dalph task worktree before any source check. */
export const prepareAttemptWorktree = async ({
  cwd = process.cwd(),
  gitTopLevel = (worktree) =>
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: worktree,
      encoding: "utf8",
      timeout: 10 * SECOND
    }).trim(),
  runCommand = runBoundedCommand
} = {}) => {
  const worktree = await realpath(cwd)
  let observedTopLevel
  try {
    observedTopLevel = await realpath(gitTopLevel(worktree))
  } catch (error) {
    throw new AttemptWorktreePreparationFailure("git", `cannot read worktree registration: ${String(error)}`)
  }
  if (observedTopLevel !== worktree) {
    throw new AttemptWorktreePreparationFailure("git", "preparation cwd is not the exact Git worktree root")
  }
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(worktree, "package.json"), "utf8"))
    await readFile(join(worktree, "pnpm-lock.yaml"), "utf8")
    await readFile(join(worktree, "mise.toml"), "utf8")
  } catch (error) {
    throw new AttemptWorktreePreparationFailure("manifest", `required worktree input is unreadable: ${String(error)}`)
  }
  const minimumNode = requiredNode(manifest)
  let selectedNode
  try {
    const result = await runCommand({
      args: ["exec", "--", "node", "-p", "process.version"],
      captureOutput: true,
      cwd: worktree,
      executable: "mise",
      forwardOutput: false,
      name: "Repository Node selection",
      relayParentSignals: true,
      timeoutMilliseconds: 15 * SECOND
    })
    selectedNode = result.output?.trim()
  } catch (error) {
    throw new AttemptWorktreePreparationFailure("node", `repository Node selection failed: ${String(error)}`)
  }
  if (selectedNode === undefined || !matchesNode(selectedNode, minimumNode)) {
    throw new AttemptWorktreePreparationFailure(
      "node",
      `repository Node ${selectedNode ?? "unknown"} does not satisfy package engines`
    )
  }
  try {
    await runCommand({
      args: ["exec", "--", "pnpm", "install", "--frozen-lockfile"],
      cwd: worktree,
      executable: "mise",
      name: "Frozen task-worktree dependency install",
      relayParentSignals: true,
      timeoutMilliseconds: 5 * 60 * SECOND
    })
  } catch (error) {
    throw new AttemptWorktreePreparationFailure("install", `frozen dependency install failed: ${String(error)}`)
  }
  const dependencyStore = await stat(join(worktree, "node_modules", ".pnpm")).catch(() => undefined)
  if (!dependencyStore?.isDirectory()) {
    throw new AttemptWorktreePreparationFailure(
      "install",
      "frozen install returned without a workspace dependency store"
    )
  }
  return { node: selectedNode, worktree }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  try {
    const prepared = await prepareAttemptWorktree()
    process.stdout.write(`${JSON.stringify({ _tag: "AttemptWorktreePrepared", ...prepared })}\n`)
  } catch (error) {
    const failure =
      error instanceof AttemptWorktreePreparationFailure
        ? error
        : new AttemptWorktreePreparationFailure("unknown", String(error))
    process.stderr.write(
      `${JSON.stringify({ _tag: "AttemptWorktreePreparationFailed", stage: failure.stage, detail: failure.message })}\n`
    )
    process.exitCode = 1
  }
}
