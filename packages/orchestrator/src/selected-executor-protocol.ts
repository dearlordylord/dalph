import { Effect, Option } from "effect"
import type { OperationId, RunId, TechnicalRetryNotBefore } from "./domain.js"
import {
  ExecutorOuterInvocationOutcome,
  ExecutorOuterInvocationProjection,
  ExecutorOuterInvocationWait,
  makeExecutorOuterInvocation
} from "./executor-boundary.js"
import type { ExecutorOuterInvocation } from "./executor-boundary.js"
import { makeRecoveredImplementationConvergenceStages } from "./implementation-convergence-recovery.js"
import type { FreshImplementationConvergenceStageError } from "./implementation-convergence-stage.js"
import { implementationConvergencePredecessorOperationId } from "./implementation-convergence.js"
import type { JournalRecord } from "./journal-store.js"
import { WorkflowResponsibilityEntry, type WorkflowResponsibilityState } from "./reconstructed-managed-run-state.js"
import type { ExecutorReconstructionProtocol } from "./reconstructed-managed-run.js"
import { taskWorkCapacityRequirementFor } from "./task-work-capacity.js"
import {
  recoverImplementationEvidenceSealings,
  recoverImplementationReviews,
  recoverReviewFindingsHandbacks,
  recoverTaskExecutions
} from "./workflow-operation-recovery.js"

type HasOutcome = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
) => boolean

const plannedAttemptFor = (
  records: ReadonlyArray<JournalRecord>,
  predecessorOperationId: OperationId
) => {
  const intent = records.find(({ event }) =>
    event._tag === "ImplementationEvidenceSealingIntended"
    && event.operation.operationId === predecessorOperationId
  )
  return intent?.event._tag === "ImplementationEvidenceSealingIntended"
    ? intent.event.operation.plannedAttempt
    : undefined
}

/**
 * The selected executor owns this fixed evidence and semantic-review
 * algorithm.
 *
 * Transitional #158 warning: the branches below currently expose its
 * executor-internal intents as generic responsibilities. They preserve the
 * unreleased implementation's behavior, but they are not the accepted outer
 * boundary and must not be copied. #158 replaces them with one responsibility
 * for the complete opaque executor invocation.
 */
const selectedExecutorResponsibilityFor = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord,
  _hasOutcome: HasOutcome
): WorkflowResponsibilityEntry | undefined => {
  const event = record.event
  if (
    event._tag === "TaskExecutionIntentRecorded"
  ) {
    return WorkflowResponsibilityEntry.cases.ExecutorInvocationResponsibility
      .make({
        beganAt: record.position,
        capacityRequirement: taskWorkCapacityRequirementFor("TaskExecution"),
        invocation: makeExecutorOuterInvocation(
          event.operation.request.operationId,
          event.operation.request.plannedAttempt.taskId
        )
      })
  }
  if (
    event._tag === "ImplementationEvidenceSealingIntended"
  ) {
    return WorkflowResponsibilityEntry.cases.ExecutorInvocationResponsibility
      .make({
        beganAt: record.position,
        capacityRequirement: taskWorkCapacityRequirementFor(
          "ImplementationEvidenceSealing"
        ),
        invocation: makeExecutorOuterInvocation(
          event.operation.operationId,
          event.operation.plannedAttempt.taskId
        )
      })
  }
  if (
    event._tag === "ImplementationReviewIntended"
  ) {
    const plannedAttempt = plannedAttemptFor(
      records,
      event.operation.request.evidenceSealingOperationId
    )
    if (plannedAttempt === undefined) return undefined
    return WorkflowResponsibilityEntry.cases.ExecutorInvocationResponsibility
      .make({
        beganAt: record.position,
        capacityRequirement: taskWorkCapacityRequirementFor(
          "ImplementationReview"
        ),
        invocation: makeExecutorOuterInvocation(
          event.operation.request.operationId,
          plannedAttempt.taskId
        )
      })
  }
  if (
    event._tag === "ReviewFindingsHandbackIntended"
  ) {
    return WorkflowResponsibilityEntry.cases.ExecutorInvocationResponsibility
      .make({
        beganAt: record.position,
        capacityRequirement: taskWorkCapacityRequirementFor(
          "ReviewFindingsHandback"
        ),
        invocation: makeExecutorOuterInvocation(
          event.operation.request.operationId,
          event.operation.request.plannedAttempt.taskId
        )
      })
  }
  return undefined
}

/**
 * Transitional #158 validation paired with the responsibility projection
 * above. Internal review intents disappear from this generic protocol when the
 * truthful source boundary lands.
 */
const unresolvedSelectedExecutorSubjects = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: WorkflowResponsibilityState,
  hasOutcome: HasOutcome
): ReadonlyArray<{
  readonly operationId: OperationId
  readonly position: JournalRecord["position"]
}> =>
  records.flatMap((record) => {
    const event = record.event
    if (
      event._tag !== "ImplementationReviewIntended"
      || hasOutcome(records, event.operation.request.operationId)
      || responsibility.entries.some((entry) =>
        entry._tag === "ExecutorInvocationResponsibility"
        && entry.invocation.correlation.invocationId
          === event.operation.request.operationId
      )
    ) return []
    return [{
      operationId: event.operation.request.operationId,
      position: record.position
    }]
  })

export const selectedExecutorReconstructionProtocol = {
  responsibilityFor: selectedExecutorResponsibilityFor,
  unresolvedSubjects: unresolvedSelectedExecutorSubjects
} satisfies ExecutorReconstructionProtocol

/** Continues one exact opaque outer invocation through the selected adapter. */
export const recoverSelectedExecutorInvocation = Effect.fn(
  "SelectedExecutorProtocol.recoverInvocation"
)(function*(runId: RunId, invocationId: OperationId) {
  yield* recoverTaskExecutions(runId, invocationId)
  yield* recoverImplementationEvidenceSealings(runId, invocationId)
  yield* recoverImplementationReviews(runId, invocationId)
  yield* recoverReviewFindingsHandbacks(runId, invocationId)
})

export type SelectedExecutorStageError = FreshImplementationConvergenceStageError

/** Rebuilds the selected executor's process-local continuation stages. */
export const makeRecoveredSelectedExecutorStages = makeRecoveredImplementationConvergenceStages

/** Returns the live worker lookup owned by this protocol, when one exists. */
export const selectedExecutorTaskExecutionLookup = (
  records: ReadonlyArray<JournalRecord>,
  invocationId: OperationId
) => {
  const intent = records.find(({ event }) =>
    event._tag === "TaskExecutionIntentRecorded"
    && event.operation.request.operationId === invocationId
  )
  return intent?.event._tag === "TaskExecutionIntentRecorded"
      && intent.event.operation.request.session._tag === "EstablishedSession"
    ? {
      operationId: invocationId,
      plannedAttempt: intent.event.operation.request.plannedAttempt,
      sessionId: intent.event.operation.request.session.sessionId
    }
    : undefined
}

export const selectedExecutorTerminalFailureForTag = (
  tag:
    | "Accepted"
    | "HandbackTechnicalRetryExhausted"
    | "ImplementationExecutionFailed"
    | "ImplementationExecutionInterrupted"
    | "ImplementationNonConvergent"
    | "ResourceEmergency"
    | "ReviewTechnicalRetryExhausted"
): "Failed" | "NonConvergent" | undefined =>
  tag === "ImplementationNonConvergent"
    ? "NonConvergent"
    : tag === "ReviewTechnicalRetryExhausted"
        || tag === "HandbackTechnicalRetryExhausted"
    ? "Failed"
    : undefined

const terminalFailureFor = (
  records: ReadonlyArray<JournalRecord>,
  invocationId: OperationId
): "Failed" | "NonConvergent" | undefined => {
  const terminalDisposition = records.find(({ event }) =>
    event._tag === "ImplementationConvergenceDispositionRecorded"
    && event.operation.request._tag
      === "AuthorizedImplementationConvergenceDisposition"
    && implementationConvergencePredecessorOperationId(
        event.operation.request.disposition
      ) === invocationId
  )?.event
  if (
    terminalDisposition?._tag
      !== "ImplementationConvergenceDispositionRecorded"
    || terminalDisposition.operation.request._tag
      !== "AuthorizedImplementationConvergenceDisposition"
  ) return undefined
  const tag = terminalDisposition.operation.request.disposition._tag
  return selectedExecutorTerminalFailureForTag(tag)
}

export const selectedExecutorTerminalFailureOutcome = (
  correlation: ExecutorOuterInvocation["correlation"],
  failure: "Failed" | "NonConvergent"
): ExecutorOuterInvocationOutcome =>
  failure === "NonConvergent"
    ? ExecutorOuterInvocationOutcome.cases.NonConvergent.make({
      correlation
    })
    : ExecutorOuterInvocationOutcome.cases.Failed.make({ correlation })

const outerOutcomeEventFor = (
  records: ReadonlyArray<JournalRecord>,
  invocationId: OperationId
) =>
  records.find(({ event }) =>
    event._tag === "TaskExecutionOutcomeObserved"
      ? event.outcome.outcome.operationId === invocationId
      : event._tag === "ImplementationEvidenceSealed"
      ? event.operationId === invocationId
      : event._tag === "ImplementationReviewCompleted"
      ? event.review.manifest.operationId === invocationId
      : event._tag === "ReviewFindingsHandbackCompleted"
      ? event.acknowledgement.operationId === invocationId
      : false
  )?.event

/** Normalizes the selected protocol's durable event into one outer outcome. */
const selectedExecutorOutcomeFor = (
  records: ReadonlyArray<JournalRecord>,
  invocation: ExecutorOuterInvocation
): Option.Option<ExecutorOuterInvocationOutcome> => {
  const correlation = invocation.correlation
  const terminalFailure = terminalFailureFor(
    records,
    correlation.invocationId
  )
  if (terminalFailure !== undefined) {
    return Option.some(
      selectedExecutorTerminalFailureOutcome(correlation, terminalFailure)
    )
  }
  const event = outerOutcomeEventFor(
    records,
    correlation.invocationId
  )
  if (event === undefined) return Option.none()
  if (event._tag === "TaskExecutionOutcomeObserved") {
    const outcome = event.outcome.outcome
    return Option.some(
      outcome._tag === "Interrupted"
        ? ExecutorOuterInvocationOutcome.cases.Interrupted.make({
          interruption: {
            correlation,
            observationId: outcome.observationId
          }
        })
        : outcome._tag === "Succeeded"
        ? ExecutorOuterInvocationOutcome.cases.Completed.make({ correlation })
        : ExecutorOuterInvocationOutcome.cases.Failed.make({ correlation })
    )
  }
  return Option.some(
    ExecutorOuterInvocationOutcome.cases.Completed.make({ correlation })
  )
}

/**
 * Projects only the selected executor's declared outer state. A pending
 * durable retry remains a wait until its exact deferral is superseded.
 */
export const selectedExecutorProjectionFor = (
  records: ReadonlyArray<JournalRecord>,
  invocation: ExecutorOuterInvocation,
  now: TechnicalRetryNotBefore
): ExecutorOuterInvocationProjection => {
  const outcome = selectedExecutorOutcomeFor(records, invocation)
  if (Option.isSome(outcome)) {
    return ExecutorOuterInvocationProjection.cases.Completed.make({
      outcome: outcome.value
    })
  }
  const retry = records.findLast(({ event }) =>
    event._tag === "TechnicalRetryScheduled"
    && event.scope.operationId
      === invocation.correlation.invocationId
    && !records.some(({ event: candidate }) =>
      candidate._tag === "TechnicalRetryDeferralSuperseded"
      && candidate.scope.operationId === event.scope.operationId
      && candidate.retryOrdinal === event.retryOrdinal
    )
  )?.event
  if (
    retry?._tag === "TechnicalRetryScheduled"
    && now < retry.notBefore
  ) {
    return ExecutorOuterInvocationProjection.cases.Waiting.make({
      wait: ExecutorOuterInvocationWait.cases.RetryScheduled.make({
        correlation: invocation.correlation,
        notBefore: retry.notBefore
      })
    })
  }
  return ExecutorOuterInvocationProjection.cases.Ready.make({})
}
