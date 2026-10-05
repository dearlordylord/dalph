#!/usr/bin/env node

import { execFile as nodeExecFile, spawn } from "node:child_process"
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { promisify } from "node:util"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const execFile = promisify(nodeExecFile)
const pinnedCodexVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  .devDependencies["@openai/codex"]
const testFiles = [
  "packages/dalph/src/application/codex-app-server-real-qualification.test.ts",
  "packages/dalph/src/application/codex-shared-home-real-qualification.test.ts",
  "packages/dalph/src/application/codex-integrator-real-qualification.test.ts",
  "packages/dalph/test/qualification/codex-real-host-qualification.test.ts",
  "packages/dalph/src/application/codex-planned-attempt-executor.test.ts"
]

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(" ")} exited with ${String(code ?? signal)}`))
    })
  })

const outputOf = async (command, args, options = {}) => {
  const result = await execFile(command, args, { encoding: "utf8", ...options })
  return result.stdout.trim()
}

const requireCommand = async (command) => {
  try {
    await outputOf(command, ["--version"])
  } catch {
    throw new Error(`required command is unavailable: ${command}`)
  }
}

const codexVersionIsPinned = (version) =>
  version === `codex-cli ${pinnedCodexVersion}` ||
  version === pinnedCodexVersion ||
  version.endsWith(` ${pinnedCodexVersion}`)

const main = async () => {
  if (nodeProcess.platform !== "linux" && nodeProcess.platform !== "darwin") {
    throw new Error(`Codex qualification supports Linux and macOS only; got ${nodeProcess.platform}`)
  }
  await Promise.all(["git", "node", "pnpm"].map(requireCommand))

  const codexExecutable = nodeProcess.env["CODEX_BIN"] ?? nodePath.resolve("node_modules/.bin/codex")
  const version = await outputOf(codexExecutable, ["--version"])
  if (!codexVersionIsPinned(version)) {
    throw new Error(`CODEX_BIN must be pinned to Codex ${pinnedCodexVersion}; received ${version}`)
  }

  await run("pnpm", ["--filter", "@dalph/dalph...", "build"])
  const preflightDirectory = await realpath(await mkdtemp(nodePath.join(tmpdir(), "dalph-codex-launch-preflight-")))
  const selectedExecutable =
    nodePath.isAbsolute(codexExecutable) || codexExecutable.includes(nodePath.sep)
      ? nodePath.resolve(codexExecutable)
      : codexExecutable
  try {
    await runBoundedCommand({
      executable: nodeProcess.execPath,
      args: [
        nodePath.resolve("packages/dalph/dist/bin/codex-launch-preflight.js"),
        selectedExecutable,
        preflightDirectory
      ],
      name: "Codex launch preflight",
      relayParentSignals: true,
      timeoutMilliseconds: 15_000
    })
    const outcome = JSON.parse(await readFile(nodePath.join(preflightDirectory, "outcome.json"), "utf8"))
    if (outcome.status !== "passed") throw new Error("Codex launch preflight did not prove exact close")
    await rm(preflightDirectory, { recursive: true })
  } catch (error) {
    throw new Error(`Codex launch preflight did not qualify; retained evidence: ${preflightDirectory}`, {
      cause: error
    })
  }
  await run("pnpm", ["vitest", "run", ...testFiles, "--maxWorkers=1", "--reporter=verbose"], {
    env: { ...nodeProcess.env, CODEX_BIN: codexExecutable, DALPH_RUN_REAL_CODEX_QUALIFICATION: "1" }
  })
}

main().catch((error) => {
  nodeProcess.stderr.write(`${String(error)}\n`)
  nodeProcess.exitCode = 1
})
