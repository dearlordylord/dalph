import { type PlannedTaskAttempt, plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect } from "effect"
import {
  defaultPlannedAttemptExecutorContinuationLimit,
  defaultPlannedAttemptExecutorSuspensionLimit,
  type PlannedAttemptExecutorContinuationLimit,
  type PlannedAttemptExecutorSuspensionLimit
} from "./events.js"
import {
  continuePlannedAttemptExecutorWorkWithPermit,
  observePlannedAttemptExecutorStateWithPermit,
  requestPlannedAttemptExecutorSuspensionWithPermit
} from "./protocol.js"
import { PlannedAttemptProtocolController } from "./protocol-controller.js"

/** Reads the exact executor state while excluding command intent and abandonment changes for that attempt. */
export const observePlannedAttemptExecutorState = Effect.fn("PlannedAttemptExecutorWorkflow.observeState")(function* (
  plannedAttempt: PlannedTaskAttempt
) {
  const controller = yield* PlannedAttemptProtocolController
  return yield* controller.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
    observePlannedAttemptExecutorStateWithPermit(permit, plannedAttempt)
  )
})

/** Starts or resumes exact executor work while excluding abandonment of that attempt. */
export const continuePlannedAttemptExecutorWork = Effect.fn("PlannedAttemptExecutorWorkflow.continue")(function* (
  plannedAttempt: PlannedTaskAttempt,
  continuationLimit: PlannedAttemptExecutorContinuationLimit = defaultPlannedAttemptExecutorContinuationLimit
) {
  const controller = yield* PlannedAttemptProtocolController
  return yield* controller.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
    continuePlannedAttemptExecutorWorkWithPermit(permit, plannedAttempt, continuationLimit)
  )
})

/** Requests exact executor suspension while excluding abandonment of that attempt. */
export const requestPlannedAttemptExecutorSuspension = Effect.fn("PlannedAttemptExecutorWorkflow.requestSuspension")(
  function* (
    plannedAttempt: PlannedTaskAttempt,
    suspensionLimit: PlannedAttemptExecutorSuspensionLimit = defaultPlannedAttemptExecutorSuspensionLimit
  ) {
    const controller = yield* PlannedAttemptProtocolController
    return yield* controller.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
      requestPlannedAttemptExecutorSuspensionWithPermit(permit, plannedAttempt, suspensionLimit)
    )
  }
)
