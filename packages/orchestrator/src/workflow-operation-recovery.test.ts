import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { JournalPosition, JournalRecordKey, OperationId, RunId } from "./domain.js"
import { JournalStore } from "./journal-store.js"
import {
  recoverImplementationEvidenceSealings,
  recoverImplementationReviews,
  recoverReviewFindingsHandbacks,
  recoverTaskClaimAcquisitions,
  recoverTaskExecutions,
  recoverTaskWorkSessionEstablishments,
  recoverTaskWorktreeReconciliations,
  recoverTrackerGraphObservations
} from "./workflow-operation-recovery.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

const runId = RunId.make("operation-recovery-routing")
const exactOperationId = OperationId.make("operation-recovery-exact")
const otherOperationId = OperationId.make("operation-recovery-other")
const completedOperationId = OperationId.make("operation-recovery-completed")

const operation = (operationId: OperationId) => ({
  acquisition: {
    operationId,
    owner: "operation-recovery-owner",
    taskId: "operation-recovery-task",
    token: "operation-recovery-token"
  },
  operationId,
  request: {
    operationId,
    plannedAttempt: {},
    session: { sessionId: "operation-recovery-session" }
  }
})

const events = [
  ...[exactOperationId, otherOperationId, completedOperationId].flatMap(
    (operationId) => [
      {
        _tag: "TrackerGraphObservationIntentRecorded",
        operation: operation(operationId)
      },
      {
        _tag: "TaskClaimAcquisitionIntended",
        operation: operation(operationId)
      },
      {
        _tag: "TaskWorktreeReconciliationIntended",
        operation: operation(operationId)
      },
      {
        _tag: "TaskWorkSessionEstablishmentIntentRecorded",
        operation: operation(operationId)
      },
      {
        _tag: "TaskExecutionIntentRecorded",
        operation: operation(operationId)
      },
      {
        _tag: "ImplementationReviewIntended",
        operation: operation(operationId)
      },
      {
        _tag: "ReviewFindingsHandbackIntended",
        operation: operation(operationId)
      },
      {
        _tag: "ImplementationEvidenceSealingIntended",
        operation: operation(operationId)
      }
    ]
  ),
  {
    _tag: "TrackerGraphOutcomeObserved",
    operationId: completedOperationId
  },
  {
    _tag: "TaskClaimAcquired",
    claim: { operationId: completedOperationId }
  },
  {
    _tag: "TaskWorktreeReady",
    operationId: completedOperationId
  },
  {
    _tag: "TaskWorkSessionEstablished",
    outcome: { operationId: completedOperationId }
  },
  {
    _tag: "TaskExecutionOutcomeObserved",
    outcome: { outcome: { operationId: completedOperationId } }
  },
  {
    _tag: "ImplementationReviewCompleted",
    review: { manifest: { operationId: completedOperationId } }
  },
  {
    _tag: "ReviewFindingsHandbackCompleted",
    acknowledgement: { operationId: completedOperationId }
  },
  {
    _tag: "ImplementationEvidenceSealed",
    operationId: completedOperationId
  }
].map((event, index) => ({
  event,
  key: JournalRecordKey.make(`operation-recovery:${index}`),
  position: JournalPosition.make(index + 1),
  runId
}))

it.effect("filters every recovery protocol by exact unresolved operation identity", () =>
  Effect.gen(function*() {
    const invoked = yield* Ref.make<ReadonlyArray<string>>([])
    const recordInvocation = (tag: string, result: unknown) =>
      Ref.update(invoked, (current) => [...current, tag]).pipe(
        Effect.as(result)
      )
    const failAfterInvocation = (tag: string) =>
      Ref.update(invoked, (current) => [...current, tag]).pipe(
        Effect.andThen(Effect.fail(`controlled ${tag} failure`))
      )
    const interpreter: Parameters<typeof WorkflowInterpreter.of>[0] = WorkflowInterpreter.of(
      {
        acquireTaskClaim: () =>
          recordInvocation("claim", {
            _tag: "TaskClaimConflict"
          }),
        establishTaskWorkSession: () => failAfterInvocation("session"),
        executeTaskWork: () => failAfterInvocation("execution"),
        handBackReviewFindings: () => failAfterInvocation("handback"),
        readTrackerGraph: () => failAfterInvocation("tracker"),
        reconcileTaskWorktree: () =>
          recordInvocation("worktree", {
            _tag: "TaskWorktreeMismatch"
          }),
        recordImplementationDisposition: () => Effect.die("unused disposition"),
        recordTaskAttemptPlan: () => Effect.die("unused planning"),
        reviewImplementation: () =>
          recordInvocation("review", {
            _tag: "ImplementationReviewInvocationFailed"
          }),
        sealImplementationEvidence: () =>
          recordInvocation("evidence", {
            _tag: "ImplementationEvidenceSealingFailed"
          }),
        simulateTaskExecution: () => Effect.die("unused simulation"),
        simulateTaskWorkSession: () => Effect.die("unused simulation")
      } as never
    )
    const journal = JournalStore.of({
      append: () => Effect.die("recovery reads history only"),
      read: () => Effect.succeed(events as never),
      scan: () => Effect.die("recovery reads one run only")
    })

    yield* Effect.all([
      Effect.result(
        recoverTrackerGraphObservations(runId, exactOperationId)
      ),
      Effect.result(recoverTaskClaimAcquisitions(runId, exactOperationId)),
      Effect.result(
        recoverTaskWorktreeReconciliations(runId, exactOperationId)
      ),
      Effect.result(
        recoverTaskWorkSessionEstablishments(runId, exactOperationId)
      ),
      Effect.result(recoverTaskExecutions(runId, exactOperationId)),
      Effect.result(recoverImplementationReviews(runId, exactOperationId)),
      Effect.result(recoverReviewFindingsHandbacks(runId, exactOperationId)),
      Effect.result(
        recoverImplementationEvidenceSealings(runId, exactOperationId)
      )
    ], { concurrency: 1 }).pipe(
      Effect.provideService(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.die("controlled results do not emit") })
      ),
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(JournalStore, journal)
    )

    expect(yield* Ref.get(invoked)).toEqual([
      "tracker",
      "claim",
      "worktree",
      "session",
      "execution",
      "review",
      "handback",
      "evidence"
    ])
  }))
