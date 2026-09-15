import { spawn } from "node:child_process"

const arguments_ = process.argv.slice(2)
const noCoverage = arguments_.includes("--no-coverage")
const vitestArguments = arguments_.filter((argument) => argument !== "--" && argument !== "--no-coverage")
const focused = vitestArguments.length > 0
const pnpm = process.env.npm_execpath ?? "pnpm"
const command =
  noCoverage || focused
    ? [pnpm, "--silent", "exec", "vitest", "run", ...vitestArguments]
    : [process.execPath, "scripts/with-gate-slot.mjs", "--", pnpm, "--silent", "coverage:body"]

const child = spawn(command[0], command.slice(1), { env: process.env, stdio: "inherit" })
child.once("error", (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once("exit", (code, signal) => {
  if (signal !== null) process.exitCode = 1
  else process.exitCode = code ?? 1
})
