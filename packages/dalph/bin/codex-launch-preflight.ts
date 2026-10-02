#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- This opt-in qualification command owns its local receipt. */
import { mkdir, writeFile } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { Effect } from "effect"
import { codexLaunchPreflight } from "../src/qualification/codex-launch-preflight.js"

const commandArgumentCount = 2
const [executable, directory] = nodeProcess.argv.slice(commandArgumentCount)
if (executable === undefined || executable.length === 0 || directory === undefined || !nodePath.isAbsolute(directory)) {
  throw new Error("Codex launch preflight requires an executable and absolute evidence directory")
}

const receiptPath = nodePath.join(directory, "outcome.json")
const observationPath = nodePath.join(directory, "launch-observation.json")
const codexHome = nodePath.join(directory, "codex-home")
const stateDirectory = nodePath.join(directory, "process-state")
await mkdir(codexHome, { recursive: true, mode: 0o700 })
await mkdir(stateDirectory, { recursive: true, mode: 0o700 })

try {
  const result = await Effect.runPromise(
    codexLaunchPreflight({ executable, codexHome, observationPath, stateDirectory })
  )
  await writeFile(
    receiptPath,
    `${JSON.stringify({ status: "passed", configuredExecutable: executable, ...result })}\n`,
    { flag: "wx", mode: 0o600 }
  )
} catch (error) {
  const detail = typeof error === "object" && error !== null && "detail" in error ? String(error.detail) : String(error)
  await writeFile(receiptPath, `${JSON.stringify({ status: "failed", configuredExecutable: executable, detail })}\n`, {
    flag: "wx",
    mode: 0o600
  })
  nodeProcess.stderr.write(`Codex launch preflight failed; retained evidence: ${directory}\n`)
  nodeProcess.exitCode = 1
}
