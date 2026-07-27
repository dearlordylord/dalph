import { Effect, Ref } from "effect"
import { OperationId, type RunId, SemanticReviewRound } from "./domain.js"
import { makeFreshImplementationConvergenceStage } from "./fresh-implementation-convergence-stages.js"
import { claimForPlannedAttempt } from "./implementation-convergence-history.js"
import type { FreshImplementationConvergenceStage } from "./implementation-convergence-stage.js"
import { defaultImplementationReviewRoundLimit } from "./implementation-convergence.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import { JournalStore } from "./journal-store.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

const sameAttemptId = (
  left: { readonly attemptId: string },
  right: { readonly attemptId: string }
): boolean => left.attemptId === right.attemptId

/** Derives process-local continuation stages from the last exact durable fact. */
export const makeRecoveredImplementationConvergenceStages = Effect.fn(
  "WorkflowRecovery.makeRecoveredImplementationConvergenceStages"
)(function*(runId: RunId, includeAlreadyIntended = true) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const stages = new Array<FreshImplementationConvergenceStage>()
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
    const latestExecution = resourceEmergency ?? executions[executions.length - 1]
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
    const unresolvedEvidence = records.findLast(({ event }) =>
      event._tag === "ImplementationEvidenceSealingIntended"
      && event.operation.execution._tag === "SuccessfulExecution"
      && sameAttemptId(
        event.operation.plannedAttempt,
        plannedAttempt
      )
      && !records.some(({ event: candidate }) =>
        candidate._tag === "ImplementationEvidenceSealed"
        && candidate.operationId === event.operation.operationId
      )
    )?.event

    if (
      !includeAlreadyIntended
      && (
        unresolvedEvidence?._tag === "ImplementationEvidenceSealingIntended"
        || unresolvedReview?._tag === "ImplementationReviewIntended"
        || unresolvedHandback?._tag === "ReviewFindingsHandbackIntended"
      )
    ) continue

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
    const subject = {
      claim,
      plannedAttempt,
      sessionEstablishmentOperationId: sessionIntent.operation.request.operationId,
      sessionId: sessionEvent.outcome.sessionId,
      worktreeOperationId: worktreeEvent.operationId,
      worktreeProof: worktreeEvent.proof
    } as const
    const task = latestExecution.operation.request.task

    if (
      completedHandback !== undefined
      && latestExecution.position < Number(completedHandback.record.position)
    ) {
      if (latestReview === undefined) {
        return yield* Effect.die(
          new Error("completed findings handback requires its durable review")
        )
      }
      // eslint-disable-next-line functional/immutable-data -- This local collector materializes one derived stage per durable attempt.
      stages.push(
        yield* makeFreshImplementationConvergenceStage({
          allocator,
          emit: trace.emit,
          interpreter,
          roundLimit: latestReview.review.manifest.roundLimit,
          start: {
            _tag: "HandbackCompleted",
            operationId: completedHandback.intent.operation.request.operationId,
            previousReview: latestReview.review,
            round: latestReview.review.manifest.round
          },
          subject,
          task
        }, latestExecution.outcome)
      )
      continue
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
    const round = SemanticReviewRound.make(
      unresolvedReview?._tag === "ImplementationReviewIntended"
        && unresolvedReview.operation.request._tag === "AuthorizedImplementationReview"
        ? Number(unresolvedReview.operation.request.round)
        : pendingReview === undefined
        ? Number(priorReview?.manifest.round ?? 0) + 1
        : Number(pendingReview.manifest.round)
    )
    const start = pendingReview !== undefined
      ? {
        _tag: "ReviewCompleted" as const,
        ...(unresolvedHandback?._tag === "ReviewFindingsHandbackIntended"
          ? { handbackOperation: unresolvedHandback.operation }
          : {}),
        review: pendingReview,
        round
      }
      : unresolvedReview?._tag === "ImplementationReviewIntended"
          && unresolvedReview.operation.request._tag === "AuthorizedImplementationReview"
      ? {
        _tag: "ReviewIntended" as const,
        operation: unresolvedReview.operation,
        ...(priorReview === undefined ? {} : { previousReview: priorReview }),
        round
      }
      : evidence?._tag === "ImplementationEvidenceSealed"
      ? {
        _tag: "EvidenceSealed" as const,
        evidence: {
          operationId: evidence.operationId,
          sealed: evidence.sealed
        },
        ...(priorReview === undefined ? {} : { previousReview: priorReview }),
        round
      }
      : {
        _tag: "ExecutionOutcome" as const,
        ...(priorReview === undefined ? {} : { previousReview: priorReview }),
        round
      }

    // eslint-disable-next-line functional/immutable-data -- This local collector materializes one derived stage per durable attempt.
    stages.push(
      yield* makeFreshImplementationConvergenceStage({
        allocator,
        emit: trace.emit,
        interpreter,
        roundLimit,
        start,
        subject,
        task: currentExecution.operation.request.task
      }, currentExecution.outcome)
    )
  }
  return stages
})
