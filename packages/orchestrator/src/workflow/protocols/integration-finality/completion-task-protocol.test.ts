import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { AcceptedResultEvidenceManifest, EvidenceReference, TaskRevision } from "@dalph/contracts"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InRunJournal, type JournalRecord, JournalStorageUnavailable } from "../../../workflow-journal/store.js"
import {
  completionClaimReplacedRecordKey,
  completionTaskIntentRecordKey,
  intentRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import { makeCompletionTaskFactsObservationOperation } from "../../registry/operation.js"
import { taskTrackerReadIntent } from "../../registry/event.js"
import {
  IntegrationCandidateCorrelation,
  IntegrationReviewManifest
} from "../integration-candidate-construction/events.js"
import {
  TargetPromotionCorrelation,
  TargetPromotionGit,
  TargetPromotionGitReadFailure
} from "../target-promotion/events.js"
import { TargetVerificationCorrelation } from "../target-verification/events.js"
import { memoryEvidenceStoreLayer, EvidenceStore, EvidenceStoreFailure } from "../target-verification/evidence-store.js"
import { TargetVerificationManifest } from "../target-verification/manifest.js"
import {
  CompletionTaskAcknowledgement,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskConfirmationReadOrdinal,
  type CompletionTaskBoundaryService,
  CompletionTaskClaim,
  CompletionClaimReplacedEvent,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestFailure,
  CompletionTaskRequestLookupFailure,
  CompletionTaskRequestLookup,
  CompletionTaskRequestOrdinal,
  CompletionTaskFocusedReadPurpose,
  FocusedTaskCompletionReadFailure,
  completionClaimReplacementOperationIdFor,
  completionTaskRequestFor
} from "./events.js"
import { completionTaskCandidateAncestryReadOperationIdFor } from "./completion-task-operation-identity.js"
import { integrationFinalityFixture as fixture } from "./fixtures.js"
import {
  CompletionTaskAuthorization,
  CompletionTaskAttemptAuthorization,
  CompletionTaskAuthorizationConflict,
  CompletionTaskDidNotConverge,
  CompletionTaskPreconditionConflict,
  authorizeCompletionTaskAttempt,
  candidateAncestryFor,
  completionTaskAuthorizationIssue,
  completionTaskConfirmationDisposition,
  nextCompletionAuthorizationPurpose,
  nextCompletionConfirmationPurpose,
  readCompletionCandidateAncestry,
  readCompletionConfirmation,
  readCompletionFocusedFacts,
  rereadCompletionEvidence,
  runCompletionTaskProtocol
} from "./completion-task-protocol.js"
import { invalidCompletionTaskHistory } from "./completion-task-history.js"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const completionEvidenceRequest = (
  acceptedCommit = fixture.promotionCorrelation.candidateCorrelation.acceptedResultCommit
) =>
  Effect.gen(function* () {
    const store = yield* EvidenceStore
    const acceptanceManifest = yield* store.put(
      encode(
        AcceptedResultEvidenceManifest.make({
          commit: acceptedCommit,
          correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
          formatVersion: 1,
          outcome: "Accepted",
          predecessor: null
        })
      )
    )
    const candidateCorrelation = IntegrationCandidateCorrelation.make({
      ...fixture.promotionCorrelation.candidateCorrelation,
      acceptanceManifest
    })
    const integrationReviewManifest = yield* store.put(
      encode(
        IntegrationReviewManifest.make({
          candidateCommit: fixture.promotionCorrelation.candidateCommit,
          correlation: candidateCorrelation,
          formatVersion: 1,
          outcome: "Passed",
          predecessor: acceptanceManifest
        })
      )
    )
    const verificationCorrelation = TargetVerificationCorrelation.make({
      ...fixture.promotionCorrelation.verificationCorrelation,
      candidateCorrelation,
      reviewManifest: integrationReviewManifest
    })
    const verificationManifest = yield* store.put(
      encode(
        TargetVerificationManifest.make({
          artifacts: [],
          correlation: verificationCorrelation,
          formatVersion: 1,
          outcome: "Passed",
          predecessor: integrationReviewManifest
        })
      )
    )
    const promotionCorrelation = TargetPromotionCorrelation.make({
      ...fixture.promotionCorrelation,
      acceptanceManifest,
      candidateCorrelation,
      reviewManifest: integrationReviewManifest,
      verificationCorrelation,
      verificationManifest
    })
    return completionTaskRequestFor(
      CompletionTaskClaim.make({
        acceptanceManifest,
        integrationReviewManifest,
        originalClaim: fixture.activeClaim,
        plannedAttempt: fixture.plannedAttempt,
        promotionCorrelation,
        verificationManifest
      })
    )
  })

it.effect("refuses completion when required sealed evidence is missing, malformed, or mismatched", () =>
  Effect.gen(function* () {
    const valid = yield* completionEvidenceRequest()
    expect(yield* rereadCompletionEvidence(valid)).toEqual(valid)

    const mismatched = yield* completionEvidenceRequest(fixture.promotionCorrelation.expectedTargetHead)
    const mismatch = yield* rereadCompletionEvidence(mismatched).pipe(Effect.flip)
    expect(mismatch).toBeInstanceOf(CompletionTaskAuthorizationConflict)
    if (mismatch instanceof CompletionTaskAuthorizationConflict) {
      expect(mismatch.detail).toContain("does not bind the promoted accepted result")
    }

    const malformedReference = yield* (yield* EvidenceStore).put(new TextEncoder().encode("not-json"))
    const malformedCandidateCorrelation = IntegrationCandidateCorrelation.make({
      ...valid.promotionCorrelation.candidateCorrelation,
      acceptanceManifest: malformedReference
    })
    const malformedClaim = CompletionTaskClaim.make({
      ...valid.claim,
      acceptanceManifest: malformedReference,
      promotionCorrelation: TargetPromotionCorrelation.make({
        ...valid.promotionCorrelation,
        acceptanceManifest: malformedReference,
        candidateCorrelation: malformedCandidateCorrelation,
        verificationCorrelation: TargetVerificationCorrelation.make({
          ...valid.promotionCorrelation.verificationCorrelation,
          candidateCorrelation: malformedCandidateCorrelation
        })
      })
    })
    const malformed = completionTaskRequestFor(malformedClaim)
    expect(yield* rereadCompletionEvidence(malformed).pipe(Effect.flip)).toBeInstanceOf(
      CompletionTaskAuthorizationConflict
    )
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("rejects a reopened evidence chain whose review predecessor is foreign", () =>
  Effect.gen(function* () {
    const valid = yield* completionEvidenceRequest()
    const store = yield* EvidenceStore
    const unlinkedReview = yield* store.put(
      encode(
        IntegrationReviewManifest.make({
          candidateCommit: valid.promotionCorrelation.candidateCommit,
          correlation: valid.promotionCorrelation.candidateCorrelation,
          formatVersion: 1,
          outcome: "Passed",
          predecessor: fixture.promotionCorrelation.reviewManifest
        })
      )
    )
    const verificationCorrelation = TargetVerificationCorrelation.make({
      ...valid.promotionCorrelation.verificationCorrelation,
      reviewManifest: unlinkedReview
    })
    const verification = yield* store.put(
      encode(
        TargetVerificationManifest.make({
          artifacts: [],
          correlation: verificationCorrelation,
          formatVersion: 1,
          outcome: "Passed",
          predecessor: unlinkedReview
        })
      )
    )
    const promotionCorrelation = TargetPromotionCorrelation.make({
      ...valid.promotionCorrelation,
      reviewManifest: unlinkedReview,
      verificationCorrelation,
      verificationManifest: verification
    })
    const request = completionTaskRequestFor(
      CompletionTaskClaim.make({
        ...valid.claim,
        integrationReviewManifest: unlinkedReview,
        promotionCorrelation,
        verificationManifest: verification
      })
    )
    const failure = yield* rereadCompletionEvidence(request).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(CompletionTaskAuthorizationConflict)
    if (failure instanceof CompletionTaskAuthorizationConflict) {
      expect(failure.reason).toBe("SealedEvidenceChanged")
      expect(failure.detail).toContain("predecessor chain")
    }
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("reports unavailable and malformed bytes for each sealed evidence family", () =>
  Effect.gen(function* () {
    const request = yield* completionEvidenceRequest()
    const store = yield* EvidenceStore
    const references = [
      request.acceptanceManifest,
      request.integrationReviewManifest,
      request.verificationManifest
    ] as const

    for (const unavailable of references) {
      const boundary = EvidenceStore.of({
        put: store.put,
        read: (reference) =>
          reference.digest === unavailable.digest
            ? Effect.fail(
                new EvidenceStoreFailure({ detail: "controlled missing evidence", operation: "EvidenceStore.read" })
              )
            : store.read(reference)
      })
      expect(
        yield* rereadCompletionEvidence(request).pipe(Effect.provideService(EvidenceStore, boundary), Effect.flip)
      ).toMatchObject({ reason: "SealedEvidenceUnavailable" })
    }

    for (const malformed of references.slice(1)) {
      const boundary = EvidenceStore.of({
        put: store.put,
        read: (reference) =>
          reference.digest === malformed.digest ? Effect.succeed(encode("not-json")) : store.read(reference)
      })
      expect(
        yield* rereadCompletionEvidence(request).pipe(Effect.provideService(EvidenceStore, boundary), Effect.flip)
      ).toMatchObject({ reason: "SealedEvidenceUnavailableOrInvalid" })
    }
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("rejects sealed envelopes that no longer bind the promoted result", () =>
  Effect.gen(function* () {
    const request = yield* completionEvidenceRequest()
    const store = yield* EvidenceStore
    const substitutions = [
      {
        reference: request.acceptanceManifest,
        transform: (value: Record<string, unknown>) => ({
          ...value,
          commit: fixture.promotionCorrelation.expectedTargetHead
        })
      },
      {
        reference: request.integrationReviewManifest,
        transform: (value: Record<string, unknown>) => ({
          ...value,
          candidateCommit: fixture.promotionCorrelation.expectedTargetHead
        })
      },
      {
        reference: request.verificationManifest,
        transform: (value: Record<string, unknown>) => ({
          ...value,
          correlation: {
            ...(value["correlation"] as Record<string, unknown>),
            requestId: "another-verification-request"
          }
        })
      }
    ] as const

    for (const substitution of substitutions) {
      const original = yield* store.read(substitution.reference)
      const decoded = JSON.parse(new TextDecoder().decode(original)) as Record<string, unknown>
      const replacement = encode(substitution.transform(decoded))
      const boundary = EvidenceStore.of({
        put: store.put,
        read: (reference) =>
          reference.digest === substitution.reference.digest ? Effect.succeed(replacement) : store.read(reference)
      })
      expect(
        yield* rereadCompletionEvidence(request).pipe(Effect.provideService(EvidenceStore, boundary), Effect.flip)
      ).toMatchObject({ reason: "SealedEvidenceChanged" })
    }
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

const journalLayer = (records: Ref.Ref<ReadonlyArray<JournalRecord>>, chronology: Ref.Ref<ReadonlyArray<string>>) =>
  Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: (runId, key, event) =>
        Effect.gen(function* () {
          yield* Ref.update(chronology, (current) => [...current, event._tag])
          return yield* Ref.modify(records, (current) => {
            const existing = current.find((record) => record.key === key)
            if (existing !== undefined) return [Effect.succeed(existing), current] as const
            const appended: JournalRecord = { event, key, position: JournalPosition.make(current.length + 1), runId }
            return [Effect.succeed(appended), [...current, appended]] as const
          }).pipe(Effect.flatten)
        }),
      read: () => Ref.get(records)
    })
  )

const journalLayerThatDiesBefore = (
  records: Ref.Ref<ReadonlyArray<JournalRecord>>,
  chronology: Ref.Ref<ReadonlyArray<string>>,
  shouldDie: (event: JournalRecord["event"]) => boolean
) =>
  Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: (runId, key, event) =>
        shouldDie(event)
          ? Effect.die(`controlled coordinator death before ${event._tag}`)
          : Effect.gen(function* () {
              yield* Ref.update(chronology, (current) => [...current, event._tag])
              return yield* Ref.modify(records, (current) => {
                const existing = current.find((record) => record.key === key)
                if (existing !== undefined) return [existing, current] as const
                const appended: JournalRecord = {
                  event,
                  key,
                  position: JournalPosition.make(current.length + 1),
                  runId
                }
                return [appended, [...current, appended]] as const
              })
            }),
      read: () => Ref.get(records)
    })
  )

const authorization = CompletionTaskAuthorization.make({
  acceptanceManifest: fixture.claim.acceptanceManifest,
  candidateAncestry: "Current",
  focusedFacts: {
    currentClaim: fixture.claim,
    lifecycle: "Open",
    operationId: fixture.claim.originalClaim.operationId,
    target: fixture.target,
    targetMembership: "Member",
    taskId: fixture.taskId,
    taskRevision: fixture.plannedAttempt.taskRevision,
    trackerRevision: fixture.trackerRevision,
    unfinishedPrerequisiteTaskIds: []
  },
  gitReadOperationId: OperationId.make(String(fixture.claim.promotionCorrelation.requestId)),
  integrationReviewManifest: fixture.claim.integrationReviewManifest,
  target: fixture.target,
  verificationManifest: fixture.claim.verificationManifest
})

it.effect("owns journal-read and focused-read authorization failures", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const unavailable = new JournalStorageUnavailable({
      detail: "controlled journal outage",
      operation: "JournalStore.read"
    })
    const unreadableJournal = Layer.succeed(
      InRunJournal,
      InRunJournal.of({
        append: () => Effect.die("journal read must fail before append"),
        read: () => Effect.fail(unavailable)
      })
    )
    const unusedBoundary: CompletionTaskBoundaryService = {
      completeTask: () => Effect.die("authorization failure must stop before completion"),
      readCompletionRequest: () => Effect.die("authorization failure must stop before lookup"),
      readFocusedTaskCompletion: () => Effect.die("journal failure must stop before focused read")
    }
    expect(
      yield* authorizeCompletionTaskAttempt(
        unusedBoundary,
        request,
        fixture.target,
        CompletionTaskRequestOrdinal.make(1)
      ).pipe(Effect.provide(unreadableJournal), Effect.flip)
    ).toMatchObject({ reason: "CurrentFactsJournalUnavailable" })

    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const focusedUnavailable: CompletionTaskBoundaryService = {
      ...unusedBoundary,
      readFocusedTaskCompletion: (taskId) =>
        Effect.fail(new FocusedTaskCompletionReadFailure({ detail: "focused read unavailable", taskId }))
    }
    expect(
      yield* authorizeCompletionTaskAttempt(
        focusedUnavailable,
        request,
        fixture.target,
        CompletionTaskRequestOrdinal.make(1)
      ).pipe(Effect.provide(journalLayer(records, chronology)), Effect.flip)
    ).toMatchObject({ reason: "FocusedFactsUnavailable" })

    const conflictRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const conflictChronology = yield* Ref.make<ReadonlyArray<string>>([])
    const mismatchedOperationBoundary: CompletionTaskBoundaryService = {
      ...unusedBoundary,
      readFocusedTaskCompletion: () =>
        Effect.succeed({
          ...authorization.focusedFacts,
          operationId: OperationId.make("authorization-mismatched-focused-operation")
        })
    }
    expect(
      yield* authorizeCompletionTaskAttempt(
        mismatchedOperationBoundary,
        request,
        fixture.target,
        CompletionTaskRequestOrdinal.make(1)
      ).pipe(Effect.provide(journalLayer(conflictRecords, conflictChronology)), Effect.flip)
    ).toMatchObject({ reason: "FocusedFactsCorrelationMismatch" })

    const ancestryPurpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
    })
    const ancestryOperationId = completionTaskCandidateAncestryReadOperationIdFor(request, ancestryPurpose)
    const ancestryRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      {
        event: CompletionTaskCandidateAncestryObservedEvent.make({
          attemptOrdinal: CompletionTaskRequestOrdinal.make(2),
          observation: { _tag: "CandidateCurrent", currentHeadSha: request.promotionCorrelation.candidateCommit },
          operationId: ancestryOperationId,
          request,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(OperationId.make("contradictory-candidate-ancestry-outcome")),
        position: JournalPosition.make(1),
        runId: request.claim.plannedAttempt.runId
      }
    ])
    const ancestryChronology = yield* Ref.make<ReadonlyArray<string>>([])
    const exactFocusedBoundary: CompletionTaskBoundaryService = {
      ...unusedBoundary,
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Effect.succeed({ ...authorization.focusedFacts, currentClaim: request.claim, operationId })
    }
    expect(
      yield* authorizeCompletionTaskAttempt(
        exactFocusedBoundary,
        request,
        fixture.target,
        CompletionTaskRequestOrdinal.make(1)
      ).pipe(Effect.provide(journalLayer(ancestryRecords, ancestryChronology)), Effect.flip)
    ).toMatchObject({ reason: "RequestIdentityContradiction" })
  }).pipe(
    Effect.provideService(
      TargetPromotionGit,
      TargetPromotionGit.of({
        compareAndSet: () => Effect.die("authorization failure cases never compare-and-set"),
        read: () => Effect.die("authorization failure cases stop before Git")
      })
    ),
    Effect.provide(memoryEvidenceStoreLayer),
    Effect.provide(NodeServices.layer)
  )
)

it.effect("reuses unresolved focused-read intents after restart", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const attemptOrdinal = CompletionTaskRequestOrdinal.make(1)
    const authorizationPurpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
      attemptOrdinal,
      authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
    })
    const confirmationPurpose = CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
      attemptOrdinal,
      confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
    })
    yield* Effect.gen(function* () {
      const journal = yield* InRunJournal
      for (const purpose of [authorizationPurpose, confirmationPurpose]) {
        const operation = makeCompletionTaskFactsObservationOperation(request, fixture.target, purpose)
        yield* journal.append(
          request.claim.plannedAttempt.runId,
          intentRecordKey(operation.operationId),
          taskTrackerReadIntent(operation)
        )
      }

      yield* Ref.update(records, (current) => [
        ...current,
        {
          event: { ...fixture.graphRecordEvent, operationId: OperationId.make("unrelated-complete-graph-observation") },
          key: intentRecordKey(OperationId.make("unrelated-complete-graph-record")),
          position: JournalPosition.make(current.length + 1),
          runId: request.claim.plannedAttempt.runId
        }
      ])

      expect(yield* nextCompletionAuthorizationPurpose(request, attemptOrdinal)).toEqual(authorizationPurpose)
      expect(yield* nextCompletionConfirmationPurpose(request, attemptOrdinal)).toEqual(confirmationPurpose)

      const authorizationOperation = makeCompletionTaskFactsObservationOperation(
        request,
        fixture.target,
        authorizationPurpose
      )
      yield* Ref.update(records, (current) => [
        ...current,
        {
          event: { ...fixture.graphRecordEvent, operationId: authorizationOperation.operationId },
          key: intentRecordKey(OperationId.make("non-focused-observation-under-focused-operation")),
          position: JournalPosition.make(current.length + 1),
          runId: request.claim.plannedAttempt.runId
        }
      ])
      const boundary: CompletionTaskBoundaryService = {
        completeTask: () => Effect.die("focused read replay never completes the task"),
        readCompletionRequest: () => Effect.die("focused read replay never looks up Q"),
        readFocusedTaskCompletion: (_taskId, _target, operationId) =>
          Effect.succeed({ ...authorization.focusedFacts, currentClaim: request.claim, operationId })
      }
      expect(yield* readCompletionFocusedFacts(boundary, request, fixture.target, authorizationPurpose)).toMatchObject({
        operationId: authorizationOperation.operationId
      })
    }).pipe(Effect.provide(journalLayer(records, chronology)))
  })
)

const changedByteLength = (reference: EvidenceReference): EvidenceReference =>
  EvidenceReference.make({ byteLength: reference.byteLength + 1, digest: reference.digest })

it("rejects completion authorization when any sealed evidence byte length differs", () => {
  const request = completionTaskRequestFor(fixture.claim)
  const substitutions = [
    CompletionTaskAuthorization.make({
      ...authorization,
      acceptanceManifest: changedByteLength(authorization.acceptanceManifest)
    }),
    CompletionTaskAuthorization.make({
      ...authorization,
      integrationReviewManifest: changedByteLength(authorization.integrationReviewManifest)
    }),
    CompletionTaskAuthorization.make({
      ...authorization,
      verificationManifest: changedByteLength(authorization.verificationManifest)
    })
  ]

  expect(substitutions.map((substitution) => completionTaskAuthorizationIssue(substitution, request))).toEqual([
    expect.objectContaining({ reason: "SealedEvidenceChanged" }),
    expect.objectContaining({ reason: "SealedEvidenceChanged" }),
    expect.objectContaining({ reason: "SealedEvidenceChanged" })
  ])
})

const protocolHarness = (
  outcomes: ReadonlyArray<"Applied" | "DefinitelyRejected" | "UnknownNotApplied">,
  options: {
    readonly focusedLifecycle?: "CompletedSuccessfully" | "Open" | "TerminalWithoutSuccess"
    readonly lookup?: "Applied" | "NotApplied" | "Unreadable"
    readonly reactivationFocusedLifecycle?: "CompletedSuccessfully" | "Open" | "TerminalWithoutSuccess"
  } = {}
) =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const calls = yield* Ref.make(0)
    const lookupCalls = yield* Ref.make(0)
    const focusedLifecycle = yield* Ref.make(options.focusedLifecycle ?? "Open")
    const remaining = yield* Ref.make([...outcomes])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: (request) =>
        Effect.gen(function* () {
          yield* Ref.update(chronology, (current) => [...current, "Tracker.completeTask"])
          yield* Ref.update(calls, (count) => count + 1)
          const outcome = yield* Ref.modify(
            remaining,
            (current) => [current[0] ?? "Applied", current.slice(1)] as const
          )
          return outcome === "Applied"
            ? CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
            : yield* new CompletionTaskRequestFailure({
                detail: outcome === "DefinitelyRejected" ? "current tracker precondition rejected Q" : "response lost",
                outcome: outcome === "DefinitelyRejected" ? "DefinitelyNotApplied" : "Unknown",
                request
              })
        }),
      readCompletionRequest: (request) =>
        Effect.gen(function* () {
          yield* Ref.update(chronology, (current) => [...current, "Tracker.readCompletionRequest"])
          yield* Ref.update(lookupCalls, (count) => count + 1)
          const lookup = options.lookup ?? "NotApplied"
          return lookup === "Unreadable"
            ? CompletionTaskRequestLookup.cases.Unreadable.make({ detail: "lookup unavailable", request })
            : lookup === "Applied"
              ? CompletionTaskRequestLookup.cases.Applied.make({ request })
              : CompletionTaskRequestLookup.cases.NotApplied.make({ request })
        }),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Effect.gen(function* () {
          yield* Ref.update(chronology, (current) => [...current, "Tracker.readFocusedTaskCompletion"])
          return { ...authorization.focusedFacts, lifecycle: yield* Ref.get(focusedLifecycle), operationId }
        })
    }
    const request = completionTaskRequestFor(fixture.claim)
    const run = runCompletionTaskProtocol(boundary, request, fixture.target, () =>
      Ref.update(chronology, (current) => [...current, "Authorization.read"]).pipe(
        Effect.as(CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization }))
      )
    ).pipe(Effect.provide(journalLayer(records, chronology)), Effect.result)
    const firstOutcome = yield* run
    const outcome =
      options.reactivationFocusedLifecycle === undefined
        ? firstOutcome
        : yield* Ref.set(focusedLifecycle, options.reactivationFocusedLifecycle).pipe(Effect.andThen(run))
    return {
      calls: yield* Ref.get(calls),
      chronology: yield* Ref.get(chronology),
      lookupCalls: yield* Ref.get(lookupCalls),
      firstOutcome,
      outcome,
      records: yield* Ref.get(records)
    }
  })

it.effect("completes exact A only after current authorization and durable request intents", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["Applied"])
    expect(result.outcome._tag).toBe("Success")
    expect(result.calls).toBe(1)
    expect(result.chronology).toEqual([
      "Authorization.read",
      "CompletionTaskIntended",
      "CompletionTaskAttemptIntended",
      "Tracker.completeTask",
      "CompletionTaskAcknowledged"
    ])
  })
)

it.effect("restart returns the durable acknowledgement without another tracker call", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["Applied"], { reactivationFocusedLifecycle: "Open" })
    expect(result.firstOutcome._tag).toBe("Success")
    expect(result.outcome._tag).toBe("Success")
    expect(result.calls).toBe(1)
  })
)

it.effect("reports a task-local terminal-without-success confirmation as a conflict", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () => Effect.die("confirmation never repeats completion"),
      readCompletionRequest: () => Effect.die("confirmation never looks up Q"),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Effect.succeed({ ...authorization.focusedFacts, lifecycle: "TerminalWithoutSuccess", operationId })
    }
    expect(
      yield* readCompletionConfirmation(boundary, request, CompletionTaskRequestOrdinal.make(1), fixture.target).pipe(
        Effect.provide(journalLayer(records, chronology)),
        Effect.flip
      )
    ).toMatchObject({ reason: "TaskLifecycleConflict" })
  })
)

it.effect("restart preserves a durable rejection without rereading the prior open confirmation", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["DefinitelyRejected"], {
      focusedLifecycle: "Open",
      reactivationFocusedLifecycle: "CompletedSuccessfully"
    })
    expect(result.firstOutcome._tag).toBe("Failure")
    expect(result.outcome._tag).toBe("Failure")
    expect(result.calls).toBe(1)
  })
)

it.effect("restart keeps an applied request ambiguous until focused success is observed", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["UnknownNotApplied"], {
      focusedLifecycle: "Open",
      lookup: "Applied",
      reactivationFocusedLifecycle: "Open"
    })
    expect(result.firstOutcome._tag).toBe("Failure")
    expect(result.outcome._tag).toBe("Failure")
    expect(result.calls).toBe(1)
    expect(result.lookupCalls).toBe(1)
  })
)

it.effect("rejects a mismatched tracker acknowledgement after the numbered call", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () =>
        Effect.succeed(
          CompletionTaskAcknowledgement.make({
            operationId: OperationId.make("another-completion-request"),
            taskId: request.taskId
          })
        ),
      readCompletionRequest: () => Effect.die("acknowledgement mismatch never performs lookup"),
      readFocusedTaskCompletion: () => Effect.die("the injected authorization owns this test")
    }
    const failure = yield* runCompletionTaskProtocol(boundary, request, fixture.target, () =>
      Effect.succeed(CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization }))
    ).pipe(Effect.provide(journalLayer(records, chronology)), Effect.flip)

    expect(failure).toBeInstanceOf(CompletionTaskPreconditionConflict)
    expect(failure).toMatchObject({ reason: "TrackerAcknowledgementMismatch" })
  })
)

it.effect("rejects stale authorization before the tracker completion boundary", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () => Effect.die("stale authorization must not contact the tracker"),
      readCompletionRequest: () => Effect.die("stale authorization never performs lookup"),
      readFocusedTaskCompletion: () => Effect.die("the injected authorization owns this test")
    }
    const stale = CompletionTaskAuthorization.make({
      ...authorization,
      focusedFacts: { ...authorization.focusedFacts, unfinishedPrerequisiteTaskIds: [fixture.taskId] }
    })
    const failure = yield* runCompletionTaskProtocol(boundary, request, fixture.target, () =>
      Effect.succeed(CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization: stale }))
    ).pipe(Effect.provide(journalLayer(records, chronology)), Effect.flip)

    expect(failure).toBeInstanceOf(CompletionTaskPreconditionConflict)
    expect(failure).toMatchObject({ reason: "PrerequisitesIncomplete" })
  })
)

it.effect("records current tracker facts and Git ancestry before completing exact A", () =>
  Effect.gen(function* () {
    const request = yield* completionEvidenceRequest()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: (received) =>
        Ref.update(chronology, (current) => [...current, "Tracker.completeTask"]).pipe(
          Effect.as(CompletionTaskAcknowledgement.make({ operationId: received.operationId, taskId: received.taskId }))
        ),
      readCompletionRequest: (received) =>
        Effect.succeed(CompletionTaskRequestLookup.cases.NotApplied.make({ request: received })),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Ref.update(chronology, (current) => [...current, "Tracker.readFocusedTaskCompletion"]).pipe(
          Effect.as({ ...authorization.focusedFacts, currentClaim: request.claim, operationId })
        )
    }
    yield* runCompletionTaskProtocol(boundary, request, fixture.target, (ordinal) =>
      authorizeCompletionTaskAttempt(boundary, request, fixture.target, ordinal).pipe(
        Effect.provideService(
          TargetPromotionGit,
          TargetPromotionGit.of({
            compareAndSet: () => Effect.die("completion authorization never mutates Git"),
            read: () =>
              Ref.update(chronology, (current) => [...current, "Git.read"]).pipe(
                Effect.as({ _tag: "CandidateCurrent", currentHeadSha: request.promotionCorrelation.candidateCommit })
              )
          })
        )
      )
    ).pipe(Effect.provide(journalLayer(records, chronology)))
    expect(yield* Ref.get(chronology)).toEqual([
      "TaskTrackerReadIntentRecorded",
      "Tracker.readFocusedTaskCompletion",
      "TaskTrackerFactsObserved",
      "CompletionTaskCandidateAncestryReadIntended",
      "Git.read",
      "CompletionTaskCandidateAncestryObserved",
      "CompletionTaskIntended",
      "CompletionTaskAttemptIntended",
      "Tracker.completeTask",
      "CompletionTaskAcknowledged"
    ])
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("restart records a newer current authorization cycle before the call intent", () =>
  Effect.gen(function* () {
    const request = yield* completionEvidenceRequest()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const focusedCalls = yield* Ref.make(0)
    const gitCalls = yield* Ref.make(0)
    const trackerRevision = yield* Ref.make(TrackerRevision.make("authorization-cycle-one"))
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () => Effect.die("authorization cycle test never crosses the completion boundary"),
      readCompletionRequest: () => Effect.die("authorization cycle test never reconciles Q"),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Ref.update(focusedCalls, (count) => count + 1).pipe(
          Effect.andThen(Ref.get(trackerRevision)),
          Effect.map((revision) => ({
            ...authorization.focusedFacts,
            currentClaim: request.claim,
            operationId,
            trackerRevision: revision
          }))
        )
    }
    const git = TargetPromotionGit.of({
      compareAndSet: () => Effect.die("completion authorization never mutates Git"),
      read: () =>
        Ref.update(gitCalls, (count) => count + 1).pipe(
          Effect.as({ _tag: "CandidateCurrent", currentHeadSha: request.promotionCorrelation.candidateCommit })
        )
    })
    const authorize = authorizeCompletionTaskAttempt(
      boundary,
      request,
      fixture.target,
      CompletionTaskRequestOrdinal.make(1)
    ).pipe(Effect.provideService(TargetPromotionGit, git), Effect.provide(journalLayer(records, chronology)))
    const first = yield* authorize
    yield* Ref.set(trackerRevision, TrackerRevision.make("authorization-cycle-two"))
    const second = yield* authorize

    expect(first._tag).toBe("ReadyToComplete")
    expect(second._tag).toBe("ReadyToComplete")
    expect(yield* Ref.get(focusedCalls)).toBe(2)
    expect(yield* Ref.get(gitCalls)).toBe(2)
    expect(
      (yield* Ref.get(records)).flatMap(({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadCompletionTaskFacts" &&
        event.operation.purpose._tag === "Authorization"
          ? [event.operation.operationId]
          : []
      )
    ).toEqual([`${request.operationId}:authorization:1:1:tracker`, `${request.operationId}:authorization:1:2:tracker`])
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("restart repeats both current authorization reads after only the focused outcome was durable", () =>
  Effect.gen(function* () {
    const request = yield* completionEvidenceRequest()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const focusedCalls = yield* Ref.make(0)
    const gitCalls = yield* Ref.make(0)
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () => Effect.die("partial authorization test never crosses the completion boundary"),
      readCompletionRequest: () => Effect.die("partial authorization test never reconciles Q"),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Ref.update(focusedCalls, (count) => count + 1).pipe(
          Effect.as({ ...authorization.focusedFacts, currentClaim: request.claim, operationId })
        )
    }
    const git = TargetPromotionGit.of({
      compareAndSet: () => Effect.die("completion authorization never mutates Git"),
      read: () =>
        Ref.update(gitCalls, (count) => count + 1).pipe(
          Effect.as({ _tag: "CandidateCurrent", currentHeadSha: request.promotionCorrelation.candidateCommit })
        )
    })
    const journal = journalLayer(records, chronology)
    const firstPurpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
    })
    yield* readCompletionFocusedFacts(boundary, request, fixture.target, firstPurpose).pipe(Effect.provide(journal))
    yield* authorizeCompletionTaskAttempt(boundary, request, fixture.target, CompletionTaskRequestOrdinal.make(1)).pipe(
      Effect.provideService(TargetPromotionGit, git),
      Effect.provide(journal)
    )

    expect(yield* Ref.get(focusedCalls)).toBe(2)
    expect(yield* Ref.get(gitCalls)).toBe(1)
    expect(
      (yield* Ref.get(records)).flatMap(({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadCompletionTaskFacts" &&
        event.operation.purpose._tag === "Authorization"
          ? [event.operation.operationId]
          : []
      )
    ).toEqual([`${request.operationId}:authorization:1:1:tracker`, `${request.operationId}:authorization:1:2:tracker`])
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("restart replays one exact focused or Git authorization outcome without repeating its boundary read", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const focusedCalls = yield* Ref.make(0)
    const gitCalls = yield* Ref.make(0)
    const purpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
    })
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () => Effect.die("authorization replay never completes the task"),
      readCompletionRequest: () => Effect.die("authorization replay never looks up Q"),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Ref.update(focusedCalls, (count) => count + 1).pipe(
          Effect.as({ ...authorization.focusedFacts, currentClaim: request.claim, operationId })
        )
    }
    const git = TargetPromotionGit.of({
      compareAndSet: () => Effect.die("authorization replay never mutates Git"),
      read: () =>
        Ref.update(gitCalls, (count) => count + 1).pipe(
          Effect.as({ _tag: "CandidateCurrent", currentHeadSha: request.promotionCorrelation.candidateCommit })
        )
    })
    const journal = journalLayer(records, chronology)

    yield* readCompletionFocusedFacts(boundary, request, fixture.target, purpose).pipe(Effect.provide(journal))
    yield* readCompletionFocusedFacts(boundary, request, fixture.target, purpose).pipe(Effect.provide(journal))
    yield* readCompletionCandidateAncestry(request, purpose).pipe(
      Effect.provideService(TargetPromotionGit, git),
      Effect.provide(journal)
    )
    yield* readCompletionCandidateAncestry(request, purpose).pipe(
      Effect.provideService(TargetPromotionGit, git),
      Effect.provide(journal)
    )

    expect(yield* Ref.get(focusedCalls)).toBe(1)
    expect(yield* Ref.get(gitCalls)).toBe(1)
  })
)

it.effect("rejects a focused boundary result correlated to another operation", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const purpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
    })
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () => Effect.die("correlation failure never completes the task"),
      readCompletionRequest: () => Effect.die("correlation failure never looks up Q"),
      readFocusedTaskCompletion: () =>
        Effect.succeed({
          ...authorization.focusedFacts,
          operationId: OperationId.make("another-focused-read-operation")
        })
    }

    expect(
      yield* readCompletionFocusedFacts(boundary, request, fixture.target, purpose).pipe(
        Effect.provide(journalLayer(records, chronology)),
        Effect.flip
      )
    ).toMatchObject({ reason: "FocusedFactsCorrelationMismatch" })
  })
)

it.effect("rejects current authorization when Git no longer contains the promoted candidate", () =>
  Effect.gen(function* () {
    const request = yield* completionEvidenceRequest()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () => Effect.die("stale candidate authorization never completes the task"),
      readCompletionRequest: () => Effect.die("stale candidate authorization never looks up Q"),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Effect.succeed({ ...authorization.focusedFacts, currentClaim: request.claim, operationId })
    }
    const git = TargetPromotionGit.of({
      compareAndSet: () => Effect.die("completion authorization never mutates Git"),
      read: () =>
        Effect.succeed({
          _tag: "CandidateNotInAncestry",
          currentHeadSha: request.promotionCorrelation.expectedTargetHead
        })
    })

    expect(
      yield* authorizeCompletionTaskAttempt(
        boundary,
        request,
        fixture.target,
        CompletionTaskRequestOrdinal.make(1)
      ).pipe(
        Effect.provideService(TargetPromotionGit, git),
        Effect.provide(journalLayer(records, chronology)),
        Effect.flip
      )
    ).toMatchObject({ reason: "PromotedCandidateStale" })
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("waits when Git cannot read current candidate ancestry", () =>
  Effect.gen(function* () {
    const request = yield* completionEvidenceRequest()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () => Effect.die("unavailable Git never completes the task"),
      readCompletionRequest: () => Effect.die("unavailable Git never looks up Q"),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Effect.succeed({ ...authorization.focusedFacts, currentClaim: request.claim, operationId })
    }
    const git = TargetPromotionGit.of({
      compareAndSet: () => Effect.die("completion authorization never mutates Git"),
      read: () =>
        Effect.fail(
          new TargetPromotionGitReadFailure({
            candidateCommit: request.promotionCorrelation.candidateCommit,
            detail: "controlled Git read unavailable",
            target: request.promotionCorrelation.integrationTarget
          })
        )
    })

    expect(
      yield* authorizeCompletionTaskAttempt(
        boundary,
        request,
        fixture.target,
        CompletionTaskRequestOrdinal.make(1)
      ).pipe(
        Effect.provideService(TargetPromotionGit, git),
        Effect.provide(journalLayer(records, chronology)),
        Effect.flip
      )
    ).toMatchObject({ reason: "PromotedCandidateAncestryUnavailable" })
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("reuses exact Q after positive non-application evidence and stops after three calls", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["UnknownNotApplied", "UnknownNotApplied", "UnknownNotApplied"])
    expect(result.outcome._tag).toBe("Failure")
    if (result.outcome._tag === "Failure") expect(result.outcome.failure).toBeInstanceOf(CompletionTaskDidNotConverge)
    expect(result.calls).toBe(3)
    expect(result.records.filter(({ event }) => event._tag === "CompletionTaskIntended")).toHaveLength(1)
    expect(result.records.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended")).toHaveLength(3)
    expect(
      new Set(
        result.records.flatMap(({ event }) =>
          "request" in event && event._tag.startsWith("CompletionTask") ? [event.request.operationId] : []
        )
      ).size
    ).toBe(1)
  })
)

it.effect("checks A after losing the completion response and records fresh success without a second request", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["UnknownNotApplied"], { focusedLifecycle: "CompletedSuccessfully" })
    expect(result.outcome._tag).toBe("Success")
    expect(result.calls).toBe(1)
    expect(result.lookupCalls).toBe(0)
    const focusedSuccess = result.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.purpose._tag === "Confirmation" &&
        event.observation.facts.lifecycle === "CompletedSuccessfully"
    )
    expect(focusedSuccess).toBeDefined()
    expect(result.records.map(({ event }) => event._tag)).not.toContain("FocusedTaskCompletionObserved")
    if (result.outcome._tag === "Success" && focusedSuccess !== undefined) {
      expect(result.outcome.success).toMatchObject({
        _tag: "FocusedCompletedTaskObservation",
        observedAt: focusedSuccess.position
      })
    }
    expect(result.chronology.indexOf("CompletionTaskResponseLost")).toBeLessThan(
      result.chronology.indexOf("TaskTrackerReadIntentRecorded")
    )
    expect(result.chronology.indexOf("TaskTrackerReadIntentRecorded")).toBeLessThan(
      result.chronology.indexOf("Tracker.readFocusedTaskCompletion")
    )
    expect(result.chronology).not.toContain("Tracker.readCompletionRequest")
  })
)

it.effect("does not retry ambiguous completion merely because A currently appears open", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["UnknownNotApplied"], { lookup: "Unreadable" })
    expect(result.outcome._tag).toBe("Failure")
    expect(result.calls).toBe(1)
    expect(result.lookupCalls).toBe(1)
    expect(result.chronology.indexOf("TaskTrackerFactsObserved")).toBeLessThan(
      result.chronology.indexOf("CompletionTaskRequestLookupIntended")
    )
    expect(result.chronology.indexOf("CompletionTaskRequestLookupIntended")).toBeLessThan(
      result.chronology.indexOf("Tracker.readCompletionRequest")
    )
  })
)

it.effect("normalizes an unavailable exact-request lookup into an unreadable ambiguity wait", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () =>
        Effect.fail(new CompletionTaskRequestFailure({ detail: "response lost", outcome: "Unknown", request })),
      readCompletionRequest: () =>
        Effect.fail(new CompletionTaskRequestLookupFailure({ detail: "provider lookup unavailable", request })),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Effect.succeed({ ...authorization.focusedFacts, operationId })
    }

    expect(
      yield* runCompletionTaskProtocol(boundary, request, fixture.target, () =>
        Effect.succeed(CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization }))
      ).pipe(Effect.provide(journalLayer(records, chronology)), Effect.flip)
    ).toMatchObject({
      _tag: "IntegrationFinality.CompletionTaskAmbiguousWait",
      lookup: { _tag: "Unreadable", detail: "provider lookup unavailable" }
    })
  })
)

it.effect("does not retry from NotApplied evidence about another completion request", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const foreignClaim = CompletionTaskClaim.make({
      ...fixture.claim,
      originalClaim: {
        ...fixture.claim.originalClaim,
        operationId: OperationId.make("foreign-completion-lookup-claim")
      }
    })
    const foreignRequest = completionTaskRequestFor(foreignClaim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const calls = yield* Ref.make(0)
    const boundary: CompletionTaskBoundaryService = {
      completeTask: () =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.andThen(
            Effect.fail(new CompletionTaskRequestFailure({ detail: "response lost", outcome: "Unknown", request }))
          )
        ),
      readCompletionRequest: () =>
        Effect.succeed(CompletionTaskRequestLookup.cases.NotApplied.make({ request: foreignRequest })),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Effect.succeed({ ...authorization.focusedFacts, operationId })
    }

    expect(
      yield* runCompletionTaskProtocol(boundary, request, fixture.target, () =>
        Effect.succeed(CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization }))
      ).pipe(Effect.provide(journalLayer(records, chronology)), Effect.flip)
    ).toMatchObject({
      _tag: "IntegrationFinality.CompletionTaskPreconditionConflict",
      reason: "RequestIdentityContradiction",
      request
    })
    expect(yield* Ref.get(calls)).toBe(1)
    expect((yield* Ref.get(records)).some(({ event }) => event._tag === "CompletionTaskRequestLookupObserved")).toBe(
      false
    )
  })
)

it.effect("restart resumes lookup after a durable open confirmation without rereading A", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const focusedCalls = yield* Ref.make(0)
    const lookupCalls = yield* Ref.make(0)
    const completionCalls = yield* Ref.make(0)
    const outcomes = yield* Ref.make<ReadonlyArray<"Unknown" | "Applied">>(["Unknown", "Applied"])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: (received) =>
        Effect.gen(function* () {
          yield* Ref.update(completionCalls, (count) => count + 1)
          const outcome = yield* Ref.modify(outcomes, (current) => [current[0] ?? "Applied", current.slice(1)] as const)
          return outcome === "Applied"
            ? CompletionTaskAcknowledgement.make({ operationId: received.operationId, taskId: received.taskId })
            : yield* new CompletionTaskRequestFailure({
                detail: "response lost",
                outcome: "Unknown",
                request: received
              })
        }),
      readCompletionRequest: (received) =>
        Ref.update(lookupCalls, (count) => count + 1).pipe(
          Effect.as(CompletionTaskRequestLookup.cases.NotApplied.make({ request: received }))
        ),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Ref.update(focusedCalls, (count) => count + 1).pipe(Effect.as({ ...authorization.focusedFacts, operationId }))
    }
    const crashingJournal = Layer.succeed(
      InRunJournal,
      InRunJournal.of({
        append: (runId, key, event) =>
          event._tag === "CompletionTaskRequestLookupIntended"
            ? Effect.die("coordinator died before the lookup intent append")
            : Ref.modify(records, (current) => {
                const existing = current.find((record) => record.key === key)
                if (existing !== undefined) return [Effect.succeed(existing), current] as const
                const appended: JournalRecord = {
                  event,
                  key,
                  position: JournalPosition.make(current.length + 1),
                  runId
                }
                return [Effect.succeed(appended), [...current, appended]] as const
              }).pipe(Effect.flatten),
        read: () => Ref.get(records)
      })
    )
    const run = runCompletionTaskProtocol(boundary, request, fixture.target, () =>
      Effect.succeed(CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization }))
    )
    const firstExit = yield* run.pipe(Effect.provide(crashingJournal), Effect.exit)
    expect(firstExit._tag).toBe("Failure")
    expect(yield* Ref.get(focusedCalls)).toBe(1)
    expect(yield* Ref.get(lookupCalls)).toBe(0)

    const restarted = yield* run.pipe(Effect.provide(journalLayer(records, chronology)))
    expect(restarted).toEqual(
      CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
    )
    expect(yield* Ref.get(focusedCalls)).toBe(1)
    expect(yield* Ref.get(lookupCalls)).toBe(1)
    expect(yield* Ref.get(completionCalls)).toBe(2)
  })
)

it.effect("restart confirms success after a durable rejection or lost response cut", () =>
  Effect.gen(function* () {
    for (const outcome of ["DefinitelyNotApplied", "Unknown"] as const) {
      const request = completionTaskRequestFor(fixture.claim)
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
      const chronology = yield* Ref.make<ReadonlyArray<string>>([])
      const boundary: CompletionTaskBoundaryService = {
        completeTask: () =>
          Effect.fail(
            new CompletionTaskRequestFailure({
              detail: outcome === "Unknown" ? "response lost" : "tracker rejected Q",
              outcome,
              request
            })
          ),
        readCompletionRequest: () => Effect.die("focused success must stop before exact-request lookup"),
        readFocusedTaskCompletion: (_taskId, _target, operationId) =>
          Effect.succeed({ ...authorization.focusedFacts, lifecycle: "CompletedSuccessfully", operationId })
      }
      const run = runCompletionTaskProtocol(boundary, request, fixture.target, () =>
        Effect.succeed(CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization }))
      )
      const first = yield* run.pipe(
        Effect.provide(
          journalLayerThatDiesBefore(
            records,
            chronology,
            (event) =>
              event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadCompletionTaskFacts"
          )
        ),
        Effect.exit
      )
      expect(first._tag).toBe("Failure")
      expect(yield* run.pipe(Effect.provide(journalLayer(records, chronology)))).toMatchObject({
        _tag: "FocusedCompletedTaskObservation"
      })
    }
  })
)

it.effect("restart advances only after a durable NotApplied lookup", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const calls = yield* Ref.make(0)
    const boundary: CompletionTaskBoundaryService = {
      completeTask: (received) =>
        Ref.updateAndGet(calls, (count) => count + 1).pipe(
          Effect.flatMap((call) =>
            call === 1
              ? Effect.fail(new CompletionTaskRequestFailure({ detail: "response lost", outcome: "Unknown", request }))
              : Effect.succeed(
                  CompletionTaskAcknowledgement.make({ operationId: received.operationId, taskId: received.taskId })
                )
          )
        ),
      readCompletionRequest: () => Effect.succeed(CompletionTaskRequestLookup.cases.NotApplied.make({ request })),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Effect.succeed({ ...authorization.focusedFacts, lifecycle: "Open", operationId })
    }
    const run = runCompletionTaskProtocol(boundary, request, fixture.target, () =>
      Effect.succeed(CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization }))
    )
    const first = yield* run.pipe(
      Effect.provide(
        journalLayerThatDiesBefore(
          records,
          chronology,
          (event) => event._tag === "CompletionTaskAttemptIntended" && Number(event.attemptOrdinal) === 2
        )
      ),
      Effect.exit
    )
    expect(first._tag).toBe("Failure")
    expect(yield* run.pipe(Effect.provide(journalLayer(records, chronology)))).toEqual(
      CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
    )
    expect(yield* Ref.get(calls)).toBe(2)
  })
)

it.effect("does not reread A on restart without a newer accepted graph", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["UnknownNotApplied"], {
      focusedLifecycle: "Open",
      lookup: "Unreadable",
      reactivationFocusedLifecycle: "CompletedSuccessfully"
    })
    expect(result.firstOutcome._tag).toBe("Failure")
    expect(result.outcome._tag).toBe("Failure")
    expect(result.calls).toBe(1)
    expect(result.lookupCalls).toBe(1)
    expect(result.records.map(({ event }) => event._tag)).not.toContain("FocusedTaskCompletionObserved")
    expect(
      result.records.flatMap(({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadCompletionTaskFacts" &&
        event.operation.purpose._tag === "Confirmation"
          ? [event.operation.operationId]
          : []
      )
    ).toEqual([`${completionTaskRequestFor(fixture.claim).operationId}:confirmation:1:1:tracker`])
  })
)

it.effect("restart honors the unresolved call intent before sending the next completion request", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const calls = yield* Ref.make(0)
    const completionOutcomes = yield* Ref.make<ReadonlyArray<"Applied" | "Unknown">>(["Unknown", "Applied"])
    const focusedOutcomes = yield* Ref.make<ReadonlyArray<"Open" | "Unreadable">>(["Unreadable", "Open"])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: (received) =>
        Effect.gen(function* () {
          yield* Ref.update(chronology, (current) => [...current, "Tracker.completeTask"])
          yield* Ref.update(calls, (count) => count + 1)
          const outcome = yield* Ref.modify(
            completionOutcomes,
            (current) => [current[0] ?? "Applied", current.slice(1)] as const
          )
          return outcome === "Applied"
            ? CompletionTaskAcknowledgement.make({ operationId: received.operationId, taskId: received.taskId })
            : yield* new CompletionTaskRequestFailure({
                detail: "response lost",
                outcome: "Unknown",
                request: received
              })
        }),
      readCompletionRequest: (received) =>
        Ref.update(chronology, (current) => [...current, "Tracker.readCompletionRequest"]).pipe(
          Effect.as(CompletionTaskRequestLookup.cases.NotApplied.make({ request: received }))
        ),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Effect.gen(function* () {
          yield* Ref.update(chronology, (current) => [...current, "Tracker.readFocusedTaskCompletion"])
          const outcome = yield* Ref.modify(
            focusedOutcomes,
            (current) => [current[0] ?? "Open", current.slice(1)] as const
          )
          return outcome === "Unreadable"
            ? yield* new FocusedTaskCompletionReadFailure({
                detail: "focused read unavailable",
                taskId: request.taskId
              })
            : { ...authorization.focusedFacts, operationId }
        })
    }
    const run = runCompletionTaskProtocol(boundary, request, fixture.target, () =>
      Ref.update(chronology, (current) => [...current, "Authorization.read"]).pipe(
        Effect.as(CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({ authorization }))
      )
    ).pipe(Effect.provide(journalLayer(records, chronology)), Effect.result)
    expect((yield* run)._tag).toBe("Failure")
    const restartBeginsAt = (yield* Ref.get(chronology)).length
    expect((yield* run)._tag).toBe("Success")
    expect(yield* Ref.get(calls)).toBe(2)
    const afterRestart = (yield* Ref.get(chronology)).slice(restartBeginsAt)
    expect(afterRestart.indexOf("Tracker.readFocusedTaskCompletion")).toBeLessThan(
      afterRestart.indexOf("Tracker.readCompletionRequest")
    )
    expect(afterRestart.indexOf("Tracker.readCompletionRequest")).toBeLessThan(
      afterRestart.indexOf("Authorization.read")
    )
    expect(
      (yield* Ref.get(records)).flatMap(({ event }) =>
        event._tag === "CompletionTaskAttemptIntended" ? [Number(event.attemptOrdinal)] : []
      )
    ).toEqual([1, 2])
  })
)

it.effect("records a definitive tracker rejection without another call", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["DefinitelyRejected"])
    expect(result.outcome._tag).toBe("Failure")
    expect(result.calls).toBe(1)
    expect(result.records.some(({ event }) => event._tag === "CompletionTaskRejected")).toBe(true)
  })
)

it.effect("accepts a tracker client's successful completion after Q without another completion call", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const calls = yield* Ref.make(0)
    const intent = CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion })
    const replacementOperationId = completionClaimReplacementOperationIdFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      {
        event: CompletionClaimReplacedEvent.make({
          claim: fixture.claim,
          operationId: replacementOperationId,
          version: workflowJournalEventVersion
        }),
        key: completionClaimReplacedRecordKey(replacementOperationId),
        position: JournalPosition.make(1),
        runId: fixture.runId
      },
      {
        event: intent,
        key: completionTaskIntentRecordKey(request),
        position: JournalPosition.make(2),
        runId: fixture.runId
      }
    ])
    const boundary: CompletionTaskBoundaryService = {
      completeTask: (received) =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.as(CompletionTaskAcknowledgement.make({ operationId: received.operationId, taskId: received.taskId }))
        ),
      readCompletionRequest: (received) =>
        Effect.succeed(CompletionTaskRequestLookup.cases.NotApplied.make({ request: received })),
      readFocusedTaskCompletion: (_taskId, _target, operationId) =>
        Ref.update(chronology, (current) => [...current, "Tracker.readFocusedTaskCompletion"]).pipe(
          Effect.as({
            ...authorization.focusedFacts,
            currentClaim: { _tag: "UnclaimedTask" as const, taskId: fixture.taskId },
            lifecycle: "CompletedSuccessfully" as const,
            operationId
          })
        )
    }
    const result = yield* runCompletionTaskProtocol(boundary, request, fixture.target, (ordinal) =>
      authorizeCompletionTaskAttempt(boundary, request, fixture.target, ordinal).pipe(
        Effect.provideService(
          TargetPromotionGit,
          TargetPromotionGit.of({
            compareAndSet: () => Effect.die("completion authorization never mutates Git"),
            read: () => Effect.die("successful focused completion must not require a Git read")
          })
        )
      )
    ).pipe(Effect.provide(journalLayer(records, chronology)))
    expect("_tag" in result ? result._tag : undefined).toBe("FocusedCompletedTaskObservation")
    expect(yield* Ref.get(calls)).toBe(0)
    const finalRecords = yield* Ref.get(records)
    expect(
      finalRecords.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskCompletionFacts" &&
          event.observation.purpose._tag === "Authorization" &&
          event.observation.facts.lifecycle === "CompletedSuccessfully"
      )
    ).toBe(true)
    expect(finalRecords.map(({ event }) => event._tag)).not.toContain("FocusedTaskCompletionObserved")
    expect(finalRecords.some(({ event }) => event._tag === "CompletionTaskAttemptIntended")).toBe(false)
    expect(
      finalRecords.flatMap((record, index) => {
        const issue = invalidCompletionTaskHistory(record, finalRecords.slice(0, index), fixture.runId)
        return issue === undefined ? [] : [issue]
      })
    ).toEqual([])
  }).pipe(Effect.provide(memoryEvidenceStoreLayer), Effect.provide(NodeServices.layer))
)

it.effect("checks current task facts after a raced definitive rejection", () =>
  Effect.gen(function* () {
    const result = yield* protocolHarness(["DefinitelyRejected"], { focusedLifecycle: "CompletedSuccessfully" })
    expect(result.outcome._tag).toBe("Success")
    expect(result.calls).toBe(1)
    expect(result.records.some(({ event }) => event._tag === "CompletionTaskRejected")).toBe(true)
    expect(
      result.records.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskCompletionFacts" &&
          event.observation.purpose._tag === "Confirmation" &&
          event.observation.facts.lifecycle === "CompletedSuccessfully"
      )
    ).toBe(true)
    expect(result.records.map(({ event }) => event._tag)).not.toContain("FocusedTaskCompletionObserved")
    expect(result.chronology.indexOf("CompletionTaskRejected")).toBeLessThan(
      result.chronology.indexOf("Tracker.readFocusedTaskCompletion")
    )
  })
)

it("keeps missing, foreign, changed-revision, and unsuccessful-terminal completion conflicts distinct", () => {
  const request = completionTaskRequestFor(fixture.claim)
  const cases = [
    {
      authorization: CompletionTaskAuthorization.make({
        ...authorization,
        focusedFacts: { ...authorization.focusedFacts, currentClaim: { _tag: "UnclaimedTask", taskId: fixture.taskId } }
      }),
      expected: { detail: "the promotion-bound completion claim is missing", reason: "CompletionClaimMissing" }
    },
    {
      authorization: CompletionTaskAuthorization.make({
        ...authorization,
        focusedFacts: { ...authorization.focusedFacts, currentClaim: fixture.activeClaim }
      }),
      expected: {
        detail: "another claim replaced the promotion-bound completion claim",
        reason: "CompletionClaimForeign"
      }
    },
    {
      authorization: CompletionTaskAuthorization.make({
        ...authorization,
        focusedFacts: { ...authorization.focusedFacts, taskRevision: TaskRevision.make("changed-after-promotion") }
      }),
      expected: {
        detail: "focused task revision or identity differs from the immutable request",
        reason: "TaskIdentityOrRevisionChanged"
      }
    },
    {
      authorization: CompletionTaskAuthorization.make({
        ...authorization,
        focusedFacts: { ...authorization.focusedFacts, lifecycle: "TerminalWithoutSuccess" }
      }),
      expected: { detail: "task lifecycle is TerminalWithoutSuccess, not Open", reason: "TaskLifecycleConflict" }
    },
    {
      authorization: CompletionTaskAuthorization.make({
        ...authorization,
        target: FixtureTarget.make("another-tracker-target")
      }),
      expected: { detail: "focused task facts came from another tracker target", reason: "TrackerTargetChanged" }
    },
    {
      authorization: CompletionTaskAuthorization.make({
        ...authorization,
        focusedFacts: { ...authorization.focusedFacts, targetMembership: "NotMember" }
      }),
      expected: { detail: "focused task is not a member of the tracker target", reason: "TaskNotInTarget" }
    },
    {
      authorization: CompletionTaskAuthorization.make({
        ...authorization,
        focusedFacts: { ...authorization.focusedFacts, unfinishedPrerequisiteTaskIds: [fixture.taskId] }
      }),
      expected: { detail: "task has unfinished prerequisites", reason: "PrerequisitesIncomplete" }
    }
  ] as const

  for (const example of cases) {
    expect(completionTaskAuthorizationIssue(example.authorization, request)).toEqual(example.expected)
  }
})

it("keeps every focused confirmation conflict distinct from an exact-open wait", () => {
  const request = completionTaskRequestFor(fixture.claim)
  const operationId = OperationId.make("focused-confirmation-classification")
  const exact = { ...authorization.focusedFacts, currentClaim: request.claim, operationId }
  const foreignCompletionClaim = CompletionTaskClaim.make({
    ...request.claim,
    plannedAttempt: {
      ...request.claim.plannedAttempt,
      taskRevision: TaskRevision.make("foreign-confirmation-revision")
    }
  })
  const examples = [
    {
      facts: { ...exact, operationId: OperationId.make("another-focused-operation") },
      target: fixture.target,
      expected: "FocusedFactsCorrelationMismatch"
    },
    {
      facts: { ...exact, taskRevision: TaskRevision.make("another-focused-revision") },
      target: fixture.target,
      expected: "TaskIdentityOrRevisionChanged"
    },
    { facts: exact, target: FixtureTarget.make("another-focused-target"), expected: "TrackerTargetChanged" },
    { facts: { ...exact, targetMembership: "NotMember" }, target: fixture.target, expected: "TaskNotInTarget" },
    {
      facts: { ...exact, currentClaim: fixture.activeClaim },
      target: fixture.target,
      expected: "CompletionClaimForeign"
    },
    {
      facts: { ...exact, currentClaim: foreignCompletionClaim },
      target: fixture.target,
      expected: "CompletionClaimForeign"
    },
    {
      facts: { ...exact, currentClaim: { _tag: "UnclaimedTask" as const, taskId: fixture.taskId } },
      target: fixture.target,
      expected: "CompletionClaimMissing"
    }
  ] as const

  for (const example of examples) {
    expect(completionTaskConfirmationDisposition(request, example.target, operationId, example.facts)).toMatchObject({
      _tag: "Conflict",
      reason: example.expected
    })
  }
  expect(completionTaskConfirmationDisposition(request, fixture.target, operationId, exact)).toEqual({
    _tag: "Pending"
  })
})

it("classifies both current and ancestor promoted candidates", () => {
  expect(
    candidateAncestryFor({ _tag: "CandidateCurrent", currentHeadSha: fixture.promotionCorrelation.candidateCommit })
  ).toBe("Current")
  expect(
    candidateAncestryFor({ _tag: "CandidateAncestor", currentHeadSha: fixture.promotionCorrelation.candidateCommit })
  ).toBe("Ancestor")
  expect(
    candidateAncestryFor({
      _tag: "CandidateNotInAncestry",
      currentHeadSha: fixture.promotionCorrelation.expectedTargetHead
    })
  ).toBeUndefined()
})
