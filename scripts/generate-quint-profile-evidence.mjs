import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

import { quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"

const usage = () =>
  "Usage: node scripts/generate-quint-profile-evidence.mjs --output FILE --profile ID|NODE|REPEAT|INSTALL_SECONDS|LOG_PATH [...]"
const commandKinds = ["typecheck", "test", "sampled-run", "verify"]
const timingPattern = /^Quint command timing: (typecheck|test|sampled-run|verify) (.*?) ([0-9.]+)s$/gm
const phasePattern = /^Quint phase timing: (typecheck|test|sampled-run|verify) (\d+) command\(s\), ([0-9.]+)s$/gm
const totalPattern = /^Complete Quint model gate: ([0-9.]+)s \(budget ([0-9.]+)s\)$/m

const expectedPhaseCounts = Object.fromEntries(
  commandKinds.map((kind) => [kind, quintGateCommandManifest.filter((command) => command.kind === kind).length])
)

const assertManifestMatch = (commands, sourceDescription) => {
  if (commands.length !== quintGateCommandManifest.length) {
    throw new Error(
      `Expected ${quintGateCommandManifest.length} commands in ${sourceDescription}; found ${commands.length}`
    )
  }
  for (const [index, [actual, expected]] of commands
    .map((command, position) => [command, quintGateCommandManifest[position]])
    .entries()) {
    if (actual.kind !== expected.kind || actual.name !== expected.name) {
      throw new Error(
        `Command manifest mismatch at ${index} in ${sourceDescription}: expected ${expected.kind} ${expected.name}, received ${actual.kind} ${actual.name}`
      )
    }
  }
}

const assertPhaseTotals = (commands, phases, sourceDescription) => {
  if (phases.length !== commandKinds.length) {
    throw new Error(`Expected one phase total for each command kind in ${sourceDescription}`)
  }
  for (const [index, kind] of commandKinds.entries()) {
    const phase = phases[index]
    const expectedCount = expectedPhaseCounts[kind]
    const actualCount = commands.filter((command) => command.kind === kind).length
    if (phase.kind !== kind || phase.commandCount !== expectedCount || actualCount !== expectedCount) {
      throw new Error(`Phase membership mismatch for ${kind} in ${sourceDescription}`)
    }
    const emittedSum = commands
      .filter((command) => command.kind === kind)
      .reduce((sum, command) => sum + command.durationSeconds, 0)
    const emittedRoundingTolerance = expectedCount * 0.005 + 0.011
    if (Math.abs(emittedSum - phase.durationSeconds) > emittedRoundingTolerance) {
      throw new Error(
        `Phase total mismatch for ${kind} in ${sourceDescription}: emitted command sum ${emittedSum.toFixed(2)} vs reported ${phase.durationSeconds.toFixed(2)}`
      )
    }
  }
}

export const parseProfileLog = ({ id, installSeconds, log, node, repeat, sourcePath }) => {
  const commands = [...log.matchAll(timingPattern)].map((match) => ({
    kind: match[1],
    name: match[2],
    durationSeconds: Number(match[3])
  }))
  const phases = [...log.matchAll(phasePattern)].map((match) => ({
    kind: match[1],
    commandCount: Number(match[2]),
    durationSeconds: Number(match[3])
  }))
  const total = totalPattern.exec(log)
  if (total === null) throw new Error(`Missing complete gate total in ${sourcePath ?? id}`)
  assertManifestMatch(commands, sourcePath ?? id)
  assertPhaseTotals(commands, phases, sourcePath ?? id)
  return {
    id,
    node,
    repeat,
    installSeconds: installSeconds === "-" ? null : Number(installSeconds),
    formalSeconds: Number(total[1]),
    budgetSeconds: Number(total[2]),
    source: { path: sourcePath, sha256: createHash("sha256").update(log).digest("hex") },
    commandCount: commands.length,
    phaseCommandCounts: Object.fromEntries(phases.map((phase) => [phase.kind, phase.commandCount])),
    phaseTotals: Object.fromEntries(phases.map((phase) => [phase.kind, phase.durationSeconds])),
    commands
  }
}

export const parseProfile = (value) => {
  const [id, node, repeat, installSeconds, logPath] = value.split("|")
  if ([id, node, repeat, installSeconds, logPath].some((part) => part === undefined)) {
    throw new Error(`Invalid profile argument: ${value}`)
  }
  const log = readFileSync(logPath, "utf8")
  return parseProfileLog({ id, node, repeat, installSeconds, log, sourcePath: logPath })
}

export const generateEvidence = ({ outputPath, profileArguments }) => {
  const evidence = {
    schemaVersion: 1,
    generatedBy: "node scripts/generate-quint-profile-evidence.mjs",
    profiles: profileArguments.map(parseProfile)
  }
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  return evidence
}

export const runCli = (values) => {
  const outputIndex = values.indexOf("--output")
  if (outputIndex < 0 || values[outputIndex + 1] === undefined) throw new Error(usage())
  const outputPath = values[outputIndex + 1]
  const profileArguments = values.flatMap((value, index) => (value === "--profile" ? [values[index + 1] ?? ""] : []))
  if (profileArguments.length === 0 || profileArguments.some((value) => value.length === 0)) throw new Error(usage())
  return generateEvidence({ outputPath, profileArguments })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2))
}
