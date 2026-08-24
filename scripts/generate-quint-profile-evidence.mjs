import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

const usage = () =>
  "Usage: node scripts/generate-quint-profile-evidence.mjs --output FILE --profile ID|NODE|REPEAT|INSTALL_SECONDS|LOG_PATH [...]"

const values = process.argv.slice(2)
const outputIndex = values.indexOf("--output")
if (outputIndex < 0 || values[outputIndex + 1] === undefined) throw new Error(usage())
const outputPath = values[outputIndex + 1]
const profileArguments = values.flatMap((value, index) => (value === "--profile" ? [values[index + 1] ?? ""] : []))
if (profileArguments.length === 0 || profileArguments.some((value) => value.length === 0)) throw new Error(usage())

const timingPattern = /^Quint command timing: (typecheck|test|sampled-run|verify) (.*?) ([0-9.]+)s$/gm
const phasePattern = /^Quint phase timing: (typecheck|test|sampled-run|verify) (\d+) command\(s\), ([0-9.]+)s$/gm
const totalPattern = /^Complete Quint model gate: ([0-9.]+)s \(budget ([0-9.]+)s\)$/m
const parseProfile = (value) => {
  const [id, node, repeat, installSeconds, logPath] = value.split("|")
  if ([id, node, repeat, installSeconds, logPath].some((part) => part === undefined)) {
    throw new Error(`Invalid profile argument: ${value}`)
  }
  const log = readFileSync(logPath, "utf8")
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
  if (total === null || commands.length !== 92 || phases.length !== 4) {
    throw new Error(`Expected 92 commands, four phase totals, and a complete total in ${logPath}`)
  }
  const phaseTotals = Object.fromEntries(phases.map((phase) => [phase.kind, phase.durationSeconds]))
  const phaseCommandCounts = Object.fromEntries(phases.map((phase) => [phase.kind, phase.commandCount]))
  return {
    id,
    node,
    repeat,
    installSeconds: installSeconds === "-" ? null : Number(installSeconds),
    formalSeconds: Number(total[1]),
    budgetSeconds: Number(total[2]),
    source: { path: logPath, sha256: createHash("sha256").update(log).digest("hex") },
    commandCount: commands.length,
    phaseCommandCounts,
    phaseTotals,
    commands
  }
}

const evidence = {
  schemaVersion: 1,
  generatedBy: "node scripts/generate-quint-profile-evidence.mjs",
  profiles: profileArguments.map(parseProfile)
}
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
