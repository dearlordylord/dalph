#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))

export const repositoryRoot = () =>
  process.env.NODE_ENV === "test" && process.env.DALPH_PROJECT_MEMORY_TEST_ROOT
    ? resolve(process.env.DALPH_PROJECT_MEMORY_TEST_ROOT)
    : resolve(scriptDirectory, "..")

export const isMutatingCommand = (args) => {
  const [command, ...rest] = args

  return (
    command === "init" ||
    command === "note" ||
    command === "nap" ||
    command === "forget" ||
    command === "import" ||
    (command === "config" && rest.length > 0)
  )
}

const sensitiveNotePatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\b(?:api[ _-]?key|password|passwd|secret|token)\s*[:=]\s*\S+/iu,
]

export const currentBranch = (root) =>
  execFileSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
  }).trim()

export const isPrimaryWorktree = (root) => {
  const commonDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: root, encoding: "utf8" },
  ).trim()

  return realpathSync(dirname(commonDirectory)) === realpathSync(root)
}

const pythonCommand = () =>
  process.platform === "win32"
    ? { command: "py", prefixArguments: ["-3"] }
    : { command: "python3", prefixArguments: [] }

const authoredText = (args) => {
  if (args[0] === "note") {
    return args[1]
  }
  if (args[0] === "nap") {
    return args[2]
  }
  return undefined
}

export const authoredTextLooksSensitive = (args) => {
  const text = authoredText(args)
  return typeof text === "string" && sensitiveNotePatterns.some((pattern) => pattern.test(text))
}

const normalizeConfigComment = (memoryDirectory) => {
  const path = join(memoryDirectory, "config")
  const config = readFileSync(path, "utf8").replace(
    /^# tool's default\. Edit with `.* config NAME=VALUE`\.$/mu,
    "# tool's default. Edit with `pnpm memory -- config NAME=VALUE`.",
  )
  writeFileSync(path, config, "utf8")
}

export const rewriteToolCommands = (output, tool) => {
  const relativeToHome = relative(homedir(), tool)
  const homeFoldedTool =
    relativeToHome !== ".." &&
    !relativeToHome.startsWith(`..${sep}`) &&
    !isAbsolute(relativeToHome)
      ? `~${sep}${relativeToHome}`
      : tool

  return output
    .replaceAll(tool, "pnpm memory --")
    .replaceAll(homeFoldedTool, "pnpm memory --")
}

export const run = (args) => {
  const root = repositoryRoot()
  const tool = join(root, "tools", "optmem", "memo")
  const memoryDirectory = join(root, ".codex", "memory")

  if (!existsSync(tool)) {
    process.stderr.write(
      "OptMem is not initialized. Run: git submodule update --init tools/optmem\n",
    )
    return 1
  }

  if (args[0] === "import") {
    process.stderr.write(
      "Bulk import is disabled for checked-in project memory. " +
        "Review and append each durable lesson separately.\n",
    )
    return 1
  }

  if (
    isMutatingCommand(args) &&
    (currentBranch(root) !== "master" || !isPrimaryWorktree(root))
  ) {
    process.stderr.write(
      "Project memory writes are serialized through master's primary worktree. " +
        "Record the proposed memory in your handoff instead.\n",
    )
    return 1
  }

  if (authoredTextLooksSensitive(args)) {
    process.stderr.write(
      "Refusing project-memory text that resembles a credential or secret. " +
        "Project memory is checked into Git.\n",
    )
    return 1
  }

  const { command, prefixArguments } = pythonCommand()
  const result = spawnSync(command, [...prefixArguments, tool, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, MEMORY_DIR: memoryDirectory },
    stdio: ["inherit", "pipe", "pipe"],
  })

  if (result.error) {
    process.stderr.write(`Unable to run OptMem: ${result.error.message}\n`)
    return 1
  }

  process.stdout.write(rewriteToolCommands(result.stdout ?? "", tool))
  process.stderr.write(rewriteToolCommands(result.stderr ?? "", tool))

  if (result.status === 0 && args[0] === "config" && args.length > 1) {
    normalizeConfigComment(memoryDirectory)
  }

  return result.status ?? 1
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const args = process.argv.slice(2)
  process.exitCode = run(args[0] === "--" ? args.slice(1) : args)
}
