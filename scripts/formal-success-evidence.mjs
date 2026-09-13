import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  atomicRecord,
  digest,
  localHostIdentity,
  newIdentity,
  readRecord,
  repositoryLocation,
  validateRun,
  wallClockTimestamp
} from "./gate-custody-records.mjs"
import { groupIsAbsent, validateObligation } from "./gate-registration.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"
import { validateQuintCommandOutput } from "./quint-witness-coverage.mjs"
import { assertCleanTemporalVerdict, assertViolatedTemporalVerdict } from "./quint-temporal-gate.mjs"
import { formalEvidenceContract } from "./formal-evidence-contract.mjs"

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const requireFact = (fact, message) => {
  if (!fact) throw new Error(message)
}
export const formalSuccessPolicyVersion = formalEvidenceContract.successPolicyVersion
const policyVersion = formalSuccessPolicyVersion
const scope = ({ identity, location, profileIdentity }) => {
  requireFact(
    typeof identity?.inputDigest === "string" && identity.worktree === location.worktree,
    "Invalid current formal identity"
  )
  const host = localHostIdentity()
  const key = digest(
    JSON.stringify({
      host,
      worktree: location.worktree,
      identity: identity.inputDigest,
      profileIdentity,
      policyVersion
    })
  )
  return { host, key, pointerPath: join(location.custodyRoot, "formal", `${key}.json`) }
}

/** Beginning a supported full attempt replaces earlier success before any checker can launch. */
export const beginFormalAttempt = ({ identity, location, profileIdentity }) => {
  const selected = scope({ identity, location, profileIdentity })
  const run = validateRun(location.runDirectory, location.runId)
  requireFact(run.worktree === location.worktree, "Formal attempt belongs to another worktree")
  const attempt = {
    version: 1,
    policyVersion,
    attemptId: newIdentity(),
    runId: run.runId,
    runDirectory: location.runDirectory,
    worktree: run.worktree,
    host: selected.host,
    identity,
    profileIdentity,
    startedAt: wallClockTimestamp(),
    pointerPath: selected.pointerPath
  }
  attempt.recordPath = join(location.runDirectory, "formal-attempts", `${attempt.attemptId}.json`)
  // Pointer first: a crash before the payload cannot resurrect previous success.
  atomicRecord(selected.pointerPath, {
    version: 1,
    policyVersion,
    state: "started",
    attemptId: attempt.attemptId,
    recordPath: attempt.recordPath
  })
  atomicRecord(attempt.recordPath, { ...attempt, state: "started" })
  return attempt
}

const readStoppedSubtree = ({ helperObligationId, runDirectory, runId }) => {
  const run = validateRun(runDirectory, runId)
  const registration = readRecord(join(runDirectory, "registration.json"))
  requireFact(
    registration.runId === runId &&
      ["open", "closed"].includes(registration.state) &&
      Array.isArray(registration.obligations),
    "Invalid formal custody inventory"
  )
  requireFact(
    new Set(registration.obligations).size === registration.obligations.length &&
      same(
        [...registration.obligations].sort((left, right) => left.localeCompare(right)),
        readdirSync(join(runDirectory, "obligations"))
          .map((name) => name.replace(/\.json$/u, ""))
          .sort((left, right) => left.localeCompare(right))
      ),
    "Incomplete formal custody inventory"
  )
  const obligations = registration.obligations.map((id) => {
    const item = validateObligation(readRecord(join(runDirectory, "obligations", `${id}.json`)), runId)
    requireFact(
      item.obligationId === id && (item.parentId === "root" || registration.obligations.includes(item.parentId)),
      "Invalid formal obligation parent"
    )
    return item
  })
  requireFact(
    obligations.some((item) => item.obligationId === helperObligationId),
    "Missing formal helper"
  )
  const ids = new Set([helperObligationId])
  for (let previous = -1; previous !== ids.size;) {
    previous = ids.size
    for (const item of obligations) if (ids.has(item.parentId)) ids.add(item.obligationId)
  }
  const identity = readRecord(join(runDirectory, "identity.json"))
  const receipts = obligations
    .filter((item) => ids.has(item.obligationId))
    .map((item) => {
      const receipt = readRecord(join(runDirectory, "receipts", `${item.obligationId}.json`))
      requireFact(
        receipt.runId === runId &&
          receipt.obligationId === item.obligationId &&
          receipt.inputDigest === identity.inputDigest &&
          same(receipt.command, item.command),
        "Mismatched formal receipt"
      )
      requireFact(
        item.state === "observed" && receipt.groupAbsent === true && groupIsAbsent(item.processGroup),
        "Formal child custody is unresolved"
      )
      requireFact(
        (receipt.signal === null && Number.isInteger(receipt.exitCode) && receipt.exitCode >= 0) ||
          (receipt.exitCode === null && typeof receipt.signal === "string"),
        "Invalid actual formal exit"
      )
      return { ...receipt, parentId: item.parentId }
    })
  const helper = receipts.find((item) => item.obligationId === helperObligationId)
  requireFact(
    helper.outcome === "passed" &&
      helper.exitCode === 0 &&
      helper.signal === null &&
      same(helper.command.acceptedExitCodes, [0]),
    "Formal helper did not pass"
  )
  requireFact(
    helper.command.executable === process.execPath &&
      helper.command.args[0] === join(run.worktree, "scripts", "run-formal-profile.mjs"),
    "Unsupported formal helper command"
  )
  return { run, receipts }
}

/** Required verdict bytes are retained separately; optional console logs do not attest verdicts. */
export const validateFormalExecution = ({ attempt, execution }) => {
  requireFact(
    typeof execution.reportPath === "string" &&
      resolve(execution.reportPath).startsWith(`${attempt.runDirectory}/`) &&
      realpathSync(execution.reportPath).startsWith(`${attempt.runDirectory}/`),
    "Formal report is outside original custody"
  )
  const bytes = readFileSync(execution.reportPath)
  requireFact(digest(bytes) === execution.reportDigest, "Formal verdict report changed")
  const report = JSON.parse(bytes)
  requireFact(report.version === 1, "Obsolete formal report")
  const profileResult = report.profileResult
  requireFact(
    profileResult?.entryPoint === attempt.identity.toolchain?.quintEntryPoint,
    "Formal installed checker changed"
  )
  const profile = createQuintEffectiveProfile({ purpose: "local-guarded" })
  requireFact(
    same(profileResult?.profile, profile) && digest(JSON.stringify(profile)) === attempt.profileIdentity,
    "Obsolete or incomplete formal profile"
  )
  requireFact(
    Array.isArray(profileResult.commands) && profileResult.commands.length === profile.commands.length,
    "Missing formal obligation"
  )
  const { receipts } = readStoppedSubtree({ ...attempt, helperObligationId: execution.helperObligationId })
  const used = new Set([execution.helperObligationId])
  for (const [position, expected] of profile.commands.entries()) {
    const command = profileResult.commands[position]
    requireFact(
      command.position === position &&
        command.name === expected.name &&
        command.kind === expected.kind &&
        same(command.verdict, expected.verdict),
      "Formal obligation identity changed"
    )
    const args = [...command.args]
    const endpoint = args.indexOf("--server-endpoint")
    if (endpoint >= 0) {
      requireFact(
        expected.kind === "verify" &&
          args[endpoint + 1] === profileResult.serverEndpoint &&
          args.lastIndexOf("--server-endpoint") === endpoint,
        "Unidentified formal server endpoint"
      )
      args.splice(endpoint, 2)
    }
    requireFact(expected.kind !== "verify" || endpoint >= 0, "Formal verify did not use owned endpoint")
    requireFact(same(args, expected.args), "Formal command arguments changed")
    const receipt = receipts.find((item) => item.obligationId === command.obligationId)
    requireFact(receipt !== undefined && !used.has(command.obligationId), "Missing or duplicate formal checker receipt")
    used.add(command.obligationId)
    requireFact(
      receipt.outcome === "passed" &&
        receipt.signal === null &&
        receipt.exitCode === command.exitCode &&
        expected.verdict.acceptedExitCodes.includes(receipt.exitCode) &&
        same(receipt.command.acceptedExitCodes, expected.verdict.acceptedExitCodes) &&
        same(receipt.command.args, [profileResult.entryPoint, ...command.args]) &&
        receipt.command.name === command.name &&
        receipt.command.executable === command.executable &&
        command.executable === attempt.identity.toolchain.nodeExecutable,
      "Formal checker verdict is not proven"
    )
    requireFact(typeof command.output === "string", "Missing required verdict output")
    validateQuintCommandOutput({ args: expected.args, name: expected.name, output: command.output })
    if (expected.verdict.temporal === "clean") assertCleanTemporalVerdict(command, expected.name)
    if (expected.verdict.temporal === "violation") assertViolatedTemporalVerdict(command, expected.name)
  }
  const server = report.serverEvidence
  requireFact(
    typeof server?.stopPath === "string" &&
      server.stopPath === join(attempt.runDirectory, "owned-server-stops", `${server.obligationId}.json`),
    "Missing planned server stop"
  )
  const stop = readRecord(server.stopPath)
  const receipt = receipts.find((item) => item.obligationId === server.obligationId)
  requireFact(
    receipt !== undefined &&
      !used.has(server.obligationId) &&
      receipt.outcome === "cancelled" &&
      stop.runId === attempt.runId &&
      stop.obligationId === server.obligationId &&
      stop.processGroup === server.processGroup &&
      stop.serverEndpoint === profileResult.serverEndpoint &&
      server.serverEndpoint === profileResult.serverEndpoint &&
      stop.disposition === "profile-complete" &&
      typeof stop.requestedAt === "string",
    "Owned server stop is not proven"
  )
  const endpointMatch = /^127\.0\.0\.1:(\d+)$/u.exec(server.serverEndpoint)
  requireFact(
    endpointMatch !== null &&
      receipt.command.executable === attempt.identity.toolchain.javaExecutable &&
      same(receipt.command.args, [
        ...attempt.identity.toolchain.javaArguments,
        "-jar",
        attempt.identity.toolchain.apalacheJar,
        `--out-dir=${join(attempt.runDirectory, "owned-server-output", execution.helperObligationId)}`,
        "server",
        `--port=${endpointMatch[1]}`
      ]),
    "Owned server installed command changed"
  )
  const absence = readRecord(join(attempt.runDirectory, "absence", `${server.obligationId}.json`))
  requireFact(
    absence.runId === attempt.runId &&
      absence.obligationId === server.obligationId &&
      absence.state === "observed" &&
      absence.processGroup === server.processGroup,
    "Owned server absence changed"
  )
  const serverObligation = readRecord(join(attempt.runDirectory, "obligations", `${server.obligationId}.json`))
  requireFact(
    serverObligation.processGroup === server.processGroup &&
      server.receiptPath === join(attempt.runDirectory, "receipts", `${server.obligationId}.json`),
    "Owned server receipt association changed"
  )
  used.add(server.obligationId)
  requireFact(
    receipts.every((item) => used.has(item.obligationId)),
    "Undeclared formal child obligation"
  )
  return { report, receipts, used }
}

export const publishFormalSuccess = ({ attempt, execution, observation }) => {
  requireFact(
    observation?.version === formalEvidenceContract.inputPolicyVersion &&
      observation.observerVersion === formalEvidenceContract.observerVersion &&
      observation.unchanged === true &&
      observation.ready === true &&
      observation.drained === true &&
      observation.inputDigest === attempt.identity.inputDigest,
    "Formal observation is incomplete or changed"
  )
  const pointer = readRecord(attempt.pointerPath)
  requireFact(pointer.attemptId === attempt.attemptId && pointer.state === "started", "Formal attempt was superseded")
  validateFormalExecution({ attempt, execution })
  const success = { ...attempt, state: "passed", finishedAt: wallClockTimestamp(), execution, observation }
  atomicRecord(attempt.recordPath, success)
  atomicRecord(attempt.pointerPath, {
    version: 1,
    policyVersion,
    state: "passed",
    attemptId: attempt.attemptId,
    recordPath: attempt.recordPath
  })
  return success
}

/** A failed final input drain invalidates only this attempt; historical records remain evidence. */
export const invalidateFormalAttempt = ({ attempt, reason }) => {
  requireFact(typeof reason === "string" && reason.length > 0, "Formal invalidation requires a reason")
  const pointer = readRecord(attempt.pointerPath)
  requireFact(
    pointer.attemptId === attempt.attemptId && pointer.recordPath === attempt.recordPath,
    "Formal invalidation cannot replace another attempt"
  )
  atomicRecord(attempt.pointerPath, {
    version: 1,
    policyVersion,
    state: "invalidated",
    attemptId: attempt.attemptId,
    recordPath: attempt.recordPath,
    reasonDigest: digest(reason),
    invalidatedAt: wallClockTimestamp()
  })
}

export const readFormalSuccess = ({ identity, location, profileIdentity }) => {
  const selected = scope({ identity, location, profileIdentity })
  if (!existsSync(selected.pointerPath)) return { status: "miss", reason: "no reusable success" }
  try {
    const pointer = readRecord(selected.pointerPath)
    requireFact(
      pointer.policyVersion === policyVersion && pointer.state === "passed",
      "latest formal attempt has no success"
    )
    requireFact(
      typeof pointer.recordPath === "string" && resolve(pointer.recordPath).startsWith(`${location.custodyRoot}/runs/`),
      "Invalid formal success locator"
    )
    const success = readReferencedFormalSuccess({
      recordPath: pointer.recordPath,
      worktree: location.worktree,
      identity,
      profileIdentity
    })
    requireFact(
      success.attemptId === pointer.attemptId && success.pointerPath === selected.pointerPath,
      "Formal latest pointer changed"
    )
    return { status: "hit", success, evidencePath: pointer.recordPath }
  } catch (error) {
    return { status: "miss", reason: error.message }
  }
}

/** Historical handoff evidence identifies its original success, independent of later attempts. */
export const readReferencedFormalSuccess = ({ identity, profileIdentity, recordPath, worktree }) => {
  const location = repositoryLocation(worktree)
  requireFact(
    typeof recordPath === "string" && resolve(recordPath).startsWith(`${location.custodyRoot}/runs/`),
    "Invalid referenced formal locator"
  )
  const success = readRecord(recordPath)
  const expectedIdentity = identity ?? success.identity
  const expectedProfile = profileIdentity ?? success.profileIdentity
  const selected = scope({ identity: expectedIdentity, location, profileIdentity: expectedProfile })
  requireFact(
    success.policyVersion === policyVersion &&
      success.state === "passed" &&
      success.recordPath === recordPath &&
      success.pointerPath === selected.pointerPath &&
      success.worktree === location.worktree &&
      same(success.host, selected.host) &&
      same(success.identity, expectedIdentity) &&
      success.profileIdentity === expectedProfile,
    "Referenced formal success identity changed"
  )
  requireFact(
    success.recordPath === join(success.runDirectory, "formal-attempts", `${success.attemptId}.json`) &&
      Number.isFinite(Date.parse(success.startedAt)) &&
      Number.isFinite(Date.parse(success.finishedAt)) &&
      Date.parse(success.finishedAt) >= Date.parse(success.startedAt),
    "Invalid referenced formal provenance"
  )
  requireFact(
    success.observation?.version === formalEvidenceContract.inputPolicyVersion &&
      success.observation.observerVersion === formalEvidenceContract.observerVersion &&
      success.observation.unchanged === true &&
      success.observation.ready === true &&
      success.observation.drained === true &&
      success.observation.inputDigest === expectedIdentity.inputDigest,
    "Referenced formal observation is incomplete"
  )
  validateFormalExecution({ attempt: success, execution: success.execution })
  return success
}
