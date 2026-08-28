import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { expect } from "vitest"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import {
  completionClaimDeletionAttemptIntentRecordKey,
  completionClaimDeletionIntentRecordKey,
  completionClaimDeletionReadObservedRecordKey,
  completionClaimDeletedRecordKey,
  completionClaimReplacementAttemptIntentRecordKey,
  completionClaimReplacementIntentRecordKey,
  completionClaimReplacedRecordKey as replacedKey,
  integrationFinalitySettledRecordKey,
  targetPromotionObservedSuccessRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import { describeJournalEvent } from "../../registry/event-descriptor.js"
import { IntegratorRunOrdinal, IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import { TargetPromotionObservedSuccessEvent, targetPromotionCorrelationFor } from "../target-promotion/events.js"
import {
  CompletionClaimBoundary,
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimDeletionReadObservedEvent,
  CompletionClaimDeletionReadPurpose,
  CompletionClaimCleanupReadOrdinal,
  CompletionClaimDeletionFailure,
  type CompletionClaimDeletionRequest,
  type CompletionClaimObservation,
  CompletionClaimOwnershipConflict,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionClaimReplacementFailure,
  CompletionTaskClaim,
  CompletionTaskIntendedEvent,
  CompletionClaimRequestOrdinal,
  type CompletionClaimReplacementRequest,
  FocusedCompletedTaskObservation,
  completionClaimDeletionRequestFor,
  completionClaimDeletionOperationIdFor,
  completionClaimReplacementRequestFor,
  completionClaimReplacementOperationIdFor,
  completionTaskClaimEquals,
  CompletionClaimReplacedEvent,
  IntegrationFinalitySettledEvent
} from "./events.js"
import {
  CompletionClaimDidNotConverge,
  CompletionClaimPromotionRequired,
  FocusedTaskCompletionSuccessRequired,
  runCompletionClaimDeletionProtocol,
  runCompletionClaimReplacementProtocol
} from "./protocol.js"
import { continuesCompletionClaimCleanup } from "./cleanup-boundary-transition.js"
import { integrationFinalityFixture as fixture } from "./fixtures.js"
import { makeApplicationExitLifecycle } from "../../../coordination/application-exit/lifecycle.js"
import { InterruptibleWorkflowBoundaryIntent } from "../../interpretation/interpreter.js"
import { CompletionClaimCleanupBoundaryCall } from "../../interpretation/interruptible-boundary.js"
import { deriveIntegrationFinalityStateFor } from "./state.js"
import { TaskTrackerMutationThrottled } from "../../../authorities/task-tracker/mutation-throttling.js"

const deletionOperationFor = completionClaimDeletionOperationIdFor
const replacementOperationFor = completionClaimReplacementOperationIdFor
const firstCleanupReadOrdinal = CompletionClaimCleanupReadOrdinal.make(1)

type MutationOutcome = "Applied" | "DefinitelyNotApplied" | "Throttled" | "Unknown" | "UnknownApplied"

const appendJournalLayer = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: (runId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((record) => record.key === key)
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const appended: JournalRecord = { event, key, position: JournalPosition.make(current.length + 1), runId }
          return [Effect.succeed(appended), [...current, appended]] as const
        }).pipe(Effect.flatten),
      read: () => Ref.get(records)
    })
  )

const recordOf = (position: number, key: string, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: key as JournalRecord["key"],
  position: JournalPosition.make(position),
  runId: fixture.runId
})

const promotionRecord = recordOf(
  1,
  targetPromotionObservedSuccessRecordKey(fixture.promotionCorrelation.requestId),
  fixture.promotionSuccess
)

const replacementRecord = (position = 2, operationId = replacementOperationFor(fixture.claim)) =>
  recordOf(
    position,
    replacedKey(operationId),
    CompletionClaimReplacedEvent.make({ claim: fixture.claim, operationId, version: workflowJournalEventVersion })
  )

const focusedSuccessObservation = { ...fixture.successObservation, observedAt: JournalPosition.make(5) }
const focusedSuccessRecords = [
  recordOf(
    3,
    describeJournalEvent(
      CompletionTaskIntendedEvent.make({ request: fixture.completionRequest, version: workflowJournalEventVersion })
    ).expectedKey,
    CompletionTaskIntendedEvent.make({ request: fixture.completionRequest, version: workflowJournalEventVersion })
  ),
  recordOf(
    4,
    describeJournalEvent(fixture.focusedSuccessFactsReadIntentEvent).expectedKey,
    fixture.focusedSuccessFactsReadIntentEvent
  ),
  recordOf(5, describeJournalEvent(fixture.focusedSuccessFactsEvent).expectedKey, fixture.focusedSuccessFactsEvent)
] as const

it("continues completion-claim cleanup only across adjacent exact calls", () => {
  const request = completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation)
  const replacementOperationId = replacementOperationFor(fixture.claim)
  const intent = (call: CompletionClaimCleanupBoundaryCall) =>
    InterruptibleWorkflowBoundaryIntent.CompletionClaimCleanup({
      call,
      family: "TaskTracker",
      replacementOperationId,
      request
    })
  const readBeforeOne = intent(
    CompletionClaimCleanupBoundaryCall.ReadBeforeDeletionAttempt({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      readOrdinal: firstCleanupReadOrdinal
    })
  )
  const deleteOne = intent(
    CompletionClaimCleanupBoundaryCall.DeleteAttempt({ attemptOrdinal: CompletionClaimRequestOrdinal.make(1) })
  )
  const readBeforeTwo = intent(
    CompletionClaimCleanupBoundaryCall.ReadBeforeDeletionAttempt({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(2),
      readOrdinal: CompletionClaimCleanupReadOrdinal.make(2)
    })
  )
  const exhaustedThree = intent(
    CompletionClaimCleanupBoundaryCall.ReadAfterDeletionAttemptsExhausted({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(3),
      readOrdinal: CompletionClaimCleanupReadOrdinal.make(3)
    })
  )

  expect(continuesCompletionClaimCleanup(readBeforeOne, deleteOne)).toBe(true)
  expect(
    continuesCompletionClaimCleanup(
      readBeforeOne,
      intent(
        CompletionClaimCleanupBoundaryCall.DeleteAttempt({ attemptOrdinal: CompletionClaimRequestOrdinal.make(2) })
      )
    )
  ).toBe(false)
  expect(continuesCompletionClaimCleanup(deleteOne, readBeforeTwo)).toBe(true)
  expect(continuesCompletionClaimCleanup(deleteOne, readBeforeOne)).toBe(false)
  expect(continuesCompletionClaimCleanup(deleteOne, exhaustedThree)).toBe(false)
  const deleteThree = intent(
    CompletionClaimCleanupBoundaryCall.DeleteAttempt({ attemptOrdinal: CompletionClaimRequestOrdinal.make(3) })
  )
  expect(continuesCompletionClaimCleanup(deleteThree, exhaustedThree)).toBe(true)
  expect(continuesCompletionClaimCleanup(exhaustedThree, readBeforeOne)).toBe(false)
  expect(
    continuesCompletionClaimCleanup(
      intent({ ...deleteOne.call, attemptOrdinal: CompletionClaimRequestOrdinal.make(1) }),
      intent({ ...exhaustedThree.call, attemptOrdinal: CompletionClaimRequestOrdinal.make(2) })
    )
  ).toBe(false)
  expect(
    continuesCompletionClaimCleanup(
      readBeforeOne,
      InterruptibleWorkflowBoundaryIntent.CompletionClaimCleanup({
        call: deleteOne.call,
        family: "TaskTracker",
        replacementOperationId: OperationId.make("different-cleanup-replacement"),
        request
      })
    )
  ).toBe(false)
})

it("describes every completion-finality event with its stable record key", () => {
  const replacementOperationId = replacementOperationFor(fixture.claim)
  const deletionOperationId = deletionOperationFor(fixture.claim)
  const ordinal = CompletionClaimRequestOrdinal.make(1)
  const events: ReadonlyArray<JournalRecord["event"]> = [
    CompletionClaimReplacementIntendedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    }),
    CompletionClaimReplacementAttemptIntendedEvent.make({
      attemptOrdinal: ordinal,
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    }),
    CompletionClaimReplacedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    }),
    CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: focusedSuccessObservation,
      version: workflowJournalEventVersion
    }),
    CompletionClaimDeletionReadObservedEvent.make({
      observation: fixture.claim,
      purpose: CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
        attemptOrdinal: ordinal,
        readOrdinal: firstCleanupReadOrdinal
      }),
      replacementOperationId,
      request: completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation),
      version: workflowJournalEventVersion
    }),
    CompletionClaimDeletionAttemptIntendedEvent.make({
      attemptOrdinal: ordinal,
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: focusedSuccessObservation,
      version: workflowJournalEventVersion
    }),
    CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: focusedSuccessObservation,
      version: workflowJournalEventVersion
    }),
    IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId,
      replacementOperationId,
      successObservation: focusedSuccessObservation,
      version: workflowJournalEventVersion
    })
  ]
  expect(events.map((event) => describeJournalEvent(event).expectedKey)).toEqual([
    completionClaimReplacementIntentRecordKey(replacementOperationId),
    completionClaimReplacementAttemptIntentRecordKey(replacementOperationId, ordinal),
    replacedKey(replacementOperationId),
    completionClaimDeletionIntentRecordKey(deletionOperationId),
    completionClaimDeletionReadObservedRecordKey(
      deletionOperationId,
      CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
        attemptOrdinal: ordinal,
        readOrdinal: firstCleanupReadOrdinal
      })
    ),
    completionClaimDeletionAttemptIntentRecordKey(deletionOperationId, ordinal),
    completionClaimDeletedRecordKey(deletionOperationId),
    integrationFinalitySettledRecordKey(fixture.claim.promotionCorrelation.requestId)
  ])
})

const makeBoundary = (input: {
  readonly initial: ReadonlyArray<CompletionClaimObservation>
  readonly replacement?: ReadonlyArray<MutationOutcome>
  readonly deletion?: ReadonlyArray<MutationOutcome>
  readonly replacementCalls: Ref.Ref<number>
  readonly deletionCalls: Ref.Ref<number>
  readonly readCalls: Ref.Ref<number>
  readonly chronology?: Ref.Ref<ReadonlyArray<"delete" | "read" | "replace">>
}) =>
  (() => {
    let current = new Map<string, CompletionClaimObservation>(
      input.initial.map((claim) => [
        String(claim._tag === "CompletionTaskClaim" ? claim.plannedAttempt.taskId : claim.taskId),
        claim
      ])
    )
    const replacements = [...(input.replacement ?? [])]
    const deletions = [...(input.deletion ?? [])]
    const recordBoundaryCall = (call: "delete" | "read" | "replace") =>
      input.chronology === undefined ? Effect.void : Ref.update(input.chronology, (current) => [...current, call])
    const readTaskClaim = (taskId: typeof fixture.taskId) =>
      recordBoundaryCall("read").pipe(
        Effect.andThen(Ref.update(input.readCalls, (count) => count + 1)),
        Effect.map(() => current.get(String(taskId)) ?? { _tag: "UnclaimedTask" as const, taskId })
      )
    const replaceTaskClaim = (request: CompletionClaimReplacementRequest) =>
      Effect.gen(function* () {
        yield* recordBoundaryCall("replace")
        yield* Ref.update(input.replacementCalls, (count) => count + 1)
        const step = replacements.shift() ?? "Applied"
        if (step === "Throttled") {
          return yield* new TaskTrackerMutationThrottled({
            detail: "GitHub secondary rate limit rejected the GraphQL request",
            operation: "ReplaceCompletionClaim",
            operationId: request.operationId,
            retry: null
          })
        }
        if (step === "DefinitelyNotApplied") {
          return yield* new CompletionClaimReplacementFailure({
            detail: "tracker rejected replacement",
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        if (step === "Unknown" || step === "UnknownApplied") {
          if (step === "UnknownApplied")
            current = new Map(current).set(String(request.claim.plannedAttempt.taskId), request.claim)
          return yield* new CompletionClaimReplacementFailure({
            detail: "replacement response was lost",
            outcome: "Unknown",
            request
          })
        }
        current = new Map(current).set(String(request.claim.plannedAttempt.taskId), request.claim)
        return request.claim
      })
    const deleteTaskClaim = (request: CompletionClaimDeletionRequest) =>
      Effect.gen(function* () {
        yield* recordBoundaryCall("delete")
        yield* Ref.update(input.deletionCalls, (count) => count + 1)
        const step = deletions.shift() ?? "Applied"
        if (step === "Throttled") {
          return yield* new TaskTrackerMutationThrottled({
            detail: "GitHub primary rate limit rejected the GraphQL request",
            operation: "DeleteCompletionClaim",
            operationId: request.operationId,
            retry: null
          })
        }
        if (step === "DefinitelyNotApplied") {
          return yield* new CompletionClaimDeletionFailure({
            detail: "tracker rejected deletion",
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        if (step === "Unknown" || step === "UnknownApplied") {
          if (step === "UnknownApplied") {
            const next = new Map(current)
            next.delete(String(request.claim.plannedAttempt.taskId))
            current = next
          }
          return yield* new CompletionClaimDeletionFailure({
            detail: "deletion response was lost",
            outcome: "Unknown",
            request
          })
        }
        const next = new Map(current)
        next.delete(String(request.claim.plannedAttempt.taskId))
        current = next
      })
    return CompletionClaimBoundary.of({ readTaskClaim, replaceTaskClaim, deleteTaskClaim })
  })()

const runWith = <A, E>(effect: Effect.Effect<A, E, InRunJournal>, records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  effect.pipe(Effect.provide(appendJournalLayer(records)))

const tags = (records: ReadonlyArray<JournalRecord>) => records.map(({ event }) => event._tag)

it.effect("requires exact promotion success and Integrator run before replacing the active claim", () =>
  Effect.gen(function* () {
    expect(fixture.promotionCorrelation.qualifiedCandidate.run.ordinal).toBe(IntegratorRunOrdinal.make(1))
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const failure = yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({ initial: [fixture.activeClaim], replacementCalls, deletionCalls, readCalls }),
        { claim: fixture.claim, operationId: replacementOperationFor(fixture.claim) }
      ).pipe(Effect.flip),
      records
    )
    expect(failure).toBeInstanceOf(CompletionClaimPromotionRequired)
    expect(yield* Ref.get(replacementCalls)).toBe(0)
    expect(yield* Ref.get(records)).toEqual([])

    const foreignCandidate = IntegratorRunQualifiedCandidate.make({
      ...fixture.qualifiedCandidate,
      run: { ...fixture.qualifiedCandidate.run, ordinal: IntegratorRunOrdinal.make(2) }
    })
    const foreignPromotion = TargetPromotionObservedSuccessEvent.make({
      ...fixture.promotionSuccess,
      correlation: targetPromotionCorrelationFor(foreignCandidate)
    })
    const foreignRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      recordOf(1, targetPromotionObservedSuccessRecordKey(foreignPromotion.correlation.requestId), foreignPromotion)
    ])
    const foreignFailure = yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({ initial: [fixture.activeClaim], replacementCalls, deletionCalls, readCalls }),
        { claim: fixture.claim, operationId: replacementOperationFor(fixture.claim) }
      ).pipe(Effect.flip),
      foreignRecords
    )
    expect(foreignFailure).toBeInstanceOf(CompletionClaimPromotionRequired)
    expect(yield* Ref.get(replacementCalls)).toBe(0)
    expect(yield* Ref.get(foreignRecords)).toHaveLength(1)
  })
)

it.effect("stops immediately after definite replacement or deletion rejection", () =>
  Effect.gen(function* () {
    const replacementRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const replacementBoundary = makeBoundary({
      deletionCalls,
      initial: [fixture.activeClaim],
      readCalls,
      replacement: ["DefinitelyNotApplied"],
      replacementCalls
    })
    expect(
      (yield* runWith(
        runCompletionClaimReplacementProtocol(
          replacementBoundary,
          completionClaimReplacementRequestFor(fixture.claim)
        ).pipe(Effect.flip),
        replacementRecords
      ))._tag
    ).toBe("IntegrationFinality.CompletionClaimReplacementFailure")
    expect(yield* Ref.get(replacementCalls)).toBe(1)

    const deletionRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const deletionBoundary = makeBoundary({
      deletion: ["DefinitelyNotApplied"],
      deletionCalls,
      initial: [fixture.claim],
      readCalls,
      replacementCalls
    })
    expect(
      (yield* runWith(
        runCompletionClaimDeletionProtocol(
          deletionBoundary,
          completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation),
          replacementOperationFor(fixture.claim)
        ).pipe(Effect.flip),
        deletionRecords
      ))._tag
    ).toBe("IntegrationFinality.CompletionClaimDeletionFailure")
    expect(yield* Ref.get(deletionCalls)).toBe(1)
  })
)

it.effect(
  "completion claim replacement and deletion throttles each stop after one mutation and restart reads first",
  () =>
    Effect.gen(function* () {
      const replacementRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord])
      const replacementCalls = yield* Ref.make(0)
      const deletionCalls = yield* Ref.make(0)
      const readCalls = yield* Ref.make(0)
      const replacementChronology = yield* Ref.make<ReadonlyArray<"delete" | "read" | "replace">>([])
      const replacementRequest = completionClaimReplacementRequestFor(fixture.claim)
      const throttledReplacement = makeBoundary({
        chronology: replacementChronology,
        deletionCalls,
        initial: [fixture.activeClaim],
        readCalls,
        replacement: ["Throttled"],
        replacementCalls
      })

      expect(
        yield* runWith(
          runCompletionClaimReplacementProtocol(throttledReplacement, replacementRequest).pipe(Effect.flip),
          replacementRecords
        )
      ).toEqual(
        new TaskTrackerMutationThrottled({
          detail: "GitHub secondary rate limit rejected the GraphQL request",
          operation: "ReplaceCompletionClaim",
          operationId: replacementRequest.operationId,
          retry: null
        })
      )
      expect(yield* Ref.get(replacementCalls)).toBe(1)
      expect(yield* Ref.get(replacementChronology)).toEqual(["read", "replace"])

      const afterReplacementThrottle = yield* Ref.get(replacementRecords)
      expect(afterReplacementThrottle.map(({ event }) => event._tag)).toEqual([
        "TargetPromotionObservedSuccess",
        "CompletionClaimReplacementIntended",
        "CompletionClaimReplacementAttemptIntended"
      ])
      expect(JSON.stringify(afterReplacementThrottle)).not.toMatch(/throttl|retry|deadline/i)
      expect(deriveIntegrationFinalityStateFor(afterReplacementThrottle, fixture.claim)?._tag).toBe(
        "ReplacementPending"
      )
      const retainedReplacementIntent = afterReplacementThrottle.find(
        ({ event }) => event._tag === "CompletionClaimReplacementIntended"
      )?.event
      if (retainedReplacementIntent?._tag !== "CompletionClaimReplacementIntended") {
        return yield* Effect.die("expected retained completion-claim replacement intent")
      }
      const recoveredReplacementRequest = completionClaimReplacementRequestFor(retainedReplacementIntent.claim)

      yield* runWith(
        runCompletionClaimReplacementProtocol(
          makeBoundary({
            chronology: replacementChronology,
            deletionCalls,
            initial: [fixture.activeClaim],
            readCalls,
            replacementCalls
          }),
          recoveredReplacementRequest
        ),
        replacementRecords
      )
      expect(yield* Ref.get(replacementChronology)).toEqual(["read", "replace", "read", "replace"])
      expect(yield* Ref.get(replacementCalls)).toBe(2)

      const deletionRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        promotionRecord,
        replacementRecord(),
        ...focusedSuccessRecords
      ])
      const deletionChronology = yield* Ref.make<ReadonlyArray<"delete" | "read" | "replace">>([])
      const deletionRequest = completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation)
      const throttledDeletion = makeBoundary({
        chronology: deletionChronology,
        deletion: ["Throttled"],
        deletionCalls,
        initial: [fixture.claim],
        readCalls,
        replacementCalls
      })

      expect(
        yield* runWith(
          runCompletionClaimDeletionProtocol(
            throttledDeletion,
            deletionRequest,
            replacementOperationFor(fixture.claim)
          ).pipe(Effect.flip),
          deletionRecords
        )
      ).toEqual(
        new TaskTrackerMutationThrottled({
          detail: "GitHub primary rate limit rejected the GraphQL request",
          operation: "DeleteCompletionClaim",
          operationId: deletionRequest.operationId,
          retry: null
        })
      )
      expect(yield* Ref.get(deletionCalls)).toBe(1)
      expect(yield* Ref.get(deletionChronology)).toEqual(["read", "delete"])

      const afterDeletionThrottle = yield* Ref.get(deletionRecords)
      expect(afterDeletionThrottle.slice(-3).map(({ event }) => event._tag)).toEqual([
        "CompletionClaimDeletionIntended",
        "CompletionClaimDeletionReadObserved",
        "CompletionClaimDeletionAttemptIntended"
      ])
      expect(JSON.stringify(afterDeletionThrottle)).not.toMatch(/throttl|retry|deadline/i)
      expect(afterDeletionThrottle.some(({ event }) => event._tag === "CompletionClaimDeleted")).toBe(false)
      expect(afterDeletionThrottle.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(false)
      const retainedDeletionIntent = afterDeletionThrottle.find(
        ({ event }) => event._tag === "CompletionClaimDeletionIntended"
      )?.event
      if (retainedDeletionIntent?._tag !== "CompletionClaimDeletionIntended") {
        return yield* Effect.die("expected retained completion-claim deletion intent")
      }
      const recoveredDeletionRequest = completionClaimDeletionRequestFor(
        retainedDeletionIntent.claim,
        retainedDeletionIntent.successObservation
      )

      yield* runWith(
        runCompletionClaimDeletionProtocol(
          makeBoundary({
            chronology: deletionChronology,
            deletionCalls,
            initial: [fixture.claim],
            readCalls,
            replacementCalls
          }),
          recoveredDeletionRequest,
          replacementOperationFor(retainedDeletionIntent.claim)
        ),
        deletionRecords
      )
      expect(yield* Ref.get(deletionChronology)).toEqual(["read", "delete", "read", "delete"])
      expect(yield* Ref.get(deletionCalls)).toBe(2)
    })
)

it.effect("writes replacement intent first and reconciles an unknown response by a fresh claim read", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const result = yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({
          initial: [fixture.activeClaim],
          replacement: ["UnknownApplied"],
          replacementCalls,
          deletionCalls,
          readCalls
        }),
        { claim: fixture.claim, operationId: replacementOperationFor(fixture.claim) }
      ),
      records
    )
    expect(completionTaskClaimEquals(result.claim, fixture.claim)).toBe(true)
    expect(yield* Ref.get(replacementCalls)).toBe(1)
    expect(yield* Ref.get(readCalls)).toBe(2)
    expect(tags(yield* Ref.get(records))).toEqual([
      "TargetPromotionObservedSuccess",
      "CompletionClaimReplacementIntended",
      "CompletionClaimReplacementAttemptIntended",
      "CompletionClaimReplaced"
    ])
  })
)

it.effect("fails closed on a foreign claim without attempting replacement", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const foreign = { ...fixture.activeClaim, operationId: OperationId.make("foreign-active-claim") }
    const failure = yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({ initial: [foreign], replacementCalls, deletionCalls, readCalls }),
        { claim: fixture.claim, operationId: replacementOperationFor(fixture.claim) }
      ).pipe(Effect.flip),
      records
    )
    expect(failure).toBeInstanceOf(CompletionClaimOwnershipConflict)
    expect(yield* Ref.get(replacementCalls)).toBe(0)
    expect(tags(yield* Ref.get(records))).toEqual([
      "TargetPromotionObservedSuccess",
      "CompletionClaimReplacementIntended"
    ])

    const foreignCompletion = CompletionTaskClaim.make({ ...fixture.claim, originalClaim: foreign })
    const completionRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord])
    expect(
      yield* runWith(
        runCompletionClaimReplacementProtocol(
          makeBoundary({ initial: [foreignCompletion], replacementCalls, deletionCalls, readCalls }),
          { claim: fixture.claim, operationId: replacementOperationFor(fixture.claim) }
        ).pipe(Effect.flip),
        completionRecords
      )
    ).toBeInstanceOf(CompletionClaimOwnershipConflict)
  })
)

it.effect("does not delete a different completion claim", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const foreignCompletion = CompletionTaskClaim.make({
      ...fixture.claim,
      originalClaim: { ...fixture.activeClaim, operationId: OperationId.make("foreign-completion-claim") }
    })
    const failure = yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({ initial: [foreignCompletion], replacementCalls, deletionCalls, readCalls }),
        completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation),
        replacementOperationFor(fixture.claim)
      ).pipe(Effect.flip),
      records
    )
    expect(failure).toBeInstanceOf(CompletionClaimOwnershipConflict)
    expect(yield* Ref.get(deletionCalls)).toBe(0)
  })
)

it.effect("bounds unresolved replacement responses at three requests", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const failure = yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({
          initial: [fixture.activeClaim],
          replacement: ["Unknown", "Unknown", "Unknown"],
          replacementCalls,
          deletionCalls,
          readCalls
        }),
        { claim: fixture.claim, operationId: replacementOperationFor(fixture.claim) }
      ).pipe(Effect.flip),
      records
    )
    expect(failure).toBeInstanceOf(CompletionClaimDidNotConverge)
    expect(yield* Ref.get(replacementCalls)).toBe(3)
    expect(tags(yield* Ref.get(records))).toEqual([
      "TargetPromotionObservedSuccess",
      "CompletionClaimReplacementIntended",
      "CompletionClaimReplacementAttemptIntended",
      "CompletionClaimReplacementAttemptIntended",
      "CompletionClaimReplacementAttemptIntended"
    ])
  })
)

it.effect("later activation discovers replacement success after three ambiguous requests without request four", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const request = completionClaimReplacementRequestFor(fixture.claim)
    yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({
          deletionCalls,
          initial: [fixture.activeClaim],
          readCalls,
          replacement: ["Unknown", "Unknown", "Unknown"],
          replacementCalls
        }),
        request
      ).pipe(Effect.flip),
      records
    )
    const result = yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({ deletionCalls, initial: [fixture.claim], readCalls, replacementCalls }),
        request
      ),
      records
    )
    expect(completionTaskClaimEquals(result.claim, fixture.claim)).toBe(true)
    expect(yield* Ref.get(replacementCalls)).toBe(3)
    expect(tags(yield* Ref.get(records)).at(-1)).toBe("CompletionClaimReplaced")
  })
)

it.effect("fails closed when exhausted replacement reconciliation observes another claim", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const request = completionClaimReplacementRequestFor(fixture.claim)
    yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({
          deletionCalls,
          initial: [fixture.activeClaim],
          readCalls,
          replacement: ["Unknown", "Unknown", "Unknown"],
          replacementCalls
        }),
        request
      ).pipe(Effect.flip),
      records
    )
    const foreignActive = { ...fixture.activeClaim, operationId: OperationId.make("exhausted-foreign-active") }
    const foreignCompletion = CompletionTaskClaim.make({ ...fixture.claim, originalClaim: foreignActive })
    for (const observed of [foreignCompletion, foreignActive]) {
      const failure = yield* runWith(
        runCompletionClaimReplacementProtocol(
          makeBoundary({ deletionCalls, initial: [observed], readCalls, replacementCalls }),
          request
        ).pipe(Effect.flip),
        records
      )
      expect(failure).toBeInstanceOf(CompletionClaimOwnershipConflict)
    }
    expect(yield* Ref.get(replacementCalls)).toBe(3)
  })
)

it.effect("records replacement success on the third and final request without a fourth read", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const result = yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({
          initial: [fixture.activeClaim],
          replacement: ["Unknown", "Unknown", "Applied"],
          replacementCalls,
          deletionCalls,
          readCalls
        }),
        { claim: fixture.claim, operationId: replacementOperationFor(fixture.claim) }
      ),
      records
    )
    expect(completionTaskClaimEquals(result.claim, fixture.claim)).toBe(true)
    expect(yield* Ref.get(replacementCalls)).toBe(3)
    expect(yield* Ref.get(readCalls)).toBe(3)
    expect(tags(yield* Ref.get(records)).at(-1)).toBe("CompletionClaimReplaced")
  })
)

it.effect("resumes replacement from its exact durable request ordinal and ignores another operation", () =>
  Effect.gen(function* () {
    const operationId = replacementOperationFor(fixture.claim)
    const foreignOperationId = OperationId.make("foreign-replacement-history")
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      recordOf(
        2,
        completionClaimReplacementIntentRecordKey(foreignOperationId),
        CompletionClaimReplacementIntendedEvent.make({
          claim: fixture.claim,
          operationId: foreignOperationId,
          version: workflowJournalEventVersion
        })
      ),
      recordOf(
        3,
        completionClaimReplacementIntentRecordKey(operationId),
        CompletionClaimReplacementIntendedEvent.make({
          claim: fixture.claim,
          operationId,
          version: workflowJournalEventVersion
        })
      ),
      recordOf(
        5,
        completionClaimReplacementAttemptIntentRecordKey(foreignOperationId, CompletionClaimRequestOrdinal.make(1)),
        CompletionClaimReplacementAttemptIntendedEvent.make({
          attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
          claim: fixture.claim,
          operationId: foreignOperationId,
          version: workflowJournalEventVersion
        })
      ),
      recordOf(
        6,
        completionClaimReplacementAttemptIntentRecordKey(operationId, CompletionClaimRequestOrdinal.make(1)),
        CompletionClaimReplacementAttemptIntendedEvent.make({
          attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
          claim: fixture.claim,
          operationId,
          version: workflowJournalEventVersion
        })
      )
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({ initial: [fixture.activeClaim], replacementCalls, deletionCalls, readCalls }),
        completionClaimReplacementRequestFor(fixture.claim)
      ),
      records
    )
    expect(yield* Ref.get(replacementCalls)).toBe(1)
    expect(
      (yield* Ref.get(records)).some(
        ({ event }) => event._tag === "CompletionClaimReplacementAttemptIntended" && Number(event.attemptOrdinal) === 2
      )
    ).toBe(true)
  })
)

it.effect("returns an already recorded exact replacement without touching the tracker", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord, replacementRecord()])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const result = yield* runWith(
      runCompletionClaimReplacementProtocol(
        makeBoundary({ initial: [], replacementCalls, deletionCalls, readCalls }),
        completionClaimReplacementRequestFor(fixture.claim)
      ),
      records
    )
    expect(result.claim).toEqual(fixture.claim)
    expect(yield* Ref.get(readCalls)).toBe(0)
    expect(yield* Ref.get(replacementCalls)).toBe(0)
  })
)

it.effect("deletes only the exact completion claim after actual fresh success and settles once", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const request = {
      claim: fixture.claim,
      operationId: deletionOperationFor(fixture.claim),
      successObservation: focusedSuccessObservation
    }
    const result = yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({ initial: [fixture.claim], replacementCalls, deletionCalls, readCalls }),
        request,
        replacementOperationFor(fixture.claim)
      ),
      records
    )
    expect(result.claim).toEqual(fixture.claim)
    expect(yield* Ref.get(deletionCalls)).toBe(1)
    expect(tags(yield* Ref.get(records))).toEqual([
      "TargetPromotionObservedSuccess",
      "CompletionClaimReplaced",
      "CompletionTaskIntended",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "CompletionClaimDeletionIntended",
      "CompletionClaimDeletionReadObserved",
      "CompletionClaimDeletionAttemptIntended",
      "CompletionClaimDeleted",
      "IntegrationFinalitySettled"
    ])
    expect(
      yield* runWith(
        runCompletionClaimDeletionProtocol(
          makeBoundary({ initial: [], replacementCalls, deletionCalls, readCalls }),
          request,
          replacementOperationFor(fixture.claim)
        ),
        records
      )
    ).toEqual(result)
  })
)

it.effect("records an already-produced completion-claim cleanup result under Exit and starts no later retry", () =>
  Effect.gen(function* () {
    const replacementOperationId = replacementOperationFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      recordOf(
        1,
        targetPromotionObservedSuccessRecordKey(fixture.promotionCorrelation.requestId),
        fixture.promotionSuccess
      ),
      recordOf(
        1,
        completionClaimReplacementIntentRecordKey(replacementOperationId),
        CompletionClaimReplacementIntendedEvent.make({
          claim: fixture.claim,
          operationId: replacementOperationId,
          version: workflowJournalEventVersion
        })
      ),
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const request = completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation)
    const lifecycle = yield* makeApplicationExitLifecycle()
    const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
    if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong cleanup owner kind")
    const deletionReturned = yield* Deferred.make<void>()
    const allowRecording = yield* Deferred.make<void>()
    const deletionCalls = yield* Ref.make(0)
    const reads = yield* Ref.make(0)
    const boundaryCalls = yield* Ref.make(0)
    const boundaryIntents = yield* Ref.make<ReadonlyArray<InterruptibleWorkflowBoundaryIntent>>([])
    const boundary = CompletionClaimBoundary.of({
      readTaskClaim: () =>
        Ref.updateAndGet(reads, (count) => count + 1).pipe(
          Effect.map((count) =>
            count === 1 ? fixture.claim : { _tag: "UnclaimedTask" as const, taskId: fixture.taskId }
          )
        ),
      replaceTaskClaim: () => Effect.die("cleanup must not replace the claim"),
      deleteTaskClaim: () =>
        Ref.update(deletionCalls, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(deletionReturned, undefined)),
          Effect.asVoid
        )
    })
    const intent = InterruptibleWorkflowBoundaryIntent.CompletionClaimCleanup({
      call: CompletionClaimCleanupBoundaryCall.DeleteAttempt({ attemptOrdinal: CompletionClaimRequestOrdinal.make(1) }),
      family: "TaskTracker",
      replacementOperationId,
      request
    })
    const execution = {
      run: <A, E, R, B, E2, R2>(
        boundaryIntent: InterruptibleWorkflowBoundaryIntent,
        call: Effect.Effect<A, E, R>,
        recordResult: (result: A) => Effect.Effect<B, E2, R2>
      ) =>
        Ref.update(boundaryIntents, (intents) => [...intents, boundaryIntent]).pipe(
          Effect.andThen(Ref.updateAndGet(boundaryCalls, (count) => count + 1)),
          Effect.flatMap((count) =>
            owner.run(boundaryIntent, call, (result) =>
              count === 1
                ? recordResult(result)
                : Deferred.await(allowRecording).pipe(Effect.andThen(recordResult(result)))
            )
          )
        )
    }
    const running = yield* runWith(
      runCompletionClaimDeletionProtocol(boundary, request, replacementOperationId, execution),
      records
    ).pipe(Effect.forkChild)

    yield* Deferred.await(deletionReturned)
    yield* lifecycle.requestExit
    yield* Deferred.succeed(allowRecording, undefined)
    expect((yield* Fiber.await(running))._tag).toBe("Failure")
    expect(yield* Ref.get(deletionCalls)).toBe(1)
    expect(tags(yield* Ref.get(records))).toContain("CompletionClaimDeleted")
    expect(yield* owner.snapshot).toEqual({ _tag: "BoundaryResultRecorded", intent })
    const intents = yield* Ref.get(boundaryIntents)
    expect(intents).toHaveLength(2)
    expect(intents[0]).not.toBe(intents[1])
    expect(intents[0]).toMatchObject({
      _tag: "CompletionClaimCleanup",
      call: { _tag: "ReadBeforeDeletionAttempt", attemptOrdinal: 1 }
    })
    expect(intents[1]).toMatchObject({
      _tag: "CompletionClaimCleanup",
      call: { _tag: "DeleteAttempt", attemptOrdinal: 1 }
    })
    if (intents[0]?._tag !== "CompletionClaimCleanup" || intents[1]?._tag !== "CompletionClaimCleanup") {
      return yield* Effect.die("completion cleanup did not preserve exact per-call intents")
    }
    expect(intents[0].sequenceId).toBe(intents[1].sequenceId)
    expect(intents[0].callId).not.toBe(intents[1].callId)
    const readObservation = (yield* Ref.get(records)).find(
      ({ event }) => event._tag === "CompletionClaimDeletionReadObserved"
    )?.event
    expect(readObservation).toMatchObject({
      _tag: "CompletionClaimDeletionReadObserved",
      observation: fixture.claim,
      purpose: { _tag: "BeforeDeletionAttempt", attemptOrdinal: 1 },
      replacementOperationId,
      request
    })
    yield* owner.release
  })
)

it.effect("preserves an interrupted completion-claim deletion behind its exact attempt intent", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const request = completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation)
    const replacementOperationId = replacementOperationFor(fixture.claim)
    const lifecycle = yield* makeApplicationExitLifecycle()
    const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
    if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong cleanup owner kind")
    const deletionStarted = yield* Deferred.make<void>()
    const reads = yield* Ref.make(0)
    const boundary = CompletionClaimBoundary.of({
      readTaskClaim: () => Ref.update(reads, (count) => count + 1).pipe(Effect.as(fixture.claim)),
      replaceTaskClaim: () => Effect.die("cleanup must not replace the claim"),
      deleteTaskClaim: () => Deferred.succeed(deletionStarted, undefined).pipe(Effect.andThen(Effect.never))
    })
    const intent = InterruptibleWorkflowBoundaryIntent.CompletionClaimCleanup({
      call: CompletionClaimCleanupBoundaryCall.DeleteAttempt({ attemptOrdinal: CompletionClaimRequestOrdinal.make(1) }),
      family: "TaskTracker",
      replacementOperationId,
      request
    })
    const execution = {
      run: <A, E, R, B, E2, R2>(
        boundaryIntent: InterruptibleWorkflowBoundaryIntent,
        call: Effect.Effect<A, E, R>,
        recordResult: (result: A) => Effect.Effect<B, E2, R2>
      ) => owner.run(boundaryIntent, call, recordResult)
    }
    const running = yield* runWith(
      runCompletionClaimDeletionProtocol(boundary, request, replacementOperationId, execution),
      records
    ).pipe(Effect.forkChild)

    yield* Deferred.await(deletionStarted)
    yield* lifecycle.requestExit
    expect((yield* Fiber.await(running))._tag).toBe("Failure")
    expect(tags(yield* Ref.get(records))).toContain("CompletionClaimDeletionAttemptIntended")
    expect(tags(yield* Ref.get(records))).not.toContain("CompletionClaimDeleted")
    expect(yield* Ref.get(reads)).toBe(1)
    expect(yield* owner.snapshot).toEqual({ _tag: "RecoverableAmbiguity", intent })
    yield* owner.release
  })
)

it.effect("recomposes and reopens an interrupted completion cleanup through authored and recorded cassettes", () =>
  Effect.gen(function* () {
    const replacementOperationId = replacementOperationFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      recordOf(
        1,
        targetPromotionObservedSuccessRecordKey(fixture.promotionCorrelation.requestId),
        fixture.promotionSuccess
      ),
      recordOf(
        1,
        completionClaimReplacementIntentRecordKey(replacementOperationId),
        CompletionClaimReplacementIntendedEvent.make({
          claim: fixture.claim,
          operationId: replacementOperationId,
          version: workflowJournalEventVersion
        })
      ),
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const request = completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation)
    const authored = yield* Ref.make<ReadonlyArray<string>>([])
    const record = (item: string) => Ref.update(authored, (items) => [...items, item])
    const firstLifecycle = yield* makeApplicationExitLifecycle()
    const firstOwner = yield* firstLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
    if (firstOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong first cleanup owner kind")
    const deletionStarted = yield* Deferred.make<void>()
    const firstBoundary = CompletionClaimBoundary.of({
      readTaskClaim: () => record("ExactCompletionClaimReread").pipe(Effect.as(fixture.claim)),
      replaceTaskClaim: () => Effect.die("cleanup must not replace the claim"),
      deleteTaskClaim: () =>
        record("CompletionClaimDeletionSent").pipe(
          Effect.andThen(Deferred.succeed(deletionStarted, undefined)),
          Effect.andThen(Effect.never)
        )
    })
    const firstRun = yield* runWith(
      runCompletionClaimDeletionProtocol(firstBoundary, request, replacementOperationId, firstOwner),
      records
    ).pipe(Effect.forkChild)

    yield* Deferred.await(deletionStarted)
    yield* record("ExitCutoffClosed")
    yield* firstLifecycle.requestExit
    expect((yield* Fiber.await(firstRun))._tag).toBe("Failure")
    yield* record("LocalDeletionWaitInterrupted")
    const ambiguous = yield* firstOwner.snapshot
    expect(ambiguous).toMatchObject({
      _tag: "RecoverableAmbiguity",
      intent: { _tag: "CompletionClaimCleanup", call: { _tag: "DeleteAttempt", attemptOrdinal: 1 } }
    })
    yield* firstOwner.release
    const interruptedRecords = yield* Ref.get(records)
    expect(deriveIntegrationFinalityStateFor(interruptedRecords, fixture.claim)).toMatchObject({
      _tag: "DeletionPending",
      deletionAttempts: [{ attemptOrdinal: 1 }]
    })
    expect(
      interruptedRecords.map(({ event }) => event._tag).filter((tag) => tag.startsWith("CompletionClaimDeletion"))
    ).toEqual([
      "CompletionClaimDeletionIntended",
      "CompletionClaimDeletionReadObserved",
      "CompletionClaimDeletionAttemptIntended"
    ])

    yield* record("ApplicationProcessDied")
    yield* record("OrdinaryRunEntry")
    const restartedLifecycle = yield* makeApplicationExitLifecycle()
    const restartedOwner = yield* restartedLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
    if (restartedOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong restarted cleanup owner kind")
    const restartedBoundary = CompletionClaimBoundary.of({
      readTaskClaim: () =>
        record("TrackerReconciledDeletion").pipe(Effect.as({ _tag: "UnclaimedTask" as const, taskId: fixture.taskId })),
      replaceTaskClaim: () => Effect.die("cleanup must not replace the claim"),
      deleteTaskClaim: () => Effect.die("reopening must not repeat an already-applied deletion")
    })
    yield* runWith(
      runCompletionClaimDeletionProtocol(restartedBoundary, request, replacementOperationId, restartedOwner),
      records
    )
    yield* record("DeletionAndSettlementRecorded")
    expect(yield* restartedOwner.snapshot).toMatchObject({
      _tag: "BoundaryResultRecorded",
      intent: { _tag: "CompletionClaimCleanup", call: { _tag: "ReadBeforeDeletionAttempt", attemptOrdinal: 2 } }
    })
    yield* restartedOwner.release
    const completedRecords = yield* Ref.get(records)
    expect(deriveIntegrationFinalityStateFor(completedRecords, fixture.claim)?._tag).toBe("IntegrationFinalitySettled")
    expect(
      completedRecords.every(
        (journalRecord) => describeJournalEvent(journalRecord.event).expectedKey === journalRecord.key
      )
    ).toBe(true)
    expect(yield* Ref.get(authored)).toEqual([
      "ExactCompletionClaimReread",
      "CompletionClaimDeletionSent",
      "ExitCutoffClosed",
      "LocalDeletionWaitInterrupted",
      "ApplicationProcessDied",
      "OrdinaryRunEntry",
      "TrackerReconciledDeletion",
      "DeletionAndSettlementRecorded"
    ])
  })
)

it.effect("starts no completion-claim deletion after Exit closes between its read and delete", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const request = completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation)
    const replacementOperationId = replacementOperationFor(fixture.claim)
    const lifecycle = yield* makeApplicationExitLifecycle()
    const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
    if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong cleanup owner kind")
    const readRecorded = yield* Deferred.make<void>()
    const continueAfterRead = yield* Deferred.make<void>()
    const deletionCalls = yield* Ref.make(0)
    const boundaryCalls = yield* Ref.make(0)
    const boundary = CompletionClaimBoundary.of({
      readTaskClaim: () => Effect.succeed(fixture.claim),
      replaceTaskClaim: () => Effect.die("cleanup must not replace the claim"),
      deleteTaskClaim: () => Ref.update(deletionCalls, (count) => count + 1)
    })
    const intent = InterruptibleWorkflowBoundaryIntent.CompletionClaimCleanup({
      call: CompletionClaimCleanupBoundaryCall.ReadBeforeDeletionAttempt({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        readOrdinal: firstCleanupReadOrdinal
      }),
      family: "TaskTracker",
      replacementOperationId,
      request
    })
    const execution = {
      run: <A, E, R, B, E2, R2>(
        boundaryIntent: InterruptibleWorkflowBoundaryIntent,
        call: Effect.Effect<A, E, R>,
        recordResult: (result: A) => Effect.Effect<B, E2, R2>
      ) =>
        Ref.updateAndGet(boundaryCalls, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            owner.run(boundaryIntent, call, recordResult).pipe(
              Effect.tap(() => (count === 1 ? Deferred.succeed(readRecorded, undefined) : Effect.void)),
              Effect.tap(() => (count === 1 ? Deferred.await(continueAfterRead) : Effect.void))
            )
          )
        )
    }
    const running = yield* runWith(
      runCompletionClaimDeletionProtocol(boundary, request, replacementOperationId, execution),
      records
    ).pipe(Effect.forkChild)

    yield* Deferred.await(readRecorded)
    yield* lifecycle.requestExit
    yield* Deferred.succeed(continueAfterRead, undefined)
    expect((yield* Fiber.await(running))._tag).toBe("Failure")
    expect(yield* Ref.get(deletionCalls)).toBe(0)
    expect(tags(yield* Ref.get(records))).toContain("CompletionClaimDeletionAttemptIntended")
    expect(yield* owner.snapshot).toEqual({ _tag: "BoundaryResultRecorded", intent })
    yield* owner.release
  })
)

it.effect("ignores another deletion operation while settling the exact completion claim", () =>
  Effect.gen(function* () {
    const foreignOperationId = OperationId.make("foreign-deletion-history")
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords,
      recordOf(
        5,
        completionClaimDeletionIntentRecordKey(foreignOperationId),
        CompletionClaimDeletionIntendedEvent.make({
          claim: fixture.claim,
          operationId: foreignOperationId,
          successObservation: focusedSuccessObservation,
          version: workflowJournalEventVersion
        })
      ),
      recordOf(
        6,
        completionClaimDeletedRecordKey(foreignOperationId),
        CompletionClaimDeletedEvent.make({
          claim: fixture.claim,
          operationId: foreignOperationId,
          successObservation: focusedSuccessObservation,
          version: workflowJournalEventVersion
        })
      )
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({ initial: [fixture.claim], replacementCalls, deletionCalls, readCalls }),
        completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation),
        replacementOperationFor(fixture.claim)
      ),
      records
    )
    expect(yield* Ref.get(deletionCalls)).toBe(1)
  })
)

it.effect("adds the missing settlement when restart finds an exact prior deletion outcome", () =>
  Effect.gen(function* () {
    const deletionOperationId = deletionOperationFor(fixture.claim)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords,
      recordOf(
        4,
        completionClaimDeletionIntentRecordKey(deletionOperationId),
        CompletionClaimDeletionIntendedEvent.make({
          claim: fixture.claim,
          operationId: deletionOperationId,
          successObservation: focusedSuccessObservation,
          version: workflowJournalEventVersion
        })
      ),
      recordOf(
        5,
        completionClaimDeletedRecordKey(deletionOperationId),
        CompletionClaimDeletedEvent.make({
          claim: fixture.claim,
          operationId: deletionOperationId,
          successObservation: focusedSuccessObservation,
          version: workflowJournalEventVersion
        })
      )
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({ initial: [], replacementCalls, deletionCalls, readCalls }),
        completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation),
        replacementOperationFor(fixture.claim)
      ),
      records
    )
    expect(yield* Ref.get(deletionCalls)).toBe(0)
    expect(tags(yield* Ref.get(records)).at(-1)).toBe("IntegrationFinalitySettled")
  })
)

it.effect("rejects a forged success proof before deletion intent", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([promotionRecord, replacementRecord()])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const forged = FocusedCompletedTaskObservation.make({
      ...focusedSuccessObservation,
      operationId: OperationId.make("not-observed")
    })
    const failure = yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({ initial: [fixture.claim], replacementCalls, deletionCalls, readCalls }),
        { claim: fixture.claim, operationId: deletionOperationFor(fixture.claim), successObservation: forged },
        replacementOperationFor(fixture.claim)
      ).pipe(Effect.flip),
      records
    )
    expect(failure).toBeInstanceOf(FocusedTaskCompletionSuccessRequired)
    expect(tags(yield* Ref.get(records))).toEqual(["TargetPromotionObservedSuccess", "CompletionClaimReplaced"])
    expect(yield* Ref.get(deletionCalls)).toBe(0)
  })
)

it.effect("does not reopen success when deletion response is unknown but already applied", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const result = yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({
          initial: [fixture.claim],
          deletion: ["UnknownApplied"],
          replacementCalls,
          deletionCalls,
          readCalls
        }),
        {
          claim: fixture.claim,
          operationId: deletionOperationFor(fixture.claim),
          successObservation: focusedSuccessObservation
        },
        replacementOperationFor(fixture.claim)
      ),
      records
    )
    expect(result.successObservation).toEqual(focusedSuccessObservation)
    expect(yield* Ref.get(deletionCalls)).toBe(1)
    expect(tags(yield* Ref.get(records))).toContain("IntegrationFinalitySettled")
    expect(tags(yield* Ref.get(records))).toContain("CompletionClaimDeletionAttemptIntended")
  })
)

it.effect("bounds deletion retries at three and preserves the successful observation on non-convergence", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const failure = yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({
          initial: [fixture.claim],
          deletion: ["Unknown", "Unknown", "Unknown"],
          replacementCalls,
          deletionCalls,
          readCalls
        }),
        {
          claim: fixture.claim,
          operationId: deletionOperationFor(fixture.claim),
          successObservation: focusedSuccessObservation
        },
        replacementOperationFor(fixture.claim)
      ).pipe(Effect.flip),
      records
    )
    expect(failure).toBeInstanceOf(CompletionClaimDidNotConverge)
    expect(yield* Ref.get(deletionCalls)).toBe(3)
    const finalTags = tags(yield* Ref.get(records))
    expect(finalTags.filter((tag) => tag === "CompletionClaimDeletionAttemptIntended")).toHaveLength(3)
    expect(finalTags).toContain("TaskTrackerFactsObserved")
    expect(finalTags).not.toContain("CompletionClaimDeleted")
    expect(finalTags).not.toContain("IntegrationFinalitySettled")
  })
)

it.effect("later activation discovers deletion success after three ambiguous requests without request four", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const request = completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation)
    yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({
          deletion: ["Unknown", "Unknown", "Unknown"],
          deletionCalls,
          initial: [fixture.claim],
          readCalls,
          replacementCalls
        }),
        request,
        replacementOperationFor(fixture.claim)
      ).pipe(Effect.flip),
      records
    )
    const result = yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({ deletionCalls, initial: [], readCalls, replacementCalls }),
        request,
        replacementOperationFor(fixture.claim)
      ),
      records
    )
    expect(result.successObservation).toEqual(focusedSuccessObservation)
    expect(yield* Ref.get(deletionCalls)).toBe(3)
    expect(tags(yield* Ref.get(records))).toContain("IntegrationFinalitySettled")
  })
)

it.effect("fails closed when exhausted deletion reconciliation observes another completion claim", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const request = completionClaimDeletionRequestFor(fixture.claim, focusedSuccessObservation)
    yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({
          deletion: ["Unknown", "Unknown", "Unknown"],
          deletionCalls,
          initial: [fixture.claim],
          readCalls,
          replacementCalls
        }),
        request,
        replacementOperationFor(fixture.claim)
      ).pipe(Effect.flip),
      records
    )
    const foreignCompletion = CompletionTaskClaim.make({
      ...fixture.claim,
      originalClaim: { ...fixture.activeClaim, operationId: OperationId.make("exhausted-foreign-completion") }
    })
    const failure = yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({ deletionCalls, initial: [foreignCompletion], readCalls, replacementCalls }),
        request,
        replacementOperationFor(fixture.claim)
      ).pipe(Effect.flip),
      records
    )
    expect(failure).toBeInstanceOf(CompletionClaimOwnershipConflict)
    expect(yield* Ref.get(deletionCalls)).toBe(3)
  })
)

it.effect("records deletion success on the third and final request without a fourth read", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      promotionRecord,
      replacementRecord(),
      ...focusedSuccessRecords
    ])
    const replacementCalls = yield* Ref.make(0)
    const deletionCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const result = yield* runWith(
      runCompletionClaimDeletionProtocol(
        makeBoundary({
          initial: [fixture.claim],
          deletion: ["Unknown", "Unknown", "Applied"],
          replacementCalls,
          deletionCalls,
          readCalls
        }),
        {
          claim: fixture.claim,
          operationId: deletionOperationFor(fixture.claim),
          successObservation: focusedSuccessObservation
        },
        replacementOperationFor(fixture.claim)
      ),
      records
    )
    expect(result.successObservation).toEqual(focusedSuccessObservation)
    expect(yield* Ref.get(deletionCalls)).toBe(3)
    expect(yield* Ref.get(readCalls)).toBe(3)
    expect(tags(yield* Ref.get(records)).at(-1)).toBe("IntegrationFinalitySettled")
  })
)
