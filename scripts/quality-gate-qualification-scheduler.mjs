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

export { localQualificationConcurrency }

const ordinaryFailure = /^(?:exit:\d+|launch-failed|timed-out)$/u

export const isOrdinaryQualificationFailure = (error) => ordinaryFailure.test(error?.quintCommandResult ?? "")

const stageLabel = (stage, ordinal) => stage?.id ?? stage?.name ?? `qualification-${ordinal}`

const asError = (value) => (value instanceof Error ? value : new Error(String(value)))

const interruptionError = (reason) => {
  const error = asError(reason ?? new Error("local qualification interrupted"))
  if (error.quintCommandResult === undefined) error.quintCommandResult = "interrupted"
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

  const outcomes = stages.map((stage, ordinal) => ({ ordinal, stageId: stageLabel(stage, ordinal), status: "not-run" }))
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
    outcomes[ordinal] = { ...outcomes[ordinal], status: "running" }
    try {
      const value = await run(stage, controller.signal)
      if (schedulerState.safetyError !== undefined || controller.signal.aborted) {
        const error = schedulerState.safetyError ?? interruptionError()
        outcomes[ordinal] = { ...outcomes[ordinal], status: "unproven", error }
        return
      }
      outcomes[ordinal] = { ...outcomes[ordinal], status: "passed", value }
    } catch (thrown) {
      const error = asError(thrown)
      if (isOrdinaryQualificationFailure(error) && schedulerState.safetyError === undefined) {
        outcomes[ordinal] = { ...outcomes[ordinal], status: "failed", error }
        return
      }
      outcomes[ordinal] = { ...outcomes[ordinal], status: "unproven", error }
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
    const evidence =
      outcome.error?.stageEvidencePath === undefined ? "" : `; evidence=${outcome.error.stageEvidencePath}`
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
