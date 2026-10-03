import { execFileSync } from "node:child_process"
import { open, readFile, realpath, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const SECOND = 1_000
const commandEnvironment = () =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DALPH_ATTEMPT_PREPARATION_")))

const writePreparationReceipt = async (result) => {
  const path = process.env.DALPH_ATTEMPT_PREPARATION_RECEIPT
  const token = process.env.DALPH_ATTEMPT_PREPARATION_TOKEN
  if (path === undefined && token === undefined) return
  if (path === undefined || token === undefined) throw new Error("incomplete preparation receipt authority")
  const handle = await open(path, "wx", 0o600)
  try {
    await handle.writeFile(`${JSON.stringify({ ...result, token })}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const directory = await open(dirname(path), "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

export class AttemptWorktreePreparationFailure extends Error {
  constructor(stage, detail, stoppedWritersProven = true) {
    super(detail)
    this.name = "AttemptWorktreePreparationFailure"
    this.stage = stage
    this.stoppedWritersProven = stoppedWritersProven
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
      environment: commandEnvironment(),
      forwardOutput: false,
      name: "Repository Node selection",
      relayParentSignals: true,
      timeoutMilliseconds: 15 * SECOND
    })
    selectedNode = result.output?.trim()
  } catch (error) {
    throw new AttemptWorktreePreparationFailure(
      "node",
      `repository Node selection failed: ${String(error)}`,
      error?.stoppedWritersProven === true
    )
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
      environment: commandEnvironment(),
      forwardOutput: false,
      name: "Frozen task-worktree dependency install",
      relayParentSignals: true,
      timeoutMilliseconds: 5 * 60 * SECOND
    })
  } catch (error) {
    throw new AttemptWorktreePreparationFailure(
      "install",
      `frozen dependency install failed: ${String(error)}`,
      error?.stoppedWritersProven === true
    )
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
    const result = { _tag: "AttemptWorktreePrepared", ...prepared }
    await writePreparationReceipt(result)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    const failure =
      error instanceof AttemptWorktreePreparationFailure
        ? error
        : new AttemptWorktreePreparationFailure("unknown", String(error))
    const result = { _tag: "AttemptWorktreePreparationFailed", stage: failure.stage, detail: failure.message }
    if (failure.stoppedWritersProven) {
      try {
        await writePreparationReceipt(result)
      } catch (receiptError) {
        process.stderr.write(`preparation receipt unavailable: ${String(receiptError)}\n`)
      }
    }
    process.stderr.write(`${JSON.stringify(result)}\n`)
    process.exitCode = 1
  }
}
