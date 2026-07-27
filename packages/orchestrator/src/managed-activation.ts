import { Effect, Exit, Match, Queue, Ref } from "effect"
import { ActivationCause, makeActivationCoordinator } from "./activation-coordinator.js"
import type { OperationId, ProviderObservationId, RunId, TaskId, TaskWorkCapacity } from "./domain.js"
import { makeRecoveredImplementationConvergenceStages } from "./implementation-convergence-recovery.js"
import type { FreshImplementationConvergenceStage } from "./implementation-convergence-stage.js"
import { JournalStore } from "./journal-store.js"
import { reduceManagedHistory } from "./managed-history.js"
import { deriveRunnableFrontier, ResponsibilityDisposition } from "./runnable-frontier.js"
import { recoverRunnableTransition } from "./runnable-transition-recovery.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { TaskExecutor } from "./task-execution.js"

export interface RecoveredAdmissionCapacityEvidence {
  readonly freshOccupiedInvocations: ReadonlyArray<{
    readonly observationId: ProviderObservationId
    readonly operationId: OperationId
    readonly taskId: TaskId
  }>
  readonly freshlyReleasedOperationIds: ReadonlySet<OperationId>
}

const noRecoveredAdmissionCapacityEvidence = {
  freshOccupiedInvocations: [],
  freshlyReleasedOperationIds: new Set()
} satisfies RecoveredAdmissionCapacityEvidence

/**
 * Reads current execution-provider evidence for each unresolved execution.
 * A proved absence can free its retained position; unreadable or ambiguous
 * evidence fails closed through the provider's typed error/result.
 */
export const observeRecoveredAdmissionCapacity = Effect.fn(
  "ManagedActivation.observeRecoveredAdmissionCapacity"
)(function*(runId: RunId) {
  const journal = yield* JournalStore
  const executor = yield* TaskExecutor
  const reduction = reduceManagedHistory(runId, yield* journal.read(runId))
  if (reduction._tag === "InvalidManagedHistory") {
    return yield* Effect.die(reduction)
  }
  const records = reduction.managedRun.workflowHistory.records
  const observations = yield* Effect.forEach(
    reduction.managedRun.responsibility.entries,
    (responsibility) => {
      if (
        responsibility._tag !== "TaskExecutionResponsibility"
        || responsibility.operation.request.session._tag !== "EstablishedSession"
        || records.some(({ event }) =>
          event._tag === "TaskExecutionOutcomeObserved"
          && event.outcome.outcome.operationId
            === responsibility.operation.request.operationId
        )
      ) return Effect.succeed(undefined)
      return executor.observeTaskExecution({
        operationId: responsibility.operation.request.operationId,
        plannedAttempt: responsibility.operation.request.plannedAttempt,
        sessionId: responsibility.operation.request.session.sessionId
      }).pipe(
        Effect.map((report) => ({ report, responsibility }))
      )
    },
    { concurrency: "unbounded" }
  )
  return {
    freshOccupiedInvocations: observations.flatMap((observation) =>
      observation?.report._tag === "RunningTaskExecutionReported"
        ? [{
          observationId: observation.report.observationId,
          operationId: observation.responsibility.operation.request.operationId,
          taskId: observation.responsibility.taskId
        }]
        : []
    ),
    freshlyReleasedOperationIds: new Set(
      observations.flatMap((observation) =>
        observation?.report._tag === "NoTaskExecutionReported"
          ? [observation.responsibility.operation.request.operationId]
          : []
      )
    )
  } satisfies RecoveredAdmissionCapacityEvidence
})

const readRecoveredFrontier = Effect.fn("ManagedActivation.readRecoveredFrontier")(
  function*(runId: RunId) {
    const journal = yield* JournalStore
    const reduction = reduceManagedHistory(runId, yield* journal.read(runId))
    if (reduction._tag === "InvalidManagedHistory") {
      return yield* Effect.die(reduction)
    }
    const records = reduction.managedRun.workflowHistory.records
    const isUnresolved = (
      responsibility: typeof reduction.managedRun.responsibility.entries[number]
    ): boolean =>
      Match.value(responsibility).pipe(
        Match.tags({
          ImplementationEvidenceResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "ImplementationEvidenceSealed"
              && event.operationId === operation.operationId
            ),
          ImplementationReviewResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "ImplementationReviewCompleted"
              && event.review.manifest.operationId
                === operation.request.operationId
            ),
          ReviewFindingsHandbackResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "ReviewFindingsHandbackCompleted"
              && event.acknowledgement.operationId
                === operation.request.operationId
            ),
          TaskClaimResponsibility: ({ acquisition }) =>
            !records.some(({ event }) =>
              event._tag === "TaskClaimAcquired"
              && event.claim.operationId === acquisition.operationId
            ),
          TaskExecutionResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "TaskExecutionOutcomeObserved"
              && event.outcome.outcome.operationId
                === operation.request.operationId
            ),
          TaskWorkSessionResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "TaskWorkSessionEstablished"
              && event.outcome.operationId === operation.request.operationId
            ),
          TaskWorktreeResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "TaskWorktreeReady"
              && event.operationId === operation.operationId
            )
        }),
        Match.exhaustive
      )
    return deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: reduction.managedRun.responsibility,
      responsibilityFacts: reduction.managedRun.responsibility.entries.map(
        (responsibility) => ({
          disposition: isUnresolved(responsibility)
            ? ResponsibilityDisposition.Ready()
            : ResponsibilityDisposition.Settled({
              outcome: "ResponsibilityCompleted"
            }),
          responsibility
        })
      )
    })
  }
)

/**
 * Routes every already-intended recovered responsibility through the same
 * serial selector/admission/ownership loop used by fresh activation.
 */
export const activateRecoveredResponsibilities = Effect.fn(
  "ManagedActivation.activateRecoveredResponsibilities"
)(function*(
  runId: RunId,
  capacity: TaskWorkCapacity,
  capacityEvidence: RecoveredAdmissionCapacityEvidence = noRecoveredAdmissionCapacityEvidence
) {
  const initial = yield* readRecoveredFrontier(runId)
  const reconstructedReservedPositions = initial.transitions.flatMap(
    (transition) =>
      "operationId" in transition
        && (
          transition._tag === "ContinueTaskExecution"
          || transition._tag === "ContinueImplementationReview"
          || transition._tag === "ContinueReviewFindingsHandback"
        )
        && !capacityEvidence.freshlyReleasedOperationIds.has(
          transition.operationId
        )
        ? [{ operationId: transition.operationId, taskId: transition.taskId }]
        : []
  )
  const admissionController = yield* makeTaskAdmissionController({
    capacity,
    freshOccupiedInvocations: capacityEvidence.freshOccupiedInvocations,
    freshlyReleasedOperationIds: capacityEvidence.freshlyReleasedOperationIds,
    reconstructedReservedPositions
  })
  const completed = yield* Queue.unbounded<Exit.Exit<void, unknown>>()

  yield* Effect.scoped(Effect.gen(function*() {
    const stages = yield* Ref.make<
      ReadonlyArray<FreshImplementationConvergenceStage>
    >(
      yield* makeRecoveredImplementationConvergenceStages(runId, false)
    )
    const refreshStages = Effect.fn("ManagedActivation.refreshStages")(
      function*() {
        const current = yield* Ref.get(stages)
        const derived = yield* makeRecoveredImplementationConvergenceStages(
          runId,
          false
        )
        const currentTaskIds = new Set(
          current.map(({ transition }) => transition.taskId)
        )
        yield* Ref.set(stages, [
          ...current,
          ...derived.filter(({ transition }) => !currentTaskIds.has(transition.taskId))
        ])
      }
    )
    const readActivationFrontier = Effect.fn(
      "ManagedActivation.readActivationFrontier"
    )(function*() {
      const recovered = yield* readRecoveredFrontier(runId)
      const currentStages = yield* Ref.get(stages)
      return {
        explanations: recovered.explanations,
        transitions: [
          ...recovered.transitions,
          ...currentStages.map(({ transition }) => transition)
        ]
      }
    })
    const coordinator = yield* makeActivationCoordinator({
      admissionController,
      readFrontier: readActivationFrontier(),
      runId,
      runTransition: (transition, execution) =>
        Effect.gen(function*() {
          const stage = (yield* Ref.get(stages)).find(
            (candidate) => candidate.transition === transition
          )
          const exit = yield* (
            stage === undefined
              ? recoverRunnableTransition(runId, transition).pipe(
                Effect.asVoid
              )
              : Effect.gen(function*() {
                if (transition._tag === "ContinueFreshWorkflowOperation") {
                  yield* execution.recordIntent(transition.operationId)
                }
                const next = yield* stage.run()
                yield* Ref.update(stages, (current) => [
                  ...current.filter((candidate) => candidate !== stage),
                  ...(next === undefined ? [] : [next])
                ])
              })
          ).pipe(Effect.exit)
          if (stage === undefined && Exit.isSuccess(exit)) {
            yield* refreshStages()
          }
          yield* Queue.offer(completed, exit)
          if (Exit.isFailure(exit)) {
            return yield* Effect.failCause(exit.cause)
          }
        })
    })

    for (;;) {
      yield* coordinator.signal(ActivationCause.Restart())
      if ((yield* readActivationFrontier()).transitions.length === 0) {
        return
      }
      const completion = yield* Queue.take(completed)
      if (Exit.isFailure(completion)) {
        return yield* Effect.failCause(completion.cause)
      }
    }
  }))
})
