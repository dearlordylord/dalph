import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Fiber, Layer, Ref, Result, Schema } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  JournalPosition,
  JournalRecordKey,
  OperationId,
  ProviderObservationId,
  ReviewerSessionId,
  ReviewFindingId,
  RunId,
  SemanticReviewRound,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TechnicalRetryDelayMillis,
  TechnicalRetryLimit,
  WorkerProcessId,
  WorktreeLocator
} from "./domain.js"
import {
  ImplementationEvidenceSealedEvent,
  ImplementationEvidenceSealingIntendedEvent
} from "./implementation-evidence-journal.js"
import type { EvidenceStoreService, SealedImplementationEvidence } from "./implementation-evidence.js"
import {
  EvidenceDigest,
  EvidenceStore,
  EvidenceStoreFailure,
  ImplementationEvidenceSource,
  ImplementationReviewNotAuthorized,
  memoryEvidenceStoreLayer,
  sealImplementationEvidence
} from "./implementation-evidence.js"
import {
  ImplementationReviewCompletedEvent,
  ImplementationReviewIntendedEvent,
  ReviewFindingsHandbackCompletedEvent,
  ReviewFindingsHandbackIntendedEvent
} from "./implementation-review-journal.js"
import {
  AuthorizedImplementationReviewRequest,
  authorizeImplementationReviewEvidence,
  ImplementationReviewDisposition,
  ImplementationReviewer,
  ImplementationReviewHistoryContradiction,
  ImplementationReviewInvocationFailure,
  ImplementationReviewRequest,
  ImplementationReviewSimulated,
  implementationReviewTestLayer,
  ReviewFinding,
  ReviewFindingsHandback,
  ReviewFindingsHandbackAcknowledged,
  ReviewFindingsHandbackFailure,
  ReviewFindingsHandbackRequest,
  sealImplementationReview,
  TestImplementationReview,
  unavailableImplementationReviewLayer
} from "./implementation-review.js"
import {
  intentRecordKey,
  JournalStorageUnavailable,
  JournalStore,
  memoryJournalStoreLayer,
  outcomeRecordKey,
  TaskExecutionIntentRecorded,
  TaskExecutionOutcomeObservedEvent
} from "./journal-store.js"
import type { JournalRecord, JournalStoreService } from "./journal-store.js"
import {
  makeJournaledImplementationReview,
  makeJournaledReviewFindingsHandback
} from "./journaled-implementation-review.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionOutcome, TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { TechnicalRetryPolicy } from "./technical-retry.js"
import {
  makeImplementationEvidenceSealingOperation,
  makeImplementationReviewOperation,
  makeReviewFindingsHandbackOperation,
  makeTaskExecutionOperation,
  WorkflowOperation,
  workflowOperationId
} from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"
import { recoverImplementationReviews, recoverReviewFindingsHandbacks } from "./workflow-recovery.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

const runId = RunId.make("review-run")
const sessionId = TaskWorkSessionId.make("implementer-session")
const taskId = TaskId.make("review-task")
const task = {
  id: taskId,
  lifecycle: { _tag: "Open" as const },
  parentTaskId: null,
  prerequisiteIds: []
}
const plan = {
  attemptId: AttemptId.make("review-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/review-attempt"),
  executor: TaskExecutorLocator.make("executor:review"),
  runId,
  session: TaskWorkSessionLocator.make("session:review"),
  taskId,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/review-attempt")
}
const finding = ReviewFinding.make({
  findingId: ReviewFindingId.make("finding-1"),
  text: "preserve the exact reviewer handback"
})

const appendExecutionAndEvidence = Effect.fn("ReviewTest.appendExecutionAndEvidence")(function*(
  ordinal: number
) {
  const journal = yield* JournalStore
  const store = yield* EvidenceStore
  const executionOperationId = OperationId.make(`implementer-invocation-${ordinal}`)
  const outcome = TaskExecutionOutcome.cases.Succeeded.make({
    observationId: ProviderObservationId.make(`execution-observation-${ordinal}`),
    operationId: executionOperationId,
    output: `implementation output ${ordinal}`,
    processId: WorkerProcessId.make(ordinal),
    sessionId
  })
  const executionOperation = makeTaskExecutionOperation({
    predecessorOperationIds: [],
    request: TaskExecutionRequest.make({
      operationId: executionOperationId,
      plannedAttempt: plan,
      session: TaskExecutionSessionBinding.cases.EstablishedSession.make({ sessionId }),
      task
    })
  })
  yield* journal.append(
    runId,
    intentRecordKey(executionOperationId),
    TaskExecutionIntentRecorded.make({ operation: executionOperation, version: 2 })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(executionOperationId),
    TaskExecutionOutcomeObservedEvent.make({
      outcome: WorkflowOutcome.cases.TaskExecutionObserved.make({ outcome }),
      version: 2
    })
  )
  const evidenceOperation = makeImplementationEvidenceSealingOperation({
    execution: { _tag: "SuccessfulExecution", outcome },
    operationId: OperationId.make(`evidence-sealing-${ordinal}`),
    plannedAttempt: plan
  })
  yield* journal.append(
    runId,
    intentRecordKey(evidenceOperation.operationId),
    ImplementationEvidenceSealingIntendedEvent.make({ operation: evidenceOperation, version: 2 })
  )
  const sealed = yield* sealImplementationEvidence(
    evidenceOperation.operationId,
    plan,
    executionOperationId,
    outcome
  ).pipe(
    Effect.provideService(EvidenceStore, store),
    Effect.provideService(ImplementationEvidenceSource, {
      readDiff: () => Effect.succeed(new TextEncoder().encode(`diff ${ordinal}`))
    })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(evidenceOperation.operationId),
    ImplementationEvidenceSealedEvent.make({
      operationId: evidenceOperation.operationId,
      sealed,
      version: 2
    })
  )
  return { evidenceOperation, executionOperationId, sealed }
})

interface EvidenceFixture {
  readonly evidenceOperation: ReturnType<typeof makeImplementationEvidenceSealingOperation>
  readonly executionOperationId: OperationId
  readonly sealed: typeof SealedImplementationEvidence.Type
}

const reviewOperation = (
  evidence: EvidenceFixture,
  fields?: {
    readonly findingHistory?: ReadonlyArray<typeof finding>
    readonly predecessor?: typeof evidence.sealed.manifestReference
    readonly reviewerSessionId?: ReviewerSessionId
    readonly round?: SemanticReviewRound
  }
) =>
  makeImplementationReviewOperation(AuthorizedImplementationReviewRequest.make({
    evidenceSealingOperationId: evidence.evidenceOperation.operationId,
    findingHistory: fields?.findingHistory ?? [],
    implementationEvidence: evidence.sealed,
    implementerInvocationId: evidence.executionOperationId,
    implementerSessionId: sessionId,
    operationId: OperationId.make(`review-${fields?.round ?? 1}`),
    plannedAttempt: plan,
    predecessorEvidenceReference: fields?.predecessor ?? evidence.sealed.manifestReference,
    reviewerSessionId: fields?.reviewerSessionId ?? ReviewerSessionId.make("reviewer-session-1"),
    round: fields?.round ?? SemanticReviewRound.make(1)
  }))

const testLayer = Layer.merge(memoryJournalStoreLayer, memoryEvidenceStoreLayer).pipe(
  Layer.provide(NodeServices.layer)
)

it.effect("journals a fresh reviewer session before invocation and reuses the durable result", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const evidence = yield* appendExecutionAndEvidence(1)
    const operation = reviewOperation(evidence)
    if (operation.request._tag !== "AuthorizedImplementationReview") return yield* Effect.die("invalid fixture")
    const invocations = yield* Ref.make(0)
    const reviewer = ImplementationReviewer.of({
      createOrResume: Effect.fn("ReviewTest.invoke")(function*(request) {
        yield* Ref.update(invocations, (count) => count + 1)
        expect((yield* journal.read(runId).pipe(Effect.orDie)).at(-1)?.event._tag).toBe(
          "ImplementationReviewIntended"
        )
        expect(request.reviewerSessionId).toBe(ReviewerSessionId.make("reviewer-session-1"))
        return ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] })
      })
    })
    const protocol = makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused handback") }),
      journal,
      reviewer,
      runId
    })
    const first = yield* protocol(operation)
    const replay = yield* protocol(operation)
    expect(first).toEqual(replay)
    expect(first.manifest.findingHistory).toEqual([finding])
    expect(first.manifest.predecessorEvidenceReference).toEqual(evidence.sealed.manifestReference)
    expect(yield* Ref.get(invocations)).toBe(1)
  }).pipe(Effect.provide(testLayer)))

it.effect("retries review and findings handback failures inside distinct durable technical scopes", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const evidence = yield* appendExecutionAndEvidence(1)
    const operation = reviewOperation(evidence)
    if (operation.request._tag !== "AuthorizedImplementationReview") return yield* Effect.die("invalid fixture")
    const technicalRetryPolicy = TechnicalRetryPolicy.make({
      initialDelayMillis: TechnicalRetryDelayMillis.make(10),
      limit: TechnicalRetryLimit.make(2),
      maximumDelayMillis: TechnicalRetryDelayMillis.make(20)
    })
    const reviewCalls = yield* Ref.make(0)
    const reviewProtocol = makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused") }),
      journal,
      reviewer: ImplementationReviewer.of({
        createOrResume: (request) =>
          Ref.updateAndGet(reviewCalls, (count) => count + 1).pipe(
            Effect.flatMap((call) =>
              call === 1
                ? Effect.fail(
                  new ImplementationReviewInvocationFailure({
                    detail: "temporary reviewer failure",
                    operationId: request.operationId,
                    reviewerSessionId: request.reviewerSessionId
                  })
                )
                : Effect.succeed(ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] }))
            )
          )
      }),
      runId,
      technicalRetryPolicy
    })
    const reviewFiber = yield* reviewProtocol(operation).pipe(Effect.forkScoped)
    yield* TestClock.adjust("10 millis")
    const review = yield* Fiber.join(reviewFiber)

    const handbackCalls = yield* Ref.make(0)
    const handbackRequest = ReviewFindingsHandbackRequest.make({
      implementerInvocationId: evidence.executionOperationId,
      implementerSessionId: sessionId,
      operationId: OperationId.make("technically-retried-handback"),
      plannedAttempt: plan,
      review,
      reviewOperationId: operation.request.operationId
    })
    const handbackProtocol = makeJournaledReviewFindingsHandback({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({
        deliverOrResume: (request) =>
          Ref.updateAndGet(handbackCalls, (count) => count + 1).pipe(
            Effect.flatMap((call) =>
              call <= 2
                ? Effect.fail(
                  new ReviewFindingsHandbackFailure({
                    detail: "temporary handback failure",
                    operationId: request.operationId
                  })
                )
                : Effect.succeed(ReviewFindingsHandbackAcknowledged.make({
                  operationId: request.operationId,
                  reviewEvidenceReference: request.review.manifestReference
                }))
            )
          )
      }),
      journal,
      reviewer: ImplementationReviewer.of({ createOrResume: () => Effect.die("unused") }),
      runId,
      technicalRetryPolicy
    })
    const handbackFiber = yield* handbackProtocol(
      makeReviewFindingsHandbackOperation(handbackRequest)
    ).pipe(Effect.forkScoped)
    yield* TestClock.adjust("30 millis")
    yield* Fiber.join(handbackFiber)

    expect(yield* Ref.get(reviewCalls)).toBe(2)
    expect(yield* Ref.get(handbackCalls)).toBe(3)
    const retryEvents = (yield* journal.read(runId)).flatMap(({ event }) =>
      event._tag === "TechnicalRetryScheduled" ? [event] : []
    )
    expect(retryEvents.map(({ retryOrdinal }) => retryOrdinal)).toEqual([1, 1, 2])
    expect(retryEvents.map(({ scope }) => scope._tag)).toEqual([
      "ImplementationReviewInvocation",
      "ReviewFindingsHandbackInvocation",
      "ReviewFindingsHandbackInvocation"
    ])
    expect(retryEvents.every(({ scope }) => scope.semanticRound === SemanticReviewRound.make(1))).toBe(true)
  }).pipe(Effect.provide(testLayer)))

it.effect("rejects stale implementer invocation and cross-attempt continuation before review", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const first = yield* appendExecutionAndEvidence(1)
    yield* appendExecutionAndEvidence(2)
    const invocations = yield* Ref.make(0)
    const protocol = makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused handback") }),
      journal,
      reviewer: ImplementationReviewer.of({
        createOrResume: () =>
          Ref.update(invocations, (count) => count + 1).pipe(
            Effect.as(ImplementationReviewDisposition.cases.Accepted.make({}))
          )
      }),
      runId
    })
    const failure = yield* protocol(reviewOperation(first)).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(ImplementationReviewHistoryContradiction)
    if (!(failure instanceof ImplementationReviewHistoryContradiction)) return yield* Effect.die("unexpected failure")
    expect(failure.reason).toBe("ImplementerInvocationIsNotLatest")
    expect(yield* Ref.get(invocations)).toBe(0)
  }).pipe(Effect.provide(testLayer)))

it.effect("authorizes implementation bytes and reserves reviewer sessions before provider invocation", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const evidence = yield* appendExecutionAndEvidence(1)
    const operation = reviewOperation(evidence)
    if (operation.request._tag !== "AuthorizedImplementationReview") return yield* Effect.die("invalid fixture")
    const calls = yield* Ref.make(0)
    const reviewer = ImplementationReviewer.of({
      createOrResume: () =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.as(ImplementationReviewDisposition.cases.Accepted.make({}))
        )
    })
    const corruptStore = {
      ...store,
      read: (reference: Parameters<typeof store.read>[0]) =>
        reference.digest === evidence.sealed.manifestReference.digest
          ? Effect.succeed(Uint8Array.from([0]))
          : store.read(reference)
    }
    const corruptFailure = yield* makeJournaledImplementationReview({
      evidenceStore: corruptStore,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused") }),
      journal,
      reviewer,
      runId
    })(operation).pipe(Effect.flip)
    expect(corruptFailure).toBeInstanceOf(ImplementationReviewNotAuthorized)

    const foreignIntentOperation = makeImplementationReviewOperation(AuthorizedImplementationReviewRequest.make({
      ...operation.request,
      operationId: OperationId.make("unresolved-other-review")
    }))
    yield* journal.append(
      runId,
      intentRecordKey(foreignIntentOperation.request.operationId),
      ImplementationReviewIntendedEvent.make({ operation: foreignIntentOperation, version: 2 })
    )
    const reused = yield* makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused") }),
      journal,
      reviewer,
      runId
    })(operation).pipe(Effect.flip)
    expect(reused).toMatchObject({ reason: "ReviewerSessionReused" })
    expect(yield* Ref.get(calls)).toBe(0)
  }).pipe(Effect.provide(testLayer)))

it.effect("hands findings only to their exact implementer session", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const evidence = yield* appendExecutionAndEvidence(1)
    const operation = reviewOperation(evidence)
    const review = yield* makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused handback") }),
      journal,
      reviewer: ImplementationReviewer.of({
        createOrResume: () =>
          Effect.succeed(ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] }))
      }),
      runId
    })(operation)
    const handbacks = yield* Ref.make(0)
    const handback = ReviewFindingsHandback.of({
      deliverOrResume: (request) =>
        Ref.update(handbacks, (count) => count + 1).pipe(
          Effect.as({
            _tag: "ReviewFindingsHandbackAcknowledged" as const,
            operationId: request.operationId,
            reviewEvidenceReference: request.review.manifestReference
          })
        )
    })
    const protocol = makeJournaledReviewFindingsHandback({
      evidenceStore: store,
      handback,
      journal,
      reviewer: ImplementationReviewer.of({ createOrResume: () => Effect.die("unused review") }),
      runId
    })
    const validRequest = ReviewFindingsHandbackRequest.make({
      implementerInvocationId: evidence.executionOperationId,
      implementerSessionId: sessionId,
      operationId: OperationId.make("handback-1"),
      plannedAttempt: plan,
      review,
      reviewOperationId: operation.request.operationId
    })
    yield* protocol(makeReviewFindingsHandbackOperation(validRequest))
    yield* protocol(makeReviewFindingsHandbackOperation(validRequest))
    const invalid = makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
      ...validRequest,
      implementerSessionId: TaskWorkSessionId.make("foreign-session"),
      operationId: OperationId.make("handback-foreign")
    }))
    const failure = yield* protocol(invalid).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(ImplementationReviewHistoryContradiction)
    if (!(failure instanceof ImplementationReviewHistoryContradiction)) return yield* Effect.die("unexpected failure")
    expect(failure.reason).toBe("ImplementerSessionMismatch")
    expect(yield* Ref.get(handbacks)).toBe(1)
    const mismatchedAcknowledgementRequest = ReviewFindingsHandbackRequest.make({
      ...validRequest,
      operationId: OperationId.make("handback-mismatched-acknowledgement")
    })
    const mismatchedAcknowledgementProtocol = makeJournaledReviewFindingsHandback({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({
        deliverOrResume: (request) =>
          Effect.succeed(ReviewFindingsHandbackAcknowledged.make({
            operationId: request.operationId,
            reviewEvidenceReference: {
              byteLength: request.review.manifestReference.byteLength,
              digest: EvidenceDigest.make("f".repeat(64))
            }
          }))
      }),
      journal,
      reviewer: ImplementationReviewer.of({ createOrResume: () => Effect.die("unused review") }),
      runId
    })
    const mismatch = yield* mismatchedAcknowledgementProtocol(
      makeReviewFindingsHandbackOperation(mismatchedAcknowledgementRequest)
    ).pipe(Effect.flip)
    expect(mismatch).toMatchObject({ reason: "ReviewMismatch" })
  }).pipe(Effect.provide(testLayer)))

it.effect("replays completed review and handback after a newer implementation without provider calls", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const evidence = yield* appendExecutionAndEvidence(1)
    const operation = reviewOperation(evidence)
    const reviewCalls = yield* Ref.make(0)
    const reviewProtocol = makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused") }),
      journal,
      reviewer: ImplementationReviewer.of({
        createOrResume: () =>
          Ref.update(reviewCalls, (count) => count + 1).pipe(
            Effect.as(ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] }))
          )
      }),
      runId
    })
    const review = yield* reviewProtocol(operation)
    const handbackCalls = yield* Ref.make(0)
    const handbackRequest = ReviewFindingsHandbackRequest.make({
      implementerInvocationId: evidence.executionOperationId,
      implementerSessionId: sessionId,
      operationId: OperationId.make("completed-stale-handback"),
      plannedAttempt: plan,
      review,
      reviewOperationId: operation.request.operationId
    })
    const handbackOperation = makeReviewFindingsHandbackOperation(handbackRequest)
    const handbackProtocol = makeJournaledReviewFindingsHandback({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({
        deliverOrResume: (request) =>
          Ref.update(handbackCalls, (count) => count + 1).pipe(
            Effect.as(ReviewFindingsHandbackAcknowledged.make({
              operationId: request.operationId,
              reviewEvidenceReference: request.review.manifestReference
            }))
          )
      }),
      journal,
      reviewer: ImplementationReviewer.of({ createOrResume: () => Effect.die("unused") }),
      runId
    })
    const acknowledgement = yield* handbackProtocol(handbackOperation)
    yield* appendExecutionAndEvidence(2)

    expect(yield* reviewProtocol(operation)).toEqual(review)
    expect(yield* handbackProtocol(handbackOperation)).toEqual(acknowledgement)
    expect(yield* Ref.get(reviewCalls)).toBe(1)
    expect(yield* Ref.get(handbackCalls)).toBe(1)
  }).pipe(Effect.provide(testLayer)))

it.effect("extends the immutable chain with complete findings history and a fresh reviewer", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const firstEvidence = yield* appendExecutionAndEvidence(1)
    const firstOperation = reviewOperation(firstEvidence)
    const findingsReview = yield* makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused handback") }),
      journal,
      reviewer: ImplementationReviewer.of({
        createOrResume: () =>
          Effect.succeed(ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] }))
      }),
      runId
    })(firstOperation)
    const secondEvidence = yield* appendExecutionAndEvidence(2)
    const secondOperation = reviewOperation(secondEvidence, {
      findingHistory: findingsReview.manifest.findingHistory,
      predecessor: findingsReview.manifestReference,
      reviewerSessionId: ReviewerSessionId.make("reviewer-session-2"),
      round: SemanticReviewRound.make(2)
    })
    const secondProtocol = makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused handback") }),
      journal,
      reviewer: ImplementationReviewer.of({
        createOrResume: () => Effect.succeed(ImplementationReviewDisposition.cases.Accepted.make({}))
      }),
      runId
    })
    const accepted = yield* secondProtocol(secondOperation)
    expect(accepted.manifest.predecessorEvidenceReference).toEqual(findingsReview.manifestReference)
    expect(accepted.manifest.findingHistory).toEqual([finding])
    expect(accepted.manifest.reviewerSessionId).not.toBe(findingsReview.manifest.reviewerSessionId)
    expect(yield* secondProtocol(secondOperation)).toEqual(accepted)
  }).pipe(Effect.provide(testLayer)))

it.effect("reauthorizes every predecessor review and implementation object before a later round", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const firstEvidence = yield* appendExecutionAndEvidence(1)
    const firstOperation = reviewOperation(firstEvidence)
    const firstReview = yield* makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused") }),
      journal,
      reviewer: ImplementationReviewer.of({
        createOrResume: () =>
          Effect.succeed(ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] }))
      }),
      runId
    })(firstOperation)
    const secondEvidence = yield* appendExecutionAndEvidence(2)
    const secondOperation = reviewOperation(secondEvidence, {
      findingHistory: firstReview.manifest.findingHistory,
      predecessor: firstReview.manifestReference,
      reviewerSessionId: ReviewerSessionId.make("chain-authorization-reviewer-2"),
      round: SemanticReviewRound.make(2)
    })
    const calls = yield* Ref.make(0)
    const reviewer = ImplementationReviewer.of({
      createOrResume: () =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.as(ImplementationReviewDisposition.cases.Accepted.make({}))
        )
    })
    const storeWithPredecessorRead = (
      read: EvidenceStoreService["read"]
    ): EvidenceStoreService => ({ ...store, read })
    const missing = yield* makeJournaledImplementationReview({
      evidenceStore: storeWithPredecessorRead((reference) =>
        reference.digest === firstReview.manifestReference.digest
          ? Effect.fail(
            new EvidenceStoreFailure({ detail: "missing predecessor review", operation: "EvidenceStore.read" })
          )
          : store.read(reference)
      ),
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused") }),
      journal,
      reviewer,
      runId
    })(secondOperation).pipe(Effect.flip)
    expect(missing).toBeInstanceOf(EvidenceStoreFailure)

    const tampered = yield* makeJournaledImplementationReview({
      evidenceStore: storeWithPredecessorRead((reference) =>
        reference.digest === firstReview.manifestReference.digest
          ? Effect.succeed(Uint8Array.from([0]))
          : store.read(reference)
      ),
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused") }),
      journal,
      reviewer,
      runId
    })(secondOperation).pipe(Effect.flip)
    expect(tampered).toMatchObject({ reason: "ReviewMismatch" })
    expect(yield* Ref.get(calls)).toBe(0)
  }).pipe(Effect.provide(testLayer)))

it.effect("classifies invalid recursive review-chain edges before findings delivery", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const firstEvidence = yield* appendExecutionAndEvidence(1)
    const firstOperation = reviewOperation(firstEvidence)
    if (firstOperation.request._tag !== "AuthorizedImplementationReview") return yield* Effect.die("invalid fixture")
    const firstReview = yield* makeJournaledImplementationReview({
      evidenceStore: store,
      handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("unused") }),
      journal,
      reviewer: ImplementationReviewer.of({
        createOrResume: () =>
          Effect.succeed(ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] }))
      }),
      runId
    })(firstOperation)
    const changedReference = {
      byteLength: firstEvidence.sealed.manifestReference.byteLength,
      digest: EvidenceDigest.make("f".repeat(64))
    }
    const badRoundOneRequest = AuthorizedImplementationReviewRequest.make({
      ...firstOperation.request,
      operationId: OperationId.make("bad-round-one-chain"),
      predecessorEvidenceReference: changedReference,
      reviewerSessionId: ReviewerSessionId.make("bad-round-one-chain")
    })
    const badRoundOne = yield* sealImplementationReview(
      badRoundOneRequest,
      ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] })
    ).pipe(Effect.provideService(EvidenceStore, store))
    const secondEvidence = yield* appendExecutionAndEvidence(2)
    const currentFinding = ReviewFinding.make({
      findingId: ReviewFindingId.make("recursive-current-finding"),
      text: "current recursive finding"
    })
    const laterRequest = (round: number) =>
      AuthorizedImplementationReviewRequest.make({
        evidenceSealingOperationId: secondEvidence.evidenceOperation.operationId,
        findingHistory: firstReview.manifest.findingHistory,
        implementationEvidence: secondEvidence.sealed,
        implementerInvocationId: secondEvidence.executionOperationId,
        implementerSessionId: sessionId,
        operationId: OperationId.make(`direct-chain-round-${round}`),
        plannedAttempt: plan,
        predecessorEvidenceReference: firstReview.manifestReference,
        reviewerSessionId: ReviewerSessionId.make(`direct-chain-reviewer-${round}`),
        round: SemanticReviewRound.make(round)
      })
    const roundTwoRequest = laterRequest(2)
    const roundTwoReview = yield* sealImplementationReview(
      roundTwoRequest,
      ImplementationReviewDisposition.cases.Findings.make({ findings: [currentFinding] })
    ).pipe(Effect.provideService(EvidenceStore, store))
    const roundThreeRequest = laterRequest(3)
    const roundThreeReview = yield* sealImplementationReview(
      roundThreeRequest,
      ImplementationReviewDisposition.cases.Findings.make({ findings: [currentFinding] })
    ).pipe(Effect.provideService(EvidenceStore, store))
    const records = yield* journal.read(runId)
    const source = records[0]
    if (source === undefined) return yield* Effect.die("missing history")
    const reviewRecord = (review: typeof firstReview, ordinal: number) =>
      extraRecord(source, ordinal, ImplementationReviewCompletedEvent.make({ review, version: 2 }))
    const runHandback = (review: typeof firstReview, recordsForChain: ReadonlyArray<JournalRecord>) => {
      const request = ReviewFindingsHandbackRequest.make({
        implementerInvocationId: review.manifest.implementerInvocationId,
        implementerSessionId: review.manifest.implementerSessionId,
        operationId: OperationId.make(`recursive-handback:${review.manifest.operationId}`),
        plannedAttempt: review.manifest.plannedAttempt,
        review,
        reviewOperationId: review.manifest.operationId
      })
      return makeJournaledReviewFindingsHandback({
        evidenceStore: store,
        handback: ReviewFindingsHandback.of({ deliverOrResume: () => Effect.die("invalid chain reached provider") }),
        journal: journalView(recordsForChain),
        reviewer: ImplementationReviewer.of({ createOrResume: () => Effect.die("unused") }),
        runId
      })(makeReviewFindingsHandbackOperation(request))
    }

    expect(yield* runHandback(badRoundOne, [...records, reviewRecord(badRoundOne, 30)]).pipe(Effect.flip))
      .toMatchObject({ reason: "FindingHistoryMismatch" })
    const withoutFirstReview = records.filter(({ event }) =>
      event._tag !== "ImplementationReviewCompleted"
      || event.review.manifest.operationId !== firstReview.manifest.operationId
    )
    expect(
      yield* runHandback(roundTwoReview, [
        ...withoutFirstReview,
        reviewRecord(roundTwoReview, 31)
      ]).pipe(Effect.flip)
    ).toMatchObject({ reason: "MissingEvidence" })
    expect(
      yield* runHandback(roundThreeReview, [
        ...records,
        reviewRecord(roundThreeReview, 32)
      ]).pipe(Effect.flip)
    ).toMatchObject({ reason: "RoundMismatch" })
  }).pipe(Effect.provide(testLayer)))

it.effect("exposes controllable and explicitly unavailable reviewer boundaries", () =>
  Effect.gen(function*() {
    const evidence = yield* appendExecutionAndEvidence(1)
    const operation = reviewOperation(evidence)
    if (operation.request._tag !== "AuthorizedImplementationReview") return yield* Effect.die("invalid fixture")
    const request = operation.request
    const store = yield* EvidenceStore
    const accepted = ImplementationReviewDisposition.cases.Accepted.make({})
    const review = yield* sealImplementationReview(request, accepted).pipe(
      Effect.provideService(EvidenceStore, store)
    )
    expect(
      yield* authorizeImplementationReviewEvidence(review).pipe(
        Effect.provideService(EvidenceStore, {
          ...store,
          read: () => Effect.succeed(Uint8Array.from([0]))
        }),
        Effect.flip
      )
    ).toMatchObject({ reason: "ReviewMismatch" })
    const handbackRequest = ReviewFindingsHandbackRequest.make({
      implementerInvocationId: request.implementerInvocationId,
      implementerSessionId: request.implementerSessionId,
      operationId: OperationId.make("test-layer-handback"),
      plannedAttempt: plan,
      review,
      reviewOperationId: request.operationId
    })
    yield* Effect.gen(function*() {
      const service = yield* TestImplementationReview
      yield* service.setDispositions([accepted])
      expect(yield* service.createOrResume(request)).toEqual(accepted)
      expect(yield* service.createOrResume(request)).toEqual(accepted)
      expect(
        yield* service.createOrResume(AuthorizedImplementationReviewRequest.make({
          ...request,
          reviewerSessionId: ReviewerSessionId.make("test-layer-conflicting-reviewer")
        })).pipe(Effect.flip)
      ).toBeInstanceOf(ImplementationReviewInvocationFailure)
      expect(
        yield* service.createOrResume(AuthorizedImplementationReviewRequest.make({
          ...request,
          operationId: OperationId.make("test-layer-exhausted-review")
        })).pipe(Effect.flip)
      ).toBeInstanceOf(
        ImplementationReviewInvocationFailure
      )
      yield* service.deliverOrResume(handbackRequest)
      yield* service.deliverOrResume(handbackRequest)
      expect(
        yield* service.deliverOrResume(ReviewFindingsHandbackRequest.make({
          ...handbackRequest,
          implementerSessionId: TaskWorkSessionId.make("test-layer-conflicting-implementer")
        })).pipe(Effect.flip)
      ).toBeInstanceOf(ReviewFindingsHandbackFailure)
      yield* service.setDispositions([
        new ImplementationReviewInvocationFailure({
          detail: "controlled failure",
          operationId: OperationId.make("test-layer-controlled-failure"),
          reviewerSessionId: ReviewerSessionId.make("test-layer-controlled-failure")
        })
      ])
      expect(
        yield* service.createOrResume(AuthorizedImplementationReviewRequest.make({
          ...request,
          operationId: OperationId.make("test-layer-controlled-failure"),
          reviewerSessionId: ReviewerSessionId.make("test-layer-controlled-failure")
        })).pipe(Effect.flip)
      ).toBeInstanceOf(ImplementationReviewInvocationFailure)
      expect(yield* service.requests()).toHaveLength(3)
      expect(yield* service.handbacks()).toEqual([handbackRequest])
    }).pipe(Effect.provide(implementationReviewTestLayer))

    yield* Effect.gen(function*() {
      const reviewer = yield* ImplementationReviewer
      const handback = yield* ReviewFindingsHandback
      expect(yield* reviewer.createOrResume(request).pipe(Effect.flip)).toBeInstanceOf(
        ImplementationReviewInvocationFailure
      )
      expect(yield* handback.deliverOrResume(handbackRequest).pipe(Effect.flip)).toBeInstanceOf(
        ReviewFindingsHandbackFailure
      )
    }).pipe(Effect.provide(unavailableImplementationReviewLayer))

    expect(Result.isFailure(
      Schema.decodeUnknownResult(ImplementationReviewDisposition)({
        _tag: "Findings",
        findings: [finding, finding]
      })
    )).toBe(true)
    const duplicateHistoryRequest = AuthorizedImplementationReviewRequest.make({
      ...request,
      findingHistory: [finding]
    })
    expect(
      yield* sealImplementationReview(
        duplicateHistoryRequest,
        ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] })
      ).pipe(Effect.provideService(EvidenceStore, store), Effect.flip)
    ).toBeInstanceOf(ImplementationReviewHistoryContradiction)
  }).pipe(Effect.provide(testLayer)))

it.effect("provider create-or-resume contracts prevent duplicate review and handback mutations after crashes", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const evidence = yield* appendExecutionAndEvidence(1)
    const operation = reviewOperation(evidence)
    yield* Effect.gen(function*() {
      const provider = yield* TestImplementationReview
      yield* provider.setDispositions([
        ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] })
      ])
      const failReviewOutcome = yield* Ref.make(true)
      const failHandbackOutcome = yield* Ref.make(true)
      const crashJournal: JournalStoreService = {
        append: (journalRunId, key, event) =>
          Effect.gen(function*() {
            const crashesReview = event._tag === "ImplementationReviewCompleted"
              && (yield* Ref.getAndSet(failReviewOutcome, false))
            const crashesHandback = event._tag === "ReviewFindingsHandbackCompleted"
              && (yield* Ref.getAndSet(failHandbackOutcome, false))
            if (crashesReview || crashesHandback) {
              return yield* new JournalStorageUnavailable({
                detail: "crash after provider acceptance before outcome append",
                operation: "JournalStore.append"
              })
            }
            return yield* journal.append(journalRunId, key, event)
          }),
        read: journal.read
      }
      const reviewProtocol = makeJournaledImplementationReview({
        evidenceStore: store,
        handback: provider,
        journal: crashJournal,
        reviewer: provider,
        runId
      })
      expect(yield* reviewProtocol(operation).pipe(Effect.flip)).toBeInstanceOf(JournalStorageUnavailable)
      const review = yield* reviewProtocol(operation)
      expect(yield* provider.requests()).toHaveLength(1)

      const handbackOperation = makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
        implementerInvocationId: evidence.executionOperationId,
        implementerSessionId: sessionId,
        operationId: OperationId.make("crash-contract-handback"),
        plannedAttempt: plan,
        review,
        reviewOperationId: operation.request.operationId
      }))
      const handbackProtocol = makeJournaledReviewFindingsHandback({
        evidenceStore: store,
        handback: provider,
        journal: crashJournal,
        reviewer: provider,
        runId
      })
      expect(yield* handbackProtocol(handbackOperation).pipe(Effect.flip)).toBeInstanceOf(JournalStorageUnavailable)
      yield* handbackProtocol(handbackOperation)
      expect(yield* provider.handbacks()).toHaveLength(1)
    }).pipe(Effect.provide(implementationReviewTestLayer))
  }).pipe(Effect.provide(testLayer)))

it.effect("recovers unresolved review and findings handback intents through their exact operations", () =>
  Effect.gen(function*() {
    const evidence = yield* appendExecutionAndEvidence(1)
    const operation = reviewOperation(evidence)
    if (operation.request._tag !== "AuthorizedImplementationReview") return yield* Effect.die("invalid fixture")
    const store = yield* EvidenceStore
    const review = yield* sealImplementationReview(
      operation.request,
      ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] })
    ).pipe(Effect.provideService(EvidenceStore, store))
    const simulatedOperation = reviewOperation(evidence, {
      reviewerSessionId: ReviewerSessionId.make("recovery-simulated-reviewer"),
      round: SemanticReviewRound.make(2)
    })
    const completedOperation = reviewOperation(evidence, {
      reviewerSessionId: ReviewerSessionId.make("recovery-completed-reviewer"),
      round: SemanticReviewRound.make(3)
    })
    const completedReview = {
      ...review,
      manifest: {
        ...review.manifest,
        operationId: completedOperation.request.operationId,
        reviewerSessionId: ReviewerSessionId.make("recovery-completed-reviewer"),
        round: SemanticReviewRound.make(3)
      }
    }
    const handbackOperation = makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
      implementerInvocationId: evidence.executionOperationId,
      implementerSessionId: sessionId,
      operationId: OperationId.make("recovery-handback"),
      plannedAttempt: plan,
      review,
      reviewOperationId: operation.request.operationId
    }))
    const completedHandbackOperation = makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
      ...handbackOperation.request,
      operationId: OperationId.make("recovery-completed-handback")
    }))
    const source = (yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId))))[0]
    if (source === undefined) return yield* Effect.die("missing fixture history")
    const records = [
      extraRecord(source, 20, ImplementationReviewIntendedEvent.make({ operation, version: 2 })),
      extraRecord(source, 21, ImplementationReviewIntendedEvent.make({ operation: simulatedOperation, version: 2 })),
      extraRecord(source, 22, ImplementationReviewIntendedEvent.make({ operation: completedOperation, version: 2 })),
      extraRecord(source, 23, ImplementationReviewCompletedEvent.make({ review: completedReview, version: 2 })),
      extraRecord(source, 24, ReviewFindingsHandbackIntendedEvent.make({ operation: handbackOperation, version: 2 })),
      extraRecord(
        source,
        25,
        ReviewFindingsHandbackIntendedEvent.make({
          operation: completedHandbackOperation,
          version: 2
        })
      ),
      extraRecord(
        source,
        26,
        ReviewFindingsHandbackCompletedEvent.make({
          acknowledgement: ReviewFindingsHandbackAcknowledged.make({
            operationId: completedHandbackOperation.request.operationId,
            reviewEvidenceReference: review.manifestReference
          }),
          version: 2
        })
      )
    ]
    const traceTags = yield* Ref.make<ReadonlyArray<string>>([])
    const acknowledgement = ReviewFindingsHandbackAcknowledged.make({
      operationId: handbackOperation.request.operationId,
      reviewEvidenceReference: review.manifestReference
    })
    const unused = () => Effect.die("unused recovery interpreter method")
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: unused,
      establishTaskWorkSession: unused,
      executeTaskWork: unused,
      handBackReviewFindings: () => Effect.succeed(acknowledgement),
      readTrackerGraph: unused,
      reconcileTaskWorktree: unused,
      recordTaskAttemptPlan: unused,
      reviewImplementation: (candidate) =>
        candidate.request.operationId === operation.request.operationId
          ? Effect.succeed(review)
          : Effect.succeed(ImplementationReviewSimulated.make({
            operationId: candidate.request.operationId,
            predecessorOperationId: candidate.request.evidenceSealingOperationId,
            round: candidate.request.round
          })),
      sealImplementationEvidence: unused,
      simulateTaskExecution: unused,
      simulateTaskWorkSession: unused
    })
    const provideRecovery = <A, E>(effect: Effect.Effect<A, E, WorkflowInterpreter | WorkflowTrace | JournalStore>) =>
      effect.pipe(
        Effect.provideService(JournalStore, journalView(records)),
        Effect.provideService(WorkflowInterpreter, interpreter),
        Effect.provideService(
          WorkflowTrace,
          WorkflowTrace.of({
            emit: (item) => Ref.update(traceTags, (current) => [...current, item._tag])
          })
        )
      )

    expect(yield* provideRecovery(recoverImplementationReviews(runId))).toHaveLength(2)
    expect(yield* provideRecovery(recoverReviewFindingsHandbacks(runId))).toEqual([acknowledgement])
    expect(yield* Ref.get(traceTags)).toEqual([
      "ImplementationReviewCompleted",
      "ReviewFindingsHandedBack"
    ])
    expect(workflowOperationId(operation)).toBe(operation.request.operationId)
    expect(workflowOperationId(handbackOperation)).toBe(handbackOperation.request.operationId)
  }).pipe(Effect.provide(testLayer)))

const journalView = (records: ReadonlyArray<JournalRecord>): JournalStoreService => ({
  append: () => Effect.die("contradiction must precede append"),
  read: () => Effect.succeed(records)
})

const extraRecord = (
  source: JournalRecord,
  ordinal: number,
  event = source.event
): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`contradiction:${ordinal}`),
  position: JournalPosition.make(1_000 + ordinal),
  runId
})

it.effect("classifies malformed review and handback histories without provider calls", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const evidence = yield* appendExecutionAndEvidence(1)
    const operation = reviewOperation(evidence)
    if (operation.request._tag !== "AuthorizedImplementationReview") return yield* Effect.die("invalid fixture")
    const request = operation.request
    const baseRecords = yield* journal.read(runId)
    const reviewer = ImplementationReviewer.of({ createOrResume: () => Effect.die("invalid history reached reviewer") })
    const handback = ReviewFindingsHandback.of({
      deliverOrResume: () => Effect.die("invalid history reached handback")
    })
    const runReview = (records: ReadonlyArray<JournalRecord>, candidate = operation) =>
      makeJournaledImplementationReview({
        evidenceStore: store,
        handback,
        journal: journalView(records),
        reviewer,
        runId
      })(candidate)
    const expectReason = Effect.fn("ReviewTest.expectReason")(function*(
      effect: Effect.Effect<unknown, unknown>,
      reason: InstanceType<typeof ImplementationReviewHistoryContradiction>["reason"]
    ) {
      const failure = yield* effect.pipe(Effect.flip)
      expect(failure).toBeInstanceOf(ImplementationReviewHistoryContradiction)
      if (!(failure instanceof ImplementationReviewHistoryContradiction)) return yield* Effect.die("unexpected failure")
      expect(failure.reason).toBe(reason)
    })
    const changedReference = {
      byteLength: evidence.sealed.manifestReference.byteLength,
      digest: EvidenceDigest.make("f".repeat(64))
    }
    const requestWith = (fields: Partial<typeof request>) =>
      makeImplementationReviewOperation(AuthorizedImplementationReviewRequest.make({
        ...request,
        ...fields
      }))

    yield* expectReason(
      runReview(baseRecords.filter(({ event }) => event._tag !== "ImplementationEvidenceSealed")),
      "MissingEvidence"
    )
    yield* expectReason(
      runReview(
        baseRecords,
        requestWith({ implementationEvidence: { ...evidence.sealed, manifestReference: changedReference } })
      ),
      "EvidenceMismatch"
    )
    yield* expectReason(
      runReview(
        baseRecords,
        requestWith({
          plannedAttempt: { ...plan, baseSha: GitCommitSha.make("ffffffffffffffffffffffffffffffffffffffff") }
        })
      ),
      "AttemptMismatch"
    )
    yield* expectReason(
      runReview(baseRecords.filter(({ event }) => event._tag !== "TaskExecutionOutcomeObserved")),
      "MissingImplementerInvocation"
    )
    yield* expectReason(
      runReview(baseRecords.filter(({ event }) => event._tag !== "TaskExecutionIntentRecorded")),
      "MissingImplementerInvocation"
    )
    yield* expectReason(
      runReview(
        baseRecords,
        requestWith({ implementerInvocationId: OperationId.make("foreign-evidence-predecessor") })
      ),
      "EvidenceMismatch"
    )
    yield* expectReason(
      runReview(baseRecords, requestWith({ implementerSessionId: TaskWorkSessionId.make("wrong-session") })),
      "ImplementerSessionMismatch"
    )
    yield* expectReason(
      runReview(baseRecords, requestWith({ predecessorEvidenceReference: changedReference })),
      "EvidenceMismatch"
    )
    yield* expectReason(
      runReview(baseRecords, requestWith({ findingHistory: [finding] })),
      "FindingHistoryMismatch"
    )
    const simulated = makeImplementationReviewOperation(ImplementationReviewRequest.make({
      _tag: "SimulatedImplementationReview",
      evidenceSealingOperationId: evidence.evidenceOperation.operationId,
      operationId: OperationId.make("simulated-review-history"),
      round: SemanticReviewRound.make(1)
    }))
    expect(yield* runReview(baseRecords, simulated).pipe(Effect.flip)).toMatchObject({
      _tag: "ImplementationReviewModeContradiction"
    })
    expect(Result.isFailure(
      Schema.decodeUnknownResult(WorkflowOperation)({
        ...operation,
        predecessorOperationIds: []
      })
    )).toBe(true)
    yield* expectReason(
      runReview(baseRecords, requestWith({ plannedAttempt: { ...plan, runId: RunId.make("wrong-run") } })),
      "RunMismatch"
    )

    const findingsReviewer = ImplementationReviewer.of({
      createOrResume: () => Effect.succeed(ImplementationReviewDisposition.cases.Findings.make({ findings: [finding] }))
    })
    const review = yield* makeJournaledImplementationReview({
      evidenceStore: store,
      handback,
      journal,
      reviewer: findingsReviewer,
      runId
    })(operation)
    const recordsWithReview = yield* journal.read(runId)
    const intentRecord = recordsWithReview.find(({ event }) => event._tag === "ImplementationReviewIntended")
    const outcomeRecord = recordsWithReview.find(({ event }) => event._tag === "ImplementationReviewCompleted")
    if (intentRecord === undefined || outcomeRecord === undefined) return yield* Effect.die("missing review history")

    const changedOperation = requestWith({ reviewerSessionId: ReviewerSessionId.make("changed-reviewer") })
    yield* expectReason(runReview([...baseRecords, intentRecord], changedOperation), "IntentMismatch")
    yield* expectReason(runReview([...baseRecords, intentRecord, extraRecord(intentRecord, 1)]), "MultipleIntents")
    yield* expectReason(runReview([...baseRecords, outcomeRecord]), "OutcomeWithoutIntent")
    const mismatchedReviewOutcome = extraRecord(
      outcomeRecord,
      8,
      ImplementationReviewCompletedEvent.make({
        review: {
          ...review,
          manifest: {
            ...review.manifest,
            reviewerSessionId: ReviewerSessionId.make("mismatched-outcome-reviewer")
          }
        },
        version: 2
      })
    )
    yield* expectReason(
      runReview([...baseRecords, intentRecord, mismatchedReviewOutcome]),
      "ReviewMismatch"
    )
    yield* expectReason(
      runReview([...baseRecords, intentRecord, outcomeRecord, extraRecord(outcomeRecord, 2)]),
      "MultipleOutcomes"
    )
    const reusedReviewerOperation = requestWith({ operationId: OperationId.make("review-reused-session") })
    yield* expectReason(runReview(recordsWithReview, reusedReviewerOperation), "ReviewerSessionReused")

    const sameInvocationRoundTwo = makeImplementationReviewOperation(AuthorizedImplementationReviewRequest.make({
      ...request,
      findingHistory: review.manifest.findingHistory,
      operationId: OperationId.make("same-invocation-round-two"),
      predecessorEvidenceReference: review.manifestReference,
      reviewerSessionId: ReviewerSessionId.make("reviewer-session-round-two"),
      round: SemanticReviewRound.make(2)
    }))
    yield* expectReason(runReview(recordsWithReview, sameInvocationRoundTwo), "CrossAttemptContinuation")
    const secondEvidence = yield* appendExecutionAndEvidence(2)
    const roundRecords = yield* journal.read(runId)
    const roundTwoWith = (
      fields: Partial<Parameters<typeof AuthorizedImplementationReviewRequest.make>[0]> = {}
    ) =>
      makeImplementationReviewOperation(AuthorizedImplementationReviewRequest.make({
        evidenceSealingOperationId: secondEvidence.evidenceOperation.operationId,
        findingHistory: review.manifest.findingHistory,
        implementationEvidence: secondEvidence.sealed,
        implementerInvocationId: secondEvidence.executionOperationId,
        implementerSessionId: sessionId,
        operationId: OperationId.make("round-two-review"),
        plannedAttempt: plan,
        predecessorEvidenceReference: review.manifestReference,
        reviewerSessionId: ReviewerSessionId.make("reviewer-session-round-two"),
        round: SemanticReviewRound.make(2),
        ...fields
      }))
    yield* expectReason(
      runReview(roundRecords, roundTwoWith({ predecessorEvidenceReference: changedReference })),
      "MissingEvidence"
    )
    yield* expectReason(
      runReview(roundRecords, roundTwoWith({ round: SemanticReviewRound.make(3) })),
      "RoundMismatch"
    )
    yield* expectReason(runReview(roundRecords, roundTwoWith({ findingHistory: [] })), "FindingHistoryMismatch")

    const handbackRequest = ReviewFindingsHandbackRequest.make({
      implementerInvocationId: evidence.executionOperationId,
      implementerSessionId: sessionId,
      operationId: OperationId.make("classified-handback"),
      plannedAttempt: plan,
      review,
      reviewOperationId: operation.request.operationId
    })
    const handbackOperation = makeReviewFindingsHandbackOperation(handbackRequest)
    expect(Result.isFailure(
      Schema.decodeUnknownResult(WorkflowOperation)({
        ...handbackOperation,
        predecessorOperationIds: []
      })
    )).toBe(true)
    const runHandback = (records: ReadonlyArray<JournalRecord>, candidate = handbackOperation) =>
      makeJournaledReviewFindingsHandback({
        evidenceStore: store,
        handback,
        journal: journalView(records),
        reviewer,
        runId
      })(candidate)
    yield* expectReason(runHandback(baseRecords), "MissingEvidence")
    yield* expectReason(
      runHandback(recordsWithReview.filter(({ event }) => event._tag !== "ImplementationEvidenceSealed")),
      "MissingEvidence"
    )
    yield* expectReason(
      runHandback(recordsWithReview.map((record) =>
        record.event._tag === "ImplementationEvidenceSealed"
          ? {
            ...record,
            event: ImplementationEvidenceSealedEvent.make({
              ...record.event,
              sealed: {
                ...record.event.sealed,
                manifest: {
                  ...record.event.sealed.manifest,
                  taskId: TaskId.make("foreign-chain-task")
                }
              }
            })
          }
          : record
      )),
      "EvidenceMismatch"
    )
    yield* expectReason(
      runHandback(
        recordsWithReview,
        makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
          ...handbackRequest,
          review: { ...review, manifestReference: changedReference }
        }))
      ),
      "ReviewMismatch"
    )
    yield* expectReason(
      runHandback(
        recordsWithReview,
        makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
          ...handbackRequest,
          plannedAttempt: { ...plan, attemptId: AttemptId.make("foreign-attempt") }
        }))
      ),
      "CrossAttemptContinuation"
    )
    yield* expectReason(
      runHandback(
        recordsWithReview,
        makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
          ...handbackRequest,
          implementerInvocationId: OperationId.make("foreign-invocation")
        }))
      ),
      "ImplementerInvocationIsNotLatest"
    )
    yield* expectReason(
      runHandback(
        recordsWithReview,
        makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
          ...handbackRequest,
          implementerSessionId: TaskWorkSessionId.make("foreign-session")
        }))
      ),
      "ImplementerSessionMismatch"
    )
    const acceptedReview = {
      ...review,
      manifest: {
        ...review.manifest,
        disposition: ImplementationReviewDisposition.cases.Accepted.make({})
      }
    }
    const acceptedReviewEvent = extraRecord(outcomeRecord, 7, {
      _tag: "ImplementationReviewCompleted" as const,
      review: acceptedReview,
      version: 2 as const
    })
    yield* expectReason(
      runHandback(
        [...baseRecords, acceptedReviewEvent],
        makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
          ...handbackRequest,
          review: acceptedReview
        }))
      ),
      "HandbackWithoutFindings"
    )
    yield* expectReason(runHandback(roundRecords), "ImplementerInvocationIsNotLatest")
    yield* expectReason(
      runHandback(
        recordsWithReview,
        makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
          ...handbackRequest,
          plannedAttempt: { ...plan, runId: RunId.make("foreign-handback-run") }
        }))
      ),
      "RunMismatch"
    )

    const handbackAcknowledgement = ReviewFindingsHandbackAcknowledged.make({
      operationId: handbackRequest.operationId,
      reviewEvidenceReference: review.manifestReference
    })
    const handbackIntent = extraRecord(
      intentRecord,
      3,
      ReviewFindingsHandbackIntendedEvent.make({
        operation: handbackOperation,
        version: 2
      })
    )
    const handbackOutcome = extraRecord(
      outcomeRecord,
      4,
      ReviewFindingsHandbackCompletedEvent.make({
        acknowledgement: handbackAcknowledgement,
        version: 2
      })
    )
    yield* expectReason(
      runHandback(
        [...recordsWithReview, handbackIntent],
        {
          ...handbackOperation,
          predecessorOperationIds: [OperationId.make("different-review-predecessor")]
        }
      ),
      "IntentMismatch"
    )
    yield* expectReason(
      runHandback([...recordsWithReview, handbackIntent, extraRecord(handbackIntent, 5)]),
      "MultipleIntents"
    )
    yield* expectReason(runHandback([...recordsWithReview, handbackOutcome]), "OutcomeWithoutIntent")
    const mismatchedHandbackOutcome = extraRecord(
      handbackOutcome,
      9,
      ReviewFindingsHandbackCompletedEvent.make({
        acknowledgement: ReviewFindingsHandbackAcknowledged.make({
          operationId: handbackRequest.operationId,
          reviewEvidenceReference: changedReference
        }),
        version: 2
      })
    )
    yield* expectReason(
      runHandback([...recordsWithReview, handbackIntent, mismatchedHandbackOutcome]),
      "ReviewMismatch"
    )
    yield* expectReason(
      runHandback([...recordsWithReview, handbackIntent, handbackOutcome, extraRecord(handbackOutcome, 6)]),
      "MultipleOutcomes"
    )
  }).pipe(Effect.provide(testLayer)))
