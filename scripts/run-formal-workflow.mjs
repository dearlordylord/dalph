import { performance } from "node:perf_hooks"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { atomicRecord, digest, inheritedCustody, newIdentity, repositoryLocation } from "./gate-custody-records.mjs"
import { createFormalEnvironment, resolveFormalToolchain, startFormalInputGuard } from "./formal-input-policy.mjs"
import {
  beginFormalAttempt,
  invalidateFormalAttempt,
  publishFormalSuccess,
  readFormalSuccess
} from "./formal-success-evidence.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"
import { formalGatePolicy } from "./formal-gate-policy.mjs"
import { renderFormalProgressEvent } from "./formal-progress-events.mjs"
import { presentCapturedFailureOutput } from "./quality-output-budget.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"
import { formalVerificationExecutables, stabilizeVerificationEnvironment } from "./stabilize-verification-path.mjs"

export const parseFormalArguments = (args) => {
  if (args.length === 0) return { force: false }
  if (args.length === 1 && args[0] === "--force") return { force: true }
  throw new Error("The formal command accepts only --force")
}

/** Control phases consume one decreasing allowance rather than resetting their deadlines. */
export const createFormalControlDeadline = ({ allowanceMilliseconds, now = () => performance.now() }) => {
  if (!Number.isSafeInteger(allowanceMilliseconds) || allowanceMilliseconds <= 0)
    throw new Error("Formal control requires a finite positive allowance")
  const end = now() + allowanceMilliseconds
  return (phase, cap = allowanceMilliseconds) => {
    const remaining = Math.floor(end - now())
    if (remaining <= 0) throw new Error(`Formal ${phase} control allowance exceeded`)
    return Math.min(cap, remaining)
  }
}

/** The same input observer remains alive while application stages run. */
export const createRetainedFormalLifecycle = ({
  finalValidationMilliseconds = formalGatePolicy.finalValidationMilliseconds,
  guard,
  lookup,
  readSuccess = readFormalSuccess,
  recordMetrics = () => {},
  result
}) => {
  let closed = false
  let finalDeadline
  return {
    ...result,
    finalizeApplicability: async () => {
      if (closed) throw new Error("Formal observation is closed")
      const finalStartedAt = performance.now()
      finalDeadline = createFormalControlDeadline({ allowanceMilliseconds: finalValidationMilliseconds })
      await guard.assertUnchanged({ timeoutMilliseconds: finalDeadline("final observation") })
      const evidenceStartedAt = performance.now()
      const applicable = readSuccess(lookup)
      const evidenceReadMilliseconds = performance.now() - evidenceStartedAt
      if (applicable.status !== "hit" || applicable.evidencePath !== result.evidencePath) {
        throw new Error(`Formal applicability changed: ${applicable.reason ?? "original success was superseded"}`)
      }
      finalDeadline("final evidence")
      const observation = await guard.finish({ timeoutMilliseconds: finalDeadline("final fingerprint") })
      await guard.assertUnchanged({ timeoutMilliseconds: finalDeadline("final observation") })
      recordMetrics({
        finalValidationMilliseconds: performance.now() - finalStartedAt,
        finalEvidenceReadMilliseconds: evidenceReadMilliseconds,
        guard: guard.timings
      })
      finalDeadline("final qualification")
      return {
        success: applicable.success,
        evidencePath: applicable.evidencePath,
        identity: lookup.identity,
        observation
      }
    },
    assertUnchanged: async () => {
      if (closed) throw new Error("Formal observation is closed")
      if (finalDeadline === undefined) throw new Error("Formal final applicability has not been checked")
      await guard.assertUnchanged({ timeoutMilliseconds: finalDeadline("final observation") })
      finalDeadline("final observation")
    },
    close: async () => {
      if (closed) return
      closed = true
      const closeStartedAt = performance.now()
      await guard.close()
      recordMetrics({ observerShutdownMilliseconds: performance.now() - closeStartedAt })
    }
  }
}

/** Admission precedes fresh identity/evidence reads, including nested handoff. */
export const runFormalWorkflow = async ({ force = false, report = console.log, retainGuard = false } = {}) => {
  const startedAt = performance.now()
  const acquisitionDeadline = createFormalControlDeadline({ allowanceMilliseconds: formalGatePolicy.outerMilliseconds })
  const context = inheritedCustody()
  if (context === undefined) throw new Error("Formal verification requires admitted worktree custody")
  const location = { ...repositoryLocation(), runDirectory: context.runDirectory, runId: context.run.runId }
  if (location.worktree !== context.run.worktree) throw new Error("Formal custody belongs to another worktree")
  const formalEnvironment = createFormalEnvironment(process.env)
  const effectiveEnvironment = stabilizeVerificationEnvironment({
    environment: formalEnvironment,
    requiredExecutables: formalVerificationExecutables(formalEnvironment),
    worktree: location.worktree
  })
  const toolResolutionStartedAt = performance.now()
  const toolchain = await resolveFormalToolchain({
    worktree: location.worktree,
    effectiveEnvironment,
    timeoutMilliseconds: acquisitionDeadline("tool preparation", formalGatePolicy.preparationMilliseconds)
  })
  const toolResolutionMilliseconds = performance.now() - toolResolutionStartedAt
  const profile = createQuintEffectiveProfile({ purpose: "local-guarded" })
  const guard = await startFormalInputGuard({
    worktree: location.worktree,
    effectiveEnvironment,
    profile,
    toolchain,
    setupTimeoutMilliseconds: acquisitionDeadline("input setup", formalGatePolicy.inputSetupMilliseconds),
    qualificationTimeoutMilliseconds: acquisitionDeadline(
      "input qualification",
      formalGatePolicy.inputQualificationMilliseconds
    )
  })
  const metricsPath = join(location.runDirectory, "formal-metrics", `${newIdentity()}.json`)
  const metrics = { version: 1, runId: location.runId, toolResolutionMilliseconds }
  const recordMetrics = (extra = {}) => {
    Object.assign(metrics, extra, { guard: guard.timings })
    atomicRecord(metricsPath, metrics)
  }
  const ownership = { transferred: false }
  const finishResult = (result, lookup) => {
    acquisitionDeadline("acquisition qualification")
    recordMetrics({ acquisitionMilliseconds: performance.now() - startedAt, disposition: result.status })
    const measured = { ...result, metrics, metricsPath }
    if (!retainGuard) return measured
    const lifecycle = createRetainedFormalLifecycle({ guard, lookup, recordMetrics, result: measured })
    ownership.transferred = true
    return lifecycle
  }
  try {
    const lookup = { location, identity: guard.identity, profileIdentity: guard.identity.profileDigest }
    acquisitionDeadline("evidence read")
    const evidenceStartedAt = performance.now()
    const prior = readFormalSuccess(lookup)
    metrics.evidenceReadMilliseconds = performance.now() - evidenceStartedAt
    acquisitionDeadline("evidence read")
    if (!force && prior.status === "hit") {
      await guard.finish({
        timeoutMilliseconds: acquisitionDeadline("reuse qualification", formalGatePolicy.inputQualificationMilliseconds)
      })
      report(`Formal: reusing complete success; zero checkers or servers started. Evidence: ${prior.evidencePath}`)
      return finishResult({ status: "reused", success: prior.success, evidencePath: prior.evidencePath }, lookup)
    }
    const attempt = beginFormalAttempt(lookup)
    const reportPath = join(location.runDirectory, "formal-executions", `${attempt.attemptId}.json`)
    const requestPath = join(location.runDirectory, "formal-requests", `${attempt.attemptId}.json`)
    atomicRecord(requestPath, {
      version: 1,
      runId: location.runId,
      worktree: location.worktree,
      attemptId: attempt.attemptId,
      reportPath,
      toolchain,
      profile
    })
    report(`Formal: running complete profile — ${force ? "fresh execution requested" : prior.reason}.`)
    const profileTimeoutMilliseconds = Math.min(
      formalGatePolicy.executionEnvelopeMilliseconds,
      acquisitionDeadline("profile execution") - 7_000
    )
    if (profileTimeoutMilliseconds <= 0)
      throw new Error("Formal profile has no allowance remaining after termination reserve")
    const executionStartedAt = performance.now()
    const result = await runBoundedCommand({
      executable: process.execPath,
      args: [join(location.worktree, "scripts", "run-formal-profile.mjs"), requestPath],
      cwd: location.worktree,
      environment: {
        ...effectiveEnvironment,
        DALPH_GATE_RUN_DIRECTORY: context.runDirectory,
        DALPH_GATE_RUN_ID: context.run.runId,
        DALPH_GATE_OBLIGATION: process.env.DALPH_GATE_OBLIGATION,
        DALPH_GATE_SLOT: String(context.run.slot)
      },
      name: "complete identified formal profile",
      relayParentSignals: true,
      captureOutput: true,
      forwardOutput: false,
      progressTransport: { onEvent: (event) => report(renderFormalProgressEvent(event)), onError: () => {} },
      timeoutMilliseconds: profileTimeoutMilliseconds,
      terminationGraceMilliseconds: 5_000,
      processGroupAbsenceTimeoutMilliseconds: 2_000
    })
    metrics.executionMilliseconds = performance.now() - executionStartedAt
    const observation = await guard.finish({
      timeoutMilliseconds: acquisitionDeadline(
        "execution qualification",
        formalGatePolicy.inputQualificationMilliseconds
      )
    })
    const publicationStartedAt = performance.now()
    const success = publishFormalSuccess({
      attempt,
      observation,
      execution: {
        helperObligationId: result.gateObligationId,
        reportPath,
        reportDigest: digest(readFileSync(reportPath))
      }
    })
    try {
      await guard.assertUnchanged({ timeoutMilliseconds: acquisitionDeadline("publication observation") })
      acquisitionDeadline("publication qualification")
    } catch (error) {
      invalidateFormalAttempt({ attempt, reason: error.message })
      throw error
    }
    metrics.publicationMilliseconds = performance.now() - publicationStartedAt
    report(`Formal: complete profile passed; success recorded. Evidence: ${attempt.recordPath}`)
    return finishResult({ status: "executed", success, evidencePath: attempt.recordPath }, lookup)
  } catch (error) {
    try {
      presentCapturedFailureOutput({
        logPath: error.logPath,
        logAvailable: error.loggingFailure === undefined && error.logPath !== undefined,
        logFailure:
          error.loggingFailure === undefined
            ? undefined
            : `${error.loggingFailure.phase}: ${error.loggingFailure.message}`,
        name: "complete identified formal profile",
        output: error.output
      })
    } catch {
      // Failure presentation must never replace the bounded command outcome.
    }
    throw error
  } finally {
    if (!ownership.transferred) {
      const closeStartedAt = performance.now()
      await guard.close()
      recordMetrics({
        observerShutdownMilliseconds: performance.now() - closeStartedAt,
        totalMilliseconds: performance.now() - startedAt
      })
      acquisitionDeadline("observer cleanup")
    }
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  try {
    await runFormalWorkflow(parseFormalArguments(process.argv.slice(2)))
  } catch (error) {
    console.error(`Formal: failed — ${error.message}`)
    process.exitCode = 1
  }
}
