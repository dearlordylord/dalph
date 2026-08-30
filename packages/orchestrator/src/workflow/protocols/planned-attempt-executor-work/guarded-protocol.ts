import {
  type PlannedTaskAttempt,
  plannedAttemptExecutorCorrelation,
  type TaskWorkSpecification
} from "@dalph/contracts"
import { Effect } from "effect"
import { defaultPlannedAttemptExecutorSuspensionLimit, type PlannedAttemptExecutorSuspensionLimit } from "./events.js"
import { observePlannedAttemptExecutorStateWithPermit } from "./protocol.js"
import {
  beginPlannedAttemptExecutorWorkWithPermit,
  resumePlannedAttemptExecutorWorkWithPermit,
  requestPlannedAttemptExecutorSuspensionWithoutReconciliationWithPermit,
  requestPlannedAttemptExecutorSuspensionWithPermit
} from "./suspension-commands.js"
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

/** Begins exact executor work once while excluding abandonment of that attempt. */
export const beginPlannedAttemptExecutorWork = Effect.fn("PlannedAttemptExecutorWorkflow.begin")(function* (
  plannedAttempt: PlannedTaskAttempt,
  selectedSpecification?: TaskWorkSpecification
) {
  const controller = yield* PlannedAttemptProtocolController
  return yield* controller.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
    beginPlannedAttemptExecutorWorkWithPermit(permit, plannedAttempt, selectedSpecification)
  )
})

/** Resumes exact safely suspended work while excluding abandonment of that attempt. */
export const resumePlannedAttemptExecutorWork = Effect.fn("PlannedAttemptExecutorWorkflow.resume")(function* (
  plannedAttempt: PlannedTaskAttempt,
  selectedSpecification?: TaskWorkSpecification
) {
  const controller = yield* PlannedAttemptProtocolController
  return yield* controller.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
    resumePlannedAttemptExecutorWorkWithPermit(permit, plannedAttempt, selectedSpecification)
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

/** Requests suspension without projecting an earlier ambiguous command. */
export const requestPlannedAttemptExecutorSuspensionWithoutReconciliation = Effect.fn(
  "PlannedAttemptExecutorWorkflow.requestSuspensionWithoutReconciliation"
)(function* (
  plannedAttempt: PlannedTaskAttempt,
  suspensionLimit: PlannedAttemptExecutorSuspensionLimit = defaultPlannedAttemptExecutorSuspensionLimit
) {
  const controller = yield* PlannedAttemptProtocolController
  return yield* controller.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
    requestPlannedAttemptExecutorSuspensionWithoutReconciliationWithPermit(permit, plannedAttempt, suspensionLimit)
  )
})
