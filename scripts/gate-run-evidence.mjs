import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { readQualityEvidence } from "./gate-quality-evidence.mjs"
import { validateObligation } from "./gate-registration.mjs"
import { digest, readRecord, validateRun } from "./gate-custody-records.mjs"

export const artifactEvidence = (path) => {
  if (!existsSync(path)) return undefined
  const bytes = readFileSync(path)
  return { path, sha256: digest(bytes), bytes: bytes.length }
}
/** Outcomes describe the observer verdict; exit/signal preserve the actual child result. */
const validateStageOutcome = (receipt, obligation) => {
  const actualExit = receipt.exitCode
  const actualSignal = receipt.signal
  if (
    obligation.state === "no-child" &&
    (actualExit !== null || actualSignal !== null || !["launch-failed", "failed"].includes(receipt.outcome))
  )
    throw new Error("Invalid no-child terminal evidence")
  switch (receipt.outcome) {
    case "passed":
      if (
        obligation.state !== "observed" ||
        !receipt.groupAbsent ||
        actualSignal !== null ||
        !obligation.command.acceptedExitCodes.includes(actualExit)
      )
        throw new Error("Invalid successful stage evidence")
      break
    case "launch-failed":
      // The error event settles before any genuine close result is observed.
      if (actualExit !== null || actualSignal !== null) throw new Error("Invalid launch-failed stage evidence")
      break
    case "timed-out":
    case "interrupted":
    case "cancelled":
    case "failed":
      // Termination can produce an ordinary exit (including zero), a signal,
      // or no observed close. A custody failure also preserves any actual exit.
      break
    default: {
      const ordinaryExit = /^exit:(\d+)$/u.exec(receipt.outcome ?? "")
      if (
        ordinaryExit === null ||
        obligation.state !== "observed" ||
        !receipt.groupAbsent ||
        actualSignal !== null ||
        actualExit !== Number(ordinaryExit[1]) ||
        obligation.command.acceptedExitCodes.includes(actualExit)
      )
        throw new Error("Invalid ordinary exit stage evidence")
    }
  }
}
export const readRunEvidence = ({ runDirectory, runId, visited = new Set() }) => {
  if (visited.has(runId)) throw new Error("Cyclic composite run provenance")
  const ancestors = new Set([...visited, runId])
  const run = validateRun(runDirectory, runId)
  const identityPath = join(runDirectory, "identity.json")
  if (!existsSync(identityPath)) {
    const registration = readRecord(join(runDirectory, "registration.json"))
    const reconciledPath = join(runDirectory, "reconciled.json")
    const reconciled = existsSync(reconciledPath) ? readRecord(reconciledPath) : undefined
    if (
      registration.runId !== runId ||
      (reconciled !== undefined && (reconciled.runId !== runId || reconciled.custody !== "stopped"))
    )
      throw new Error("Invalid input-unproven custody evidence")
    return {
      version: 1,
      runId,
      worktree: run.worktree,
      registration: registration.state,
      custody: reconciled?.custody ?? "UNRESOLVED",
      qualification: "UNPROVEN",
      stages: [],
      reportDirectory: run.reportDirectory,
      coverage: {}
    }
  }
  const identity = readRecord(identityPath)
  if (
    identity.worktree !== run.worktree ||
    typeof identity.inputDigest !== "string" ||
    typeof identity.sourceInputDigest !== "string" ||
    typeof identity.baseSha !== "string"
  )
    throw new Error("Invalid run input identity")
  const { inputDigest, ...identityInputs } = identity
  if (digest(JSON.stringify(identityInputs)) !== inputDigest)
    throw new Error("Run input identity digest does not match")
  const registration = readRecord(join(runDirectory, "registration.json"))
  if (registration.runId !== runId || !Array.isArray(registration.obligations))
    throw new Error("Invalid run obligation inventory")
  if (
    !["open", "closed"].includes(registration.state) ||
    new Set(registration.obligations).size !== registration.obligations.length ||
    registration.obligations.some((id) => !/^[0-9a-f-]{36}$/u.test(id)) ||
    JSON.stringify(readdirSync(join(runDirectory, "obligations")).sort()) !==
      JSON.stringify(registration.obligations.map((id) => `${id}.json`).sort())
  )
    throw new Error("Invalid complete obligation inventory")
  const rootObligations = []
  const stages = registration.obligations.map((obligationId) => {
    const obligation = readRecord(join(runDirectory, "obligations", `${obligationId}.json`))
    if (
      obligation.runId !== runId ||
      obligation.obligationId !== obligationId ||
      (obligation.parentId !== "root" && !registration.obligations.includes(obligation.parentId))
    )
      throw new Error("Invalid stage obligation identity")
    validateObligation(obligation, runId)
    if (obligation.parentId === "root") rootObligations.push(obligationId)
    const path = join(runDirectory, "receipts", `${obligationId}.json`)
    if (!existsSync(path))
      return { obligationId, parentId: obligation.parentId, command: obligation.command, outcome: "UNPROVEN" }
    const receipt = readRecord(path)
    if (
      receipt.runId !== runId ||
      receipt.obligationId !== obligationId ||
      receipt.inputDigest !== identity.inputDigest ||
      JSON.stringify(receipt.command) !== JSON.stringify(obligation.command) ||
      !(receipt.exitCode === null || (Number.isInteger(receipt.exitCode) && receipt.exitCode >= 0)) ||
      !(receipt.signal === null || (typeof receipt.signal === "string" && /^SIG[A-Z0-9]+$/u.test(receipt.signal))) ||
      (receipt.signal !== null && receipt.exitCode !== null) ||
      typeof receipt.groupAbsent !== "boolean"
    )
      throw new Error("Invalid stage terminal evidence")
    if (
      !Number.isSafeInteger(receipt.outputLineCount) ||
      receipt.outputLineCount < 0 ||
      typeof receipt.logPath !== "string" ||
      receipt.logPath !== join(run.reportDirectory, "logs", `${obligationId}.log`)
    )
      throw new Error("Invalid stage result fields")
    validateStageOutcome(receipt, obligation)
    if (
      !Array.isArray(receipt.artifacts) ||
      receipt.artifacts.some(
        (artifact) =>
          typeof artifact.path !== "string" ||
          !artifact.path.startsWith(`${run.worktree}/`) ||
          !/^[0-9a-f]{64}$/u.test(artifact.sha256 ?? "") ||
          !Number.isSafeInteger(artifact.bytes) ||
          artifact.bytes < 0
      )
    )
      throw new Error("Invalid generated artifact evidence")
    if (
      receipt.log?.path !== receipt.logPath ||
      !/^[0-9a-f]{64}$/u.test(receipt.log?.sha256 ?? "") ||
      !Number.isSafeInteger(receipt.log?.bytes) ||
      receipt.log.bytes < 0
    )
      throw new Error("Invalid recorded stage log association")
    const absencePath = join(runDirectory, "absence", `${obligationId}.json`)
    const absence = existsSync(absencePath) ? readRecord(absencePath) : undefined
    if (
      absence !== undefined &&
      (absence.runId !== runId ||
        absence.obligationId !== obligationId ||
        ((absence.state !== undefined || absence.processGroup !== undefined) &&
          (absence.state !== "observed" ||
            !Number.isSafeInteger(absence.processGroup) ||
            absence.processGroup <= 0 ||
            obligation.state !== "observed" ||
            absence.processGroup !== obligation.processGroup)))
    )
      throw new Error("Invalid later process-group absence observation")
    const stopped =
      receipt.groupAbsent ||
      (absence?.state === "observed" &&
        Number.isSafeInteger(absence.processGroup) &&
        absence.processGroup === obligation.processGroup)
    const currentLog = artifactEvidence(receipt.logPath)
    if (currentLog?.sha256 !== receipt.log.sha256 || currentLog?.bytes !== receipt.log.bytes)
      return {
        ...receipt,
        parentId: obligation.parentId,
        stopped,
        recordedOutcome: receipt.outcome,
        outcome: "UNPROVEN"
      }
    return { ...receipt, parentId: obligation.parentId, stopped, outcome: receipt.outcome }
  })
  const terminalPath = join(runDirectory, "terminal.json")
  const terminal = existsSync(terminalPath) ? readRecord(terminalPath) : undefined
  if (
    terminal !== undefined &&
    (terminal.runId !== runId ||
      terminal.inputDigest !== identity.inputDigest ||
      terminal.custody !== "stopped" ||
      registration.state !== "closed" ||
      !Number.isSafeInteger(terminal.commandExit) ||
      terminal.commandExit < 0 ||
      typeof terminal.sourceUnchanged !== "boolean" ||
      terminal.obligationCount !== stages.length)
  )
    throw new Error("Invalid terminal run identity")
  const reconciledPath = join(runDirectory, "reconciled.json")
  const reconciled = existsSync(reconciledPath) ? readRecord(reconciledPath) : undefined
  if (reconciled !== undefined && (reconciled.runId !== runId || reconciled.custody !== "stopped"))
    throw new Error("Invalid reconciled custody evidence")
  const coverage =
    terminal?.coverage ?? [...stages].reverse().find((stage) => stage.coverage !== undefined)?.coverage ?? {}
  for (const [kind, artifact] of Object.entries(coverage)) {
    if (
      !["final", "summary"].includes(kind) ||
      artifact.path !== join(run.reportDirectory, "coverage", `coverage-${kind}.json`) ||
      !/^[0-9a-f]{64}$/u.test(artifact.sha256 ?? "") ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0
    )
      throw new Error("Invalid coverage artifact association")
  }
  const resume = readQualityEvidence({
    baseSha: identity.baseSha,
    runDirectory,
    runId,
    run,
    stages,
    readPrior: (priorId) =>
      readRunEvidence({
        runDirectory: join(run.commonDirectory, "dalph-gates", "runs", priorId),
        runId: priorId,
        visited: ancestors
      })
  })
  const enclosingCommand =
    rootObligations.length === 1 ? stages.find((stage) => stage.obligationId === rootObligations[0]) : undefined
  const exactEnclosingCommand =
    enclosingCommand !== undefined &&
    enclosingCommand.command.executable === run.commandArguments[0] &&
    JSON.stringify(enclosingCommand.command.args) === JSON.stringify(run.commandArguments.slice(1)) &&
    JSON.stringify(enclosingCommand.command.acceptedExitCodes) === "[0]"
  // A test can require a child to fail. Its genuine failure is evidence, while
  // the exact enclosing admitted command owns the qualification verdict.
  const qualification =
    registration.state === "closed" &&
    stages.length > 0 &&
    terminal?.custody === "stopped" &&
    terminal.commandExit === 0 &&
    terminal.sourceUnchanged === true &&
    (resume === undefined || resume.complete) &&
    exactEnclosingCommand &&
    enclosingCommand.outcome === "passed" &&
    enclosingCommand.exitCode === terminal.commandExit &&
    enclosingCommand.signal === null &&
    stages.every((stage) => stage.outcome !== "UNPROVEN" && stage.stopped)
      ? "passed"
      : "UNPROVEN"
  return {
    version: 1,
    runId,
    worktree: run.worktree,
    sourceInputDigest: identity.sourceInputDigest,
    inputDigest: identity.inputDigest,
    baseSha: identity.baseSha,
    registration: registration.state,
    custody: terminal?.custody ?? reconciled?.custody ?? "UNRESOLVED",
    qualification,
    stages,
    terminal,
    reportDirectory: run.reportDirectory,
    coverage,
    ...(resume === undefined ? {} : { resume }),
    ...(resume?.coverageProvenance === undefined ? {} : { coverageProvenance: resume.coverageProvenance })
  }
}
