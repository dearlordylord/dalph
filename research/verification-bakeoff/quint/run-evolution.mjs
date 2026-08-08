#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const directory = import.meta.dirname
const quint = resolve(directory, "../../../node_modules/.bin/quint")
const spec = resolve(directory, "deliveryEvolution.qnt")
const tests = resolve(directory, "deliveryEvolution_test.qnt")

const checks = [
  {
    name: "typecheck",
    args: ["typecheck", spec],
    accepts: (result) => result.status === 0
  },
  {
    name: "#197 scenarios",
    args: ["test", tests, "--main", "deliveryEvolutionTest"],
    accepts: (result) => result.status === 0 && result.output.includes("6 passing")
  },
  {
    name: "#197 blocker mutant",
    args: ["test", tests, "--main", "deliveryEvolutionIgnoreBlockersTest"],
    accepts: (result) => result.status !== 0 && result.output.includes("1 failed")
  },
  {
    name: "#197 sampled invariants/witnesses",
    args: [
      "run", spec, "--main", "deliveryEvolution2",
      "--invariants", "allInvariants",
      "--witnesses", "blockedTaskReached", "postSelectionBlockerReached",
      "arrivalBudgetExhaustedReached",
      "--max-steps", "20", "--max-samples", "10000", "--seed", "197",
      "--verbosity", "1"
    ],
    accepts: (result) =>
      result.status === 0 && result.output.includes("[ok]") &&
      !result.output.includes("was witnessed in 0 trace")
  },
  {
    name: "#197 bounded-arrival I19",
    args: [
      "verify", spec, "--main", "deliveryEvolution2", "--backend", "tlc",
      "--temporal", "reachesQuiescenceAfterBoundedArrival", "--verbosity", "1"
    ],
    accepts: (result) => result.status === 0 && result.output.includes("[ok]")
  },
  {
    name: "#197 unbounded-arrival control",
    args: [
      "verify", spec, "--main", "deliveryEvolution2UnboundedArrival", "--backend", "tlc",
      "--temporal", "reachesQuiescenceAfterBoundedArrival", "--verbosity", "1"
    ],
    accepts: (result) => result.status !== 0 && result.output.includes("[violation]")
  }
]

let failed = false
process.stdout.write("| Check | Expected | Result |\n|---|---|---|\n")

for (const check of checks) {
  const startedAt = performance.now()
  const execution = spawnSync(quint, check.args, {
    cwd: directory,
    encoding: "utf8",
    timeout: 120_000
  })
  const result = {
    output: `${execution.stdout ?? ""}\n${execution.stderr ?? ""}`,
    status: execution.status
  }
  const accepted = execution.error === undefined && check.accepts(result)
  failed ||= !accepted
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(2)
  process.stdout.write(
    `| ${check.name} | ${check.name.includes("mutant") || check.name.includes("control") ? "rejected" : "passes"} | ${accepted ? `as expected (${seconds}s)` : "**unexpected verdict**"} |\n`
  )
  if (!accepted) process.stderr.write(result.output)
}

process.exit(failed ? 1 : 0)
