import {
  AttemptBasePolicy,
  TraceAtCursor,
  taskAttemptBaseReadOperationIdFor,
  taskAttemptBaseRetryFactOperationId
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import {
  qualificationSpecificationFor,
  sourceRejected,
  strictSource,
  validateOperationId,
  validateWorkflowOperationId,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"

/** Registers Base witnesses from the owning trace view before validating proposed source atoms. */
export const qualificationContextWithBaseSelections = Effect.fn("HermeticQualification.acceptedBaseSelections")(
  function* (snapshot: TraceAtCursor, context: QualificationContext) {
    const original = yield* Schema.decodeUnknownEffect(
      TraceAtCursor,
      strictSource
    )(snapshot).pipe(Effect.mapError(sourceRejected))
    if (original.cursor.runId !== context.runId) return yield* sourceRejected()
    const retries = original.items.flatMap(({ occurrence }) =>
      occurrence._tag === "TaskAttemptBaseRetryRequested" ? [occurrence] : []
    )
    const acceptedBaseRetries = yield* Effect.forEach(retries, (retry) =>
      Effect.gen(function* () {
        if (
          retry.runId !== context.runId ||
          retry.subject.runId !== context.runId ||
          qualificationSpecificationFor(retry.subject.taskId, context) === undefined
        )
          return yield* sourceRejected()
        const refusedRead = original.items.find(
          ({ occurrence }) =>
            occurrence._tag === "TaskAttemptBaseReadInitiated" &&
            occurrence.operation.operationId === retry.subject.refusedReadOperationId
        )?.occurrence
        if (
          refusedRead?._tag !== "TaskAttemptBaseReadInitiated" ||
          refusedRead.operation.taskId !== retry.subject.taskId ||
          refusedRead.recordedAt >= retry.recordedAt ||
          !original.items.some(
            ({ occurrence }) =>
              occurrence._tag === "TaskAttemptBaseObserved" &&
              occurrence.originatingActionOperationId === retry.subject.refusedReadOperationId &&
              occurrence.observation._tag === "Refused" &&
              occurrence.recordedAt > refusedRead.recordedAt &&
              occurrence.recordedAt < retry.recordedAt
          ) ||
          original.items.some(
            ({ occurrence }) =>
              occurrence._tag === "TaskAttemptPlanned" &&
              occurrence.operation.plannedAttempt.taskId === retry.subject.taskId &&
              occurrence.recordedAt < retry.recordedAt
          )
        )
          return yield* sourceRejected()
        return {
          request: { requestId: retry.requestId, subject: retry.subject },
          claimOperationId: refusedRead.operation.claimOperationId
        }
      })
    )
    if (
      new Set(acceptedBaseRetries.map(({ request }) => request.requestId)).size !== acceptedBaseRetries.length ||
      new Set(acceptedBaseRetries.map(({ request }) => request.subject.refusedReadOperationId)).size !==
        acceptedBaseRetries.length
    )
      return yield* sourceRejected()
    const retryContext = {
      ...context,
      acceptedBaseRetries,
      derivedOperationIds: [
        ...context.derivedOperationIds,
        ...acceptedBaseRetries.flatMap(({ request }) =>
          (["Graph", "Claim", "Specification"] as const).map((family) =>
            taskAttemptBaseRetryFactOperationId(request.requestId, family)
          )
        )
      ]
    }
    const expectedPolicy = AttemptBasePolicy.cases.QualifiedCurrentIntegrationHead.make({
      executionRepository: context.configuration.repository,
      integrationTarget: { repository: context.configuration.repository, ref: context.configuration.integrationRef },
      lineageAnchor: context.configuration.plannedAttemptBaseSha
    })
    const reads = original.items.flatMap(({ occurrence }) =>
      occurrence._tag === "TaskAttemptBaseReadInitiated" ? [occurrence] : []
    )
    const qualifiedReads = yield* Effect.forEach(reads, (read) =>
      Effect.gen(function* () {
        if (read.runId !== context.runId) return yield* sourceRejected()
        const operation = read.operation
        const specification = qualificationSpecificationFor(operation.taskId, context)
        const predecessor = operation.predecessorOperationIds[0]
        if (
          specification === undefined ||
          operation.taskRevision !== specification.fingerprint ||
          predecessor === undefined ||
          operation.predecessorOperationIds.length !== 1 ||
          !Schema.toEquivalence(AttemptBasePolicy)(operation.policy, expectedPolicy) ||
          operation.operationId !== taskAttemptBaseReadOperationIdFor(operation.claimOperationId, predecessor)
        )
          return yield* sourceRejected()
        yield* validateOperationId(operation.claimOperationId)
        yield* validateWorkflowOperationId(predecessor, retryContext)
        if (
          operation.retryRequestId !== undefined &&
          !acceptedBaseRetries.some(
            ({ claimOperationId, request }) =>
              request.requestId === operation.retryRequestId &&
              request.subject.taskId === operation.taskId &&
              claimOperationId === operation.claimOperationId &&
              predecessor === taskAttemptBaseRetryFactOperationId(request.requestId, "Specification")
          )
        )
          return yield* sourceRejected()
        if (
          !original.items.some(
            ({ occurrence: prior }) =>
              prior.recordedAt < read.recordedAt &&
              prior._tag === "TaskClaimAcquired" &&
              prior.claim.operationId === operation.claimOperationId &&
              prior.claim.taskId === operation.taskId
          )
        )
          return yield* sourceRejected()
        if (
          !original.items.some(
            ({ occurrence: prior }) =>
              prior.recordedAt < read.recordedAt &&
              prior._tag === "TaskTrackerFactsObserved" &&
              prior.originatingActionOperationId === predecessor &&
              prior.evidence._tag === "FocusedTaskWorkSpecificationFacts" &&
              prior.evidence.factFamily.taskId === operation.taskId &&
              prior.evidence.factFamily.fingerprint === operation.taskRevision
          )
        )
          return yield* sourceRejected()
        return read
      })
    )
    const selections = yield* Effect.forEach(original.items, ({ occurrence }) =>
      Effect.gen(function* () {
        if (occurrence._tag !== "TaskAttemptBaseObserved") return []
        const read = qualifiedReads.find(
          (candidate) =>
            candidate.operation.operationId === occurrence.originatingActionOperationId &&
            candidate.recordedAt < occurrence.recordedAt
        )
        if (read === undefined || occurrence.runId !== context.runId) return yield* sourceRejected()
        const operation = read.operation
        if (occurrence.observation._tag !== "Qualified") return []
        const baseSha = occurrence.observation.baseSha
        if (
          original.items.some(
            ({ occurrence: planned }) =>
              planned._tag === "TaskAttemptPlanned" &&
              planned.operation.plannedAttempt.taskId === operation.taskId &&
              (planned.recordedAt <= occurrence.recordedAt ||
                planned.operation.plannedAttempt.baseSha !== baseSha ||
                !planned.operation.predecessorOperationIds.includes(operation.operationId))
          )
        )
          return yield* sourceRejected()
        return [{ taskId: operation.taskId, baseSha }]
      })
    )
    const acceptedBaseSelections = selections.flat()
    if (new Set(acceptedBaseSelections.map(({ taskId }) => taskId)).size !== acceptedBaseSelections.length)
      return yield* sourceRejected()
    return {
      ...retryContext,
      acceptedBaseSelections,
      derivedOperationIds: [...retryContext.derivedOperationIds, ...reads.map(({ operation }) => operation.operationId)]
    }
  }
)
