import { Effect, Ref } from "effect"
import { OperationId, type RunId } from "./domain.js"
import { claimForPlannedAttempt } from "./implementation-convergence-history.js"
import { runLiveImplementationConvergence } from "./implementation-convergence-workflow.js"
import { defaultImplementationReviewRoundLimit } from "./implementation-convergence.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import { JournalStore } from "./journal-store.js"
import { TaskExecutionAdmitted, TaskExecutionOutcomeObserved } from "./task-execution-trace.js"
import { TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { OperationSelected } from "./tracker-workflow-trace.js"
import { makeTaskExecutionOperation } from "./workflow-operation.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

const sameAttemptId = (
  left: { readonly attemptId: string },
  right: { readonly attemptId: string }
): boolean => left.attemptId === right.attemptId

/** Continues every non-terminal implementation attempt from its last exact durable stage. */
export const recoverImplementationConvergences = Effect.fn(
  "WorkflowRecovery.recoverImplementationConvergences"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const initialRecords = yield* journal.read(runId)
  const attempts = initialRecords.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []
  )

  for (const plannedAttempt of attempts) {
    const records = yield* journal.read(runId)
    const alreadyTerminal = records.some(({ event }) =>
      event._tag === "ImplementationConvergenceDispositionRecorded"
      && event.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
      && sameAttemptId(event.operation.request.disposition.subject.plannedAttempt, plannedAttempt)
    )
    if (alreadyTerminal) continue

    const sessionIntent = records.find(({ event }) =>
      event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
      && sameAttemptId(event.operation.request.plannedAttempt, plannedAttempt)
    )?.event
    if (sessionIntent?._tag !== "TaskWorkSessionEstablishmentIntentRecorded") continue
    const sessionEvent = records.find(({ event }) =>
      event._tag === "TaskWorkSessionEstablished"
      && event.outcome.operationId === sessionIntent.operation.request.operationId
    )?.event
    if (sessionEvent?._tag !== "TaskWorkSessionEstablished") continue
    const claim = claimForPlannedAttempt(records, plannedAttempt)
    if (claim === undefined) continue
    const worktreeEvent = records.find(({ event }) =>
      event._tag === "TaskWorktreeReady"
      && records.some(({ event: candidate }) =>
        candidate._tag === "TaskWorktreeReconciliationIntended"
        && candidate.operation.operationId === event.operationId
        && sameAttemptId(candidate.operation.plannedAttempt, plannedAttempt)
      )
    )?.event
    if (worktreeEvent?._tag !== "TaskWorktreeReady") continue

    const executionIntents = records.flatMap((record) =>
      record.event._tag === "TaskExecutionIntentRecorded"
        && sameAttemptId(record.event.operation.request.plannedAttempt, plannedAttempt)
        ? [{ operation: record.event.operation, position: record.position }]
        : []
    )
    const executions = executionIntents.flatMap(({ operation }) => {
      const outcomeRecord = records.find(({ event }) =>
        event._tag === "TaskExecutionOutcomeObserved"
        && event.outcome.outcome.operationId === operation.request.operationId
      )
      return outcomeRecord?.event._tag === "TaskExecutionOutcomeObserved"
        ? [{ operation, outcome: outcomeRecord.event.outcome.outcome, position: Number(outcomeRecord.position) }]
        : []
    })
    const resourceEmergency = executions.find(({ outcome }) => outcome._tag === "ResourceEmergency")
    const hasPostEmergencyExecutionIntent = resourceEmergency !== undefined
      && executionIntents.some(({ position }) => Number(position) > resourceEmergency.position)
    if (hasPostEmergencyExecutionIntent) continue
    let latestExecution = resourceEmergency ?? executions[executions.length - 1]
    if (latestExecution === undefined) continue

    const reviews = records.flatMap((record) =>
      record.event._tag === "ImplementationReviewCompleted"
        && sameAttemptId(record.event.review.manifest.plannedAttempt, plannedAttempt)
        ? [{ position: Number(record.position), review: record.event.review }]
        : []
    )
    const latestReview = reviews[reviews.length - 1]
    const unresolvedReview = records.findLast(({ event }) =>
      event._tag === "ImplementationReviewIntended"
      && event.operation.request._tag === "AuthorizedImplementationReview"
      && sameAttemptId(event.operation.request.plannedAttempt, plannedAttempt)
      && !records.some(({ event: candidate }) =>
        candidate._tag === "ImplementationReviewCompleted"
        && candidate.review.manifest.operationId === event.operation.request.operationId
      )
    )?.event
    const unresolvedHandback = records.findLast(({ event }) =>
      event._tag === "ReviewFindingsHandbackIntended"
      && sameAttemptId(event.operation.request.plannedAttempt, plannedAttempt)
      && !records.some(({ event: candidate }) =>
        candidate._tag === "ReviewFindingsHandbackCompleted"
        && candidate.acknowledgement.operationId === event.operation.request.operationId
      )
    )?.event

    const completedHandback = latestReview === undefined
      ? undefined
      : records.flatMap((record) => {
        if (record.event._tag !== "ReviewFindingsHandbackCompleted") return []
        const acknowledgement = record.event.acknowledgement
        const intent = records.find(({ event }) =>
          event._tag === "ReviewFindingsHandbackIntended"
          && event.operation.request.operationId === acknowledgement.operationId
          && event.operation.request.reviewOperationId === latestReview.review.manifest.operationId
        )?.event
        return intent?._tag === "ReviewFindingsHandbackIntended"
          ? [{ intent, record }]
          : []
      }).toReversed()[0]

    const usedOperationIds = yield* Ref.make(
      new Set(
        records.map(({ event }) => {
          const descriptor = describeJournalEvent(event)
          return descriptor._tag === "OperationEventDescriptor" ? descriptor.operationId : undefined
        }).filter((id): id is OperationId => id !== undefined)
      )
    )
    const nextOrdinal = yield* Ref.make(0)
    const allocator = {
      allocate: Effect.fn("WorkflowRecovery.allocateOperationId")(function*() {
        for (;;) {
          const ordinal = yield* Ref.getAndUpdate(nextOrdinal, (value) => value + 1)
          const candidate = OperationId.make(
            `recovery:${runId}:${plannedAttempt.attemptId}:${records.length}:${ordinal}`
          )
          const accepted = yield* Ref.modify(usedOperationIds, (current) =>
            current.has(candidate)
              ? [false, current] as const
              : [true, new Set([...current, candidate])] as const)
          if (accepted) return candidate
        }
      })
    }

    if (
      completedHandback !== undefined
      && latestExecution.position < Number(completedHandback.record.position)
    ) {
      const executionOperation = makeTaskExecutionOperation({
        predecessorOperationIds: [
          completedHandback.intent.operation.request.operationId,
          sessionIntent.operation.request.operationId
        ],
        request: TaskExecutionRequest.make({
          operationId: yield* allocator.allocate(),
          plannedAttempt,
          session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
            sessionId: sessionEvent.outcome.sessionId
          }),
          task: latestExecution.operation.request.task
        })
      })
      yield* trace.emit(OperationSelected.make({ operation: executionOperation }))
      yield* trace.emit(TaskExecutionAdmitted.make({ operation: executionOperation }))
      const result = yield* interpreter.executeTaskWork(executionOperation)
      yield* trace.emit(TaskExecutionOutcomeObserved.make({ operation: executionOperation, outcome: result }))
      latestExecution = { operation: executionOperation, outcome: result.outcome, position: Number.MAX_SAFE_INTEGER }
    }

    const currentExecution = latestExecution
    const evidence = records.findLast(({ event }) =>
      event._tag === "ImplementationEvidenceSealed"
      && records.some(({ event: candidate }) =>
        candidate._tag === "ImplementationEvidenceSealingIntended"
        && candidate.operation.operationId === event.operationId
        && candidate.operation.execution._tag === "SuccessfulExecution"
        && candidate.operation.execution.outcome.operationId === currentExecution.outcome.operationId
      )
    )?.event
    const priorReview = latestReview !== undefined && latestReview.position < currentExecution.position
      ? latestReview.review
      : undefined
    const pendingReview = latestReview !== undefined && latestReview.position > currentExecution.position
      ? latestReview.review
      : undefined
    const roundLimit = unresolvedReview?._tag === "ImplementationReviewIntended"
        && unresolvedReview.operation.request._tag === "AuthorizedImplementationReview"
      ? unresolvedReview.operation.request.roundLimit
      : pendingReview?.manifest.roundLimit ?? priorReview?.manifest.roundLimit ?? defaultImplementationReviewRoundLimit
    const initialRound = unresolvedReview?._tag === "ImplementationReviewIntended"
        && unresolvedReview.operation.request._tag === "AuthorizedImplementationReview"
      ? Number(unresolvedReview.operation.request.round)
      : pendingReview === undefined
      ? Number(priorReview?.manifest.round ?? 0) + 1
      : Number(pendingReview.manifest.round)

    yield* runLiveImplementationConvergence({
      allocator,
      emit: trace.emit,
      initialExecutionOutcome: currentExecution.outcome,
      ...(unresolvedHandback?._tag === "ReviewFindingsHandbackIntended"
        ? { initialHandbackOperation: unresolvedHandback.operation }
        : {}),
      ...(priorReview === undefined ? {} : { initialPreviousReview: priorReview }),
      ...(pendingReview === undefined ? {} : { initialReview: pendingReview }),
      ...(unresolvedReview?._tag === "ImplementationReviewIntended"
          && unresolvedReview.operation.request._tag === "AuthorizedImplementationReview"
        ? { initialReviewOperation: unresolvedReview.operation }
        : {}),
      ...(evidence?._tag === "ImplementationEvidenceSealed"
        ? { initialSealedEvidence: { operationId: evidence.operationId, sealed: evidence.sealed } }
        : {}),
      initialRound,
      interpreter,
      roundLimit,
      subject: {
        claim,
        plannedAttempt,
        sessionEstablishmentOperationId: sessionIntent.operation.request.operationId,
        sessionId: sessionEvent.outcome.sessionId,
        worktreeOperationId: worktreeEvent.operationId,
        worktreeProof: worktreeEvent.proof
      },
      task: currentExecution.operation.request.task
    })
  }
})
