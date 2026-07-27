import { Effect, Match, Queue } from "effect"
import { ActivationCause, makeActivationCoordinator } from "./activation-coordinator.js"
import type { RunId, TaskWorkCapacity } from "./domain.js"
import { JournalStore } from "./journal-store.js"
import { reduceManagedHistory } from "./managed-history.js"
import { deriveRunnableFrontier, ResponsibilityDisposition } from "./runnable-frontier.js"
import { recoverRunnableTransition } from "./runnable-transition-recovery.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"

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
)(function*(runId: RunId, capacity: TaskWorkCapacity) {
  const initial = yield* readRecoveredFrontier(runId)
  const reconstructedReservedPositions = initial.transitions.flatMap(
    (transition) =>
      "operationId" in transition
        && (
          transition._tag === "ContinueTaskExecution"
          || transition._tag === "ContinueImplementationReview"
          || transition._tag === "ContinueReviewFindingsHandback"
        )
        ? [{ operationId: transition.operationId, taskId: transition.taskId }]
        : []
  )
  const admissionController = yield* makeTaskAdmissionController({
    capacity,
    freshOccupiedInvocations: [],
    reconstructedReservedPositions
  })
  const completed = yield* Queue.unbounded<void>()

  yield* Effect.scoped(Effect.gen(function*() {
    const coordinator = yield* makeActivationCoordinator({
      admissionController,
      readFrontier: readRecoveredFrontier(runId),
      runId,
      runTransition: (transition) =>
        recoverRunnableTransition(runId, transition).pipe(
          Effect.ensuring(Queue.offer(completed, undefined))
        )
    })

    for (;;) {
      yield* coordinator.signal(ActivationCause.Restart())
      if ((yield* readRecoveredFrontier(runId)).transitions.length === 0) {
        return
      }
      yield* Queue.take(completed)
    }
  }))
})
