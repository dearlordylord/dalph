/**
 * Execute the independent local frozen-candidate qualification obligations.
 *
 * The scheduler owns admission only.  The supplied `run` operation owns the
 * bounded child, its deadline, and custody proof; a permit is therefore
 * released only after that operation settles.  Ordinary terminal failures are
 * retained and do not cancel independent siblings.  Any other failure is a
 * safety loss: admission stops, the active operations receive cancellation,
 * and queued stages remain explicitly not-run.
 */

import { localQualificationConcurrency } from "./quality-gate-stage-policy.mjs"
import { isOrdinaryQualityCommandResult } from "./quality-gate-failure-policy.mjs"

export { localQualificationConcurrency }

export const isOrdinaryQualificationFailure = isOrdinaryQualityCommandResult

/** @typedef {"not-run" | "running" | "passed" | "failed" | "unproven"} QualificationOutcomeStatus */
/** @typedef {number & {readonly __brand: "QualificationOrdinal"}} QualificationOrdinal */
/** @typedef {{ordinal: QualificationOrdinal, stageId: string, status: "not-run"} | {ordinal: QualificationOrdinal, stageId: string, status: "running"} | {ordinal: QualificationOrdinal, stageId: string, status: "passed", value: unknown} | {ordinal: QualificationOrdinal, stageId: string, status: "failed" | "unproven", error: Error}} QualificationOutcome */

/** @returns {QualificationOrdinal} */
const asQualificationOrdinal = (value) => value

/** @returns {QualificationOutcome} */
const notRunOutcome = (ordinal, stageId) => ({ ordinal, stageId, status: "not-run" })

/** @returns {QualificationOutcome} */
const runningOutcome = (ordinal, stageId) => ({ ordinal, stageId, status: "running" })

/** @returns {QualificationOutcome} */
const passedOutcome = (ordinal, stageId, value) => ({ ordinal, stageId, status: "passed", value })

/** @returns {QualificationOutcome} */
const failedOutcome = (ordinal, stageId, error) => ({ ordinal, stageId, status: "failed", error })

/** @returns {QualificationOutcome} */
const unprovenOutcome = (ordinal, stageId, error) => ({ ordinal, stageId, status: "unproven", error })

const stageLabel = (stage, ordinal) => stage?.id ?? stage?.name ?? `qualification-${ordinal}`

const asError = (value) => (value instanceof Error ? value : new Error(String(value)))

const interruptionError = (reason) => {
  const error = asError(reason ?? new Error("local qualification interrupted"))
  if (error.quintCommandResult === undefined) error.quintCommandResult = "interrupted"
  error.qualificationStatus = "unproven"
  return error
}

/**
 * Run a canonical stage list and return every observed outcome in manifest
 * order.  `concurrency` is deliberately capped by the checked-in local
 * policy; callers cannot derive a larger bound from host capacity.
 */
export const runQualificationStages = async ({
  concurrency = localQualificationConcurrency,
  report = () => {},
  run,
  signal,
  stages
}) => {
  if (!Array.isArray(stages)) throw new Error("Local qualification stages must be an array")
  if (typeof run !== "function") throw new Error("Local qualification scheduler requires a stage runner")
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error(`Local qualification concurrency must be a positive integer; received ${concurrency}`)

  /** @type {QualificationOutcome[]} */
  const outcomes = stages.map((stage, ordinal) => {
    const qualifiedOrdinal = asQualificationOrdinal(ordinal)
    return notRunOutcome(qualifiedOrdinal, stageLabel(stage, ordinal))
  })
  if (stages.length === 0) return { outcomes, safetyError: undefined, succeeded: true }

  const controller = new AbortController()
  let next = 0
  /** @type {{ safetyError: Error | undefined }} */
  const schedulerState = { safetyError: undefined }
  const effectiveConcurrency = Math.min(localQualificationConcurrency, concurrency, stages.length)

  const stopForSafety = (reason) => {
    if (schedulerState.safetyError !== undefined) return
    schedulerState.safetyError = interruptionError(reason)
    controller.abort(schedulerState.safetyError)
  }

  const onAbort = () => stopForSafety(signal?.reason ?? new Error("local qualification interrupted"))
  signal?.addEventListener("abort", onAbort, { once: true })
  if (signal?.aborted) onAbort()

  const execute = async (ordinal) => {
    const stage = stages[ordinal]
    const qualifiedOrdinal = asQualificationOrdinal(ordinal)
    const stageId = stageLabel(stage, ordinal)
    outcomes[ordinal] = runningOutcome(qualifiedOrdinal, stageId)
    try {
      const value = await run(stage, controller.signal)
      if (schedulerState.safetyError !== undefined || controller.signal.aborted) {
        const error = schedulerState.safetyError ?? interruptionError()
        error.qualificationStatus = "unproven"
        outcomes[ordinal] = unprovenOutcome(qualifiedOrdinal, stageId, error)
        return
      }
      outcomes[ordinal] = passedOutcome(qualifiedOrdinal, stageId, value)
    } catch (thrown) {
      const error = asError(thrown)
      if (isOrdinaryQualificationFailure(error) && schedulerState.safetyError === undefined) {
        error.qualificationStatus = "failed"
        outcomes[ordinal] = failedOutcome(qualifiedOrdinal, stageId, error)
        return
      }
      error.qualificationStatus = "unproven"
      outcomes[ordinal] = unprovenOutcome(qualifiedOrdinal, stageId, error)
      stopForSafety(error)
    }
  }

  const worker = async () => {
    while (schedulerState.safetyError === undefined && !controller.signal.aborted) {
      const ordinal = next
      next += 1
      if (ordinal >= stages.length) return
      await execute(ordinal)
    }
  }

  await Promise.all(Array.from({ length: effectiveConcurrency }, () => worker()))
  signal?.removeEventListener("abort", onAbort)

  for (const [ordinal, outcome] of outcomes.entries())
    if (outcome.status === "failed")
      report(`Qualification failed: ${stageLabel(stages[ordinal], ordinal)}: ${outcome.error.message}`)

  const succeeded = schedulerState.safetyError === undefined && outcomes.every(({ status }) => status === "passed")
  return { outcomes, safetyError: schedulerState.safetyError, succeeded }
}

/**
 * Build one canonical aggregate error after all safe independent stages have
 * settled.  The runner reports rows in manifest order, never completion order.
 */
export const qualificationAggregateError = ({ outcomes, safetyError, stages }) => {
  const rows = outcomes.map((outcome, ordinal) => {
    const stage = stages[ordinal]
    const evidencePath = outcome.error?.stageEvidencePath ?? outcome.value?.stageEvidencePath
    const evidence = evidencePath === undefined ? "" : `; evidence=${evidencePath}`
    const detail = `${outcome.error?.message ?? outcome.status}${evidence}`
    return `${stageLabel(stage, ordinal)}=${outcome.status}: ${detail}`
  })
  const prefix =
    safetyError === undefined
      ? "Local qualification aggregate failed"
      : `Local qualification stopped fail-closed: ${safetyError.message}`
  const error = new Error(`${prefix}\n${rows.join("\n")}`)
  error.qualificationOutcomes = outcomes
  if (safetyError !== undefined) error.safetyError = safetyError
  return error
}
