import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  atomicRecord,
  custodyVersion,
  digest,
  newIdentity,
  readRecord,
  removeRecord,
  wallClockTimestamp,
  withFileLock
} from "./gate-custody-records.mjs"

const states = new Set([
  "diagnosis-required",
  "diagnosis-running",
  "repair-required",
  "verification-running",
  "verified",
  "qualification-running"
])

export const gateRecoveryPath = (location) =>
  join(location.custodyRoot, "recovery", `${digest(location.worktree)}.json`)

const gateRecoveryLockPath = (location) => join(location.custodyRoot, "recovery", `${digest(location.worktree)}.lock`)

const canonicalCommit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value)
const canonicalDigest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)
const canonicalRunId = (value) => typeof value === "string" && /^[0-9a-f-]{36}$/u.test(value)

const validateGateRecovery = ({ location, record }) => {
  const validInputIdentity =
    (canonicalCommit(record.baseSha) && canonicalDigest(record.failedSourceInputDigest)) ||
    (record.baseSha === null && record.failedSourceInputDigest === null && record.inputIdentity === "UNPROVEN")
  const validStateIdentity =
    record.state === "diagnosis-required" ||
    record.state === "repair-required" ||
    (record.state === "diagnosis-running" && canonicalRunId(record.diagnosisRunId)) ||
    (record.state === "verification-running" && canonicalRunId(record.verificationRunId)) ||
    (record.state === "verified" && canonicalDigest(record.verifiedSourceInputDigest)) ||
    (record.state === "qualification-running" &&
      canonicalRunId(record.qualificationRunId) &&
      canonicalDigest(record.verifiedSourceInputDigest))
  if (
    record.kind !== "gate-recovery" ||
    record.worktree !== location.worktree ||
    !states.has(record.state) ||
    !canonicalRunId(record.failedRunId) ||
    !validInputIdentity ||
    !canonicalDigest(record.failureFingerprint) ||
    !Array.isArray(record.failures) ||
    record.failures.length === 0 ||
    !Array.isArray(record.gateAttempts) ||
    !Array.isArray(record.diagnosisAttempts) ||
    !Array.isArray(record.verificationAttempts) ||
    !validStateIdentity
  )
    throw new Error(`Invalid gate recovery record: ${gateRecoveryPath(location)}`)
  return record
}

export const readGateRecovery = (location) => {
  const path = gateRecoveryPath(location)
  return existsSync(path) ? validateGateRecovery({ location, record: readRecord(path) }) : undefined
}

const stageSummary = (stage) => ({
  obligationId: stage.obligationId,
  parentId: stage.parentId,
  name: stage.command.name,
  command: { executable: stage.command.executable, args: stage.command.args, cwd: stage.command.cwd },
  outcome: stage.outcome,
  exitCode: stage.exitCode ?? null,
  signal: stage.signal ?? null,
  log: stage.log
})

const failureFingerprintFor = (failures) =>
  digest(JSON.stringify(failures.map(({ exitCode, name, outcome, signal }) => ({ exitCode, name, outcome, signal }))))

const writeObstruction = ({
  baseSha,
  failedRunId,
  failedSourceInputDigest,
  failures,
  inputIdentity,
  location,
  suggestedDiagnostic,
  unexecuted
}) => {
  const prior = readGateRecovery(location)
  const failureFingerprint = failureFingerprintFor(failures)
  const recordedAt = wallClockTimestamp()
  const record = {
    version: custodyVersion,
    kind: "gate-recovery",
    obstructionId: prior?.obstructionId ?? newIdentity(),
    worktree: location.worktree,
    state: "diagnosis-required",
    failedRunId,
    baseSha,
    failedSourceInputDigest,
    inputIdentity,
    failureFingerprint,
    failures,
    unexecuted,
    gateAttempts: [
      ...(prior?.gateAttempts ?? []),
      { runId: failedRunId, baseSha, sourceInputDigest: failedSourceInputDigest, failureFingerprint, recordedAt }
    ],
    diagnosisAttempts: prior?.diagnosisAttempts ?? [],
    verificationAttempts: prior?.verificationAttempts ?? [],
    suggestedDiagnostic,
    nextAction: "run-focused-diagnosis",
    recordedAt
  }
  atomicRecord(gateRecoveryPath(location), record)
  return record
}

export const recordGateObstruction = ({ evidence, location }) => {
  const stagesById = new Map(evidence.stages.map((stage) => [stage.obligationId, stage]))
  const failed = (stage) => stage.outcome !== "passed" && stage.outcome !== "UNPROVEN"
  const causalDepth = (stage) => {
    let depth = 0
    let current = stage
    const visited = new Set()
    while (current.parentId !== "root") {
      if (visited.has(current.obligationId)) return null
      visited.add(current.obligationId)
      const parent = stagesById.get(current.parentId)
      if (parent === undefined || !failed(parent)) return null
      current = parent
      depth += 1
    }
    return depth
  }
  const failedStages = evidence.stages
    .map((stage) => ({ depth: failed(stage) ? causalDepth(stage) : null, stage }))
    .filter(({ depth }) => depth !== null)
  const failures = failedStages.map(({ stage }) => stageSummary(stage))
  if (failures.length === 0)
    failures.push({
      obligationId: "gate-terminal",
      name: "admitted gate terminal",
      outcome: evidence.qualification,
      exitCode: evidence.terminal?.commandExit ?? null,
      signal: null,
      log: undefined
    })
  return writeObstruction({
    baseSha: evidence.baseSha,
    failedRunId: evidence.runId,
    failedSourceInputDigest: evidence.sourceInputDigest,
    failures,
    inputIdentity: "recorded",
    location,
    suggestedDiagnostic:
      failedStages.length === 0
        ? null
        : stageSummary(
            failedStages.reduce((best, candidate) => (candidate.depth > best.depth ? candidate : best)).stage
          ),
    unexecuted: evidence.stages.filter((stage) => stage.outcome === "UNPROVEN").map(stageSummary)
  })
}

const recordInterruptedGateObstruction = ({ identity, location, runId }) =>
  writeObstruction({
    baseSha: identity?.baseSha ?? null,
    failedRunId: runId,
    failedSourceInputDigest: identity?.sourceInputDigest ?? null,
    failures: [
      {
        obligationId: "gate-reconciliation",
        name: "reconciled interrupted qualification",
        outcome: "UNPROVEN",
        exitCode: null,
        signal: null
      }
    ],
    inputIdentity: identity === undefined ? "UNPROVEN" : "recorded",
    location,
    suggestedDiagnostic: null,
    unexecuted: []
  })

export const requireGateRecoveryAdmission = ({ currentSourceInputDigest, location }) => {
  const record = readGateRecovery(location)
  if (record === undefined) return undefined
  if (record.state === "verified") {
    if (record.verifiedSourceInputDigest !== currentSourceInputDigest)
      throw new Error(
        `Gate recovery verification became stale after candidate inputs changed; run pnpm gate:verify-repair ${record.failedRunId}`
      )
    return record
  }
  const action =
    record.state === "diagnosis-running"
      ? `reconcile the interrupted diagnosis gate run ${record.diagnosisRunId}`
      : record.state === "verification-running"
        ? `reconcile the interrupted repair verification gate run ${record.verificationRunId}`
        : record.state === "qualification-running"
          ? `reconcile qualification run ${record.qualificationRunId}`
          : record.state === "repair-required"
            ? `repair the diagnosed obstruction, then run pnpm gate:verify-repair ${record.failedRunId}`
            : `run pnpm gate:diagnose ${record.failedRunId} --question=<question> --alternatives='<a> | <b>' --observation=<distinguishing-observation> --contains=<expected-output> --expect=<outcome> --supports=<alternative-number> -- <focused-command>`
  throw new Error(`Gate recovery requires focused diagnosis before another broad gate: ${action}`)
}

export const beginRecoveredQualification = ({ currentSourceInputDigest, location, runId }) => {
  const path = gateRecoveryPath(location)
  if (!existsSync(path)) return
  const record = readGateRecovery(location)
  if (record.state !== "verified" || record.verifiedSourceInputDigest !== currentSourceInputDigest)
    throw new Error("Gate recovery authorization changed before qualification launch")
  atomicRecord(path, {
    ...record,
    state: "qualification-running",
    qualificationRunId: runId,
    qualificationStartedAt: wallClockTimestamp()
  })
}

export const completeRecoveredQualification = ({ location, passed, runId }) => {
  const path = gateRecoveryPath(location)
  if (!existsSync(path)) return
  const record = readGateRecovery(location)
  if (record.state !== "qualification-running" || record.qualificationRunId !== runId)
    throw new Error("Gate recovery qualification identity does not match")
  if (passed) removeRecord(path)
}

export const reconcileGateRecovery = ({ identity, location, run, runId }) => {
  const path = gateRecoveryPath(location)
  if (!existsSync(path)) {
    if (run?.requiresQualityComposite) recordInterruptedGateObstruction({ identity, location, runId })
    return
  }
  const record = readGateRecovery(location)
  if (record.state === "diagnosis-running" && record.diagnosisRunId === runId) {
    const attempt = record.diagnosisAttempts.at(-1)
    atomicRecord(path, {
      ...record,
      state: "diagnosis-required",
      nextAction: "change-diagnostic-experiment",
      diagnosisAttempts: [
        ...record.diagnosisAttempts.slice(0, -1),
        { ...attempt, finishedAt: wallClockTimestamp(), outcome: "UNPROVEN" }
      ]
    })
    return
  }
  if (record.state === "verification-running" && record.verificationRunId === runId) {
    const attempt = record.verificationAttempts.at(-1)
    atomicRecord(path, {
      ...record,
      state: "repair-required",
      nextAction: "change-repair-or-verification",
      verificationAttempts: [
        ...record.verificationAttempts.slice(0, -1),
        { ...attempt, finishedAt: wallClockTimestamp(), outcome: "UNPROVEN" }
      ]
    })
    return
  }
  if (record.state === "qualification-running" && record.qualificationRunId === runId)
    recordInterruptedGateObstruction({
      identity: identity ?? { baseSha: record.baseSha, sourceInputDigest: record.verifiedSourceInputDigest },
      location,
      runId
    })
}

export const withGateRecoveryLock = (location, use) => withFileLock(gateRecoveryLockPath(location), use)
