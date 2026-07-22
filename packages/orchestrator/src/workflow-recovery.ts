import { Effect } from "effect"
import type { RunId } from "./domain.js"
import { JournalStore } from "./journal-store.js"
import { TaskExecutionOutcomeObserved } from "./task-execution-trace.js"
import {
  TaskClaimAcquiredTrace,
  TaskWorkSessionEstablishedTrace,
  TaskWorktreeReadyTrace,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

/** Reconciles exact claim intents that lack a durable authoritative outcome. */
export const recoverTaskClaimAcquisitions = Effect.fn(
  "WorkflowRecovery.recoverTaskClaimAcquisitions"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const acquired = new Set(
    records.flatMap(({ event }) => event._tag === "TaskClaimAcquired" ? [event.claim.operationId] : [])
  )
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "TaskClaimAcquisitionIntended"
      && !acquired.has(event.operation.acquisition.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.acquireTaskClaim(operation).pipe(
      Effect.tap((result) =>
        result._tag === "AuthoritativeTaskClaimAcquired"
          ? trace.emit(TaskClaimAcquiredTrace.make({ claim: result.claim, operation }))
          : Effect.void
      )
    ))
})

/** Reconciles exact Git intents that lack a durable Base/HEAD proof. */
export const recoverTaskWorktreeReconciliations = Effect.fn(
  "WorkflowRecovery.recoverTaskWorktreeReconciliations"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const ready = new Set(records.flatMap(({ event }) => event._tag === "TaskWorktreeReady" ? [event.operationId] : []))
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "TaskWorktreeReconciliationIntended"
      && !ready.has(event.operation.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.reconcileTaskWorktree(operation).pipe(
      Effect.tap((result) =>
        result._tag === "AuthoritativeTaskWorktreeReady"
          ? trace.emit(TaskWorktreeReadyTrace.make({ operation, proof: result.proof }))
          : Effect.void
      )
    ))
})

/** Reconstructs unresolved session-establishment operations from ordered history. */
export const recoverTaskWorkSessionEstablishments = Effect.fn(
  "WorkflowRecovery.recoverTaskWorkSessionEstablishments"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  const established = new Set(
    records.flatMap(({ event }) => event._tag === "TaskWorkSessionEstablished" ? [event.outcome.operationId] : [])
  )
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
      && !established.has(event.operation.request.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(unresolved, (operation) =>
    interpreter.establishTaskWorkSession(operation).pipe(
      Effect.tap((outcome) => trace.emit(TaskWorkSessionEstablishedTrace.make({ operation, outcome })))
    ))
})

/** Observes unresolved exact execution intents before any later retry policy exists. */
export const recoverTaskExecutions = Effect.fn("WorkflowRecovery.recoverTaskExecutions")(
  function*(runId: RunId) {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* JournalStore
    const trace = yield* WorkflowTrace
    const records = yield* journal.read(runId)
    const observed = new Set(records.flatMap(({ event }) =>
      event._tag === "TaskExecutionOutcomeObserved"
        ? [event.outcome.outcome.operationId]
        : []
    ))
    const unresolved = records.flatMap(({ event }) =>
      event._tag === "TaskExecutionIntentRecorded"
        && !observed.has(event.operation.request.operationId)
        ? [event.operation]
        : []
    )
    return yield* Effect.forEach(unresolved, (operation) =>
      interpreter.executeTaskWork(operation).pipe(
        Effect.tap((outcome) => trace.emit(TaskExecutionOutcomeObserved.make({ operation, outcome })))
      ))
  }
)
